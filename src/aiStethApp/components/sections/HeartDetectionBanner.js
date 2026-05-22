// src/aiStethApp/components/HeartDetectionBanner.js  v3
// Displays: heart present/absent + 4 feature scores + murmur type card
// Works with noise_service_v3.py + SeparationSlice.js v4

import React, { memo, useCallback } from 'react';
import {
    ActivityIndicator, StyleSheet, Text,
    TouchableOpacity, View,
} from 'react-native';
import { useDispatch, useSelector } from 'react-redux';
import LinearGradient from 'react-native-linear-gradient';
import {
    detectHeartThunk,
    selectIsDetectingHeart,
    selectHeartDetected,
    selectHeartConfidence,
    selectHeartBpm,
    selectHeartSpectralScore,
    selectHeartHfScore,
    selectHeartTransientScore,
    selectHeartDutyScore,
    selectHeartCentroidHz,
    selectHeartHfRatio,
    selectHeartNTransients,
    selectHeartActiveFraction,
    selectHeartRejectionReason,
    selectHeartDetectError,
    selectMurmurDetected,
    selectMurmurType,
    selectMurmurConfidence,
} from '../../../store/slices/SeparationSlice';

// ── Murmur metadata ───────────────────────────────────────────────────────────
const MURMUR_INFO = {
    systolic: {
        label: 'Systolic Murmur',
        icon: '🔴',
        detail: 'Occurs between S1 and S2. Possible causes: Aortic stenosis, Mitral regurgitation, Pulmonic stenosis, or VSD.',
        grad: ['#FFF1F2', '#FFE4E6'],
        color: '#9F1239',
    },
    diastolic: {
        label: 'Diastolic Murmur',
        icon: '🟠',
        detail: 'Occurs between S2 and S1. Possible causes: Aortic insufficiency, Mitral stenosis.',
        grad: ['#FFF7ED', '#FFEDD5'],
        color: '#9A3412',
    },
    continuous: {
        label: 'Continuous Murmur',
        icon: '🟡',
        detail: 'Heard throughout systole and diastole. Possible causes: Patent Ductus Arteriosus (PDA).',
        grad: ['#FEFCE8', '#FEF9C3'],
        color: '#854D0E',
    },
    benign: {
        label: 'Benign / Functional Murmur',
        icon: '🟢',
        detail: 'Soft, brief systolic murmur with no structural significance. Common in children and young adults.',
        grad: ['#F0FDF4', '#DCFCE7'],
        color: '#166534',
    },
};

// ── Small score bar ───────────────────────────────────────────────────────────
const ScoreBar = memo(({ label, value, color }) => (
    <View style={sb.row}>
        <Text style={sb.label}>{label}</Text>
        <View style={sb.track}>
            <View style={[sb.fill, {
                width: `${Math.round((value ?? 0) * 100)}%`,
                backgroundColor: color,
            }]} />
        </View>
        <Text style={sb.pct}>{Math.round((value ?? 0) * 100)}%</Text>
    </View>
));
const sb = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', marginBottom: 7 },
    label: { width: 76, fontSize: 11, color: '#374151', fontWeight: '600' },
    track: {
        flex: 1, height: 7, backgroundColor: 'rgba(0,0,0,0.10)',
        borderRadius: 4, overflow: 'hidden', marginHorizontal: 6
    },
    fill: { height: 7, borderRadius: 4 },
    pct: {
        width: 30, fontSize: 11, color: '#374151',
        fontWeight: '700', textAlign: 'right'
    },
});

// ── Murmur card ───────────────────────────────────────────────────────────────
const MurmurCard = memo(({ type, confidence }) => {
    const info = MURMUR_INFO[type];
    if (!info) return null;
    return (
        <LinearGradient colors={info.grad} style={mc.card}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <View style={mc.header}>
                <Text style={mc.icon}>{info.icon}</Text>
                <View style={{ flex: 1 }}>
                    <Text style={[mc.title, { color: info.color }]}>{info.label}</Text>
                    <Text style={mc.conf}>Confidence: {Math.round(confidence * 100)}%</Text>
                </View>
            </View>
            <Text style={mc.detail}>{info.detail}</Text>
            {/* Murmur confidence bar */}
            <View style={mc.track}>
                <View style={[mc.fill, {
                    width: `${Math.round(confidence * 100)}%`,
                    backgroundColor: info.color,
                }]} />
            </View>
        </LinearGradient>
    );
});
const mc = StyleSheet.create({
    card: { borderRadius: 12, padding: 14, marginTop: 10 },
    header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
    icon: { fontSize: 24, marginRight: 10, marginTop: 1 },
    title: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
    conf: { fontSize: 11, color: '#6B7280' },
    detail: { fontSize: 12, color: '#374151', lineHeight: 17, marginBottom: 8 },
    track: {
        height: 6, backgroundColor: 'rgba(0,0,0,0.10)',
        borderRadius: 3, overflow: 'hidden'
    },
    fill: { height: 6, borderRadius: 3 },
});

// ── Main banner ───────────────────────────────────────────────────────────────
export const HeartDetectionBanner = memo(({ heartBase64, sampleRate = 44100 }) => {
    const dispatch = useDispatch();
    const isDetecting = useSelector(selectIsDetectingHeart);
    const heartDetected = useSelector(selectHeartDetected);
    const heartConfidence = useSelector(selectHeartConfidence);
    const heartBpm = useSelector(selectHeartBpm);
    const spectral = useSelector(selectHeartSpectralScore);
    const hfScore = useSelector(selectHeartHfScore);
    const transient = useSelector(selectHeartTransientScore);
    const duty = useSelector(selectHeartDutyScore);
    const centroidHz = useSelector(selectHeartCentroidHz);
    const hfRatio = useSelector(selectHeartHfRatio);
    const nTransients = useSelector(selectHeartNTransients);
    const activeFraction = useSelector(selectHeartActiveFraction);
    const rejectionReason = useSelector(selectHeartRejectionReason);
    const detectError = useSelector(selectHeartDetectError);
    const murmurDetected = useSelector(selectMurmurDetected);
    const murmurType = useSelector(selectMurmurType);
    const murmurConfidence = useSelector(selectMurmurConfidence);

    const run = useCallback(() => {
        if (!heartBase64) return;
        dispatch(detectHeartThunk({ base64Audio: heartBase64, sampleRate }));
    }, [heartBase64, sampleRate, dispatch]);

    if (!heartBase64) return null;

    const detected = heartDetected === true;
    const checked = heartDetected !== null;

    return (
        <View style={s.wrap}>

            {/* Run button */}
            {!checked && !isDetecting && (
                <TouchableOpacity style={s.runBtn} onPress={run} activeOpacity={0.85}>
                    <LinearGradient colors={['#0A7EA4', '#1A9BBF']}
                        style={s.runBtnGrad}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                        <Text style={s.runBtnTxt}>🔬  Analyse Heart Sound</Text>
                    </LinearGradient>
                </TouchableOpacity>
            )}

            {/* Spinner */}
            {isDetecting && (
                <View style={s.spinRow}>
                    <ActivityIndicator size="small" color="#0A7EA4" />
                    <Text style={s.spinTxt}>  Running cardiac analysis…</Text>
                </View>
            )}

            {/* API error */}
            {detectError && !isDetecting && (
                <View style={s.errorCard}>
                    <Text style={s.errorTxt}>⚠️  {detectError}</Text>
                    <TouchableOpacity onPress={run} style={s.retryBtn}>
                        <Text style={s.retryTxt}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* Result card */}
            {checked && !isDetecting && !detectError && (
                <LinearGradient
                    colors={detected
                        ? ['#D4F4E7', '#E6FAF0', '#F0FDF7']
                        : ['#FEE2E2', '#FEF2F2', '#FFF5F5']}
                    style={s.resultCard}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>

                    {/* Header */}
                    <View style={s.resultHeader}>
                        <Text style={s.resultEmoji}>{detected ? '❤️' : '🚫'}</Text>
                        <View style={{ flex: 1 }}>
                            <Text style={[s.resultTitle,
                            { color: detected ? '#166534' : '#991B1B' }]}>
                                {detected ? 'Heart Sound Detected' : 'No Heart Sound Detected'}
                            </Text>
                            <Text style={s.resultSub}>
                                Confidence: {Math.round((heartConfidence ?? 0) * 100)}%
                                {heartBpm ? `   ·   ~${Math.round(heartBpm)} BPM` : ''}
                            </Text>
                        </View>
                        <TouchableOpacity onPress={run} style={s.rerunBtn}>
                            <Text style={s.rerunTxt}>↺</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Overall confidence bar */}
                    <View style={s.overallTrack}>
                        <View style={[s.overallFill, {
                            width: `${Math.round((heartConfidence ?? 0) * 100)}%`,
                            backgroundColor: detected ? '#16A34A' : '#DC2626',
                        }]} />
                    </View>

                    {/* 4-feature breakdown */}
                    <View style={s.featureBox}>
                        <Text style={s.featureTitle}>Feature Scores</Text>
                        <ScoreBar label="🎵 Spectral" value={spectral} color="#0A7EA4" />
                        <ScoreBar label="📵 Low HF" value={hfScore} color="#7C3AED" />
                        <ScoreBar label="💥 Transient" value={transient} color="#0F766E" />
                        <ScoreBar label="⏱ Duty Cyc" value={duty} color="#B45309" />
                    </View>

                    {/* Diagnostic chips */}
                    <View style={s.chipRow}>
                        <View style={s.chip}>
                            <Text style={s.chipKey}>Centroid</Text>
                            <Text style={[s.chipVal,
                            (centroidHz ?? 0) > 130 && { color: '#DC2626' }]}>
                                {centroidHz != null ? `${Math.round(centroidHz)} Hz` : '—'}
                            </Text>
                        </View>
                        <View style={s.chip}>
                            <Text style={s.chipKey}>HF Energy</Text>
                            <Text style={[s.chipVal,
                            (hfRatio ?? 0) > 0.22 && { color: '#DC2626' }]}>
                                {hfRatio != null ? `${Math.round(hfRatio * 100)}%` : '—'}
                            </Text>
                        </View>
                        <View style={s.chip}>
                            <Text style={s.chipKey}>Bursts</Text>
                            <Text style={[s.chipVal,
                            (nTransients ?? 0) < 2 && { color: '#DC2626' }]}>
                                {nTransients != null ? nTransients : '—'}
                            </Text>
                        </View>
                        <View style={s.chip}>
                            <Text style={s.chipKey}>Active</Text>
                            <Text style={[s.chipVal,
                            (activeFraction ?? 0) > 0.55 && { color: '#DC2626' }]}>
                                {activeFraction != null
                                    ? `${Math.round(activeFraction * 100)}%` : '—'}
                            </Text>
                        </View>
                    </View>

                    {/* Rejection reason (only when not detected) */}
                    {!detected && rejectionReason && (
                        <View style={s.rejectionBox}>
                            <Text style={s.rejectionTitle}>Why not detected:</Text>
                            <Text style={s.rejectionTxt}>{rejectionReason}</Text>
                        </View>
                    )}

                    {/* Murmur card (only when heart detected) */}
                    {detected && murmurDetected && murmurType && (
                        <MurmurCard type={murmurType} confidence={murmurConfidence ?? 0} />
                    )}

                    {/* No murmur note */}
                    {detected && !murmurDetected && (
                        <View style={s.noMurmurRow}>
                            <Text style={s.noMurmurTxt}>✅  No murmur detected</Text>
                        </View>
                    )}

                </LinearGradient>
            )}
        </View>
    );
});

const s = StyleSheet.create({
    wrap: { marginVertical: 8 },
    runBtn: { borderRadius: 12, overflow: 'hidden' },
    runBtnGrad: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        paddingVertical: 14, borderRadius: 12
    },
    runBtnTxt: { color: '#FFF', fontSize: 15, fontWeight: '700' },
    spinRow: { flexDirection: 'row', alignItems: 'center', padding: 12 },
    spinTxt: { color: '#0A7EA4', fontSize: 14 },
    errorCard: {
        backgroundColor: '#FEE2E2', borderRadius: 10, padding: 12,
        flexDirection: 'row', alignItems: 'center'
    },
    errorTxt: { flex: 1, color: '#991B1B', fontSize: 13 },
    retryBtn: {
        paddingHorizontal: 12, paddingVertical: 6,
        backgroundColor: '#DC2626', borderRadius: 8
    },
    retryTxt: { color: '#FFF', fontWeight: '700', fontSize: 13 },
    resultCard: { borderRadius: 16, padding: 16 },
    resultHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    resultEmoji: { fontSize: 28, marginRight: 10 },
    resultTitle: { fontSize: 16, fontWeight: '800' },
    resultSub: { fontSize: 12, color: '#6B7280', marginTop: 2 },
    rerunBtn: { padding: 8 },
    rerunTxt: { fontSize: 20, color: '#6B7280' },
    overallTrack: {
        height: 8, backgroundColor: 'rgba(0,0,0,0.10)',
        borderRadius: 4, marginBottom: 14, overflow: 'hidden'
    },
    overallFill: { height: 8, borderRadius: 4 },
    featureBox: {
        backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 10,
        padding: 12, marginBottom: 10
    },
    featureTitle: {
        fontSize: 11, fontWeight: '800', color: '#374151',
        textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
    chip: {
        backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 8,
        paddingVertical: 4, paddingHorizontal: 10, alignItems: 'center',
        minWidth: 66
    },
    chipKey: { fontSize: 10, color: '#6B7280', fontWeight: '600' },
    chipVal: { fontSize: 13, color: '#1F2937', fontWeight: '800' },
    rejectionBox: {
        backgroundColor: 'rgba(220,38,38,0.08)', borderRadius: 8,
        padding: 10, marginTop: 4
    },
    rejectionTitle: { fontSize: 11, fontWeight: '800', color: '#991B1B', marginBottom: 3 },
    rejectionTxt: { fontSize: 12, color: '#7F1D1D', lineHeight: 17 },
    noMurmurRow: {
        marginTop: 10, paddingVertical: 8, paddingHorizontal: 12,
        backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 8,
        alignItems: 'center'
    },
    noMurmurTxt: { fontSize: 13, color: '#166534', fontWeight: '700' },
});

export default HeartDetectionBanner;