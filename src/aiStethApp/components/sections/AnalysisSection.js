// src/aiStethApp/components/sections/AnalysisSection.js v5.1

import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    memo,
} from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import LinearGradient from 'react-native-linear-gradient';

import {
    selectHeart,
    selectLung,
    selectIsProcessing,
    selectNoiseLevel,
    selectSignalQuality,
    selectProcessingMs,
    selectSepError,
    selectIsDetectingHeart,
    selectHeartDetected,
    selectHeartConfidence,
    selectHeartBpm,
    selectIsAddingNoise,
    selectNoisyAudio,
    selectInputLengthMs,
    selectCardiacCycles,
    selectExtraSounds,
    selectMurmurs,
    selectNoiseSegments,
    detectHeartThunk,
    addNoiseThunk,
    clearSeparationData,
} from '../../../store/slices/SeparationSlice';

import SepPlayer from '../../services/SeparationAudioPlayer';
import { COLORS, SPACING, FONTS, SHADOWS } from '../../constants/theme';
import { APP_COLORS } from '../../../assets/colors';
import ClinicalTimelineVisualization from '../ClinicalTimelineVisualization';

const fmt = s => {
    const sec = Math.max(0, Math.round(s));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};

const BARS = [
    0.3, 0.6, 0.9, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6, 0.4,
    0.7, 1.0, 0.8, 0.5, 0.3, 0.6, 0.9, 0.7, 1.0, 0.8,
    0.5, 0.4, 0.6, 0.9, 0.7, 0.5, 0.3, 0.6, 0.8, 0.4,
];

const WaveformBars = memo(({ progress = 0, color = '#0A7EA4' }) => (
    <View style={wfStyles.row}>
        {BARS.map((h, i) => {
            const filled = i / BARS.length < progress;
            return (
                <View
                    key={i}
                    style={[
                        wfStyles.bar,
                        { height: h * 28, backgroundColor: filled ? color : `${color}35` },
                    ]}
                />
            );
        })}
    </View>
));

const wfStyles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32 },
    bar: { width: 4, borderRadius: 2 },
});

const AudioCard = memo(({ label, emoji, base64, gradientColors, accentColor, onGlobalBusy, onTimeUpdate }) => {
    const [state, setState] = useState('idle');
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

    useEffect(() => {
        _stop(false);
        setElapsed(0);
        setDuration(0);
        setState('idle');
        onTimeUpdate?.(0);
    }, [base64, onTimeUpdate]);

    const _clearTimer = () => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };

    const _startTimer = snd => {
        _clearTimer();
        timerRef.current = setInterval(async () => {
            if (!mountedRef.current) return;
            const t = await SepPlayer.getCurrentTime(snd);
            setElapsed(t);
            onTimeUpdate?.(Math.round(t * 1000));
        }, 200);
    };

    const _stop = (notify = true) => {
        _clearTimer();
        SepPlayer.stop(soundRef.current);
        if (mountedRef.current) {
            setState('idle');
            setElapsed(0);
            onTimeUpdate?.(0);
        }
        if (notify && onGlobalBusy) onGlobalBusy(false);
    };

    const handlePlay = useCallback(async () => {
        if (!base64) return;

        if (state === 'playing') {
            _clearTimer();
            SepPlayer.pause(soundRef.current);
            setState('paused');
            return;
        }

        if (state === 'paused' && soundRef.current) {
            setState('playing');
            _startTimer(soundRef.current);
            SepPlayer.resume(soundRef.current, () => {
                if (mountedRef.current) _stop();
            });
            return;
        }

        try {
            setState('loading');
            if (onGlobalBusy) onGlobalBusy(true);

            SepPlayer.release(soundRef.current);
            soundRef.current = null;

            const { sound, duration: dur } = await SepPlayer.load(base64, label.toLowerCase());

            if (!mountedRef.current) {
                SepPlayer.release(sound);
                return;
            }

            soundRef.current = sound;
            setDuration(dur);
            setState('playing');
            _startTimer(sound);

            SepPlayer.play(sound, () => {
                if (mountedRef.current) _stop();
            });
        } catch (err) {
            if (mountedRef.current) {
                setState('error');
                setErrMsg(err?.message || 'Playback failed');
                if (onGlobalBusy) onGlobalBusy(false);
            }
        }
    }, [base64, state, label, onGlobalBusy, onTimeUpdate]);

    const handleStop = useCallback(() => _stop(), []);
    const progress = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
    const isPlaying = state === 'playing';
    const isPaused = state === 'paused';
    const isLoading = state === 'loading';
    const isError = state === 'error';

    return (
        <LinearGradient colors={gradientColors} style={styles.audioCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <View style={styles.cardHeader}>
                <Text style={styles.cardEmoji}>{emoji}</Text>
                <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>{label}</Text>
                    {duration > 0 && <Text style={styles.cardDuration}>{fmt(elapsed)} / {fmt(duration)}</Text>}
                </View>
                {(isPlaying || isPaused) && (
                    <TouchableOpacity style={styles.stopBtn} onPress={handleStop}>
                        <Text style={styles.stopBtnTxt}>⏹</Text>
                    </TouchableOpacity>
                )}
            </View>

            <View style={styles.waveformRow}>
                <WaveformBars progress={progress} color={accentColor} />
            </View>

            {duration > 0 && (
                <View style={styles.scrubTrack}>
                    <View style={[styles.scrubFill, { width: `${progress * 100}%`, backgroundColor: accentColor }]} />
                </View>
            )}

            {isError && <Text style={styles.errorTxt}>⚠️ {errMsg}</Text>}

            <TouchableOpacity
                style={[styles.playBtn, { backgroundColor: accentColor }, (isLoading || !base64) && styles.playBtnDisabled]}
                onPress={handlePlay}
                disabled={isLoading || !base64}
                activeOpacity={0.8}
            >
                {isLoading ? (
                    <ActivityIndicator size="small" color="#FFF" />
                ) : (
                    <Text style={styles.playBtnTxt}>
                        {isPlaying ? '⏸  Pause' : isPaused ? '▶  Resume' : '▶  Play'}
                    </Text>
                )}
            </TouchableOpacity>

            {!base64 && <Text style={styles.noAudioTxt}>No audio available</Text>}
        </LinearGradient>
    );
});

const HeartDetectionBanner = memo(({ heartBase64 }) => {
    const dispatch = useDispatch();
    const isDetecting = useSelector(selectIsDetectingHeart);
    const heartDetected = useSelector(selectHeartDetected);
    const heartConfidence = useSelector(selectHeartConfidence);
    const heartBpm = useSelector(selectHeartBpm);

    const run = useCallback(() => {
        if (!heartBase64) return;
        dispatch(detectHeartThunk({ base64Audio: heartBase64, sampleRate: 4000 }));
    }, [heartBase64, dispatch]);

    if (!heartBase64) return null;

    return (
        <View style={styles.detectionWrap}>
            {heartDetected === null && !isDetecting && (
                <TouchableOpacity style={styles.detectBtn} onPress={run} activeOpacity={0.85}>
                    <LinearGradient
                        colors={['#0A7EA4', '#1A9BBF']}
                        style={styles.detectBtnGrad}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <Text style={styles.detectBtnTxt}>🔬  Detect Heart Sound</Text>
                    </LinearGradient>
                </TouchableOpacity>
            )}

            {isDetecting && (
                <View style={styles.detectingRow}>
                    <ActivityIndicator size="small" color="#0A7EA4" />
                    <Text style={styles.detectingTxt}>  Analysing heart band…</Text>
                </View>
            )}

            {heartDetected !== null && !isDetecting && (
                <LinearGradient
                    colors={heartDetected ? ['#D4F4E7', '#E0F9EF'] : ['#FFEBEE', '#FFCDD2']}
                    style={styles.detectResultCard}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                >
                    <View style={styles.detectResultRow}>
                        <Text style={styles.detectResultEmoji}>{heartDetected ? '❤️' : '⚠️'}</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.detectResultTitle, { color: heartDetected ? '#1B7A4A' : '#C62828' }]}>
                                {heartDetected ? 'Heart Sound Detected' : 'No Heart Sound'}
                            </Text>
                            <Text style={styles.detectResultSub}>
                                Confidence: {Math.round((heartConfidence || 0) * 100)}%
                                {heartBpm ? `  ·  ~${Math.round(heartBpm)} BPM` : ''}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={run} style={{ padding: 6 }}>
                            <Text style={{ fontSize: 20, color: '#666' }}>↺</Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.meterTrack}>
                        <View
                            style={[
                                styles.meterFill,
                                {
                                    width: `${Math.round((heartConfidence || 0) * 100)}%`,
                                    backgroundColor: heartDetected ? '#1B7A4A' : '#C62828',
                                },
                            ]}
                        />
                    </View>
                </LinearGradient>
            )}
        </View>
    );
});

const NoisePanel = memo(({ heartBase64 }) => {
    const dispatch = useDispatch();
    const isAdding = useSelector(selectIsAddingNoise);
    const noisyAudio = useSelector(selectNoisyAudio);
    const [noiseType, setNoiseType] = useState('white');
    const [snrDb, setSnrDb] = useState(10);

    const run = useCallback(() => {
        if (!heartBase64) return;
        dispatch(addNoiseThunk({ base64Audio: heartBase64, sampleRate: 4000, noiseType, snrDb }));
    }, [heartBase64, noiseType, snrDb, dispatch]);

    if (!heartBase64) return null;

    return (
        <LinearGradient colors={['#F3F8FF', '#E8F2FE']} style={styles.noiseCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <Text style={styles.noiseTitleTxt}>🎛  Add External Noise</Text>
            <View style={styles.noiseTypeRow}>
                {['white', 'pink', 'brown', 'voice'].map(t => (
                    <TouchableOpacity
                        key={t}
                        style={[styles.noiseChip, noiseType === t && styles.noiseChipActive]}
                        onPress={() => setNoiseType(t)}
                    >
                        <Text style={[styles.noiseChipTxt, noiseType === t && { color: '#FFF' }]}>
                            {t === 'voice' ? '🗣' : t === 'white' ? '⬜' : t === 'pink' ? '🌸' : '🟤'} {t}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <Text style={styles.snrLbl}>SNR: {snrDb} dB</Text>
            <View style={styles.snrRow}>
                {[-5, 0, 5, 10, 15, 20].map(v => (
                    <TouchableOpacity
                        key={v}
                        style={[styles.snrBtn, snrDb === v && styles.snrBtnActive]}
                        onPress={() => setSnrDb(v)}
                    >
                        <Text style={[styles.snrBtnTxt, snrDb === v && { color: '#FFF' }]}>{v}</Text>
                    </TouchableOpacity>
                ))}
            </View>

            <TouchableOpacity
                style={[styles.addNoiseBtn, isAdding && styles.playBtnDisabled]}
                onPress={run}
                disabled={isAdding}
                activeOpacity={0.85}
            >
                {isAdding ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.addNoiseBtnTxt}>Add Noise & Preview</Text>}
            </TouchableOpacity>

            {noisyAudio && !isAdding && (
                <AudioCard
                    label="Noisy Preview"
                    emoji="🔊"
                    base64={noisyAudio}
                    gradientColors={['#FFF8E7', '#FFF3CD']}
                    accentColor="#E6A817"
                    onGlobalBusy={() => { }}
                    onTimeUpdate={() => { }}
                />
            )}
        </LinearGradient>
    );
});

const buildTimeline = (cardiacCycles = [], extraSounds = [], murmurs = [], noiseSegments = []) => {
    const items = [];

    cardiacCycles.forEach((cycle, idx) => {
        if (cycle?.systole) {
            items.push({
                id: `cycle-sys-${idx}`,
                type: 'systole',
                start_ms: cycle.systole.start_ms,
                end_ms: cycle.systole.end_ms,
                label: 'Systole',
            });
        }

        if (cycle?.diastole) {
            items.push({
                id: `cycle-dia-${idx}`,
                type: 'diastole',
                start_ms: cycle.diastole.start_ms,
                end_ms: cycle.diastole.end_ms,
                label: 'Diastole',
            });
        }
    });

    extraSounds.forEach((e, idx) => {
        items.push({
            id: `extra-${idx}`,
            type: e?.type || 'extra',
            start_ms: e.start_ms,
            end_ms: e.end_ms || e.start_ms + 40,
            label: e?.type || 'Extra sound',
        });
    });

    murmurs.forEach((m, idx) => {
        items.push({
            id: `murmur-${idx}`,
            type: 'murmur',
            subtype: m?.type,
            start_ms: m.start_ms,
            end_ms: m.end_ms,
            label: m?.type || 'Murmur',
        });
    });

    noiseSegments.forEach((n, idx) => {
        items.push({
            id: `noise-${idx}`,
            type: 'noise',
            start_ms: n.start_ms,
            end_ms: n.end_ms,
            label: 'Noise',
        });
    });

    return items
        .filter(v => typeof v.start_ms === 'number' && typeof v.end_ms === 'number')
        .sort((a, b) => a.start_ms - b.start_ms);
};

const AnalysisSection = memo(({ onRetake }) => {
    const dispatch = useDispatch();
    const heart = useSelector(selectHeart);
    const lung = useSelector(selectLung);
    const isProcessing = useSelector(selectIsProcessing);
    const noiseLevel = useSelector(selectNoiseLevel);
    const signalQuality = useSelector(selectSignalQuality);
    const processingMs = useSelector(selectProcessingMs);
    const sepError = useSelector(selectSepError);
    const inputLengthMs = useSelector(selectInputLengthMs);
    const cardiacCycles = useSelector(selectCardiacCycles);
    const extraSounds = useSelector(selectExtraSounds);
    const murmurs = useSelector(selectMurmurs);
    const noiseSegments = useSelector(selectNoiseSegments);
    const heartBpm = useSelector(selectHeartBpm);

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const [anyBusy, setAnyBusy] = useState(false);
    const [playheadMs, setPlayheadMs] = useState(0);
    const [selectedSeg, setSelectedSeg] = useState(null);

    const timeline = useMemo(
        () => buildTimeline(cardiacCycles, extraSounds, murmurs, noiseSegments),
        [cardiacCycles, extraSounds, murmurs, noiseSegments],
    );

    useEffect(() => {
        if (heart || lung) {
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 600,
                useNativeDriver: true,
            }).start();
        }
    }, [heart, lung, fadeAnim]);

    const handleRetake = useCallback(() => {
        Alert.alert(
            'Retake Recording',
            'Discard current analysis and go back?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Retake',
                    style: 'destructive',
                    onPress: () => {
                        dispatch(clearSeparationData());
                        onRetake?.();
                    },
                },
            ],
        );
    }, [dispatch, onRetake]);

    if (isProcessing) {
        return (
            <View style={styles.centered}>
                <ActivityIndicator size="large" color={APP_COLORS.primary} />
                <Text style={styles.processingTxt}>Separating heart & lung sounds…</Text>
                <Text style={styles.processingSubTxt}>Using NMF algorithm (egrooby)</Text>
            </View>
        );
    }

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

    return (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
            <Animated.View style={[styles.metricsRow, { opacity: fadeAnim }]}>
                <View style={styles.metricCard}>
                    <Text style={styles.metricValue}>
                        {signalQuality != null ? `${Math.round(signalQuality * 100)}%` : '—'}
                    </Text>
                    <Text style={styles.metricLabel}>Signal Quality</Text>
                </View>
                <View style={styles.metricCard}>
                    <Text style={[styles.metricValue, { color: '#E57373' }]}>
                        {noiseLevel != null ? `${Math.round(noiseLevel * 100)}%` : '—'}
                    </Text>
                    <Text style={styles.metricLabel}>Noise Level</Text>
                </View>
                <View style={styles.metricCard}>
                    <Text style={[styles.metricValue, { color: '#26A69A' }]}>
                        {processingMs != null ? `${Math.round(processingMs)}ms` : '—'}
                    </Text>
                    <Text style={styles.metricLabel}>Processing</Text>
                </View>
            </Animated.View>

            <Animated.View style={{ opacity: fadeAnim }}>
                <Text style={styles.sectionTitle}>Separated Channels</Text>
                <AudioCard
                    label="Heart Sound"
                    emoji="❤️"
                    base64={heart}
                    gradientColors={['#FFF0F3', '#FFE4EA', '#FFCDD8']}
                    accentColor="#E53935"
                    onGlobalBusy={setAnyBusy}
                    onTimeUpdate={setPlayheadMs}
                />
            </Animated.View>

            <Animated.View style={{ opacity: fadeAnim, marginTop: SPACING.md }}>
                <AudioCard
                    label="Lung Sound"
                    emoji="🫁"
                    base64={lung}
                    gradientColors={['#F0F8FF', '#E3F2FD', '#BBDEFB']}
                    accentColor="#1565C0"
                    onGlobalBusy={setAnyBusy}
                    onTimeUpdate={setPlayheadMs}
                />
            </Animated.View>

            <ClinicalTimelineVisualization
                durationMs={inputLengthMs || 1}
                timeline={timeline}
                heartBpm={heartBpm}
                activeMs={playheadMs}
                onSegmentPress={setSelectedSeg}
            />

            <Animated.View style={{ opacity: fadeAnim, marginTop: SPACING.lg }}>
                <HeartDetectionBanner heartBase64={heart} />
            </Animated.View>

            <Animated.View style={{ opacity: fadeAnim, marginTop: SPACING.lg }}>
                <NoisePanel heartBase64={heart} />
            </Animated.View>

            <Animated.View style={{ opacity: fadeAnim, marginTop: SPACING.xl }}>
                <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake} activeOpacity={0.85}>
                    <Text style={styles.retakeBtnTxt}>⟵  Retake / New Recording</Text>
                </TouchableOpacity>
            </Animated.View>

            <View style={{ height: 40 }} />
        </ScrollView>
    );
});

const styles = StyleSheet.create({
    scroll: { flex: 1, backgroundColor: COLORS.background },
    scrollContent: { padding: SPACING.lg, paddingBottom: 60 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
    processingTxt: { marginTop: SPACING.md, fontSize: FONTS.sizes.lg, fontWeight: '700', color: '#1E3A5F' },
    processingSubTxt: { fontSize: FONTS.sizes.sm, color: '#64748B', marginTop: 4 },

    errorBig: { fontSize: 56, marginBottom: SPACING.md },
    errorTitleTxt: { fontSize: FONTS.sizes.xl, fontWeight: '800', color: '#C62828', marginBottom: SPACING.sm },
    errorBodyTxt: { fontSize: FONTS.sizes.sm, color: '#555', textAlign: 'center', marginBottom: SPACING.xl },

    emptyIcon: { fontSize: 64, marginBottom: SPACING.md },
    emptyTitle: { fontSize: FONTS.sizes.xl, fontWeight: '800', color: '#1E3A5F', marginBottom: SPACING.sm },
    emptyBody: { fontSize: FONTS.sizes.sm, color: '#64748B', textAlign: 'center', lineHeight: 20, marginBottom: SPACING.xl },

    retakeBtn: { backgroundColor: '#64748B', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, alignSelf: 'center' },
    retakeBtnTxt: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '700' },

    metricsRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.lg },
    metricCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 12, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', ...SHADOWS?.small },
    metricValue: { fontSize: FONTS.sizes.lg, fontWeight: '800', color: '#1E3A5F' },
    metricLabel: { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '600', marginTop: 2 },

    sectionTitle: { fontSize: FONTS.sizes.md, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: SPACING.sm },

    audioCard: { borderRadius: 16, padding: SPACING.lg, marginBottom: 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)', ...SHADOWS?.medium },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.sm },
    cardEmoji: { fontSize: 28, marginRight: SPACING.sm },
    cardLabel: { fontSize: FONTS.sizes.md, fontWeight: '800', color: '#1E3A5F' },
    cardDuration: { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '600', marginTop: 2 },
    stopBtn: { padding: 6 },
    stopBtnTxt: { fontSize: 20 },

    waveformRow: { marginBottom: SPACING.sm },
    scrubTrack: { height: 4, backgroundColor: 'rgba(0,0,0,0.10)', borderRadius: 2, marginBottom: SPACING.md, overflow: 'hidden' },
    scrubFill: { height: 4, borderRadius: 2 },
    playBtn: { borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: SPACING.xs },
    playBtnDisabled: { opacity: 0.5 },
    playBtnTxt: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '800' },
    noAudioTxt: { textAlign: 'center', color: '#94A3B8', fontSize: FONTS.sizes.xs, marginTop: SPACING.xs },
    errorTxt: { color: '#C62828', fontSize: FONTS.sizes.xs, marginTop: 4 },

    detectionWrap: { marginBottom: SPACING.md },
    detectBtn: { borderRadius: 12, overflow: 'hidden' },
    detectBtnGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12 },
    detectBtnTxt: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '700' },
    detectingRow: { flexDirection: 'row', alignItems: 'center' },
    detectingTxt: { fontSize: FONTS.sizes.sm, color: '#0A7EA4' },
    detectResultCard: { borderRadius: 14, padding: SPACING.md },
    detectResultRow: { flexDirection: 'row', alignItems: 'center', marginBottom: SPACING.sm },
    detectResultEmoji: { fontSize: 28, marginRight: SPACING.sm },
    detectResultTitle: { fontSize: FONTS.sizes.md, fontWeight: '800' },
    detectResultSub: { fontSize: FONTS.sizes.xs, color: '#666' },
    meterTrack: { height: 6, backgroundColor: 'rgba(0,0,0,0.12)', borderRadius: 3, overflow: 'hidden' },
    meterFill: { height: 6, borderRadius: 3 },

    noiseCard: { borderRadius: 16, padding: SPACING.lg },
    noiseTitleTxt: { fontSize: FONTS.sizes.md, fontWeight: '800', color: '#1A3A5C', marginBottom: SPACING.md },
    noiseTypeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: SPACING.md },
    noiseChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 20, backgroundColor: '#E8F2FE', borderWidth: 1, borderColor: '#C0D8F8' },
    noiseChipActive: { backgroundColor: '#0A7EA4', borderColor: '#0A7EA4' },
    noiseChipTxt: { fontSize: FONTS.sizes.xs, color: '#1A3A5C', fontWeight: '600' },
    snrLbl: { fontSize: FONTS.sizes.xs, color: '#4A6A8C', marginBottom: 6 },
    snrRow: { flexDirection: 'row', gap: 6, marginBottom: SPACING.md },
    snrBtn: { flex: 1, paddingVertical: 7, alignItems: 'center', borderRadius: 8, backgroundColor: '#E8F2FE', borderWidth: 1, borderColor: '#C0D8F8' },
    snrBtnActive: { backgroundColor: '#0A7EA4', borderColor: '#0A7EA4' },
    snrBtnTxt: { fontSize: 12, color: '#1A3A5C', fontWeight: '600' },
    addNoiseBtn: { backgroundColor: '#0A7EA4', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: SPACING.md },
    addNoiseBtnTxt: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '700' },

    timelineCard: { backgroundColor: '#FFF', borderRadius: 16, padding: SPACING.lg, borderWidth: 1, borderColor: '#E2E8F0', ...SHADOWS?.medium },
    timelineCanvas: { position: 'relative', marginTop: 8, overflow: 'hidden' },
    timelineAxis: { position: 'absolute', left: 0, height: 1, backgroundColor: '#CBD5E1' },
    timelineBlock: { position: 'absolute', height: 22, borderRadius: 8, opacity: 0.95 },
    timelineOverlay: { position: 'absolute', height: 18, borderRadius: 8, opacity: 0.55 },
    extraDot: { position: 'absolute', width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: '#FFF' },
    timelineLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
    legendItem: { fontSize: 11, color: '#475569', fontWeight: '700' },
});

export default AnalysisSection;