// src/components/sections/RecordingsListSection.js
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { RecordingCard } from '../RecordingCard';
import { AudioPlayer } from '../AudioPlayer';
import { COLORS, SPACING, FONTS, BORDER_RADIUS } from '../../constants/theme';

export const RecordingsListSection = ({ stethoscope, audioPlayer, onBackToDevices }) => {
  const { recordings, loadRecordings, deleteRecording } = stethoscope;
  const {
    playSound,
    stopSound,
    pauseSound,
    seekTo,
    isPlaying,
    currentFile,
    duration,
    currentTime,
    formatTime,
  } = audioPlayer;

  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRecordings();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRecordings();
    setRefreshing(false);
  };

  const handlePlayRecording = (recording) => {
    playSound(recording.filePath, () => {
      console.log('Playback completed for:', recording.fileName);
    });
  };

  const handleDeleteRecording = async (recording) => {
    if (currentFile === recording.filePath) {
      stopSound();
    }

    try {
      await deleteRecording(recording.filePath);
      Alert.alert('Success', 'Recording deleted successfully');
    } catch (err) {
      Alert.alert('Error', 'Failed to delete recording');
    }
  };

  const getCurrentRecording = () => {
    return recordings.find((r) => r.filePath === currentFile);
  };

  const calculateTotalSize = () => {
    const totalBytes = recordings.reduce((sum, r) => sum + r.fileSize, 0);
    return (totalBytes / (1024 * 1024)).toFixed(2);
  };

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateIcon}>📂</Text>
      <Text style={styles.emptyStateTitle}>No Recordings Yet</Text>
      <Text style={styles.emptyStateText}>
        Start recording audio from your stethoscope to see your recordings here.
      </Text>
      <TouchableOpacity
        style={styles.startButton}
        onPress={onBackToDevices}
        activeOpacity={0.7}
      >
        <Text style={styles.startButtonText}>Go to Devices</Text>
      </TouchableOpacity>
    </View>
  );

  const currentRecording = getCurrentRecording();

  return (
    <View style={styles.container}>
      {/* Audio Player */}
      {currentRecording && currentFile && (
        <View style={styles.playerContainer}>
          <AudioPlayer
            recording={currentRecording}
            isPlaying={isPlaying}
            duration={duration}
            currentTime={currentTime}
            onPlay={() => handlePlayRecording(currentRecording)}
            onPause={pauseSound}
            onStop={stopSound}
            onSeek={seekTo}
            formatTime={formatTime}
          />
        </View>
      )}

      {/* Stats */}
      {recordings.length > 0 && (
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{recordings.length}</Text>
            <Text style={styles.statLabel}>Total Files</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{calculateTotalSize()} MB</Text>
            <Text style={styles.statLabel}>Total Size</Text>
          </View>
        </View>
      )}

      {/* Recordings List */}
      <FlatList
        data={recordings}
        keyExtractor={(item) => item.filePath}
        renderItem={({ item }) => (
          <RecordingCard
            recording={item}
            onPlay={() => handlePlayRecording(item)}
            onDelete={() => handleDeleteRecording(item)}
            isCurrentlyPlaying={currentFile === item.filePath}
          />
        )}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={renderEmptyState}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  playerContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  statsContainer: {
    flexDirection: 'row',
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  statValue: {
    fontSize: FONTS.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  listContent: {
    padding: SPACING.lg,
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyStateIcon: {
    fontSize: 64,
    marginBottom: SPACING.lg,
  },
  emptyStateTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  emptyStateText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: SPACING.xl,
  },
  startButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  startButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textInverse,
  },
});
