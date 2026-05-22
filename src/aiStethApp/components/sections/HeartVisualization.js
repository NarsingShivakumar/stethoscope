/**
 * HeartVisualization.js
 * ======================
 * Animated cardiac visualization component for the Stethoscope app.
 *
 * Features:
 *  - Real-time SVG waveform drawn from the base64 separated heart audio
 *  - Animated beating heart icon (pulse scales with BPM)
 *  - Confidence ring (SVG arc)
 *  - 4-feature score bars (Spectral / Low-HF / Transient / Duty Cycle)
 *  - Murmur type badge with colour coding
 *  - "No Heart Sound" dead-flat EKG line state
 *  - Runs entirely on JS-side Animated API (no Reanimated required)
 *  - Zero new native dependencies — uses only:
 *      react-native-svg  (already used in RN projects)
 *      react-native-linear-gradient  (already imported in your codebase)
 *
 * Usage:
 *   import HeartVisualization from './HeartVisualization';
 *
 *   <HeartVisualization
 *     heartBase64={heartWav}      // base64 WAV string from SeparationSlice
 *     sampleRate={44100}
 *   />
 *
 * The component reads all detection state directly from Redux, so it can be
 * dropped anywhere without prop-drilling.
 */

import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient as SvgLinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { useDispatch, useSelector } from 'react-redux';

import { APPCOLORS } from '../../../assets/colors';
import { BORDERRADIUS, FONTS, SHADOWS, SPACING } from '../../constants/theme';
import {
  detectHeartThunk,
  selectHeartActiveFraction,
  selectHeartBpm,
  selectHeartCentroidHz,
  selectHeartConfidence,
  selectHeartDetectError,
  selectHeartDutyScore,
  selectHeartHfRatio,
  selectHeartHfScore,
  selectHeartNTransients,
  selectHeartRejectionReason,
  selectHeartSpectralScore,
  selectHeartTransientScore,
  selectIsDetectingHeart,
  selectMurmurConfidence,
  selectMurmurDetected,
  selectMurmurType,
  selectHeartDetected,
} from '../../../store/slices/SeparationSlice';
// import { BORDER_RADIUS, SPACING } from '../../constants/theme';

// ─────────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────────

const WAVE_W        = 320;
const WAVE_H        = 90;
const RING_SIZE     = 120;
const RING_R        = 50;
const RING_STROKE   = 8;
const RING_CIRCUM   = 2 * Math.PI * RING_R;
const DEFAULT_BPM   = 72;

const MURMUR_META = {
  systolic:   { label: 'Systolic Murmur',    icon: '🔴', color: '#9F1239', bg: ['#FFF1F2','#FFE4E6'] },
  diastolic:  { label: 'Diastolic Murmur',   icon: '🟠', color: '#9A3412', bg: ['#FFF7ED','#FFEDD5'] },
  continuous: { label: 'Continuous Murmur',  icon: '🟡', color: '#854D0E', bg: ['#FEFCE8','#FEF9C3'] },
  benign:     { label: 'Benign / Functional',icon: '🟢', color: '#166534', bg: ['#F0FDF4','#DCFCE7'] },
};

// ─────────────────────────────────────────────────────────────────────────────
//  Waveform builder  (decode a slice of PCM from base64, downsample to points)
// ─────────────────────────────────────────────────────────────────────────────

/** Convert base64 string → Uint8Array (RN-safe, no Buffer/atob needed) */
const b64ToUint8 = b64 => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const map   = {};
  for (let i = 0; i < chars.length; i++) map[chars[i]] = i;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((b64.length * 3) / 4 - pad);
  let p = 0;
  for (let i = 0; i < b64.length; i += 4) {
    const a = map[b64[i]], b = map[b64[i+1]], c = map[b64[i+2]], d = map[b64[i+3]];
    out[p++] = (a << 2) | (b >> 4);
    if (c !== undefined && b64[i+2] !== '=') out[p++] = ((b & 0xf) << 4) | (c >> 2);
    if (d !== undefined && b64[i+3] !== '=') out[p++] = ((c & 0x3) << 6) | d;
  }
  return out;
};

/**
 * Build an SVG path string from base64 WAV audio.
 * Reads up to the first 4 s of PCM-16 LE mono, downsamples to `nPoints`.
 */
const buildWavePath = (base64, nPoints = 120) => {
  try {
    const bytes = b64ToUint8(base64);
    // WAV header is 44 bytes; skip it
    const start   = 44;
    const maxSamp = Math.min(Math.floor((bytes.length - start) / 2), 4 * 44100);
    if (maxSamp < nPoints * 2) return null;

    const step    = Math.floor(maxSamp / nPoints);
    const samples = [];
    for (let i = 0; i < nPoints; i++) {
      const off  = start + i * step * 2;
      // PCM-16 little-endian signed
      let val  = bytes[off] | (bytes[off + 1] << 8);
      if (val > 32767) val -= 65536;
      samples.push(val / 32768);
    }

    // Normalise
    const peak = Math.max(...samples.map(Math.abs), 0.001);
    const norm = samples.map(v => v / peak);

    // Map to SVG coords
    const xStep = WAVE_W / (nPoints - 1);
    const mid   = WAVE_H / 2;
    const amp   = (WAVE_H / 2) * 0.85;

    const pts = norm.map((v, i) => ({
      x: i * xStep,
      y: mid - v * amp,
    }));

    // Smooth cardinal spline → cubic bezier
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  } catch {
    return null;
  }
};

/** Flat EKG line for "no heart sound" state */
const flatPath = () => {
  const mid = WAVE_H / 2;
  return `M 0 ${mid} L ${WAVE_W} ${mid}`;
};

/** Synthetic EKG spike used while audio has not loaded yet */
const ekgPath = () => {
  const m  = WAVE_H / 2;
  const a  = WAVE_H * 0.40;
  const xm = WAVE_W / 2;
  return [
    `M 0 ${m}`,
    `L ${xm - 50} ${m}`,
    `L ${xm - 30} ${m + a * 0.3}`,
    `L ${xm - 15} ${m - a}`,
    `L ${xm}      ${m + a * 0.5}`,
    `L ${xm + 15} ${m}`,
    `L ${xm + 35} ${m - a * 0.25}`,
    `L ${xm + 50} ${m}`,
    `L ${WAVE_W}  ${m}`,
  ].join(' ');
};

// ─────────────────────────────────────────────────────────────────────────────
//  Sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Animated waveform SVG */
const WaveformGraph = memo(({ pathD, detected, animProg }) => {
  // animProg Animated.Value 0→1 drives the strokeDashoffset reveal
  const pathLen = WAVE_W * 3; // overestimate; SVG clips correctly

  return (
    <View style={ws.wrap}>
      <Svg width={WAVE_W} height={WAVE_H} viewBox={`0 0 ${WAVE_W} ${WAVE_H}`}>
        <Defs>
          <SvgLinearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0"   stopColor={detected ? '#0A7EA4' : '#DC2626'} stopOpacity="0.3" />
            <Stop offset="0.5" stopColor={detected ? '#16A34A' : '#EF4444'} stopOpacity="1.0" />
            <Stop offset="1"   stopColor={detected ? '#0A7EA4' : '#DC2626'} stopOpacity="0.3" />
          </SvgLinearGradient>
          {/* Grid lines */}
          {[0.25, 0.5, 0.75].map(f => (
            <Line
              key={f}
              x1={0} y1={WAVE_H * f}
              x2={WAVE_W} y2={WAVE_H * f}
              stroke="rgba(0,0,0,0.06)"
              strokeWidth={1}
            />
          ))}
        </Defs>

        {/* Grid horizontal lines */}
        {[0.25, 0.5, 0.75].map(f => (
          <Line
            key={f}
            x1={0} y1={WAVE_H * f}
            x2={WAVE_W} y2={WAVE_H * f}
            stroke="rgba(0,0,0,0.07)"
            strokeWidth={1}
          />
        ))}
        {/* Grid vertical lines */}
        {[0.2, 0.4, 0.6, 0.8].map(f => (
          <Line
            key={f}
            x1={WAVE_W * f} y1={0}
            x2={WAVE_W * f} y2={WAVE_H}
            stroke="rgba(0,0,0,0.05)"
            strokeWidth={1}
          />
        ))}

        {/* Waveform */}
        <Path
          d={pathD}
          fill="none"
          stroke="url(#waveGrad)"
          strokeWidth={detected ? 2.5 : 1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={`${pathLen}`}
          strokeDashoffset={`${pathLen}`}
          // Note: animated strokeDashoffset is set via AnimatedPath workaround below
        />
      </Svg>
    </View>
  );
});
const ws = StyleSheet.create({
  wrap: { overflow: 'hidden', borderRadius: 8 },
});

// Animated wrapper — react-native-svg doesn't expose Animated.createAnimatedComponent
// cleanly for Path on all RN versions, so we drive the reveal via JS re-render.
const AnimatedWaveform = memo(({ pathD, detected }) => {
  const [revealedPath, setRevealedPath] = useState('');
  const points = useRef([]);

  useEffect(() => {
    if (!pathD) { setRevealedPath(flatPath()); return; }

    // Parse path to reveal gradually
    const segments = pathD.split(/(?=[MC])/g);
    let built = '';
    let idx   = 0;
    const total = segments.length;
    const interval = setInterval(() => {
      if (idx >= total) { clearInterval(interval); return; }
      built += segments[idx];
      setRevealedPath(built);
      idx++;
    }, 12);
    return () => clearInterval(interval);
  }, [pathD]);

  return <WaveformGraph pathD={revealedPath || flatPath()} detected={detected} />;
});

// ── Confidence Ring ───────────────────────────────────────────────────────────
const ConfidenceRing = memo(({ confidence, detected, bpm }) => {
  const dashOffset = RING_CIRCUM * (1 - (confidence ?? 0));
  const color      = detected ? '#16A34A' : '#DC2626';
  const pct        = Math.round((confidence ?? 0) * 100);

  return (
    <View style={cr.wrap}>
      <Svg width={RING_SIZE} height={RING_SIZE}
           viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
        {/* Track */}
        <Circle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
          fill="none"
          stroke="rgba(0,0,0,0.10)"
          strokeWidth={RING_STROKE}
        />
        {/* Progress */}
        <Circle
          cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R}
          fill="none"
          stroke={color}
          strokeWidth={RING_STROKE}
          strokeDasharray={`${RING_CIRCUM}`}
          strokeDashoffset={`${dashOffset}`}
          strokeLinecap="round"
          rotation="-90"
          origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}
        />
      </Svg>
      {/* Centre label */}
      <View style={cr.centre}>
        <Text style={[cr.pct, { color }]}>{pct}%</Text>
        <Text style={cr.lbl}>conf</Text>
      </View>
    </View>
  );
});
const cr = StyleSheet.create({
  wrap:   { width: RING_SIZE, height: RING_SIZE, alignItems: 'center',
            justifyContent: 'center' },
  centre: { ...StyleSheet.absoluteFillObject, alignItems: 'center',
            justifyContent: 'center' },
  pct:    { fontSize: 22, fontWeight: '900', lineHeight: 26 },
  lbl:    { fontSize: 10, color: '#6B7280', fontWeight: '700',
            textTransform: 'uppercase', letterSpacing: 0.8 },
});

// ── Beating Heart Icon ────────────────────────────────────────────────────────
const BeatingHeart = memo(({ detected, bpm }) => {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim  = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!detected) { scaleAnim.setValue(1); glowAnim.setValue(0); return; }
    const interval = Math.max(300, Math.min(1600, 60000 / (bpm ?? DEFAULT_BPM)));
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.28, duration: 120,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 1, duration: 120,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.10, duration: 60,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1.22, duration: 90,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scaleAnim, {
            toValue: 1, duration: interval - 270,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(glowAnim, {
            toValue: 0, duration: interval - 270,
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [detected, bpm, scaleAnim, glowAnim]);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.55],
  });

  return (
    <View style={bh.wrap}>
      {/* Glow halo */}
      <Animated.View style={[bh.glow, { opacity: glowOpacity }]} />
      <Animated.Text style={[bh.icon, { transform: [{ scale: scaleAnim }] }]}>
        {detected ? '❤️' : '🫀'}
      </Animated.Text>
    </View>
  );
});
const bh = StyleSheet.create({
  wrap: { width: 64, height: 64, alignItems: 'center', justifyContent: 'center' },
  glow: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#FF3B30',
    borderRadius: 32,
    transform: [{ scale: 1.5 }],
  },
  icon: { fontSize: 44, lineHeight: 52 },
});

// ── Feature Score Bar ─────────────────────────────────────────────────────────
const FeatureBar = memo(({ label, emoji, value, color, maxVal = 1 }) => {
  const widthAnim = useRef(new Animated.Value(0)).current;
  const pct       = Math.round(((value ?? 0) / maxVal) * 100);

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: pct, duration: 900,
      easing: Easing.out(Easing.expo),
      useNativeDriver: false,
    }).start();
  }, [pct, widthAnim]);

  return (
    <View style={fb.row}>
      <Text style={fb.emoji}>{emoji}</Text>
      <Text style={fb.label}>{label}</Text>
      <View style={fb.track}>
        <Animated.View style={[fb.fill, {
          width: widthAnim.interpolate({
            inputRange: [0, 100],
            outputRange: ['0%', '100%'],
          }),
          backgroundColor: color,
        }]} />
      </View>
      <Text style={fb.pct}>{pct}%</Text>
    </View>
  );
});
const fb = StyleSheet.create({
  row:   { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  emoji: { fontSize: 14, width: 20 },
  label: { width: 70, fontSize: 11, color: '#374151', fontWeight: '700',
           marginLeft: 4 },
  track: { flex: 1, height: 8, backgroundColor: 'rgba(0,0,0,0.09)',
           borderRadius: 4, overflow: 'hidden', marginHorizontal: 8 },
  fill:  { height: 8, borderRadius: 4 },
  pct:   { width: 32, fontSize: 11, color: '#374151',
           fontWeight: '800', textAlign: 'right' },
});

// ── Diagnostic Chip ───────────────────────────────────────────────────────────
const DiagChip = memo(({ label, value, warn }) => (
  <View style={[dc.chip, warn && dc.chipWarn]}>
    <Text style={dc.key}>{label}</Text>
    <Text style={[dc.val, warn && dc.valWarn]}>{value ?? '—'}</Text>
  </View>
));
const dc = StyleSheet.create({
  chip:     { backgroundColor: 'rgba(255,255,255,0.75)', borderRadius: 10,
              paddingVertical: 5, paddingHorizontal: 10, alignItems: 'center',
              minWidth: 68, margin: 3 },
  chipWarn: { backgroundColor: 'rgba(220,38,38,0.08)' },
  key:      { fontSize: 9, color: '#6B7280', fontWeight: '700',
              textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  val:      { fontSize: 14, color: '#1F2937', fontWeight: '800' },
  valWarn:  { color: '#DC2626' },
});

// ── Murmur Badge ──────────────────────────────────────────────────────────────
const MurmurBadge = memo(({ type, confidence }) => {
  const info = MURMUR_META[type];
  if (!info) return null;
  const pct  = Math.round((confidence ?? 0) * 100);

  return (
    <LinearGradient colors={info.bg} style={mb.card}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
      <View style={mb.header}>
        <Text style={mb.icon}>{info.icon}</Text>
        <View style={{ flex: 1 }}>
          <Text style={[mb.title, { color: info.color }]}>{info.label}</Text>
          <Text style={mb.conf}>Confidence: {pct}%</Text>
        </View>
      </View>
      <View style={mb.track}>
        <View style={[mb.fill, {
          width: `${pct}%`,
          backgroundColor: info.color,
        }]} />
      </View>
      <Text style={mb.note}>{MURMUR_NOTES[type]}</Text>
    </LinearGradient>
  );
});
const MURMUR_NOTES = {
  systolic:   'Between S1 → S2. May indicate aortic stenosis, mitral regurgitation, pulmonic stenosis, or VSD.',
  diastolic:  'Between S2 → S1. May indicate aortic insufficiency or mitral stenosis.',
  continuous: 'Spans both systole and diastole. May indicate patent ductus arteriosus (PDA).',
  benign:     'Soft, brief systolic murmur. Common in children/young adults; typically no structural significance.',
};
const mb = StyleSheet.create({
  card:   { borderRadius: 12, padding: 14, marginTop: 8 },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  icon:   { fontSize: 26, marginRight: 10 },
  title:  { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  conf:   { fontSize: 11, color: '#6B7280' },
  track:  { height: 6, backgroundColor: 'rgba(0,0,0,0.10)',
            borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  fill:   { height: 6, borderRadius: 3 },
  note:   { fontSize: 11, color: '#374151', lineHeight: 16 },
});

// ─────────────────────────────────────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────────────────────────────────────

const HeartVisualization = memo(({ heartBase64, sampleRate = 44100 }) => {
  const dispatch = useDispatch();

  // Redux state
  const isDetecting      = useSelector(selectIsDetectingHeart);
  const heartDetected    = useSelector(selectHeartDetected);
  const confidence       = useSelector(selectHeartConfidence);
  const bpm              = useSelector(selectHeartBpm);
  const spectral         = useSelector(selectHeartSpectralScore);
  const hfScore          = useSelector(selectHeartHfScore);
  const transient        = useSelector(selectHeartTransientScore);
  const duty             = useSelector(selectHeartDutyScore);
  const centroidHz       = useSelector(selectHeartCentroidHz);
  const hfRatio          = useSelector(selectHeartHfRatio);
  const nTransients      = useSelector(selectHeartNTransients);
  const activeFraction   = useSelector(selectHeartActiveFraction);
  const rejectionReason  = useSelector(selectHeartRejectionReason);
  const detectError      = useSelector(selectHeartDetectError);
  const murmurDetected   = useSelector(selectMurmurDetected);
  const murmurType       = useSelector(selectMurmurType);
  const murmurConfidence = useSelector(selectMurmurConfidence);

  // Local state
  const [wavePath, setWavePath] = useState(null);
  const [expanded, setExpanded] = useState(false);

  // Entrance animation
  const cardAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;

  // Scan-line animation (active while detecting)
  const scanAnim  = useRef(new Animated.Value(0)).current;
  const scanRef   = useRef(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardAnim, {
        toValue: 1, duration: 600,
        easing: Easing.out(Easing.exp),
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0, tension: 35, friction: 8,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  // Build waveform from audio
  useEffect(() => {
    if (!heartBase64) return;
    // Offload to next tick so UI stays responsive
    const id = setTimeout(() => {
      const p = buildWavePath(heartBase64);
      setWavePath(p ?? ekgPath());
    }, 50);
    return () => clearTimeout(id);
  }, [heartBase64]);

  // Scan line while detecting
  useEffect(() => {
    if (isDetecting) {
      scanRef.current = Animated.loop(
        Animated.timing(scanAnim, {
          toValue: 1, duration: 1800,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      );
      scanRef.current.start();
    } else {
      scanRef.current?.stop();
      scanAnim.setValue(0);
    }
    return () => scanRef.current?.stop();
  }, [isDetecting, scanAnim]);

  // Auto-run detection when audio arrives and not yet run
  useEffect(() => {
    if (heartBase64 && heartDetected === null && !isDetecting) {
      dispatch(detectHeartThunk({ base64Audio: heartBase64, sampleRate }));
    }
  }, [heartBase64, heartDetected, isDetecting, sampleRate, dispatch]);

  const handleRerun = useCallback(() => {
    if (!heartBase64 || isDetecting) return;
    dispatch(detectHeartThunk({ base64Audio: heartBase64, sampleRate }));
  }, [heartBase64, isDetecting, sampleRate, dispatch]);

  const checked  = heartDetected !== null;
  const detected = heartDetected === true;

  // Card gradient
  const cardGrad = detected
    ? ['#E8FFF3', '#F0FDF7', '#FFFFFF']
    : checked
      ? ['#FEF2F2', '#FFF5F5', '#FFFFFF']
      : ['#EFF6FF', '#F5FAFF', '#FFFFFF'];

  const scanX = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-WAVE_W, WAVE_W],
  });

  return (
    <Animated.View style={[
      s.card,
      {
        opacity:   cardAnim,
        transform: [{ translateY: slideAnim }],
      },
    ]}>
      <LinearGradient colors={cardGrad} style={s.gradient}
                      start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}>

        {/* ── Top Row: Heart icon + Ring + Status label ── */}
        <View style={s.topRow}>
          <BeatingHeart detected={detected} bpm={bpm} />

          <View style={s.statusCol}>
            {/* Status label */}
            <Text style={[s.statusLabel,
              { color: detected ? '#166534' : checked ? '#991B1B' : '#1E40AF' }]}>
              {isDetecting
                ? 'Analysing…'
                : !checked
                  ? 'Heart Analysis'
                  : detected
                    ? '❤️  Heart Sound Detected'
                    : '🚫  No Heart Sound'}
            </Text>

            {/* BPM subtitle */}
            {detected && bpm && (
              <Text style={s.bpmLabel}>~{Math.round(bpm)} BPM</Text>
            )}

            {/* Rejection reason */}
            {!detected && checked && rejectionReason && (
              <Text style={s.rejLabel} numberOfLines={2}>{rejectionReason}</Text>
            )}
          </View>

          <View style={s.ringWrap}>
            <ConfidenceRing
              confidence={confidence}
              detected={detected}
              bpm={bpm}
            />
          </View>
        </View>

        {/* ── Waveform ── */}
        <View style={s.waveWrap}>
          <LinearGradient
            colors={detected
              ? ['rgba(10,126,164,0.08)','rgba(22,163,74,0.05)']
              : ['rgba(220,38,38,0.06)','rgba(239,68,68,0.03)']}
            style={s.waveCard}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>

            {/* Scan line overlay */}
            {isDetecting && (
              <Animated.View style={[s.scanLine,
                { transform: [{ translateX: scanX }] }]} />
            )}

            <AnimatedWaveform
              pathD={wavePath ?? (detected ? ekgPath() : flatPath())}
              detected={detected}
            />

            {/* S1 / S2 markers (only when BPM known) */}
            {detected && bpm && wavePath && (
              <View style={s.markerRow}>
                <View style={[s.markerDot, { backgroundColor: '#0A7EA4' }]} />
                <Text style={s.markerTxt}>S1</Text>
                <View style={s.markerSpacer} />
                <View style={[s.markerDot, { backgroundColor: '#16A34A' }]} />
                <Text style={s.markerTxt}>S2</Text>
              </View>
            )}
          </LinearGradient>
        </View>

        {/* ── Feature Scores ── */}
        {checked && (
          <View style={s.featureBox}>
            <Text style={s.sectionTitle}>Feature Scores</Text>
            <FeatureBar label="Spectral"  emoji="🎵" value={spectral}  color="#0A7EA4" />
            <FeatureBar label="Low-HF"    emoji="📵" value={hfScore}   color="#7C3AED" />
            <FeatureBar label="Transient" emoji="💥" value={transient} color="#0F766E" />
            <FeatureBar label="Duty Cyc"  emoji="⏱" value={duty}      color="#B45309" />
          </View>
        )}

        {/* ── Diagnostic Chips ── */}
        {checked && (
          <View style={s.chipsSection}>
            <Text style={s.sectionTitle}>Diagnostics</Text>
            <View style={s.chipRow}>
              <DiagChip
                label="Centroid"
                value={centroidHz != null ? `${Math.round(centroidHz)} Hz` : null}
                warn={(centroidHz ?? 0) > 130}
              />
              <DiagChip
                label="HF Energy"
                value={hfRatio != null ? `${Math.round(hfRatio * 100)}%` : null}
                warn={(hfRatio ?? 0) > 0.22}
              />
              <DiagChip
                label="S1/S2 Bursts"
                value={nTransients}
                warn={(nTransients ?? 0) < 2}
              />
              <DiagChip
                label="Active"
                value={activeFraction != null ? `${Math.round(activeFraction * 100)}%` : null}
                warn={(activeFraction ?? 0) > 0.55}
              />
            </View>
          </View>
        )}

        {/* ── Murmur Section ── */}
        {detected && (
          <View style={s.murmurSection}>
            <Text style={s.sectionTitle}>Murmur Analysis</Text>
            {murmurDetected && murmurType
              ? <MurmurBadge type={murmurType} confidence={murmurConfidence ?? 0} />
              : (
                <View style={s.noMurmurRow}>
                  <Text style={s.noMurmurTxt}>✅  No murmur detected</Text>
                </View>
              )
            }
          </View>
        )}

        {/* ── Error State ── */}
        {detectError && !isDetecting && (
          <View style={s.errorBox}>
            <Text style={s.errorTxt}>⚠️  {detectError}</Text>
          </View>
        )}

        {/* ── Action Buttons ── */}
        <View style={s.actionRow}>
          {/* Re-run */}
          <TouchableOpacity
            style={[s.btn, s.btnPrimary, isDetecting && s.btnDisabled]}
            onPress={handleRerun}
            disabled={isDetecting}
            activeOpacity={0.8}>
            <LinearGradient
              colors={isDetecting
                ? ['#9CA3AF', '#D1D5DB']
                : ['#0A7EA4', '#1A9BBF']}
              style={s.btnGrad}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Text style={s.btnTxt}>
                {isDetecting ? '⏳  Analysing…' : checked ? '↺  Re-run' : '🔬  Analyse'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Expand / collapse diagnostics on small screens */}
          {checked && (
            <TouchableOpacity
              style={[s.btn, s.btnSecondary]}
              onPress={() => setExpanded(e => !e)}
              activeOpacity={0.8}>
              <Text style={s.btnSecTxt}>{expanded ? '▲ Less' : '▼ Details'}</Text>
            </TouchableOpacity>
          )}
        </View>

      </LinearGradient>
    </Animated.View>
  );
});

// ─────────────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    borderRadius: BORDER_RADIUS?.xl ?? 16,
    overflow: 'hidden',
    marginVertical: SPACING?.md ?? 8,
    ...SHADOWS?.large,
  },
  gradient: {
    borderRadius: BORDERRADIUS?.xl ?? 16,
    padding: SPACING?.lg ?? 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.85)',
  },

  // Top row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING?.md ?? 12,
    gap: SPACING?.md ?? 12,
  },
  statusCol: {
    flex: 1,
    justifyContent: 'center',
  },
  statusLabel: {
    fontSize: FONTS?.sizes?.lg ?? 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  bpmLabel: {
    fontSize: FONTS?.sizes?.sm ?? 13,
    color: '#6B7280',
    fontWeight: '700',
    marginTop: 2,
  },
  rejLabel: {
    fontSize: FONTS?.sizes?.xs ?? 11,
    color: '#991B1B',
    marginTop: 4,
    lineHeight: 15,
  },
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Waveform
  waveWrap: {
    marginBottom: SPACING?.md ?? 12,
  },
  waveCard: {
    borderRadius: 10,
    padding: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  scanLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 40,
    backgroundColor: 'rgba(10,126,164,0.18)',
    borderRadius: 4,
    zIndex: 2,
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    paddingHorizontal: 4,
  },
  markerDot: {
    width: 7, height: 7,
    borderRadius: 4,
  },
  markerTxt: {
    fontSize: 10, color: '#6B7280',
    fontWeight: '800', marginLeft: 3,
    marginRight: 8,
  },
  markerSpacer: { flex: 1 },

  // Sections
  sectionTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: SPACING?.sm ?? 8,
  },
  featureBox: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 10,
    padding: 12,
    marginBottom: SPACING?.sm ?? 8,
  },
  chipsSection: {
    marginBottom: SPACING?.sm ?? 8,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  murmurSection: {
    marginBottom: SPACING?.sm ?? 8,
  },
  noMurmurRow: {
    backgroundColor: 'rgba(22,163,74,0.10)',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  noMurmurTxt: {
    fontSize: 13, fontWeight: '700', color: '#166534',
  },
  errorBox: {
    backgroundColor: 'rgba(220,38,38,0.10)',
    borderRadius: 8,
    padding: 10,
    marginBottom: SPACING?.sm ?? 8,
  },
  errorTxt: {
    fontSize: 12, color: '#991B1B', fontWeight: '600',
  },

  // Buttons
  actionRow: {
    flexDirection: 'row',
    gap: SPACING?.sm ?? 8,
    marginTop: SPACING?.xs ?? 4,
  },
  btn: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
    height: 44,
  },
  btnPrimary: { },
  btnSecondary: {
    flex: 0,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.06)',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnDisabled: { opacity: 0.6 },
  btnGrad: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnTxt: {
    color: '#FFF',
    fontSize: FONTS?.sizes?.sm ?? 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  btnSecTxt: {
    color: '#374151',
    fontSize: 13,
    fontWeight: '700',
  },
});

export default HeartVisualization;
