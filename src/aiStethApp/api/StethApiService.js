// src/aiStethApp/api/StethApiService.js
//
// COMPLETE REPLACEMENT for AiStethApiService.js
//
// REMOVED: AISTETH_CREDENTIALS (tenantId, keySecret, keyId)
//          developer.aisteth.com URLs
//          createPatient, getPatientList, uploadAudioFile
//          createPHR, getPHRList, getAIAnalysis
//          getVisualizationUrl, getAudioUrl
//
// ADDED:   processAudio(base64Audio, sampleRate)
//          healthCheck()
//
// The old named exports are kept as rejected-promise stubs so any
// remaining import sites fail loudly rather than silently.

import axios from 'axios';
// import { APP_CONFIG } from '../../config/AppConfig';
import { APP_CONFIG, debugLog, debugError } from '../../config/AppConfig';

// ── Axios instance pointing at our Flask backend ───────────────────────────────
const api = axios.create({
  baseURL: APP_CONFIG.STETH_SERVER_URL,
  timeout: 90_000,  // 90 s covers NMF on slow hardware + large uploads
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(
  cfg  => { debugLog('[StethAPI] →', cfg.method?.toUpperCase(), cfg.url); return cfg; },
  err  => { debugError('[StethAPI] request error:', err); return Promise.reject(err); },
);

api.interceptors.response.use(
  res  => { debugLog('[StethAPI] ←', res.status, res.config.url); return res; },
  err  => {
    if (err.response)     debugError('[StethAPI] server error:', err.response.status, err.response.data);
    else if (err.request) debugError('[StethAPI] no response (network error)');
    else                  debugError('[StethAPI] setup error:', err.message);
    return Promise.reject(err);
  },
);

const toApiError = err => {
  if (err.response) return {
    code: 'SERVER_ERROR',
    status: err.response.status,
    message: err.response.data?.error || err.message,
    userMessage: `Server error ${err.response.status} — please try again.`,
  };
  if (err.request) return {
    code: 'NETWORK_ERROR',
    message: 'No response',
    userMessage: 'Cannot reach the separation server. Check your network or server IP in AppConfig.js.',
  };
  return { code: 'UNKNOWN_ERROR', message: err.message,
           userMessage: 'Something went wrong — please try again.' };
};

// ══════════════════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Send audio to the Flask NMF separation backend.
 *
 * @param {string} base64Audio   Base64-encoded PCM-16 mono (WAV preferred)
 * @param {number} sampleRate    Original SR in Hz (default 44100)
 * @returns {Promise<{
 *   heart: string, lung: string,
 *   noiseLevel: number, signalQuality: number,
 *   processingMs: number, status: string
 * }>}
 */
export const processAudio = async (base64Audio, sampleRate = 44100) => {
  try {
    debugLog('[StethAPI] processAudio  sr=', sampleRate, 'payloadLen=', base64Audio.length);
    const res = await api.post('/process_audio', {
      audio: base64Audio,
      sample_rate: sampleRate,
    });
    const { heart, lung, noise_level, signal_quality, processing_ms, status } = res.data;
    if (status !== 'success') throw new Error(res.data.error || 'Unknown separation error');
    debugLog('[StethAPI] OK  quality=', signal_quality, 'noise=', noise_level, 'ms=', processing_ms);
    return { heart, lung, noiseLevel: noise_level, signalQuality: signal_quality,
             processingMs: processing_ms, status };
  } catch (err) {
    debugError('[StethAPI] processAudio error:', err);
    throw toApiError(err);
  }
};

/** Quick liveness check — call before sending audio. */
export const healthCheck = async () => {
  try {
    const res = await api.get('/health', { timeout: 5000 });
    return res.data?.status === 'ok';
  } catch { return false; }
};

// ── Stubs for old AiSteth exports so existing import sites don't crash ────────
// Remove each stub once you've cleaned up the call site.
const _removed = name => () => Promise.reject(
  new Error(`[AiSteth REMOVED] ${name}() — AiSteth API has been replaced.`)
);

export const createPatient        = _removed('createPatient');
export const getPatientList       = _removed('getPatientList');
export const uploadAudioFile      = _removed('uploadAudioFile');
export const createPHR            = _removed('createPHR');
export const getPHRList           = _removed('getPHRList');
export const getAIAnalysis        = _removed('getAIAnalysis');
export const getVisualizationUrl  = _removed('getVisualizationUrl');
export const getAudioUrl          = _removed('getAudioUrl');

// generateFileNumber / getCurrentConfig were harmless utility fns — kept as no-ops
export const generateFileNumber = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};
export const getCurrentConfig = () => ({
  server: APP_CONFIG.STETH_SERVER_URL,
  backend: 'local-nmf',
});

export default { processAudio, healthCheck, generateFileNumber, getCurrentConfig };