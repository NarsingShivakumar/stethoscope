package com.stethoscope.aistethapp;

import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.util.Log;

import java.io.DataOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class BluetoothAudioRecorder {
    private static final String TAG = "BluetoothAudioRecorder";

    // Audio configuration
    private static final int[] SAMPLE_RATES = {16000, 8000, 44100};
    private int actualSampleRate = 44100;
    private static final int SAMPLE_RATE = 44100;
    private static final int CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO;
    private static final int AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT;
    private static final int BITS_PER_SAMPLE = 16;
    private static final int CHANNELS = 1;

    private AudioRecord audioRecord;
    private AudioManager audioManager;
    private boolean isRecording = false;
    private boolean isPaused = false;
    private Thread recordingThread;
    private String outputFilePath;
    private long totalAudioLen = 0;
    private OnAmplitudeListener amplitudeListener;

    public interface OnAmplitudeListener {
        void onAmplitude(int amplitude);
    }

    public BluetoothAudioRecorder(String filePath, AudioManager manager) {
        this.outputFilePath = filePath;
        this.audioManager = manager;
    }

    public void setOnAmplitudeListener(OnAmplitudeListener listener) {
        this.amplitudeListener = listener;
    }

    public void startRecording() throws IOException {
        int bufferSize = AudioRecord.getMinBufferSize(
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT
        );

        if (bufferSize == AudioRecord.ERROR_BAD_VALUE) {
            throw new IOException("Invalid audio configuration");
        }

        // Create AudioRecord with VOICE_COMMUNICATION
        audioRecord = new AudioRecord(
                MediaRecorder.AudioSource.VOICE_COMMUNICATION,
                SAMPLE_RATE,
                CHANNEL_CONFIG,
                AUDIO_FORMAT,
                bufferSize * 4
        );

        if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
            throw new IOException("AudioRecord initialization failed");
        }

        // ❌ REMOVED: setPreferredDevice() - this was causing SCO to restart!
        // The AudioManager setCommunicationDevice() in AudioRoutingManager
        // already routes audio correctly. Don't override it here.

        Log.d(TAG, "✅ AudioRecord initialized (routing managed by AudioManager)");

        // Verify routing BEFORE starting
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioDeviceInfo routedDevice = audioRecord.getRoutedDevice();
            if (routedDevice != null) {
                Log.d(TAG, "📍 AudioRecord will route to: " + routedDevice.getProductName() +
                        " (Type: " + routedDevice.getType() + ")");

                // Verify it's a Bluetooth SCO device
                if (routedDevice.getType() != AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                    Log.w(TAG, "⚠️ WARNING: Not routed to Bluetooth SCO! Type: " + routedDevice.getType());
                }
            } else {
                Log.w(TAG, "⚠️ WARNING: AudioRecord routing is null!");
            }
        }

        isRecording = true;
        isPaused = false;
        totalAudioLen = 0;

        audioRecord.startRecording();
        Log.d(TAG, "🎤 AudioRecord started recording");

        recordingThread = new Thread(new Runnable() {
            @Override
            public void run() {
                writeAudioDataToFile();
            }
        });
        recordingThread.start();
    }

    /**
     * INFORMATIONAL: Find the Bluetooth SCO device for logging
     * (No longer used to set preferred device)
     */
    private AudioDeviceInfo getBluetoothSCODevice() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            AudioDeviceInfo[] devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS);
            Log.d(TAG, "=== Available input devices ===");

            for (AudioDeviceInfo device : devices) {
                Log.d(TAG, "  📱 Input Device: " + device.getProductName() +
                        " (Type: " + device.getType() + ")");

                // Type 7 = TYPE_BLUETOOTH_SCO
                if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                    Log.d(TAG, "  ✅ Found Bluetooth SCO: " + device.getProductName());
                    return device;
                }
            }

            Log.e(TAG, "❌ No Bluetooth SCO device found in input devices!");
        }

        return null;
    }

    private void writeAudioDataToFile() {
        byte[] audioBuffer = new byte[4096];
        DataOutputStream dos = null;
        int frameCount = 0;

        try {
            dos = new DataOutputStream(new FileOutputStream(outputFilePath));

            while (isRecording) {
                if (isPaused) {
                    try {
                        Thread.sleep(100);
                    } catch (InterruptedException e) {
                        Log.e(TAG, "Thread interrupted", e);
                    }
                    continue;
                }

                int bytesRead = audioRecord.read(audioBuffer, 0, audioBuffer.length);

                if (bytesRead > 0) {
                    dos.write(audioBuffer, 0, bytesRead);
                    totalAudioLen += bytesRead;
                    frameCount++;
                    if (frameCount % 10 == 0) {
                        short[] shorts = new short[bytesRead / 2];
                        ByteBuffer.wrap(audioBuffer).order(ByteOrder.LITTLE_ENDIAN)
                                .asShortBuffer().get(shorts);

                        int rawMax = 0;
                        long rawSum = 0;
                        for (short s : shorts) {
                            int abs = Math.abs(s);
                            if (abs > rawMax) rawMax = abs;
                            rawSum += abs;
                        }
                        int rawAvg = (int)(rawSum / shorts.length);

                        // **PRINT EVERYTHING - even if it's 0**
                        Log.d(TAG, String.format("🎤 RAW AUDIO | Frame: %d | Max: %d | Avg: %d | Bytes: %d",
                                frameCount, rawMax, rawAvg, bytesRead));
                    }
                    // Calculate amplitude for visualization
                    if (amplitudeListener != null) {
                        int amplitude = calculateAmplitude(audioBuffer, bytesRead);
                        amplitudeListener.onAmplitude(amplitude);
                    }
                }
            }

        } catch (IOException e) {
            Log.e(TAG, "Error writing audio data", e);
        } finally {
            try {
                if (dos != null) {
                    dos.close();
                }
            } catch (IOException e) {
                Log.e(TAG, "Error closing file", e);
            }
        }

        Log.d(TAG, "Recording finished. Total audio length: " + totalAudioLen + " bytes");

        // Add WAV header after recording
        try {
            addWavHeader();
        } catch (IOException e) {
            Log.e(TAG, "Error adding WAV header", e);
        }
    }

    // Add at the top of BluetoothAudioRecorder class
    private static class HeartSoundAnalyzer {
        private static final String TAG = "HeartSoundAnalyzer";

        // Heart sound frequency range: 20-200 Hz (dominant: 50-100 Hz)
        private static final int SAMPLE_RATE = 44100;
        private static final int HEART_LOW_FREQ = 20;
        private static final int HEART_HIGH_FREQ = 200;
        private static final int DOMINANT_LOW = 50;
        private static final int DOMINANT_HIGH = 100;

        // Noise characteristics
        private static final int NOISE_HIGH_FREQ_START = 500; // Noise above 500 Hz

        // Adaptive thresholds
        private float baselineNoise = 0;
        private int sampleCount = 0;
        private static final int BASELINE_SAMPLES = 50; // Learn baseline over 50 samples

        // Previous values for filtering
        private float previousFiltered = 0;

        /**
         * Analyze audio buffer and extract heart sound amplitude
         * Returns: 0-100 for heart sounds, 0 for noise
         */
        public int analyzeHeartSound(byte[] buffer, int length) {
            short[] samples = new short[length / 2];
            ByteBuffer.wrap(buffer).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples);

            // Step 1: Calculate frequency spectrum energy
            FrequencyEnergy energy = calculateFrequencyEnergy(samples);

            // Step 2: Detect if this is heart sound or noise
            boolean isHeartSound = isHeartSoundPattern(energy);

            if (!isHeartSound) {
                // Log noise rejection
                if (energy.totalEnergy > 5000) {
                    Log.v(TAG, String.format("🚫 NOISE REJECTED | Total: %d | High-freq: %d | Ratio: %.2f",
                            (int)energy.totalEnergy, (int)energy.highFreqEnergy, energy.highFreqRatio));
                }
                return 0;
            }

            // Step 3: Extract heart sound amplitude with gain
            int heartAmplitude = extractHeartAmplitude(energy);

            if (heartAmplitude > 0) {
                Log.d(TAG, String.format("💓 HEART SOUND | Amp: %d | Low-freq: %d | Dominant: %d",
                        heartAmplitude, (int)energy.heartFreqEnergy, (int)energy.dominantEnergy));
            }

            return heartAmplitude;
        }

        private static class FrequencyEnergy {
            float totalEnergy;          // Total signal energy
            float heartFreqEnergy;      // Energy in 20-200 Hz (heart sound range)
            float dominantEnergy;       // Energy in 50-100 Hz (dominant heart sounds)
            float highFreqEnergy;       // Energy above 500 Hz (noise)
            float lowFreqRatio;         // Ratio of low-freq to total (should be high for heart)
            float highFreqRatio;        // Ratio of high-freq to total (should be low for heart)
        }

        /**
         * Calculate energy in different frequency bands (simplified approach)
         */
        private FrequencyEnergy calculateFrequencyEnergy(short[] samples) {
            FrequencyEnergy energy = new FrequencyEnergy();

            // Calculate RMS for different frequency bands using simple filtering
            long totalSum = 0;
            long heartBandSum = 0;
            long dominantBandSum = 0;
            long highFreqSum = 0;

            // Apply simple band-pass filtering using moving average
            float lowPassPrev = 0;
            float bandPassPrev = 0;
            float highPassPrev = 0;

            for (short sample : samples) {
                float absValue = Math.abs(sample);
                totalSum += absValue * absValue;

                // Low-pass filter (captures low frequencies including heart sounds)
                // Cutoff ~200 Hz
                lowPassPrev = 0.15f * absValue + 0.85f * lowPassPrev;
                heartBandSum += lowPassPrev * lowPassPrev;

                // Band-pass filter for dominant heart sounds (50-100 Hz)
                // This is a simplified approach
                float bandPass = Math.abs(absValue - lowPassPrev);
                bandPassPrev = 0.3f * bandPass + 0.7f * bandPassPrev;
                dominantBandSum += bandPassPrev * bandPassPrev;

                // High-pass filter (captures noise above 500 Hz)
                // Subtract low-pass from original to get high frequencies
                float highPass = Math.abs(absValue - lowPassPrev);
                highPassPrev = 0.05f * highPass + 0.95f * highPassPrev;
                highFreqSum += highPassPrev * highPassPrev;
            }

            int count = samples.length;
            energy.totalEnergy = (float)Math.sqrt(totalSum / count);
            energy.heartFreqEnergy = (float)Math.sqrt(heartBandSum / count);
            energy.dominantEnergy = (float)Math.sqrt(dominantBandSum / count);
            energy.highFreqEnergy = (float)Math.sqrt(highFreqSum / count);

            // Calculate ratios
            if (energy.totalEnergy > 0) {
                energy.lowFreqRatio = energy.heartFreqEnergy / energy.totalEnergy;
                energy.highFreqRatio = energy.highFreqEnergy / energy.totalEnergy;
            } else {
                energy.lowFreqRatio = 0;
                energy.highFreqRatio = 0;
            }

            return energy;
        }

        /**
         * Determine if the signal matches heart sound pattern
         */
        private boolean isHeartSoundPattern(FrequencyEnergy energy) {
            // Rule 1: Must have low-frequency energy (heart sounds are low frequency)
            if (energy.lowFreqRatio < 0.5f) {
                // Less than 50% of energy in low frequencies = likely noise
                return false;
            }

            // Rule 2: Should NOT have excessive high-frequency energy
            if (energy.highFreqRatio > 0.4f) {
                // More than 40% in high frequencies = talking, tapping, rubbing
                return false;
            }

            // Rule 3: Absolute energy check (ignore very loud sounds)
            if (energy.totalEnergy > 15000) {
                // Extremely loud = external noise
                return false;
            }

            // Rule 4: Dominant energy should be reasonable
            if (energy.dominantEnergy < 50) {
                // Too quiet = silence/background noise
                return false;
            }

            // Passes all tests = likely heart sound
            return true;
        }

        /**
         * Extract and amplify heart sound amplitude
         */
        private int extractHeartAmplitude(FrequencyEnergy energy) {
            // Use dominant frequency band energy
            float rawAmplitude = energy.dominantEnergy;

            // Apply MASSIVE gain for heart sounds (they're very quiet)
            final float HEART_SOUND_GAIN = 80.0f;
            float amplified = rawAmplitude * HEART_SOUND_GAIN;

            // Normalize to 0-100 range
            int normalized = (int)((amplified / 32768.0f) * 100);

            // Clamp to 0-100
            return Math.max(0, Math.min(100, normalized));
        }
    }

    // Add instance variable
    private HeartSoundAnalyzer heartAnalyzer = new HeartSoundAnalyzer();

    // Replace calculateAmplitude method
//    private int calculateAmplitude(byte[] buffer, int length) {
//        // Use intelligent heart sound analyzer
//        return heartAnalyzer.analyzeHeartSound(buffer, length);
//    }
    private static class UltraSensitiveAmplifier {
        private static final String TAG = "UltraSensitiveAmplifier";

        // Adaptive baseline noise tracking
        private float baselineNoise = 1.0f;
        private int frameCount = 0;

        // Running average for smoothing
        private float previousAmp = 0;
        private static final float SMOOTHING = 0.3f; // Smooth out noise

        public int amplify(byte[] buffer, int length) {
            short[] shorts = new short[length / 2];
            ByteBuffer.wrap(buffer).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(shorts);

            // Calculate RMS (Root Mean Square) - most sensitive
            long sumSquares = 0;
            int maxAbs = 0;

            for (short s : shorts) {
                int abs = Math.abs(s);
                if (abs > maxAbs) maxAbs = abs;
                sumSquares += (long)abs * abs;
            }

            float rms = (float)Math.sqrt(sumSquares / shorts.length);

            // **CRITICAL: Update baseline noise (adaptive)**
            frameCount++;
            if (frameCount < 100) {
                // Learn baseline in first 100 frames
                baselineNoise = Math.max(baselineNoise, rms * 0.5f);
            }

            // **MEGA AMPLIFICATION: 2000x for ultra-quiet signals**
            // This will make even Max:1-10 visible
            final float ULTRA_GAIN = 2000.0f;
            float amplified = rms * ULTRA_GAIN;

            // Smooth with previous value to reduce jitter
            amplified = SMOOTHING * amplified + (1 - SMOOTHING) * previousAmp;
            previousAmp = amplified;

            // Normalize to 0-100
            int normalized = (int)((amplified / 32768.0f) * 100);

            // **NOISE FILTER: Only reject if MAX is extremely loud AND sudden**
            // Max > 5000 = likely external tapping/talking
            if (maxAbs > 5000) {
                Log.w(TAG, String.format("🔇 NOISE | Max: %d >> 5000", maxAbs));
                return 0;
            }

            // Clamp to 0-100
            normalized = Math.max(0, Math.min(100, normalized));

            // **ALWAYS LOG (even if 0) to see continuous flow**
            if (normalized > 0) {
                Log.d(TAG, String.format("💚 Signal | Raw-Max: %d | RMS: %.1f | x%.0f | Final: %d",
                        maxAbs, rms, ULTRA_GAIN, normalized));
            } else if (frameCount % 20 == 0) {
                // Log silence every 20 frames
                Log.v(TAG, String.format("🔇 Quiet | Raw-Max: %d | RMS: %.1f | Baseline: %.1f",
                        maxAbs, rms, baselineNoise));
            }

            return normalized;
        }
    }
    // Add this complete class to BluetoothAudioRecorder.java
    private static class SmartHeartSoundDetector {
        private static final String TAG = "SmartHeartDetector";

        // Frequency characteristics
        private static final int SAMPLE_RATE = 44100;
        private static final float HEART_LOW_FREQ_CUTOFF = 200f; // Heart sounds below 200 Hz
        private static final float NOISE_HIGH_FREQ_START = 500f; // Noise typically above 500 Hz

        // Amplitude thresholds
        private static final int SUDDEN_SPIKE_THRESHOLD = 1000; // Raw amplitude
        private static final int MAX_HEART_AMPLITUDE = 800; // Heart sounds rarely exceed this

        // Pattern tracking
        private float[] recentAmplitudes = new float[10];
        private int amplitudeIndex = 0;
        private long lastHeartbeatTime = 0;

        // Filtering state
        private float previousLowPass = 0;
        private float previousHighPass = 0;
        private float previousAmplitude = 0;

        /**
         * Main detection method - returns amplitude if heart sound, 0 if noise
         */
        public int detectHeartSound(byte[] buffer, int length) {
            short[] samples = new short[length / 2];
            ByteBuffer.wrap(buffer).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer().get(samples);

            // Step 1: Calculate raw statistics
            AudioStats stats = calculateStats(samples);

            // Step 2: Frequency analysis (separate low and high frequencies)
            FrequencyAnalysis freqAnalysis = analyzeFrequencies(samples);

            // Step 3: Check for sudden amplitude spikes (noise indicator)
            if (isSuddenSpike(stats.maxAmplitude)) {
                Log.w(TAG, String.format("🚫 SPIKE REJECTED | Max: %d (sudden change)",
                        stats.maxAmplitude));
                return 0;
            }

            // Step 4: Check if amplitude is too high (external sound)
            if (stats.maxAmplitude > MAX_HEART_AMPLITUDE) {
                Log.w(TAG, String.format("🚫 TOO LOUD | Max: %d > %d",
                        stats.maxAmplitude, MAX_HEART_AMPLITUDE));
                return 0;
            }

            // Step 5: Frequency-based filtering
            if (!isHeartSoundFrequency(freqAnalysis)) {
                Log.v(TAG, String.format("🚫 WRONG FREQ | Low: %.1f%% | High: %.1f%%",
                        freqAnalysis.lowFreqPercent * 100, freqAnalysis.highFreqPercent * 100));
                return 0;
            }

            // Step 6: Pattern validation (rhythmic check)
            if (!isValidHeartPattern(stats.rms)) {
                Log.v(TAG, "🚫 PATTERN FAIL | Not rhythmic");
                return 0;
            }

            // Step 7: Passed all filters - this is a heart sound!
            int heartAmplitude = calculateHeartAmplitude(stats, freqAnalysis);

            if (heartAmplitude > 0) {
                Log.d(TAG, String.format("💓 HEART SOUND | Amp: %d | Max: %d | Low-freq: %.0f%% | RMS: %.1f",
                        heartAmplitude, stats.maxAmplitude, freqAnalysis.lowFreqPercent * 100, stats.rms));
            }

            return heartAmplitude;
        }

        /**
         * Calculate basic audio statistics
         */
        private static class AudioStats {
            int maxAmplitude;
            float rms;
            float average;
        }

        private AudioStats calculateStats(short[] samples) {
            AudioStats stats = new AudioStats();

            long sumSquares = 0;
            long sum = 0;
            int maxAbs = 0;

            for (short s : samples) {
                int abs = Math.abs(s);
                if (abs > maxAbs) maxAbs = abs;
                sum += abs;
                sumSquares += (long)abs * abs;
            }

            stats.maxAmplitude = maxAbs;
            stats.average = (float)sum / samples.length;
            stats.rms = (float)Math.sqrt(sumSquares / (double)samples.length);

            return stats;
        }

        /**
         * Frequency analysis using simple filtering
         */
        private static class FrequencyAnalysis {
            float lowFreqEnergy;    // Energy in 20-200 Hz (heart sound range)
            float highFreqEnergy;   // Energy in 500+ Hz (noise range)
            float totalEnergy;
            float lowFreqPercent;   // Percentage of energy in low frequencies
            float highFreqPercent;  // Percentage of energy in high frequencies
        }

        private FrequencyAnalysis analyzeFrequencies(short[] samples) {
            FrequencyAnalysis analysis = new FrequencyAnalysis();

            float lowFreqSum = 0;
            float highFreqSum = 0;
            float totalSum = 0;

            float lowPass = previousLowPass;
            float highPass = previousHighPass;

            for (short sample : samples) {
                float value = Math.abs(sample);
                totalSum += value;

                // Low-pass filter (captures frequencies below ~200 Hz)
                // Alpha = 0.15 corresponds to cutoff around 200 Hz at 44.1 kHz
                lowPass = 0.15f * value + 0.85f * lowPass;
                lowFreqSum += lowPass;

                // High-pass filter (captures frequencies above ~500 Hz)
                // Subtract low-pass from original to get high frequencies
                float highFreq = Math.abs(value - lowPass);
                highPass = 0.05f * highFreq + 0.95f * highPass;
                highFreqSum += highPass;
            }

            previousLowPass = lowPass;
            previousHighPass = highPass;

            analysis.lowFreqEnergy = lowFreqSum;
            analysis.highFreqEnergy = highFreqSum;
            analysis.totalEnergy = totalSum;

            if (totalSum > 0) {
                analysis.lowFreqPercent = lowFreqSum / totalSum;
                analysis.highFreqPercent = highFreqSum / totalSum;
            } else {
                analysis.lowFreqPercent = 0;
                analysis.highFreqPercent = 0;
            }

            return analysis;
        }

        /**
         * Check for sudden amplitude spikes (indicates tapping/knocking)
         */
        private boolean isSuddenSpike(int currentMax) {
            // Check if current amplitude is much larger than recent average
            float recentAvg = 0;
            for (float amp : recentAmplitudes) {
                recentAvg += amp;
            }
            recentAvg /= recentAmplitudes.length;

            // Store current amplitude for future comparison
            recentAmplitudes[amplitudeIndex] = currentMax;
            amplitudeIndex = (amplitudeIndex + 1) % recentAmplitudes.length;

            // If current is 5x higher than recent average, it's a spike
            if (recentAvg > 10 && currentMax > recentAvg * 5) {
                return true;
            }

            // Also check for extremely sudden changes from previous frame
            float change = Math.abs(currentMax - previousAmplitude);
            previousAmplitude = currentMax;

            if (change > SUDDEN_SPIKE_THRESHOLD) {
                return true;
            }

            return false;
        }

        /**
         * Check if frequency spectrum matches heart sounds
         */
        private boolean isHeartSoundFrequency(FrequencyAnalysis analysis) {
            // Rule 1: Must have significant low-frequency energy
            // Heart sounds should have at least 50% of energy in low frequencies
            if (analysis.lowFreqPercent < 0.50f) {
                return false;
            }

            // Rule 2: Should NOT have excessive high-frequency energy
            // Talking, tapping, rubbing have >40% high-frequency energy
            if (analysis.highFreqPercent > 0.40f) {
                return false;
            }

            // Rule 3: Low-frequency energy should dominate high-frequency
            // For heart sounds, low-freq should be at least 1.5x high-freq
            if (analysis.lowFreqEnergy < analysis.highFreqEnergy * 1.5f) {
                return false;
            }

            return true;
        }

        /**
         * Validate that the signal follows a rhythmic pattern (heart beats)
         */
        private boolean isValidHeartPattern(float currentRms) {
            long currentTime = System.currentTimeMillis();

            // Check if this could be a heartbeat based on timing
            if (lastHeartbeatTime > 0) {
                long timeSinceLastBeat = currentTime - lastHeartbeatTime;

                // Heart beats occur every 500-1500ms (40-120 BPM)
                // But we sample every ~100ms, so we allow any timing for now
                // Just track that we detected something
            }

            // For now, accept all amplitudes above minimum threshold
            // Future: Add more sophisticated rhythm detection
            if (currentRms < 10) {
                return false; // Too quiet to be heart sound
            }

            lastHeartbeatTime = currentTime;
            return true;
        }

        /**
         * Calculate final heart sound amplitude with gain
         */
        private int calculateHeartAmplitude(AudioStats stats, FrequencyAnalysis freqAnalysis) {
            // Use RMS from low-frequency band (most relevant for heart sounds)
            float heartSignal = freqAnalysis.lowFreqEnergy / 1000f; // Normalize

            // Apply amplification (2000x for very quiet heart sounds)
            final float HEART_GAIN = 2000.0f;
            float amplified = heartSignal * HEART_GAIN;

            // Normalize to 0-100 range
            int normalized = (int)((amplified / 32768.0f) * 100);

            // Clamp to 0-100
            return Math.max(0, Math.min(100, normalized));
        }
    }




    private UltraSensitiveAmplifier ultraAmplifier = new UltraSensitiveAmplifier();
    private SmartHeartSoundDetector heartDetector = new SmartHeartSoundDetector();


    private int calculateAmplitude(byte[] buffer, int length) {
        return heartDetector.detectHeartSound(buffer, length);
    }



    private void addWavHeader() throws IOException {
        RandomAccessFile wavFile = new RandomAccessFile(outputFilePath, "rw");

        long dataSize = totalAudioLen;
        long byteRate = SAMPLE_RATE * CHANNELS * BITS_PER_SAMPLE / 8;

        wavFile.seek(0);

        // RIFF header
        wavFile.writeBytes("RIFF");
        wavFile.writeInt(Integer.reverseBytes((int) (36 + dataSize)));
        wavFile.writeBytes("WAVE");

        // Format chunk
        wavFile.writeBytes("fmt ");
        wavFile.writeInt(Integer.reverseBytes(16)); // Subchunk1Size
        wavFile.writeShort(Short.reverseBytes((short) 1)); // AudioFormat (PCM)
        wavFile.writeShort(Short.reverseBytes((short) CHANNELS)); // NumChannels
        wavFile.writeInt(Integer.reverseBytes(SAMPLE_RATE)); // SampleRate
        wavFile.writeInt(Integer.reverseBytes((int) byteRate)); // ByteRate
        wavFile.writeShort(Short.reverseBytes((short) (CHANNELS * BITS_PER_SAMPLE / 8))); // BlockAlign
        wavFile.writeShort(Short.reverseBytes((short) BITS_PER_SAMPLE)); // BitsPerSample

        // Data chunk
        wavFile.writeBytes("data");
        wavFile.writeInt(Integer.reverseBytes((int) dataSize));

        wavFile.close();

        Log.d(TAG, "WAV header added successfully");
    }

    public void pauseRecording() {
        if (isRecording && !isPaused) {
            isPaused = true;
            Log.d(TAG, "Recording paused");
        }
    }

    public void resumeRecording() {
        if (isRecording && isPaused) {
            isPaused = false;
            Log.d(TAG, "Recording resumed");
        }
    }

    public void stopRecording() {
        isRecording = false;
        isPaused = false;

        if (audioRecord != null) {
            try {
                audioRecord.stop();
                audioRecord.release();
            } catch (Exception e) {
                Log.e(TAG, "Error stopping AudioRecord", e);
            }
            audioRecord = null;
        }

        if (recordingThread != null) {
            try {
                recordingThread.join(2000);
            } catch (InterruptedException e) {
                Log.e(TAG, "Error stopping recording thread", e);
            }
            recordingThread = null;
        }

        Log.d(TAG, "Recording stopped");
    }

    public boolean isRecording() {
        return isRecording && !isPaused;
    }

    public boolean isPaused() {
        return isPaused;
    }
}
