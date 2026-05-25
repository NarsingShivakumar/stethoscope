// src/aiStethApp/api/StethApiService.js v3.1
// FIX: detectHeart sampleRate default changed 44100 → 4000
//      (NMF separation output is always at TARGET_SR=4000 Hz)

import axios from 'axios';
import { APP_CONFIG, debugLog, debugError } from '../../config/AppConfig';

const api = axios.create({
  baseURL: APP_CONFIG.STETH_SERVER_URL,
  timeout: 90_000,
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
  return { code: 'UNKNOWN_ERROR', message: err.message, userMessage: 'Something went wrong — please try again.' };
};

export const processAudio = async (base64Audio, sampleRate = 44100) => {
  try {
    debugLog('[StethAPI] processAudio sr=', sampleRate, 'payloadLen=', base64Audio.length);
    const res = await api.post('/process_audio', { audio: base64Audio, sample_rate: sampleRate });
    const { heart, lung, noise_level, signal_quality, processing_ms, status } = res.data;
    if (status !== 'success') throw new Error(res.data.error || 'Unknown separation error');
    return { heart, lung, noiseLevel: noise_level, signalQuality: signal_quality, processingMs: processing_ms, status };
  } catch (err) {
    debugError('[StethAPI] processAudio error:', err);
    throw toApiError(err);
  }
};

export const healthCheck = async () => {
  try {
    const res = await api.get('/health', { timeout: 5000 });
    return res.data?.status === 'ok';
  } catch { return false; }
};

export const addNoise = async (base64Audio, sampleRate = 44100, noiseType = 'white', snrDb = 10) => {
  try {
    debugLog('[StethAPI] addNoise type=', noiseType, 'snr=', snrDb, 'sr=', sampleRate);
    const res = await api.post('/add_noise', {
      audio: base64Audio, sample_rate: sampleRate, noise_type: noiseType, snr_db: snrDb,
    });
    const { audio, noise_type, snr_db, original_rms, status } = res.data;
    if (status !== 'success') throw new Error(res.data.error || 'Noise injection failed');
    return { audio, noiseType: noise_type, snrDb: snr_db, originalRms: original_rms, status };
  } catch (err) {
    debugError('[StethAPI] addNoise error:', err);
    throw toApiError(err);
  }
};

/**
 * FIX v3.1: sampleRate default changed to 4000 Hz.
 * The NMF separation always outputs heart audio at TARGET_SR=4000 Hz.
 * Sending 44100 causes the backend to interpret 20–150 Hz band at the
 * wrong frequency range (11x shift), making heart detection unreliable.
 */
export const detectHeart = async (base64Audio, sampleRate = 4000) => {
  try {
    debugLog('[StethAPI] detectHeart sr=', sampleRate, 'payloadLen=', base64Audio.length);
    const res = await api.post('/detect_heart', { audio: base64Audio, sample_rate: sampleRate });
    const d = res.data;
    if (d.status !== 'success') throw new Error(d.error || 'Heart detection failed');
    debugLog('[StethAPI] detectHeart OK detected=', d.heart_detected, 'conf=', d.confidence, 'murmur=', d.murmur_type);
    return {
      // Core
      heartDetected: d.heart_detected,
      confidence: d.confidence,
      dominant_bpm: d.dominant_bpm,
      // Feature scores
      spectral_score: d.spectral_score,
      hf_score: d.hf_score,        // ← now returned by backend
      transient_score: d.transient_score,
      duty_score: d.duty_score,
      // Diagnostics
      centroid_hz: d.centroid_hz,
      hf_ratio: d.hf_ratio,
      n_transients: d.n_transients,
      active_fraction: d.active_fraction, // ← now returned by backend
      rejection_reason: d.rejection_reason,// ← now returned by backend
      // v1 compat
      energy_ratio: d.energy_ratio ?? null,
      periodicity: d.periodicity ?? null,
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
export const analyzeAudioFile = async (fileUri) => {
  const formData = new FormData();
  formData.append('audio', {
    uri: fileUri,
    name: 'audio.wav',
    type: 'audio/wav',
  });

  try {
    const res = await api.post('/analyze-audio', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180000,
    });
    return res.data;
  } catch (err) {
    throw toApiError(err);
  }
};

// ── Stubs for removed AiSteth exports ─────────────────────────────────────────
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

export const generateFileNumber = (length = 6) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
};
export const getCurrentConfig = () => ({ server: APP_CONFIG.STETH_SERVER_URL, backend: 'local-nmf' });

export default { processAudio, healthCheck, generateFileNumber, getCurrentConfig, addNoise, detectHeart };