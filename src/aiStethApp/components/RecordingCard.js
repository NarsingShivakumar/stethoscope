// src/components/RecordingCard.js
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { COLORS, SPACING, FONTS, SHADOWS, BORDER_RADIUS } from '../constants/theme';

export const RecordingCard = ({
  recording,
  onPlay,
  onDelete,
}) => {
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Recording',
      'Are you sure you want to delete this recording? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', onPress: onDelete, style: 'destructive' },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.content}
        onPress={onPlay}
        activeOpacity={0.7}
      >
        <View style={styles.iconContainer}>
          <Text style={styles.icon}>🎵</Text>
        </View>

        <View style={styles.info}>
          <Text style={styles.fileName} numberOfLines={1}>
            {recording.fileName}
          </Text>
          <Text style={styles.date}>{recording.date}</Text>
          <Text style={styles.size}>{formatFileSize(recording.fileSize)}</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={onPlay}
          activeOpacity={0.7}
        >
          <Text style={styles.playIcon}>▶️</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.actionButton}
          onPress={handleDelete}
          activeOpacity={0.7}
        >
          <Text style={styles.deleteIcon}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    ...SHADOWS.small,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    padding: SPACING.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  icon: {
    fontSize: 24,
  },
  info: {
    flex: 1,
    justifyContent: 'center',
  },
  fileName: {
    fontSize: FONTS.sizes.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  date: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  size: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textTertiary,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: SPACING.sm,
  },
  actionButton: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 20,
  },
  deleteIcon: {
    fontSize: 18,
  },
});
