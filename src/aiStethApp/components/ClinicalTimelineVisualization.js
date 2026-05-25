import React, { memo, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Svg, { Rect, Line, Circle, Path, Defs, LinearGradient, Stop } from 'react-native-svg';

const COLOR = {
    brady: '#F7C948',
    normal: '#8BC34A',
    mildTachy: '#F97316',
    tachy: '#EF4444',
    systole: '#F8C6C6',
    diastole: '#BFD3FF',
    murmurSys: '#B82FE6',
    murmurDia: '#8B4513',
    noise: '#D1D5DB',
    s1: '#EF4444',
    s2: '#7C3AED',
    playhead: '#DC2626',
    waveform: '#1D4ED8',
    grid: '#D1D5DB',
    text: '#334155',
};

export const getColor = (type, subtype) => {
    switch (type) {
        case 'systole':
            return COLOR.systole;
        case 'diastole':
            return COLOR.diastole;
        case 'murmur':
            if (subtype === 'midsystolic') return COLOR.murmurSys;
            if (subtype === 'holosystolic') return '#9333EA';
            if (subtype === 'early_diastolic') return COLOR.murmurDia;
            return '#C084FC';
        case 'noise':
            return COLOR.noise;
        case 'lung':
            return '#33CC66';
        default:
            return '#E5E7EB';
    }
};

const LegendChip = ({ color, label, dot = false }) => (
    <View style={styles.legendChip}>
        <View style={[dot ? styles.legendDot : styles.legendBox, { backgroundColor: color }]} />
        <Text style={styles.legendLabel}>{label}</Text>
    </View>
);

const buildWavePathFromTimeline = (timeline, durationMs, width, plotTop, plotHeight) => {
    const total = Math.max(durationMs || 1, 1);
    const points = 120;
    const mid = plotTop + plotHeight / 2;
    const amp = plotHeight * 0.42;

    const series = [];
    for (let i = 0; i <= points; i++) {
        const ms = (i / points) * total;
        const seg = timeline.find(s => ms >= s.start_ms && ms <= s.end_ms);

        let y = 0;
        if (seg?.type === 'noise') y = Math.sin(i * 0.9) * 0.12;
        else if (seg?.type === 'murmur') y = Math.sin(i * 1.8) * 0.35;
        else if (seg?.type === 'systole') y = Math.sin(i * 2.4) * 0.55;
        else if (seg?.type === 'diastole') y = Math.sin(i * 1.2) * 0.18;
        else y = Math.sin(i * 0.7) * 0.08;

        const x = (i / points) * width;
        const py = mid - y * amp;
        series.push({ x, y: py });
    }

    if (!series.length) return '';
    let d = `M ${series[0].x.toFixed(1)} ${series[0].y.toFixed(1)}`;

    for (let i = 0; i < series.length - 1; i++) {
        const p0 = series[Math.max(0, i - 1)];
        const p1 = series[i];
        const p2 = series[i + 1];
        const p3 = series[Math.min(series.length - 1, i + 2)];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    return d;
};

const ClinicalTimelineVisualization = memo(({
    durationMs = 1,
    timeline = [],
    heartBpm,
    avgSystole = 0.275,
    avgDiastole = 0.362,
    activeMs = 0,
    onSegmentPress,
}) => {
    const width = 340;
    const height = 210;
    const plotTop = 50;
    const plotHeight = 120;
    const total = Math.max(durationMs || 1, 1);

    const xOf = ms => (ms / total) * width;
    const wOf = (start, end) => Math.max(2, ((end - start) / total) * width);

    const wavePath = useMemo(
        () => buildWavePathFromTimeline(timeline, durationMs, width, plotTop, plotHeight),
        [timeline, durationMs]
    );

    return (
        <View style={styles.timelineCard}>
            <View style={styles.timelineTopRow}>
                <View style={styles.hrBadge}>
                    <Text style={styles.hrText}>
                        Heart rate: {heartBpm ? `${Math.round(heartBpm)} bpm` : '—'}
                    </Text>
                </View>

                <Text style={styles.avgText}>Average Systole: {avgSystole.toFixed(3)} sec</Text>
                <Text style={styles.avgText}>Average Diastole: {avgDiastole.toFixed(3)} sec</Text>
            </View>

            <View style={styles.legendRow}>
                <LegendChip color={COLOR.brady} label="Bradycardia" />
                <LegendChip color={COLOR.normal} label="Normal" />
                <LegendChip color={COLOR.mildTachy} label="Mild Tachycardia" />
                <LegendChip color={COLOR.tachy} label="Tachycardia" />
                <LegendChip color={COLOR.s1} label="S1" dot />
                <LegendChip color={COLOR.s2} label="S2" dot />
                <LegendChip color={COLOR.systole} label="Systole" />
                <LegendChip color={COLOR.diastole} label="Diastole" />
                <LegendChip color={COLOR.noise} label="Noisy/Unsure" />
                <LegendChip color={COLOR.murmurSys} label="Systole Murmur" />
                <LegendChip color={COLOR.murmurDia} label="Diastole Murmur" />
            </View>

            <View style={[styles.timelineCanvas, { width, height }]}>
                <Svg width={width} height={height}>
                    <Defs>
                        <LinearGradient id="waveGrad" x1="0" y1="0" x2="0" y2="1">
                            <Stop offset="0%" stopColor="#1D4ED8" stopOpacity="0.9" />
                            <Stop offset="100%" stopColor="#2563EB" stopOpacity="0.25" />
                        </LinearGradient>
                    </Defs>

                    {[0, 1, 2, 3, 4].map(i => (
                        <Line
                            key={`h-${i}`}
                            x1={0}
                            x2={width}
                            y1={plotTop + (plotHeight / 4) * i}
                            y2={plotTop + (plotHeight / 4) * i}
                            stroke={COLOR.grid}
                            strokeWidth={i === 2 ? 1.2 : 0.6}
                            strokeDasharray={i === 2 ? '' : '4 4'}
                        />
                    ))}

                    {[0, 1, 2, 3, 4, 5, 6, 7].map(i => (
                        <Line
                            key={`v-${i}`}
                            x1={(width / 7) * i}
                            x2={(width / 7) * i}
                            y1={plotTop}
                            y2={plotTop + plotHeight}
                            stroke={COLOR.grid}
                            strokeWidth={0.6}
                            strokeDasharray="3 4"
                            opacity={0.6}
                        />
                    ))}

                    {timeline.map((seg, idx) => {
                        const bg = getColor(seg.type, seg.subtype);
                        const isActive = activeMs >= seg.start_ms && activeMs <= seg.end_ms;

                        return (
                            <Rect
                                key={`${seg.type}-${idx}-${seg.start_ms}`}
                                x={xOf(seg.start_ms)}
                                y={plotTop}
                                width={wOf(seg.start_ms, seg.end_ms)}
                                height={plotHeight}
                                fill={bg}
                                fillOpacity={seg.type === 'noise' ? 0.35 : seg.type === 'murmur' ? 0.45 : 0.22}
                                stroke={isActive ? COLOR.playhead : 'transparent'}
                                strokeWidth={isActive ? 2 : 0}
                                rx={4}
                                ry={4}
                                onPress={() => onSegmentPress?.(seg)}
                            />
                        );
                    })}

                    <Path
                        d={wavePath}
                        fill="none"
                        stroke="url(#waveGrad)"
                        strokeWidth={2}
                    />

                    {timeline
                        .filter(seg => seg.type === 'S1' || seg.type === 'S2')
                        .map((seg, idx) => (
                            <Circle
                                key={`marker-${idx}`}
                                cx={xOf(seg.start_ms)}
                                cy={plotTop + 6}
                                r={4}
                                fill={seg.type === 'S1' ? COLOR.s1 : COLOR.s2}
                            />
                        ))}

                    <Line
                        x1={xOf(activeMs)}
                        x2={xOf(activeMs)}
                        y1={plotTop}
                        y2={plotTop + plotHeight}
                        stroke={COLOR.playhead}
                        strokeWidth={2.5}
                    />
                </Svg>
            </View>
        </View>
    );
});

const styles = StyleSheet.create({
    timelineCard: {
        backgroundColor: '#FFF',
        borderRadius: 16,
        padding: 14,
        borderWidth: 1,
        borderColor: '#E2E8F0',
    },
    timelineTopRow: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 8,
        marginBottom: 10,
    },
    hrBadge: {
        backgroundColor: '#DCFCE7',
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: '#86EFAC',
    },
    hrText: {
        fontSize: 12,
        fontWeight: '700',
        color: COLOR.text,
    },
    avgText: {
        fontSize: 12,
        color: COLOR.text,
        fontWeight: '600',
    },
    legendRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
        marginBottom: 10,
    },
    legendChip: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 10,
        marginBottom: 6,
    },
    legendBox: {
        width: 18,
        height: 10,
        borderRadius: 2,
        marginRight: 5,
    },
    legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 5,
    },
    legendLabel: {
        fontSize: 10,
        color: '#475569',
        fontWeight: '700',
    },
    timelineCanvas: {
        position: 'relative',
        marginTop: 4,
        overflow: 'hidden',
    },
});

export default ClinicalTimelineVisualization;