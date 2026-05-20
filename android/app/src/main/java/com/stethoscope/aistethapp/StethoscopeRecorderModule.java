package com.stethoscope.aistethapp;

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

import java.io.File;
import java.lang.reflect.Method;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.Set;

public class StethoscopeRecorderModule extends ReactContextBaseJavaModule {

    private static final String TAG = "StethoscopeRecorder";
    private static final String EVENT_BLUETOOTH_STATE = "onBluetoothStateChange";
    private static final String EVENT_AUDIO_READY = "onAudioRouteReady";
    private static final String EVENT_AMPLITUDE = "onAmplitude";
    private static final String EVENT_RECORDING_STATE = "onRecordingStateChange";
    private static final String EVENT_ERROR = "onError";

    private final ReactApplicationContext reactContext;
    private BluetoothAdapter bluetoothAdapter;
    private AudioManager audioManager;
    private BluetoothAudioRecorder audioRecorder;
    private BluetoothDevice currentDevice;
    private BluetoothA2dp bluetoothA2dp;
    private Handler handler;
    private boolean isRecording = false;
    private String recordingFilePath;
    private BroadcastReceiver bluetoothReceiver;

    // Track SCO state
    private boolean isScoConnected = false;
    private boolean scoConnectionRequested = false;

    private Handler maintenanceHandler;
    private Runnable maintenanceRunnable;
    private PowerManager.WakeLock wakeLock;
    private AudioFocusRequest audioFocusRequest; // For Android O+
    private AudioManager.OnAudioFocusChangeListener audioFocusListener;

    public StethoscopeRecorderModule(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
        this.handler = new Handler(Looper.getMainLooper());
        initializeBluetooth();
    }

    @NonNull
    @Override
    public String getName() {
        return "StethoscopeRecorder";
    }

    private void initializeBluetooth() {
        try {
            BluetoothManager bluetoothManager = (BluetoothManager) reactContext
                    .getSystemService(Context.BLUETOOTH_SERVICE);
            if (bluetoothManager != null) {
                bluetoothAdapter = bluetoothManager.getAdapter();
            }

            audioManager = (AudioManager) reactContext.getSystemService(Context.AUDIO_SERVICE);

            // Register Bluetooth receivers
            bluetoothReceiver = new BroadcastReceiver() {
                @Override
                public void onReceive(Context context, Intent intent) {
                    String action = intent.getAction();
                    if (BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED.equals(action)) {
                        int state = intent.getIntExtra(BluetoothProfile.EXTRA_STATE, -1);
                        int prevState = intent.getIntExtra(BluetoothProfile.EXTRA_PREVIOUS_STATE, -1);
                        Log.d(TAG, "Bluetooth state changed: " + prevState + " -> " + state);

                        WritableMap params = Arguments.createMap();
                        params.putInt("state", state);
                        params.putInt("previousState", prevState);
                        params.putBoolean("isConnected", state == BluetoothProfile.STATE_CONNECTED);
                        sendEvent(EVENT_BLUETOOTH_STATE, params);

                    } else if (AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED.equals(action)) {
                        int state = intent.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, -1);
                        Log.d(TAG, "SCO audio state changed: " + state);

                        if (state == AudioManager.SCO_AUDIO_STATE_CONNECTED) {
                            isScoConnected = true;
                            Log.d(TAG, " SCO audio connected - READY TO RECORD");
                            sendEvent(EVENT_AUDIO_READY, true);

                        } else if (state == AudioManager.SCO_AUDIO_STATE_DISCONNECTED) {
                            // FIXED: Capture wasConnected BEFORE updating isScoConnected
                            boolean wasConnected = isScoConnected;
                            isScoConnected = false;
                            Log.w(TAG, "SCO audio disconnected");

                            // If recording is active, this is an ERROR
                            if (isRecording) {
                                Log.e(TAG, " CRITICAL: SCO disconnected during active recording!");
                                sendError("SCO_LOST", "Bluetooth audio connection lost during recording");

                                // Stop recording immediately
                                if (audioRecorder != null) {
                                    audioRecorder.stopRecording();
                                    isRecording = false;
                                }
                            }
                            // CRITICAL: If we need SCO but it disconnected, restart it
                            else if (scoConnectionRequested && wasConnected && !isRecording) {
                                Log.w(TAG, "SCO disconnected unexpectedly, restarting...");
                                handler.postDelayed(new Runnable() {
                                    @Override
                                    public void run() {
                                        maintainScoConnection();
                                    }
                                }, 500);
                            }
                        }

                    } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                        int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1);
                        if (state == BluetoothAdapter.STATE_OFF) {
                            sendError("BLUETOOTH_OFF", "Bluetooth is turned off");
                        }
                    }
                }
            };

            IntentFilter filter = new IntentFilter();
            filter.addAction(BluetoothA2dp.ACTION_CONNECTION_STATE_CHANGED);
            filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);
            filter.addAction(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED);
            reactContext.registerReceiver(bluetoothReceiver, filter);

            Log.d(TAG, "StethoscopeRecorderModule initialized successfully");

        } catch (Exception e) {
            Log.e(TAG, "Initialization error: " + e.getMessage());
            sendError("INIT_ERROR", e.getMessage() != null ? e.getMessage() : "Unknown initialization error");
        }
    }

    @ReactMethod
    public void isBluetoothEnabled(Promise promise) {
        try {
            boolean enabled = bluetoothAdapter != null && bluetoothAdapter.isEnabled();
            promise.resolve(enabled);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getPairedDevices(Promise promise) {
        try {
            if (bluetoothAdapter == null) {
                promise.resolve(Arguments.createArray());
                return;
            }

            Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
            WritableArray devicesList = Arguments.createArray();

            if (pairedDevices != null) {
                for (BluetoothDevice device : pairedDevices) {
                    WritableMap deviceInfo = Arguments.createMap();
                    deviceInfo.putString("name", device.getName() != null ? device.getName() : "Unknown Device");
                    deviceInfo.putString("address", device.getAddress());
                    deviceInfo.putInt("bondState", device.getBondState());
                    deviceInfo.putInt("type", device.getType());

                    // Check if it's an audio device
                    boolean isAudioDevice = false;
                    BluetoothClass bluetoothClass = device.getBluetoothClass();
                    if (bluetoothClass != null) {
                        isAudioDevice = bluetoothClass.hasService(BluetoothClass.Service.AUDIO);
                    }

                    deviceInfo.putBoolean("isAudioDevice", isAudioDevice);
                    devicesList.pushMap(deviceInfo);
                }
            }

            Log.d(TAG, "Found " + devicesList.size() + " paired devices");
            promise.resolve(devicesList);

        } catch (SecurityException e) {
            promise.reject("PERMISSION_ERROR", "Bluetooth permissions not granted");
        } catch (Exception e) {
            Log.e(TAG, "Get paired devices error: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void connectToDevice(String deviceAddress, final Promise promise) {
        try {
            currentDevice = bluetoothAdapter.getRemoteDevice(deviceAddress);
            if (currentDevice == null) {
                promise.reject("DEVICE_NOT_FOUND", "Device with address " + deviceAddress + " not found");
                return;
            }

            Log.d(TAG, "Attempting to connect to: " + currentDevice.getName() + " (" + deviceAddress + ")");

            bluetoothAdapter.getProfileProxy(reactContext, new BluetoothProfile.ServiceListener() {
                @Override
                public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    if (profile == BluetoothProfile.A2DP) {
                        bluetoothA2dp = (BluetoothA2dp) proxy;
                        try {
                            // Use reflection to access hidden connect method
                            Method connectMethod = BluetoothA2dp.class
                                    .getDeclaredMethod("connect", BluetoothDevice.class);
                            connectMethod.setAccessible(true);
                            boolean result = (boolean) connectMethod.invoke(bluetoothA2dp, currentDevice);

                            if (result) {
                                Log.d(TAG, "Connection initiated successfully");

                                // Wait for connection to establish, then start SCO
                                handler.postDelayed(new Runnable() {
                                    @Override
                                    public void run() {
                                        startBluetoothSco();
                                    }
                                }, 2000);

                                promise.resolve(true);
                            } else {
                                promise.reject("CONNECT_FAILED", "Failed to initiate connection");
                            }

                        } catch (Exception e) {
                            Log.e(TAG, "Connection error: " + e.getMessage());
                            promise.reject("CONNECT_ERROR", e.getMessage());
                        }
                    }
                }

                @Override
                public void onServiceDisconnected(int profile) {
                    Log.d(TAG, "A2DP service disconnected");
                    bluetoothA2dp = null;
                }
            }, BluetoothProfile.A2DP);

        } catch (SecurityException e) {
            promise.reject("PERMISSION_ERROR", "Bluetooth permissions not granted");
        } catch (Exception e) {
            Log.e(TAG, "Connect error: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void startBluetoothSco() {
        try {
            if (audioManager != null) {
                scoConnectionRequested = true;

                // CRITICAL 1: Acquire wake lock FIRST
                if (wakeLock == null) {
                    PowerManager powerManager = (PowerManager) reactContext.getSystemService(Context.POWER_SERVICE);
                    wakeLock = powerManager.newWakeLock(
                            PowerManager.PARTIAL_WAKE_LOCK,
                            "StethoscopeRecorder:WakeLock"
                    );
                    wakeLock.acquire(10 * 60 * 1000L); // 10 minutes max
                    Log.d(TAG, "Wake lock acquired");
                }

                // CRITICAL 2: Request persistent audio focus BEFORE setting mode
                audioFocusListener = new AudioManager.OnAudioFocusChangeListener() {
                    @Override
                    public void onAudioFocusChange(int focusChange) {
                        Log.d(TAG, "Audio focus changed: " + focusChange);
                        if (focusChange == AudioManager.AUDIOFOCUS_LOSS) {
                            Log.w(TAG, " Audio focus lost!");
                            if (isRecording) {
                                sendError("AUDIO_FOCUS_LOST", "Audio focus lost during recording");
                            }
                        }
                    }
                };

                int focusResult;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                            .setAudioAttributes(
                                    new android.media.AudioAttributes.Builder()
                                            .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                                            .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                                            .build()
                            )
                            .setOnAudioFocusChangeListener(audioFocusListener, handler)
                            .setAcceptsDelayedFocusGain(false)
                            .setWillPauseWhenDucked(false)
                            .build();
                    focusResult = audioManager.requestAudioFocus(audioFocusRequest);
                } else {
                    focusResult = audioManager.requestAudioFocus(
                            audioFocusListener,
                            AudioManager.STREAM_VOICE_CALL,
                            AudioManager.AUDIOFOCUS_GAIN
                    );
                }

                if (focusResult != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                    Log.e(TAG, "Failed to gain audio focus!");
                    sendError("AUDIO_FOCUS_DENIED", "Could not gain audio focus");
                    return;
                }
                Log.d(TAG, " Audio focus gained");

                // CRITICAL 3: Set audio mode
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                Log.d(TAG, "Audio mode: MODE_IN_COMMUNICATION");

                // CRITICAL 5: Pre-configure speakerphone (don't set it again later!)
                audioManager.setSpeakerphoneOn(true);
                Log.d(TAG, " Speakerphone pre-configured");

                // CRITICAL 4: Start SCO
                audioManager.startBluetoothSco();
                audioManager.setBluetoothScoOn(true);


                Log.d(TAG, " Bluetooth SCO start requested");

                // Start MORE AGGRESSIVE maintenance
                startAudioModeMaintenance();
            }
        } catch (Exception e) {
            Log.e(TAG, "SCO start error: " + e.getMessage());
            sendError("SCO_ERROR", e.getMessage() != null ? e.getMessage() : "Failed to start SCO");
        }
    }

    // NEW: Maintain audio mode continuously
    private void startAudioModeMaintenance() {
        if (maintenanceHandler == null) {
            maintenanceHandler = new Handler(Looper.getMainLooper());
        }

        maintenanceRunnable = new Runnable() {
            @Override
            public void run() {
                if (scoConnectionRequested) {
                    int currentMode = audioManager.getMode();
                    boolean scoOn = audioManager.isBluetoothScoOn();

                    // If mode reverted to NORMAL, fix it IMMEDIATELY
                    if (currentMode != AudioManager.MODE_IN_COMMUNICATION) {
//                        Log.w(TAG, "Audio mode reverted to " + currentMode + ", restoring to IN_COMMUNICATION");
                        audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    }

                    // If SCO flag turned off, fix it
                    if (!scoOn) {
                        Log.w(TAG, "SCO flag turned off, restoring");
                        audioManager.setBluetoothScoOn(true);
                    }

                    // CRITICAL: Check more frequently (500ms instead of 1s)
                    maintenanceHandler.postDelayed(this, 500);
                }
            }
        };

        // Start checking immediately
        maintenanceHandler.post(maintenanceRunnable);
        Log.d(TAG, " Audio mode maintenance started (500ms intervals)");
    }

    // NEW: Stop maintenance
    private void stopAudioModeMaintenance() {
        if (maintenanceHandler != null && maintenanceRunnable != null) {
            maintenanceHandler.removeCallbacks(maintenanceRunnable);
            Log.d(TAG, " Audio mode maintenance stopped");
        }
    }


    // Method to maintain SCO connection
    private void maintainScoConnection() {
        if (!scoConnectionRequested) {
            return;
        }

        int audioMode = audioManager.getMode();
        boolean scoOn = audioManager.isBluetoothScoOn();

        Log.d(TAG, "Maintaining SCO - Mode: " + audioMode + ", SCO flag: " + scoOn + ", Connected: " + isScoConnected);

        // If mode reverted to NORMAL, fix it
        if (audioMode != AudioManager.MODE_IN_COMMUNICATION) {
            Log.w(TAG, "Audio mode reverted to NORMAL, fixing...");
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
        }

        // If SCO flag is off, turn it back on
        if (!scoOn) {
            Log.w(TAG, "SCO flag turned off, fixing...");
            audioManager.setBluetoothScoOn(true);
        }

        // If not connected, restart SCO
        if (!isScoConnected) {
            Log.w(TAG, "SCO not connected, restarting...");
            audioManager.startBluetoothSco();
        }
    }

    @ReactMethod
    public void stopBluetoothSco() {
        try {
            scoConnectionRequested = false;
            isScoConnected = false;

            // Stop maintenance first
            stopAudioModeMaintenance();

            if (audioManager != null) {
                audioManager.stopBluetoothSco();
                audioManager.setBluetoothScoOn(false);
                audioManager.setMode(AudioManager.MODE_NORMAL);

                // Release audio focus
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                    audioManager.abandonAudioFocusRequest(audioFocusRequest);
                    audioFocusRequest = null;
                } else if (audioFocusListener != null) {
                    audioManager.abandonAudioFocus(audioFocusListener);
                }
                audioFocusListener = null;
                Log.d(TAG, "Audio focus released");
            }

            // Release wake lock
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "🔒 Wake lock released");
            }

            Log.d(TAG, "Bluetooth SCO stopped");
        } catch (Exception e) {
            Log.e(TAG, "SCO stop error: " + e.getMessage());
        }
    }


    @ReactMethod
    public void startRecording(@Nullable String filename, final Promise promise) {
        // Run on a background thread to allow waiting
        new Thread(() -> {
            try {
                if (isRecording) {
                    promise.reject("ALREADY_RECORDING", "Recording is already in progress");
                    return;
                }

                Log.d(TAG, "=== Pre-recording SCO check ===");

                //  FIX: Retry up to 10 times (5 seconds total) waiting for SCO
                int maxRetries = 10;
                int retryDelayMs = 500;

                for (int attempt = 1; attempt <= maxRetries; attempt++) {
                    boolean scoReady = isScoConnected && audioManager.isBluetoothScoOn();
                    Log.d(TAG, String.format("SCO check attempt %d/%d | Connected: %b | Flag: %b | Mode: %d",
                            attempt, maxRetries, isScoConnected,
                            audioManager.isBluetoothScoOn(), audioManager.getMode()));

                    if (scoReady) {
                        Log.d(TAG, " SCO ready on attempt " + attempt);
                        break; // SCO is ready, proceed
                    }

                    if (attempt == maxRetries) {
                        Log.e(TAG, " SCO NOT CONNECTED after " + maxRetries + " attempts");
                        promise.reject("SCO_NOT_READY",
                                "Bluetooth SCO audio not connected after waiting. Please reconnect.");
                        return;
                    }

                    // If SCO is not connected but was requested, trigger reconnect
                    if (scoConnectionRequested && !isScoConnected) {
                        Log.w(TAG, "SCO requested but not connected, forcing restart (attempt " + attempt + ")");
                        handler.post(() -> maintainScoConnection());
                    }

                    Log.d(TAG, " Waiting " + retryDelayMs + "ms for SCO...");
                    Thread.sleep(retryDelayMs);
                }

                // Verify mode is correct
                if (audioManager.getMode() != AudioManager.MODE_IN_COMMUNICATION) {
                    Log.w(TAG, " Audio mode wrong, fixing...");
                    audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    Thread.sleep(200);
                }

                // Double-check SCO is still connected after mode fix
                if (!isScoConnected) {
                    Log.e(TAG, "SCO lost during mode fix");
                    promise.reject("SCO_UNSTABLE", "Bluetooth SCO connection unstable. Please reconnect.");
                    return;
                }

                // Prepare output file
                File recordingsDir = new File(reactContext.getFilesDir(), "recordings");
                if (!recordingsDir.exists()) {
                    recordingsDir.mkdirs();
                }

                String timestamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.getDefault())
                        .format(new Date());
                String fileName = filename != null ? filename : "steth_" + timestamp + ".wav";
                File file = new File(recordingsDir, fileName);
                recordingFilePath = file.getAbsolutePath();

                Log.d(TAG, "=== Starting recording from AiSteth Bluetooth mic ===");
                Log.d(TAG, "Output file: " + recordingFilePath);
                Log.d(TAG, "Audio mode: " + audioManager.getMode());
                Log.d(TAG, "Bluetooth SCO connected: " + isScoConnected);

                audioRecorder = new BluetoothAudioRecorder(recordingFilePath, audioManager);

                audioRecorder.setOnAmplitudeListener(amplitude -> {
                    if (!isScoConnected) {
                        Log.e(TAG, "SCO disconnected during recording!");
                        if (audioRecorder != null) {
                            audioRecorder.stopRecording();
                            isRecording = false;
                        }
                        sendError("SCO_DISCONNECTED", "Bluetooth SCO disconnected during recording");
                        return;
                    }
                    sendEvent(EVENT_AMPLITUDE, amplitude);

                    WritableMap stateMap = Arguments.createMap();
                    stateMap.putString("state", "RECORDING");
                    stateMap.putBoolean("isRecording", audioRecorder.isRecording());
                    stateMap.putBoolean("isPaused", audioRecorder.isPaused());
                    sendEvent(EVENT_RECORDING_STATE, stateMap);
                });

                audioRecorder.startRecording();
                isRecording = true;

                WritableMap result = Arguments.createMap();
                result.putString("filePath", recordingFilePath);
                result.putString("fileName", fileName);
                result.putDouble("timestamp", System.currentTimeMillis());

                Log.d(TAG, "=== Recording ACTIVE ===");
                promise.resolve(result);

            } catch (Exception e) {
                Log.e(TAG, "Recording error: " + e.getMessage());
                e.printStackTrace();
                promise.reject("RECORDING_ERROR", e.getMessage());
            }
        }).start();
    }

    @ReactMethod
    public void stopRecording(Promise promise) {
        try {
            if (!isRecording) {
                promise.reject("NOT_RECORDING", "No recording in progress");
                return;
            }

            if (audioRecorder != null) {
                audioRecorder.stopRecording();
            }

            long fileSize = 0;
            if (recordingFilePath != null) {
                File file = new File(recordingFilePath);
                fileSize = file.length();
            }

            isRecording = false;

            WritableMap result = Arguments.createMap();
            result.putString("filePath", recordingFilePath);
            result.putDouble("fileSize", fileSize);
            result.putDouble("timestamp", System.currentTimeMillis());

            Log.d(TAG, "Recording stopped: " + recordingFilePath + " (" + fileSize + " bytes)");
            promise.resolve(result);

            audioRecorder = null;
            recordingFilePath = null;

        } catch (Exception e) {
            Log.e(TAG, "Stop recording error: " + e.getMessage());
            promise.reject("STOP_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void pauseRecording(Promise promise) {
        try {
            if (audioRecorder != null) {
                audioRecorder.pauseRecording();
            }

            Log.d(TAG, "Recording paused");
            promise.resolve(true);

        } catch (Exception e) {
            promise.reject("PAUSE_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void resumeRecording(Promise promise) {
        try {
            if (audioRecorder != null) {
                audioRecorder.resumeRecording();
            }

            Log.d(TAG, "Recording resumed");
            promise.resolve(true);

        } catch (Exception e) {
            promise.reject("RESUME_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void disconnectDevice(Promise promise) {
        try {
            stopBluetoothSco();

            if (bluetoothA2dp != null && currentDevice != null) {
                try {
                    Method disconnectMethod = BluetoothA2dp.class
                            .getDeclaredMethod("disconnect", BluetoothDevice.class);
                    disconnectMethod.setAccessible(true);
                    disconnectMethod.invoke(bluetoothA2dp, currentDevice);
                    Log.d(TAG, "Device disconnected");
                } catch (Exception e) {
                    Log.e(TAG, "Disconnect method error: " + e.getMessage());
                }
            }

            if (bluetoothAdapter != null && bluetoothA2dp != null) {
                bluetoothAdapter.closeProfileProxy(BluetoothProfile.A2DP, bluetoothA2dp);
            }

            bluetoothA2dp = null;
            currentDevice = null;
            promise.resolve(true);

        } catch (Exception e) {
            Log.e(TAG, "Disconnect error: " + e.getMessage());
            promise.reject("DISCONNECT_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getRecordings(Promise promise) {
        try {
            File recordingsDir = new File(reactContext.getFilesDir(), "recordings");
            if (!recordingsDir.exists()) {
                promise.resolve(Arguments.createArray());
                return;
            }

            WritableArray recordings = Arguments.createArray();
            File[] files = recordingsDir.listFiles();

            if (files != null) {
                // Sort by last modified (newest first)
                java.util.Arrays.sort(files, (f1, f2) -> Long.compare(f2.lastModified(), f1.lastModified()));

                for (File file : files) {
                    if (file.getName().endsWith(".wav")) {
                        WritableMap recordingInfo = Arguments.createMap();
                        recordingInfo.putString("fileName", file.getName());
                        recordingInfo.putString("filePath", file.getAbsolutePath());
                        recordingInfo.putDouble("fileSize", file.length());
                        recordingInfo.putDouble("timestamp", file.lastModified());

                        SimpleDateFormat sdf = new SimpleDateFormat("MMM dd, yyyy HH:mm", Locale.getDefault());
                        recordingInfo.putString("date", sdf.format(new Date(file.lastModified())));
                        recordings.pushMap(recordingInfo);
                    }
                }
            }

            promise.resolve(recordings);

        } catch (Exception e) {
            promise.reject("GET_RECORDINGS_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void verifyBluetoothAudioActive(Promise promise) {
        try {
            WritableMap status = Arguments.createMap();
            boolean scoOn = audioManager.isBluetoothScoOn();
            boolean a2dpOn = audioManager.isBluetoothA2dpOn();
            int audioMode = audioManager.getMode();
            boolean speakerOn = audioManager.isSpeakerphoneOn();

            status.putBoolean("bluetoothScoOn", scoOn);
            status.putBoolean("bluetoothA2dpOn", a2dpOn);
            status.putInt("audioMode", audioMode);
            status.putBoolean("speakerphoneOn", speakerOn);
            status.putBoolean("scoConnected", isScoConnected);
            status.putBoolean("readyToRecord", isScoConnected && audioMode == AudioManager.MODE_IN_COMMUNICATION);

            Log.d(TAG, "=== Audio Routing Status ===");
            Log.d(TAG, "Bluetooth SCO (Mic Input): " + scoOn);
            Log.d(TAG, "SCO Connected: " + isScoConnected);
            Log.d(TAG, "Speakerphone (Output): " + speakerOn);
            Log.d(TAG, "Audio Mode: " + audioMode);
            Log.d(TAG, "Ready to record from AiSteth: " + (isScoConnected && audioMode == AudioManager.MODE_IN_COMMUNICATION));

            promise.resolve(status);

        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void deleteRecording(String filePath, Promise promise) {
        try {
            File file = new File(filePath);
            if (file.exists() && file.delete()) {
                Log.d(TAG, "Deleted recording: " + filePath);
                promise.resolve(true);
            } else {
                promise.reject("DELETE_ERROR", "File not found or could not be deleted");
            }

        } catch (Exception e) {
            promise.reject("DELETE_ERROR", e.getMessage());
        }
    }

    private void sendEvent(String eventName, Object params) {
        reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(eventName, params);
    }

    private void sendError(String code, String message) {
        WritableMap errorMap = Arguments.createMap();
        errorMap.putString("code", code);
        errorMap.putString("message", message);
        sendEvent(EVENT_ERROR, errorMap);
    }

    @Override
    public void invalidate() {
        super.invalidate();
        try {
            if (audioRecorder != null) {
                audioRecorder.stopRecording();
            }

            stopBluetoothSco();

            if (bluetoothReceiver != null) {
                reactContext.unregisterReceiver(bluetoothReceiver);
            }

            Log.d(TAG, "Module destroyed");

        } catch (Exception e) {
            Log.e(TAG, "Cleanup error: " + e.getMessage());
        }
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Keep: Required for RN built-in Event Emitter Calls
    }

    @ReactMethod
    public void removeListeners(Integer count) {
        // Keep: Required for RN built-in Event Emitter Calls
    }
}