// src/aiStethApp/components/sections/AnalysisSection.js  v3
//
// COMPLETE REPLACEMENT for AiStethAnalysisSection.js
//
// REMOVED (from original):
//   WebView, react-native-webview dependency
//   fetchAIAnalysis / fetchVisualization / fetchAudioUrl polling thunks
//   POLLING_INTERVALS, MAX_POLL_ATTEMPTS, 5 polling refs, 5 attempt counters
//   AiStethAnalysisSlice selectors (15 selectors)
//   getVideoHTML / getAudioHTML (no longer needed — native AudioTrack used)
//   AiSteth patientId / fileName requirements
//   Linking import (no external URLs needed)
//
// ADDED (v2 base → from existing AnalysisSection.js in your repo):
//   SeparationSlice selectors (heart, lung, noiseLevel, signalQuality, etc.)
//   SeparationAudioPlayer native module for AudioTrack playback
//   Signal quality badge from NMF noiseLevel metric
//   Noise level + signal quality meters
//   Save WAV to device storage
//   Progress bar during processing
//
// NEW in v3:
//   detectHeartThunk  → POST /detect_heart on separated heart channel
//   addNoiseThunk     → POST /add_noise, then preview noisy audio
//   Heart Detected banner (❤️ detected / ⚠️ not detected) with confidence + BPM
//   Noise injection controls (voice / white / pink / brown chips + SNR picker)
//   Noisy audio play button (same SeparationAudioPlayer pattern)
//   Both heart AND lung channels have full play support (unchanged from v2)
//
// UI PRESERVED IDENTICAL from original:
//   MediaButton component, card layouts, gradients, animations,
//   empty/loading/error states, retake button — all pixel-for-pixel preserved.

import React, { useEffect, useState, useRef, useCallback, memo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
    Animated,
    NativeModules,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import { COLORS, SPACING, FONTS, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { debugLog, debugError } from '../../../config/AppConfig';
import LinearGradient from 'react-native-linear-gradient';
import LottieView from 'lottie-react-native';
import { APP_COLORS } from '../../../assets/colors';
import { setVitalProcessing } from '../../../store/slices/VitalSlice';
import { t } from 'i18next';

import {
    // existing v2 selectors
    selectIsProcessing,
    selectProgress,
    selectHeart,
    selectLung,
    selectHeartWav,
    selectLungWav,
    selectNoiseLevel,
    selectSignalQuality,
    selectProcessingMs,
    selectSepError,
    selectHasResults,
    clearSeparationData,
    // NEW v3 selectors
    selectIsDetectingHeart,
    selectHeartDetected,
    selectHeartConfidence,
    selectHeartBpm,
    selectHeartEnergyRatio,
    selectHeartPeriodicity,
    selectHeartDetectError,
    selectIsAddingNoise,
    selectNoisyAudio,
    selectAddNoiseError,
    clearHeartDetection,
    clearNoisyAudio,
    // NEW v3 thunks
    detectHeartThunk,
    addNoiseThunk,
} from '../../../store/slices/SeparationSlice';

const { SeparationAudioPlayer } = NativeModules;

// ── MediaButton — identical to original ──────────────────────────────────────
const MediaButton = memo(({ item, isSelected, onPress }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
    };
    const handlePressOut = () => {
        Animated.spring(scaleAnim, {
            toValue: 1, tension: 50, friction: 3, useNativeDriver: true,
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
            <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
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
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                >
                    <LinearGradient
                        colors={[item.color + '30', item.color + '20', item.color + '10']}
                        style={styles.mediaIconContainer}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
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
                            isSelected && { color: 'rgba(255,255,255,0.9)' },
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

// ── Main component ────────────────────────────────────────────────────────────
export const AnalysisSection = memo(({ onRetake }) => {
    const dispatch = useDispatch();

    // ── v2 SeparationSlice selectors ──────────────────────────────────────────
    const isProcessing = useSelector(selectIsProcessing);
    const progress = useSelector(selectProgress);
    const heartRaw = useSelector(selectHeart);
    const lungRaw = useSelector(selectLung);
    const heartWav = useSelector(selectHeartWav);
    const lungWav = useSelector(selectLungWav);
    const noiseLevel = useSelector(selectNoiseLevel);
    const signalQuality = useSelector(selectSignalQuality);
    const processingMs = useSelector(selectProcessingMs);
    const sepError = useSelector(selectSepError);
    const hasResults = useSelector(selectHasResults);

    // ── v3 NEW selectors ──────────────────────────────────────────────────────
    const isDetectingHeart = useSelector(selectIsDetectingHeart);
    const heartDetected = useSelector(selectHeartDetected);
    const heartConfidence = useSelector(selectHeartConfidence);
    const heartBpm = useSelector(selectHeartBpm);
    const heartEnergyRatio = useSelector(selectHeartEnergyRatio);
    const heartPeriodicity = useSelector(selectHeartPeriodicity);
    const heartDetectError = useSelector(selectHeartDetectError);
    const isAddingNoise = useSelector(selectIsAddingNoise);
    const noisyAudio = useSelector(selectNoisyAudio);
    const addNoiseError = useSelector(selectAddNoiseError);

    // ── UI state ──────────────────────────────────────────────────────────────
    const [selectedMedia, setSelectedMedia] = useState('heart');
    const [playingHeart, setPlayingHeart] = useState(false);
    const [playingLung, setPlayingLung] = useState(false);
    const [playingNoisy, setPlayingNoisy] = useState(false);  // v3
    const [selectedNoise, setSelectedNoise] = useState('white'); // v3
    const [snrDb, setSnrDb] = useState(10);      // v3

    // ── Animation refs — identical to original ────────────────────────────────
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const scaleAnim = useRef(new Animated.Value(0.9)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
            Animated.spring(slideAnim, { toValue: 0, tension: 30, friction: 8, useNativeDriver: true }),
            Animated.spring(scaleAnim, { toValue: 1, tension: 40, friction: 7, useNativeDriver: true }),
        ]).start();
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.05, duration: 1500, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
        ]));
        loop.start();
        return () => loop.stop();
    }, []);

    // Tell parent vitals dashboard processing is complete when results arrive
    useEffect(() => {
        if (hasResults) dispatch(setVitalProcessing({ value: false }));
    }, [hasResults, dispatch]);

    // ── Playback ──────────────────────────────────────────────────────────────
    const playHeart = useCallback(async () => {
        if (!heartRaw) return;
        try {
            setPlayingHeart(true);
            await SeparationAudioPlayer.playHeartAudio(heartRaw);
        } catch (e) { Alert.alert('Playback Error', e.message); }
        finally { setPlayingHeart(false); }
    }, [heartRaw]);

    const playLung = useCallback(async () => {
        if (!lungRaw) return;
        try {
            setPlayingLung(true);
            await SeparationAudioPlayer.playLungAudio(lungRaw);
        } catch (e) { Alert.alert('Playback Error', e.message); }
        finally { setPlayingLung(false); }
    }, [lungRaw]);

    // v3: play noisy audio through the same heart AudioTrack channel
    const playNoisy = useCallback(async () => {
        if (!noisyAudio) return;
        try {
            setPlayingNoisy(true);
            await SeparationAudioPlayer.playHeartAudio(noisyAudio);
        } catch (e) { Alert.alert('Playback Error', e.message); }
        finally { setPlayingNoisy(false); }
    }, [noisyAudio]);

    const stopPlayback = useCallback(async () => {
        try { await SeparationAudioPlayer.stopPlayback(); } catch { }
        setPlayingHeart(false);
        setPlayingLung(false);
        setPlayingNoisy(false);
    }, []);

    // ── Save WAV ──────────────────────────────────────────────────────────────
    const saveAudio = useCallback(async which => {
        const wav = which === 'heart' ? heartWav : lungWav;
        if (!wav) { Alert.alert('No Audio', `No ${which} audio to save`); return; }
        try {
            const fn = `${which}_${Date.now()}.wav`;
            const r = await SeparationAudioPlayer.saveAudioFile(wav, fn, which);
            Alert.alert('Saved ✓', `Saved to:\n${r.filePath}`);
        } catch (e) { Alert.alert('Save Error', e.message); }
    }, [heartWav, lungWav]);

    // ── Retake ────────────────────────────────────────────────────────────────
    const handleRetake = useCallback(() => {
        Alert.alert(
            t('retake_recording'),
            t('retake_recording_warning'),
            [
                { text: t('cancel'), style: 'cancel' },
                {
                    text: t('retake'),
                    style: 'destructive',
                    onPress: () => {
                        dispatch(clearSeparationData());
                        onRetake?.();
                    },
                },
            ]
        );
    }, [dispatch, onRetake]);

    // ── v3: Heart detection ───────────────────────────────────────────────────
    const handleDetectHeart = useCallback(() => {
        if (!heartRaw) return;
        dispatch(detectHeartThunk({ base64Audio: heartRaw, sampleRate: 4000 }));
    }, [heartRaw, dispatch]);

    // ── v3: Noise injection ───────────────────────────────────────────────────
    const handleAddNoise = useCallback(() => {
        if (!heartRaw) return;
        dispatch(addNoiseThunk({
            base64Audio: heartRaw,
            sampleRate: 44100,
            noiseType: selectedNoise,
            snrDb,
        }));
    }, [heartRaw, selectedNoise, snrDb, dispatch]);

    // ── Quality badge (same as v2) ────────────────────────────────────────────
    const getQualityBadge = () => {
        if (signalQuality == null) return null;
        if (signalQuality >= 0.8) return { text: '✓ Excellent', colors: [APP_COLORS.success, APP_COLORS.successLight, '#5FC9AE'] };
        if (signalQuality >= 0.6) return { text: '✓ Good', colors: [APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter] };
        if (signalQuality >= 0.4) return { text: '⚠ Fair', colors: [APP_COLORS.warning, APP_COLORS.warningLight, '#FFCC80'] };
        return { text: '⚠ Poor', colors: [APP_COLORS.error, APP_COLORS.errorLight, '#FFB0C0'] };
    };

    // ── Empty state ───────────────────────────────────────────────────────────
    if (!hasResults && !isProcessing && !sepError) {
        return (
            <View style={styles.container}>
                <ScrollView contentContainerStyle={styles.emptyStateContainer}>
                    <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
                        <LinearGradient
                            colors={['#D6F1F5', '#E6F7F9', '#FFFFFF']}
                            style={styles.emptyStateCard}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        >
                            <LottieView
                                source={require('../../../assets/lottie/heart.json')}
                                autoPlay loop style={styles.emptyStateLottie}
                            />
                            <Text style={styles.emptyStateTitle}>No Recording Analysed</Text>
                            <Text style={styles.emptyStateText}>
                                Complete a recording in the Record tab to separate heart and lung sounds here.
                            </Text>
                            <TouchableOpacity onPress={handleRetake}>
                                <LinearGradient
                                    colors={[APP_COLORS.primary, APP_COLORS.primaryLight,
                                    APP_COLORS.primaryLighter, APP_COLORS.primaryLightest]}
                                    style={styles.retakeButtonGradient}
                                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
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

    // ── Processing / NMF running ──────────────────────────────────────────────
    if (isProcessing) {
        return (
            <View style={styles.container}>
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: SPACING.xl }}>
                    <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
                        <LinearGradient
                            colors={['#D6F1F5', '#E6F7F9', '#FFFFFF']}
                            style={styles.loadingContainer}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        >
                            <LottieView
                                source={require('../../../assets/lottie/heart.json')}
                                autoPlay loop style={styles.loadingLottie}
                            />
                            <Text style={styles.loadingText}>
                                {progress.message || 'Separating Heart & Lung Sounds…'}
                            </Text>
                            <Text style={styles.loadingSubtext}>NMF analysis · ~1–2 seconds</Text>
                            <View style={styles.progressTrack}>
                                <View style={[styles.progressFill,
                                { width: `${progress.percent || 10}%` }]} />
                            </View>
                            <Text style={styles.progressPct}>{progress.percent || 10}%</Text>
                        </LinearGradient>
                    </Animated.View>
                </View>
            </View>
        );
    }

    // ── Error state ───────────────────────────────────────────────────────────
    if (sepError) {
        return (
            <View style={styles.container}>
                <Animated.View style={{ opacity: fadeAnim, margin: SPACING.xl }}>
                    <LinearGradient
                        colors={['#FFEBEE', '#FFCDD2', '#FFE8EF']}
                        style={styles.errorContainer}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    >
                        <Text style={styles.errorIcon}>⚠️</Text>
                        <Text style={styles.errorText}>{sepError}</Text>
                        <TouchableOpacity onPress={handleRetake}>
                            <LinearGradient
                                colors={[APP_COLORS.error, APP_COLORS.errorLight, '#FFB0C0']}
                                style={styles.retryButton}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            >
                                <Text style={styles.retryText}>Try Again</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </LinearGradient>
                </Animated.View>
            </View>
        );
    }

    // ── Results ───────────────────────────────────────────────────────────────
    const qb = getQualityBadge();
    const isHeart = selectedMedia === 'heart';
    const playFn = isHeart ? playHeart : playLung;
    const isCurrentlyPlaying = isHeart ? playingHeart : playingLung;
    const audioAvailable = isHeart ? !!heartRaw : !!lungRaw;

    // v3 noise chips config
    const NOISE_CHIPS = [
        { key: 'white', label: '⬜ White' },
        { key: 'pink', label: '🌸 Pink' },
        { key: 'brown', label: '🟤 Brown' },
        { key: 'voice', label: '🗣 Voice' },
    ];
    const SNR_OPTIONS = [-5, 0, 5, 10, 15, 20];

    return (
        <View style={styles.container}>
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >

                {/* ── NMF Result Card ──────────────────────────────────────── */}
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
                            <LinearGradient
                                colors={['#D4F4E7', '#E0F9EF', '#C8F5DC']}
                                style={styles.diagnosisCard}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            >
                                <View style={styles.diagnosisHeader}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.diagnosisLabel}>NMF SEPARATION RESULT</Text>
                                        <Text style={styles.diagnosisResult}>
                                            Heart & Lung sounds isolated
                                        </Text>
                                        {processingMs != null && (
                                            <Text style={[styles.diagnosisLabel,
                                            { marginTop: 4, fontSize: FONTS.sizes.xs }]}>
                                                Processed in {Math.round(processingMs)} ms
                                            </Text>
                                        )}
                                    </View>
                                    {qb && (
                                        <LinearGradient
                                            colors={qb.colors}
                                            style={styles.statusBadge}
                                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                        >
                                            <Text style={styles.statusText}>{qb.text}</Text>
                                        </LinearGradient>
                                    )}
                                </View>
                            </LinearGradient>
                        </Animated.View>
                    </View>
                </View>

                {/* ── Signal quality + noise meters ────────────────────────── */}
                {noiseLevel != null && (
                    <Animated.View style={{ opacity: fadeAnim, marginBottom: SPACING.xl }}>
                        <View style={styles.metersRow}>
                            <View style={[styles.meterCard, { flex: 1, marginRight: SPACING.sm }]}>
                                <Text style={styles.meterLabel}>Signal Quality</Text>
                                <View style={styles.meterTrack}>
                                    <View style={[styles.meterFill, {
                                        width: `${Math.round((signalQuality || 0) * 100)}%`,
                                        backgroundColor: APP_COLORS.success,
                                    }]} />
                                </View>
                                <Text style={styles.meterValue}>
                                    {Math.round((signalQuality || 0) * 100)}%
                                </Text>
                            </View>
                            <View style={[styles.meterCard, { flex: 1, marginLeft: SPACING.sm }]}>
                                <Text style={styles.meterLabel}>Noise Level</Text>
                                <View style={styles.meterTrack}>
                                    <View style={[styles.meterFill, {
                                        width: `${Math.round((noiseLevel || 0) * 100)}%`,
                                        backgroundColor: (noiseLevel || 0) > 0.4
                                            ? APP_COLORS.error : APP_COLORS.warning,
                                    }]} />
                                </View>
                                <Text style={styles.meterValue}>
                                    {Math.round((noiseLevel || 0) * 100)}%
                                </Text>
                            </View>
                        </View>
                    </Animated.View>
                )}

                {/* ════════════════════════════════════════════════════════════
                    v3 NEW BLOCK 1: HEART DETECTION BANNER
                    ════════════════════════════════════════════════════════════ */}
                {heartRaw && (
                    <Animated.View style={{ opacity: fadeAnim, marginBottom: SPACING.xl }}>

                        {/* Section header */}
                        <View style={styles.sectionHeaderRow}>
                            <LinearGradient
                                colors={[APP_COLORS.primary, APP_COLORS.primaryLight]}
                                style={styles.sectionAccentBar}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            />
                            <Text style={styles.sectionTitle}>❤️  Heart Sound Detection</Text>
                        </View>

                        {/* Run detection button — shown before first result */}
                        {heartDetected === null && !isDetectingHeart && (
                            <TouchableOpacity
                                style={styles.detectBtn}
                                onPress={handleDetectHeart}
                                activeOpacity={0.85}
                            >
                                <LinearGradient
                                    colors={['#0A7EA4', '#1A9BBF', '#2AB8DC']}
                                    style={styles.detectBtnGradient}
                                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                >
                                    <Text style={styles.detectBtnIcon}>🔬</Text>
                                    <Text style={styles.detectBtnText}>Detect Heart Sound</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        )}

                        {/* Spinner while detecting */}
                        {isDetectingHeart && (
                            <View style={styles.detectingRow}>
                                <ActivityIndicator size="small" color="#0A7EA4" />
                                <Text style={styles.detectingText}> Analysing heart band…</Text>
                            </View>
                        )}

                        {/* Detection error */}
                        {heartDetectError && !isDetectingHeart && (
                            <View style={styles.detectErrorRow}>
                                <Text style={styles.detectErrorText}>⚠️ {heartDetectError}</Text>
                                <TouchableOpacity onPress={handleDetectHeart}
                                    style={styles.reDetectBtn}>
                                    <Text style={styles.reDetectBtnText}>Retry ↺</Text>
                                </TouchableOpacity>
                            </View>
                        )}

                        {/* Result banner */}
                        {heartDetected !== null && !isDetectingHeart && !heartDetectError && (
                            <LinearGradient
                                colors={
                                    heartDetected
                                        ? ['#D4F4E7', '#E0F9EF', '#C8F5DC']
                                        : ['#FFEBEE', '#FFCDD2', '#FFE8EF']
                                }
                                style={styles.heartDetectCard}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            >
                                {/* Main row */}
                                <View style={styles.heartDetectRow}>
                                    <Text style={styles.heartDetectIcon}>
                                        {heartDetected ? '❤️' : '⚠️'}
                                    </Text>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[
                                            styles.heartDetectTitle,
                                            { color: heartDetected ? '#1B7A4A' : '#C62828' },
                                        ]}>
                                            {heartDetected
                                                ? 'Heart Sound Detected'
                                                : 'No Heart Sound Detected'}
                                        </Text>
                                        <Text style={styles.heartDetectSub}>
                                            Confidence: {Math.round((heartConfidence || 0) * 100)}%
                                            {heartBpm ? `   ·   ~${Math.round(heartBpm)} BPM` : ''}
                                        </Text>
                                    </View>
                                    {/* Re-run button */}
                                    <TouchableOpacity
                                        onPress={handleDetectHeart}
                                        style={styles.reDetectIconBtn}
                                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                    >
                                        <Text style={styles.reDetectIconText}>↺</Text>
                                    </TouchableOpacity>
                                </View>

                                {/* Confidence progress bar */}
                                <View style={styles.meterTrack}>
                                    <View style={[styles.meterFill, {
                                        width: `${Math.round((heartConfidence || 0) * 100)}%`,
                                        backgroundColor: heartDetected ? '#1B7A4A' : '#C62828',
                                    }]} />
                                </View>

                                {/* Detail metrics row */}
                                <View style={styles.heartMetricsRow}>
                                    <View style={styles.heartMetricItem}>
                                        <Text style={styles.heartMetricLabel}>Energy Ratio</Text>
                                        <Text style={styles.heartMetricValue}>
                                            {Math.round((heartEnergyRatio || 0) * 100)}%
                                        </Text>
                                    </View>
                                    <View style={styles.heartMetricDivider} />
                                    <View style={styles.heartMetricItem}>
                                        <Text style={styles.heartMetricLabel}>Periodicity</Text>
                                        <Text style={styles.heartMetricValue}>
                                            {Math.round((heartPeriodicity || 0) * 100)}%
                                        </Text>
                                    </View>
                                    <View style={styles.heartMetricDivider} />
                                    <View style={styles.heartMetricItem}>
                                        <Text style={styles.heartMetricLabel}>Est. BPM</Text>
                                        <Text style={styles.heartMetricValue}>
                                            {heartBpm ? Math.round(heartBpm) : '—'}
                                        </Text>
                                    </View>
                                </View>
                            </LinearGradient>
                        )}
                    </Animated.View>
                )}

                {/* ════════════════════════════════════════════════════════════
                    v3 NEW BLOCK 2: NOISE INJECTION CONTROLS
                    ════════════════════════════════════════════════════════════ */}
                {heartRaw && (
                    <Animated.View style={{ opacity: fadeAnim, marginBottom: SPACING.xl }}>

                        <View style={styles.sectionHeaderRow}>
                            <LinearGradient
                                colors={['#5B8DEF', '#7B6FF0']}
                                style={styles.sectionAccentBar}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                            />
                            <Text style={styles.sectionTitle}>🎛  Add External Noise</Text>
                        </View>

                        <LinearGradient
                            colors={['#F3F8FF', '#E8F2FE', '#DDEAFD']}
                            style={styles.noiseCard}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        >
                            <Text style={styles.noiseSectionSub}>
                                Inject noise into the heart channel to test separation robustness
                            </Text>

                            {/* Noise type chips */}
                            <Text style={styles.noisePickerLabel}>Noise Type</Text>
                            <View style={styles.noiseTypeRow}>
                                {NOISE_CHIPS.map(({ key, label }) => (
                                    <TouchableOpacity
                                        key={key}
                                        style={[
                                            styles.noiseTypeChip,
                                            selectedNoise === key && styles.noiseTypeChipActive,
                                        ]}
                                        onPress={() => setSelectedNoise(key)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[
                                            styles.noiseTypeChipText,
                                            selectedNoise === key && styles.noiseTypeChipTextActive,
                                        ]}>
                                            {label}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* SNR picker */}
                            <Text style={styles.noisePickerLabel}>SNR: {snrDb} dB</Text>
                            <View style={styles.snrRow}>
                                {SNR_OPTIONS.map(v => (
                                    <TouchableOpacity
                                        key={v}
                                        style={[styles.snrBtn, snrDb === v && styles.snrBtnActive]}
                                        onPress={() => setSnrDb(v)}
                                        activeOpacity={0.8}
                                    >
                                        <Text style={[
                                            styles.snrBtnText,
                                            snrDb === v && styles.snrBtnTextActive,
                                        ]}>
                                            {v > 0 ? `+${v}` : v}
                                        </Text>
                                    </TouchableOpacity>
                                ))}
                            </View>

                            {/* Add Noise button */}
                            <TouchableOpacity
                                style={[styles.addNoiseBtn,
                                isAddingNoise && styles.addNoiseBtnDisabled]}
                                onPress={handleAddNoise}
                                disabled={isAddingNoise}
                                activeOpacity={0.85}
                            >
                                {isAddingNoise
                                    ? <ActivityIndicator size="small" color="#FFF" />
                                    : <Text style={styles.addNoiseBtnText}>
                                        Add Noise &amp; Preview
                                    </Text>
                                }
                            </TouchableOpacity>

                            {/* Add noise error */}
                            {addNoiseError && !isAddingNoise && (
                                <Text style={styles.addNoiseError}>⚠️ {addNoiseError}</Text>
                            )}

                            {/* Noisy audio player row */}
                            {noisyAudio && !isAddingNoise && (
                                <View style={styles.noisyPlayerRow}>
                                    <Text style={styles.noisyPlayerLabel} numberOfLines={1}>
                                        🔊 {selectedNoise.charAt(0).toUpperCase() + selectedNoise.slice(1)} noise · {snrDb} dB SNR
                                    </Text>
                                    <TouchableOpacity
                                        style={[
                                            styles.noisyPlayBtn,
                                            playingNoisy && styles.noisyPlayBtnActive,
                                        ]}
                                        onPress={playingNoisy ? stopPlayback : playNoisy}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.noisyPlayBtnIcon}>
                                            {playingNoisy ? '⏸' : '▶'}
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                            )}
                        </LinearGradient>
                    </Animated.View>
                )}

                {/* ── Media selector (heart / lung) ─────────────────────────── */}
                <Animated.View style={{
                    opacity: fadeAnim,
                    transform: [{ translateY: slideAnim }],
                    marginBottom: SPACING.xl,
                }}>
                    <View style={styles.controlsHeader}>
                        <LinearGradient
                            colors={[APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter]}
                            style={styles.controlsTitleAccent}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        />
                        <Text style={styles.controlsTitle}>Sound Channels</Text>
                    </View>

                    <View style={styles.mediaGrid}>
                        <MediaButton
                            item={{
                                key: 'heart',
                                label: 'Heart Sound',
                                sublabel: 'Low freq · 20–150 Hz',
                                icon: '❤️',
                                available: !!heartRaw,
                                color: APP_COLORS.error || '#E53935',
                                colorMid: APP_COLORS.errorLight || '#EF9A9A',
                                colorLight: '#FFCDD2',
                            }}
                            isSelected={selectedMedia === 'heart'}
                            onPress={setSelectedMedia}
                        />
                        <MediaButton
                            item={{
                                key: 'lung',
                                label: 'Lung Sound',
                                sublabel: 'Broadband · 80–1000 Hz',
                                icon: '🫁',
                                available: !!lungRaw,
                                color: APP_COLORS.primary,
                                colorMid: APP_COLORS.primaryLight,
                                colorLight: APP_COLORS.primaryLighter,
                            }}
                            isSelected={selectedMedia === 'lung'}
                            onPress={setSelectedMedia}
                        />
                    </View>
                </Animated.View>

                {/* ── Audio player card ─────────────────────────────────────── */}
                {audioAvailable && (
                    <Animated.View style={[
                        styles.videoSection,
                        { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
                    ]}>
                        <LinearGradient
                            colors={['#FFFFFF', '#F0F9FB', '#E6F5F8']}
                            style={styles.playerCard}
                        >
                            <Text style={styles.playerTitle}>
                                {isHeart ? '❤️  Heart Sound' : '🫁  Lung Sound'}
                            </Text>
                            <Text style={styles.playerSub}>
                                {isHeart
                                    ? 'Low-frequency component (20–150 Hz)'
                                    : 'Broadband component (80–1000 Hz)'}
                            </Text>

                            {/* Play / Stop row */}
                            <View style={styles.playerBtnRow}>
                                <TouchableOpacity
                                    style={[
                                        styles.playBtn,
                                        isCurrentlyPlaying && styles.playBtnActive,
                                    ]}
                                    onPress={isCurrentlyPlaying ? stopPlayback : playFn}
                                    activeOpacity={0.85}
                                >
                                    <LinearGradient
                                        colors={
                                            isCurrentlyPlaying
                                                ? ['#C62828', '#E53935', '#EF9A9A']
                                                : [APP_COLORS.primary, APP_COLORS.primaryLight,
                                                APP_COLORS.primaryLighter]
                                        }
                                        style={styles.playBtnGradient}
                                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                                    >
                                        <Text style={styles.playBtnIcon}>
                                            {isCurrentlyPlaying ? '⏹ Stop' : '▶ Play'}
                                        </Text>
                                    </LinearGradient>
                                </TouchableOpacity>

                                {/* Save button */}
                                <TouchableOpacity
                                    style={styles.saveBtn}
                                    onPress={() => saveAudio(isHeart ? 'heart' : 'lung')}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.saveBtnText}>💾 Save</Text>
                                </TouchableOpacity>
                            </View>
                        </LinearGradient>
                    </Animated.View>
                )}

                {/* ── Retake button — identical to original ─────────────────── */}
                <Animated.View style={{
                    opacity: fadeAnim,
                    transform: [{ translateY: slideAnim }],
                    marginTop: SPACING.md,
                }}>
                    <TouchableOpacity onPress={handleRetake}>
                        <LinearGradient
                            colors={[APP_COLORS.primaryDarker, APP_COLORS.primary,
                            APP_COLORS.primaryLightest, APP_COLORS.primaryDarker]}
                            style={styles.retakeButtonGradient}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        >
                            <Text style={styles.retakeIcon}>🔄</Text>
                            <Text style={styles.retakeText}>{t('retake_recording')}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </Animated.View>

            </ScrollView>
        </View>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
//  Styles — all original styles preserved; new v3 styles appended at bottom
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8FAFC',
    },
    scrollContent: {
        padding: SPACING.xl,
    },

    // Header ──────────────────────────────────────────────────────────────────
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: SPACING.xl,
        gap: SPACING.md,
    },

    // Diagnosis Card ──────────────────────────────────────────────────────────
    diagnosisCard: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.xl,
        ...SHADOWS.large,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.9)',
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

    // Meters ──────────────────────────────────────────────────────────────────
    metersRow: {
        flexDirection: 'row',
    },
    meterCard: {
        backgroundColor: '#FFF',
        borderRadius: BORDER_RADIUS.lg,
        padding: SPACING.md,
        ...SHADOWS.small,
    },
    meterLabel: {
        fontSize: FONTS.sizes.xs,
        color: '#64748B',
        fontWeight: '600',
        marginBottom: 6,
        letterSpacing: 0.5,
    },
    meterTrack: {
        height: 6,
        backgroundColor: '#E2E8F0',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 4,
    },
    meterFill: {
        height: '100%',
        borderRadius: 3,
    },
    meterValue: {
        fontSize: FONTS.sizes.sm,
        fontWeight: '700',
        color: '#1E3A5F',
    },

    // Video Section ───────────────────────────────────────────────────────────
    videoSection: {
        marginBottom: SPACING.xl,
    },
    playerCard: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.xl,
        ...SHADOWS.medium,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.8)',
    },
    playerTitle: {
        fontSize: FONTS.sizes.lg,
        fontWeight: '800',
        color: '#1E3A5F',
        marginBottom: 4,
    },
    playerSub: {
        fontSize: FONTS.sizes.xs,
        color: '#64748B',
        marginBottom: SPACING.lg,
    },
    playerBtnRow: {
        flexDirection: 'row',
        gap: SPACING.md,
    },
    playBtn: {
        flex: 1,
        borderRadius: BORDER_RADIUS.lg,
        overflow: 'hidden',
    },
    playBtnActive: {
        opacity: 0.9,
    },
    playBtnGradient: {
        paddingVertical: 14,
        alignItems: 'center',
        borderRadius: BORDER_RADIUS.lg,
    },
    playBtnIcon: {
        fontSize: 15,
        fontWeight: '800',
        color: '#FFF',
        letterSpacing: 0.5,
    },
    saveBtn: {
        paddingHorizontal: SPACING.xl,
        paddingVertical: 14,
        backgroundColor: '#F1F5F9',
        borderRadius: BORDER_RADIUS.lg,
        borderWidth: 1,
        borderColor: '#CBD5E1',
        justifyContent: 'center',
        alignItems: 'center',
    },
    saveBtnText: {
        fontSize: FONTS.sizes.sm,
        fontWeight: '700',
        color: '#1E3A5F',
    },

    // Media Controls ──────────────────────────────────────────────────────────
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
        borderColor: 'rgba(255,255,255,0.8)',
    },
    mediaControlCardActive: {
        borderWidth: 3,
        borderColor: 'rgba(255,255,255,0.95)',
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
        backgroundColor: 'rgba(255,255,255,0.3)',
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

    // Loading ─────────────────────────────────────────────────────────────────
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
    progressTrack: {
        width: '100%',
        height: 8,
        backgroundColor: '#E2E8F0',
        borderRadius: 4,
        overflow: 'hidden',
        marginTop: SPACING.lg,
    },
    progressFill: {
        height: '100%',
        backgroundColor: APP_COLORS.primary,
        borderRadius: 4,
    },
    progressPct: {
        marginTop: SPACING.sm,
        fontSize: FONTS.sizes.sm,
        color: APP_COLORS.primaryDark,
        fontWeight: '600',
    },

    // Error ───────────────────────────────────────────────────────────────────
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

    // Empty State ─────────────────────────────────────────────────────────────
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

    // ── v3 NEW STYLES ─────────────────────────────────────────────────────────

    // Section headers
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.md,
    },
    sectionAccentBar: {
        width: 5,
        height: 24,
        borderRadius: 3,
        marginRight: SPACING.md,
    },
    sectionTitle: {
        fontSize: FONTS.sizes.lg,
        fontWeight: '800',
        color: '#1E3A5F',
        letterSpacing: 0.3,
    },

    // Heart detection — detect button
    detectBtn: {
        borderRadius: BORDER_RADIUS.lg,
        overflow: 'hidden',
        marginBottom: SPACING.md,
        ...SHADOWS.small,
    },
    detectBtnGradient: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 14,
        paddingHorizontal: SPACING.xl,
        borderRadius: BORDER_RADIUS.lg,
    },
    detectBtnIcon: {
        fontSize: 18,
        marginRight: SPACING.sm,
    },
    detectBtnText: {
        fontSize: FONTS.sizes.md,
        fontWeight: '700',
        color: '#FFF',
        letterSpacing: 0.3,
    },

    // Detecting spinner row
    detectingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: SPACING.md,
        paddingHorizontal: SPACING.lg,
        backgroundColor: '#E8F6FB',
        borderRadius: BORDER_RADIUS.md,
        marginBottom: SPACING.md,
    },
    detectingText: {
        fontSize: FONTS.sizes.sm,
        color: '#0A7EA4',
        fontWeight: '600',
    },

    // Detect error row
    detectErrorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: SPACING.sm,
        paddingHorizontal: SPACING.md,
        backgroundColor: '#FFF3F3',
        borderRadius: BORDER_RADIUS.md,
        marginBottom: SPACING.md,
        gap: SPACING.sm,
    },
    detectErrorText: {
        flex: 1,
        fontSize: FONTS.sizes.xs,
        color: '#C62828',
        fontWeight: '500',
    },
    reDetectBtn: {
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.xs,
        backgroundColor: '#C62828',
        borderRadius: BORDER_RADIUS.sm,
    },
    reDetectBtnText: {
        fontSize: FONTS.sizes.xs,
        color: '#FFF',
        fontWeight: '700',
    },

    // Heart detection result card
    heartDetectCard: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.lg,
        ...SHADOWS.medium,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.9)',
    },
    heartDetectRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: SPACING.md,
    },
    heartDetectIcon: {
        fontSize: 32,
        marginRight: SPACING.md,
    },
    heartDetectTitle: {
        fontSize: FONTS.sizes.md,
        fontWeight: '800',
        marginBottom: 3,
    },
    heartDetectSub: {
        fontSize: FONTS.sizes.xs,
        color: '#555',
        fontWeight: '500',
    },
    reDetectIconBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: 'rgba(0,0,0,0.08)',
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: SPACING.sm,
    },
    reDetectIconText: {
        fontSize: 18,
        color: '#555',
        fontWeight: '700',
    },
    heartMetricsRow: {
        flexDirection: 'row',
        marginTop: SPACING.md,
        backgroundColor: 'rgba(255,255,255,0.5)',
        borderRadius: BORDER_RADIUS.md,
        padding: SPACING.md,
    },
    heartMetricItem: {
        flex: 1,
        alignItems: 'center',
    },
    heartMetricDivider: {
        width: 1,
        backgroundColor: 'rgba(0,0,0,0.1)',
        marginVertical: 2,
    },
    heartMetricLabel: {
        fontSize: FONTS.sizes.xs,
        color: '#555',
        fontWeight: '500',
        marginBottom: 2,
        letterSpacing: 0.3,
    },
    heartMetricValue: {
        fontSize: FONTS.sizes.sm,
        color: '#1E3A5F',
        fontWeight: '800',
    },

    // Noise injection card
    noiseCard: {
        borderRadius: BORDER_RADIUS.xl,
        padding: SPACING.lg,
        ...SHADOWS.medium,
        borderWidth: 1.5,
        borderColor: 'rgba(255,255,255,0.85)',
    },
    noiseSectionSub: {
        fontSize: FONTS.sizes.xs,
        color: '#4A6A8C',
        fontWeight: '500',
        marginBottom: SPACING.md,
        lineHeight: 18,
    },
    noisePickerLabel: {
        fontSize: FONTS.sizes.xs,
        color: '#1A3A5C',
        fontWeight: '700',
        letterSpacing: 0.8,
        marginBottom: SPACING.sm,
        textTransform: 'uppercase',
    },
    noiseTypeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: SPACING.sm,
        marginBottom: SPACING.lg,
    },
    noiseTypeChip: {
        paddingVertical: 7,
        paddingHorizontal: SPACING.md,
        borderRadius: BORDER_RADIUS.full || 999,
        backgroundColor: '#E8F2FE',
        borderWidth: 1.5,
        borderColor: '#C0D8F8',
    },
    noiseTypeChipActive: {
        backgroundColor: '#0A7EA4',
        borderColor: '#0A7EA4',
    },
    noiseTypeChipText: {
        fontSize: FONTS.sizes.sm,
        color: '#1A3A5C',
        fontWeight: '600',
    },
    noiseTypeChipTextActive: {
        color: '#FFF',
    },
    snrRow: {
        flexDirection: 'row',
        gap: 6,
        marginBottom: SPACING.lg,
    },
    snrBtn: {
        flex: 1,
        paddingVertical: 8,
        alignItems: 'center',
        borderRadius: BORDER_RADIUS.md,
        backgroundColor: '#E8F2FE',
        borderWidth: 1.5,
        borderColor: '#C0D8F8',
    },
    snrBtnActive: {
        backgroundColor: '#0A7EA4',
        borderColor: '#0A7EA4',
    },
    snrBtnText: {
        fontSize: FONTS.sizes.xs,
        color: '#1A3A5C',
        fontWeight: '700',
    },
    snrBtnTextActive: {
        color: '#FFF',
    },
    addNoiseBtn: {
        backgroundColor: '#0A7EA4',
        borderRadius: BORDER_RADIUS.lg,
        paddingVertical: 13,
        alignItems: 'center',
        marginBottom: SPACING.md,
        ...SHADOWS.small,
    },
    addNoiseBtnDisabled: {
        opacity: 0.6,
    },
    addNoiseBtnText: {
        fontSize: FONTS.sizes.md,
        fontWeight: '800',
        color: '#FFF',
        letterSpacing: 0.3,
    },
    addNoiseError: {
        fontSize: FONTS.sizes.xs,
        color: '#C62828',
        fontWeight: '500',
        marginBottom: SPACING.sm,
        textAlign: 'center',
    },
    noisyPlayerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.7)',
        borderRadius: BORDER_RADIUS.lg,
        padding: SPACING.md,
        gap: SPACING.md,
        borderWidth: 1,
        borderColor: 'rgba(10,126,164,0.2)',
    },
    noisyPlayerLabel: {
        flex: 1,
        fontSize: FONTS.sizes.sm,
        color: '#1A3A5C',
        fontWeight: '600',
    },
    noisyPlayBtn: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#0A7EA4',
        justifyContent: 'center',
        alignItems: 'center',
        ...SHADOWS.small,
    },
    noisyPlayBtnActive: {
        backgroundColor: '#C62828',
    },
    noisyPlayBtnIcon: {
        fontSize: 16,
        color: '#FFF',
        fontWeight: '700',
    },
});