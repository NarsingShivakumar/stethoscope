// utils/BluetoothUtils.js
import { PermissionsAndroid, Platform } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';
const requestBluetooth = async () => {
  try {
    if (Platform.OS === 'android') {
      // Check if already enabled
      const isEnabled = await RNBluetoothClassic.isBluetoothEnabled();

      if (isEnabled) {
        console.log('Bluetooth is already enabled');
        return true;
      }
      // Request to enable Bluetooth
      const enabled = await RNBluetoothClassic.requestBluetoothEnabled();
      console.log('Bluetooth enabled:', enabled);
      return enabled;
    }

    return true; // iOS doesn't need explicit enabling
  } catch (error) {
    console.error('Bluetooth request error:', error);
    return false;
  }
};

export default requestBluetooth;