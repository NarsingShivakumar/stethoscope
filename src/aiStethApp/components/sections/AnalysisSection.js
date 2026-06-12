// src/aiStethApp/components/sections/AnalysisSection.js  v6.0
//
// CHANGES FROM v5.2:
//   ADDED (lung_service v2 new fields):
//     selectLungAnalysis selector — maps to new lung_analysis response shape:
//       lung_classification, wheeze_confidence, rhonchi_confidence,
//       fine_crackle_confidence, coarse_crackle_confidence,
//       stridor_confidence, breath_rate_bpm, respiratory_phases,
//       signal_quality, cardiac_contamination
//   ADDED LungAnalysisPanel — full clinical lung section
//     • Cardiac contamination badge
//     • Breath rate with live BPM ring
//     • Per-sound-type confidence bars (wheeze / rhonchi / fine crackle /
//       coarse crackle / stridor) with clinical colour coding
//     • Respiratory phase timeline
//   ADDED SignalGauge — arc-style meter replacing plain metric cards
//   ADDED tabbed navigation: CARDIAC / LUNG / AUDIO / TOOLS
//   KEPT all v5.2 sub-components (AudioCard, HeartDetectionBanner,
//     NoisePanel, MurmurPanel, ExtraSoundsPanel, SegmentDetailsPanel,
//     ClinicalTimelineVisualization, buildTimeline)
//   KEPT onRetake prop + clearSeparationData dispatch
//   KEPT all existing selectors from SeparationSlice

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
    selectOriginalAudio,
} from '../../../store/slices/SeparationSlice';

import SepPlayer from '../../services/SeparationAudioPlayer';
import { COLORS, SPACING, FONTS, SHADOWS } from '../../constants/theme';
import { APP_COLORS } from '../../../assets/colors';
import ClinicalTimelineVisualization from '../ClinicalTimelineVisualization';

// ─── NEW: lung_analysis selector ────────────────────────────────────────────
// Reads the lung_analysis object from the separation result.
// Shape (from lung_service v2):
//   lung_classification, wheeze_confidence, rhonchi_confidence,
//   fine_crackle_confidence, coarse_crackle_confidence,
//   stridor_confidence, breath_rate_bpm, respiratory_phases,
//   signal_quality, cardiac_contamination
const selectLungAnalysis = state =>
    state.separation?.lungAnalysis || state.separation?.lung_analysis || null;

// ─── Design tokens ───────────────────────────────────────────────────────────
const C = {
    bg: '#F0F4F8',
    surface: '#FFFFFF',
    border: '#E2E8F0',
    textHi: '#0F2744',
    textMid: '#475569',
    textLo: '#94A3B8',
    heartRed: '#DC2626',
    heartRedBg: '#FFF0F0',
    lungBlue: '#1D4ED8',
    lungBlueBg: '#EFF6FF',
    heartAccent: '#E53935',
    lungAccent: '#1565C0',
    teal: '#0891B2',
    green: '#059669',
    amber: '#D97706',
    rose: '#E11D48',
    violet: '#7C3AED',
    slate: '#475569',
};

// ─── Formatters ──────────────────────────────────────────────────────────────
const fmt = s => {
    const sec = Math.max(0, Math.round(s));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
};
const fmtMs = ms => {
    const total = Math.max(0, Math.round((ms || 0) / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};
const prettify = value => {
    if (!value) return '—';
    return String(value).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
};
const pct = v => `${Math.round((v || 0) * 100)}%`;

// ─── Static waveform bars ────────────────────────────────────────────────────
const BARS = [
    0.3, 0.6, 0.9, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6, 0.4,
    0.7, 1.0, 0.8, 0.5, 0.3, 0.6, 0.9, 0.7, 1.0, 0.8,
    0.5, 0.4, 0.6, 0.9, 0.7, 0.5, 0.3, 0.6, 0.8, 0.4,
];

const WaveformBars = memo(({ progress = 0, color = '#0A7EA4' }) => (
    <View style={wfSt.row}>
        {BARS.map((h, i) => {
            const filled = i / BARS.length < progress;
            return (
                <View
                    key={i}
                    style={[wfSt.bar, { height: h * 28, backgroundColor: filled ? color : `${color}35` }]}
                />
            );
        })}
    </View>
));
const wfSt = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 32 },
    bar: { width: 4, borderRadius: 2 },
});

// ─── Tab bar ─────────────────────────────────────────────────────────────────
const TABS = [
    { id: 'cardiac', label: '❤️  Cardiac' },
    { id: 'lung', label: '🫁  Lung' },
    { id: 'audio', label: '🎵  Audio' },
    { id: 'tools', label: '🛠  Tools' },
];

const TabBar = memo(({ active, onChange }) => (
    <View style={tabSt.wrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={tabSt.row}>
            {TABS.map(tab => {
                const isActive = active === tab.id;
                return (
                    <TouchableOpacity
                        key={tab.id}
                        style={[tabSt.tab, isActive && tabSt.tabActive]}
                        onPress={() => onChange(tab.id)}
                        activeOpacity={0.75}
                    >
                        <Text style={[tabSt.tabTxt, isActive && tabSt.tabTxtActive]}>
                            {tab.label}
                        </Text>
                        {isActive && <View style={tabSt.underline} />}
                    </TouchableOpacity>
                );
            })}
        </ScrollView>
    </View>
));
const tabSt = StyleSheet.create({
    wrap: {
        backgroundColor: C.surface,
        borderBottomWidth: 1,
        borderBottomColor: C.border,
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06, shadowRadius: 2, elevation: 2,
    },
    row: { flexDirection: 'row', paddingHorizontal: SPACING.md },
    tab: {
        paddingVertical: 13, paddingHorizontal: SPACING.md,
        marginRight: 4, position: 'relative', alignItems: 'center',
    },
    tabActive: {},
    tabTxt: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: C.textLo },
    tabTxtActive: { color: C.teal, fontWeight: '800' },
    underline: {
        position: 'absolute', bottom: 0, left: SPACING.md, right: SPACING.md,
        height: 2.5, borderRadius: 2, backgroundColor: C.teal,
    },
});

// ─── Signal quality arc card ──────────────────────────────────────────────────
const MetricPill = memo(({ value, label, color = C.teal, sub }) => (
    <View style={mpSt.wrap}>
        <Text style={[mpSt.value, { color }]}>{value}</Text>
        <Text style={mpSt.label}>{label}</Text>
        {sub ? <Text style={mpSt.sub}>{sub}</Text> : null}
    </View>
));
const mpSt = StyleSheet.create({
    wrap: {
        flex: 1, backgroundColor: C.surface, borderRadius: 14,
        padding: SPACING.md, alignItems: 'center',
        borderWidth: 1, borderColor: C.border,
    },
    value: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
    label: { fontSize: 10, color: C.textLo, fontWeight: '700', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
    sub: { fontSize: 10, color: C.textMid, marginTop: 2 },
});

// ─── Confidence bar ───────────────────────────────────────────────────────────
const ConfBar = memo(({ label, value = 0, color = C.teal, icon, detail }) => {
    const animW = useRef(new Animated.Value(0)).current;
    useEffect(() => {
        Animated.timing(animW, {
            toValue: Math.min(value, 1),
            duration: 700,
            useNativeDriver: false,
        }).start();
    }, [value, animW]);

    const pctVal = Math.round(value * 100);
    const isPositive = pctVal >= 45;

    return (
        <View style={cbSt.row}>
            <View style={cbSt.labelWrap}>
                {icon ? <Text style={cbSt.icon}>{icon}</Text> : null}
                <View>
                    <Text style={cbSt.label}>{label}</Text>
                    {detail ? <Text style={cbSt.detail}>{detail}</Text> : null}
                </View>
            </View>
            <View style={cbSt.right}>
                <View style={cbSt.track}>
                    <Animated.View
                        style={[
                            cbSt.fill,
                            { backgroundColor: color, width: animW.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) },
                        ]}
                    />
                </View>
                <Text style={[cbSt.pct, isPositive && { color, fontWeight: '800' }]}>
                    {pctVal}%
                </Text>
            </View>
        </View>
    );
});
const cbSt = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    labelWrap: { flexDirection: 'row', alignItems: 'center', width: 132, gap: 6 },
    icon: { fontSize: 16 },
    label: { fontSize: FONTS.sizes.xs, fontWeight: '700', color: C.textHi },
    detail: { fontSize: 10, color: C.textLo, marginTop: 1 },
    right: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
    track: { flex: 1, height: 7, backgroundColor: '#E8EEF5', borderRadius: 4, overflow: 'hidden' },
    fill: { height: 7, borderRadius: 4 },
    pct: { width: 36, fontSize: FONTS.sizes.xs, fontWeight: '600', color: C.textMid, textAlign: 'right' },
});

// ─── Section header ───────────────────────────────────────────────────────────
const SectionLabel = memo(({ title, badge }) => (
    <View style={slSt.row}>
        <Text style={slSt.txt}>{title}</Text>
        {badge ? <View style={slSt.badge}><Text style={slSt.badgeTxt}>{badge}</Text></View> : null}
    </View>
));
const slSt = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SPACING.sm, marginTop: SPACING.md },
    txt: { fontSize: 11, fontWeight: '800', color: C.textLo, textTransform: 'uppercase', letterSpacing: 1 },
    badge: { backgroundColor: C.teal + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
    badgeTxt: { fontSize: 10, fontWeight: '800', color: C.teal },
});

// ─── Classification badge ─────────────────────────────────────────────────────
const LUNG_CLASS_CONFIG = {
    normal: { color: C.green, bg: '#ECFDF5', label: 'Normal — Vesicular Breath Sounds', icon: '✅' },
    wheeze: { color: '#B45309', bg: '#FFFBEB', label: 'Wheeze Detected', icon: '🔔' },
    rhonchi: { color: '#9D174D', bg: '#FDF2F8', label: 'Rhonchi Detected', icon: '🌀' },
    crackles: { color: C.rose, bg: '#FFF1F2', label: 'Crackles Detected', icon: '⚡' },
    stridor: { color: C.violet, bg: '#F5F3FF', label: 'Stridor Detected', icon: '⚠️' },
    mixed: { color: '#B91C1C', bg: '#FEF2F2', label: 'Multiple Abnormal Sounds', icon: '🔴' },
    absent: { color: C.textLo, bg: '#F8FAFC', label: 'Signal Absent or Too Weak', icon: '—' },
};

const LungClassBadge = memo(({ classification }) => {
    const cfg = LUNG_CLASS_CONFIG[classification] || LUNG_CLASS_CONFIG.normal;
    return (
        <View style={[lcbSt.wrap, { backgroundColor: cfg.bg, borderColor: cfg.color + '40' }]}>
            <Text style={lcbSt.icon}>{cfg.icon}</Text>
            <View>
                <Text style={lcbSt.sub}>Lung Classification</Text>
                <Text style={[lcbSt.label, { color: cfg.color }]}>{cfg.label}</Text>
            </View>
        </View>
    );
});
const lcbSt = StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1.5, padding: 14, marginBottom: SPACING.md },
    icon: { fontSize: 26 },
    sub: { fontSize: 10, fontWeight: '700', color: C.textLo, textTransform: 'uppercase', letterSpacing: 0.5 },
    label: { fontSize: FONTS.sizes.sm, fontWeight: '800', marginTop: 2 },
});

// ─── Breath rate ring ─────────────────────────────────────────────────────────
const BreathRateCard = memo(({ bpm }) => {
    if (!bpm) return null;
    const normal = bpm >= 12 && bpm <= 20;
    const color = normal ? C.green : bpm < 12 ? C.lungAccent : C.amber;
    const status = normal ? 'Normal' : bpm < 12 ? 'Bradypnea' : 'Tachypnea';
    return (
        <View style={brcSt.wrap}>
            <View style={[brcSt.ring, { borderColor: color }]}>
                <Text style={[brcSt.bpm, { color }]}>{Math.round(bpm)}</Text>
                <Text style={brcSt.unit}>BPM</Text>
            </View>
            <View style={brcSt.info}>
                <Text style={brcSt.label}>Respiratory Rate</Text>
                <Text style={[brcSt.status, { color }]}>{status}</Text>
                <Text style={brcSt.ref}>Normal: 12–20 BPM (adult)</Text>
            </View>
        </View>
    );
});
const brcSt = StyleSheet.create({
    wrap: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1, borderColor: C.border, padding: SPACING.md, marginBottom: SPACING.md },
    ring: { width: 72, height: 72, borderRadius: 36, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
    bpm: { fontSize: 22, fontWeight: '800', letterSpacing: -1 },
    unit: { fontSize: 10, color: C.textLo, fontWeight: '700', marginTop: -2 },
    info: { flex: 1 },
    label: { fontSize: FONTS.sizes.xs, fontWeight: '700', color: C.textLo, textTransform: 'uppercase', letterSpacing: 0.5 },
    status: { fontSize: FONTS.sizes.md, fontWeight: '800', marginTop: 2 },
    ref: { fontSize: 10, color: C.textLo, marginTop: 2 },
});

// ─── Respiratory phase timeline strip ────────────────────────────────────────
const RespiratoryPhaseStrip = memo(({ phases = [], durationMs }) => {
    if (!phases.length || !durationMs) return null;
    return (
        <View style={rpSt.wrap}>
            <Text style={rpSt.title}>Respiratory Phases</Text>
            <View style={rpSt.strip}>
                {phases.map((p, i) => {
                    const left = (p.start_ms / durationMs) * 100;
                    const width = ((p.end_ms - p.start_ms) / durationMs) * 100;
                    const isInsp = p.phase === 'inspiration';
                    return (
                        <View
                            key={i}
                            style={[
                                rpSt.block,
                                {
                                    left: `${left}%`,
                                    width: `${width}%`,
                                    backgroundColor: isInsp ? '#DBEAFE' : '#DCFCE7',
                                    borderColor: isInsp ? '#93C5FD' : '#86EFAC',
                                },
                            ]}
                        />
                    );
                })}
            </View>
            <View style={rpSt.legend}>
                <View style={rpSt.legendItem}>
                    <View style={[rpSt.legendDot, { backgroundColor: '#DBEAFE', borderColor: '#93C5FD' }]} />
                    <Text style={rpSt.legendTxt}>Inspiration</Text>
                </View>
                <View style={rpSt.legendItem}>
                    <View style={[rpSt.legendDot, { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' }]} />
                    <Text style={rpSt.legendTxt}>Expiration</Text>
                </View>
            </View>
        </View>
    );
});
const rpSt = StyleSheet.create({
    wrap: { marginBottom: SPACING.md },
    title: { fontSize: 11, fontWeight: '700', color: C.textLo, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
    strip: { height: 20, backgroundColor: '#F1F5F9', borderRadius: 6, overflow: 'hidden', position: 'relative', marginBottom: 6 },
    block: { position: 'absolute', height: '100%', borderRadius: 4, borderWidth: 1 },
    legend: { flexDirection: 'row', gap: 16 },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    legendDot: { width: 10, height: 10, borderRadius: 3, borderWidth: 1 },
    legendTxt: { fontSize: 10, color: C.textMid, fontWeight: '600' },
});

// ─── Lung Analysis Panel (NEW) ────────────────────────────────────────────────
const LungAnalysisPanel = memo(({ lungAnalysis, inputLengthMs }) => {
    if (!lungAnalysis) {
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Lung Sound Analysis</Text>
                <Text style={styles.emptyTxt}>
                    Lung analysis data not available. Re-run analysis to populate this panel.
                </Text>
            </View>
        );
    }

    const {
        lung_classification,
        wheeze_confidence = 0,
        rhonchi_confidence = 0,
        fine_crackle_confidence = 0,
        coarse_crackle_confidence = 0,
        stridor_confidence = 0,
        breath_rate_bpm,
        respiratory_phases = [],
        signal_quality,
        cardiac_contamination = 0,
    } = lungAnalysis;

    const hasAbnormal = wheeze_confidence > 0.15 || rhonchi_confidence > 0.15 ||
        fine_crackle_confidence > 0.15 || coarse_crackle_confidence > 0.15 || stridor_confidence > 0.15;

    return (
        <View>
            {/* Classification badge */}
            <LungClassBadge classification={lung_classification} />

            {/* Signal quality + contamination row */}
            <View style={{ flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md }}>
                <MetricPill
                    value={signal_quality != null ? pct(signal_quality) : '—'}
                    label="Lung Signal"
                    color={C.lungAccent}
                    sub="Respiratory content"
                />
                <MetricPill
                    value={cardiac_contamination != null ? pct(cardiac_contamination) : '—'}
                    label="Cardiac Bleed"
                    color={cardiac_contamination > 0.15 ? C.rose : C.green}
                    sub={cardiac_contamination > 0.15 ? 'High — check separation' : 'Acceptable'}
                />
            </View>

            {/* Breath rate */}
            <BreathRateCard bpm={breath_rate_bpm} />

            {/* Respiratory phase strip */}
            <RespiratoryPhaseStrip phases={respiratory_phases} durationMs={inputLengthMs} />

            {/* Sound confidence bars */}
            <SectionLabel title="Adventitious Sound Scoring" badge={hasAbnormal ? 'Findings' : 'Clear'} />
            <View style={styles.card}>
                <ConfBar
                    icon="🔔"
                    label="Wheeze"
                    detail="400–1000 Hz · tonal"
                    value={wheeze_confidence}
                    color="#B45309"
                />
                <ConfBar
                    icon="🌀"
                    label="Rhonchi"
                    detail="200–400 Hz · musical"
                    value={rhonchi_confidence}
                    color="#9D174D"
                />
                <ConfBar
                    icon="⚡"
                    label="Fine Crackles"
                    detail="400–2000 Hz · < 10 ms"
                    value={fine_crackle_confidence}
                    color={C.rose}
                />
                <ConfBar
                    icon="💥"
                    label="Coarse Crackles"
                    detail="100–400 Hz · 10–40 ms"
                    value={coarse_crackle_confidence}
                    color="#7C2D12"
                />
                <ConfBar
                    icon="⚠️"
                    label="Stridor"
                    detail="700–1800 Hz · inspiratory"
                    value={stridor_confidence}
                    color={C.violet}
                />

                <View style={lpSt.thresholdNote}>
                    <Text style={lpSt.thresholdTxt}>
                        ≥ 45% confidence = positive finding  ·  Threshold is configurable
                    </Text>
                </View>
            </View>

            {/* Clinical notes */}
            {hasAbnormal && (
                <View style={lpSt.clinicalNote}>
                    <Text style={lpSt.clinicalNoteTitle}>⚕️  Clinical Note</Text>
                    <Text style={lpSt.clinicalNoteTxt}>
                        One or more adventitious sounds detected above threshold.
                        Correlate with clinical presentation and patient history.
                        This AI analysis is an aid — it does not replace auscultation.
                    </Text>
                </View>
            )}
        </View>
    );
});
const lpSt = StyleSheet.create({
    thresholdNote: { marginTop: 4, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: C.border },
    thresholdTxt: { fontSize: 10, color: C.textLo, lineHeight: 14 },
    clinicalNote: { backgroundColor: '#FFF7ED', borderRadius: 12, borderWidth: 1, borderColor: '#FED7AA', padding: SPACING.md, marginBottom: SPACING.md },
    clinicalNoteTitle: { fontSize: FONTS.sizes.xs, fontWeight: '800', color: '#92400E', marginBottom: 4 },
    clinicalNoteTxt: { fontSize: FONTS.sizes.xs, color: '#78350F', lineHeight: 18 },
});

// ─── Audio Card ───────────────────────────────────────────────────────────────
const AudioCard = memo(({
    label, emoji, base64, gradientColors, accentColor,
    onGlobalBusy, onTimeUpdate, expectedDurationSec = 0,
}) => {
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
            if (soundRef.current) { SepPlayer.release(soundRef.current); soundRef.current = null; }
        };
    }, []);

    useEffect(() => {
        _stop(false); setElapsed(0); setDuration(0); setState('idle'); onTimeUpdate?.(0);
    }, [base64, onTimeUpdate]);

    const _clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
    const _startTimer = snd => {
        _clearTimer();
        timerRef.current = setInterval(async () => {
            if (!mountedRef.current) return;
            const t = await SepPlayer.getCurrentTime(snd);
            setElapsed(t); onTimeUpdate?.(Math.round(t * 1000));
        }, 200);
    };
    const _stop = (notify = true) => {
        _clearTimer(); SepPlayer.stop(soundRef.current);
        if (mountedRef.current) { setState('idle'); setElapsed(0); onTimeUpdate?.(0); }
        if (notify && onGlobalBusy) onGlobalBusy(false);
    };

    const handlePlay = useCallback(async () => {
        if (!base64) return;
        if (state === 'playing') { _clearTimer(); SepPlayer.pause(soundRef.current); setState('paused'); return; }
        if (state === 'paused' && soundRef.current) {
            setState('playing'); _startTimer(soundRef.current);
            SepPlayer.resume(soundRef.current, () => { if (mountedRef.current) _stop(); });
            return;
        }
        try {
            setState('loading'); setErrMsg('');
            if (onGlobalBusy) onGlobalBusy(true);
            if (soundRef.current) { await SepPlayer.release(soundRef.current); soundRef.current = null; }
            const { sound, duration: dur } = await SepPlayer.load(base64, label.toLowerCase());
            if (!mountedRef.current) { await SepPlayer.release(sound); return; }
            soundRef.current = sound; setDuration(dur);
            if (expectedDurationSec > 1 && dur > 0 && dur < expectedDurationSec * 0.5)
                setErrMsg(`Loaded only ${fmt(dur)} of expected ${fmt(expectedDurationSec)}`);
            else setErrMsg('');
            setState('playing'); _startTimer(sound);
            SepPlayer.play(sound, () => { if (mountedRef.current) _stop(); });
        } catch (err) {
            if (mountedRef.current) { setState('error'); setErrMsg(err?.message || 'Playback failed'); if (onGlobalBusy) onGlobalBusy(false); }
        }
    }, [base64, state, label, onGlobalBusy, onTimeUpdate, expectedDurationSec]);

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
            <View style={styles.waveformRow}><WaveformBars progress={progress} color={accentColor} /></View>
            {duration > 0 && (
                <View style={styles.scrubTrack}>
                    <View style={[styles.scrubFill, { width: `${progress * 100}%`, backgroundColor: accentColor }]} />
                </View>
            )}
            {isError && <Text style={styles.errorTxt}>⚠️ {errMsg}</Text>}
            <TouchableOpacity
                style={[styles.playBtn, { backgroundColor: accentColor }, (isLoading || !base64) && styles.playBtnDisabled]}
                onPress={handlePlay} disabled={isLoading || !base64} activeOpacity={0.8}>
                {isLoading
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Text style={styles.playBtnTxt}>{isPlaying ? '⏸  Pause' : isPaused ? '▶  Resume' : '▶  Play'}</Text>}
            </TouchableOpacity>
            {!base64 && <Text style={styles.noAudioTxt}>No audio available</Text>}
        </LinearGradient>
    );
});

// ─── Heart Detection Banner ───────────────────────────────────────────────────
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
                    <LinearGradient colors={['#0A7EA4', '#1A9BBF']} style={styles.detectBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
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
                    style={styles.detectResultCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
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
                        <View style={[styles.meterFill, { width: `${Math.round((heartConfidence || 0) * 100)}%`, backgroundColor: heartDetected ? '#1B7A4A' : '#C62828' }]} />
                    </View>
                </LinearGradient>
            )}
        </View>
    );
});

// ─── Noise Panel ──────────────────────────────────────────────────────────────
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
                    <TouchableOpacity key={t} style={[styles.noiseChip, noiseType === t && styles.noiseChipActive]} onPress={() => setNoiseType(t)}>
                        <Text style={[styles.noiseChipTxt, noiseType === t && { color: '#FFF' }]}>
                            {t === 'voice' ? '🗣' : t === 'white' ? '⬜' : t === 'pink' ? '🌸' : '🟤'} {t}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
            <Text style={styles.snrLbl}>SNR: {snrDb} dB</Text>
            <View style={styles.snrRow}>
                {[-5, 0, 5, 10, 15, 20].map(v => (
                    <TouchableOpacity key={v} style={[styles.snrBtn, snrDb === v && styles.snrBtnActive]} onPress={() => setSnrDb(v)}>
                        <Text style={[styles.snrBtnTxt, snrDb === v && { color: '#FFF' }]}>{v}</Text>
                    </TouchableOpacity>
                ))}
            </View>
            <TouchableOpacity style={[styles.addNoiseBtn, isAdding && styles.playBtnDisabled]} onPress={run} disabled={isAdding} activeOpacity={0.85}>
                {isAdding ? <ActivityIndicator size="small" color="#FFF" /> : <Text style={styles.addNoiseBtnTxt}>Add Noise & Preview</Text>}
            </TouchableOpacity>
            {noisyAudio && !isAdding && (
                <AudioCard label="Noisy Preview" emoji="🔊" base64={noisyAudio}
                    gradientColors={['#FFF8E7', '#FFF3CD']} accentColor="#E6A817"
                    onGlobalBusy={() => { }} onTimeUpdate={() => { }} />
            )}
        </LinearGradient>
    );
});

// ─── Summary Chip ─────────────────────────────────────────────────────────────
const SummaryChip = memo(({ text, bg = '#EEF2FF', color = '#334155' }) => (
    <View style={[styles.summaryChip, { backgroundColor: bg }]}>
        <Text style={[styles.summaryChipTxt, { color }]}>{text}</Text>
    </View>
));

// ─── Murmur Panel ─────────────────────────────────────────────────────────────
const MurmurPanel = memo(({ murmurs = [] }) => {
    if (!murmurs?.length) {
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Murmur Analysis</Text>
                <Text style={styles.emptyTxt}>No murmurs detected above the configured confidence threshold.</Text>
            </View>
        );
    }
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Murmur Analysis</Text>
            <View style={styles.summaryChipRow}>
                <SummaryChip text={`${murmurs.length} detected`} bg="#FCE7F3" color="#9D174D" />
                {murmurs.some(m => m?.phase === 'systolic') && <SummaryChip text="Systolic" bg="#FDF2F8" color="#BE185D" />}
                {murmurs.some(m => m?.phase === 'diastolic') && <SummaryChip text="Diastolic" bg="#EFF6FF" color="#1D4ED8" />}
            </View>
            {murmurs.map((m, idx) => (
                <View key={`${m?.type || 'murmur'}-${idx}`} style={styles.findingCard}>
                    <View style={styles.findingHeader}>
                        <Text style={styles.findingTitle}>{m?.label || prettify(m?.type) || 'Murmur'}</Text>
                        <View style={styles.confPill}><Text style={styles.confPillTxt}>{Math.round((m?.confidence || 0) * 100)}%</Text></View>
                    </View>
                    <Text style={styles.findingTime}>{fmtMs(m?.start_ms)} - {fmtMs(m?.end_ms)}</Text>
                    <View style={styles.summaryChipRow}>
                        {!!m?.phase && <SummaryChip text={prettify(m.phase)} bg="#ECFEFF" color="#155E75" />}
                        {!!m?.pattern && <SummaryChip text={prettify(m.pattern)} bg="#FFF7ED" color="#C2410C" />}
                        {!!m?.type && <SummaryChip text={m.type} bg="#F8FAFC" color="#475569" />}
                    </View>
                    {Array.isArray(m?.possible_condition) && m.possible_condition.length > 0 && (
                        <Text style={styles.findingSub}>Possible conditions: {m.possible_condition.join(', ')}</Text>
                    )}
                </View>
            ))}
        </View>
    );
});

// ─── Extra Sounds Panel ───────────────────────────────────────────────────────
const ExtraSoundsPanel = memo(({ extraSounds = [] }) => {
    if (!extraSounds?.length) {
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>Extra Heart Sounds</Text>
                <Text style={styles.emptyTxt}>No extra heart sounds (S3, S4, split S2) detected.</Text>
            </View>
        );
    }
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Extra Heart Sounds</Text>
            {extraSounds.map((e, idx) => (
                <View key={`${e?.type || 'extra'}-${idx}`} style={styles.findingCard}>
                    <Text style={styles.findingTitle}>{e?.label || prettify(e?.type) || 'Extra sound'}</Text>
                    <Text style={styles.findingTime}>{fmtMs(e?.start_ms)}{typeof e?.end_ms === 'number' ? ` - ${fmtMs(e.end_ms)}` : ''}</Text>
                    {!!e?.phase && <Text style={styles.findingSub}>Phase: {prettify(e.phase)}</Text>}
                </View>
            ))}
        </View>
    );
});

// ─── Segment Details Panel ────────────────────────────────────────────────────
const SegmentDetailsPanel = memo(({ selectedSeg }) => {
    if (!selectedSeg) return null;
    return (
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Selected Timeline Segment</Text>
            <Text style={styles.findingTitle}>{selectedSeg?.label || prettify(selectedSeg?.type)}</Text>
            <Text style={styles.findingTime}>{fmtMs(selectedSeg?.start_ms)} - {fmtMs(selectedSeg?.end_ms)}</Text>
            {!!selectedSeg?.type && <Text style={styles.findingSub}>Type: {prettify(selectedSeg.type)}</Text>}
            {!!selectedSeg?.subtype && <Text style={styles.findingSub}>Subtype: {prettify(selectedSeg.subtype)}</Text>}
            {!!selectedSeg?.meta?.phase && <Text style={styles.findingSub}>Phase: {prettify(selectedSeg.meta.phase)}</Text>}
            {typeof selectedSeg?.meta?.confidence === 'number' && <Text style={styles.findingSub}>Confidence: {Math.round(selectedSeg.meta.confidence * 100)}%</Text>}
            {!!selectedSeg?.meta?.pattern && <Text style={styles.findingSub}>Pattern: {prettify(selectedSeg.meta.pattern)}</Text>}
            {Array.isArray(selectedSeg?.meta?.possibleCondition) && selectedSeg.meta.possibleCondition.length > 0 && (
                <Text style={styles.findingSub}>Possible conditions: {selectedSeg.meta.possibleCondition.join(', ')}</Text>
            )}
        </View>
    );
});

// ─── Timeline builder ─────────────────────────────────────────────────────────
const buildTimeline = (cardiacCycles = [], extraSounds = [], murmurs = [], noiseSegments = []) => {
    const items = [];
    cardiacCycles.forEach((cycle, idx) => {
        if (cycle?.systole) items.push({ id: `cycle-sys-${idx}`, type: 'systole', start_ms: cycle.systole.start_ms, end_ms: cycle.systole.end_ms, label: 'Systole' });
        if (cycle?.diastole) items.push({ id: `cycle-dia-${idx}`, type: 'diastole', start_ms: cycle.diastole.start_ms, end_ms: cycle.diastole.end_ms, label: 'Diastole' });
    });
    extraSounds.forEach((e, idx) => items.push({ id: `extra-${idx}`, type: e?.type || 'extra', subtype: e?.type, start_ms: e.start_ms, end_ms: e.end_ms || e.start_ms + 40, label: e?.label || prettify(e?.type) || 'Extra sound', meta: { phase: e?.phase } }));
    murmurs.forEach((m, idx) => items.push({ id: `murmur-${idx}`, type: 'murmur', subtype: m?.type, start_ms: m.start_ms, end_ms: m.end_ms, label: m?.label || prettify(m?.type) || 'Murmur', meta: { phase: m?.phase, confidence: m?.confidence, pattern: m?.pattern, possibleCondition: m?.possible_condition || [] } }));
    noiseSegments.forEach((n, idx) => items.push({ id: `noise-${idx}`, type: 'noise', start_ms: n.start_ms, end_ms: n.end_ms, label: 'Noise' }));
    return items.filter(v => typeof v.start_ms === 'number' && typeof v.end_ms === 'number').sort((a, b) => a.start_ms - b.start_ms);
};

// ─── Main AnalysisSection ─────────────────────────────────────────────────────
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
    const originalAudio = useSelector(selectOriginalAudio);
    const lungAnalysis = useSelector(selectLungAnalysis);  // NEW

    const fadeAnim = useRef(new Animated.Value(0)).current;
    const [anyBusy, setAnyBusy] = useState(false);
    const [playheadMs, setPlayheadMs] = useState(0);
    const [selectedSeg, setSelectedSeg] = useState(null);
    const [activeTab, setActiveTab] = useState('cardiac');

    const timeline = useMemo(
        () => buildTimeline(cardiacCycles, extraSounds, murmurs, noiseSegments),
        [cardiacCycles, extraSounds, murmurs, noiseSegments],
    );

    useEffect(() => {
        if (heart || lung) {
            Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
        }
    }, [heart, lung, fadeAnim]);

    const handleRetake = useCallback(() => {
        Alert.alert('Retake Recording', 'Discard current analysis and go back?', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Retake', style: 'destructive', onPress: () => { dispatch(clearSeparationData()); onRetake?.(); } },
        ]);
    }, [dispatch, onRetake]);

    // ── Loading / error / empty states ────────────────────────────────────
    if (isProcessing) {
        return (
            <View style={styles.centered}>
                <View style={styles.processingCard}>
                    <ActivityIndicator size="large" color={C.teal} />
                    <Text style={styles.processingTxt}>Separating heart & lung sounds</Text>
                    <Text style={styles.processingSubTxt}>NMF + NeoSSNet pipeline running…</Text>
                    <View style={styles.processingSteps}>
                        {['Noise removal', 'Classification', 'NMF separation', 'Cardiac analysis', 'Lung analysis'].map((s, i) => (
                            <View key={i} style={styles.processingStep}>
                                <View style={[styles.processingDot, { backgroundColor: i < 2 ? C.green : C.teal + '40' }]} />
                                <Text style={[styles.processingStepTxt, { color: i < 2 ? C.green : C.textLo }]}>{s}</Text>
                            </View>
                        ))}
                    </View>
                </View>
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
                <Text style={styles.emptyBody}>Upload an audio file from the Recordings tab to separate heart and lung sounds.</Text>
                <TouchableOpacity style={styles.retakeBtn} onPress={handleRetake}>
                    <Text style={styles.retakeBtnTxt}>← Go to Recordings</Text>
                </TouchableOpacity>
            </View>
        );
    }

    // ── Rendered output ───────────────────────────────────────────────────
    return (
        <View style={styles.outerWrap}>
            {/* Top summary bar */}
            <Animated.View style={[styles.summaryBar, { opacity: fadeAnim }]}>
                <View style={styles.summaryBarInner}>
                    <MetricPill value={signalQuality != null ? pct(signalQuality) : '—'} label="Signal" color={C.teal} />
                    <MetricPill value={noiseLevel != null ? pct(noiseLevel) : '—'} label="Noise" color={noiseLevel > 0.3 ? C.rose : C.textMid} />
                    <MetricPill value={heartBpm ? `${Math.round(heartBpm)}` : '—'} label="Heart BPM" color={C.heartAccent} sub={heartBpm ? 'bpm' : null} />
                    <MetricPill
                        value={lungAnalysis?.breath_rate_bpm ? `${Math.round(lungAnalysis.breath_rate_bpm)}` : '—'}
                        label="Resp. Rate"
                        color={C.lungAccent}
                        sub={lungAnalysis?.breath_rate_bpm ? 'bpm' : null}
                    />
                </View>
            </Animated.View>

            {/* Tab navigation */}
            <TabBar active={activeTab} onChange={setActiveTab} />

            <ScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                <Animated.View style={{ opacity: fadeAnim }}>

                    {/* ── CARDIAC TAB ────────────────────────────────── */}
                    {activeTab === 'cardiac' && (
                        <View>
                            <HeartDetectionBanner heartBase64={heart} />

                            {/* Summary chips */}
                            <View style={styles.card}>
                                <Text style={styles.cardTitle}>Cardiac Summary</Text>
                                <View style={styles.summaryChipRow}>
                                    <SummaryChip text={`${cardiacCycles?.length || 0} cycles`} bg="#EFF6FF" color="#1D4ED8" />
                                    <SummaryChip text={`${extraSounds?.length || 0} extra sounds`} bg="#F5F3FF" color="#6D28D9" />
                                    <SummaryChip text={`${murmurs?.length || 0} murmurs`} bg="#FCE7F3" color="#BE185D" />
                                    {heartBpm ? <SummaryChip text={`~${Math.round(heartBpm)} BPM`} bg="#ECFDF5" color="#047857" /> : null}
                                    {processingMs != null ? <SummaryChip text={`${Math.round(processingMs)} ms`} bg="#F8FAFC" color="#64748B" /> : null}
                                </View>
                            </View>

                            {/* Timeline */}
                            <SectionLabel title="Clinical Timeline" />
                            <ClinicalTimelineVisualization
                                durationMs={inputLengthMs || 1}
                                timeline={timeline}
                                heartBpm={heartBpm}
                                activeMs={playheadMs}
                                onSegmentPress={setSelectedSeg}
                            />
                            {selectedSeg && (
                                <View style={{ marginTop: SPACING.md }}>
                                    <SegmentDetailsPanel selectedSeg={selectedSeg} />
                                </View>
                            )}

                            <SectionLabel title="Murmur Analysis" badge={murmurs?.length ? `${murmurs.length} found` : 'Clear'} />
                            <MurmurPanel murmurs={murmurs} />

                            <SectionLabel title="Extra Heart Sounds" />
                            <ExtraSoundsPanel extraSounds={extraSounds} />
                        </View>
                    )}

                    {/* ── LUNG TAB ──────────────────────────────────── */}
                    {activeTab === 'lung' && (
                        <View>
                            <SectionLabel title="Lung Sound Analysis" />
                            <LungAnalysisPanel lungAnalysis={lungAnalysis} inputLengthMs={inputLengthMs} />
                        </View>
                    )}

                    {/* ── AUDIO TAB ─────────────────────────────────── */}
                    {activeTab === 'audio' && (
                        <View>
                            <SectionLabel title="Original Recording" />
                            <AudioCard
                                label="Raw Stethoscope Audio" emoji="🎙️"
                                base64={originalAudio}
                                gradientColors={['#F8FAFC', '#EEF2F7', '#E2E8F0']}
                                accentColor="#475569"
                                onGlobalBusy={setAnyBusy} onTimeUpdate={setPlayheadMs}
                                expectedDurationSec={(inputLengthMs || 0) / 1000}
                            />

                            <SectionLabel title="Separated Channels" />
                            <AudioCard
                                label="Heart Sound" emoji="❤️"
                                base64={heart}
                                gradientColors={['#FFF0F3', '#FFE4EA', '#FFCDD8']}
                                accentColor={C.heartAccent}
                                onGlobalBusy={setAnyBusy} onTimeUpdate={setPlayheadMs}
                                expectedDurationSec={(inputLengthMs || 0) / 1000}
                            />
                            <View style={{ height: SPACING.md }} />
                            <AudioCard
                                label="Lung Sound" emoji="🫁"
                                base64={lung}
                                gradientColors={['#F0F8FF', '#E3F2FD', '#BBDEFB']}
                                accentColor={C.lungAccent}
                                onGlobalBusy={setAnyBusy} onTimeUpdate={setPlayheadMs}
                                expectedDurationSec={(inputLengthMs || 0) / 1000}
                            />

                            {/* Audio quality note */}
                            {lungAnalysis?.cardiac_contamination > 0.15 && (
                                <View style={styles.warningBanner}>
                                    <Text style={styles.warningTxt}>
                                        ⚠️  Residual cardiac bleed in lung channel: {pct(lungAnalysis.cardiac_contamination)}.
                                        Consider re-recording with better placement.
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}

                    {/* ── TOOLS TAB ─────────────────────────────────── */}
                    {activeTab === 'tools' && (
                        <View>
                            <SectionLabel title="Heart Sound Detection" />
                            <HeartDetectionBanner heartBase64={heart} />

                            <SectionLabel title="Noise Injection Test" />
                            <NoisePanel heartBase64={heart} />
                        </View>
                    )}

                </Animated.View>

                {/* Retake button — always visible */}
                <View style={{ marginTop: SPACING.xl }}>
                    <TouchableOpacity
                        style={[styles.retakeBtn, anyBusy && styles.playBtnDisabled]}
                        onPress={handleRetake}
                        activeOpacity={0.85}
                        disabled={anyBusy}
                    >
                        <Text style={styles.retakeBtnTxt}>⟵  Retake / New Recording</Text>
                    </TouchableOpacity>
                </View>

                <View style={{ height: 40 }} />
            </ScrollView>
        </View>
    );
});

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    outerWrap: { flex: 1, backgroundColor: C.bg },

    // Summary bar
    summaryBar: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border },
    summaryBarInner: { flexDirection: 'row', gap: SPACING.xs, padding: SPACING.sm },

    // Scroll
    scroll: { flex: 1 },
    scrollContent: { padding: SPACING.lg, paddingBottom: 60 },

    // Generic card
    card: { backgroundColor: C.surface, borderRadius: 16, padding: SPACING.lg, borderWidth: 1, borderColor: C.border, marginBottom: SPACING.md, ...SHADOWS?.small },
    cardTitle: { fontSize: FONTS.sizes.md, fontWeight: '800', color: C.textHi, marginBottom: SPACING.md },

    // Centered states
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl },
    processingCard: { alignItems: 'center', backgroundColor: C.surface, borderRadius: 20, padding: SPACING.xl, borderWidth: 1, borderColor: C.border, width: '100%' },
    processingTxt: { marginTop: SPACING.md, fontSize: FONTS.sizes.lg, fontWeight: '700', color: C.textHi },
    processingSubTxt: { fontSize: FONTS.sizes.sm, color: C.textLo, marginTop: 4 },
    processingSteps: { marginTop: SPACING.lg, alignSelf: 'stretch', gap: 8 },
    processingStep: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    processingDot: { width: 8, height: 8, borderRadius: 4 },
    processingStepTxt: { fontSize: FONTS.sizes.xs, fontWeight: '600' },

    errorBig: { fontSize: 56, marginBottom: SPACING.md },
    errorTitleTxt: { fontSize: FONTS.sizes.xl, fontWeight: '800', color: '#C62828', marginBottom: SPACING.sm },
    errorBodyTxt: { fontSize: FONTS.sizes.sm, color: '#555', textAlign: 'center', marginBottom: SPACING.xl },

    emptyIcon: { fontSize: 64, marginBottom: SPACING.md },
    emptyTitle: { fontSize: FONTS.sizes.xl, fontWeight: '800', color: C.textHi, marginBottom: SPACING.sm },
    emptyBody: { fontSize: FONTS.sizes.sm, color: C.textLo, textAlign: 'center', lineHeight: 20, marginBottom: SPACING.xl },
    emptyTxt: { fontSize: FONTS.sizes.sm, color: C.textMid, lineHeight: 20 },

    retakeBtn: { backgroundColor: '#64748B', borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, alignSelf: 'center' },
    retakeBtnTxt: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '700' },

    // Audio card
    audioCard: { borderRadius: 16, padding: SPACING.lg, marginBottom: 2, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)', ...SHADOWS?.medium },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: SPACING.sm },
    cardEmoji: { fontSize: 28, marginRight: SPACING.sm },
    cardLabel: { fontSize: FONTS.sizes.md, fontWeight: '800', color: C.textHi },
    cardDuration: { fontSize: FONTS.sizes.xs, color: C.textMid, fontWeight: '600', marginTop: 2 },
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

    // Heart detection
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

    // Noise panel
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

    // Finding cards
    summaryChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
    summaryChip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999 },
    summaryChipTxt: { fontSize: FONTS.sizes.xs, fontWeight: '700' },
    findingCard: { backgroundColor: '#F8FAFC', borderRadius: 12, padding: SPACING.md, marginTop: SPACING.sm, borderWidth: 1, borderColor: C.border },
    findingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACING.sm, marginBottom: 4 },
    findingTitle: { flex: 1, fontSize: FONTS.sizes.sm, fontWeight: '800', color: C.textHi },
    confPill: { backgroundColor: '#FCE7F3', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
    confPillTxt: { fontSize: FONTS.sizes.xs, fontWeight: '800', color: '#BE185D' },
    findingTime: { fontSize: FONTS.sizes.xs, color: C.textMid, fontWeight: '600', marginBottom: SPACING.xs },
    findingSub: { fontSize: FONTS.sizes.xs, color: C.textMid, lineHeight: 18, marginTop: 6 },

    // Warning
    warningBanner: { backgroundColor: '#FFFBEB', borderRadius: 10, borderWidth: 1, borderColor: '#FDE68A', padding: SPACING.md, marginTop: SPACING.sm },
    warningTxt: { fontSize: FONTS.sizes.xs, color: '#92400E', lineHeight: 18 },
});

export default AnalysisSection;