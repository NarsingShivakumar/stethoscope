package com.stethoscope.aistethapp;

import android.bluetooth.BluetoothA2dp;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.Arguments;

import java.lang.reflect.Method;
import java.util.List;

public class AudioRoutingManager extends ReactContextBaseJavaModule {
    private static final String TAG = "AudioRoutingManager";
    private final ReactApplicationContext reactContext;
    private AudioManager audioManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothA2dp bluetoothA2dp;
    private int previousAudioMode = AudioManager.MODE_NORMAL;
    private Handler handler;

    public AudioRoutingManager(ReactApplicationContext context) {
        super(context);
        this.reactContext = context;
        this.audioManager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        this.handler = new Handler(Looper.getMainLooper());

        BluetoothManager bluetoothManager = (BluetoothManager) context
                .getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager != null) {
            bluetoothAdapter = bluetoothManager.getAdapter();
        }

        // Get A2DP profile on initialization
        if (bluetoothAdapter != null) {
            bluetoothAdapter.getProfileProxy(context, new BluetoothProfile.ServiceListener() {
                @Override
                public void onServiceConnected(int profile, BluetoothProfile proxy) {
                    if (profile == BluetoothProfile.A2DP) {
                        bluetoothA2dp = (BluetoothA2dp) proxy;
                        Log.d(TAG, "A2DP profile connected");
                    }
                }

                @Override
                public void onServiceDisconnected(int profile) {
                    if (profile == BluetoothProfile.A2DP) {
                        bluetoothA2dp = null;
                        Log.d(TAG, "A2DP profile disconnected");
                    }
                }
            }, BluetoothProfile.A2DP);
        }
    }

    @NonNull
    @Override
    public String getName() {
        return "AudioRoutingManager";
    }

    /**
     * CRITICAL: Disable Bluetooth audio by disconnecting A2DP profile
     * This prevents the stethoscope from taking over audio output
     */
    @ReactMethod
    public void disableBluetoothAudio(final Promise promise) {
        try {
            Log.d(TAG, "=== Disabling Bluetooth audio routing ===");

            // Step 1: Stop any active SCO
            if (audioManager.isBluetoothScoOn()) {
                Log.d(TAG, "Stopping Bluetooth SCO");
                audioManager.stopBluetoothSco();
                audioManager.setBluetoothScoOn(false);
            }

            // Step 2: Set audio mode to normal
            audioManager.setMode(AudioManager.MODE_NORMAL);
            Log.d(TAG, "Audio mode set to NORMAL");

            // Step 3: Clear communication device (Android 12+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice();
                Log.d(TAG, "Communication device cleared");
            }

            // Step 4: CRITICAL - Disconnect A2DP audio devices
            if (bluetoothA2dp != null) {
                disconnectA2dpAudioDevices(promise);
            } else {
                // If A2DP not ready, wait and retry
                Log.d(TAG, "A2DP profile not ready, waiting...");
                handler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        if (bluetoothA2dp != null) {
                            disconnectA2dpAudioDevices(promise);
                        } else {
                            Log.d(TAG, "A2DP still not ready, resolving anyway");
                            promise.resolve(true);
                        }
                    }
                }, 1000);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error disabling Bluetooth audio: " + e.getMessage());
            e.printStackTrace();
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Disconnect A2DP (media audio) from all audio devices
     */
    private void disconnectA2dpAudioDevices(Promise promise) {
        try {
            List<BluetoothDevice> connectedDevices = bluetoothA2dp.getConnectedDevices();
            Log.d(TAG, "Found " + connectedDevices.size() + " A2DP connected devices");

            if (connectedDevices.isEmpty()) {
                Log.d(TAG, "No A2DP devices to disconnect");
                promise.resolve(true);
                return;
            }

            for (BluetoothDevice device : connectedDevices) {
                // Only disconnect audio devices (stethoscopes, headphones, etc.)
                if (isAudioDevice(device)) {
                    Log.d(TAG, "Disconnecting A2DP from: " + device.getName() + " (" + device.getAddress() + ")");

                    try {
                        // Use reflection to call hidden disconnect method
                        Method disconnectMethod = BluetoothA2dp.class
                                .getDeclaredMethod("disconnect", BluetoothDevice.class);
                        disconnectMethod.setAccessible(true);
                        boolean result = (boolean) disconnectMethod.invoke(bluetoothA2dp, device);
                        Log.d(TAG, "A2DP disconnect result: " + result);
                    } catch (Exception e) {
                        Log.e(TAG, "Failed to disconnect A2DP: " + e.getMessage());
                    }
                }
            }

            Log.d(TAG, "=== Bluetooth audio disabled successfully ===");
            promise.resolve(true);

        } catch (Exception e) {
            Log.e(TAG, "Error disconnecting A2DP devices: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Check if device is an audio device
     */
    private boolean isAudioDevice(BluetoothDevice device) {
        try {
            return device.getBluetoothClass() != null &&
                    device.getBluetoothClass().hasService(
                            android.bluetooth.BluetoothClass.Service.AUDIO);
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Enable Bluetooth MIC ONLY - Modern Android 12+ approach
     */
    @ReactMethod
    public void enableBluetoothMicModern(String deviceAddress, Promise promise) {
        try {
            Log.d(TAG, "=== Enabling Bluetooth MIC (Android 12+) ===");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                previousAudioMode = audioManager.getMode();

                // Step 1: Set communication mode
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                Log.d(TAG, "Audio mode: IN_COMMUNICATION");

                // Step 2: Find and set Bluetooth SCO for input
                AudioDeviceInfo bluetoothInputDevice = null;
                List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();

                Log.d(TAG, "Available communication devices:");
                for (AudioDeviceInfo device : devices) {
                    Log.d(TAG, "  - Type: " + device.getType() + ", Name: " + device.getProductName());

                    if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                        bluetoothInputDevice = device;
                    }
                }

                if (bluetoothInputDevice != null) {
                    boolean success = audioManager.setCommunicationDevice(bluetoothInputDevice);
                    Log.d(TAG, "Bluetooth input device set: " + success);

                    if (!success) {
                        promise.reject("ERROR", "Failed to set Bluetooth communication device");
                        return;
                    }

                    // CRITICAL: Force speaker for output AFTER setting communication device
//                    handler.postDelayed(new Runnable() {
//                        @Override
//                        public void run() {
//                            audioManager.setSpeakerphoneOn(true);
//                            Log.d(TAG, "Speakerphone enabled for output");
//                        }
//                    }, 500);

                } else {
                    Log.w(TAG, "No Bluetooth SCO device found, using legacy method");
                    enableBluetoothMicOnly(deviceAddress, promise);
                    return;
                }

                Log.d(TAG, "=== Audio routing: BT mic IN, Phone speaker OUT ===");
                promise.resolve(true);
            } else {
                enableBluetoothMicOnly(deviceAddress, promise);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error with modern audio routing: " + e.getMessage());
            e.printStackTrace();
            promise.reject("ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void addListener(String eventName) {
        // Required for RN built-in Event Emitter
    }

    @ReactMethod
    public void removeListeners(Integer count) {
        // Required for RN built-in Event Emitter
    }
    @ReactMethod
    public void enableBluetoothInput(Promise promise) {
        try {
            Log.d(TAG, "=== Enabling Bluetooth MIC (Android 12+) ===");

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Set audio mode first
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                Log.d(TAG, "✅ Audio mode: IN_COMMUNICATION");

                // Get available communication devices
                List<AudioDeviceInfo> devices = audioManager.getAvailableCommunicationDevices();
                Log.d(TAG, "Available communication devices:");

                AudioDeviceInfo bluetoothInputDevice = null;

                for (AudioDeviceInfo device : devices) {
                    Log.d(TAG, "  - Type: " + device.getType() + ", Name: " + device.getProductName());

                    // Type 7 = Bluetooth SCO (microphone input)
                    if (device.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) {
                        bluetoothInputDevice = device;
                    }
                }

                if (bluetoothInputDevice != null) {
                    // CRITICAL: Set Bluetooth as communication device
                    boolean success = audioManager.setCommunicationDevice(bluetoothInputDevice);
                    Log.d(TAG, "✅ Bluetooth input device set: " + success);

                    if (!success) {
                        Log.e(TAG, "❌ Failed to set Bluetooth as communication device");
                        promise.reject("ROUTING_ERROR", "Failed to set Bluetooth communication device");
                        return;
                    }

                    // Wait for routing to stabilize
                    Thread.sleep(500);

                    Log.d(TAG, "=== Audio routing: BT mic IN, Phone speaker OUT ===");

                    // Enable speakerphone for output (NOT for microphone)
                    audioManager.setSpeakerphoneOn(true);
                    Log.d(TAG, "✅ Speakerphone enabled for output");

                    promise.resolve(true);
                } else {
                    Log.e(TAG, "❌ No Bluetooth SCO device found");
                    promise.reject("NO_BT_DEVICE", "No Bluetooth SCO device available");
                }
            } else {
                // Fall back to legacy method for older Android
                enableBluetoothMicOnly(null, promise);
            }

        } catch (Exception e) {
            Log.e(TAG, "Error enabling Bluetooth input: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void setAudioModeOnly(Promise promise) {
        try {
            Log.d(TAG, "=== Setting audio mode to IN_COMMUNICATION (no SCO restart) ===");

            if (audioManager != null) {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                Log.d(TAG, "Audio mode set: IN_COMMUNICATION");
            }

            promise.resolve(true);

        } catch (Exception e) {
            Log.e(TAG, "Error setting audio mode: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }


    /**
     * Enable Bluetooth MIC ONLY - Legacy method for older Android
     */
    @ReactMethod
    public void enableBluetoothMicOnly(String deviceAddress, Promise promise) {
        try {
            Log.d(TAG, "=== Enabling Bluetooth MIC (legacy) ===");

            previousAudioMode = audioManager.getMode();

            // Step 1: Set communication mode
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);

            // Step 2: Start Bluetooth SCO for input
            audioManager.setBluetoothScoOn(true);
            audioManager.startBluetoothSco();
            Log.d(TAG, "Bluetooth SCO started");

            // Step 3: CRITICAL - Wait for SCO to connect, THEN force speaker
            handler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    // Force speaker for output
                    audioManager.setSpeakerphoneOn(true);
                    Log.d(TAG, "Speakerphone enabled");

                    // Set audio parameters
                    try {
                        audioManager.setParameters("bluetooth_sco=on");
                        audioManager.setParameters("A2dpSuspended=true");
                    } catch (Exception e) {
                        Log.w(TAG, "Could not set audio parameters: " + e.getMessage());
                    }
                }
            }, 1000); // Wait 1 second for SCO connection

            // Request audio focus
            audioManager.requestAudioFocus(
                    null,
                    AudioManager.STREAM_VOICE_CALL,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            );

            Log.d(TAG, "=== Bluetooth MIC enabled (input), speaker active (output) ===");
            promise.resolve(true);

        } catch (Exception e) {
            Log.e(TAG, "Error enabling Bluetooth MIC: " + e.getMessage());
            e.printStackTrace();
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Restore normal audio routing
     */
    @ReactMethod
    public void restoreNormalAudio(Promise promise) {
        try {
            Log.d(TAG, "=== Restoring normal audio ===");

            // Release audio focus
            audioManager.abandonAudioFocus(null);

            // Stop Bluetooth SCO
            if (audioManager.isBluetoothScoOn()) {
                audioManager.stopBluetoothSco();
                audioManager.setBluetoothScoOn(false);
                Log.d(TAG, "Bluetooth SCO stopped");
            }

            // Disable speakerphone
            audioManager.setSpeakerphoneOn(false);

            // Clear communication device (Android 12+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                audioManager.clearCommunicationDevice();
            }

            // Clear audio parameters
            try {
                audioManager.setParameters("bluetooth_sco=off");
                audioManager.setParameters("A2dpSuspended=false");
            } catch (Exception e) {
                Log.w(TAG, "Could not reset audio parameters");
            }

            // Restore audio mode
            audioManager.setMode(previousAudioMode);

            Log.d(TAG, "=== Normal audio restored ===");
            promise.resolve(true);

        } catch (Exception e) {
            Log.e(TAG, "Error restoring audio: " + e.getMessage());
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * Get current audio routing status for debugging
     */
    @ReactMethod
    public void getCurrentAudioRoute(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putBoolean("isBluetoothScoOn", audioManager.isBluetoothScoOn());
            result.putBoolean("isBluetoothA2dpOn", audioManager.isBluetoothA2dpOn());
            result.putBoolean("isSpeakerphoneOn", audioManager.isSpeakerphoneOn());
            result.putInt("audioMode", audioManager.getMode());

            // Log for debugging
            Log.d(TAG, "Current audio state:");
            Log.d(TAG, "  - Bluetooth SCO: " + audioManager.isBluetoothScoOn());
            Log.d(TAG, "  - Bluetooth A2DP: " + audioManager.isBluetoothA2dpOn());
            Log.d(TAG, "  - Speakerphone: " + audioManager.isSpeakerphoneOn());
            Log.d(TAG, "  - Audio Mode: " + audioManager.getMode());

            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();

        try {
            if (audioManager != null) {
                audioManager.setMode(AudioManager.MODE_NORMAL);
                if (audioManager.isBluetoothScoOn()) {
                    audioManager.stopBluetoothSco();
                    audioManager.setBluetoothScoOn(false);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    audioManager.clearCommunicationDevice();
                }
            }

            if (bluetoothAdapter != null && bluetoothA2dp != null) {
                bluetoothAdapter.closeProfileProxy(BluetoothProfile.A2DP, bluetoothA2dp);
            }
        } catch (Exception e) {
            Log.e(TAG, "Cleanup error: " + e.getMessage());
        }
    }
}
