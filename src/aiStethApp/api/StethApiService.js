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
// NEW in v3:
//   addNoise(base64Audio, sampleRate, noiseType, snrDb)
//   detectHeart(base64Audio, sampleRate)
//
// Everything else (processAudio, healthCheck, stubs) preserved exactly.

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
  cfg => { debugLog('[StethAPI] →', cfg.method?.toUpperCase(), cfg.url); return cfg; },
  err => { debugError('[StethAPI] request error:', err); return Promise.reject(err); },
);

api.interceptors.response.use(
  res => { debugLog('[StethAPI] ←', res.status, res.config.url); return res; },
  err => {
    if (err.response) debugError('[StethAPI] server error:', err.response.status, err.response.data);
    else if (err.request) debugError('[StethAPI] no response (network error)');
    else debugError('[StethAPI] setup error:', err.message);
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
  return {
    code: 'UNKNOWN_ERROR', message: err.message,
    userMessage: 'Something went wrong — please try again.'
  };
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
    return {
      heart, lung, noiseLevel: noise_level, signalQuality: signal_quality,
      processingMs: processing_ms, status
    };
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

// ── NEW: addNoise ─────────────────────────────────────────────────────────────
/**
 * Inject noise into audio at a given SNR.
 *
 * @param {string} base64Audio   Base64-encoded PCM-16 mono WAV
 * @param {number} sampleRate    Original SR in Hz (default 44100)
 * @param {string} noiseType     "voice" | "white" | "pink" | "brown"
 * @param {number} snrDb         Signal-to-noise ratio in dB (default 10)
 * @returns {Promise<{ audio: string, noiseType: string, snrDb: number,
 *                     originalRms: number, status: string }>}
 */
export const addNoise = async (
  base64Audio,
  sampleRate = 44100,
  noiseType = 'white',
  snrDb = 10,
) => {
  try {
    debugLog('[StethAPI] addNoise  type=', noiseType, 'snr=', snrDb, 'sr=', sampleRate);
    const res = await api.post('/add_noise', {
      audio: base64Audio,
      sample_rate: sampleRate,
      noise_type: noiseType,
      snr_db: snrDb,
    });
    const { audio, noise_type, snr_db, original_rms, status } = res.data;
    if (status !== 'success') throw new Error(res.data.error || 'Noise injection failed');
    debugLog('[StethAPI] addNoise OK  originalRms=', original_rms);
    return { audio, noiseType: noise_type, snrDb: snr_db, originalRms: original_rms, status };
  } catch (err) {
    debugError('[StethAPI] addNoise error:', err);
    throw toApiError(err);
  }
};

// ── NEW: detectHeart ──────────────────────────────────────────────────────────
/**
 * Detect whether heart sound is present in audio.
 *
 * @param {string} base64Audio   Base64-encoded PCM-16 mono WAV
 * @param {number} sampleRate    Original SR in Hz (default 44100)
 * @returns {Promise<{
 *   heartDetected: boolean,
 *   confidence:    number,   // 0-1
 *   energyRatio:   number,   // fraction of energy in 20-150 Hz band
 *   periodicity:   number,   // autocorrelation peak strength
 *   dominantBpm:   number | null,
 *   status:        string,
 * }>}
 */
export const detectHeart = async (base64Audio, sampleRate = 44100) => {
  try {
    debugLog('[StethAPI] detectHeart  sr=', sampleRate, 'payloadLen=', base64Audio.length);
    const res = await api.post('/detect_heart', {
      audio: base64Audio,
      sample_rate: sampleRate,
    });
    const d = res.data;
    if (d.status !== 'success') throw new Error(d.error || 'Heart detection failed');
    debugLog('[StethAPI] detectHeart OK  detected=', d.heart_detected,
      'conf=', d.confidence, 'murmur=', d.murmur_type);
    return {
      // Core
      heartDetected: d.heart_detected,
      confidence: d.confidence,
      dominant_bpm: d.dominant_bpm,
      // Feature scores
      spectral_score: d.spectral_score,
      hf_score: d.hf_score,
      transient_score: d.transient_score,
      duty_score: d.duty_score,
      // Diagnostics
      centroid_hz: d.centroid_hz,
      hf_ratio: d.hf_ratio,
      n_transients: d.n_transients,
      active_fraction: d.active_fraction,
      rejection_reason: d.rejection_reason,
      // v1 compat
      energyRatio: d.energy_ratio,
      periodicity: d.periodicity,
      // Murmur
      murmur_detected: d.murmur_detected,
      murmur_type: d.murmur_type,
      murmur_confidence: d.murmur_confidence,
      status: d.status,
    };
  } catch (err) {
    debugError('[StethAPI] detectHeart error:', err);
    throw toApiError(err);
  }
};

// ── Stubs for old AiSteth exports so existing import sites don't crash ────────
// Remove each stub once you've cleaned up the call site.
const _removed = name => () => Promise.reject(
  new Error(`[AiSteth REMOVED] ${name}() — AiSteth API has been replaced.`)
);

export const createPatient = _removed('createPatient');
export const getPatientList = _removed('getPatientList');
export const uploadAudioFile = _removed('uploadAudioFile');
export const createPHR = _removed('createPHR');
export const getPHRList = _removed('getPHRList');
export const getAIAnalysis = _removed('getAIAnalysis');
export const getVisualizationUrl = _removed('getVisualizationUrl');
export const getAudioUrl = _removed('getAudioUrl');

// generateFileNumber / getCurrentConfig were harmless utility fns — kept as no-ops
export const generateFileNumber = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};
export const getCurrentConfig = () => ({
  server: APP_CONFIG.STETH_SERVER_URL,
  backend: 'local-nmf',
});

export default { processAudio, healthCheck, generateFileNumber, getCurrentConfig, addNoise, detectHeart };