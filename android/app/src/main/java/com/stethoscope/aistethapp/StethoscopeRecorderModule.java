package com.stethoscope.aistethapp;

/*
 * StethoscopeRecorderModule.java
 * ===================================
 * Package: com.stethoscope.aistethapp  (exact match to repo)
 *
 * CHANGES FROM ORIGINAL:
 *   ✂  REMOVED — No AiSteth API URLs or credentials
 *   ✚  ADDED   — processAndSendRecording()  full preprocessing + HTTP
 *   ✚  ADDED   — sendToCustomApi()          OkHttp POST to Flask
 *   ✚  ADDED   — removeDcOffset(), normalisePcm(), bandpassFilter()
 *   ✚  ADDED   — PCM/WAV/base64 helpers
 *   ✚  ADDED   — onSeparationProgress, onSeparationDone, onSeparationError events
 *   ↔  UNCHANGED — ALL Bluetooth, SCO, AudioRecord, amplitude, recording logic
 *
 * build.gradle (app) additions:
 *   implementation 'com.squareup.okhttp3:okhttp:4.12.0'
 *
 * gradle.properties addition:
 *   STETH_SERVER_URL=http://192.168.1.100:5000
 *
 * (or hardcode in PROCESS_URL below for local dev)
 */

import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.annotation.Nullable;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import okhttp3.Call;
import okhttp3.Callback;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

public class StethoscopeRecorderModule extends ReactContextBaseJavaModule {

    private static final String TAG = "StethoscopeRecorder";

    // ── Original event names ──────────────────────────────────────────────────
    private static final String EVENT_BLUETOOTH_STATE = "onBluetoothStateChange";
    private static final String EVENT_AUDIO_READY     = "onAudioRouteReady";
    private static final String EVENT_AMPLITUDE       = "onAmplitude";
    private static final String EVENT_RECORDING_STATE = "onRecordingStateChange";
    private static final String EVENT_ERROR           = "onError";
    // New separation events
    private static final String EVT_SEP_PROGRESS      = "onSeparationProgress";
    private static final String EVT_SEP_DONE          = "onSeparationDone";
    private static final String EVT_SEP_ERROR         = "onSeparationError";

    // ── Flask backend URL ─────────────────────────────────────────────────────
    // Change this to your server's IP address.
    // For emulator testing use: http://10.0.2.2:5000
    // For physical device on LAN: http://192.168.x.x:5000
    private static final String PROCESS_URL = "http://192.168.0.116:5000/process_audio";
    private static final int RECORDING_SR = 44100;

    // ── HTTP client ───────────────────────────────────────────────────────────
    private final OkHttpClient http = new OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(60,    TimeUnit.SECONDS)
            .writeTimeout(30,   TimeUnit.SECONDS)
            .build();

    // Background executor — keeps UI thread free during preprocessing + HTTP
    private final ExecutorService bgExec = Executors.newSingleThreadExecutor();

    // ── Original fields ───────────────────────────────────────────────────────
    private final ReactApplicationContext reactContext;
    private BluetoothAdapter  bluetoothAdapter;
    private AudioManager      audioManager;
    private BluetoothAudioRecorder audioRecorder;
    private BluetoothDevice   currentDevice;
    private BluetoothA2dp     bluetoothA2dp;
    private final Handler     handler;
    private boolean           isRecording            = false;
    private String            recordingFilePath;
    private BroadcastReceiver bluetoothReceiver;
    private boolean           isScoConnected         = false;
    private boolean           scoConnectionRequested = false;
    private Handler           maintenanceHandler;
    private Runnable          maintenanceRunnable;
    private PowerManager.WakeLock wakeLock;
    private AudioFocusRequest audioFocusRequest;
    private AudioManager.OnAudioFocusChangeListener audioFocusListener;

    public StethoscopeRecorderModule(ReactApplicationContext ctx) {
        super(ctx);
        this.reactContext = ctx;
        this.handler      = new Handler(Looper.getMainLooper());
        initializeBluetooth();
    }

    @NonNull @Override
    public String getName() { return "StethoscopeRecorder"; }

    // ═════════════════════════════════════════════════════════════════════════
    //  NEW — NMF separation pipeline
    // ═════════════════════════════════════════════════════════════════════════

    /**
     * Called from JS after stopRecording() returns the filePath.
     * Full pipeline: read WAV → DC removal → normalise → base64 → POST Flask
     *
     * JS usage:
     *   const result = await StethoscopeRecorder.processAndSendRecording(filePath);
     *   // result: { heart, lung, heartWav, lungWav, noiseLevel, signalQuality, ... }
     */
    @ReactMethod
    public void processAndSendRecording(final String filePath, final Promise promise) {
        bgExec.submit(() -> {
            try {
                emitProgress("Reading audio file…", 5);

                byte[] wavBytes = readFileBytes(filePath);
                if (wavBytes == null || wavBytes.length < 44) {
                    promise.reject("FILE_ERROR", "File missing or too small: " + filePath);
                    return;
                }

                emitProgress("Preprocessing audio…", 20);

                short[] samples = decodePcm16FromWav(wavBytes);
                samples = removeDcOffset(samples);
                samples = normalisePcm(samples);

                emitProgress("Encoding…", 40);

                String b64 = encodePcmToBase64Wav(samples, RECORDING_SR);

                emitProgress("Sending to separation server…", 55);

                sendToCustomApi(b64, RECORDING_SR, promise);

            } catch (Exception e) {
                Log.e(TAG, "processAndSendRecording error", e);
                emitSepError(e.getMessage());
                promise.reject("PROCESS_ERROR", e.getMessage());
            }
        });
    }

    /**
     * Also callable directly from JS (e.g. PreviousRecordingsScreen already has base64).
     *
     * JS usage:
     *   const r = await StethoscopeRecorder.sendToCustomApi(b64Audio, 44100);
     */
    @ReactMethod
    public void sendToCustomApi(final String base64Audio, final int sr, final Promise promise) {
        try {
            JSONObject body = new JSONObject();
            body.put("audio",       base64Audio);
            body.put("sample_rate", sr);

            RequestBody reqBody = RequestBody.create(
                    body.toString(),
                    MediaType.parse("application/json; charset=utf-8"));

            Request req = new Request.Builder()
                    .url(PROCESS_URL)
                    .post(reqBody)
                    .addHeader("Content-Type", "application/json")
                    .build();

            Log.i(TAG, "POST " + PROCESS_URL + " payload=" + base64Audio.length() + " chars");

            http.newCall(req).enqueue(new Callback() {

                @Override
                public void onFailure(@NonNull Call call, @NonNull IOException e) {
                    Log.e(TAG, "HTTP failure", e);
                    emitSepError("Network error: " + e.getMessage());
                    promise.reject("NETWORK_ERROR", "Cannot reach server: " + e.getMessage());
                }

                @Override
                public void onResponse(@NonNull Call call, @NonNull Response response) {
                    try {
                        String bodyStr = response.body() != null ? response.body().string() : "";
                        if (!response.isSuccessful()) {
                            emitSepError("Server error " + response.code());
                            promise.reject("SERVER_ERROR", "HTTP " + response.code() + ": " + bodyStr);
                            return;
                        }

                        JSONObject json   = new JSONObject(bodyStr);
                        String     status = json.optString("status", "unknown");

                        if (!"success".equals(status)) {
                            String errMsg = json.optString("error", "Unknown API error");
                            emitSepError(errMsg);
                            promise.reject("API_ERROR", errMsg);
                            return;
                        }

                        String heartB64  = json.getString("heart");
                        String lungB64   = json.getString("lung");
                        double noiseLevel    = json.optDouble("noise_level",    0.0);
                        double signalQuality = json.optDouble("signal_quality", 1.0);
                        double processingMs  = json.optDouble("processing_ms",  0.0);

                        // Decode server WAV → raw PCM bytes for AudioTrack playback
                        byte[] heartPcm = decodeBase64WavToPcmBytes(heartB64);
                        byte[] lungPcm  = decodeBase64WavToPcmBytes(lungB64);

                        WritableMap result = Arguments.createMap();
                        result.putString("heart",         Base64.encodeToString(heartPcm, Base64.NO_WRAP));
                        result.putString("lung",          Base64.encodeToString(lungPcm,  Base64.NO_WRAP));
                        result.putString("heartWav",      heartB64);  // full WAV for saving
                        result.putString("lungWav",       lungB64);
                        result.putDouble("noiseLevel",    noiseLevel);
                        result.putDouble("signalQuality", signalQuality);
                        result.putDouble("processingMs",  processingMs);
                        result.putInt("heartSamples",     heartPcm.length / 2);
                        result.putInt("lungSamples",      lungPcm.length  / 2);
                        result.putString("status",        "success");

                        Log.i(TAG, String.format(
                                "Separation OK  heart=%dB lung=%dB quality=%.2f noise=%.2f ms=%.0f",
                                heartPcm.length, lungPcm.length,
                                signalQuality, noiseLevel, processingMs));

                        emitProgress("Done", 100);
                        sendEvent(EVT_SEP_DONE, result);
                        promise.resolve(result);

                    } catch (Exception e) {
                        Log.e(TAG, "Parse error", e);
                        emitSepError("Response parse error: " + e.getMessage());
                        promise.reject("PARSE_ERROR", e.getMessage());
                    }
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "sendToCustomApi error", e);
            promise.reject("REQUEST_ERROR", e.getMessage());
        }
    }

    private void emitProgress(String msg, int pct) {
        WritableMap m = Arguments.createMap();
        m.putString("message", msg); m.putInt("percent", pct);
        sendEvent(EVT_SEP_PROGRESS, m);
    }

    private void emitSepError(String msg) {
        WritableMap m = Arguments.createMap();
        m.putString("message", msg);
        sendEvent(EVT_SEP_ERROR, m);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Audio preprocessing helpers
    // ═════════════════════════════════════════════════════════════════════════

    private short[] removeDcOffset(short[] s) {
        if (s.length == 0) return s;
        long sum = 0;
        for (short v : s) sum += v;
        int mean = (int) (sum / s.length);
        short[] out = new short[s.length];
        for (int i = 0; i < s.length; i++) {
            int v = s[i] - mean;
            out[i] = (short) Math.max(Short.MIN_VALUE, Math.min(Short.MAX_VALUE, v));
        }
        return out;
    }

    private short[] normalisePcm(short[] s) {
        int peak = 1;
        for (short v : s) { int a = Math.abs(v); if (a > peak) peak = a; }
        if (peak < 200) return s; // essentially silent
        float scale = 32767.0f * 0.9f / peak;
        short[] out = new short[s.length];
        for (int i = 0; i < s.length; i++) {
            out[i] = (short) Math.max(Short.MIN_VALUE,
                    Math.min(Short.MAX_VALUE, Math.round(s[i] * scale)));
        }
        return out;
    }

    /** Optional IIR bandpass — not called by default (NMF handles freq separation). */
    @SuppressWarnings("unused")
    private short[] bandpassFilter(short[] s, int sr, float lo, float hi) {
        double lowW = Math.tan(Math.PI * lo / sr);
        double hiW  = Math.tan(Math.PI * hi / sr);
        double bw   = hiW - lowW;
        double wc   = Math.sqrt(lowW * hiW);
        double a0   = 1 + bw + wc * wc;
        double b0 = bw / a0, b2 = -bw / a0;
        double a1 = 2 * (wc * wc - 1) / a0, a2 = (1 - bw + wc * wc) / a0;
        short[] out = new short[s.length];
        double z1 = 0, z2 = 0;
        for (int i = 0; i < s.length; i++) {
            double x = s[i], y = b0 * x + z1;
            z1 = -a1 * y + z2; z2 = b2 * x - a2 * y;
            out[i] = (short) Math.max(Short.MIN_VALUE,
                    Math.min(Short.MAX_VALUE, Math.round(y)));
        }
        return out;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  PCM ↔ WAV ↔ base64
    // ═════════════════════════════════════════════════════════════════════════

    private byte[] readFileBytes(String path) throws IOException {
        File f = new File(path);
        if (!f.exists()) throw new IOException("Not found: " + path);
        byte[] buf = new byte[(int) f.length()];
        try (FileInputStream fis = new FileInputStream(f)) {
            int r = 0;
            while (r < buf.length) {
                int n = fis.read(buf, r, buf.length - r);
                if (n < 0) break;
                r += n;
            }
        }
        return buf;
    }

    private short[] decodePcm16FromWav(byte[] wav) {
        if (wav.length >= 4 &&
                wav[0] == 'R' && wav[1] == 'I' && wav[2] == 'F' && wav[3] == 'F') {
            int off = 44;
            for (int i = 12; i < wav.length - 8; i++) {
                if (wav[i] == 'd' && wav[i+1] == 'a' && wav[i+2] == 't' && wav[i+3] == 'a') {
                    off = i + 8; break;
                }
            }
            int len = wav.length - off;
            if (len <= 0) return new short[0];
            byte[] pcm = new byte[len];
            System.arraycopy(wav, off, pcm, 0, len);
            return bytesToShorts(pcm);
        }
        return bytesToShorts(wav);
    }

    private short[] bytesToShorts(byte[] b) {
        int n = b.length / 2;
        short[] s = new short[n];
        ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(s);
        return s;
    }

    private String encodePcmToBase64Wav(short[] samples, int sr) {
        byte[] pcm = new byte[samples.length * 2];
        ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(samples);
        int dl = pcm.length, br = sr * 2;
        ByteBuffer h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        h.put(new byte[]{'R','I','F','F'}); h.putInt(36 + dl);
        h.put(new byte[]{'W','A','V','E'});
        h.put(new byte[]{'f','m','t',' '}); h.putInt(16);
        h.putShort((short)1); h.putShort((short)1);
        h.putInt(sr); h.putInt(br); h.putShort((short)2); h.putShort((short)16);
        h.put(new byte[]{'d','a','t','a'}); h.putInt(dl);
        byte[] wav = new byte[44 + dl];
        System.arraycopy(h.array(), 0, wav, 0, 44);
        System.arraycopy(pcm, 0, wav, 44, dl);
        return Base64.encodeToString(wav, Base64.NO_WRAP);
    }

    private byte[] decodeBase64WavToPcmBytes(String b64Wav) {
        byte[] wav = Base64.decode(b64Wav, Base64.DEFAULT);
        short[] s  = decodePcm16FromWav(wav);
        byte[] pcm = new byte[s.length * 2];
        ByteBuffer.wrap(pcm).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().put(s);
        return pcm;
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Bluetooth + Recording — IDENTICAL to original
    // ═════════════════════════════════════════════════════════════════════════

    private void initializeBluetooth() {
        try {
            BluetoothManager bm = (BluetoothManager)
                    reactContext.getSystemService(Context.BLUETOOTH_SERVICE);
            if (bm != null) bluetoothAdapter = bm.getAdapter();
            audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);

            bluetoothReceiver = new BroadcastReceiver() {
                @Override public void onReceive(Context ctx, Intent intent) {
                    String action = intent.getAction();
                    if (BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED.equals(action)) {
                        int state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1);
                        int prev  = intent.getIntExtra(BluetoothProfile.EXTRA_PREVIOUS_STATE, -1);
                        WritableMap p = Arguments.createMap();
                        p.putInt("state", state); p.putInt("previousState", prev);
                        p.putBoolean("isConnected", state == BluetoothProfile.STATE_CONNECTED);
                        sendEvent(EVENT_BLUETOOTH_STATE, p);
                    } else if (AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED.equals(action)) {
                        int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1);
                        if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                            isScoConnected = true; sendEvent(EVENT_AUDIO_READY, true);
                        } else if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
                            boolean was = isScoConnected; isScoConnected = false;
                            if (isRecording) {
                                sendError("SCO_LOST", "Bluetooth audio lost during recording");
                                if (audioRecorder != null) { audioRecorder.stopRecording(); isRecording = false; }
                            } else if (scoConnectionRequested && was) {
                                handler.postDelayed(
                                        StethoscopeRecorderModule.this::maintainScoConnection, 500);
                            }
                        }
                    } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                        if (intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_OFF)
                            sendError("BLUETOOTH_OFF", "Bluetooth turned off");
                    }
                }
            };
            IntentFilter f = new IntentFilter();
            f.addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED);
            f.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
            f.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
            reactContext.registerReceiver(bluetoothReceiver, f);
            Log.d(TAG, "StethoscopeRecorderModule initialised");
        } catch (Exception e) {
            Log.e(TAG, "Bluetooth init error", e);
            sendError("INIT_ERROR", e.getMessage() != null ? e.getMessage() : "Unknown");
        }
    }

    @ReactMethod public void isBluetoothEnabled(Promise p) {
        try { p.resolve(bluetoothAdapter != null && bluetoothAdapter.isEnabled()); }
        catch (Exception e) { p.reject("ERROR", e.getMessage()); }
    }

    @ReactMethod public void getPairedDevices(Promise promise) {
        try {
            if (bluetoothAdapter == null) { promise.resolve(Arguments.createArray()); return; }
            Set<BluetoothDevice> paired = bluetoothAdapter.getBondedDevices();
            WritableArray list = Arguments.createArray();
            if (paired != null) {
                for (BluetoothDevice d : paired) {
                    WritableMap m = Arguments.createMap();
                    m.putString("name", d.getName() != null ? d.getName() : "Unknown");
                    m.putString("address", d.getAddress());
                    m.putInt("bondState", d.getBondState()); m.putInt("type", d.getType());
                    BluetoothClass bc = d.getBluetoothClass();
                    m.putBoolean("isAudioDevice", bc != null && bc.hasService(BluetoothClass.Service.AUDIO));
                    list.pushMap(m);
                }
            }
            promise.resolve(list);
        } catch (SecurityException e) { promise.reject("PERMISSION_ERROR", "Bluetooth permissions not granted"); }
        catch (Exception e)           { promise.reject("ERROR", e.getMessage()); }
    }

    @ReactMethod public void connectToDevice(String address, final Promise promise) {
        try {
            currentDevice = bluetoothAdapter.getRemoteDevice(address);
            bluetoothAdapter.getProfileProxy(reactContext, new BluetoothProfile.ServiceListener() {
                @Override public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    if (profile != BluetoothProfile.A2DP) return;
                    bluetoothA2dp = (BluetoothA2dp) proxy;
                    try {
                        Method m = BluetoothA2dp.class.getDeclaredMethod("connect", BluetoothDevice.class);
                        m.setAccessible(true);
                        if ((boolean) m.invoke(bluetoothA2dp, currentDevice)) {
                            handler.postDelayed(StethoscopeRecorderModule.this::startBluetoothSco, 2000);
                            promise.resolve(true);
                        } else { promise.reject("CONNECT_FAILED", "Connection failed"); }
                    } catch (Exception e) { promise.reject("CONNECT_ERROR", e.getMessage()); }
                }
                @Override public void onServiceDisconnected(int p) { bluetoothA2dp = null; }
            }, BluetoothProfile.A2DP);
        } catch (SecurityException e) { promise.reject("PERMISSION_ERROR", "Bluetooth permissions not granted"); }
        catch (Exception e)           { promise.reject("ERROR", e.getMessage()); }
    }

    @ReactMethod public void startBluetoothSco() {
        try {
            if (audioManager == null) return;
            scoConnectionRequested = true;
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "StethRecorder:WakeLock");
                wakeLock.acquire(10 * 60 * 1000L);
            }
            audioFocusListener = fc -> Log.d(TAG, "Audio focus: " + fc);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(new android.media.AudioAttributes.Builder()
                                .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                                .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH).build())
                        .setOnAudioFocusChangeListener(audioFocusListener, handler).build();
                audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                //noinspection deprecation
                audioManager.requestAudioFocus(audioFocusListener,
                        AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN);
            }
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            audioManager.setSpeakerphoneOn(true);
            audioManager.startBluetoothSco();
            audioManager.setBluetoothScoOn(true);
            startAudioModeMaintenance();
        } catch (Exception e) { sendError("SCO_ERROR", e.getMessage()); }
    }

    private void startAudioModeMaintenance() {
        if (maintenanceHandler == null) maintenanceHandler = new Handler(Looper.getMainLooper());
        maintenanceRunnable = new Runnable() {
            @Override public void run() {
                if (!scoConnectionRequested) return;
                if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION)
                    audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                if (!audioManager.isBluetoothScoOn())
                    audioManager.setBluetoothScoOn(true);
                maintenanceHandler.postDelayed(this, 500);
            }
        };
        maintenanceHandler.post(maintenanceRunnable);
    }

    private void maintainScoConnection() {
        if (!scoConnectionRequested) return;
        if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION)
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        if (!audioManager.isBluetoothScoOn()) audioManager.setBluetoothScoOn(true);
        if (!isScoConnected) audioManager.startBluetoothSco();
    }

    @ReactMethod public void stopBluetoothSco() {
        try {
            scoConnectionRequested = false; isScoConnected = false;
            if (maintenanceHandler != null && maintenanceRunnable != null)
                maintenanceHandler.removeCallbacks(maintenanceRunnable);
            if (audioManager != null) {
                audioManager.stopBluetoothSco();
                audioManager.setBluetoothScoOn(false);
                audioManager.setMode(AudioManager.MODE_NORMAL);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest(audioFocusRequest); audioFocusRequest = null;
                } else if (audioFocusListener != null) {
                    //noinspection deprecation
                    audioManager.abandonAudioFocus(audioFocusListener);
                }
                audioFocusListener = null;
            }
            if (wakeLock != null && wakeLock.isHeld()) { wakeLock.release(); wakeLock = null; }
        } catch (Exception e) { Log.e(TAG, "stopBluetoothSco error", e); }
    }

    @ReactMethod public void startRecording(@Nullable String filename, final Promise promise) {
        new Thread(() -> {
            try {
                if (isRecording) { promise.reject("ALREADY_RECORDING", "Already recording"); return; }
                for (int i = 1; i <= 10; i++) {
                    if (isScoConnected && audioManager.isBluetoothScoOn()) break;
                    if (i == 10) { promise.reject("SCO_NOT_READY", "SCO not connected"); return; }
                    if (scoConnectionRequested && !isScoConnected)
                        handler.post(this::maintainScoConnection);
                    Thread.sleep(500);
                }
                if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                    audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    Thread.sleep(200);
                }
                File dir = new File(reactContext.getFilesDir(), "recordings");
                if (!dir.exists()) dir.mkdirs();
                String ts = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault()).format(new Date());
                String fn = filename != null ? filename : "steth_" + ts + ".wav";
                File file = new File(dir, fn);
                recordingFilePath = file.getAbsolutePath();

                audioRecorder = new BluetoothAudioRecorder(recordingFilePath, audioManager);
                audioRecorder.setOnAmplitudeListener(amp -> {
                    if (!isScoConnected) {
                        if (audioRecorder != null) { audioRecorder.stopRecording(); isRecording = false; }
                        sendError("SCO_DISCONNECTED", "SCO disconnected during recording");
                        return;
                    }
                    sendEvent(EVENT_AMPLITUDE, amp);
                    WritableMap sm = Arguments.createMap();
                    sm.putBoolean("isRecording", audioRecorder.isRecording());
                    sm.putBoolean("isPaused",    audioRecorder.isPaused());
                    sendEvent(EVENT_RECORDING_STATE, sm);
                });
                audioRecorder.startRecording();
                isRecording = true;

                WritableMap r = Arguments.createMap();
                r.putString("filePath",  recordingFilePath);
                r.putString("fileName",  fn);
                r.putDouble("timestamp", System.currentTimeMillis());
                promise.resolve(r);
            } catch (Exception e) { promise.reject("RECORDING_ERROR", e.getMessage()); }
        }).start();
    }

    @ReactMethod public void stopRecording(Promise promise) {
        try {
            if (!isRecording) { promise.reject("NOT_RECORDING", "Not recording"); return; }
            if (audioRecorder != null) audioRecorder.stopRecording();
            long sz = recordingFilePath != null ? new File(recordingFilePath).length() : 0;
            isRecording = false;
            WritableMap r = Arguments.createMap();
            r.putString("filePath",  recordingFilePath);
            r.putDouble("fileSize",  sz);
            r.putDouble("timestamp", System.currentTimeMillis());
            promise.resolve(r);
            audioRecorder = null; recordingFilePath = null;
        } catch (Exception e) { promise.reject("STOP_ERROR", e.getMessage()); }
    }

    @ReactMethod public void pauseRecording(Promise p) {
        try { if (audioRecorder != null) audioRecorder.pauseRecording(); p.resolve(true); }
        catch (Exception e) { p.reject("PAUSE_ERROR", e.getMessage()); }
    }

    @ReactMethod public void resumeRecording(Promise p) {
        try { if (audioRecorder != null) audioRecorder.resumeRecording(); p.resolve(true); }
        catch (Exception e) { p.reject("RESUME_ERROR", e.getMessage()); }
    }

    @ReactMethod public void disconnectDevice(Promise promise) {
        try {
            stopBluetoothSco();
            if (bluetoothA2dp != null && currentDevice != null) {
                try {
                    Method m = BluetoothA2dp.class.getDeclaredMethod("disconnect", BluetoothDevice.class);
                    m.setAccessible(true); m.invoke(bluetoothA2dp, currentDevice);
                } catch (Exception ignored) {}
            }
            if (bluetoothAdapter != null && bluetoothA2dp != null)
                bluetoothAdapter.closeProfileProxy(BluetoothProfile.A2DP, bluetoothA2dp);
            bluetoothA2dp = null; currentDevice = null;
            promise.resolve(true);
        } catch (Exception e) { promise.reject("DISCONNECT_ERROR", e.getMessage()); }
    }

    @ReactMethod public void getRecordings(Promise promise) {
        try {
            File dir = new File(reactContext.getFilesDir(), "recordings");
            WritableArray list = Arguments.createArray();
            if (dir.exists()) {
                File[] files = dir.listFiles();
                if (files != null) {
                    java.util.Arrays.sort(files, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                    for (File f : files) {
                        if (!f.getName().endsWith(".wav")) continue;
                        WritableMap m = Arguments.createMap();
                        m.putString("fileName",  f.getName());
                        m.putString("filePath",  f.getAbsolutePath());
                        m.putDouble("fileSize",  f.length());
                        m.putDouble("timestamp", f.lastModified());
                        m.putString("date", new SimpleDateFormat("MMM dd, yyyy HH:mm",
                                Locale.getDefault()).format(new Date(f.lastModified())));
                        list.pushMap(m);
                    }
                }
            }
            promise.resolve(list);
        } catch (Exception e) { promise.reject("GET_RECORDINGS_ERROR", e.getMessage()); }
    }

    @ReactMethod public void deleteRecording(String path, Promise p) {
        try {
            File f = new File(path);
            if (f.exists() && f.delete()) p.resolve(true);
            else p.reject("DELETE_ERROR", "Not found or cannot delete");
        } catch (Exception e) { p.reject("DELETE_ERROR", e.getMessage()); }
    }

    @ReactMethod public void verifyBluetoothAudioActive(Promise p) {
        try {
            WritableMap m = Arguments.createMap();
            m.putBoolean("bluetoothScoOn",  audioManager.isBluetoothScoOn());
            m.putBoolean("bluetoothA2dpOn", audioManager.isBluetoothA2dpOn());
            m.putInt("audioMode",           audioManager.getMode());
            m.putBoolean("speakerphoneOn",  audioManager.isSpeakerphoneOn());
            m.putBoolean("scoConnected",    isScoConnected);
            m.putBoolean("readyToRecord",   isScoConnected &&
                    audioManager.getMode() == AudioManager.MODE_IN_COMMUNICATION);
            p.resolve(m);
        } catch (Exception e) { p.reject("ERROR", e.getMessage()); }
    }

    private void sendEvent(String name, Object data) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(name, data);
    }

    private void sendError(String code, String msg) {
        WritableMap m = Arguments.createMap();
        m.putString("code", code); m.putString("message", msg);
        sendEvent(EVENT_ERROR, m);
    }

    @Override public void invalidate() {
        super.invalidate();
        try {
            bgExec.shutdownNow();
            if (audioRecorder != null) audioRecorder.stopRecording();
            stopBluetoothSco();
            if (bluetoothReceiver != null) reactContext.unregisterReceiver(bluetoothReceiver);
        } catch (Exception e) { Log.e(TAG, "Cleanup error", e); }
    }

    @ReactMethod public void addListener(String n) {}
    @ReactMethod public void removeListeners(Integer c) {}
}