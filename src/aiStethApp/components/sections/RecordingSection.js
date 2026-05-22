import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ScrollView,
    ActivityIndicator,
    Animated,
    Image,
} from 'react-native';
import { MedicalECGWaveform } from '../MedicalECGWaveform';
import {
    COLORS,
    SPACING,
    FONTS,
    BORDER_RADIUS,
    SHADOWS,
} from '../../constants/theme';
import { useDispatch, useSelector } from 'react-redux';
import { selectCurrentPatient } from '../../../store/slices/aiStethSlices/AiStethPatientSlice';
import {
    selectCompleteUploadError,
    selectCompleteUploadLoading,
    uploadRecordingComplete,
} from '../../../store/slices/aiStethSlices/AiStethRecordingSlice';
import { debugLog, debugError } from '../../../config/AppConfig';
import LottieView from 'lottie-react-native';
import LinearGradient from 'react-native-linear-gradient';
import { appliteColor } from '../../../assets/colors';
// import { setAiStethRecording, setVitalProcessing } from '../../../store/slices/VitalSlice';
import { t } from 'i18next';

const STOP_ENABLE_AFTER_MS = 20 * 1000;
const MAX_RECORDING_SEC = 40;


const StethPoint = memo(({ pt, isActive, pointStyle }) => {
    const pulseAnim = useRef(new Animated.Value(isActive ? 1.18 : 1)).current;
    const loopRef = useRef(null);

    useEffect(() => {
        if (isActive) {
            pulseAnim.setValue(1.18);
            loopRef.current = Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.38,
                        duration: 550,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1.18,
                        duration: 550,
                        useNativeDriver: true,
                    }),
                ])
            );
            loopRef.current.start();
        } else {
            if (loopRef.current) {
                loopRef.current.stop();
                loopRef.current = null;
            }
            Animated.timing(pulseAnim, {
                toValue: 1,
                duration: 200,
                useNativeDriver: true,
            }).start();
        }

        return () => {
            if (loopRef.current) {
                loopRef.current.stop();
                loopRef.current = null;
            }
        };
    }, [isActive]);

    return (
        <Animated.View
            style={[
                styles.stethPoint,
                pointStyle,
                { transform: [{ scale: pulseAnim }] },
            ]}
        >
            <Text style={styles.stethPointLabel}>{pt.label}</Text>
        </Animated.View>
    );
});


export const RecordingSection = memo(
    ({ stethoscope, onBackToDevices, onShowAnalysis }) => {
        const {
            isConnected,
            isRecording,
            isPaused,
            amplitude,
            amplitudeHistory,
            connectedDevice,
            isRecordingLoading,
            startRecording,
            stopRecording,
            disconnect,
            error,
        } = stethoscope;

        const dispatch = useDispatch();

        const currentPatient = useSelector(selectCurrentPatient);
        const completeUploadLoading = useSelector(selectCompleteUploadLoading);
        const completeUploadError = useSelector(selectCompleteUploadError);

        const [recordingDuration, setRecordingDuration] = useState(0);
        const [isStopEnabled, setIsStopEnabled] = useState(false);
        const [stopCountdownSec, setStopCountdownSec] = useState(0);

        const durationIntervalRef = useRef(null);
        const stopUnlockAtRef = useRef(null);
        const stopUnlockIntervalRef = useRef(null);

        // Animation values
        const fadeAnim = useRef(new Animated.Value(0)).current;
        const scaleAnim = useRef(new Animated.Value(0.9)).current;
        const buttonPulse = useRef(new Animated.Value(1)).current;

        // Entrance animation
        useEffect(() => {
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 600,
                    useNativeDriver: true,
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    tension: 50,
                    friction: 7,
                    useNativeDriver: true,
                }),
            ]).start();
        }, []);

        // Button pulse animation
        useEffect(() => {
            if (isRecording) {
                Animated.loop(
                    Animated.sequence([
                        Animated.timing(buttonPulse, {
                            toValue: 1.05,
                            duration: 1000,
                            useNativeDriver: true,
                        }),
                        Animated.timing(buttonPulse, {
                            toValue: 1,
                            duration: 1000,
                            useNativeDriver: true,
                        }),
                    ])
                ).start();
            } else {
                buttonPulse.setValue(1);
            }
        }, [isRecording]);

        useEffect(() => {
            if (isRecording && !isPaused) {
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                }
                durationIntervalRef.current = setInterval(() => {
                    setRecordingDuration(prev => prev + 1);
                }, 1000);
            } else {
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                    durationIntervalRef.current = null;
                }
            }

            return () => {
                if (durationIntervalRef.current) {
                    clearInterval(durationIntervalRef.current);
                    durationIntervalRef.current = null;
                }
            };
        }, [isRecording, isPaused]);

        useEffect(() => {
            const clearStopInterval = () => {
                if (stopUnlockIntervalRef.current) {
                    clearInterval(stopUnlockIntervalRef.current);
                    stopUnlockIntervalRef.current = null;
                }
            };

            if (isRecording) {
                const now = Date.now();
                stopUnlockAtRef.current = now + STOP_ENABLE_AFTER_MS;

                setIsStopEnabled(false);
                setStopCountdownSec(Math.ceil(STOP_ENABLE_AFTER_MS / 1000));

                clearStopInterval();

                stopUnlockIntervalRef.current = setInterval(() => {
                    const leftMs = (stopUnlockAtRef.current || 0) - Date.now();
                    const leftSec = Math.max(0, Math.ceil(leftMs / 1000));

                    setStopCountdownSec(leftSec);

                    if (leftMs <= 0) {
                        setIsStopEnabled(true);
                        clearStopInterval();
                    }
                }, 250);
            } else {
                setIsStopEnabled(false);
                setStopCountdownSec(0);
                stopUnlockAtRef.current = null;
                clearStopInterval();
            }

            return () => clearStopInterval();
        }, [isRecording]);
        // ✅ AUTO STOP AFTER 40 SECONDS
        useEffect(() => {
            if (isRecording && recordingDuration >= MAX_RECORDING_SEC) {
                debugLog('[RecordingSection] Max recording duration reached. Auto stopping...');

                // Only stop if stop is already allowed
                if (isStopEnabled) {
                    handleStopRecording();
                } else {
                    // If stop still locked (unlikely at 40s), force stop
                    stopRecording()
                        .then(result => {
                            if (result?.filePath) {
                                const filePath = result.filePath;
                                const fileName = filePath.split('/').pop();
                                handleUploadToAiSteth(fileName, filePath);
                            }
                        })
                        .catch(err => {
                            debugError('[RecordingSection] Auto stop error:', err);
                        });
                }
            }
        }, [
            recordingDuration,
            isRecording,
            isStopEnabled,
            handleStopRecording,
            stopRecording,
            handleUploadToAiSteth,
        ]);


        const formatDuration = useCallback(seconds => {
            const mins = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${mins.toString().padStart(2, '0')}:${secs
                .toString()
                .padStart(2, '0')}`;
        }, []);

        const handleStartRecording = useCallback(async () => {
            if (!isConnected) {
                Alert.alert('Not Connected', 'Please connect to a device first.');
                return;
            }

            if (!connectedDevice?.name?.toLowerCase().includes('aisteth')) {
                Alert.alert(
                    'Wrong Device',
                    'Please connect to an AiSteth device to record heart sounds.',
                    [{ text: 'OK' }],
                );
                return;
            }

            try {
                debugLog('[RecordingSection] Starting recording from AiSteth');
                // dispatch(setAiStethRecording(true));
                // dispatch(setVitalProcessing({ value: true }))
                setRecordingDuration(0);
                await startRecording();
            } catch (err) {
                debugError('[RecordingSection] Start recording error:', err);
                // dispatch(setAiStethRecording(false));
                Alert.alert(
                    'Recording Error',
                    'Failed to start recording: ' + (err.message || 'Unknown error'),
                );
            }
        }, [isConnected, connectedDevice, startRecording, dispatch]);

        const handleUploadToAiSteth = useCallback(
            async (fileName, filePath) => {
                if (!currentPatient || !currentPatient.uniqueId) {
                    Alert.alert(
                        'Missing Patient',
                        'AiSteth patient is not created yet. Please create patient first.',
                    );
                    return;
                }

                try {
                    debugLog('[RecordingSection] Starting uploadRecordingComplete...', {
                        fileName,
                        filePath,
                        patientUniqueId: currentPatient.uniqueId,
                    });

                    const notes = `Recorded on ${new Date().toLocaleString()} via AiSteth integration`;

                    const result = await dispatch(
                        uploadRecordingComplete({
                            fileName,
                            patientUniqueId: currentPatient.uniqueId,
                            filePath,
                            notes,
                        }),
                    ).unwrap();


                    try {
                        // await stethoscope.deleteRecording(filePath);
                        debugLog(
                            '[RecordingSection] Audio file deleted after successful upload:',
                            filePath,
                        );
                    } catch (deleteErr) {
                        debugError('[RecordingSection] Failed to delete audio file:', deleteErr);
                    }

                    debugLog('[RecordingSection] uploadRecordingComplete success:', result);

                    onShowAnalysis && onShowAnalysis();
                    await disconnect();

                } catch (err) {
                    debugError('[RecordingSection] uploadRecordingComplete error:', err);
                    Alert.alert(
                        'Upload Failed',
                        err?.userMessage ||
                        err?.message ||
                        'Failed to upload recording. Please try again.',
                    );
                }
            },
            [currentPatient, dispatch, disconnect, onShowAnalysis, stethoscope],
        );

        const handleStopRecording = useCallback(async () => {
            if (!isStopEnabled) {
                Alert.alert(
                    'Please Wait',
                    `Stop will be enabled in ${stopCountdownSec}s.`,
                );
                return;
            }

            try {
                const result = await stopRecording();
                debugLog('[RecordingSection] Recording stopped:', result);
                setRecordingDuration(0);

                if (!result?.filePath) {
                    Alert.alert(
                        'Recording Saved',
                        'Recording saved but file information is missing from native module.',
                    );
                    return;
                }

                const filePath = result.filePath;
                const fileName = filePath.split('/').pop();

                if (result?.filePath) {
                    handleUploadToAiSteth(fileName, filePath);
                }
            } catch (err) {
                debugError('[RecordingSection] Stop recording error:', err);
                Alert.alert(
                    'Error',
                    'Failed to stop recording: ' + (err.message || 'Unknown error'),
                );
            }
        }, [isStopEnabled, stopCountdownSec, stopRecording, handleUploadToAiSteth]);


        if (completeUploadLoading) {
            return (
                <View style={styles.loadingOverlay}>
                    <LottieView
                        source={require('../../../assets/lottie/heart.json')}
                        autoPlay
                        loop
                        style={styles.loadingLottie}
                    />
                    <Text style={styles.loadingText}>{t("uploading_recording")}</Text>
                    <Text style={styles.loadingSubtext}>{t("processing_data")}</Text>
                </View>
            );
        }

        if (!isConnected) {
            return (
                <Animated.View
                    style={[
                        styles.notConnectedContainer,
                        {
                            opacity: fadeAnim,
                            transform: [{ scale: scaleAnim }]
                        }
                    ]}
                >
                    <LottieView
                        source={require('../../../assets/lottie/heart.json')}
                        autoPlay
                        loop
                        style={styles.notConnectedLottie}
                    />
                    <Text style={styles.notConnectedTitle}>Device Not Connected</Text>
                    <Text style={styles.notConnectedText}>
                        Please connect to your AiSteth device to begin recording heart sounds.
                    </Text>
                    <TouchableOpacity
                        style={styles.gradientButton}
                        onPress={onBackToDevices}
                    >
                        <LinearGradient
                            colors={['#4A90E2', '#5BA3F5', '#6BB6FF']}
                            style={styles.gradientButtonInner}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <Text style={styles.gradientButtonText}>Connect Device</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </Animated.View>
            );
        }

        return (
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.contentContainer}
            >
                {/* Timer and Status */}
                <Animated.View
                    style={[
                        styles.statusBar,
                        {
                            opacity: fadeAnim,
                            transform: [{
                                translateY: Animated.multiply(fadeAnim.interpolate({
                                    inputRange: [0, 1],
                                    outputRange: [20, 0]
                                }), 1)
                            }]
                        }
                    ]}
                >
                    <LinearGradient
                        colors={isRecording ? ['#FF8A65', '#FFB69F'] : ['#E8EAF6', '#C5CAE9']}
                        style={styles.timerBadge}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <LottieView
                            source={require('../../../assets/lottie/heart.json')}
                            autoPlay
                            loop
                            style={styles.timerIcon}
                        />
                        <Text style={[styles.timerText, isRecording && styles.timerTextRecording]}>
                            {formatDuration(recordingDuration)}
                        </Text>
                    </LinearGradient>
                </Animated.View>
                {isRecording && (() => {
                    let activePoint = null;
                    if (recordingDuration < 10) activePoint = 'A';
                    else if (recordingDuration < 20) activePoint = 'P';
                    else if (recordingDuration < 30) activePoint = 'T';
                    else if (recordingDuration < 40) activePoint = 'M';


                    const points = [
                        { key: 'A', label: 'A', leftPct: 40, topPct: 37 },
                        { key: 'P', label: 'P', leftPct: 60, topPct: 38 },
                        { key: 'T', label: 'T', leftPct: 58, topPct: 54 },
                        { key: 'M', label: 'M', leftPct: 64, topPct: 68 },
                    ];


                    return (
                        <Animated.View style={[styles.stethImageCard, { opacity: fadeAnim }]}>
                            <Text style={styles.stethPointHint}>
                                {activePoint === 'A' && 'Aortic Area (0–10s)'}
                                {activePoint === 'P' && 'Pulmonary Area (10–20s)'}
                                {activePoint === 'T' && 'Tricuspid Area (20–30s)'}
                                {activePoint === 'M' && 'Mitral Area (30–40s)'}
                            </Text>
                            <View style={styles.stethImageWrapper}>
                                <Image
                                    source={require('../../../assets/aiStethChest.png')}
                                    style={styles.stethImage}
                                    resizeMode="contain"
                                />
                                {points.map(pt => {
                                    const isActive = pt.key === activePoint;
                                    return (
                                        <StethPoint
                                            key={pt.key}
                                            pt={pt}
                                            isActive={isActive}
                                            pointStyle={{
                                                left: `${pt.leftPct}%`,
                                                top: `${pt.topPct}%`,
                                                backgroundColor: isActive
                                                    ? '#2a5298'
                                                    : 'rgba(109,151,197,0.75)',
                                                borderWidth: isActive ? 2.5 : 0,
                                                borderColor: isActive ? '#fff' : 'transparent',
                                                shadowOpacity: isActive ? 0.45 : 0.15,
                                                elevation: isActive ? 8 : 2,
                                            }}
                                        />
                                    );
                                })}
                            </View>

                        </Animated.View>
                    );
                })()}


                {/* Medical ECG Display */}
                <Animated.View
                    style={{
                        opacity: fadeAnim,
                        transform: [{ scale: scaleAnim }]
                    }}
                >
                    <MedicalECGWaveform
                        amplitude={amplitude}
                        amplitudeHistory={amplitudeHistory}
                        isRecording={isRecording}
                        isPaused={isPaused}
                    />
                </Animated.View>

                {/* Error Display */}
                {error ? (
                    <Animated.View
                        style={[
                            styles.errorCard,
                            {
                                opacity: fadeAnim,
                            }
                        ]}
                    >
                        <LottieView
                            source={require('../../../assets/lottie/heart.json')}
                            autoPlay
                            loop
                            style={styles.errorIcon}
                        />
                        <Text style={styles.errorText}>{error}</Text>
                    </Animated.View>
                ) : null}

                {/* Control Buttons - Circular Design */}
                <Animated.View
                    style={[
                        styles.controls,
                        {
                            opacity: fadeAnim,
                        }
                    ]}
                >
                    {!isRecording ? (
                        <TouchableOpacity
                            onPress={handleStartRecording}
                            disabled={!isConnected || isRecordingLoading}
                            activeOpacity={0.8}
                            style={styles.circularButtonWrapper}
                        >
                            <Animated.View
                                style={[
                                    styles.circularButtonOuter,
                                    { transform: [{ scale: scaleAnim }] }
                                ]}
                            >
                                {/* Outer ring with gradient border */}
                                <LinearGradient
                                    colors={['#B8C5D6', '#D4DBE6', '#E8EDF5']}
                                    style={styles.circularButtonBorder}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    {/* Inner button */}
                                    <LinearGradient
                                        colors={
                                            !isConnected || isRecordingLoading
                                                ? ['#D1D5DB', '#E5E7EB']
                                                : ['#4CAF93', '#5EC4A6', '#6FD9BA']
                                        }
                                        style={styles.circularButtonInner}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                    >
                                        {isRecordingLoading ? (
                                            <View style={styles.circularButtonContent}>
                                                <ActivityIndicator size="large" color="#FFFFFF" />
                                                <Text style={styles.circularButtonText}>{t("starting")}...</Text>
                                            </View>
                                        ) : (
                                            <View style={styles.circularButtonContent}>
                                                <LottieView
                                                    source={require('../../../assets/lottie/heart.json')}
                                                    autoPlay
                                                    loop
                                                    style={styles.circularButtonLottie}
                                                />
                                                <Text style={styles.circularButtonText}>
                                                    {isConnected ? t("start") : t("not")}
                                                </Text>
                                                <Text style={styles.circularButtonText}>
                                                    {isConnected ? t("recording") : t("connected")}
                                                </Text>
                                                <View style={styles.circularButtonUnderline} />
                                            </View>
                                        )}
                                    </LinearGradient>
                                </LinearGradient>
                            </Animated.View>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            onPress={handleStopRecording}
                            disabled={!isStopEnabled || isRecordingLoading}
                            activeOpacity={0.8}
                            style={styles.circularButtonWrapper}
                        >
                            <Animated.View
                                style={[
                                    styles.circularButtonOuter,
                                    { transform: [{ scale: buttonPulse }] }
                                ]}
                            >
                                {/* Outer ring with gradient border */}
                                <LinearGradient
                                    colors={['#FFB8C8', '#FFD4E0', '#FFE8EF']}
                                    style={styles.circularButtonBorder}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    {/* Inner button */}
                                    <LinearGradient
                                        colors={
                                            !isStopEnabled || isRecordingLoading
                                                ? ['#E5E7EB', '#F3F4F6']
                                                : ['#FF9E6D', '#FFB485', '#FFC99D']
                                        }
                                        style={styles.circularButtonInner}
                                        start={{ x: 0, y: 0 }}
                                        end={{ x: 1, y: 1 }}
                                    >
                                        {isRecordingLoading ? (
                                            <View style={styles.circularButtonContent}>
                                                <ActivityIndicator size="large" color="#FFFFFF" />
                                                <Text style={styles.circularButtonText}>{t("stopping")}</Text>
                                            </View>
                                        ) : (
                                            <View style={styles.circularButtonContent}>
                                                <View style={styles.stopIconSquare} />
                                                <Text style={styles.circularButtonText}>
                                                    {isStopEnabled ? t("stop") : t("wait")}
                                                </Text>
                                                <Text style={styles.circularButtonText}>
                                                    {isStopEnabled ? t("recording") : `${stopCountdownSec}s`}
                                                </Text>
                                                <View style={styles.circularButtonUnderline} />
                                            </View>
                                        )}
                                    </LinearGradient>
                                </LinearGradient>
                            </Animated.View>
                        </TouchableOpacity>
                    )}
                </Animated.View>

                {/* Recording Tips */}
                {isRecording && (
                    <Animated.View
                        style={[
                            styles.tipsCard,
                            { opacity: fadeAnim }
                        ]}
                    >
                        <LinearGradient
                            colors={['#E3F2FD', '#F0F7FF']}
                            style={styles.tipsContent}
                        >
                            <LottieView
                                source={require('../../../assets/lottie/heart.json')}
                                autoPlay
                                loop
                                style={styles.tipsIcon}
                            />
                            <View style={styles.tipsTextContainer}>
                                <Text style={styles.tipsTitle}>{t("recording_in_progress")}</Text>
                                <Text style={styles.tipsText}>
                                   {t("keep_device_steady")}
                                </Text>
                            </View>
                        </LinearGradient>
                    </Animated.View>
                )}
            </ScrollView>
        );
    },
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: appliteColor,
    },
    contentContainer: {
        padding: SPACING.xs,
        paddingBottom: SPACING.xl
    },
    loadingOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: appliteColor,
        padding: SPACING.xl,
    },
    loadingLottie: {
        width: 200,
        height: 200,
    },
    loadingText: {
        marginTop: SPACING.lg,
        fontSize: FONTS.sizes.xl,
        fontWeight: '700',
        color: '#2C5F8D',
    },
    loadingSubtext: {
        marginTop: SPACING.sm,
        fontSize: FONTS.sizes.md,
        color: '#64748B',
        textAlign: 'center',
    },
    notConnectedContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.xl,
        backgroundColor: '#F8FAFC',
    },
    notConnectedLottie: {
        width: 250,
        height: 250,
        marginBottom: SPACING.xl,
    },
    notConnectedTitle: {
        fontSize: FONTS.sizes.xl,
        fontWeight: '800',
        color: '#1E3A5F',
        marginBottom: SPACING.md,
    },
    notConnectedText: {
        fontSize: FONTS.sizes.md,
        color: '#475569',
        textAlign: 'center',
        marginBottom: SPACING.xl,
        lineHeight: 24,
        paddingHorizontal: SPACING.lg,
    },
    gradientButton: {
        borderRadius: BORDER_RADIUS.xl,
        overflow: 'hidden',
        ...SHADOWS.large,
    },
    gradientButtonInner: {
        paddingHorizontal: SPACING.xl * 1.5,
        paddingVertical: SPACING.lg,
        alignItems: 'center',
    },
    gradientButtonText: {
        fontSize: FONTS.sizes.lg,
        fontWeight: '700',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },
    statusBar: {
        alignItems: 'flex-end',
        marginBottom: SPACING.sm,
    },
    timerBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.md,
        borderRadius: BORDER_RADIUS.xl,
        ...SHADOWS.large,
    },
    timerIcon: {
        width: 24,
        height: 24,
    },
    timerText: {
        fontSize: FONTS.sizes.xxl,
        fontWeight: 'bold',
        color: '#3F51B5',
        fontFamily: 'monospace',
    },
    timerTextRecording: {
        color: '#C2185B',
    },
    errorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#FFEBEE',
        borderRadius: BORDER_RADIUS.lg,
        padding: SPACING.lg,
        marginBottom: SPACING.lg,
        borderWidth: 1,
        borderColor: '#FFCDD2',
        gap: SPACING.md,
    },
    errorIcon: {
        width: 32,
        height: 32,
    },
    errorText: {
        flex: 1,
        fontSize: FONTS.sizes.md,
        color: '#D32F2F',
        fontWeight: '600',
    },
    controls: {
        marginTop: SPACING.xl,
        alignItems: 'center',
        justifyContent: 'center',
    },
    // Circular Button Styles
    circularButtonWrapper: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    circularButtonOuter: {
        width: 150,
        height: 150,
        alignItems: 'center',
        justifyContent: 'center',
    },
    circularButtonBorder: {
        width: 200,
        height: 200,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
        ...SHADOWS.large,
        elevation: 12,
    },
    circularButtonInner: {
        width: 180,
        height: 180,
        borderRadius: 90,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 8,
        },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 15,
    },
    circularButtonContent: {
        alignItems: 'center',
        justifyContent: 'center',
        gap: SPACING.xs,
    },
    circularButtonLottie: {
        width: 80,
        height: 80,
        marginBottom: SPACING.xs,
    },
    circularButtonText: {
        fontSize: FONTS.sizes.md,
        fontWeight: '900',
        color: '#423f3f',
        letterSpacing: 2,
        textAlign: 'center',
    },
    circularButtonUnderline: {
        width: 80,
        height: 4,
        backgroundColor: 'rgba(255, 255, 255, 0.6)',
        borderRadius: 2,
        marginTop: SPACING.xs,
    },
    stopIconSquare: {
        width: 50,
        height: 50,
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        marginBottom: SPACING.sm,
    },
    tipsCard: {
        marginTop: SPACING.xl,
        borderRadius: BORDER_RADIUS.lg,
        overflow: 'hidden',
    },
    tipsContent: {
        flexDirection: 'row',
        padding: SPACING.lg,
        gap: SPACING.md,
        borderWidth: 1,
        borderColor: '#BBDEFB',
        borderRadius: BORDER_RADIUS.lg,
    },
    tipsIcon: {
        width: 40,
        height: 40,
    },
    tipsTextContainer: {
        flex: 1,
        gap: SPACING.xs,
    },
    tipsTitle: {
        fontSize: FONTS.sizes.md,
        fontWeight: '700',
        color: '#1976D2',
    },
    tipsText: {
        fontSize: FONTS.sizes.sm,
        color: '#546E7A',
        lineHeight: 20,
    },
    // AiSteth auscultation points image
    stethImageCard: {
        // marginTop: SPACING.lg,
        // borderRadius: BORDER_RADIUS.lg,
        // backgroundColor: '#FFFFFF',
        // padding: SPACING.md,
        // borderWidth: 1,
        // borderColor: '#BBDEFB',
        // ...SHADOWS.large,
        flex: 1
    },
    stethImageTitle: {
        fontSize: FONTS.sizes.md,
        fontWeight: '700',
        color: '#1976D2',
        textAlign: 'center',
        marginBottom: SPACING.sm,
    },
    stethImageWrapper: {
        width: '55%',
        height: '99%',
        aspectRatio: 1327 / 901,
        position: 'relative',
        alignSelf: 'center'
    },
    stethImage: {
        width: '100%',
        height: '100%',
    },
    stethPoint: {
        position: 'absolute',
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: -22,
        marginTop: -22,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowRadius: 5,
    },
    stethPointLabel: {
        color: '#FFFFFF',
        fontSize: FONTS.sizes.lg,
        fontWeight: '800',
    },
    stethPointHint: {
        marginTop: SPACING.sm,
        fontSize: FONTS.sizes.sm,
        color: '#2a5298',
        fontWeight: '600',
        textAlign: 'left',
    },
});
