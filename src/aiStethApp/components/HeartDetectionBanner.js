// src/aiStethApp/components/HeartDetectionBanner.js  v2
//
// Shows the 4-feature breakdown from the v2 detector:
//   - Spectral score   (low centroid + low HF energy)
//   - Transient score  (S1/S2 burst detection)
//   - Duty score       (low duty cycle = bursts not continuous)
//   - ZCR score        (low zero-crossing rate in heart band)
//
// Also shows centroid_hz and hf_ratio as diagnostic info.

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
} from '../../store/slices/SeparationSlice';

// We store the extra v2 fields in the same slice — add these selectors
// (add them to SeparationSlice.js as shown at the bottom of this file)
import {
    selectHeartSpectralScore,
    selectHeartTransientScore,
    selectHeartDutyScore,
    selectHeartZcrScore,
    selectHeartNTransients,
    selectHeartHfRatio,
    selectHeartCentroidHz,
    selectHeartDetectError,
} from '../../store/slices/SeparationSlice';

// ── Mini score bar ────────────────────────────────────────────────────────────
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
    row:   { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    label: { width: 80, fontSize: 11, color: '#4A5568', fontWeight: '600' },
    track: { flex: 1, height: 8, backgroundColor: 'rgba(0,0,0,0.10)',
             borderRadius: 4, overflow: 'hidden', marginHorizontal: 6 },
    fill:  { height: 8, borderRadius: 4 },
    pct:   { width: 32, fontSize: 11, color: '#4A5568',
             fontWeight: '700', textAlign: 'right' },
});

// ── Main banner ───────────────────────────────────────────────────────────────
export const HeartDetectionBanner = memo(({ heartBase64, sampleRate = 4000 }) => {
    const dispatch        = useDispatch();
    const isDetecting     = useSelector(selectIsDetectingHeart);
    const heartDetected   = useSelector(selectHeartDetected);
    const heartConfidence = useSelector(selectHeartConfidence);
    const heartBpm        = useSelector(selectHeartBpm);
    const spectral        = useSelector(selectHeartSpectralScore);
    const transient       = useSelector(selectHeartTransientScore);
    const duty            = useSelector(selectHeartDutyScore);
    const zcr             = useSelector(selectHeartZcrScore);
    const nTransients     = useSelector(selectHeartNTransients);
    const hfRatio         = useSelector(selectHeartHfRatio);
    const centroidHz      = useSelector(selectHeartCentroidHz);
    const detectError     = useSelector(selectHeartDetectError);

    const run = useCallback(() => {
        if (!heartBase64) return;
        dispatch(detectHeartThunk({ base64Audio: heartBase64, sampleRate }));
    }, [heartBase64, sampleRate, dispatch]);

    if (!heartBase64) return null;

    const detected = heartDetected === true;
    const checked  = heartDetected !== null;

    return (
        <View style={styles.wrap}>

            {/* ── Run button (before first result) ───────────────────────── */}
            {!checked && !isDetecting && (
                <TouchableOpacity style={styles.runBtn} onPress={run}
                                  activeOpacity={0.85}>
                    <LinearGradient colors={['#0A7EA4', '#1A9BBF']}
                                    style={styles.runBtnGrad}
                                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                        <Text style={styles.runBtnTxt}>🔬  Detect Heart Sound</Text>
                    </LinearGradient>
                </TouchableOpacity>
            )}

            {/* ── Spinner ─────────────────────────────────────────────────── */}
            {isDetecting && (
                <View style={styles.spinRow}>
                    <ActivityIndicator size="small" color="#0A7EA4" />
                    <Text style={styles.spinTxt}>  Analysing audio features…</Text>
                </View>
            )}

            {/* ── Error ───────────────────────────────────────────────────── */}
            {detectError && !isDetecting && (
                <View style={styles.errorCard}>
                    <Text style={styles.errorTxt}>⚠️  {detectError}</Text>
                    <TouchableOpacity onPress={run} style={styles.retryBtn}>
                        <Text style={styles.retryTxt}>Retry</Text>
                    </TouchableOpacity>
                </View>
            )}

            {/* ── Result card ─────────────────────────────────────────────── */}
            {checked && !isDetecting && !detectError && (
                <LinearGradient
                    colors={detected
                        ? ['#D4F4E7', '#E6FAF0', '#F0FDF7']
                        : ['#FEE2E2', '#FEF2F2', '#FFF5F5']}
                    style={styles.resultCard}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>

                    {/* Header */}
                    <View style={styles.resultHeader}>
                        <Text style={styles.resultEmoji}>
                            {detected ? '❤️' : '🚫'}
                        </Text>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.resultTitle,
                                { color: detected ? '#166534' : '#991B1B' }]}>
                                {detected
                                    ? 'Heart Sound Detected'
                                    : 'No Heart Sound Detected'}
                            </Text>
                            <Text style={styles.resultSub}>
                                Confidence: {Math.round((heartConfidence ?? 0) * 100)}%
                                {heartBpm ? `   ·   ~${Math.round(heartBpm)} BPM` : ''}
                            </Text>
                        </View>
                        {/* Re-run */}
                        <TouchableOpacity onPress={run} style={styles.rerunBtn}>
                            <Text style={styles.rerunTxt}>↺</Text>
                        </TouchableOpacity>
                    </View>

                    {/* Overall confidence bar */}
                    <View style={styles.overallTrack}>
                        <View style={[styles.overallFill, {
                            width: `${Math.round((heartConfidence ?? 0) * 100)}%`,
                            backgroundColor: detected ? '#16A34A' : '#DC2626',
                        }]} />
                    </View>

                    {/* ── 4-feature breakdown ───────────────────────────── */}
                    <View style={styles.featureSection}>
                        <Text style={styles.featureTitle}>Feature Breakdown</Text>
                        <ScoreBar label="🎵 Spectral"  value={spectral}   color="#0A7EA4" />
                        <ScoreBar label="💥 Transient" value={transient}  color="#7C3AED" />
                        <ScoreBar label="⏱ Duty Cyc"  value={duty}       color="#0F766E" />
                        <ScoreBar label="〰 ZCR"       value={zcr}        color="#B45309" />
                    </View>

                    {/* ── Diagnostic info ───────────────────────────────── */}
                    <View style={styles.diagRow}>
                        <View style={styles.diagChip}>
                            <Text style={styles.diagKey}>Centroid</Text>
                            <Text style={styles.diagVal}>
                                {centroidHz != null ? `${Math.round(centroidHz)} Hz` : '—'}
                            </Text>
                        </View>
                        <View style={styles.diagChip}>
                            <Text style={styles.diagKey}>HF ratio</Text>
                            <Text style={[styles.diagVal,
                                (hfRatio ?? 0) > 0.15 && { color: '#DC2626' }]}>
                                {hfRatio != null ? `${Math.round(hfRatio * 100)}%` : '—'}
                            </Text>
                        </View>
                        <View style={styles.diagChip}>
                            <Text style={styles.diagKey}>Bursts</Text>
                            <Text style={styles.diagVal}>
                                {nTransients != null ? nTransients : '—'}
                            </Text>
                        </View>
                        {heartBpm && (
                            <View style={styles.diagChip}>
                                <Text style={styles.diagKey}>BPM</Text>
                                <Text style={styles.diagVal}>{Math.round(heartBpm)}</Text>
                            </View>
                        )}
                    </View>

                    {/* ── Explanation text ─────────────────────────────── */}
                    <Text style={styles.explanationTxt}>
                        {detected
                            ? `Detected ${nTransients ?? 0} short S1/S2-like bursts with a ` +
                              `spectral centroid of ${Math.round(centroidHz ?? 0)} Hz ` +
                              `(heart sounds are typically < 120 Hz). ` +
                              `Only ${Math.round((hfRatio ?? 0) * 100)}% of energy is above 500 Hz ` +
                              `(voice typically > 25%).`
                            : `Spectral centroid at ${Math.round(centroidHz ?? 0)} Hz is too high ` +
                              `(heart sounds < 120 Hz), or ${Math.round((hfRatio ?? 0) * 100)}% ` +
                              `of energy is above 500 Hz (voice/noise indicator), ` +
                              `or no distinct short S1/S2 bursts were found (${nTransients ?? 0} detected).`
                        }
                    </Text>
                </LinearGradient>
            )}
        </View>
    );
});

const styles = StyleSheet.create({
    wrap:          { marginVertical: 8 },

    runBtn:        { borderRadius: 12, overflow: 'hidden' },
    runBtnGrad:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                     paddingVertical: 14, borderRadius: 12 },
    runBtnTxt:     { color: '#FFF', fontSize: 15, fontWeight: '700' },

    spinRow:       { flexDirection: 'row', alignItems: 'center', padding: 12 },
    spinTxt:       { color: '#0A7EA4', fontSize: 14 },

    errorCard:     { backgroundColor: '#FEE2E2', borderRadius: 10, padding: 12,
                     flexDirection: 'row', alignItems: 'center' },
    errorTxt:      { flex: 1, color: '#991B1B', fontSize: 13 },
    retryBtn:      { paddingHorizontal: 12, paddingVertical: 6,
                     backgroundColor: '#DC2626', borderRadius: 8 },
    retryTxt:      { color: '#FFF', fontWeight: '700', fontSize: 13 },

    resultCard:    { borderRadius: 16, padding: 16 },
    resultHeader:  { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
    resultEmoji:   { fontSize: 28, marginRight: 10 },
    resultTitle:   { fontSize: 16, fontWeight: '800' },
    resultSub:     { fontSize: 12, color: '#6B7280', marginTop: 2 },
    rerunBtn:      { padding: 8 },
    rerunTxt:      { fontSize: 20, color: '#6B7280' },

    overallTrack:  { height: 8, backgroundColor: 'rgba(0,0,0,0.10)',
                     borderRadius: 4, marginBottom: 14, overflow: 'hidden' },
    overallFill:   { height: 8, borderRadius: 4 },

    featureSection:{ backgroundColor: 'rgba(255,255,255,0.55)', borderRadius: 10,
                     padding: 12, marginBottom: 10 },
    featureTitle:  { fontSize: 11, fontWeight: '800', color: '#374151',
                     textTransform: 'uppercase', letterSpacing: 0.6,
                     marginBottom: 10 },

    diagRow:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
    diagChip:      { backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 8,
                     paddingVertical: 4, paddingHorizontal: 10, alignItems: 'center' },
    diagKey:       { fontSize: 10, color: '#6B7280', fontWeight: '600' },
    diagVal:       { fontSize: 13, color: '#1F2937', fontWeight: '800' },

    explanationTxt:{ fontSize: 12, color: '#374151', lineHeight: 17,
                     backgroundColor: 'rgba(255,255,255,0.4)',
                     borderRadius: 8, padding: 10 },
});

export default HeartDetectionBanner;

/*
 ═══════════════════════════════════════════════════════════════════
  ADD THESE to SeparationSlice.js (extraReducers detectHeartThunk.fulfilled)
  and as new selectors at the bottom of the file:
 ═══════════════════════════════════════════════════════════════════

  // In initial state, add:
  heartSpectralScore:  null,
  heartTransientScore: null,
  heartDutyScore:      null,
  heartZcrScore:       null,
  heartNTransients:    null,
  heartHfRatio:        null,
  heartCentroidHz:     null,

  // In detectHeartThunk.fulfilled handler, add:
  s.heartSpectralScore  = p.spectralScore;
  s.heartTransientScore = p.transientScore;
  s.heartDutyScore      = p.dutyScore;
  s.heartZcrScore       = p.zcrScore;
  s.heartNTransients    = p.nTransients;
  s.heartHfRatio        = p.hfRatio;
  s.heartCentroidHz     = p.centroidHz;

  // In detectHeartThunk (thunk function), update return to include:
  return {
    heartDetected:     r.heartDetected,
    heartConfidence:   r.confidence,
    heartBpm:          r.dominantBpm,
    heartEnergyRatio:  r.energyRatio,     // kept for back-compat
    heartPeriodicity:  r.periodicity,     // kept for back-compat
    spectralScore:     r.spectral_score,
    transientScore:    r.transient_score,
    dutyScore:         r.duty_score,
    zcrScore:          r.zcr_score,
    nTransients:       r.n_transients,
    hfRatio:           r.hf_ratio,
    centroidHz:        r.centroid_hz,
  };

  // New selectors:
  export const selectHeartSpectralScore  = s => s.separation.heartSpectralScore;
  export const selectHeartTransientScore = s => s.separation.heartTransientScore;
  export const selectHeartDutyScore      = s => s.separation.heartDutyScore;
  export const selectHeartZcrScore       = s => s.separation.heartZcrScore;
  export const selectHeartNTransients    = s => s.separation.heartNTransients;
  export const selectHeartHfRatio        = s => s.separation.heartHfRatio;
  export const selectHeartCentroidHz     = s => s.separation.heartCentroidHz;
*/
