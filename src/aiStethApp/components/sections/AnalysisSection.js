// src/aiStethApp/components/sections/AnalysisSection.js  v5
//
// Changes vs v4:
//  1. HeartVisualization replaces the old HeartDetectionBanner — shows
//     animated waveform, confidence ring, feature bars, murmur badge.
//  2. selectHeartWav is properly imported (was referenced but not imported).
//  3. HeartVisualization auto-triggers /detect_heart, so HeartDetectionBanner
//     is no longer needed as a separate component.
//  4. NoisePanel feeds noisyAudio into an AudioCard (was already in v4 but
//     the AudioCard inside NoisePanel now gets onGlobalBusy wired correctly).
//  5. Minor: sectionTitle above heart/lung cards is outside Animated.View so
//     it appears at the right time; sectionTitle for "Heart Analysis" added.
//  6. selectHeartWav import added.

import React, {
    useCallback, useEffect, useRef, useState, memo,
} from 'react';
import {
    ActivityIndicator, Alert, Animated, ScrollView,
    StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import LinearGradient from 'react-native-linear-gradient';

import {
    selectHeart, selectLung,
    selectHeartWav,
    selectIsProcessing, selectNoiseLevel, selectSignalQuality,
    selectProcessingMs, selectSepError,
    selectIsAddingNoise, selectNoisyAudio,
    addNoiseThunk,
    clearSeparationData,
} from '../../../store/slices/SeparationSlice';

import SepPlayer from '../../services/SeparationAudioPlayer';
import { debugLog, debugError } from '../../../config/AppConfig';
import { COLORS, SPACING, FONTS, BORDER_RADIUS, SHADOWS } from '../../constants/theme';
import { APP_COLORS } from '../../../assets/colors';
import HeartVisualization from './HeartVisualization';


// ─────────────────────────────────────────────────────────────────────────────
//  Time formatter  00:00
// ─────────────────────────────────────────────────────────────────────────────
const fmt = (s) => {
    const sec = Math.max(0, Math.round(s));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};


// ─────────────────────────────────────────────────────────────────────────────
//  Waveform decorative bars  (cosmetic only, not real audio data)
// ─────────────────────────────────────────────────────────────────────────────
const BARS = [0.3, 0.6, 0.9, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6, 0.4,
    0.7, 1.0, 0.8, 0.5, 0.3, 0.6, 0.9, 0.7, 1.0, 0.8,
    0.5, 0.4, 0.6, 0.9, 0.7, 0.5, 0.3, 0.6, 0.8, 0.4];

const WaveformBars = memo(({ progress = 0, color = '#0A7EA4' }) => (
    <View style={wfStyles.row}>
        {BARS.map((h, i) => {
            const filled = i / BARS.length < progress;
            return (
                <View key={i} style={[
                    wfStyles.bar,
                    { height: h * 28, backgroundColor: filled ? color : color + '35' },
                ]} />
            );
        })}
    </View>
));

const wfStyles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32 },
    bar: { width: 4, borderRadius: 2 },
});


// ─────────────────────────────────────────────────────────────────────────────
//  AudioCard — one card per channel (heart / lung / noisy preview)
// ─────────────────────────────────────────────────────────────────────────────
const AudioCard = memo(({
    label, emoji, base64, gradientColors, accentColor,
    isGlobalBusy, onGlobalBusy,
}) => {
    const [state, setState] = useState('idle');   // idle|loading|playing|paused|error
    const [duration, setDuration] = useState(0);
    const [elapsed, setElapsed] = useState(0);
    const [errMsg, setErrMsg] = useState('');

    const soundRef = useRef(null);
    const timerRef = useRef(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            _clearTimer();
            SepPlayer.release(soundRef.current);
            soundRef.current = null;
        };
    }, []);

    // Reset when audio source changes (new analysis result)
    useEffect(() => {
        _stop(false);
        setElapsed(0);
        setDuration(0);
        setState('idle');
        setErrMsg('');
    }, [base64]);

    const _clearTimer = () => {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };

    const _startTimer = (snd) => {
        _clearTimer();
        timerRef.current = setInterval(async () => {
            if (!mountedRef.current) return;
            const t = await SepPlayer.getCurrentTime(snd);
            setElapsed(t);
        }, 200);
    };

    const _stop = (notify = true) => {
        _clearTimer();
        SepPlayer.stop(soundRef.current);
        if (mountedRef.current) {
            setState('idle');
            setElapsed(0);
        }
        if (notify && onGlobalBusy) onGlobalBusy(false);
    };

    const handlePlay = useCallback(async () => {
        if (!base64) return;

        // Already playing → pause
        if (state === 'playing') {
            _clearTimer();
            SepPlayer.pause(soundRef.current);
            setState('paused');
            return;
        }

        // Paused → resume
        if (state === 'paused' && soundRef.current) {
            setState('playing');
            _startTimer(soundRef.current);
            SepPlayer.resume(soundRef.current, () => {
                if (mountedRef.current) _stop();
            });
            return;
        }

        // Fresh load
        try {
            setState('loading');
            if (onGlobalBusy) onGlobalBusy(true);

            SepPlayer.release(soundRef.current);
            soundRef.current = null;

            debugLog(`[AudioCard] loading ${label} audio  len=${base64.length}`);
            const { sound, duration: dur } = await SepPlayer.load(base64, label.toLowerCase());

            if (!mountedRef.current) { SepPlayer.release(sound); return; }

            soundRef.current = sound;
            setDuration(dur);
            setState('playing');
            _startTimer(sound);

            SepPlayer.play(sound, () => {
                if (mountedRef.current) _stop();
            });

        } catch (err) {
            debugError(`[AudioCard] ${label} load error:`, err);
            if (mountedRef.current) {
                setState('error');
                setErrMsg(err?.message || 'Playback failed');
                if (onGlobalBusy) onGlobalBusy(false);
            }
        }
    }, [base64, state, label, onGlobalBusy]);

    const handleStop = useCallback(() => _stop(), []);

    const handleSeek = useCallback((frac) => {
        if (!soundRef.current || duration <= 0) return;
        const t = frac * duration;
        SepPlayer.seek(soundRef.current, t);
        setElapsed(t);
    }, [duration]);

    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
    const isPlaying = state === 'playing';
    const isPaused = state === 'paused';
    const isLoading = state === 'loading';
    const isError = state === 'error';

    return (
        <LinearGradient colors={gradientColors} style={styles.audioCard}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>

            {/* Header */}
            <View style={styles.cardHeader}>
                <Text style={styles.cardEmoji}>{emoji}</Text>
                <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{label}</Text>
                    {duration > 0 && (
                        <Text style={styles.cardDuration}>{fmt(elapsed)} / {fmt(duration)}</Text>
                    )}
                </View>
                {(isPlaying || isPaused) && (
                    <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
                        <Text style={styles.stopBtnTxt}>⏹</Text>
                    </TouchableOpacity>
                )}
            </View>

            {/* Waveform */}
            <View style={styles.waveformRow}>
                <WaveformBars progress={progress} color={accentColor} />
            </View>

            {/* Scrub bar (tap to seek) */}
            {duration > 0 && (
                <TouchableOpacity
                    activeOpacity={1}
                    onPress={(e) => handleSeek(e.nativeEvent.locationX / (e.nativeEvent.target ? 300 : 300))}
                    style={styles.scrubTrack}>
                    <View style={[styles.scrubFill, {
                        width: `${progress * 100}%`,
                        backgroundColor: accentColor,
                    }]} />
                </TouchableOpacity>
            )}

            {/* Error */}
            {isError && (
                <Text style={styles.errorTxt}>⚠️ {errMsg}</Text>
            )}

            {/* Play / Pause / Resume button */}
            <TouchableOpacity
                style={[
                    styles.playBtn,
                    { backgroundColor: accentColor },
                    (isLoading || !base64) && styles.playBtnDisabled,
                ]}
                onPress={handlePlay}
                disabled={isLoading || !base64}
                activeOpacity={0.8}>
                {isLoading
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : (
                        <Text style={styles.playBtnTxt}>
                            {isPlaying ? '⏸  Pause' : isPaused ? '▶  Resume' : '▶  Play'}
                        </Text>
                    )
                }
            </TouchableOpacity>

            {!base64 && (
                <Text style={styles.noAudioTxt}>No audio available</Text>
            )}
        </LinearGradient>
    );
});


// ─────────────────────────────────────────────────────────────────────────────
//  NoisePanel — inject noise and preview via AudioCard
// ─────────────────────────────────────────────────────────────────────────────
const NoisePanel = memo(({ heartBase64 }) => {
    const dispatch = useDispatch();
    const isAdding = useSelector(selectIsAddingNoise);
    const noisyAudio = useSelector(selectNoisyAudio);
    const [noiseType, setNoiseType] = useState('white');
    const [snrDb, setSnrDb] = useState(10);
    const [noisyBusy, setNoisyBusy] = useState(false);

    const run = useCallback(() => {
        if (!heartBase64) return;
        dispatch(addNoiseThunk({
            base64Audio: heartBase64,
            sampleRate: 44100,
            noiseType,
            snrDb,
        }));
    }, [heartBase64, noiseType, snrDb, dispatch]);

    if (!heartBase64) return null;

    return (
        <LinearGradient colors={['#F3F8FF', '#E8F2FE']} style={styles.noiseCard}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>

            <Text style={styles.noiseTitleTxt}>🎛  Add External Noise</Text>
            <Text style={styles.noiseSubTxt}>
                Inject noise to test heart-sound robustness
            </Text>

            {/* Noise type chips */}
            <View style={styles.noiseTypeRow}>
                {['white', 'pink', 'brown', 'voice'].map(t => (
                    <TouchableOpacity
                        key={t}
                        style={[styles.noiseChip, noiseType === t && styles.noiseChipActive]}
                        onPress={() => setNoiseType(t)}>
                        <Text style={[
                            styles.noiseChipTxt,
                            noiseType === t && { color: '#FFF' },
                        ]}>
                            {t === 'voice' ? '🗣' : t === 'white' ? '⬜' :
                                t === 'pink' ? '🌸' : '🟤'} {t}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* SNR selector */}
            <Text style={styles.snrLbl}>SNR: {snrDb} dB</Text>
            <View style={styles.snrRow}>
                {[-5, 0, 5, 10, 15, 20].map(v => (
                    <TouchableOpacity
                        key={v}
                        style={[styles.snrBtn, snrDb === v && styles.snrBtnActive]}
                        onPress={() => setSnrDb(v)}>
                        <Text style={[styles.snrBtnTxt, snrDb === v && { color: '#FFF' }]}>
                            {v}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {/* Inject button */}
            <TouchableOpacity
                style={[styles.addNoiseBtn, isAdding && styles.playBtnDisabled]}
                onPress={run}
                disabled={isAdding}
                activeOpacity={0.85}>
                {isAdding
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Text style={styles.addNoiseBtnTxt}>Add Noise & Preview</Text>
                }
            </TouchableOpacity>

            {/* Noisy audio player — same AudioCard as heart/lung */}
            {noisyAudio && !isAdding && (
                <View style={{ marginTop: SPACING.md }}>
                    <AudioCard
                        label="Noisy Preview"
                        emoji="🔊"
                        base64={noisyAudio}
                        gradientColors={['#FFF8E7', '#FFF3CD', '#FFE8A0']}
                        accentColor="#E6A817"
                        isGlobalBusy={noisyBusy}
                        onGlobalBusy={setNoisyBusy}
                    />
                </View>
            )}
        </LinearGradient>
    );
});


// ─────────────────────────────────────────────────────────────────────────────
//  Main: AnalysisSection
// ─────────────────────────────────────────────────────────────────────────────
export const AnalysisSection = memo(({ onRetake }) => {
    const dispatch = useDispatch();
    const heart = useSelector(selectHeart);
    const lung = useSelector(selectLung);
    const heartWav = useSelector(selectHeartWav);
    const isProcessing = useSelector(selectIsProcessing);
    const noiseLevel = useSelector(selectNoiseLevel);
    const signalQuality = useSelector(selectSignalQuality);
    const processingMs = useSelector(selectProcessingMs);
    const sepError = useSelector(selectSepError);

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(24)).current;
    const [anyBusy, setAnyBusy] = useState(false);

    useEffect(() => {
        if (heart || lung) {
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1, duration: 600, useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 0, tension: 35, friction: 8, useNativeDriver: true,
                }),
            ]).start();
        }
    }, [heart, lung, fadeAnim, slideAnim]);

    const handleRetake = useCallback(() => {
        Alert.alert(
            'Retake Recording',
            'Discard current analysis and go back?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Retake', style: 'destructive',
                    onPress: () => {
                        dispatch(clearSeparationData());
                        onRetake?.();
                    },
                },
            ]
        );
    }, [dispatch, onRetake]);


    // ── Processing spinner ────────────────────────────────────────────────────
    if (isProcessing) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={APP_COLORS?.primary ?? '#0A7EA4'} />
                <Text style={styles.processingTxt}>Separating heart &amp; lung sounds…</Text>
                <Text style={styles.processingSubTxt}>Using NMF algorithm (egrooby)</Text>
            </View>
        );
    }

    // ── Error ─────────────────────────────────────────────────────────────────
    if (sepError) {
        return (
            <View style={styles.centered}>
                <Text style={styles.errorBig}>⚠️</Text>
                <Text style={styles.errorTitleTxt}>Separation Failed</Text>
                <Text style={styles.errorBodyTxt}>{sepError}</Text>
                <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
                    <Text style={styles.retakeBtnTxt}>← Try Again</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Empty ─────────────────────────────────────────────────────────────────
    if (!heart && !lung) {
        return (
            <View style={styles.centered}>
                <Text style={styles.emptyIcon}>🩺</Text>
                <Text style={styles.emptyTitle}>No Analysis Yet</Text>
                <Text style={styles.emptyBody}>
                    Upload an audio file from the Recordings tab to separate heart and lung sounds.
                </Text>
                <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
                    <Text style={styles.retakeBtnTxt}>← Go to Recordings</Text>
                </TouchableOpacity>
            </View>
        );
    }


    // ── Results ───────────────────────────────────────────────────────────────
    return (
        <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>

            {/* ── Quality metrics row ─────────────────────────────────────── */}
            <Animated.View style={[styles.metricsRow, {
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
            }]}>
                <View style={styles.metricCard}>
                    <Text style={styles.metricValue}>
                        {signalQuality != null
                            ? `${Math.round(signalQuality * 100)}%` : '—'}
                    </Text>
                    <Text style={styles.metricLabel}>Signal Quality</Text>
                </View>
                <View style={styles.metricCard}>
                    <Text style={[styles.metricValue, { color: '#E57373' }]}>
                        {noiseLevel != null
                            ? `${Math.round(noiseLevel * 100)}%` : '—'}
                    </Text>
                    <Text style={styles.metricLabel}>Noise Level</Text>
                </View>
                <View style={styles.metricCard}>
                    <Text style={[styles.metricValue, { color: '#26A69A' }]}>
                        {processingMs != null
                            ? `${Math.round(processingMs)} ms` : '—'}
                    </Text>
                    <Text style={styles.metricLabel}>Processing</Text>
                </View>
            </Animated.View>

            {/* ── Separated Channels label ─────────────────────────────────── */}
            <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
                <Text style={styles.sectionTitle}>Separated Channels</Text>
            </Animated.View>

            {/* ── Heart audio card ──────────────────────────────────────────── */}
            <Animated.View style={{
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
                marginBottom: SPACING.md,
            }}>
                <AudioCard
                    label="Heart Sound"
                    emoji="❤️"
                    base64={heart}
                    gradientColors={['#FFF0F3', '#FFE4EA', '#FFCDD8']}
                    accentColor="#E53935"
                    isGlobalBusy={anyBusy}
                    onGlobalBusy={setAnyBusy}
                />
            </Animated.View>

            {/* ── Lung audio card ───────────────────────────────────────────── */}
            <Animated.View style={{
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
                marginBottom: SPACING.lg,
            }}>
                <AudioCard
                    label="Lung Sound"
                    emoji="🫁"
                    base64={lung}
                    gradientColors={['#F0F8FF', '#E3F2FD', '#BBDEFB']}
                    accentColor="#1565C0"
                    isGlobalBusy={anyBusy}
                    onGlobalBusy={setAnyBusy}
                />
            </Animated.View>

            {/* ── Heart Analysis (HeartVisualization) ───────────────────────── */}
            {/*
              HeartVisualization reads all detection state from Redux directly.
              It auto-triggers /detect_heart when heartWav arrives.
              Renders:
                - Animated beating heart + BPM
                - Confidence ring (SVG arc)
                - Real PCM waveform drawn from heartWav audio
                - 4 feature score bars (Spectral / Low-HF / Transient / Duty)
                - Diagnostic chips (centroid Hz, HF ratio, burst count, active %)
                - Murmur badge (systolic / diastolic / continuous / benign) with
                  clinical notes, or "No murmur detected" green badge
                - Re-run button
            */}
            {(heart || heartWav) && (
                <Animated.View style={{
                    opacity: fadeAnim,
                    transform: [{ translateY: slideAnim }],
                    marginBottom: SPACING.lg,
                }}>
                    <Text style={styles.sectionTitle}>Heart Analysis</Text>
                    <HeartVisualization
                        heartBase64={heartWav ?? heart}
                        sampleRate={44100}
                    />
                </Animated.View>
            )}

            {/* ── Noise injection panel ─────────────────────────────────────── */}
            {heart && (
                <Animated.View style={{
                    opacity: fadeAnim,
                    transform: [{ translateY: slideAnim }],
                    marginBottom: SPACING.lg,
                }}>
                    <Text style={styles.sectionTitle}>Noise Testing</Text>
                    <NoisePanel heartBase64={heart} />
                </Animated.View>
            )}

            {/* ── Retake button ─────────────────────────────────────────────── */}
            <Animated.View style={{
                opacity: fadeAnim,
                transform: [{ translateY: slideAnim }],
                marginBottom: SPACING.xl,
            }}>
                <TouchableOpacity
                    style={styles.retakeBtn}
                    onPress={handleRetake}
                    activeOpacity={0.85}>
                    <Text style={styles.retakeBtnTxt}>⟵  Retake / New Recording</Text>
                </TouchableOpacity>
            </Animated.View>

            <View style={{ height: 40 }} />
        </ScrollView>
    );
});


// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: COLORS?.background ?? '#F8FAFC' },
    scrollContent: { padding: SPACING?.lg ?? 16, paddingBottom: 60 },

    // ── Centered states ───────────────────────────────────────────────────────
    centered: {
        flex: 1, alignItems: 'center', justifyContent: 'center',
        padding: SPACING?.xl ?? 24,
    },
    processingTxt: {
        marginTop: SPACING?.md ?? 12,
        fontSize: FONTS?.sizes?.lg ?? 16,
        fontWeight: '700', color: '#1E3A5F',
    },
    processingSubTxt: {
        fontSize: FONTS?.sizes?.sm ?? 13, color: '#64748B', marginTop: 4,
    },
    errorBig: { fontSize: 56, marginBottom: SPACING?.md ?? 12 },
    errorTitleTxt: {
        fontSize: FONTS?.sizes?.xl ?? 20, fontWeight: '800',
        color: '#C62828', marginBottom: SPACING?.sm ?? 8,
    },
    errorBodyTxt: {
        fontSize: FONTS?.sizes?.sm ?? 13, color: '#555',
        textAlign: 'center', marginBottom: SPACING?.xl ?? 24,
    },
    emptyIcon: { fontSize: 64, marginBottom: SPACING?.md ?? 12 },
    emptyTitle: {
        fontSize: FONTS?.sizes?.xl ?? 20, fontWeight: '800',
        color: '#1E3A5F', marginBottom: SPACING?.sm ?? 8,
    },
    emptyBody: {
        fontSize: FONTS?.sizes?.sm ?? 13, color: '#64748B',
        textAlign: 'center', lineHeight: 20,
        marginBottom: SPACING?.xl ?? 24,
    },

    // ── Metrics ───────────────────────────────────────────────────────────────
    metricsRow: {
        flexDirection: 'row', gap: SPACING?.sm ?? 8,
        marginBottom: SPACING?.lg ?? 16,
    },
    metricCard: {
        flex: 1, backgroundColor: '#FFF', borderRadius: 12,
        padding: SPACING?.md ?? 12, alignItems: 'center',
        borderWidth: 1, borderColor: '#E2E8F0',
        ...(SHADOWS?.small ?? {}),
    },
    metricValue: {
        fontSize: FONTS?.sizes?.lg ?? 16, fontWeight: '800', color: '#1E3A5F',
    },
    metricLabel: {
        fontSize: FONTS?.sizes?.xs ?? 11, color: '#64748B',
        fontWeight: '600', marginTop: 2,
    },

    // ── Section title ─────────────────────────────────────────────────────────
    sectionTitle: {
        fontSize: FONTS?.sizes?.xs ?? 11, fontWeight: '800',
        color: '#94A3B8', letterSpacing: 0.8,
        textTransform: 'uppercase', marginBottom: SPACING?.sm ?? 8,
    },

    // ── Audio card ────────────────────────────────────────────────────────────
    audioCard: {
        borderRadius: 16, padding: SPACING?.lg ?? 16,
        borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)',
        ...(SHADOWS?.medium ?? {}),
    },
    cardHeader: {
        flexDirection: 'row', alignItems: 'flex-start',
        marginBottom: SPACING?.sm ?? 8,
    },
    cardEmoji: { fontSize: 28, marginRight: SPACING?.sm ?? 8 },
    cardLabel: { fontSize: FONTS?.sizes?.md ?? 15, fontWeight: '800', color: '#1E3A5F' },
    cardDuration: {
        fontSize: FONTS?.sizes?.xs ?? 11, color: '#64748B',
        fontWeight: '600', marginTop: 2,
    },
    stopBtn: { padding: 6 },
    stopBtnTxt: { fontSize: 20 },

    waveformRow: { marginBottom: SPACING?.sm ?? 8 },
    scrubTrack: {
        height: 4, backgroundColor: 'rgba(0,0,0,0.10)',
        borderRadius: 2, marginBottom: SPACING?.md ?? 12, overflow: 'hidden',
    },
    scrubFill: { height: 4, borderRadius: 2 },

    playBtn: {
        borderRadius: 10, paddingVertical: 12,
        alignItems: 'center', marginTop: SPACING?.xs ?? 4,
    },
    playBtnDisabled: { opacity: 0.5 },
    playBtnTxt: {
        color: '#FFF', fontSize: FONTS?.sizes?.sm ?? 13, fontWeight: '800',
    },
    noAudioTxt: {
        textAlign: 'center', color: '#94A3B8',
        fontSize: FONTS?.sizes?.xs ?? 11, marginTop: SPACING?.xs ?? 4,
    },
    errorTxt: {
        color: '#C62828', fontSize: FONTS?.sizes?.xs ?? 11, marginTop: 4,
    },

    // ── Noise panel ───────────────────────────────────────────────────────────
    noiseCard: { borderRadius: 16, padding: SPACING?.lg ?? 16 },
    noiseTitleTxt: {
        fontSize: FONTS?.sizes?.md ?? 15, fontWeight: '800',
        color: '#1A3A5C', marginBottom: 2,
    },
    noiseSubTxt: {
        fontSize: FONTS?.sizes?.xs ?? 11, color: '#4A6A8C',
        marginBottom: SPACING?.md ?? 12,
    },
    noiseTypeRow: {
        flexDirection: 'row', flexWrap: 'wrap', gap: 8,
        marginBottom: SPACING?.md ?? 12,
    },
    noiseChip: {
        paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20,
        backgroundColor: '#E8F2FE', borderWidth: 1, borderColor: '#C0D8F8',
    },
    noiseChipActive: { backgroundColor: '#0A7EA4', borderColor: '#0A7EA4' },
    noiseChipTxt: {
        fontSize: FONTS?.sizes?.xs ?? 11, color: '#1A3A5C', fontWeight: '600',
    },
    snrLbl: {
        fontSize: FONTS?.sizes?.xs ?? 11, color: '#4A6A8C', marginBottom: 6,
    },
    snrRow: { flexDirection: 'row', gap: 6, marginBottom: SPACING?.md ?? 12 },
    snrBtn: {
        flex: 1, paddingVertical: 7, alignItems: 'center',
        borderRadius: 8, backgroundColor: '#E8F2FE',
        borderWidth: 1, borderColor: '#C0D8F8',
    },
    snrBtnActive: { backgroundColor: '#0A7EA4', borderColor: '#0A7EA4' },
    snrBtnTxt: { fontSize: 12, color: '#1A3A5C', fontWeight: '600' },
    addNoiseBtn: {
        backgroundColor: '#0A7EA4', borderRadius: 10,
        paddingVertical: 12, alignItems: 'center',
    },
    addNoiseBtnTxt: {
        color: '#FFF', fontSize: FONTS?.sizes?.sm ?? 13, fontWeight: '700',
    },

    // ── Retake ────────────────────────────────────────────────────────────────
    retakeBtn: {
        backgroundColor: '#64748B', borderRadius: 10,
        paddingVertical: 12, paddingHorizontal: 24, alignSelf: 'center',
    },
    retakeBtnTxt: {
        color: '#FFF', fontSize: FONTS?.sizes?.sm ?? 13, fontWeight: '700',
    },
});

export default AnalysisSection;