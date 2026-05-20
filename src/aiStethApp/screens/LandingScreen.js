import React, { useRef, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, StatusBar } from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import LottieView from 'lottie-react-native';
import { COLORS, SPACING, FONTS, BORDER_RADIUS, SHADOWS } from '../constants/theme';
import { t } from 'i18next';

export const LandingScreen = () => {
  const navigation = useNavigation();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 20,
        friction: 7,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.background} />
      
      <Animated.View style={[styles.headerContainer, { opacity: fadeAnim }]}>
        <LottieView
          source={require('../../assets/lottie/heart.json')}
          autoPlay
          loop
          style={styles.logoLottie}
        />
        <Text style={styles.title}>{t('ai_steth') || 'AiSteth'}</Text>
        <Text style={styles.subtitle}>Smart Digital Stethoscope</Text>
      </Animated.View>

      <Animated.View 
        style={[
          styles.buttonContainer, 
          { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
        ]}
      >
        {/* Button 1: Take New Recording */}
        <TouchableOpacity 
          style={styles.buttonWrapper}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('AiStethHomeScreen')}
        >
          <LinearGradient
            colors={['#4CAF93', '#5EC4A6', '#6FD9BA']}
            style={styles.gradientButton}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.buttonIcon}>🎙️</Text>
            <View style={styles.buttonTextContainer}>
              <Text style={styles.buttonTitle}>Take New Recording</Text>
              <Text style={styles.buttonSubtitle}>Connect device & record heart sounds</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </LinearGradient>
        </TouchableOpacity>

        {/* Button 2: Show Previous Recordings */}
        <TouchableOpacity 
          style={styles.buttonWrapper}
          activeOpacity={0.8}
          onPress={() => navigation.navigate('PreviousRecordingsScreen')}
        >
          <LinearGradient
            colors={['#4A90E2', '#5BA3F5', '#6BB6FF']}
            style={styles.gradientButton}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Text style={styles.buttonIcon}>📁</Text>
            <View style={styles.buttonTextContainer}>
              <Text style={styles.buttonTitle}>Previous Recordings</Text>
              <Text style={styles.buttonSubtitle}>Play or delete saved audio</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </LinearGradient>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    padding: SPACING.xl,
    justifyContent: 'center',
  },
  headerContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xl * 2,
  },
  logoLottie: {
    width: 150,
    height: 150,
    marginBottom: SPACING.lg,
  },
  title: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: '800',
    color: '#1E3A5F',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: '#64748B',
    marginTop: SPACING.xs,
    fontWeight: '500',
  },
  buttonContainer: {
    gap: SPACING.lg,
  },
  buttonWrapper: {
    borderRadius: BORDER_RADIUS.xl,
    ...SHADOWS.large,
    elevation: 8,
  },
  gradientButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.xl,
    borderRadius: BORDER_RADIUS.xl,
  },
  buttonIcon: {
    fontSize: 32,
    marginRight: SPACING.lg,
  },
  buttonTextContainer: {
    flex: 1,
  },
  buttonTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  buttonSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: 'rgba(255, 255, 255, 0.85)',
    fontWeight: '500',
  },
  chevron: {
    fontSize: 32,
    color: '#FFFFFF',
    fontWeight: '300',
    opacity: 0.8,
  },
});