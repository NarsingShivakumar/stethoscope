// src/aiStethApp/screens/AiStethHomeScreen.js
//
// CHANGES FROM ORIGINAL (minimal — same routing/nav structure preserved):
//
//   REMOVED imports:
//     AsyncStorage
//     createPatient, selectCurrentPatient, selectCreatePatientLoading, clearPatientData
//     clearAllAnalysisData, selectAIAnalysis, selectCurrentAnalysisSession,
//     selectVisualization, selectAudioUrl
//     clearAllRecordingData, selectCompleteUploadResult
//     convertTimestampToDate, generateFileNumberFromPatientId, calculateAge
//     AiStethAnalysisSection
//     RecordingsListSection  (replaced by PreviousRecordingsScreen with Analyse)
//
//   ADDED imports:
//     AnalysisSection        (replaces AiStethAnalysisSection)
//     PreviousRecordingsScreen (updated with Analyse button)
//     clearSeparationData, selectHasResults from SeparationSlice
//
//   REMOVED functions:
//     loadPatientDataFromStorage()
//     transformToAiStethFormat()
//     createPatientLoading spinner logic
//
//   CHANGED initializeScreen():
//     Removed all patient creation, AsyncStorage, analysis session routing
//     Kept: bluetooth init, screen routing, animation logic
//
//   CHANGED handleRetakeRecording():
//     was: dispatch(clearAllAnalysisData()) + clearAllRecordingData() + clearPatientData()
//     now: dispatch(clearSeparationData())
//
//   KEPT IDENTICAL:
//     useNavigation / useRoute / navigation params (clearOnEntry, returnToStepIndex)
//     handleReturnToVitalsDashboard()
//     Custom nav header (← Back to Vitals)
//     Bluetooth auto-connect → recording routing
//     Error banner, styles

import React, {
  useCallback,
  useEffect,
  useState,
  memo,
} from 'react';
import { View, StyleSheet, Alert, StatusBar, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useStethoscope } from '../hooks/useStethoscope';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { DeviceConnectionSection } from '../components/sections/DeviceConnectionSection';
import { RecordingSection } from '../components/sections/RecordingSection';
import { AnalysisSection } from '../components/sections/AnalysisSection';
import { PreviousRecordingsScreen } from './PreviousRecordingsScreen';

import { COLORS, SPACING, FONTS } from '../constants/theme';
import { setAiStethScreen } from '../../store/slices/VitalSlice';
import {
  clearSeparationData,
  selectHasResults,
} from '../../store/slices/SeparationSlice';
import { APP_CONFIG, debugLog, debugError } from '../../config/AppConfig';
import { t } from 'i18next';

function AiStethHomeScreen() {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const route = useRoute();

  const { clearOnEntry = false, returnToStepIndex = 0 } = route.params ?? {};

  const stethoscope = useStethoscope();
  const audioPlayer = useAudioPlayer();
  const hasResults = useSelector(selectHasResults);
  const EMPTY_VITALS = {};
  const vitalsDataInfo = useSelector(state => state.vitals || EMPTY_VITALS);
  const initialScreen = vitalsDataInfo.aiStethScreen || 'device';

  const [currentScreen, setCurrentScreen] = useState(initialScreen);
  const [isInitializing, setIsInitializing] = useState(false);

  const goToScreen = useCallback(screen => {
    setCurrentScreen(screen);
    dispatch(setAiStethScreen(screen));
  }, [dispatch]);

  // Bluetooth connect → auto-navigate to recording
  useEffect(() => {
    if (stethoscope.isConnected && stethoscope.isAudioReady && currentScreen === 'device') {
      debugLog('[HomeScreen] Device connected + Audio ready → recording');
      goToScreen('recording');
    }
  }, [stethoscope.isConnected, stethoscope.isAudioReady, currentScreen, goToScreen]);

  useEffect(() => {
    if (!stethoscope.isConnected || currentScreen !== 'device') return;
    if (stethoscope.isAudioReady) { goToScreen('recording'); return; }
    const fallbackTimer = setTimeout(() => {
      if (stethoscope.isAudioReadyRef.current || stethoscope.isConnected) {
        goToScreen('recording');
      }
    }, 3000);
    return () => clearTimeout(fallbackTimer);
  }, [stethoscope.isConnected, stethoscope.isAudioReady, currentScreen, goToScreen, stethoscope.isAudioReadyRef]);

  // On mount / clearOnEntry
  useEffect(() => {
    initializeScreen({ clear: clearOnEntry });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearOnEntry]);

  // Disconnect on unmount
  useEffect(() => {
    return () => {
      if (stethoscope.isConnected) {
        debugLog('[HomeScreen] Exiting — disconnecting device');
        try { if (typeof stethoscope.disconnect === 'function') stethoscope.disconnect(); }
        catch (e) { debugError('[HomeScreen] Disconnect error:', e); }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stethoscope.isConnected]);

  // Navigate to analysis if results already exist when re-entering
  useEffect(() => {
    if (hasResults &&
      (initialScreen === 'analysis' || initialScreen === 'recording')) {
      setCurrentScreen(initialScreen);
    } else if (hasResults && initialScreen === 'device') {
      goToScreen('analysis');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResults]);

  const initializeScreen = useCallback(async ({ clear = false } = {}) => {
    try {
      setIsInitializing(true);

      if (clear) {
        dispatch(clearSeparationData());
        goToScreen('device');
      }

      await initializeBluetooth();

      // If returning with existing results, stay on analysis screen
      if (!clear && hasResults) {
        if (initialScreen === 'analysis') setCurrentScreen('analysis');
      }

    } catch (error) {
      debugError('[HomeScreen] Workflow initialization error:', error);
    } finally {
      setIsInitializing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, goToScreen, hasResults, initialScreen]);

  const initializeBluetooth = useCallback(async () => {
    try {
      const enabled = await stethoscope.checkBluetoothEnabled();
      if (!enabled) {
        Alert.alert('Bluetooth Disabled',
          'Please enable Bluetooth to use this app.', [{ text: 'OK' }]);
        return;
      }
      await stethoscope.getPairedDevices();
    } catch (err) {
      debugError('[HomeScreen] Bluetooth initialization error:', err);
    }
  }, [stethoscope]);

  const handleRetakeRecording = useCallback(() => {
    dispatch(clearSeparationData());
    goToScreen('device');
  }, [dispatch, goToScreen]);

  const handleReturnToVitalsDashboard = useCallback(() => {
    navigation.navigate('LandingScreen', { selectedIndex: returnToStepIndex });
  }, [navigation, returnToStepIndex]);

  if (isInitializing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>{t('initializing')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      {/* Custom header — identical to original */}
      <View style={styles.customNavigationHeader}>
        <TouchableOpacity
          style={styles.headerReturnButton}
          onPress={handleReturnToVitalsDashboard}>
          <Text style={styles.headerReturnText}>
            ← {t('Back to Vitals Dashboard') || 'Back to Vitals'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.headerScreenTitle}>{t('ai_steth')}</Text>
      </View>

      {stethoscope.error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠️ {stethoscope.error}</Text>
        </View>
      )}

      {currentScreen === 'device' && (
        <DeviceConnectionSection
          stethoscope={stethoscope}
          onRecordingRequested={() => goToScreen('recording')}
          onRecordingsRequested={() => goToScreen('recordings')}
        />
      )}

      {currentScreen === 'recording' && (
        <RecordingSection
          stethoscope={stethoscope}
          onBackToDevices={() => goToScreen('device')}
          onShowAnalysis={() => goToScreen('analysis')}
        />
      )}

      {/* REPLACED: AiStethAnalysisSection → AnalysisSection */}
      {currentScreen === 'analysis' && (
        <AnalysisSection onRetake={handleRetakeRecording} />
      )}

      {/* REPLACED: RecordingsListSection → PreviousRecordingsScreen (with Analyse) */}
      {currentScreen === 'recordings' && APP_CONFIG.ENABLE_RECORDINGS_LIST && (
        <PreviousRecordingsScreen
          stethoscope={stethoscope}
          audioPlayer={audioPlayer}
          onBackToDevices={() => goToScreen('device')}
          onShowAnalysis={() => goToScreen('analysis')}
        />
      )}
    </View>
  );
}

// ── Styles — identical to original ───────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  customNavigationHeader: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primary, height: 56,
    paddingHorizontal: SPACING.md, elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 3,
  },
  headerReturnButton: {
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
    borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)',
    marginRight: SPACING.md,
  },
  headerReturnText: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '600' },
  headerScreenTitle: { color: '#FFF', fontSize: FONTS.sizes.lg, fontWeight: 'bold' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  loadingText: { marginTop: SPACING.md, fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  errorBanner: { backgroundColor: COLORS.error + '15', paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md },
  errorText: { fontSize: FONTS.sizes.sm, color: COLORS.error, textAlign: 'center' },
});

export default memo(AiStethHomeScreen);