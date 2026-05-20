// src/components/sections/DeviceConnectionSection.js

import React, { useState, useCallback, memo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Animated,
  Image,
} from 'react-native';
import { SPACING, FONTS, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { useDispatch } from 'react-redux';
import { clearAllAnalysisData } from '../../../store/slices/aiStethSlices/AiStethAnalysisSlice';
import { debugLog } from '../../../config/AppConfig';
import { APP_CONFIG } from '../../../config/AppConfig';
import LinearGradient from 'react-native-linear-gradient';
import { t } from 'i18next';

const InstructionStep = memo(({ number, text }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      delay: parseInt(number) * 100,
      useNativeDriver: true,
    }).start();
  }, []);

  return (
    <Animated.View style={[styles.instructionStep, { opacity: fadeAnim }]}>
      <LinearGradient
        colors={['#4A90E2', '#5BA3F5']}
        style={styles.instructionNumber}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Text style={styles.instructionNumberText}>{number}</Text>
      </LinearGradient>
      <View style={styles.instructionTextContainer}>
        <Text style={styles.instructionText}>{text}</Text>
      </View>
    </Animated.View>
  );
});

// Circular Connect Button Component
const CircularConnectButton = memo(({ device, isConnected, onPress, isLoading, disabled }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isConnected) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.05,
            duration: 1500,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1500,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isConnected]);

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.95,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 50,
      friction: 3,
      useNativeDriver: true,
    }).start();
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || isLoading}
      activeOpacity={0.9}
      style={styles.circularButtonWrapper}
    >
      <Animated.View
        style={[
          styles.circularButtonOuter,
          { transform: [{ scale: Animated.multiply(scaleAnim, pulseAnim) }] }
        ]}
      >
        {/* Outer ring with gradient border */}
        <LinearGradient
          colors={isConnected ? ['#A8E6CF', '#C8F5DC', '#E0F9EF'] : ['#FFB8C8', '#FFD4E0', '#FFE8EF']}
          style={styles.circularButtonBorder}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          {/* Inner button */}
          <LinearGradient
            colors={
              isLoading
                ? ['#D1D5DB', '#E5E7EB']
                : isConnected
                  ? ['#4CAF93', '#5EC4A6', '#6FD9BA']
                  : ['#E63946', '#F25C66', '#FF7B87']
            }
            style={styles.circularButtonInner}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            {isLoading ? (
              <View style={styles.circularButtonContent}>
                <ActivityIndicator size="large" color="#FFFFFF" />
                <Text style={styles.circularButtonText}>{t("connecting").toUpperCase()}</Text>
              </View>
            ) : (
              <View style={styles.circularButtonContent}>
                <Text style={styles.circularButtonText}>
                  {isConnected ? 'CONNECTED' : 'TOUCH'}
                </Text>
                <Text style={styles.circularButtonText}>
                  {isConnected ? 'TAP TO START' : 'HERE'}
                </Text>
                <View style={styles.circularButtonUnderline} />
              </View>
            )}
          </LinearGradient>
        </LinearGradient>
      </Animated.View>
    </TouchableOpacity>
  );
});

export const DeviceConnectionSection = memo(({
  stethoscope,
  onRecordingRequested,
  onRecordingsRequested,
}) => {
  const dispatch = useDispatch();

  const {
    isConnected,
    devices,
    connectedDevice,
    isLoading,
    isConnecting,
    getPairedDevices,
    connect,
    disconnect,
  } = stethoscope;

  const [refreshing, setRefreshing] = useState(false);
  const [connectingDeviceAddress, setConnectingDeviceAddress] = useState(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;


  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 20,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await getPairedDevices();
    } finally {
      setRefreshing(false);
    }
  }, [getPairedDevices]);

  const handleDevicePress = useCallback(async (device) => {
    if (connectedDevice?.address === device.address) {
      onRecordingRequested();
    } else {
      setConnectingDeviceAddress(device.address);
      try {
        dispatch(clearAllAnalysisData());
        await connect(device);
        debugLog('[DeviceConnection] Connected to device:', device.name);
      } catch (err) {
        Alert.alert('Connection Failed', 'Failed to connect to the device.');
      } finally {
        setConnectingDeviceAddress(null);
      }
    }
  }, [connectedDevice, connect, dispatch, onRecordingRequested]);

  const handleDisconnect = useCallback(async () => {
    Alert.alert(
      'Disconnect Device',
      `Are you sure you want to disconnect from ${connectedDevice?.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await disconnect();
          },
        },
      ]
    );
  }, [connectedDevice, disconnect]);

  const handleMainButtonPress = useCallback(() => {
    if (connectedDevice) {
      handleDevicePress(connectedDevice);

    } else if (devices.length > 0) {
      handleDevicePress(devices[0]);
    } else {
      Alert.alert(t("no_device_found"), t("no_aisteth_devices"));
    }
  }, [connectedDevice, devices, handleDevicePress]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} colors={['#4A90E2']} />
      }
      showsVerticalScrollIndicator={false}
    >
      {/* Hero Image/Video Section */}
      <Animated.View style={[styles.heroSection, { opacity: fadeAnim }]}>
        <LinearGradient
          colors={['#adcfd7', '#F8FBFF', '#adcfd7']}
          style={styles.heroGradient}
        >
          {/* Image Container */}
          <View style={styles.imageContainer}>
            <View style={styles.imageWrapper}>
              <Image
                source={require('../../../assets/aisteth.png')}
                style={styles.heroImage}
                resizeMode="contain"
              />
              {/* Decorative overlay */}
              {/* <View style={styles.imageOverlay}>
                <LottieView
                  source={require('../../../assets/lottie/heart.json')}
                  autoPlay
                  loop
                  style={styles.heroLottie}
                />
              </View> */}
            </View>
          </View>
          <View style={styles.aiStethTitleContainer}>
            <Text style={styles.aiStethTitle}>{t("ai_steth")}</Text>
          </View>


          {/* Instructions Section */}
          <View style={styles.sectionHeaderContainer}>
            <LinearGradient
              colors={['#4A90E2', '#5BA3F5']}
              style={styles.sectionTitleAccent}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            />
            <Text style={styles.sectionTitle}>{t("how_to_use")}</Text>
          </View>

          <View style={styles.instructionsCard}>
            <InstructionStep
              number="1"
              text={t("aisteth_instruction1")}
            />
            <InstructionStep
              number="2"
              text={t("aisteth_instruction2")}
            />
            <InstructionStep
              number="3"
              text={t("aisteth_instruction3")}
            />
            <InstructionStep
              number="4"
              text={t("aisteth_instruction4")}
            />
          </View>
          <Animated.View
            style={[
              styles.mainButtonSection,
              {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }]
              }
            ]}
          >
            {connectedDevice && (
              <View style={styles.connectedBadge}>
                <View style={styles.connectedDot} />
                <Text style={styles.connectedDeviceName}>
                  {connectedDevice.name}
                </Text>
              </View>
            )}

            <CircularConnectButton
              device={connectedDevice || devices[0]}
              isConnected={!!connectedDevice}
              onPress={handleMainButtonPress}
              isLoading={isConnecting || connectingDeviceAddress !== null}
              disabled={false}
            />

            {connectedDevice && (
              <TouchableOpacity
                style={styles.disconnectButtonWrapper}
                onPress={handleDisconnect}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={['#FF9E6D', '#FFB485', '#FFC99D']}
                  style={styles.disconnectButton}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <Text style={styles.disconnectButtonText}>✕ Disconnect Device</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </Animated.View>
        </LinearGradient>
      </Animated.View>

      {/* Main Circular Connect Button */}


      {/* Refresh Button for Available Devices */}
      {!connectedDevice && (
        <Animated.View
          style={[
            styles.refreshSection,
            { opacity: fadeAnim }
          ]}
        >
          <TouchableOpacity
            onPress={handleRefresh}
            disabled={isLoading}
            style={styles.refreshButtonContainer}
            activeOpacity={0.7}
          >
            <LinearGradient
              colors={['#E3F2FD', '#F0F7FF']}
              style={styles.refreshButtonGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.refreshText}>
                {isLoading ? `⏳ ${t("loading")}...` : `🔄 ${t("refresh_devices")}`}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {devices.length > 0 && (
            <View style={styles.deviceCountBadge}>
              <Text style={styles.deviceCountText}>
                {devices.length} device{devices.length !== 1 ? 's' : ''} found
              </Text>
            </View>
          )}
        </Animated.View>
      )}

      {/* View Recordings Button */}
      {APP_CONFIG.ENABLE_RECORDINGS_LIST && onRecordingsRequested && (
        <Animated.View
          style={[
            styles.recordingsSection,
            { opacity: fadeAnim }
          ]}
        >
          <TouchableOpacity
            style={styles.viewRecordingsButtonWrapper}
            onPress={onRecordingsRequested}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={['#FFFFFF', '#F8FBFF']}
              style={styles.viewRecordingsButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <View style={styles.recordingsIconContainer}>
                <Text style={styles.viewRecordingsIcon}>📁</Text>
              </View>
              <View style={styles.recordingsTextContainer}>
                <Text style={styles.viewRecordingsText}>View All Recordings</Text>
                <Text style={styles.viewRecordingsSubtext}>Access your saved recordings</Text>
              </View>
              <Text style={styles.recordingsChevron}>›</Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  contentContainer: {
    paddingBottom: SPACING.xl * 3,
  },

  // Hero Section
  heroSection: {
    marginBottom: SPACING.xl,
  },
  heroGradient: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
    ...SHADOWS.large,
  },
  imageContainer: {
    width: '100%',
    height: '30%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  imageWrapper: {
    width: '100%',
    height: '100%',
    position: 'relative',
    padding: 10,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  imageOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  heroLottie: {
    width: 180,
    height: 180,
    opacity: 0.5,
  },

  // Instructions Section
  instructionsSection: {
    padding: SPACING.xl,
    paddingTop: SPACING.xl,
  },
  sectionHeaderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    // marginBottom: SPACING.xs,
    paddingLeft: SPACING.lg,
  },
  sectionTitleAccent: {
    width: 4,
    height: 28,
    borderRadius: 2,
    marginRight: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '800',
    color: '#1E3A5F',
    letterSpacing: 0.5,
    paddingLeft: SPACING.sm
  },
  aiStethTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: '800',
    color: '#1E3A5F',
    letterSpacing: 0.5,
    paddingLeft: SPACING.sm
  },
  aiStethTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.sm,
    paddingLeft: SPACING.lg,
  },
  instructionsCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: 'rgba(74, 144, 226, 0.2)',
    margin: SPACING.sm,
    ...SHADOWS.medium,
  },
  instructionStep: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.lg,
  },
  instructionNumber: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
    ...SHADOWS.small,
  },
  instructionNumberText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  instructionTextContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  instructionText: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    color: '#475569',
    lineHeight: 22,
    fontWeight: '500',
  },

  // Main Button Section
  mainButtonSection: {
    alignItems: 'center',
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  connectedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.xl,
    marginBottom: SPACING.lg,
    ...SHADOWS.small,
  },
  connectedDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF93',
    marginRight: SPACING.sm,
  },
  connectedDeviceName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: '#2D6A5C',
  },

  // Circular Button Styles
  circularButtonWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: SPACING.lg,
  },
  circularButtonOuter: {
    width: 260,
    height: 260,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circularButtonBorder: {
    width: 230,
    height: 230,
    borderRadius: 115,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.large,
    elevation: 15,
  },
  circularButtonInner: {
    width: 200,
    height: 200,
    borderRadius: 100,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.35,
    shadowRadius: 15,
    elevation: 18,
  },
  circularButtonContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  circularButtonText: {
    fontSize: FONTS.sizes.l,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: 3,
    textAlign: 'center',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  circularButtonUnderline: {
    width: 70,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 2,
    marginTop: SPACING.sm,
  },

  // Disconnect Button
  disconnectButtonWrapper: {
    marginTop: SPACING.xl,
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    width: '85%',
    ...SHADOWS.medium,
  },
  disconnectButton: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  disconnectButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },

  // Refresh Section
  refreshSection: {
    alignItems: 'center',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.xl,
  },
  refreshButtonContainer: {
    width: '100%',
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    ...SHADOWS.medium,
  },
  refreshButtonGradient: {
    paddingVertical: SPACING.lg,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#4A90E2',
    borderRadius: BORDER_RADIUS.xl,
  },
  refreshText: {
    fontSize: FONTS.sizes.md,
    color: '#4A90E2',
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  deviceCountBadge: {
    marginTop: SPACING.md,
    backgroundColor: '#E3F2FD',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.xl,
  },
  deviceCountText: {
    fontSize: FONTS.sizes.sm,
    color: '#1976D2',
    fontWeight: '600',
  },

  // Recordings Section
  recordingsSection: {
    paddingHorizontal: SPACING.xl,
    marginTop: SPACING.xl,
  },
  viewRecordingsButtonWrapper: {
    borderRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    ...SHADOWS.medium,
  },
  viewRecordingsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    borderWidth: 2,
    borderColor: '#E3F2FD',
    borderRadius: BORDER_RADIUS.xl,
  },
  recordingsIconContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E3F2FD',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  viewRecordingsIcon: {
    fontSize: 24,
  },
  recordingsTextContainer: {
    flex: 1,
  },
  viewRecordingsText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '700',
    color: '#1E3A5F',
    marginBottom: 2,
  },
  viewRecordingsSubtext: {
    fontSize: FONTS.sizes.xs,
    color: '#64748B',
    fontWeight: '500',
  },
  recordingsChevron: {
    fontSize: 32,
    color: '#4A90E2',
    fontWeight: '300',
  },
});
