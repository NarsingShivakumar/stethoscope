// src/aiStethApp/config/AppConfig.js
/**
 * =======================================
 * PRODUCTION CONFIGURATION
 * =======================================
 */

export const APP_CONFIG = {
  // Enable/Disable debug console logs
  ENABLE_DEBUG_LOGS: false, // Set to false in production

  // Enable/Disable Recordings List Section
  ENABLE_RECORDINGS_LIST: true, // Set to true to enable recordings list

  // Environment
  USE_TESTING_ENVIRONMENT: false, // Switch to false for production
};

// Debug logger utility
export const debugLog = (...args) => {
  if (APP_CONFIG.ENABLE_DEBUG_LOGS) {
    console.log(...args);
  }
};

export const debugError = (...args) => {
  if (APP_CONFIG.ENABLE_DEBUG_LOGS) {
    console.error(...args);
  }
};

export const debugWarn = (...args) => {
  if (APP_CONFIG.ENABLE_DEBUG_LOGS) {
    console.warn(...args);
  }
};
