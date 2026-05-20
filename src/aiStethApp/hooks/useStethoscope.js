// src/hooks/useStethoscope.js

import { useState, useEffect, useCallback, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  NativeModules,
  NativeEventEmitter,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import {
  setIsConnected,
  connectDevice,
  disconnectDevice,
  setAudioReady,
} from '../../store/slices/StethoscopeSlice';
import { t } from 'i18next';

const { StethoscopeRecorder, AudioRoutingManager } = NativeModules;
const eventEmitter = new NativeEventEmitter(StethoscopeRecorder);

// Bluetooth Profile States
const BLUETOOTH_STATE_DISCONNECTED = 0;
const BLUETOOTH_STATE_CONNECTING = 1;
const BLUETOOTH_STATE_CONNECTED = 2;
const BLUETOOTH_STATE_DISCONNECTING = 3;

export const useStethoscope = () => {
  const dispatch = useDispatch();
  const { isConnected, connectedDevice, isAudioReady } = useSelector((state) => state.stethoscope);

  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [amplitude, setAmplitude] = useState(0);
  const [devices, setDevices] = useState([]);
  const [recordings, setRecordings] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isRecordingLoading, setIsRecordingLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentRecording, setCurrentRecording] = useState(null);

  const isConnectedRef = useRef(isConnected);
  const connectedDeviceRef = useRef(connectedDevice);
  const connectingDeviceRef = useRef(null); // Store device being connected
  const amplitudeHistory = useRef([]);
  const isAudioReadyRef = useRef(isAudioReady); //  Synced from Redux
  const maxAmplitudeHistory = 100;

  useEffect(() => {
    isConnectedRef.current = isConnected;
    connectedDeviceRef.current = connectedDevice;
  }, [isConnected, connectedDevice]);

  useEffect(() => {
    isAudioReadyRef.current = isAudioReady;
  }, [isAudioReady]);

  useEffect(() => {
    const bluetoothListener = eventEmitter.addListener(
      'onBluetoothStateChange',
      (state) => {
        console.log("Bluetooth state event received:", state);

        const bluetoothState = state.state;
        const previousState = state.previousState;

        if (bluetoothState === BLUETOOTH_STATE_CONNECTED) {
          console.log(' Bluetooth CONNECTED (state 2)');
          if (connectingDeviceRef.current) {
            console.log(' Dispatching connectDevice with:', connectingDeviceRef.current.name);
            dispatch(connectDevice(connectingDeviceRef.current));
            connectingDeviceRef.current = null;
          } else {
            dispatch(setIsConnected(true));
          }
        } else if (bluetoothState === BLUETOOTH_STATE_CONNECTING) {
          console.log('Bluetooth CONNECTING (state 1) - device in progress');
        } else if (bluetoothState === BLUETOOTH_STATE_DISCONNECTED && previousState !== BLUETOOTH_STATE_CONNECTING) {
          console.log('Bluetooth DISCONNECTED (state 0) - clearing device');
          connectingDeviceRef.current = null;
          dispatch(disconnectDevice());
        } else if (bluetoothState === BLUETOOTH_STATE_DISCONNECTING) {
          console.log('Bluetooth DISCONNECTING (state 3)');
          dispatch(setIsConnected(false));
        }
      }
    );

    const audioReadyListener = eventEmitter.addListener(
      'onAudioRouteReady',
      (ready) => {
        console.log('Audio route ready:', ready);

        if (ready !== isAudioReadyRef.current) {
          console.log('Audio ready state changed:', ready);
          isAudioReadyRef.current = ready;
          dispatch(setAudioReady(ready));
        }
      }
    );

    const amplitudeListener = eventEmitter.addListener(
      'onAmplitude',
      (amp) => {
        setAmplitude(amp);
        amplitudeHistory.current.push(amp);
        if (amplitudeHistory.current.length > maxAmplitudeHistory) {
          amplitudeHistory.current.shift();
        }
      }
    );

    const recordingListener = eventEmitter.addListener(
      'onRecordingStateChange',
      (state) => {
        setIsRecording(state.isRecording);
        setIsPaused(state.isPaused);
      }
    );

    const errorListener = eventEmitter.addListener(
      'onError',
      (err) => {
        console.log('Error event:', err);
        setError(`${err.code}: ${err.message}`);
        setTimeout(() => setError(null), 5000);
      }
    );

    return () => {
      bluetoothListener.remove();
      audioReadyListener.remove();
      amplitudeListener.remove();
      recordingListener.remove();
      errorListener.remove();
    };
  }, [dispatch]);

  const requestPermissions = async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      ];
      const granted = await PermissionsAndroid.requestMultiple(permissions);
      const allGranted = Object.values(granted).every(
        (status) => status === PermissionsAndroid.RESULTS.GRANTED
      );
      console.log('Permissions granted:', allGranted);
      return allGranted;
    } catch (err) {
      console.error('Permission error:', err);
      return false;
    }
  };

  const checkBluetoothEnabled = useCallback(async () => {
    try {
      const enabled = await StethoscopeRecorder.isBluetoothEnabled();
      console.log('Bluetooth enabled:', enabled);
      return enabled;
    } catch (err) {
      console.error('Bluetooth check error:', err);
      return false;
    }
  }, []);

  const getPairedDevices = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const hasPermissions = await requestPermissions();
      if (!hasPermissions) {
        throw new Error('Bluetooth permissions not granted');
      }

      const isEnabled = await checkBluetoothEnabled();
      if (!isEnabled) {
        throw new Error('Bluetooth is not enabled');
      }

      const deviceList = await StethoscopeRecorder.getPairedDevices();
      // console.log("All paired devices:", deviceList);

      const aiStethDevices = deviceList.filter(device =>
        device.name && device.name.toLowerCase().includes('aisteth')
      );
      console.log("Filtered AiSteth devices:", aiStethDevices);

      if (aiStethDevices.length === 0) {
        setError(t("no_aisteth_devices"));
      }

      setDevices(aiStethDevices);
      return aiStethDevices;
    } catch (err) {
      console.error("Get paired devices error:", err);
      const errorMessage = err.message || 'Failed to get paired devices';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [checkBluetoothEnabled]);

  const connect = useCallback(
    async (device) => {
      setIsConnecting(true);
      setError(null);

      //  Reset audio ready before new connection
      isAudioReadyRef.current = false;
      dispatch(setAudioReady(false));
      dispatch(disconnectDevice());

      try {
        console.log("=== Connecting to AiSteth device ===");
        console.log("Device:", device.name, device.address);

        if (!device.name || !device.name.toLowerCase().includes('aisteth')) {
          throw new Error('Please connect to an AiSteth device');
        }

        // Store device in ref - Redux will be updated when Bluetooth state event fires
        connectingDeviceRef.current = device;
        console.log('Stored device in ref:', device.name);
        console.log('Waiting for actual Bluetooth connection...');

        const maxRetries = 2;
        let audioRoutingSuccess = false;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`Audio routing attempt ${attempt}/${maxRetries}`);
            if (Platform.Version >= 31) {
              await AudioRoutingManager.enableBluetoothMicModern(device.address);
            } else {
              await AudioRoutingManager.enableBluetoothMicOnly(device.address);
            }

            await new Promise((resolve) => setTimeout(resolve, 1000));
            console.log('Audio routing: AiSteth MIC input, Phone SPEAKER output');
            audioRoutingSuccess = true;
            break;
          } catch (audioErr) {
            console.warn(`Audio routing attempt ${attempt} failed:`, audioErr);
            if (attempt === maxRetries) {
              throw audioErr;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }

        if (!audioRoutingSuccess) {
          throw new Error('Failed to establish audio routing after multiple attempts');
        }

        // Connect to device
        await StethoscopeRecorder.connectToDevice(device.address);
        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log('=== AiSteth connection initiated successfully ===');
        console.log(' Redux state will update when Bluetooth state event fires');
        console.log('Setting isConnected directly after successful connectToDevice');
        dispatch(connectDevice(device));
        connectingDeviceRef.current = null;

        console.log('=== AiSteth connection initiated successfully ===');
      } catch (err) {
        console.error('Connection error:', err);
        connectingDeviceRef.current = null;
        isAudioReadyRef.current = false;
        dispatch(setAudioReady(false));
        await AudioRoutingManager.restoreNormalAudio();
        dispatch(disconnectDevice());
        const errorMessage = err.message || 'Failed to connect to AiSteth device';
        setError(errorMessage);
        throw err;
      } finally {
        setIsConnecting(false);
      }
    },
    [dispatch]
  );

  const startRecording = useCallback(
    async (filename) => {
      setIsRecordingLoading(true);
      setError(null);
      amplitudeHistory.current = [];
      try {
        if (!isConnectedRef.current || !connectedDeviceRef.current) {
          throw new Error('AiSteth device is not connected. Please connect first.');
        }
        if (!connectedDeviceRef.current.name?.toLowerCase().includes('aisteth')) {
          throw new Error('Please connect to an AiSteth device before recording');
        }

        console.log('=== Verifying audio routing before recording ===');
        const audioStatus = await StethoscopeRecorder.verifyBluetoothAudioActive();
        console.log('Audio status:', audioStatus);

        if (!audioStatus.readyToRecord) {
          console.warn('Audio not ready, re-enabling Bluetooth mic...');
          if (Platform.Version >= 31) {
            await AudioRoutingManager.enableBluetoothMicModern(connectedDeviceRef.current.address);
          } else {
            await AudioRoutingManager.enableBluetoothMicOnly(connectedDeviceRef.current.address);
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }

        console.log('=== Starting recording from AiSteth ===');
        console.log('Connected device:', connectedDeviceRef.current.name);
        const result = await StethoscopeRecorder.startRecording(filename);
        console.log('Recording started successfully:', result);

        setCurrentRecording(result);
        setIsRecording(true);
        setIsPaused(false);
        return result;
      } catch (err) {
        console.error('Start recording error:', err);
        const errorMessage = err.message || 'Failed to start recording';
        setError(errorMessage);
        throw err;
      } finally {
        setIsRecordingLoading(false);
      }
    },
    []
  );

  const stopRecording = useCallback(async () => {
    setIsRecordingLoading(true);
    setError(null);
    try {
      console.log('=== Stopping recording ===');
      const result = await StethoscopeRecorder.stopRecording();
      console.log('Recording stopped:', result);

      setCurrentRecording(null);
      setIsRecording(false);
      setIsPaused(false);

      await AudioRoutingManager.restoreNormalAudio();
      console.log('Phone speaker output restored');

      await loadRecordings();
      return result;
    } catch (err) {
      console.error('Stop recording error:', err);
      const errorMessage = err.message || 'Failed to stop recording';
      setError(errorMessage);
      throw err;
    } finally {
      setIsRecordingLoading(false);
    }
  }, []);

  const pauseRecording = useCallback(async () => {
    try {
      console.log('Pausing recording');
      await StethoscopeRecorder.pauseRecording();
      setIsPaused(true);
    } catch (err) {
      console.error('Pause recording error:', err);
      setError(err.message || 'Failed to pause recording');
      throw err;
    }
  }, []);

  const resumeRecording = useCallback(async () => {
    try {
      console.log('Resuming recording');
      await StethoscopeRecorder.resumeRecording();
      setIsPaused(false);
    } catch (err) {
      console.error('Resume recording error:', err);
      setError(err.message || 'Failed to resume recording');
      throw err;
    }
  }, []);

  const disconnect = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      console.log('=== Disconnecting AiSteth device ===');
      await StethoscopeRecorder.disconnectDevice();
      await AudioRoutingManager.restoreNormalAudio();
      console.log('Phone speaker output restored');

      //  Reset audio ready on disconnect
      isAudioReadyRef.current = false;
      dispatch(disconnectDevice()); // resets isAudioReady via slice

      setIsRecording(false);
      setIsPaused(false);
      setCurrentRecording(null);
      console.log('=== AiSteth disconnected ===');
    } catch (err) {
      console.error('Disconnect error:', err);
      setError(err.message || 'Failed to disconnect');
    } finally {
      setIsLoading(false);
    }
  }, [dispatch]);

  const loadRecordings = useCallback(async () => {
    try {
      const recordingsList = await StethoscopeRecorder.getRecordings();
      console.log('Loaded recordings:', recordingsList.length);
      setRecordings(recordingsList);
    } catch (err) {
      console.error('Failed to load recordings:', err);
    }
  }, []);

  const deleteRecording = useCallback(
    async (filePath) => {
      try {
        console.log('Deleting recording:', filePath);
        await StethoscopeRecorder.deleteRecording(filePath);
        await loadRecordings();
      } catch (err) {
        console.error('Delete recording error:', err);
        setError(err.message || 'Failed to delete recording');
        throw err;
      }
    },
    [loadRecordings]
  );

  return {
    isConnected,
    connectedDevice,
    isAudioReady,
    isAudioReadyRef,
    isRecording,
    isPaused,
    amplitude,
    devices,
    recordings,
    isLoading,
    isConnecting,
    isRecordingLoading,
    error,
    currentRecording,
    amplitudeHistory: amplitudeHistory.current,
    checkBluetoothEnabled,
    getPairedDevices,
    connect,
    startRecording,
    stopRecording,
    pauseRecording,
    resumeRecording,
    disconnect,
    loadRecordings,
    deleteRecording,
    clearError: () => setError(null),
  };
};
