import React, {
  useCallback,
  useEffect,
  useState,
  memo,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { View, StyleSheet, Alert, StatusBar, ActivityIndicator, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch, useSelector } from 'react-redux';

import { useStethoscope } from '../hooks/useStethoscope';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { DeviceConnectionSection } from '../components/sections/DeviceConnectionSection';
import { RecordingSection } from '../components/sections/RecordingSection';
import { RecordingsListSection } from '../components/sections/RecordingsListSection';
import { AiStethAnalysisSection } from '../components/sections/AiStethAnalysisSection';

import { COLORS, SPACING, FONTS } from '../constants/theme';
import {
  createPatient,
  selectCurrentPatient,
  selectCreatePatientLoading,
  clearPatientData,
} from '../../store/slices/aiStethSlices/AiStethPatientSlice';
// import { calculateAge } from '../../Utils';
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
import { setAiStethScreen } from '../../store/slices/VitalSlice';
import { APP_CONFIG, debugLog, debugError } from '../../config/AppConfig';
import { t } from 'i18next';
import { calculateAge } from '../../utils/Utils';

const AiStethHomeScreen = forwardRef(
  (
    {
      // parent controls these
      isActive = false,
      entryId = 0,              // changes when step becomes active
      clearOnEntry = false,      // true only on FIRST entry
      initialScreen = 'device',  // device|recording|analysis|recordings
      onScreenChange,
    },
    ref
  ) => {
    const dispatch = useDispatch();
    const stethoscope = useStethoscope();
    const audioPlayer = useAudioPlayer();

    const currentPatient = useSelector(selectCurrentPatient);
    const createPatientLoading = useSelector(selectCreatePatientLoading);
    const aiAnalysis = useSelector(selectAIAnalysis);
    const analysisSession = useSelector(selectCurrentAnalysisSession);
    const uploadResult = useSelector(selectCompleteUploadResult);
    const visualization = useSelector(selectVisualization);
    const audioUrl = useSelector(selectAudioUrl);
    const vitalsDataInfo = useSelector(state => state.vitalsDataInfo);

    const [currentScreen, setCurrentScreen] = useState(initialScreen);
    const [isInitializing, setIsInitializing] = useState(false);

    const goToScreen = useCallback(
      (screen) => {
        setCurrentScreen(screen);
        dispatch(setAiStethScreen(screen)); // Save screen state to Redux
        onScreenChange?.(screen);
      },
      [onScreenChange, dispatch]
    );

    // keep local state in sync with parent saved screen (when user comes back)
    useEffect(() => {
      if (!isActive) return;
      if (initialScreen && initialScreen !== currentScreen) {
        setCurrentScreen(initialScreen);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, initialScreen]);

    //Only run init when THIS step becomes active (not on mount)
    useEffect(() => {
      if (!isActive) return;
      initializeScreen({ clear: clearOnEntry });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isActive, entryId]);

    //Disconnect device when component unmounts (user leaves AI Steth step)
    useEffect(() => {
      return () => {
        // Only disconnect if we're actually leaving (not just re-rendering)
        if (stethoscope.isConnected) {
          debugLog('[HomeScreen] Unmounting - disconnecting device');
          disconnectDevice();
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Auto-navigate to recording when device connects (same logic, but use goToScreen)
    useEffect(() => {
      if (stethoscope.isConnected && stethoscope.isAudioReady && currentScreen === 'device') {
        debugLog('[HomeScreen] Device connected + Audio ready, navigating to recording');
        goToScreen('recording');
      }
    }, [stethoscope.isConnected, stethoscope.isAudioReady, currentScreen, goToScreen]);

    useEffect(() => {
      if (!stethoscope.isConnected || currentScreen !== 'device') return;

      // Navigate immediately if audio is already ready
      if (stethoscope.isAudioReady) {
        debugLog('[HomeScreen] Device connected + Audio ready, navigating immediately');
        goToScreen('recording');
        return;
      }

      // Fallback: wait 3 seconds then navigate anyway
      debugLog('[HomeScreen] Device connected, waiting for audio ready (max 3s)...');
      const fallbackTimer = setTimeout(() => {
        if (stethoscope.isAudioReadyRef.current || stethoscope.isConnected) {
          debugLog('[HomeScreen] Fallback navigation triggered after 3s');
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
            //clear only when parent requests (first entry)
            dispatch(clearAllAnalysisData());
            dispatch(clearAllRecordingData());
            dispatch(clearPatientData());
            goToScreen('device');
          }

          // init bluetooth every time we re-enter (safe)
          await initializeBluetooth();

          //Only create patient on first entry OR if missing
          if (clear) {
            // First entry - always load patient
            await loadPatientDataFromStorage();
          } else if (!currentPatient?.uniqueId) {
            // Returning but patient is missing - try to reload from AsyncStorage
            debugLog('[HomeScreen] Patient missing, attempting to reload from storage');
            try {
              const storedPatientId = await AsyncStorage.getItem('aiStethPatientId');
              if (storedPatientId) {
                // Patient was created before, restore it to Redux
                debugLog('[HomeScreen] Found stored patient ID, restoring to Redux');
                await loadPatientDataFromStorage();
              } else {
                debugLog('[HomeScreen] No stored patient found, creating new');
                await loadPatientDataFromStorage();
              }
            } catch (err) {
              debugError('[HomeScreen] Error checking stored patient:', err);
              await loadPatientDataFromStorage();
            }
          } else {
            // Returning and patient exists - don't reload
            debugLog('[HomeScreen] Patient exists, skipping reload');

            // Check if analysis data exists
            const hasAnalysisData = !!(
              aiAnalysis ||
              analysisSession?.fileName ||
              uploadResult?.fileName ||
              visualization ||
              audioUrl ||
              vitalsDataInfo?.aisteth
            );

            debugLog('[HomeScreen] hasAnalysisData:', hasAnalysisData);
            debugLog('[HomeScreen] initialScreen:', initialScreen);

            // Navigate to appropriate screen based on existing data and saved screen
            if (hasAnalysisData && (initialScreen === 'analysis' || initialScreen === 'recording')) {
              // Analysis exists and was on analysis/recording screen - restore that screen
              debugLog('[HomeScreen] Restoring screen:', initialScreen);
              setCurrentScreen(initialScreen);
            } else if (hasAnalysisData) {
              // Has analysis data but initialScreen is something else - go to analysis
              debugLog('[HomeScreen] Analysis data exists, navigating to analysis');
              goToScreen('analysis');
            } else if (initialScreen && initialScreen !== 'device') {
              // No analysis but initialScreen suggests user was on another screen
              debugLog('[HomeScreen] No analysis, restoring screen:', initialScreen);
              setCurrentScreen(initialScreen);
            }
          }
        } catch (error) {
          debugError('[HomeScreen] Initialization error:', error);
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

      // Support both shapes
      const rawId = patient.employeeId || patient.patientId;
      const rawPhone = patient.mobileNumber || patient.contactNumber;

      const fileNumber = generateFileNumberFromPatientId(rawId);
      const dateOfBirth = convertTimestampToDate(patient.dateOfBirth);
      const age = calculateAge(patient.dateOfBirth);

      // Support both name formats
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
        let patientSource = null;

        if (!patientSource) {
          const patientDataJson = await AsyncStorage.getItem('patientData');
          console.log("patientDataJson::", patientDataJson)
          if (!patientDataJson) {
            Alert.alert('Patient Missing', 'No patient selected');
            return;
          }

          // patientSource = JSON.parse(patientDataJson);
          patientSource = {
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
          }
        }

        const aiStethPatientData =
          transformToAiStethFormat(patientSource);

        if (!aiStethPatientData) return;

        const result = await dispatch(
          createPatient(aiStethPatientData)
        ).unwrap();

        // Optional but recommended
        await AsyncStorage.setItem('aiStethPatientId', result.uniqueId);
        await AsyncStorage.setItem('aiStethFileNumber', result.fileNumber);

      } catch (error) {
        debugError('[HomeScreen] Error creating AI Steth patient:', error);


      }
    }, [dispatch, transformToAiStethFormat]);


    const handleRetakeRecording = useCallback(() => {
      dispatch(clearAllAnalysisData());
      dispatch(clearAllRecordingData());
      goToScreen('device');
    }, [dispatch, goToScreen]);

    //expose disconnect to parent
    const disconnectDevice = useCallback(async () => {
      try {
        if (typeof stethoscope.disconnect === 'function') return await stethoscope.disconnect();
        debugLog('[HomeScreen] disconnectDevice called:');

      } catch (e) {
        debugError('[HomeScreen] disconnectDevice error:', e);
      }
    }, [stethoscope]);

    useImperativeHandle(ref, () => ({ disconnectDevice }), [disconnectDevice]);

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
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background
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