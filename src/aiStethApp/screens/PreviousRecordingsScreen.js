import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useStethoscope } from '../hooks/useStethoscope';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { RecordingsListSection } from '../components/sections/RecordingsListSection';
import { COLORS, SPACING, FONTS } from '../constants/theme';
import { t } from 'i18next';

export const PreviousRecordingsScreen = () => {
  const navigation = useNavigation();
  
  // Initialize the hooks required by the RecordingsListSection
  const stethoscope = useStethoscope();
  const audioPlayer = useAudioPlayer();

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.primary} />
      
      {/* Custom Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('recordings_library') || 'Recordings Library'}</Text>
      </View>

      {/* Injecting your existing component */}
      <RecordingsListSection
        stethoscope={stethoscope}
        audioPlayer={audioPlayer}
        onBackToDevices={() => navigation.goBack()}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
    height: 60,
    paddingHorizontal: SPACING.md,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  backButton: {
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginRight: SPACING.md,
  },
  backButtonText: {
    color: '#FFF',
    fontSize: FONTS.sizes.sm,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#FFF',
    fontSize: FONTS.sizes.lg,
    fontWeight: 'bold',
  },
});