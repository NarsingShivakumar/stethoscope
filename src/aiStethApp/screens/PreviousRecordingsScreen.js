// src/aiStethApp/screens/PreviousRecordingsScreen.js
import React, { useCallback, useState } from 'react';
import {
    View, StyleSheet, TouchableOpacity, Text, StatusBar,
    Alert, ActivityIndicator, FlatList, RefreshControl, NativeModules,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useDispatch, useSelector } from 'react-redux';
import RNFS from 'react-native-fs';

import { useStethoscope } from '../hooks/useStethoscope';
import { useAudioPlayer }  from '../hooks/useAudioPlayer';
import { AudioPlayer }     from '../components/AudioPlayer';
import { COLORS, SPACING, FONTS, BORDER_RADIUS } from '../constants/theme';
import { APP_COLORS }      from '../../assets/colors';
import { t } from 'i18next';
import {
    processBase64Thunk,
    selectIsProcessing,
    clearSeparationData,
} from '../../store/slices/SeparationSlice';
import { debugLog, debugError } from '../../config/AppConfig';

const { StethoscopeRecorder } = NativeModules;

// ── Extended recording card with Analyse button ───────────────────────────────
const RecordingItemExtended = React.memo(({
    item, isCurrentlyPlaying, isAnalysing,
    onPlay, onAnalyse, onDelete,
}) => {
    const fmtSize = b => b < 1048576
        ? (b / 1024).toFixed(1) + ' KB'
        : (b / 1048576).toFixed(2) + ' MB';
    const fmtDur = b => {
        const s = Math.max(0, b - 44) / 88200; // 44100 Hz * 2 bytes
        return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    };

    return (
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
                {/* Analyse (new) */}
                <TouchableOpacity
                    style={[styles.actionBtn, styles.analyseBtn, isAnalysing && styles.actionBtnDisabled]}
                    onPress={() => onAnalyse(item)}
                    disabled={isAnalysing}>
                    {isAnalysing
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <Text style={styles.actionBtnTxt}>🔬</Text>
                    }
                </TouchableOpacity>
                {/* Delete */}
                <TouchableOpacity
                    style={[styles.actionBtn, styles.deleteBtn]}
                    onPress={() => onDelete(item)}>
                    <Text style={styles.actionBtnTxt}>🗑</Text>
                </TouchableOpacity>
            </View>
        </View>
    );
});

// ── Screen ────────────────────────────────────────────────────────────────────
export const PreviousRecordingsScreen = ({ 
    stethoscope: propStethoscope, 
    audioPlayer: propAudioPlayer, 
    onBackToDevices, 
    onShowAnalysis 
}) => {
    const navigation  = useNavigation();
    const dispatch    = useDispatch();
    const isAnalysing = useSelector(selectIsProcessing);

    // FIX: Safely initialize hooks if they weren't passed as props
    const localStethoscope = useStethoscope();
    const localAudioPlayer = useAudioPlayer();

    const stethoscope = propStethoscope || localStethoscope;
    const audioPlayer = propAudioPlayer || localAudioPlayer;

    const {
        playSound, stopSound, pauseSound, seekTo,
        isPlaying, currentFile, duration, currentTime, formatTime,
    } = audioPlayer;

    const { recordings, loadRecordings, deleteRecording } = stethoscope;

    const [refreshing,    setRefreshing]    = useState(false);
    const [analysingFile, setAnalysingFile] = useState(null);

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadRecordings();
        setRefreshing(false);
    };

    // ── Safe Navigation Handlers ──────────────────────────────────────────────
    const handleBack = useCallback(() => {
        if (onBackToDevices) onBackToDevices();
        else navigation.goBack();
    }, [onBackToDevices, navigation]);

    const handleShowAnalysis = useCallback(() => {
        if (onShowAnalysis) onShowAnalysis();
        else navigation.navigate('AiStethHomeScreen'); // Or wherever your analysis screen is
    }, [onShowAnalysis, navigation]);

    // ── Play ──────────────────────────────────────────────────────────────────
    const handlePlay = useCallback(item => {
        if (currentFile === item.filePath && isPlaying) pauseSound();
        else playSound(item.filePath, () => debugLog('[PrevRec] Done:', item.fileName));
    }, [currentFile, isPlaying, playSound, pauseSound]);

    // ── Analyse — new feature ─────────────────────────────────────────────────
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
                                filePath:   item.filePath,
                            }));

                            if (processBase64Thunk.fulfilled.match(action)) {
                                debugLog('[PrevRec] Separation OK → analysis screen');
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

    const currentRecording = recordings.find(r => r.filePath === currentFile);
    const totalSizeMB = recordings.reduce((s, r) => s + r.fileSize, 0) / 1048576;

    return (
        <View style={styles.container}>
            <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />

            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={handleBack}>
                    <Text style={styles.backButtonText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.headerTitle}>{t('recordings_library') || 'Recordings Library'}</Text>
            </View>

            {/* AudioPlayer bar */}
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

            {/* Stats */}
            {recordings.length > 0 && (
                <View style={styles.statsContainer}>
                    <View style={styles.statCard}>
                        <Text style={styles.statValue}>{recordings.length}</Text>
                        <Text style={styles.statLabel}>Total Files</Text>
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

            {/* Legend */}
            <View style={styles.legend}>
                <Text style={styles.legendTxt}>▶ Play  ·  🔬 Analyse with NMF  ·  🗑 Delete</Text>
            </View>

            {/* List */}
            <FlatList
                data={recordings}
                keyExtractor={item => item.filePath}
                contentContainerStyle={[styles.listContent, recordings.length === 0 && { flex: 1 }]}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
                }
                ListEmptyComponent={
                    <View style={styles.emptyState}>
                        <Text style={styles.emptyStateIcon}>📂</Text>
                        <Text style={styles.emptyStateTitle}>No Recordings Yet</Text>
                        <Text style={styles.emptyStateText}>
                            Start recording audio from your stethoscope to see recordings here.
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

const styles = StyleSheet.create({
    container:      { flex: 1, backgroundColor: COLORS.background },
    header:         { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.primary, height: 60, paddingHorizontal: SPACING.md, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3 },
    backButton:     { paddingVertical: SPACING.xs, paddingHorizontal: SPACING.sm, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.15)', marginRight: SPACING.md },
    backButtonText: { color: '#FFF', fontSize: FONTS.sizes.sm, fontWeight: '600' },
    headerTitle:    { color: '#FFF', fontSize: FONTS.sizes.lg, fontWeight: 'bold' },
    playerContainer:{ paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg },
    statsContainer: { flexDirection: 'row', padding: SPACING.lg, gap: SPACING.md },
    statCard:       { flex: 1, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
    statValue:      { fontSize: FONTS.sizes.xl, fontWeight: 'bold', color: COLORS.primary, marginBottom: SPACING.xs },
    statLabel:      { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
    legend:         { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.sm },
    legendTxt:      { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '500', textAlign: 'center' },
    listContent:    { padding: SPACING.lg },
    recCard:        { flexDirection: 'column', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, marginBottom: SPACING.md, borderWidth: 1, borderColor: COLORS.border },
    recCardActive:  { borderColor: APP_COLORS.primary, borderWidth: 2 },
    recInfo:        { marginBottom: SPACING.sm },
    recName:        { fontSize: FONTS.sizes.md, fontWeight: '700', color: '#1E3A5F', marginBottom: SPACING.xs },
    recMeta:        { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
    recMetaTxt:     { fontSize: FONTS.sizes.xs, color: '#64748B', fontWeight: '500' },
    recActions:     { flexDirection: 'row', justifyContent: 'flex-end', gap: SPACING.sm },
    actionBtn:      { width: 44, height: 44, borderRadius: 22, backgroundColor: '#64748B', alignItems: 'center', justifyContent: 'center' },
    analyseBtn:     { backgroundColor: APP_COLORS.success },
    deleteBtn:      { backgroundColor: APP_COLORS.error },
    actionBtnDisabled: { opacity: 0.5 },
    actionBtnTxt:   { fontSize: 18 },
    emptyState:     { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: SPACING.xl, paddingVertical: 80 },
    emptyStateIcon: { fontSize: 64, marginBottom: SPACING.lg },
    emptyStateTitle:{ fontSize: FONTS.sizes.xl, fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: SPACING.sm },
    emptyStateText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: SPACING.xl },
    startButton:    { backgroundColor: COLORS.primary, paddingHorizontal: SPACING.xl, paddingVertical: SPACING.md, borderRadius: BORDER_RADIUS.md },
    startButtonText:{ fontSize: FONTS.sizes.md, fontWeight: '600', color: COLORS.textInverse },
});