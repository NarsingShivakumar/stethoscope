import { useEffect } from 'react';
import { PermissionsAndroid, Alert, Platform, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import SplashScreen from 'react-native-splash-screen';
import requestBluetooth from './utils/BluetoothUtils';
import i18next from 'i18next';

const { AudioRoutingManager } = NativeModules;

const requestPermissions = async () => {
  try {
    const permissions = [
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ];
    if (Platform.OS === 'android' && Platform.Version > 31) {
      permissions.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
      permissions.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
    }

    const grantedPermissions = await PermissionsAndroid.requestMultiple(permissions);
    const allPermissionsGranted = permissions.every(
      permission => grantedPermissions[permission] === PermissionsAndroid.RESULTS.GRANTED
    );

    return allPermissionsGranted;
  } catch (err) {
    console.warn(err);
    return false;
  }
};

const disableBluetoothAudioRouting = async () => {
  try {
    console.log('=== Disabling Bluetooth audio routing ===');
    if (AudioRoutingManager?.disableBluetoothAudio) {
      await AudioRoutingManager.disableBluetoothAudio();
      await new Promise(resolve => setTimeout(resolve, 1500));
      const status = await AudioRoutingManager.getCurrentAudioRoute();
      console.log('Audio status after disable:', status);
    }
  } catch (error) {
    console.error('Error disabling Bluetooth audio routing:', error);
  }
};

const Splash = ({ navigation }) => {
  useEffect(() => {
    const initializeApp = async () => {
      const getLanguage = async () => {
        return (await AsyncStorage.getItem("LANGUAGE")) || "en";
      };

      const [permissionsGranted, bluetoothEnabled, selectedLanguage] =
        await Promise.all([
          requestPermissions(),
          requestBluetooth(),
          getLanguage(),
        ]);

      if (!i18next.isInitialized) {
        await i18next.init({
          lng: selectedLanguage, // Set the initial language here
          fallbackLng: 'en',
          resources: {}, // Pass your translation bundles here if needed
        });
      } else {
        // If it is initialized, shifting languages works normally
        await i18next.changeLanguage(selectedLanguage);
      }
      if (!permissionsGranted || !bluetoothEnabled) {
        Alert.alert(
          'Permissions Required',
          'This app requires camera, mic, notification and bluetooth to function properly.',
          [{ text: 'OK', onPress: () => initializeApp() }],
        );
        return;
      }

      await disableBluetoothAudioRouting();

      // Clear/hide the native boot overlay before updating the view stack state
      try {
        SplashScreen.hide();
      } catch (e) {
        console.warn('Native splash hide skipped:', e);
      }

      // Directly transition routing context into your target landing home screen sequence
      navigation.replace('AiStethHomeScreen');
    };

    initializeApp();
  }, [navigation]);

  return null;
};

export default Splash;