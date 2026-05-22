// src/config/AppConfig.js
/**
 * =======================================
 * PRODUCTION CONFIGURATION
 * =======================================
 * CHANGED: added STETH_SERVER_URL for NMF separation backend
 *          added ENABLE_DEBUG_LOGS set to false in production
 * REMOVED: USE_TESTING_ENVIRONMENT (AiSteth is gone)
 */

export const APP_CONFIG = {
  // Enable/Disable debug console logs
  ENABLE_DEBUG_LOGS: true, // auto-true in dev, false in production

  // Enable/Disable Recordings List Section
  ENABLE_RECORDINGS_LIST: true,

  // ── NEW: NMF Separation Backend ──────────────────────────────────────────
  // Set to your server's LAN IP when running on a physical device.
  // Android emulator → 10.0.2.2 reaches the host machine's localhost.
  STETH_SERVER_URL: true
    ? 'http://192.168.0.116:5000'   // emulator
    : 'http://192.168.0.116:5000', // physical device — update this IP
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