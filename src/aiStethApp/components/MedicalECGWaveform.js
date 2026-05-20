// src/components/MedicalECGWaveform.js
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Dimensions, Animated } from 'react-native';
import { COLORS, SPACING, FONTS, SHADOWS } from '../constants/theme';
import LottieView from 'lottie-react-native';
import LinearGradient from 'react-native-linear-gradient';
import { t } from 'i18next';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const WAVEFORM_WIDTH = SCREEN_WIDTH - SPACING.xl * 2;
const WAVEFORM_HEIGHT = 220;
const SAMPLE_RATE = 60;
const DISPLAY_DURATION = 5;
const MAX_POINTS = SAMPLE_RATE * DISPLAY_DURATION;

const AMPLITUDE_THRESHOLD = 0.00001;
const AMPLITUDE_SCALE = 150;
const VERTICAL_SCALE = 150;

export const MedicalECGWaveform = ({
    amplitude,
    isRecording,
    connectedDevice,
}) => {
    const [waveformData, setWaveformData] = useState(Array(MAX_POINTS).fill(0));
    const [heartRate, setHeartRate] = useState(0);
    const [peakAmplitude, setPeakAmplitude] = useState(0);
    const [displayAmplitude, setDisplayAmplitude] = useState(0);
    const heartbeatPhase = useRef(0);
    const peakTimes = useRef([]);

    // Animation values
    const pulseAnim = useRef(new Animated.Value(1)).current;
    const glowAnim = useRef(new Animated.Value(0)).current;

    // Pulse animation for recording indicator
    useEffect(() => {
        if (isRecording) {
            Animated.loop(
                Animated.sequence([
                    Animated.timing(pulseAnim, {
                        toValue: 1.3,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                    Animated.timing(pulseAnim, {
                        toValue: 1,
                        duration: 800,
                        useNativeDriver: true,
                    }),
                ])
            ).start();

            Animated.loop(
                Animated.sequence([
                    Animated.timing(glowAnim, {
                        toValue: 1,
                        duration: 1500,
                        useNativeDriver: true,
                    }),
                    Animated.timing(glowAnim, {
                        toValue: 0,
                        duration: 1500,
                        useNativeDriver: true,
                    }),
                ])
            ).start();
        } else {
            pulseAnim.setValue(1);
            glowAnim.setValue(0);
        }
    }, [isRecording]);

    const generateHeartbeatWaveform = (phase, amplitudeFactor) => {
        const normalizedAmp = Math.min(amplitudeFactor * AMPLITUDE_SCALE, 1);

        if (phase < 0.08) {
            return 0.15 * normalizedAmp * Math.sin(phase * 12.5 * Math.PI);
        }
        else if (phase < 0.16) {
            return 0;
        }
        else if (phase < 0.18) {
            return -0.15 * normalizedAmp;
        }
        else if (phase < 0.22) {
            const subPhase = (phase - 0.18) / 0.04;
            return 1.8 * normalizedAmp * Math.sin(subPhase * Math.PI);
        }
        else if (phase < 0.26) {
            return -0.3 * normalizedAmp;
        }
        else if (phase < 0.40) {
            return 0;
        }
        else if (phase < 0.60) {
            const subPhase = (phase - 0.40) / 0.20;
            return 0.3 * normalizedAmp * Math.sin(subPhase * Math.PI);
        }
        else {
            return 0;
        }
    };

    useEffect(() => {
        if (!isRecording) {
            setWaveformData(Array(MAX_POINTS).fill(0));
            setHeartRate(0);
            setPeakAmplitude(0);
            setDisplayAmplitude(0);
            heartbeatPhase.current = 0;
            peakTimes.current = [];
            return;
        }

        const interval = setInterval(() => {
            let newValue = 0;

            if (amplitude >= AMPLITUDE_THRESHOLD) {
                setDisplayAmplitude(amplitude);

                const speedFactor = 0.02 + (amplitude * 0.005);
                heartbeatPhase.current += Math.min(speedFactor, 0.04);

                if (heartbeatPhase.current >= 1) {
                    heartbeatPhase.current = 0;

                    const now = Date.now();
                    peakTimes.current.push(now);

                    if (peakTimes.current.length > 6) {
                        peakTimes.current.shift();
                    }

                    if (peakTimes.current.length >= 2) {
                        const timeDiff = peakTimes.current[peakTimes.current.length - 1] - peakTimes.current[0];
                        const avgInterval = timeDiff / (peakTimes.current.length - 1);
                        const bpm = Math.round(60000 / avgInterval);

                        const clampedBpm = Math.max(40, Math.min(180, bpm));
                        setHeartRate(clampedBpm);
                    }
                }

                newValue = generateHeartbeatWaveform(heartbeatPhase.current, amplitude);

                const absValue = Math.abs(newValue);
                if (absValue > peakAmplitude) {
                    setPeakAmplitude(absValue);
                }
            } else {
                newValue = (Math.random() - 0.5) * 0.01;
            }

            setWaveformData((prevData) => {
                const newData = [...prevData];
                newData.shift();
                newData.push(newValue);
                return newData;
            });
        }, 1000 / SAMPLE_RATE);

        return () => clearInterval(interval);
    }, [isRecording, amplitude]);

    const glowColor = glowAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['rgba(255, 107, 157, 0.2)', 'rgba(255, 107, 157, 0.6)']
    });

    return (
        <LinearGradient
            colors={['#ffffff', '#F8FBFF', '#F0F7FF']}
            style={styles.container}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
        >
            {/* Decorative Lottie Animation */}
            <View style={styles.lottieBackground}>
                {isRecording ? (
                    <LottieView
                        source={require('../../assets/lottie/heart.json')}
                        autoPlay
                        loop
                        style={styles.lottieMedical}
                    />
                ) : (
                    <LottieView
                        source={require('../../assets/lottie/heart.json')}
                        autoPlay
                        loop
                        style={styles.lottieHeartbeat}
                    />
                )}
            </View>

            {/* Glass morphism header */}
            <View style={styles.glassHeader}>
                <View style={styles.headerLeft}>
                    <Animated.View
                        style={[
                            styles.recordingIndicatorContainer,
                            {
                                transform: [{ scale: pulseAnim }],
                                backgroundColor: glowColor
                            }
                        ]}
                    >
                        <View
                            style={[
                                styles.recordingIndicator,
                                { backgroundColor: isRecording ? '#e43644' : '#4d535e' }
                            ]}
                        />
                    </Animated.View>
                    <View style={styles.deviceInfo}>
                        <Text style={styles.deviceName}>{t("ai_steth")}</Text>
                        <Text style={styles.deviceSubtext}>{t("medical_monitor")}</Text>
                    </View>
                </View>

                {/* {isRecording && heartRate > 0 && (
                    <LinearGradient
                        // colors={['#FF7597', '#FF8FA9', '#FFA8BB']}
                        colors={['#4DD0E1', '#6FE0EF', '#91EFF9']}
                        style={styles.bpmBadge}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    >
                        <LottieView
                            source={require('../../assets/lottie/heart.json')}
                            autoPlay
                            loop
                            style={styles.heartIcon}
                        />
                        <View>
                            <Text style={styles.bpmValue}>{heartRate}</Text>
                            <Text style={styles.bpmLabel}>BPM</Text>
                        </View>
                    </LinearGradient>
                )} */}
            </View>

            {/* ECG Display with enhanced styling */}
            <View style={styles.ecgContainer}>
                {/* Medical Grid Background */}
                <View style={styles.gridBackground}>
                    {Array.from({ length: 26 }).map((_, i) => (
                        <View
                            key={`v-major-${i}`}
                            style={[
                                styles.gridLine,
                                styles.verticalLine,
                                {
                                    left: (i * WAVEFORM_WIDTH) / 25,
                                    backgroundColor: i % 5 === 0 ? '#FF8FA950' : '#FF8FA920',
                                    width: i % 5 === 0 ? 1.5 : 0.5,
                                },
                            ]}
                        />
                    ))}
                    {Array.from({ length: 15 }).map((_, i) => (
                        <View
                            key={`h-major-${i}`}
                            style={[
                                styles.gridLine,
                                styles.horizontalLine,
                                {
                                    top: (i * WAVEFORM_HEIGHT) / 14,
                                    backgroundColor: i % 5 === 0 ? '#FF8FA950' : '#FF8FA920',
                                    height: i % 5 === 0 ? 1.5 : 0.5,
                                },
                            ]}
                        />
                    ))}
                </View>

                {/* Waveform Rendering with glow effect */}
                <View style={styles.waveformContainer}>
                    {waveformData.map((value, index) => {
                        if (index === 0) return null;

                        const prevValue = waveformData[index - 1];
                        const xPos = ((index - 1) / MAX_POINTS) * WAVEFORM_WIDTH;
                        const xNext = (index / MAX_POINTS) * WAVEFORM_WIDTH;

                        const yPos = WAVEFORM_HEIGHT / 2 - prevValue * VERTICAL_SCALE;
                        const yNext = WAVEFORM_HEIGHT / 2 - value * VERTICAL_SCALE;

                        const angle = Math.atan2(yNext - yPos, xNext - xPos);
                        const length = Math.sqrt(Math.pow(xNext - xPos, 2) + Math.pow(yNext - yPos, 2));

                        return (
                            <View
                                key={`wave-${index}`}
                                style={[
                                    styles.waveformLine,
                                    {
                                        left: xPos,
                                        top: yPos,
                                        width: length,
                                        transform: [{ rotate: `${angle}rad` }],
                                        backgroundColor: isRecording ? '#4CAF93' : '#9CA3AF',
                                        shadowColor: isRecording ? '#4CAF93' : '#9CA3AF',
                                        shadowOffset: { width: 0, height: 0 },
                                        shadowOpacity: 0.6,
                                        shadowRadius: 3,
                                    },
                                ]}
                            />
                        );
                    })}
                </View>

                {/* Scan line animation */}
                {isRecording && (
                    <View style={styles.scanLine} />
                )}

                {/* Enhanced info badges */}
                <View style={styles.infoBadges}>
                    <View style={styles.infoBadge}>
                        <Text style={styles.infoLabel}>SIGNAL</Text>
                        <Text style={styles.infoValue}>
                            {isRecording ? (amplitude * 1000).toFixed(1) : '--'}
                        </Text>
                    </View>
                    <View style={styles.infoBadge}>
                        <Text style={styles.infoLabel}>GAIN</Text>
                        <Text style={styles.infoValue}>×{AMPLITUDE_SCALE}</Text>
                    </View>
                </View>
            </View>

            {/* Status indicator */}
            <View style={styles.statusBar}>
                <View style={styles.statusItem}>
                    <View style={[styles.statusDot, { backgroundColor: isRecording ? '#4CAF93' : '#9CA3AF' }]} />
                    <Text style={styles.statusText}>
                        {isRecording ? 'RECORDING' : t("standby")}
                    </Text>
                </View>
                <Text style={styles.filterText}>Filter: 0.5-40 Hz</Text>
            </View>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    container: {
        borderRadius: 24,
        padding: SPACING.lg,
        marginBottom: SPACING.lg,
        overflow: 'hidden',
        borderWidth: 1,
        borderColor: '#B2DFDB',
        ...SHADOWS.large,
    },
    lottieBackground: {
        position: 'absolute',
        right: -20,
        top: -20,
        opacity: 0.08,
    },
    lottieMedical: {
        width: 150,
        height: 150,
    },
    lottieHeartbeat: {
        width: 120,
        height: 120,
    },
    glassHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: SPACING.lg,
        paddingBottom: SPACING.md,
        borderBottomWidth: 1,
        borderBottomColor: '#E8EDF5',
        backgroundColor: 'rgba(224, 242, 241, 0.4)',
        padding: SPACING.md,
        borderRadius: 16,
    },
    headerLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.md,
    },
    recordingIndicatorContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    recordingIndicator: {
        width: 16,
        height: 16,
        borderRadius: 8,
    },
    deviceInfo: {
        gap: 2,
    },
    deviceName: {
        fontSize: FONTS.sizes.lg,
        fontWeight: '800',
        color: '#1E3A5F',
        letterSpacing: 1,
    },
    deviceSubtext: {
        fontSize: FONTS.sizes.xs,
        color: '#64748B',
        fontWeight: '500',
    },
    bpmBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.sm,
        paddingHorizontal: SPACING.md,
        paddingVertical: SPACING.sm,
        borderRadius: 12,
        ...SHADOWS.medium,
    },
    heartIcon: {
        width: 32,
        height: 32,
    },
    bpmValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#FFFFFF',
        fontFamily: 'monospace',
    },
    bpmLabel: {
        fontSize: 10,
        color: '#FFFFFF',
        fontWeight: '600',
        opacity: 0.9,
    },
    ecgContainer: {
        height: WAVEFORM_HEIGHT,
        backgroundColor: '#FAFCFE',
        borderRadius: 16,
        overflow: 'hidden',
        position: 'relative',
        borderWidth: 1,
        borderColor: '#80CBC4',
        marginBottom: SPACING.md,
    },
    gridBackground: {
        ...StyleSheet.absoluteFillObject,
    },
    gridLine: {
        position: 'absolute',
    },
    verticalLine: {
        height: '100%',
    },
    horizontalLine: {
        width: '100%',
    },
    waveformContainer: {
        ...StyleSheet.absoluteFillObject,
    },
    waveformLine: {
        position: 'absolute',
        height: 2.5,
        transformOrigin: 'left',
    },
    scanLine: {
        position: 'absolute',
        right: 20,
        width: 2,
        height: '100%',
        backgroundColor: '#26A69A',
        shadowColor: '#26A69A',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.8,
        shadowRadius: 10,
    },
    infoBadges: {
        position: 'absolute',
        left: SPACING.sm,
        bottom: SPACING.sm,
        flexDirection: 'row',
        gap: SPACING.sm,
    },
    infoBadge: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        paddingHorizontal: SPACING.sm,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#B2DFDB',
    },
    infoLabel: {
        fontSize: 8,
        color: '#64748B',
        fontWeight: '700',
        letterSpacing: 0.5,
    },
    infoValue: {
        fontSize: 11,
        color: '#26A69A',
        fontFamily: 'monospace',
        fontWeight: '700',
    },
    statusBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingTop: SPACING.sm,
    },
    statusItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: SPACING.xs,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: FONTS.sizes.sm,
        color: '#475569',
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    filterText: {
        fontSize: FONTS.sizes.xs,
        color: '#94A3B8',
        fontFamily: 'monospace',
    },
});
