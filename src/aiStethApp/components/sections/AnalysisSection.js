// src/aiStethApp/components/sections/AnalysisSection.js
//
// COMPLETE REPLACEMENT for AiStethAnalysisSection.js
//
// REMOVED:
//   WebView, react-native-webview dependency
//   fetchAIAnalysis / fetchVisualization / fetchAudioUrl polling thunks
//   POLLING_INTERVALS, MAX_POLL_ATTEMPTS, 5 polling refs, 5 attempt counters
//   AiStethAnalysisSlice selectors (15 selectors)
//   getVideoHTML / getAudioHTML  (no longer needed — native AudioTrack used)
//   AiSteth patientId / fileName requirements
//
// ADDED:
//   SeparationSlice selectors (heart, lung, noiseLevel, signalQuality, etc.)
//   SeparationAudioPlayer native module for AudioTrack playback
//   Signal quality badge from NMF noiseLevel metric
//   Noise level + signal quality meters
//   Save WAV to device storage
//   Progress bar during processing
//
// UI KEPT IDENTICAL:
//   Same card layouts, gradients, animations, MediaButton, retake button,
//   empty/loading/error states, styles — all pixel-for-pixel preserved.

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
} from '../../../store/slices/SeparationSlice';

const { SeparationAudioPlayer } = NativeModules;

// ── MediaButton — identical to original ──────────────────────────────────────
const MediaButton = memo(({ item, isSelected, onPress }) => {
    const scaleAnim = useRef(new Animated.Value(1)).current;

    const handlePressIn = () => {
        Animated.spring(scaleAnim, { toValue: 0.95, useNativeDriver: true }).start();
    };
    const handlePressOut = () => {
        Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 3, useNativeDriver: true }).start();
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

    // ── SeparationSlice selectors (replace all AiSteth selectors) ────────────
    const isProcessing  = useSelector(selectIsProcessing);
    const progress      = useSelector(selectProgress);
    const heartRaw      = useSelector(selectHeart);
    const lungRaw       = useSelector(selectLung);
    const heartWav      = useSelector(selectHeartWav);
    const lungWav       = useSelector(selectLungWav);
    const noiseLevel    = useSelector(selectNoiseLevel);
    const signalQuality = useSelector(selectSignalQuality);
    const processingMs  = useSelector(selectProcessingMs);
    const sepError      = useSelector(selectSepError);
    const hasResults    = useSelector(selectHasResults);

    // UI state
    const [selectedMedia,  setSelectedMedia]  = useState('heart');
    const [playingHeart,   setPlayingHeart]   = useState(false);
    const [playingLung,    setPlayingLung]    = useState(false);

    // Animations — same refs/config as original
    const fadeAnim  = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const scaleAnim = useRef(new Animated.Value(0.9)).current;
    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.timing(fadeAnim,  { toValue: 1, duration: 800, useNativeDriver: true }),
            Animated.spring(slideAnim, { toValue: 0, tension: 30, friction: 8, useNativeDriver: true }),
            Animated.spring(scaleAnim, { toValue: 1, tension: 40, friction: 7, useNativeDriver: true }),
        ]).start();
        const loop = Animated.loop(Animated.sequence([
            Animated.timing(pulseAnim, { toValue: 1.05, duration: 1500, useNativeDriver: true }),
            Animated.timing(pulseAnim, { toValue: 1,    duration: 1500, useNativeDriver: true }),
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

    const stopPlayback = useCallback(async () => {
        try { await SeparationAudioPlayer.stopPlayback(); } catch {}
        setPlayingHeart(false); setPlayingLung(false);
    }, []);

    // ── Save WAV ──────────────────────────────────────────────────────────────
    const saveAudio = useCallback(async which => {
        const wav = which === 'heart' ? heartWav : lungWav;
        if (!wav) { Alert.alert('No Audio', `No ${which} audio to save`); return; }
        try {
            const fn = `${which}_${Date.now()}.wav`;
            const r  = await SeparationAudioPlayer.saveAudioFile(wav, fn, which);
            Alert.alert('Saved ✓', `Saved to:\n${r.filePath}`);
        } catch (e) { Alert.alert('Save Error', e.message); }
    }, [heartWav, lungWav]);

    // ── Retake (identical pattern to original handleRetake) ───────────────────
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

    // ── Quality badge (replaces AiSteth AI analysis text) ────────────────────
    const getQualityBadge = () => {
        if (signalQuality == null) return null;
        if (signalQuality >= 0.8)  return { text: '✓ Excellent', colors: [APP_COLORS.success, APP_COLORS.successLight, '#5FC9AE'] };
        if (signalQuality >= 0.6)  return { text: '✓ Good',      colors: [APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter] };
        if (signalQuality >= 0.4)  return { text: '⚠ Fair',      colors: [APP_COLORS.warning, APP_COLORS.warningLight, '#FFCC80'] };
        return                             { text: '⚠ Poor',      colors: [APP_COLORS.error, APP_COLORS.errorLight, '#FFB0C0'] };
    };

    // ── Media items (replaces vis_gt/vis_denoised/audio_gt/audio_denoised) ───
    const mediaItems = [
        {
            key:      'heart',
            label:    t('denoised_heart_sound') || 'Heart Sound',
            sublabel: '20–150 Hz · NMF separated',
            icon:     '❤️',
            available: !!heartRaw,
            color:     APP_COLORS.success,
            colorMid:  APP_COLORS.successLight,
            colorLight:'#5FC9AE',
        },
        {
            key:      'lung',
            label:    t('lung_sound') || 'Lung Sound',
            sublabel: '100–1000 Hz · NMF separated',
            icon:     '🫁',
            available: !!lungRaw,
            color:     APP_COLORS.secondary,
            colorMid:  APP_COLORS.secondaryLight,
            colorLight:'#6FD0E5',
        },
    ];

    const handleMediaSelect = useCallback(key => {
        setSelectedMedia(key);
    }, []);

    // ── Empty state ───────────────────────────────────────────────────────────
    if (!hasResults && !isProcessing && !sepError) {
        return (
            <View style={styles.container}>
                <ScrollView contentContainerStyle={styles.emptyStateContainer}>
                    <Animated.View style={{ opacity: fadeAnim, transform: [{ scale: scaleAnim }] }}>
                        <LinearGradient colors={['#D6F1F5', '#E6F7F9', '#FFFFFF']}
                                        style={styles.emptyStateCard}
                                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                            <LottieView source={require('../../../assets/lottie/heart.json')}
                                        autoPlay loop style={styles.emptyStateLottie} />
                            <Text style={styles.emptyStateTitle}>No Recording Analysed</Text>
                            <Text style={styles.emptyStateText}>
                                Complete a recording in the Record tab to separate heart and lung sounds here.
                            </Text>
                            <TouchableOpacity onPress={handleRetake}>
                                <LinearGradient
                                    colors={[APP_COLORS.primary, APP_COLORS.primaryLight,
                                             APP_COLORS.primaryLighter, APP_COLORS.primaryLightest]}
                                    style={styles.retakeButtonGradient}
                                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
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
                        <LinearGradient colors={['#D6F1F5', '#E6F7F9', '#FFFFFF']}
                                        style={styles.loadingContainer}
                                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                            <LottieView source={require('../../../assets/lottie/heart.json')}
                                        autoPlay loop style={styles.loadingLottie} />
                            <Text style={styles.loadingText}>
                                {progress.message || 'Separating Heart & Lung Sounds…'}
                            </Text>
                            <Text style={styles.loadingSubtext}>NMF analysis · ~1–2 seconds</Text>
                            <View style={styles.progressTrack}>
                                <View style={[styles.progressFill, { width: `${progress.percent || 10}%` }]} />
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
                    <LinearGradient colors={['#FFEBEE', '#FFCDD2', '#FFE8EF']}
                                    style={styles.errorContainer}
                                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                        <Text style={styles.errorIcon}>⚠️</Text>
                        <Text style={styles.errorText}>{sepError}</Text>
                        <TouchableOpacity onPress={handleRetake}>
                            <LinearGradient colors={[APP_COLORS.error, APP_COLORS.errorLight, '#FFB0C0']}
                                            style={styles.retryButton}
                                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                                <Text style={styles.retryText}>Try Again</Text>
                            </LinearGradient>
                        </TouchableOpacity>
                    </LinearGradient>
                </Animated.View>
            </View>
        );
    }

    // ── Results ───────────────────────────────────────────────────────────────
    const qb            = getQualityBadge();
    const isHeart       = selectedMedia === 'heart';
    const playFn        = isHeart ? playHeart : playLung;
    const isPlaying     = isHeart ? playingHeart : playingLung;
    const audioAvailable = isHeart ? !!heartRaw : !!lungRaw;

    return (
        <View style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

                {/* ── AI Result Card (replaces renderAIResult) ─────────────── */}
                <View style={styles.header}>
                    <View style={{ flex: 1 }}>
                        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
                            <LinearGradient
                                colors={['#D4F4E7', '#E0F9EF', '#C8F5DC']}
                                style={styles.diagnosisCard}
                                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                                <View style={styles.diagnosisHeader}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={styles.diagnosisLabel}>NMF SEPARATION RESULT</Text>
                                        <Text style={styles.diagnosisResult}>
                                            Heart & Lung sounds isolated
                                        </Text>
                                        {processingMs != null && (
                                            <Text style={[styles.diagnosisLabel, { marginTop: 4, fontSize: FONTS.sizes.xs }]}>
                                                Processed in {Math.round(processingMs)} ms
                                            </Text>
                                        )}
                                    </View>
                                    {qb && (
                                        <LinearGradient
                                            colors={qb.colors}
                                            style={styles.statusBadge}
                                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                                            <Text style={styles.statusText}>{qb.text}</Text>
                                        </LinearGradient>
                                    )}
                                </View>
                            </LinearGradient>
                        </Animated.View>
                    </View>
                </View>

                {/* ── Noise & quality meters ─────────────────────────────────── */}
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
                                <Text style={styles.meterValue}>{Math.round((signalQuality || 0) * 100)}%</Text>
                            </View>
                            <View style={[styles.meterCard, { flex: 1, marginLeft: SPACING.sm }]}>
                                <Text style={styles.meterLabel}>Noise Level</Text>
                                <View style={styles.meterTrack}>
                                    <View style={[styles.meterFill, {
                                        width: `${Math.round((noiseLevel || 0) * 100)}%`,
                                        backgroundColor: (noiseLevel || 0) > 0.4 ? APP_COLORS.error : APP_COLORS.warning,
                                    }]} />
                                </View>
                                <Text style={styles.meterValue}>{Math.round((noiseLevel || 0) * 100)}%</Text>
                            </View>
                        </View>
                    </Animated.View>
                )}

                {/* ── Player (replaces renderMediaPlayer / WebView) ─────────── */}
                {audioAvailable && (
                    <Animated.View style={[styles.videoSection, { opacity: fadeAnim, transform: [{ scale: scaleAnim }] }]}>
                        <LinearGradient colors={['#FFFFFF', '#F0F9FB', '#E6F5F8']}
                                        style={styles.playerCard}>
                            <Text style={styles.playerTitle}>
                                {isHeart ? '❤️  Heart Sound' : '🫁  Lung Sound'}
                            </Text>
                            <Text style={styles.playerSub}>
                                {isHeart
                                    ? 'Low-frequency component (20–150 Hz)'
                                    : 'Broadband component (100–1000 Hz)'}
                            </Text>
                            <View style={styles.playerBtns}>
                                <TouchableOpacity onPress={playFn} disabled={isPlaying} style={{ flex: 1 }}>
                                    <LinearGradient
                                        colors={isPlaying ? ['#9E9E9E', '#BDBDBD'] : [APP_COLORS.primary, APP_COLORS.primaryLight]}
                                        style={styles.playerBtn}>
                                        {isPlaying
                                            ? <ActivityIndicator size="small" color="#FFF" />
                                            : <Text style={styles.playerBtnText}>▶  Play</Text>}
                                    </LinearGradient>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={stopPlayback} style={{ flex: 1, marginLeft: SPACING.sm }}>
                                    <LinearGradient colors={['#FF7043', '#FF8A65']} style={styles.playerBtn}>
                                        <Text style={styles.playerBtnText}>⏹  Stop</Text>
                                    </LinearGradient>
                                </TouchableOpacity>
                            </View>
                            <TouchableOpacity onPress={() => saveAudio(selectedMedia)} style={{ marginTop: SPACING.md }}>
                                <LinearGradient colors={[APP_COLORS.secondary, APP_COLORS.secondaryLight]}
                                                style={styles.playerBtn}>
                                    <Text style={styles.playerBtnText}>💾  Save WAV</Text>
                                </LinearGradient>
                            </TouchableOpacity>
                        </LinearGradient>
                    </Animated.View>
                )}

                {/* ── Media controls (replaces renderMediaControls) ─────────── */}
                <Animated.View style={[styles.mediaControlsContainer,
                    { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
                    <View style={styles.controlsHeader}>
                        <LinearGradient
                            colors={[APP_COLORS.primary, APP_COLORS.primaryLight, APP_COLORS.primaryLighter]}
                            style={styles.controlsTitleAccent}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        />
                        <Text style={styles.controlsTitle}>{t('media_library') || 'Separated Signals'}</Text>
                    </View>
                    <View style={styles.mediaGrid}>
                        {mediaItems.map(item => (
                            <MediaButton key={item.key} item={item}
                                         isSelected={selectedMedia === item.key}
                                         onPress={handleMediaSelect} />
                        ))}
                    </View>
                </Animated.View>

                {/* ── Retake button — identical to original ─────────────────── */}
                <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
                    <TouchableOpacity onPress={handleRetake}>
                        <LinearGradient
                            colors={[APP_COLORS.primaryDarker, APP_COLORS.primary,
                                     APP_COLORS.primaryLightest, APP_COLORS.primaryDarker]}
                            style={styles.retakeButtonGradient}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                            <Text style={styles.retakeIcon}>🔄</Text>
                            <Text style={styles.retakeText}>{t('retake_recording')}</Text>
                        </LinearGradient>
                    </TouchableOpacity>
                </Animated.View>

            </ScrollView>
        </View>
    );
});

// ── Styles — identical to original + new NMF-specific additions ───────────────
const styles = StyleSheet.create({
    container:             { flex: 1, backgroundColor: '#F8FAFC' },
    scrollContent:         { padding: SPACING.xl },
    header:                { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SPACING.xl, gap: SPACING.md },
    diagnosisCard:         { borderRadius: BORDER_RADIUS.xl, padding: SPACING.xl, ...SHADOWS.large, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
    diagnosisHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
    diagnosisLabel:        { fontSize: FONTS.sizes.sm, color: '#1E3A5F', fontWeight: '800', marginBottom: SPACING.sm, letterSpacing: 1.5, opacity: 0.8 },
    diagnosisResult:       { fontSize: FONTS.sizes.xl, color: '#1E3A5F', fontWeight: '700', lineHeight: 28 },
    statusBadge:           { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.xl, ...SHADOWS.small },
    statusText:            { fontSize: FONTS.sizes.sm, fontWeight: '800', color: '#FFFFFF', letterSpacing: 0.5 },
    // Meters (new)
    metersRow:             { flexDirection: 'row' },
    meterCard:             { backgroundColor: '#FFF', borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, ...SHADOWS.small, borderWidth: 1, borderColor: COLORS.border },
    meterLabel:            { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '600', marginBottom: 4 },
    meterTrack:            { height: 6, backgroundColor: '#E0E0E0', borderRadius: 3, overflow: 'hidden', marginBottom: 4 },
    meterFill:             { height: '100%', borderRadius: 3 },
    meterValue:            { fontSize: FONTS.sizes.sm, fontWeight: '700', color: '#1E3A5F' },
    // Player card (replaces WebView)
    videoSection:          { marginBottom: SPACING.xl },
    playerCard:            { borderRadius: BORDER_RADIUS.xl, padding: SPACING.xl, ...SHADOWS.large, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)' },
    playerTitle:           { fontSize: FONTS.sizes.xl, fontWeight: '800', color: '#1E3A5F', marginBottom: SPACING.xs },
    playerSub:             { fontSize: FONTS.sizes.sm, color: APP_COLORS.primaryDark, marginBottom: SPACING.lg, fontWeight: '500' },
    playerBtns:            { flexDirection: 'row' },
    playerBtn:             { borderRadius: BORDER_RADIUS.xl, paddingVertical: SPACING.md, alignItems: 'center', justifyContent: 'center', ...SHADOWS.small },
    playerBtnText:         { fontSize: FONTS.sizes.md, color: '#FFF', fontWeight: '800' },
    // Progress (new)
    progressTrack:         { width: '100%', height: 8, backgroundColor: '#E0E0E0', borderRadius: 4, overflow: 'hidden', marginTop: SPACING.lg },
    progressFill:          { height: '100%', backgroundColor: APP_COLORS.primary, borderRadius: 4 },
    progressPct:           { fontSize: FONTS.sizes.sm, color: APP_COLORS.primaryDark, marginTop: SPACING.sm },
    // Media controls (identical to original)
    mediaControlsContainer:{ marginBottom: SPACING.xl },
    controlsHeader:        { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.lg },
    controlsTitleAccent:   { width: 5, height: 28, borderRadius: 3, marginRight: SPACING.md },
    controlsTitle:         { fontSize: FONTS.sizes.xl, fontWeight: '800', color: '#1E3A5F', letterSpacing: 0.5 },
    mediaGrid:             { gap: SPACING.md },
    mediaControlCard:      { borderRadius: BORDER_RADIUS.xl, padding: SPACING.lg, flexDirection: 'row', alignItems: 'center', ...SHADOWS.medium, borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)' },
    mediaControlCardActive:{ borderWidth: 3, borderColor: 'rgba(255,255,255,0.95)' },
    mediaControlCardDisabled: { opacity: 0.6 },
    mediaIconContainer:    { width: 56, height: 56, borderRadius: BORDER_RADIUS.lg, justifyContent: 'center', alignItems: 'center', marginRight: SPACING.md },
    mediaControlIcon:      { fontSize: 28 },
    mediaControlInfo:      { flex: 1 },
    mediaControlLabel:     { fontSize: FONTS.sizes.md, color: '#1E3A5F', fontWeight: '700', marginBottom: 4 },
    mediaControlLabelActive:{ color: '#FFFFFF' },
    mediaControlSublabel:  { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '500' },
    loadingBadge:          { marginLeft: SPACING.sm },
    activeBadge:           { width: 32, height: 32, backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginLeft: SPACING.sm },
    activeBadgeText:       { color: '#fff', fontSize: 16, fontWeight: '900' },
    // Loading/Error/Empty (identical to original)
    loadingContainer:      { borderRadius: BORDER_RADIUS.xl, padding: SPACING.xl * 1.5, alignItems: 'center', ...SHADOWS.medium, borderWidth: 2, borderColor: APP_COLORS.primaryLight + '50' },
    loadingLottie:         { width: 100, height: 100, marginBottom: SPACING.md },
    loadingText:           { marginTop: SPACING.md, fontSize: FONTS.sizes.md, color: '#1E3A5F', fontWeight: '700', textAlign: 'center' },
    loadingSubtext:        { marginTop: SPACING.xs, fontSize: FONTS.sizes.sm, color: APP_COLORS.primaryDark, fontWeight: '500' },
    errorContainer:        { borderRadius: BORDER_RADIUS.xl, padding: SPACING.xl, alignItems: 'center', ...SHADOWS.medium, borderWidth: 2, borderColor: APP_COLORS.error + '30' },
    errorIcon:             { fontSize: 56, marginBottom: SPACING.md },
    errorText:             { fontSize: FONTS.sizes.sm, color: '#D32F2F', textAlign: 'center', marginBottom: SPACING.lg, fontWeight: '600' },
    retryButton:           { paddingHorizontal: SPACING.xl * 1.5, paddingVertical: SPACING.md, borderRadius: BORDER_RADIUS.xl, ...SHADOWS.small },
    retryText:             { fontSize: FONTS.sizes.sm, color: '#FFFFFF', fontWeight: '800', letterSpacing: 1 },
    emptyStateContainer:   { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 100 },
    emptyStateCard:        { borderRadius: BORDER_RADIUS.xl * 1.5, padding: SPACING.xl * 2, alignItems: 'center', maxWidth: 400, ...SHADOWS.large, borderWidth: 2, borderColor: APP_COLORS.primaryLight + '40' },
    emptyStateLottie:      { width: 160, height: 160, marginBottom: SPACING.xl },
    emptyStateTitle:       { fontSize: FONTS.sizes.xxl, fontWeight: '800', color: '#1E3A5F', marginBottom: SPACING.md, letterSpacing: 0.5 },
    emptyStateText:        { fontSize: FONTS.sizes.md, color: APP_COLORS.primaryDark, textAlign: 'center', lineHeight: 24, marginBottom: SPACING.xl * 1.5, paddingHorizontal: SPACING.lg, fontWeight: '500' },
    retakeButtonGradient:  { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: BORDER_RADIUS.xl, padding: SPACING.lg, ...SHADOWS.large, elevation: 10 },
    retakeIcon:            { fontSize: 28, marginRight: SPACING.sm },
    retakeText:            { fontSize: FONTS.sizes.lg, color: '#FFFFFF', fontWeight: '800', letterSpacing: 1 },
});