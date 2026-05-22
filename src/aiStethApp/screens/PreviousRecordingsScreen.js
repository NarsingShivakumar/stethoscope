// src/aiStethApp/screens/PreviousRecordingsScreen.js  v4
//
// Uses @react-native-documents/picker (the new package, rewritten Jan 2025)
// which replaced the deprecated react-native-document-picker.
//
// Install & rebuild:
//   npm uninstall react-native-document-picker          # remove old if present
//   npm install @react-native-documents/picker
//   cd android && ./gradlew clean && cd ..              # clean build cache
//   npx react-native run-android                        # rebuild with native code
//
// API changes vs old package:
//   OLD: pickSingle(opts)           → single result object
//   NEW: pick(opts)                 → array, destructure [result] for single file
//   OLD: DocumentPicker.isCancel(e) → NEW: isErrorWithCode(e, errorCodes.OPERATION_CANCELED)
//   OLD: types.audio               → NEW: types.audio  (same name, same MIME)
//   OLD: fileCopyUri               → NEW: fileCopyUri  (same field, still present)

import React, { useCallback, useState } from 'react';
import {
  View, StyleSheet, TouchableOpacity, Text, StatusBar,
  Alert, ActivityIndicator, FlatList, RefreshControl, NativeModules,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import RNFS from 'react-native-fs';
import { pick, types, isErrorWithCode, errorCodes } from '@react-native-documents/picker';

import { useStethoscope } from '../hooks/useStethoscope';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { AudioPlayer } from '../components/AudioPlayer';
import { COLORS, SPACING, FONTS, BORDER_RADIUS } from '../constants/theme';
import { APP_COLORS } from '../../assets/colors';
import { t } from 'i18next';
import {
  processBase64Thunk,
  selectIsProcessing,
  clearSeparationData,
} from '../../store/slices/SeparationSlice';
import { debugLog, debugError } from '../../config/AppConfig';

const { StethoscopeRecorder } = NativeModules;

// ── Format helpers ────────────────────────────────────────────────────────────
const fmtSize = b => {
  if (!b) return '—';
  return b < 1048576
    ? (b / 1024).toFixed(1) + ' KB'
    : (b / 1048576).toFixed(2) + ' MB';
};
const fmtDur = b => {
  const s = Math.max(0, b - 44) / 88200;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

// ── RecordingItemExtended — unchanged from original ───────────────────────────
const RecordingItemExtended = React.memo(({
  item, isCurrentlyPlaying, isAnalysing,
  onPlay, onAnalyse, onDelete,
}) => (
  <View style={[styles.recCard, isCurrentlyPlaying && styles.recCardActive]}>
    <View style={styles.recInfo}>
      <Text style={styles.recName} numberOfLines={1}>{item.fileName}</Text>
      <View style={styles.recMeta}>
        <Text style={styles.recMetaTxt}>📅 {item.date}</Text>
        <Text style={styles.recMetaTxt}>📦 {fmtSize(item.fileSize)}</Text>
        <Text style={styles.recMetaTxt}>⏱ {fmtDur(item.fileSize)}</Text>
      </View>
    </View>
    <View style={styles.recActions}>
      {/* Play */}
      <TouchableOpacity
        style={[styles.actionBtn, isCurrentlyPlaying && { backgroundColor: APP_COLORS.primary }]}
        onPress={() => onPlay(item)}>
        <Text style={styles.actionBtnTxt}>{isCurrentlyPlaying ? '⏸' : '▶'}</Text>
      </TouchableOpacity>
      {/* Analyse */}
      <TouchableOpacity
        style={[styles.actionBtn, styles.analyseBtn, isAnalysing && styles.actionBtnDisabled]}
        onPress={() => onAnalyse(item)}
        disabled={isAnalysing}>
        {isAnalysing
          ? <ActivityIndicator size="small" color="#FFF" />
          : <Text style={styles.actionBtnTxt}>🔬</Text>}
      </TouchableOpacity>
      {/* Delete */}
      <TouchableOpacity
        style={[styles.actionBtn, styles.deleteBtn]}
        onPress={() => onDelete(item)}>
        <Text style={styles.actionBtnTxt}>🗑</Text>
      </TouchableOpacity>
    </View>
  </View>
));

// ── UploadedFileCard ──────────────────────────────────────────────────────────
const UploadedFileCard = React.memo(({ file, isAnalysing, onAnalyse, onClear }) => (
  <View style={styles.uploadedCard}>
    <View style={styles.uploadedRow}>
      <View style={styles.uploadedIconWrap}>
        <Text style={styles.uploadedIcon}>🎵</Text>
      </View>
      <View style={styles.uploadedInfo}>
        <Text style={styles.uploadedName} numberOfLines={2}>{file.name}</Text>
        <View style={styles.uploadedMeta}>
          {!!file.size && (
            <Text style={styles.uploadedMetaTxt}>📦 {fmtSize(file.size)}</Text>
          )}
          <Text style={styles.uploadedMetaTxt}>{file.mimeType || 'audio'}</Text>
        </View>
      </View>
    </View>
    <View style={styles.uploadedActions}>
      <TouchableOpacity
        style={[styles.uploadedAnalyseBtn, isAnalysing && styles.actionBtnDisabled]}
        onPress={onAnalyse}
        disabled={isAnalysing}
        activeOpacity={0.85}>
        {isAnalysing
          ? <ActivityIndicator size="small" color="#FFF" />
          : <>
            <Text style={styles.uploadedAnalyseBtnIcon}>🔬</Text>
            <Text style={styles.uploadedAnalyseBtnText}>Analyse</Text>
          </>}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.uploadedClearBtn, isAnalysing && styles.actionBtnDisabled]}
        onPress={onClear}
        disabled={isAnalysing}
        activeOpacity={0.85}>
        <Text style={styles.uploadedClearBtnText}>✕  Clear</Text>
      </TouchableOpacity>
    </View>
  </View>
));

// ── Drop zone (shown before file is selected) ─────────────────────────────────
const DropZone = React.memo(({ onPress, isPicking }) => (
  <TouchableOpacity
    style={styles.uploadDropZone}
    onPress={onPress}
    disabled={isPicking}
    activeOpacity={0.85}>
    {isPicking ? (
      <>
        <ActivityIndicator size="large" color={APP_COLORS.primary} style={{ marginBottom: 8 }} />
        <Text style={styles.uploadDropSub}>Opening file picker…</Text>
      </>
    ) : (
      <>
        <Text style={styles.uploadDropIcon}>📂</Text>
        <Text style={styles.uploadDropTitle}>Upload Audio File</Text>
        <Text style={styles.uploadDropSub}>
          Tap to pick an audio file from device storage
        </Text>
        <View style={styles.uploadDropBadge}>
          <Text style={styles.uploadDropBadgeTxt}>
            WAV · MP3 · AAC · OGG · FLAC · M4A
          </Text>
        </View>
      </>
    )}
  </TouchableOpacity>
));

// ══════════════════════════════════════════════════════════════════════════════
//  Screen
// ══════════════════════════════════════════════════════════════════════════════
export const PreviousRecordingsScreen = ({
  stethoscope: propStethoscope,
  audioPlayer: propAudioPlayer,
  onBackToDevices,
  onShowAnalysis,
}) => {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const isAnalysing = useSelector(selectIsProcessing);

  const localStethoscope = useStethoscope();
  const localAudioPlayer = useAudioPlayer();
  const stethoscope = propStethoscope || localStethoscope;
  const audioPlayer = propAudioPlayer || localAudioPlayer;

  const {
    playSound, stopSound, pauseSound, seekTo,
    isPlaying, currentFile, duration, currentTime, formatTime,
  } = audioPlayer;

  const { recordings, loadRecordings, deleteRecording } = stethoscope;

  // ── State ─────────────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [analysingFile, setAnalysingFile] = useState(null);
  const [uploadedFile, setUploadedFile] = useState(null);  // picked file metadata
  const [isPickingFile, setIsPickingFile] = useState(false);  // file picker open
  const [isAnalysingUpload, setIsAnalysingUpload] = useState(false);  // NMF running on upload

  // ── Refresh ───────────────────────────────────────────────────────────────
  const handleRefresh = async () => {
    setRefreshing(true);
    await loadRecordings();
    setRefreshing(false);
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleBack = useCallback(() => {
    if (onBackToDevices) onBackToDevices();
    else navigation.goBack();
  }, [onBackToDevices, navigation]);

  const handleShowAnalysis = useCallback(() => {
    if (onShowAnalysis) onShowAnalysis();
    else navigation.navigate('AiStethHomeScreen');
  }, [onShowAnalysis, navigation]);

  // ── Play ──────────────────────────────────────────────────────────────────
  const handlePlay = useCallback(item => {
    if (currentFile === item.filePath && isPlaying) pauseSound();
    else playSound(item.filePath, () => debugLog('[PrevRec] Done:', item.fileName));
  }, [currentFile, isPlaying, playSound, pauseSound]);

  // ── Analyse list recording ────────────────────────────────────────────────
  const handleAnalyse = useCallback(item => {
    Alert.alert(
      'Analyse with NMF Backend',
      `Send "${item.fileName}" for heart/lung separation?\n\nUses the egrooby NMF algorithm (~1–2 sec).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Analyse',
          onPress: async () => {
            try {
              setAnalysingFile(item.filePath);
              dispatch(clearSeparationData());
              debugLog('[PrevRec] Reading file:', item.filePath);
              const base64Audio = await RNFS.readFile(item.filePath, 'base64');
              const action = await dispatch(processBase64Thunk({
                base64Audio,
                sampleRate: 44100,
                filePath: item.filePath,
              }));
              if (processBase64Thunk.fulfilled.match(action)) {
                handleShowAnalysis();
              } else {
                Alert.alert('Analysis Failed',
                  action.payload || 'Separation server returned an error.');
              }
            } catch (err) {
              debugError('[PrevRec] analyse error:', err);
              Alert.alert('Error', err.message || 'Failed to analyse recording');
            } finally {
              setAnalysingFile(null);
            }
          },
        },
      ]
    );
  }, [dispatch, handleShowAnalysis]);

  // ── Delete ────────────────────────────────────────────────────────────────
  const handleDelete = useCallback(async item => {
    Alert.alert(
      'Delete Recording',
      `Delete "${item.fileName}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            if (currentFile === item.filePath) stopSound();
            try {
              await deleteRecording(item.filePath);
              Alert.alert('Success', 'Recording deleted successfully');
            } catch { Alert.alert('Error', 'Failed to delete recording'); }
          },
        },
      ]
    );
  }, [currentFile, stopSound, deleteRecording]);

  // ── Pick file from device storage ─────────────────────────────────────────
  // Uses @react-native-documents/picker
  //   pick() returns an array — we take [0] for single-file selection.
  //   copyTo: 'cachesDirectory' gives us a stable local path to readFile().
  const handlePickFile = useCallback(async () => {
    try {
      setIsPickingFile(true);

      // pick() opens the native system file picker (Files app / Storage browser)
      const [result] = await pick({
        // Allow all common audio MIME types
        type: [
          types.audio,          // audio/*  — catches most formats
          'audio/wav',
          'audio/x-wav',
          'audio/mpeg',         // mp3
          'audio/mp4',          // m4a / aac in mp4 container
          'audio/aac',
          'audio/ogg',
          'audio/flac',
          'audio/x-flac',
          'audio/3gpp',
          'audio/opus',
          'audio/webm',
        ],
        // copyTo creates a stable local file path we can pass to RNFS.readFile
        copyTo: 'cachesDirectory',
        // Allow only one file at a time
        allowMultiSelection: false,
      });

      debugLog('[PrevRec] Picked file:', result.name, 'uri:', result.uri,
        'copyUri:', result.fileCopyUri, 'size:', result.size);

      // fileCopyUri is set when copyTo is used — always prefer it over uri
      // because content:// URIs can't be read directly by RNFS on Android
      const readablePath = result.fileCopyUri || result.uri;

      setUploadedFile({
        name: result.name || 'audio_file',
        size: result.size || 0,
        mimeType: result.type || 'audio',
        uri: result.uri,
        copyPath: readablePath,
      });

    } catch (err) {
      // User pressed "Cancel" in the picker — not an error, just ignore it
      if (isErrorWithCode(err, errorCodes.OPERATION_CANCELED)) {
        debugLog('[PrevRec] Picker cancelled by user');
        return;
      }
      debugError('[PrevRec] pick error:', err);
      Alert.alert(
        'File Picker Error',
        err?.message || 'Could not open the file picker. Make sure the app was rebuilt after installing @react-native-documents/picker.'
      );
    } finally {
      setIsPickingFile(false);
    }
  }, []);

  // ── Analyse the uploaded file ─────────────────────────────────────────────
  const handleAnalyseUpload = useCallback(async () => {
    if (!uploadedFile?.copyPath) return;
    Alert.alert(
      'Analyse Uploaded File',
      `Send "${uploadedFile.name}" for heart/lung separation?\n\nUses the egrooby NMF algorithm (~1–2 sec).`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Analyse',
          onPress: async () => {
            try {
              setIsAnalysingUpload(true);
              dispatch(clearSeparationData());

              debugLog('[PrevRec] Reading uploaded file:', uploadedFile.copyPath);
              const base64Audio = await RNFS.readFile(uploadedFile.copyPath, 'base64');

              const action = await dispatch(processBase64Thunk({
                base64Audio,
                sampleRate: 44100,
                filePath: uploadedFile.copyPath,
              }));

              if (processBase64Thunk.fulfilled.match(action)) {
                debugLog('[PrevRec] Upload analysis OK → analysis screen');
                handleShowAnalysis();
              } else {
                Alert.alert('Analysis Failed',
                  action.payload || 'Separation server returned an error.');
              }
            } catch (err) {
              debugError('[PrevRec] upload analyse error:', err);
              Alert.alert('Error', err.message || 'Failed to analyse uploaded file');
            } finally {
              setIsAnalysingUpload(false);
            }
          },
        },
      ]
    );
  }, [uploadedFile, dispatch, handleShowAnalysis]);

  const handleClearUpload = useCallback(() => setUploadedFile(null), []);

  // ── Derived ───────────────────────────────────────────────────────────────
  const currentRecording = recordings.find(r => r.filePath === currentFile);
  const totalSizeMB = recordings.reduce((s, r) => s + r.fileSize, 0) / 1048576;

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

      {/* ── Header ─────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={handleBack}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('recordings_library') || 'Recordings Library'}
        </Text>
        {/* Upload button in header for quick access */}
        <TouchableOpacity
          style={styles.uploadHeaderBtn}
          onPress={handlePickFile}
          disabled={isPickingFile}
          activeOpacity={0.8}>
          {isPickingFile
            ? <ActivityIndicator size="small" color="#FFF" />
            : <Text style={styles.uploadHeaderBtnTxt}>📂 Upload</Text>}
        </TouchableOpacity>
      </View>

      {/* ── AudioPlayer bar ─────────────────────────────────────────── */}
      {currentRecording && currentFile && (
        <View style={styles.playerContainer}>
          <AudioPlayer
            recording={currentRecording}
            isPlaying={isPlaying}
            duration={duration}
            currentTime={currentTime}
            onPlay={() => handlePlay(currentRecording)}
            onPause={pauseSound}
            onStop={stopSound}
            onSeek={seekTo}
            formatTime={formatTime}
          />
        </View>
      )}

      {/* ── Upload section ──────────────────────────────────────────── */}
      <View style={styles.uploadSection}>
        {uploadedFile ? (
          <UploadedFileCard
            file={uploadedFile}
            isAnalysing={isAnalysingUpload}
            onAnalyse={handleAnalyseUpload}
            onClear={handleClearUpload}
          />
        ) : (
          <DropZone onPress={handlePickFile} isPicking={isPickingFile} />
        )}
      </View>

      {/* ── Stats ───────────────────────────────────────────────────── */}
      {recordings.length > 0 && (
        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{recordings.length}</Text>
            <Text style={styles.statLabel}>Recordings</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalSizeMB.toFixed(2)} MB</Text>
            <Text style={styles.statLabel}>Total Size</Text>
          </View>
          <View style={[styles.statCard, { backgroundColor: '#EFF6FF' }]}>
            <Text style={[styles.statValue, { color: APP_COLORS.success }]}>🔬</Text>
            <Text style={styles.statLabel}>Tap to Analyse</Text>
          </View>
        </View>
      )}

      {/* ── Legend ──────────────────────────────────────────────────── */}
      <View style={styles.legend}>
        <Text style={styles.legendTxt}>
          ▶ Play  ·  🔬 Analyse with NMF  ·  🗑 Delete
        </Text>
      </View>

      {/* ── Recordings list ─────────────────────────────────────────── */}
      <FlatList
        data={recordings}
        keyExtractor={item => item.filePath}
        contentContainerStyle={[
          styles.listContent,
          recordings.length === 0 && { flex: 1 },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
        ListHeaderComponent={
          recordings.length > 0
            ? <Text style={styles.listSectionHeader}>Recorded Files</Text>
            : null
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateIcon}>📂</Text>
            <Text style={styles.emptyStateTitle}>No Recordings Yet</Text>
            <Text style={styles.emptyStateText}>
              Start recording from your stethoscope, or upload a file above to analyse it.
            </Text>
            <TouchableOpacity style={styles.startButton} onPress={handleBack}>
              <Text style={styles.startButtonText}>Go to Devices</Text>
            </TouchableOpacity>
          </View>
        }
        renderItem={({ item }) => (
          <RecordingItemExtended
            item={item}
            isCurrentlyPlaying={currentFile === item.filePath && isPlaying}
            isAnalysing={isAnalysing && analysingFile === item.filePath}
            onPlay={handlePlay}
            onAnalyse={handleAnalyse}
            onDelete={handleDelete}
          />
        )}
      />
    </View>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.primary,
    height: 60, paddingHorizontal: SPACING.md,
    elevation: 4,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2, shadowRadius: 3,
  },
  backButton: {
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
    borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)',
    marginRight: SPACING.md,
  },
  backButtonText: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '600' },
  headerTitle: { flex: 1, color: '#FFF', fontSize: FONTS.sizes.lg, fontWeight: 'bold' },
  playerContainer: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg },
  statsContainer: { flexDirection: 'row', padding: SPACING.lg, gap: SPACING.md },
  statCard: {
    flex: 1, backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md, padding: SPACING.md,
    alignItems: 'center', borderWidth: 1, borderColor: COLORS.border,
  },
  statValue: {
    fontSize: FONTS.sizes.xl, fontWeight: 'bold',
    color: COLORS.primary, marginBottom: SPACING.xs,
  },
  statLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  legend: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
  legendTxt: {
    fontSize: FONTS.sizes.xs, color: '#64748B',
    fontWeight: '500', textAlign: 'center',
  },
  listContent: { padding: SPACING.lg },
  recCard: {
    flexDirection: 'column', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md, padding: SPACING.md,
    marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border,
  },
  recCardActive: { borderColor: APP_COLORS.primary, borderWidth: 2 },
  recInfo: { marginBottom: SPACING.sm },
  recName: {
    fontSize: FONTS.sizes.md, fontWeight: '700',
    color: '#1E3A5F', marginBottom: SPACING.xs,
  },
  recMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  recMetaTxt: { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '500' },
  recActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm },
  actionBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#64748B', alignItems: 'center', justifyContent: 'center',
  },
  analyseBtn: { backgroundColor: APP_COLORS.success },
  deleteBtn: { backgroundColor: APP_COLORS.error },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnTxt: { fontSize: 18 },
  emptyState: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: SPACING.xl, paddingVertical: 80,
  },
  emptyStateIcon: { fontSize: 64, marginBottom: SPACING.lg },
  emptyStateTitle: {
    fontSize: FONTS.sizes.xl, fontWeight: 'bold',
    color: COLORS.textPrimary, marginBottom: SPACING.sm,
  },
  emptyStateText: {
    fontSize: FONTS.sizes.md, color: COLORS.textSecondary,
    textAlign: 'center', lineHeight: 22, marginBottom: SPACING.xl,
  },
  startButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
  },
  startButtonText: { fontSize: FONTS.sizes.md, fontWeight: '600', color: COLORS.textInverse },

  // ── Header upload button ────────────────────────────────────────────────
  uploadHeaderBtn: {
    paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm,
    borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    minWidth: 84, alignItems: 'center',
  },
  uploadHeaderBtnTxt: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '700' },

  // ── Upload section ──────────────────────────────────────────────────────
  uploadSection: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.xs,
  },
  uploadDropZone: {
    borderWidth: 2, borderStyle: 'dashed',
    borderColor: (APP_COLORS.primary || '#0A7EA4') + '80',
    borderRadius: 14,
    paddingVertical: SPACING.xl, paddingHorizontal: SPACING.lg,
    alignItems: 'center',
    backgroundColor: (APP_COLORS.primary || '#0A7EA4') + '0A',
    minHeight: 136, justifyContent: 'center',
  },
  uploadDropIcon: { fontSize: 42, marginBottom: SPACING.sm },
  uploadDropTitle: {
    fontSize: FONTS.sizes.lg, fontWeight: '800',
    color: '#1E3A5F', marginBottom: SPACING.xs,
  },
  uploadDropSub: {
    fontSize: FONTS.sizes.sm, color: '#64748B',
    textAlign: 'center', lineHeight: 20, marginBottom: SPACING.sm,
  },
  uploadDropBadge: {
    backgroundColor: (APP_COLORS.primary || '#0A7EA4') + '18',
    borderRadius: 999, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs,
  },
  uploadDropBadgeTxt: {
    fontSize: FONTS.sizes.xs,
    color: APP_COLORS.primary || '#0A7EA4',
    fontWeight: '700',
  },

  // ── Uploaded file card ──────────────────────────────────────────────────
  uploadedCard: {
    backgroundColor: '#F0FDF4', borderRadius: 14,
    padding: SPACING.md, borderWidth: 1.5,
    borderColor: (APP_COLORS.success || '#22C55E') + '60',
  },
  uploadedRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    marginBottom: SPACING.md, gap: SPACING.md,
  },
  uploadedIconWrap: {
    width: 48, height: 48, borderRadius: 12,
    backgroundColor: (APP_COLORS.success || '#22C55E') + '20',
    alignItems: 'center', justifyContent: 'center',
  },
  uploadedIcon: { fontSize: 26 },
  uploadedInfo: { flex: 1 },
  uploadedName: {
    fontSize: FONTS.sizes.md, fontWeight: '700',
    color: '#1E3A5F', marginBottom: SPACING.xs,
  },
  uploadedMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  uploadedMetaTxt: { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '500' },
  uploadedActions: { flexDirection: 'row', gap: SPACING.sm },
  uploadedAnalyseBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: APP_COLORS.success || '#22C55E',
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 11, gap: SPACING.xs, minHeight: 44,
  },
  uploadedAnalyseBtnIcon: { fontSize: 16 },
  uploadedAnalyseBtnText: { fontSize: FONTS.sizes.sm, fontWeight: '700', color: '#FFF' },
  uploadedClearBtn: {
    paddingHorizontal: SPACING.md, paddingVertical: 11,
    backgroundColor: '#F1F5F9', borderRadius: BORDER_RADIUS.md,
    borderWidth: 1, borderColor: '#CBD5E1',
    alignItems: 'center', justifyContent: 'center', minHeight: 44,
  },
  uploadedClearBtnText: { fontSize: FONTS.sizes.sm, fontWeight: '600', color: '#64748B' },

  listSectionHeader: {
    fontSize: FONTS.sizes.sm, fontWeight: '800', color: '#94A3B8',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: SPACING.md,
  },
});