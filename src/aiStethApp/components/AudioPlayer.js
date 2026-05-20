// src/components/AudioPlayer.js
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Slider from '@react-native-community/slider';
import { COLORS, SPACING, FONTS, BORDER_RADIUS, SHADOWS } from '../constants/theme';

export const AudioPlayer = ({
  fileName,
  isPlaying,
  currentTime,
  duration,
  onPlayPause,
  onStop,
  onSeek,
  formatTime,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.fileName} numberOfLines={1}>
          {fileName}
        </Text>
        <Text style={styles.timeText}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </Text>
      </View>

      <View style={styles.sliderContainer}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={duration || 1}
          value={currentTime}
          onSlidingComplete={onSeek}
          minimumTrackTintColor={COLORS.primary}
          maximumTrackTintColor={COLORS.border}
          thumbTintColor={COLORS.primary}
        />
      </View>

      <View style={styles.controls}>
        <TouchableOpacity
          style={styles.controlButton}
          onPress={onStop}
          activeOpacity={0.7}
        >
          <Text style={styles.controlIcon}>⏹</Text>
          <Text style={styles.controlText}>Stop</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlButton, styles.playButton]}
          onPress={onPlayPause}
          activeOpacity={0.7}
        >
          <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶️'}</Text>
          <Text style={styles.controlText}>{isPlaying ? 'Pause' : 'Play'}</Text>
        </TouchableOpacity>

        <View style={styles.controlButton}>
          <Text style={styles.waveIcon}>〰️</Text>
          <Text style={styles.controlText}>Wave</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.primary,
    ...SHADOWS.large,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  fileName: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginRight: SPACING.sm,
  },
  timeText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  sliderContainer: {
    marginBottom: SPACING.md,
  },
  slider: {
    width: '100%',
    height: 40,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  controlButton: {
    alignItems: 'center',
    padding: SPACING.sm,
  },
  playButton: {
    backgroundColor: COLORS.primary + '15',
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  controlIcon: {
    fontSize: 24,
    marginBottom: SPACING.xs,
  },
  playIcon: {
    fontSize: 32,
    marginBottom: SPACING.xs,
  },
  waveIcon: {
    fontSize: 24,
    marginBottom: SPACING.xs,
    opacity: 0.5,
  },
  controlText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
});
