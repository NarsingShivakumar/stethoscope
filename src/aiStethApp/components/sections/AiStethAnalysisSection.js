// src/components/sections/AiStethAnalysisSection.js

import React, { useEffect, useState, useRef, useCallback, memo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    Linking,
    Animated,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { WebView } from 'react-native-webview';
import { COLORS, SPACING, FONTS, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { debugLog, debugError } from '../../../config/AppConfig';
import LinearGradient from 'react-native-linear-gradient';
import LottieView from 'lottie-react-native';

import {
    fetchAIAnalysis,
    fetchVisualization,
    fetchAudioUrl,
    selectAIAnalysis,
    selectAIAnalysisLoading,
    selectAIAnalysisError,
    selectAIAnalysisPending,
    selectVisualization,
    selectVisualizationDenoised,
    selectVisualizationLoading,
    selectVisualizationGTPending,
    selectVisualizationDenoisedPending,
    selectAudioUrl,
    selectAudioUrlDenoised,
    selectAudioLoading,
    selectAudioGTPending,
    selectAudioDenoisedPending,
    selectLastAnalysedFileName,
    selectLastAnalysedPatientId,
    clearAllAnalysisData,
} from '../../../store/slices/aiStethSlices/AiStethAnalysisSlice';
// import { setAiStethRecording } from '../../../store/slices/VitalSlice';

import { APP_COLORS } from '../../../assets/colors';
import { setVitalProcessing } from '../../../store/slices/VitalSlice';
import { t } from 'i18next';

// App Color Palette based on #32879B


const POLLING_INTERVALS = {
    AI_ANALYSIS: 5000,
    VISUALIZATION: 7000,
    AUDIO: 5000,
};
const MAX_POLL_ATTEMPTS = {
    AI_ANALYSIS: 12,
    VISUALIZATION: 40,
    AUDIO: 40,
};

const MediaButton = memo(({ item, isSelected, onPress }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;

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
            onPress={() => item.available && onPress(item.key)}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={!item.available}
            activeOpacity={0.9}
        >
            <Animated.View
                style={[
                    { transform: [{ scale: scaleAnim }] }
                ]}
            >
                <LinearGradient
                    colors={
                        isSelected
                            ? [item.color, item.colorMid, item.colorLight]
                            : item.available
                                ? ['#FFFFFF', '#F0F9FB', '#E6F5F8']
                                : ['#F5F5F5', '#E8E8E8']
                    }
                    style={[
                        styles.mediaControlCard,
                        isSelected && styles.mediaControlCardActive,
                        !item.available && styles.mediaControlCardDisabled,
                    ]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                >
                    <LinearGradient
                        colors={[item.color + '30', item.color + '20', item.color + '10']}
                        style={styles.mediaIconContainer}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Text style={styles.mediaControlIcon}>{item.icon}</Text>
                    </LinearGradient>
                    <View style={styles.mediaControlInfo}>
                        <Text style={[
                            styles.mediaControlLabel,
                            isSelected && styles.mediaControlLabelActive,
                        ]}>
                            {item.label}
                        </Text>
                        <Text style={[
                            styles.mediaControlSublabel,
                            isSelected && { color: 'rgba(255, 255, 255, 0.9)' }
                        ]}>
                            {item.sublabel}
                        </Text>
                    </View>
                    {!item.available && (
                        <View style={styles.loadingBadge}>
                            <ActivityIndicator size="small" color={item.color} />
                        </View>
                    )}
                    {item.available && isSelected && (
                        <View style={styles.activeBadge}>
                            <Text style={styles.activeBadgeText}>✓</Text>
                        </View>
                    )}
                </LinearGradient>
            </Animated.View>
        </TouchableOpacity>
    );
});

export const AiStethAnalysisSection = memo(({ onRetake }) => {
    const dispatch = useDispatch();

    // Redux selectors
    const aiAnalysis = useSelector(selectAIAnalysis);
    const aiAnalysisLoading = useSelector(selectAIAnalysisLoading);
    const aiAnalysisError = useSelector(selectAIAnalysisError);
    const aiAnalysisPending = useSelector(selectAIAnalysisPending);

    const visGT = useSelector(selectVisualization);
    const visDenoised = useSelector(selectVisualizationDenoised);
    const visLoading = useSelector(selectVisualizationLoading);
    const visGTPending = useSelector(selectVisualizationGTPending);
    const visDenoisedPending = useSelector(selectVisualizationDenoisedPending);

    const audioGT = useSelector(selectAudioUrl);
    const audioDenoised = useSelector(selectAudioUrlDenoised);
    const audioLoading = useSelector(selectAudioLoading);
    const audioGTPending = useSelector(selectAudioGTPending);
    const audioDenoisedPending = useSelector(selectAudioDenoisedPending);

    const fileName = useSelector(selectLastAnalysedFileName);
    const patientId = useSelector(selectLastAnalysedPatientId);

    const webViewRef = useRef(null);

    // Polling refs
    const aiAnalysisPollingRef = useRef(null);
    const visGTPollingRef = useRef(null);
    const visDenoisedPollingRef = useRef(null);
    const audioGTPollingRef = useRef(null);
    const audioDenoisedPollingRef = useRef(null);

    // Poll attempt counters
    const [aiAnalysisAttempts, setAiAnalysisAttempts] = useState(0);
    const [visGTAttempts, setVisGTAttempts] = useState(0);
    const [visDenoisedAttempts, setVisDenoisedAttempts] = useState(0);
    const [audioGTAttempts, setAudioGTAttempts] = useState(0);
    const [audioDenoisedAttempts, setAudioDenoisedAttempts] = useState(0);

    // UI state
    const [selectedMedia, setSelectedMedia] = useState('audio_denoised');
    const [mediaError, setMediaError] = useState(null);

    // Animation refs
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const scaleAnim = useRef(new Animated.Value(0.9)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;

    // Entrance animations
    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 800,
                useNativeDriver: true,
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                tension: 30,
                friction: 8,
                useNativeDriver: true,
            }),
            Animated.spring(scaleAnim, {
                toValue: 1,
                tension: 40,
                friction: 7,
                useNativeDriver: true,
            }),
        ]).start();

        // Pulse animation for loading states
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
    }, []);

    // Initial fetch on mount
    useEffect(() => {
        if (fileName && patientId) {
            debugLog('[AnalysisSection] Auto-fetching analysis data...');
            handleFetchAll();
        }
    }, [fileName, patientId]);

    // Auto-select denoised vis when available
    useEffect(() => {
        if (visDenoised) {
            setSelectedMedia('vis_denoised');
        }
    }, [visDenoised]);

    // Cleanup all polling on unmount
    useEffect(() => {
        return () => {
            clearAllPolling();
            stopMediaPlayback();
        };
    }, []);

    // Set vital flag when analysis data is available
   
    const clearAllPolling = useCallback(() => {
        if (aiAnalysisPollingRef.current) clearInterval(aiAnalysisPollingRef.current);
        if (visGTPollingRef.current) clearInterval(visGTPollingRef.current);
        if (visDenoisedPollingRef.current) clearInterval(visDenoisedPollingRef.current);
        if (audioGTPollingRef.current) clearInterval(audioGTPollingRef.current);
        if (audioDenoisedPollingRef.current) clearInterval(audioDenoisedPollingRef.current);
    }, []);

    const handleFetchAll = useCallback(() => {
        if (!fileName || !patientId) return;

        debugLog('[AnalysisSection] Fetching all analysis data');

        startAIAnalysisPolling();
        startVisualizationPolling(false);
        startVisualizationPolling(true);
        startAudioPolling(false);
        startAudioPolling(true);
    }, [fileName, patientId]);

    // AI Analysis Polling
    const startAIAnalysisPolling = useCallback(() => {
        setAiAnalysisAttempts(0);
        dispatch(fetchAIAnalysis({ patientUniqueId: patientId, fileName }));

        if (aiAnalysisPollingRef.current) clearInterval(aiAnalysisPollingRef.current);

        aiAnalysisPollingRef.current = setInterval(() => {
            setAiAnalysisAttempts((prev) => {
                const newAttempts = prev + 1;

                if (newAttempts >= MAX_POLL_ATTEMPTS.AI_ANALYSIS) {
                    debugLog('[AnalysisSection] AI Analysis polling max attempts reached');
                    if (aiAnalysisPollingRef.current) clearInterval(aiAnalysisPollingRef.current);
                    return prev;
                }

                if (!aiAnalysis && aiAnalysisPending) {
                    debugLog(`[AnalysisSection] Polling AI Analysis (attempt ${newAttempts})`);
                    dispatch(fetchAIAnalysis({ patientUniqueId: patientId, fileName }));
                } else {
                    debugLog('[AnalysisSection] AI Analysis complete, stopping poll');
                    if (aiAnalysisPollingRef.current) clearInterval(aiAnalysisPollingRef.current);
                }

                return newAttempts;
            });
        }, POLLING_INTERVALS.AI_ANALYSIS);
    }, [fileName, patientId, aiAnalysis, aiAnalysisPending, dispatch]);

    // Visualization Polling
    const startVisualizationPolling = useCallback((isDenoised) => {
        const key = isDenoised ? 'Denoised' : 'GT';
        const pollRef = isDenoised ? visDenoisedPollingRef : visGTPollingRef;
        const setAttempts = isDenoised ? setVisDenoisedAttempts : setVisGTAttempts;
        const isPending = isDenoised ? visDenoisedPending : visGTPending;
        const hasData = isDenoised ? visDenoised : visGT;

        setAttempts(0);
        dispatch(fetchVisualization({ patientUniqueId: patientId, fileName, isDenoised }));

        if (pollRef.current) clearInterval(pollRef.current);

        pollRef.current = setInterval(() => {
            setAttempts((prev) => {
                const newAttempts = prev + 1;

                if (newAttempts >= MAX_POLL_ATTEMPTS.VISUALIZATION) {
                    debugLog(`[AnalysisSection] Visualization ${key} polling max attempts reached`);
                    if (pollRef.current) clearInterval(pollRef.current);
                    return prev;
                }

                if (!hasData && isPending) {
                    debugLog(`[AnalysisSection] Polling Visualization ${key} (attempt ${newAttempts})`);
                    dispatch(fetchVisualization({ patientUniqueId: patientId, fileName, isDenoised }));
                } else {
                    debugLog(`[AnalysisSection] Visualization ${key} complete, stopping poll`);
                    if (pollRef.current) clearInterval(pollRef.current);
                }

                return newAttempts;
            });
        }, POLLING_INTERVALS.VISUALIZATION);
    }, [fileName, patientId, visGT, visDenoised, visGTPending, visDenoisedPending, dispatch]);

    // Audio Polling
    const startAudioPolling = useCallback((isDenoised) => {
        const key = isDenoised ? 'Denoised' : 'GT';
        const pollRef = isDenoised ? audioDenoisedPollingRef : audioGTPollingRef;
        const setAttempts = isDenoised ? setAudioDenoisedAttempts : setAudioGTAttempts;
        const isPending = isDenoised ? audioDenoisedPending : audioGTPending;
        const hasData = isDenoised ? audioDenoised : audioGT;

        setAttempts(0);
        dispatch(fetchAudioUrl({ patientUniqueId: patientId, fileName, isDenoised }));

        if (pollRef.current) clearInterval(pollRef.current);

        pollRef.current = setInterval(() => {
            setAttempts((prev) => {
                const newAttempts = prev + 1;

                if (newAttempts >= MAX_POLL_ATTEMPTS.AUDIO) {
                    debugLog(`[AnalysisSection] Audio ${key} polling max attempts reached`);
                    if (pollRef.current) clearInterval(pollRef.current);
                    return prev;
                }

                if (!hasData && isPending) {
                    debugLog(`[AnalysisSection] Polling Audio ${key} (attempt ${newAttempts})`);
                    dispatch(fetchAudioUrl({ patientUniqueId: patientId, fileName, isDenoised }));
                } else {
                    debugLog(`[AnalysisSection] Audio ${key} complete, stopping poll`);
                    if (pollRef.current) clearInterval(pollRef.current);
                }

                return newAttempts;
            });
        }, POLLING_INTERVALS.AUDIO);
    }, [fileName, patientId, audioGT, audioDenoised, audioGTPending, audioDenoisedPending, dispatch]);
    // Stop media playback
    const stopMediaPlayback = useCallback(() => {
        try {
            if (webViewRef.current) {
                webViewRef.current.injectJavaScript(`
                const videos = document.querySelectorAll('video');
                const audios = document.querySelectorAll('audio');
                videos.forEach(v => {
                    v.pause();
                    v.src = '';
                    v.load();
                });
                audios.forEach(a => {
                    a.pause();
                    a.src = '';
                    a.load();
                });
                true;
            `);
            }
        } catch (e) {
            debugError('[AnalysisSection] Error stopping media:', e);
        }
    }, []);


    // Stop polling when data is received
    useEffect(() => {
        if (aiAnalysis && !aiAnalysisPending) {
            if (aiAnalysisPollingRef.current) clearInterval(aiAnalysisPollingRef.current);
        }
    }, [aiAnalysis, aiAnalysisPending]);

    useEffect(() => {
        if (visGT && !visGTPending) {
            if (visGTPollingRef.current) clearInterval(visGTPollingRef.current);
        }
        if (visDenoised && !visDenoisedPending) {
            if (visDenoisedPollingRef.current) clearInterval(visDenoisedPollingRef.current);
        }
    }, [visGT, visDenoised, visGTPending, visDenoisedPending]);

    useEffect(() => {
        if (audioGT && !audioGTPending) {
            if (audioGTPollingRef.current) clearInterval(audioGTPollingRef.current);
        }
        if (audioDenoised && !audioDenoisedPending) {
            if (audioDenoisedPollingRef.current) clearInterval(audioDenoisedPollingRef.current);
        }
    }, [audioGT, audioDenoised, audioGTPending, audioDenoisedPending]);

   useEffect(()=>{

        if(aiAnalysis && audioGT ){
            dispatch(setVitalProcessing({value:false}))
        }

    },[aiAnalysis,audioGT])

    const handleRetake = useCallback(() => {
        Alert.alert(
            t("retake_recording"),
            t("retake_recording_warning"),
            [
                { text: t("cancel"), style: 'cancel' },
                {
                    text: t("retake"),
                    style: 'destructive',
                    onPress: () => {
                        dispatch(clearAllAnalysisData());
                        onRetake && onRetake();
                    },
                },
            ]
        );
    }, [dispatch, onRetake]);

    const getMediaUrl = useCallback(() => {
        switch (selectedMedia) {
            case 'vis_gt':
                return visGT?.Url;
            case 'vis_denoised':
                return visDenoised?.Url;
            case 'audio_gt':
                return audioGT?.Url;
            case 'audio_denoised':
                return audioDenoised?.Url;
            default:
                return null;
        }
    }, [selectedMedia, visGT, visDenoised, audioGT, audioDenoised]);

    const openUrlInBrowser = useCallback((url) => {
        if (!url) return;
        Linking.openURL(url).catch(() =>
            Alert.alert('Error', 'Failed to open URL in browser.')
        );
    }, []);

    const getVideoHTML = useCallback((url) => {
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            background: linear-gradient(135deg, #32879B 0%, #4A9BB0 50%, #62AFC5 100%);
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            overflow: hidden;
                        }
                        video {
                            width: 100%;
                            height: 100%;
                            object-fit: contain;
                            border-radius: 8px;
                        }
                    </style>
                </head>
                <body>
                    <video controls autoplay loop playsinline>
                        <source src="${url}" type="video/mp4">
                        Your browser does not support the video tag.
                    </video>
                </body>
            </html>
        `;
    }, []);

    const getAudioHTML = useCallback((url) => {
        return `
            <!DOCTYPE html>
            <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        * { margin: 0; padding: 0; box-sizing: border-box; }
                        body {
                            background: linear-gradient(135deg, #2E8B7A 0%, #3AA6BF 50%, #52BAD3 100%);
                            display: flex;
                            flex-direction: column;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                            padding: 20px;
                        }
                        .container {
                            background: rgba(255, 255, 255, 0.98);
                            border-radius: 24px;
                            padding: 40px;
                            box-shadow: 0 20px 60px rgba(50, 135, 155, 0.3);
                            max-width: 400px;
                            width: 100%;
                            text-align: center;
                        }
                        .audio-icon { 
                            font-size: 80px; 
                            margin-bottom: 24px;
                            animation: pulse 2s ease-in-out infinite;
                        }
                        @keyframes pulse {
                            0%, 100% { transform: scale(1); }
                            50% { transform: scale(1.15); }
                        }
                        .title {
                            font-size: 20px;
                            font-weight: 700;
                            color: #1E3A5F;
                            margin-bottom: 8px;
                            letter-spacing: 0.5px;
                        }
                        .subtitle {
                            font-size: 14px;
                            color: #32879B;
                            margin-bottom: 32px;
                            font-weight: 500;
                        }
                        audio { 
                            width: 100%;
                            border-radius: 12px;
                            outline: none;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="audio-icon">🎵</div>
                        <div class="title">${t("heart_sound_recording")}</div>
                        <div class="subtitle">${t("playing_audio")}</div>
                        <audio controls autoplay loop>
                            <source src="${url}" type="audio/wav">
                            <source src="${url}" type="audio/mpeg">
                            Your browser does not support the audio element.
                        </audio>
                    </div>
                </body>
            </html>
        `;
    }, []);

    const isVideoMedia = selectedMedia.startsWith('vis_');
    const isAudioMedia = selectedMedia.startsWith('audio_');
    const mediaUrl = getMediaUrl();

    const renderAIResult = useCallback(() => {
        if (aiAnalysisLoading || (aiAnalysisPending && !aiAnalysis)) {
            return (
                <Animated.View
                    style={[
                        {
                            opacity: fadeAnim,
                            transform: [{ scale: pulseAnim }]
                        }
                    ]}
                >
                    <LinearGradient
                        colors={['#D6F1F5', '#E6F7F9', '#FFFFFF']}
                        style={styles.loadingContainer}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <LottieView
                            source={require('../../../assets/lottie/heart.json')}
                            autoPlay
                            loop
                            style={styles.loadingLottie}
                        />
                        <Text style={styles.loadingText}>
                            {aiAnalysisPending ? `${t("analyzing_wait")}...` : 'Loading...'}
                        </Text>
                        <Text style={styles.loadingSubtext}>{t("analysis_time")}</Text>
                    </LinearGradient>
                </Animated.View>
            );
        }

        if (aiAnalysisError) {
            return (
                <Animated.View
                    style={[
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }]
                        }
                    ]}
                >
                    <LinearGradient
                        colors={['#FFEBEE', '#FFCDD2', '#FFE8EF']}
                        style={styles.errorContainer}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Text style={styles.errorIcon}>⚠️</Text>
                        <Text style={styles.errorText}>
                            {aiAnalysisError.userMessage || aiAnalysisError.message || 'Failed to load AI analysis.'}
                        </Text>
                        <TouchableOpacity
                            onPress={() => startAIAnalysisPolling()}
                        >
                            <LinearGradient
                                colors={[APP_COLORS.error, APP_COLORS.errorLight, '#FFB0C0']}
                                style={styles.retryButton}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                <Text style={styles.retryText}>Retry</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </LinearGradient>
                </Animated.View>
            );
        }

        if (!aiAnalysis) {
            return (
                <Animated.View
                    style={[
                        {
                            opacity: fadeAnim,
                            transform: [{ scale: scaleAnim }]
                        }
                    ]}
                >
                    <LinearGradient
                        colors={['#FFFFFF', '#F0F9FB', '#E6F5F8']}
                        style={styles.emptyAnalysisContainer}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Text style={styles.emptyIcon}>📋</Text>
                        <Text style={styles.emptyText}>No AI analysis available yet.</Text>
                        <Text style={styles.emptySubtext}>
                            AI analysis takes 45–60 seconds after upload.
                        </Text>
                        {fileName && (
                            <TouchableOpacity
                                onPress={() => startAIAnalysisPolling()}
                            >
                                <LinearGradient
                                    colors={[APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter]}
                                    style={styles.fetchButton}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    <Text style={styles.fetchButtonText}>Fetch Analysis</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        )}
                    </LinearGradient>
                </Animated.View>
            );
        }

        const result = aiAnalysis.ai_analysis || 'No result available';
        const isNormal = result.toLowerCase().includes('normal');

        return (
            <Animated.View
                style={[
                    {
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }
                ]}
            >
                <LinearGradient
                    colors={
                        isNormal
                            ? ['#D4F4E7', '#E0F9EF', '#C8F5DC']
                            : ['#FFE8D6', '#FFF0E0', '#FFD9B3']
                    }
                    style={styles.diagnosisCard}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                >
                    <View style={styles.diagnosisHeader}>
                        <View style={{ flex: 1 }}>
                            <Text style={styles.diagnosisLabel}>AI ANALYSIS</Text>
                            <Text style={styles.diagnosisResult}>{result}</Text>
                        </View>
                        <LinearGradient
                            colors={
                                isNormal
                                    ? [APP_COLORS.success, APP_COLORS.successLight, '#5FC9AE']
                                    : [APP_COLORS.warning, APP_COLORS.warningLight, '#FFCC80']
                            }
                            style={styles.statusBadge}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <Text style={styles.statusText}>
                                {isNormal ? '✓ Normal' : '⚠ Abnormal'}
                            </Text>
                        </LinearGradient>
                    </View>
                </LinearGradient>
            </Animated.View>
        );
    }, [aiAnalysis, aiAnalysisLoading, aiAnalysisError, fileName, patientId, dispatch, fadeAnim, slideAnim, scaleAnim, pulseAnim]);

    const renderMediaPlayer = useCallback(() => {
        const currentUrl = mediaUrl || visDenoised?.Url || visGT?.Url;

        if (!currentUrl) {
            const isProcessing = visDenoisedPending || visGTPending;

            return (
                <Animated.View
                    style={[
                        {
                            opacity: fadeAnim,
                            transform: [{ scale: isProcessing ? pulseAnim : scaleAnim }]
                        }
                    ]}
                >
                    <LinearGradient
                        colors={['#D6F1F5', '#E6F7F9', '#FFFFFF']}
                        style={styles.videoPlaceholder}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        {isProcessing ? (
                            <>
                                <LottieView
                                    source={require('../../../assets/lottie/heart.json')}
                                    autoPlay
                                    loop
                                    style={styles.placeholderLottie}
                                />
                                <Text style={styles.placeholderText}>Analyzing please wait</Text>
                                <Text style={styles.placeholderSubtext}>This may take several minutes</Text>
                            </>
                        ) : (
                            <>
                                <Text style={styles.placeholderIcon}>🎬</Text>
                                <Text style={styles.placeholderText}>No media available</Text>
                                <Text style={styles.placeholderSubtext}>Media will appear after processing</Text>
                            </>
                        )}
                    </LinearGradient>
                </Animated.View>
            );
        }

        return (
            <Animated.View
                style={[
                    styles.videoPlayerContainer,
                    {
                        opacity: fadeAnim,
                        transform: [{ scale: scaleAnim }]
                    }
                ]}
            >
                <WebView
                    ref={webViewRef}
                    source={{
                        html: isAudioMedia ? getAudioHTML(currentUrl) : getVideoHTML(currentUrl)
                    }}
                    style={styles.webView}
                    allowsInlineMediaPlayback
                    mediaPlaybackRequiresUserAction={false}
                    javaScriptEnabled
                    domStorageEnabled
                    onError={(syntheticEvent) => {
                        const { nativeEvent } = syntheticEvent;
                        debugError('[AnalysisSection] WebView error:', nativeEvent);
                        setMediaError('Failed to load media');
                    }}
                    onLoadEnd={() => setMediaError(null)}
                />
                {mediaError && (
                    <View style={styles.errorOverlay}>
                        <Text style={styles.errorOverlayText}>{mediaError}</Text>
                    </View>
                )}
            </Animated.View>
        );
    }, [mediaUrl, visDenoised, visGT, visDenoisedPending, visGTPending, isAudioMedia, mediaError, getAudioHTML, getVideoHTML, openUrlInBrowser, fadeAnim, scaleAnim, pulseAnim]);

    const mediaItems = [
        {
            key: 'audio_denoised',
            label: t("denoised_heart_sound"),
            sublabel: t("clean_sound"),
            icon: '🎵',
            available: !!audioDenoised,
            color: APP_COLORS.success,
            colorMid: APP_COLORS.successLight,
            colorLight: '#5FC9AE',
        },
        {
            key: 'audio_gt',
            label: t("original_heart_sound"),
            sublabel: t("raw_sound"),
            icon: '🔊',
            available: !!audioGT,
            color: APP_COLORS.secondary,
            colorMid: APP_COLORS.secondaryLight,
            colorLight: '#6FD0E5',
        },
        {
            key: 'vis_denoised',
            label: t("denoised_visualization"),
            sublabel: t("enhanced_clarity"),
            icon: '🎬',
            available: !!visDenoised,
            color: APP_COLORS.primary,
            colorMid: APP_COLORS.primaryLight,
            colorLight: APP_COLORS.primaryLighter,
        },
        {
            key: 'vis_gt',
            label: t("original_visualization"),
            sublabel: t("raw_recording"),
            icon: '📹',
            available: !!visGT,
            color: APP_COLORS.primaryDark,
            colorMid: APP_COLORS.primary,
            colorLight: APP_COLORS.primaryLight,
        },

    ];

    const handleMediaSelect = useCallback((key) => {
        setMediaError(null);
        setSelectedMedia(key);
    }, []);

    const renderMediaControls = useCallback(() => {
        return (
            <Animated.View
                style={[
                    styles.mediaControlsContainer,
                    {
                        opacity: fadeAnim,
                        transform: [{ translateY: slideAnim }]
                    }
                ]}
            >
                <View style={styles.controlsHeader}>
                    <LinearGradient
                        colors={[APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter]}
                        style={styles.controlsTitleAccent}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                    />
                    <Text style={styles.controlsTitle}>{t("media_library")}</Text>
                </View>
                <View style={styles.mediaGrid}>
                    {mediaItems.map((item) => (
                        <MediaButton
                            key={item.key}
                            item={item}
                            isSelected={selectedMedia === item.key}
                            onPress={handleMediaSelect}
                        />
                    ))}
                </View>
            </Animated.View>
        );
    }, [mediaItems, selectedMedia, handleMediaSelect, fadeAnim, slideAnim]);

    const handleClearAnalysis = useCallback(() => {
        Alert.alert(
            'Clear Analysis',
            'Are you sure you want to clear all analysis data?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Clear',
                    style: 'destructive',
                    onPress: () => {
                        dispatch(clearAllAnalysisData());
                        Alert.alert('Cleared', 'Analysis data cleared successfully.');
                    },
                },
            ]
        );
    }, [dispatch]);

    // Empty state
    if (!fileName || !patientId) {
        return (
            <View style={styles.container}>
                <ScrollView contentContainerStyle={styles.emptyStateContainer}>
                    <Animated.View
                        style={[
                            {
                                opacity: fadeAnim,
                                transform: [{ scale: scaleAnim }]
                            }
                        ]}
                    >
                        <LinearGradient
                            colors={['#D6F1F5', '#E6F7F9', '#FFFFFF']}
                            style={styles.emptyStateCard}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <LottieView
                                source={require('../../../assets/lottie/heart.json')}
                                autoPlay
                                loop
                                style={styles.emptyStateLottie}
                            />
                            <Text style={styles.emptyStateTitle}>No Recording Analysed</Text>
                            <Text style={styles.emptyStateText}>
                                Complete a recording upload in the Record tab to view AI analysis here.
                            </Text>
                            <TouchableOpacity onPress={handleRetake}>
                                <LinearGradient
                                    colors={[APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter, APP_COLORS.primaryLightest]}
                                    style={styles.retakeButtonGradient}
                                    start={{ x: 0, y: 0 }}
                                    end={{ x: 1, y: 1 }}
                                >
                                    <Text style={styles.retakeIcon}>🔄</Text>
                                    <Text style={styles.retakeText}>Start Recording</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        </LinearGradient>
                    </Animated.View>
                </ScrollView>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Header with AI Result and Refresh */}
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        {renderAIResult()}
                    </View>
                    <TouchableOpacity
                        onPress={handleFetchAll}
                    >
                        <LinearGradient
                            colors={[APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter]}
                            style={styles.refreshButton}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <Text style={styles.refreshIcon}>🔄</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </View>

                {/* Media Player Section */}
                <View style={styles.videoSection}>
                    {(visLoading || audioLoading) && (
                        <Animated.View
                            style={[
                                styles.loadingOverlay,
                                { transform: [{ scale: pulseAnim }] }
                            ]}
                        >
                            <LinearGradient
                                colors={['#D6F1F5', '#E6F7F9']}
                                style={styles.loadingOverlayContent}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                            >
                                <ActivityIndicator size="large" color={APP_COLORS.primary} />
                                <Text style={styles.loadingOverlayText}>{t("loading")}...</Text>
                            </LinearGradient>
                        </Animated.View>
                    )}
                    {renderMediaPlayer()}
                </View>

                {/* Media Controls */}
                {renderMediaControls()}

                {/* Retake Button */}
                <Animated.View
                    style={[
                        {
                            opacity: fadeAnim,
                            transform: [{ translateY: slideAnim }]
                        }
                    ]}
                >
                    <TouchableOpacity onPress={handleRetake}>
                        <LinearGradient
                            colors={[APP_COLORS.primaryDarker, APP_COLORS.primary, APP_COLORS.primaryLightest, APP_COLORS.primaryDarker]}
                            style={styles.retakeButtonGradient}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                        >
                            <Text style={styles.retakeIcon}>🔄</Text>
                            <Text style={styles.retakeText}>{t("retake_recording")}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </Animated.View>
            </ScrollView>
        </View>
    );
});

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    scrollContent: {
        padding: SPACING.xl,
    },

    // Header
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: SPACING.xl,
        gap: SPACING.md,
    },
    refreshButton: {
        width: 52,
        height: 52,
        borderRadius: 26,
        justifyContent: 'center',
        alignItems: 'center',
        ...SHADOWS.medium,
        elevation: 8,
    },
    refreshIcon: {
        fontSize: 24,
    },

    // Diagnosis Card
    diagnosisCard: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.xl,
        ...SHADOWS.large,
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.9)',
    },
    diagnosisHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
    },
    diagnosisLabel: {
        fontSize: FONTS.sizes.sm,
        color: '#1E3A5F',
        fontWeight: '800',
        marginBottom: SPACING.sm,
        letterSpacing: 1.5,
        opacity: 0.8,
    },
    diagnosisResult: {
        fontSize: FONTS.sizes.xl,
        color: '#1E3A5F',
        fontWeight: '700',
        lineHeight: 28,
    },
    statusBadge: {
        paddingHorizontal: SPACING.lg,
        paddingVertical: SPACING.sm,
        borderRadius: BORDER_RADIUS.xl,
        ...SHADOWS.small,
    },
    statusText: {
        fontSize: FONTS.sizes.sm,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 0.5,
    },

    // Video Section
    videoSection: {
        marginBottom: SPACING.xl,
    },
    videoPlayerContainer: {
        backgroundColor: '#000',
        borderRadius: BORDER_RADIUS.xl,
        overflow: 'hidden',
        height: 320,
        ...SHADOWS.large,
        borderWidth: 3,
        borderColor: 'rgba(255, 255, 255, 0.9)',
    },
    webView: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    videoPlaceholder: {
        borderRadius: BORDER_RADIUS.xl,
        height: 320,
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.xl,
        borderWidth: 2,
        borderColor: APP_COLORS.primaryLight + '50',
        ...SHADOWS.medium,
    },
    placeholderLottie: {
        width: 120,
        height: 120,
        marginBottom: SPACING.md,
    },
    placeholderIcon: {
        fontSize: 80,
        marginBottom: SPACING.lg,
    },
    placeholderText: {
        fontSize: FONTS.sizes.lg,
        color: '#1E3A5F',
        fontWeight: '700',
        marginBottom: SPACING.xs,
        textAlign: 'center',
    },
    placeholderSubtext: {
        fontSize: FONTS.sizes.sm,
        color: APP_COLORS.primaryDark,
        textAlign: 'center',
        fontWeight: '500',
    },
    errorOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0,0,0,0.92)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: SPACING.xl,
    },
    errorOverlayText: {
        color: '#fff',
        fontSize: FONTS.sizes.md,
        textAlign: 'center',
        fontWeight: '600',
    },

    // Media Controls
    mediaControlsContainer: {
        marginBottom: SPACING.xl,
    },
    controlsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.lg,
    },
    controlsTitleAccent: {
        width: 5,
        height: 28,
        borderRadius: 3,
        marginRight: SPACING.md,
    },
    controlsTitle: {
        fontSize: FONTS.sizes.xl,
        fontWeight: '800',
        color: '#1E3A5F',
        letterSpacing: 0.5,
    },
    mediaGrid: {
        gap: SPACING.md,
    },
    mediaControlCard: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.lg,
        flexDirection: 'row',
        alignItems: 'center',
        ...SHADOWS.medium,
        borderWidth: 2,
        borderColor: 'rgba(255, 255, 255, 0.8)',
    },
    mediaControlCardActive: {
        borderWidth: 3,
        borderColor: 'rgba(255, 255, 255, 0.95)',
    },
    mediaControlCardDisabled: {
        opacity: 0.6,
    },
    mediaIconContainer: {
        width: 56,
        height: 56,
        borderRadius: BORDER_RADIUS.lg,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: SPACING.md,
    },
    mediaControlIcon: {
        fontSize: 28,
    },
    mediaControlInfo: {
        flex: 1,
    },
    mediaControlLabel: {
        fontSize: FONTS.sizes.md,
        color: '#1E3A5F',
        fontWeight: '700',
        marginBottom: 4,
    },
    mediaControlLabelActive: {
        color: '#FFFFFF',
    },
    mediaControlSublabel: {
        fontSize: FONTS.sizes.xs,
        color: '#64748B',
        fontWeight: '500',
    },
    loadingBadge: {
        marginLeft: SPACING.sm,
    },
    activeBadge: {
        width: 32,
        height: 32,
        backgroundColor: 'rgba(255, 255, 255, 0.3)',
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: SPACING.sm,
    },
    activeBadgeText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '900',
    },

    // Loading/Error/Empty States
    loadingContainer: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.xl * 1.5,
        alignItems: 'center',
        ...SHADOWS.medium,
        borderWidth: 2,
        borderColor: APP_COLORS.primaryLight + '50',
    },
    loadingLottie: {
        width: 100,
        height: 100,
        marginBottom: SPACING.md,
    },
    loadingText: {
        marginTop: SPACING.md,
        fontSize: FONTS.sizes.md,
        color: '#1E3A5F',
        fontWeight: '700',
    },
    loadingSubtext: {
        marginTop: SPACING.xs,
        fontSize: FONTS.sizes.sm,
        color: APP_COLORS.primaryDark,
        fontWeight: '500',
    },
    errorContainer: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.xl,
        alignItems: 'center',
        ...SHADOWS.medium,
        borderWidth: 2,
        borderColor: APP_COLORS.error + '30',
    },
    errorIcon: {
        fontSize: 56,
        marginBottom: SPACING.md,
    },
    errorText: {
        fontSize: FONTS.sizes.sm,
        color: '#D32F2F',
        textAlign: 'center',
        marginBottom: SPACING.lg,
        fontWeight: '600',
    },
    retryButton: {
        paddingHorizontal: SPACING.xl * 1.5,
        paddingVertical: SPACING.md,
        borderRadius: BORDER_RADIUS.xl,
        ...SHADOWS.small,
    },
    retryText: {
        fontSize: FONTS.sizes.sm,
        color: '#FFFFFF',
        fontWeight: '800',
        letterSpacing: 1,
    },
    emptyAnalysisContainer: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.xl * 1.5,
        alignItems: 'center',
        ...SHADOWS.medium,
        borderWidth: 2,
        borderColor: APP_COLORS.primaryLight + '40',
    },
    emptyIcon: {
        fontSize: 72,
        marginBottom: SPACING.lg,
    },
    emptyText: {
        fontSize: FONTS.sizes.lg,
        color: '#1E3A5F',
        textAlign: 'center',
        marginBottom: SPACING.xs,
        fontWeight: '700',
    },
    emptySubtext: {
        fontSize: FONTS.sizes.sm,
        color: APP_COLORS.primaryDark,
        textAlign: 'center',
        marginBottom: SPACING.xl,
        fontWeight: '500',
    },
    fetchButton: {
        paddingHorizontal: SPACING.xl * 1.5,
        paddingVertical: SPACING.md,
        borderRadius: BORDER_RADIUS.xl,
        ...SHADOWS.small,
    },
    fetchButtonText: {
        fontSize: FONTS.sizes.sm,
        color: '#FFFFFF',
        fontWeight: '800',
        letterSpacing: 1,
    },
    loadingOverlay: {
        marginBottom: SPACING.lg,
    },
    loadingOverlayContent: {
        borderRadius: BORDER_RADIUS.lg,
        padding: SPACING.xl,
        alignItems: 'center',
        ...SHADOWS.small,
    },
    loadingOverlayText: {
        marginTop: SPACING.md,
        fontSize: FONTS.sizes.sm,
        color: '#1E3A5F',
        fontWeight: '600',
    },

    // Empty State
    emptyStateContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 100,
    },
    emptyStateCard: {
        borderRadius: BORDER_RADIUS.xl * 1.5,
        padding: SPACING.xl * 2,
        alignItems: 'center',
        maxWidth: 400,
        ...SHADOWS.large,
        borderWidth: 2,
        borderColor: APP_COLORS.primaryLight + '40',
    },
    emptyStateLottie: {
        width: 160,
        height: 160,
        marginBottom: SPACING.xl,
    },
    emptyStateTitle: {
        fontSize: FONTS.sizes.xxl,
        fontWeight: '800',
        color: '#1E3A5F',
        marginBottom: SPACING.md,
        letterSpacing: 0.5,
    },
    emptyStateText: {
        fontSize: FONTS.sizes.md,
        color: APP_COLORS.primaryDark,
        textAlign: 'center',
        lineHeight: 24,
        marginBottom: SPACING.xl * 1.5,
        paddingHorizontal: SPACING.lg,
        fontWeight: '500',
    },
    retakeButtonGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.lg,
        ...SHADOWS.large,
        elevation: 10,
    },
    retakeIcon: {
        fontSize: 28,
        marginRight: SPACING.sm,
    },
    retakeText: {
        fontSize: FONTS.sizes.lg,
        color: '#FFFFFF',
        fontWeight: '800',
        letterSpacing: 1,
    },
});
