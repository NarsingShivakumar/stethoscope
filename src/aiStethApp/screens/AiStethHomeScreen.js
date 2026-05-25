import React, {
  useCallback,
  useEffect,
  useState,
  memo,
} from 'react';
import { View, StyleSheet, Alert, StatusBar, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigation, useRoute } from '@react-navigation/native';

import { useStethoscope } from '../hooks/useStethoscope';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { DeviceConnectionSection } from '../components/sections/DeviceConnectionSection';
import { RecordingSection } from '../components/sections/RecordingSection';
// import  AnalrysisSection  from '../components/sections/AnalysisSection';
import { PreviousRecordingsScreen } from './PreviousRecordingsScreen';

import { COLORS, SPACING, FONTS } from '../constants/theme';
import {
  createPatient,
  selectCurrentPatient,
  selectCreatePatientLoading,
  clearPatientData,
} from '../../store/slices/aiStethSlices/AiStethPatientSlice';
import { convertTimestampToDate, generateFileNumberFromPatientId } from '../utils/aiStethUtils';
import {
  clearAllAnalysisData,
  selectAIAnalysis,
  selectCurrentAnalysisSession,
  selectVisualization,
  selectAudioUrl,
} from '../../store/slices/aiStethSlices/AiStethAnalysisSlice';
import {
  clearAllRecordingData,
  selectCompleteUploadResult,
} from '../../store/slices/aiStethSlices/AiStethRecordingSlice';

// FIX: Ensure this path correctly points to your VitalsSlice file location
import { setAiStethScreen } from '../../store/slices/VitalSlice';
import { APP_CONFIG, debugLog, debugError } from '../../config/AppConfig';
import { t } from 'i18next';
import AnalysisSection from '../components/sections/AnalysisSection';
// import AnalysisSection from '../components/sections/AnalysisSection';

function AiStethHomeScreen() {
  const dispatch = useDispatch();
  const navigation = useNavigation();
  const route = useRoute();

  // Extract navigation parameters passed down through the router stack
  const { clearOnEntry = false, returnToStepIndex = 0 } = route.params ?? {};

  const stethoscope = useStethoscope();
  const audioPlayer = useAudioPlayer();

  const currentPatient = useSelector(selectCurrentPatient);
  const createPatientLoading = useSelector(selectCreatePatientLoading);
  const aiAnalysis = useSelector(selectAIAnalysis);
  const analysisSession = useSelector(selectCurrentAnalysisSession);
  const uploadResult = useSelector(selectCompleteUploadResult);
  const visualization = useSelector(selectVisualization);
  const audioUrl = useSelector(selectAudioUrl);

  // FIX: Access state using 'vitals' key to match the configured Redux Slice name
  const vitalsDataInfo = useSelector(state => state.vitals || {});

  // Initialize view state layer from global configuration state records
  const initialScreen = vitalsDataInfo.aiStethScreen || 'device';
  const [currentScreen, setCurrentScreen] = useState(initialScreen);
  const [isInitializing, setIsInitializing] = useState(false);

  const goToScreen = useCallback(
    (screen) => {
      setCurrentScreen(screen);
      dispatch(setAiStethScreen(screen)); // Synchronize screen status back into Redux cache layers
    },
    [dispatch]
  );

  // Trigger setup tasks when the screen layer establishes context initialization
  useEffect(() => {
    initializeScreen({ clear: clearOnEntry });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearOnEntry]);

  // Handle hardware tracking and session clearing routines upon view termination
  useEffect(() => {
    return () => {
      if (stethoscope.isConnected) {
        debugLog('[HomeScreen] Exiting standalone screen - breaking sensor peripheral loop');
        try {
          if (typeof stethoscope.disconnect === 'function') {
            stethoscope.disconnect();
          }
        } catch (e) {
          debugError('[HomeScreen] Disconnection clean-up failure:', e);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stethoscope.isConnected]);

  // Handle automated workflow routing triggers on audio stream verification loops
  useEffect(() => {
    if (stethoscope.isConnected && stethoscope.isAudioReady && currentScreen === 'device') {
      debugLog('[HomeScreen] Active socket link established, routing into workspace layer');
      goToScreen('recording');
    }
  }, [stethoscope.isConnected, stethoscope.isAudioReady, currentScreen, goToScreen]);

  useEffect(() => {
    if (!stethoscope.isConnected || currentScreen !== 'device') return;

    if (stethoscope.isAudioReady) {
      goToScreen('recording');
      return;
    }

    const fallbackTimer = setTimeout(() => {
      if (stethoscope.isAudioReadyRef.current || stethoscope.isConnected) {
        debugLog('[HomeScreen] Standard pipeline initialization timeout fallback executed');
        goToScreen('recording');
      }
    }, 3000);

    return () => clearTimeout(fallbackTimer);
  }, [stethoscope.isConnected, stethoscope.isAudioReady, currentScreen, goToScreen, stethoscope.isAudioReadyRef]);

  const initializeScreen = useCallback(
    async ({ clear = false } = {}) => {
      try {
        setIsInitializing(true);

        if (clear) {
          dispatch(clearAllAnalysisData());
          dispatch(clearAllRecordingData());
          dispatch(clearPatientData());
          goToScreen('device');
        }

        await initializeBluetooth();

        if (clear) {
          await loadPatientDataFromStorage();
        } else if (!currentPatient?.uniqueId) {
          debugLog('[HomeScreen] Local patient dataset incomplete, reviewing local database layers');
          await loadPatientDataFromStorage();
        } else {
          debugLog('[HomeScreen] Patient index active, cross-checking snapshot records');

          const hasAnalysisData = !!(
            aiAnalysis ||
            analysisSession?.fileName ||
            uploadResult?.fileName ||
            visualization ||
            audioUrl ||
            vitalsDataInfo?.aisteth
          );

          if (hasAnalysisData && (initialScreen === 'analysis' || initialScreen === 'recording')) {
            setCurrentScreen(initialScreen);
          } else if (hasAnalysisData) {
            goToScreen('analysis');
          } else if (initialScreen && initialScreen !== 'device') {
            setCurrentScreen(initialScreen);
          }
        }
      } catch (error) {
        debugError('[HomeScreen] Workflow initialization error:', error);
      } finally {
        setIsInitializing(false);
      }
    },
    [dispatch, goToScreen, currentPatient?.uniqueId, aiAnalysis, analysisSession, uploadResult, visualization, audioUrl, vitalsDataInfo?.aisteth, initialScreen]
  );

  const initializeBluetooth = useCallback(async () => {
    try {
      const enabled = await stethoscope.checkBluetoothEnabled();
      if (!enabled) {
        Alert.alert('Bluetooth Disabled', 'Please enable Bluetooth to use this app.', [{ text: 'OK' }]);
        return;
      }
      await stethoscope.getPairedDevices();
    } catch (err) {
      debugError('[HomeScreen] Bluetooth initialization error:', err);
    }
  }, [stethoscope]);

  const transformToAiStethFormat = useCallback((patient) => {
    if (!patient) return null;

    const rawId = patient.employeeId || patient.patientId;
    const rawPhone = patient.mobileNumber || patient.contactNumber;

    const fileNumber = generateFileNumberFromPatientId(rawId);
    const dateOfBirth = convertTimestampToDate(patient.dateOfBirth);
    const age = calculateAge(patient.dateOfBirth);

    let firstName = '';
    let lastName = '';

    if (patient.firstName || patient.lastName) {
      firstName = patient.firstName || '';
      lastName = patient.lastName || '';
    } else if (patient.name) {
      [firstName = '', lastName = ''] = patient.name.split(' ');
    }

    return {
      firstName,
      lastName,
      fileNumber,
      age: age?.toString() || '',
      gender: patient.gender || '',
      dateOfBirth,
      phone: rawPhone || '',
      email: patient.email || '',
    };
  }, []);

  const loadPatientDataFromStorage = useCallback(async () => {
    try {
      let patientSource = {
        "patientId": "E97099",
        "firstName": "MADHU",
        "lastName": null,
        "dateOfBirth": 942863400000,
        "gender": "MALE",
        "contactNumber": "9807098834",
        "email": null,
        "address": null,
        "patientDeceased": false,
        "maritalStatus": null,
        "takingMedications": null,
        "medicationsdetails": null,
        "symptoms": null,
        "diagnosis": null,
        "profilePicture": null,
        "emergencyFirstName": null,
        "emergencyLastName": null,
        "emergencyRelation": null,
        "emergencyContactNumber": null,
        "visits": [
          {
            "id": "VST0903202600005",
            "visitedAt": "2026-04-15T09:54:09.243+00:00",
            "patientEntity": null,
            "medicalReports": null,
            "surgeryMedicationHistory": null,
            "healthProfile": {
              "id": "a9e701ea-5a5c-4ab6-8518-edf95723d015",
              "pregnant": null,
              "smoking": "NO",
              "drinkingAlcohol": null,
              "harmfulSubstance": null,
              "specialDiet": null,
              "allergies": null,
              "havingSurgery": null,
              "takingMedications": null,
              "medicationHistory": null,
              "surgeryHistory": null,
              "allergiesData": null,
              "isPriorityPatient": false,
              "priorityPatient": false
            },
            "vitalSigns": {
              "id": "b16a6f44-6abc-4b6b-9144-605b6119a6e0",
              "bloodPressure": null,
              "heartRate": 0,
              "temperature": 0,
              "heightCm": 0,
              "weightKg": 0,
              "spo2Percentage": 0,
              "fastingBloodSugar": 0,
              "randomBloodSugar": 0,
              "beforeMealBloodSugar": 0,
              "afterMealBloodSugar": 0,
              "symptoms": null,
              "ecgData": null,
              "bodyMassIndex": 0,
              "spirometerData": null,
              "eyeTestData": null,
              "fitnessScore": 0,
              "healthRiskStatus": "INSUFFICIENT_DATA",
              "twelveLeadEcg": null,
              "audiometryFile": null,
              "xray": null,
              "hemoglobin": null
            },
            "employeeId": "DOC1",
            "audioFile": "1775221238336_recorded_file.mp4",
            "prescription": {
              "id": "90f91efe-45a8-4600-bb09-c9bdd321809d",
              "diagnosis": null,
              "medicineDTOs": null,
              "preferredAdvice": null,
              "symptomsName": [],
              "testName": [],
              "pathLabTest": null,
              "prescriptionFile": null,
              "patientSummary": null,
              "medicalHistory": null,
              "symptomsContent": null,
              "suggestedDoctor": null,
              "patientCondition": null,
              "translatedConversation": null,
              "loincTests": []
            },
            "spirometryDataEntity": {
              "id": "b62961bd-d810-4faf-8a7d-41313d9c5b8c",
              "visitId": "VST0903202600005",
              "diagnosis": "Moderate Obstructive Pattern",
              "fev1": 2.2,
              "fev1Fvc": 45.08196721311476,
              "fev1FvcLLN": 0,
              "fev1Pct": 58.981233243967836,
              "fev1Pred": 3.73,
              "fvc": 4.88,
              "fvcPct": 109.9099099099099,
              "fvcPred": 4.44,
              "pattern": "OBSTRUCTIVE",
              "ratioUsed": 0.4508196721311476,
              "sessionScore": "Grade C",
              "severity": "MODERATE",
              "isBonchodilatorPositive": false,
              "bonchodilatorPositive": false
            },
            "visionTestDataEntity": {
              "id": "239df2ff-abed-41bd-997d-adf7528a35bb",
              "visitId": "VST0903202600005",
              "history": "",
              "visionWithColorVision": "Red-Green Deficiency",
              "visionWithContrastSensitivity": "--",
              "visionWithDistanceLPower": null,
              "visionWithDistanceLeft": null,
              "visionWithDistanceRPower": null,
              "visionWithDistanceRight": null,
              "visionWithNearLPower": null,
              "visionWithNearLeft": null,
              "visionWithNearRPower": null,
              "visionWithNearRight": null,
              "visionWithoutDistanceLeft": null,
              "visionWithoutDistanceRight": null,
              "visionWithoutNearLeft": null,
              "visionWithoutNearRight": null
            },
            "doctorName": "ARCHANA",
            "patientTranslationLanguage": null,
            "loincTestNames": null,
            "xrayFile": null,
            "medicalCertificate": "1775221224787_medicalCertificate.pdf",
            "aiStethEntity": null,
            "campId": "9a1c263c-2536-4005-a7ee-f1fc1cc77883",
            "freeConsultationAvailed": false
          }
        ]
      };

      const aiStethPatientData = transformToAiStethFormat(patientSource);
      if (!aiStethPatientData) return;

      const result = await dispatch(createPatient(aiStethPatientData)).unwrap();

      await AsyncStorage.setItem('aiStethPatientId', result.uniqueId);
      await AsyncStorage.setItem('aiStethFileNumber', result.fileNumber);

    } catch (error) {
      debugError('[HomeScreen] Error creating AI Steth patient profile:', error);
    }
  }, [dispatch, transformToAiStethFormat]);

  const handleRetakeRecording = useCallback(() => {
    dispatch(clearAllAnalysisData());
    dispatch(clearAllRecordingData());
    goToScreen('device');
  }, [dispatch, goToScreen]);

  // Route processing execution backward flow handler to SensorVitals dashboard
  const handleReturnToVitalsDashboard = useCallback(() => {
    navigation.navigate('SensorVitals', { selectedIndex: returnToStepIndex });
  }, [navigation, returnToStepIndex]);

  if (isInitializing || createPatientLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>
          {createPatientLoading ? `${t("setting_up_profile")}...` : t("initializing")}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      {/* Screen Title Navigation Header bar replacement */}
      <View style={styles.customNavigationHeader}>
        <TouchableOpacity style={styles.headerReturnButton} onPress={handleReturnToVitalsDashboard}>
          <Text style={styles.headerReturnText}>← {t('Back to Vitals Dashboard') || 'Back to Vitals'}</Text>
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

      {currentScreen === 'analysis' && <AiStethAnalysisSection onRetake={handleRetakeRecording} />}

      {currentScreen === 'recordings' && APP_CONFIG.ENABLE_RECORDINGS_LIST && (
        <RecordingsListSection
          stethoscope={stethoscope}
          audioPlayer={audioPlayer}
          onBackToDevices={() => goToScreen('device')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
  },
  customNavigationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    height: 56,
    paddingHorizontal: SPACING.md,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  headerReturnButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginRight: SPACING.md,
  },
  headerReturnText: {
    color: '#FFF',
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  headerScreenTitle: {
    color: '#FFF',
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background
  },
  loadingText: {
    marginTop: SPACING.md,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary
  },
  errorBanner: {
    backgroundColor: COLORS.error + '15',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md
  },
  errorText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.error,
    textAlign: 'center'
  },
});

export default memo(AiStethHomeScreen);