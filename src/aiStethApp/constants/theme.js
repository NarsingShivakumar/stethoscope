import { appColor } from "../../assets/colors";

// src/constants/theme.js
export const COLORS = {
  // Primary medical blue
  primary: appColor,
  primaryDark: '#1E40AF',
  primaryLight: '#60A5FA',

  // Accent colors
  accent: '#10B981',
  accentDark: '#059669',
  warning: '#F59E0B',
  error: '#EF4444',

  // Neutral colors
  background: '#e8fcfc',
  surface: '#FFFFFF',
  surfaceSecondary: '#F1F5F9',
  border: '#E2E8F0',

  // Text colors
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  textTertiary: '#94A3B8',
  textInverse: '#FFFFFF',

  // Status colors
  success: '#10B981',
  info: '#3B82F6',
  disabled: '#CBD5E1',

  // Recording states
  recording: appColor,
  paused: '#F59E0B',
  connected: '#10B981',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const FONTS = {
  regular: 'System',
  medium: 'System',
  bold: 'System',
  sizes: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 24,
    xxl: 32,
  },
};

export const SHADOWS = {
  small: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
  },
  medium: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 4,
  },
  large: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
};

export const BORDER_RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
};
