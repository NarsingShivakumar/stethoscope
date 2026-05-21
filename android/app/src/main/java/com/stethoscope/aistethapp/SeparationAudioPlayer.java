package com.stethoscope.aistethapp;

/*
 * SeparationAudioPlayer.java  — NEW native module
 * =================================================
 * Package: com.stethoscope.aistethapp  (exact match to repo)
 *
 * Plays back base64 raw PCM-16 returned by the Flask NMF backend.
 *
 * ReactMethods (all return Promise<bool>):
 *   playHeartAudio(base64Pcm)
 *   playLungAudio(base64Pcm)
 *   playAudioWithSr(base64Pcm, sampleRate, label)
 *   stopPlayback()
 *   saveAudioFile(base64Wav, filename, type)  → Promise<{filePath}>
 *   getAudioInfo(base64Wav)                   → Promise<{sr, numSamples, duration}>
 *
 * Register in MyAppPackage.createNativeModules():
 *   modules.add(new SeparationAudioPlayer(reactContext));
 */

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

public class SeparationAudioPlayer extends ReactContextBaseJavaModule {

    private static final String TAG = "SepAudioPlayer";

    // Flask server returns audio at the original input SR (44100 Hz by default)
    private static final int DEFAULT_SR   = 44100;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    private static final int CHANNEL_OUT  = AudioFormat.CHANNEL_OUT_MONO;

    private final ReactApplicationContext reactContext;
    private final ExecutorService         exec    = Executors.newSingleThreadExecutor();
    private AudioTrack                    track;
    private final AtomicBoolean           playing = new AtomicBoolean(false);

    public SeparationAudioPlayer(ReactApplicationContext ctx) {
        super(ctx);
        this.reactContext = ctx;
    }

    @NonNull @Override
    public String getName() { return "SeparationAudioPlayer"; }

    @ReactMethod
    public void playHeartAudio(String b64Pcm, final Promise promise) {
        playAudio(b64Pcm, DEFAULT_SR, "heart", promise);
    }

    @ReactMethod
    public void playLungAudio(String b64Pcm, final Promise promise) {
        playAudio(b64Pcm, DEFAULT_SR, "lung", promise);
    }

    @ReactMethod
    public void playAudioWithSr(String b64Pcm, int sr, String label, final Promise promise) {
        playAudio(b64Pcm, sr, label, promise);
    }

    @ReactMethod
    public void stopPlayback(final Promise promise) {
        exec.submit(() -> {
            try { stopTrack(); promise.resolve(true); }
            catch (Exception e) { promise.reject("STOP_ERROR", e.getMessage()); }
        });
    }

    @ReactMethod
    public void saveAudioFile(String b64Wav, String filename, String type, final Promise promise) {
        exec.submit(() -> {
            try {
                byte[] wav = Base64.decode(b64Wav, Base64.DEFAULT);
                File dir   = new File(reactContext.getExternalFilesDir(null), "steth_output");
                if (!dir.exists()) dir.mkdirs();
                String fn  = (type != null ? type + "_" : "") + filename;
                File   out = new File(dir, fn);
                try (FileOutputStream fos = new FileOutputStream(out)) { fos.write(wav); }
                WritableMap r = Arguments.createMap();
                r.putString("filePath", out.getAbsolutePath());
                r.putDouble("fileSize", out.length());
                r.putString("type", type);
                promise.resolve(r);
                Log.i(TAG, "Saved " + type + " → " + out.getAbsolutePath());
            } catch (Exception e) { promise.reject("SAVE_ERROR", e.getMessage()); }
        });
    }

    @ReactMethod
    public void getAudioInfo(String b64Wav, final Promise promise) {
        exec.submit(() -> {
            try {
                byte[] wav = Base64.decode(b64Wav, Base64.DEFAULT);
                int sr     = wav.length >= 28
                        ? ByteBuffer.wrap(wav, 24, 4).order(ByteOrder.LITTLE_ENDIAN).getInt()
                        : DEFAULT_SR;
                int n      = (wav.length - 44) / 2;
                WritableMap r = Arguments.createMap();
                r.putInt("sampleRate", sr);
                r.putInt("numSamples", n);
                r.putDouble("duration", n / (double) sr);
                promise.resolve(r);
            } catch (Exception e) { promise.reject("INFO_ERROR", e.getMessage()); }
        });
    }

    private void playAudio(String b64Pcm, int sr, String label, Promise promise) {
        exec.submit(() -> {
            try {
                stopTrack();
                byte[] pcm = Base64.decode(b64Pcm, Base64.DEFAULT);
                if (pcm.length == 0) { promise.reject("EMPTY", "Empty audio payload"); return; }

                int minBuf = AudioTrack.getMinBufferSize(sr, CHANNEL_OUT, AUDIO_FORMAT);
                int bufSz  = Math.max(minBuf, pcm.length);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    track = new AudioTrack.Builder()
                            .setAudioAttributes(new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_MEDIA)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                            .setAudioFormat(new AudioFormat.Builder()
                                    .setEncoding(AUDIO_FORMAT).setSampleRate(sr)
                                    .setChannelMask(CHANNEL_OUT).build())
                            .setBufferSizeInBytes(bufSz)
                            .setTransferMode(AudioTrack.MODE_STATIC).build();
                } else {
                    //noinspection deprecation
                    track = new AudioTrack(AudioManager.STREAM_MUSIC, sr, CHANNEL_OUT,
                            AUDIO_FORMAT, bufSz, AudioTrack.MODE_STATIC);
                }

                int written = track.write(pcm, 0, pcm.length);
                if (written < 0) {
                    promise.reject("WRITE_ERROR", "AudioTrack.write: " + written); return;
                }

                playing.set(true);
                track.play();
                Log.i(TAG, "Playing " + label + " | " + pcm.length + "B @ " + sr + " Hz");
                promise.resolve(true);

                long durMs = (long) pcm.length * 1000L / (sr * 2L);
                Thread.sleep(durMs + 300);
                stopTrack();

            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                stopTrack();
                promise.reject("INTERRUPTED", "Playback interrupted");
            } catch (Exception e) {
                Log.e(TAG, "playAudio error", e);
                promise.reject("PLAYBACK_ERROR", e.getMessage());
            }
        });
    }

    private void stopTrack() {
        if (track != null) {
            try {
                if (track.getPlayState() == AudioTrack.PLAYSTATE_PLAYING) track.stop();
                track.release();
            } catch (Exception ignored) {}
            track = null;
        }
        playing.set(false);
    }

    @Override public void invalidate() {
        super.invalidate(); exec.shutdownNow(); stopTrack();
    }

    @ReactMethod public void addListener(String n) {}
    @ReactMethod public void removeListeners(Integer c) {}
}