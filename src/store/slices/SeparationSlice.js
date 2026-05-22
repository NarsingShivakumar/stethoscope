// src/store/slices/SeparationSlice.js  v4
//
// NEW fields vs v3:
//   heartHfScore        — T2 score (hf_ratio penalty)
//   heartActiveFraction — duty cycle active fraction
//   heartRejectionReason— human-readable rejection explanation
//   murmurDetected      — bool
//   murmurType          — "systolic" | "diastolic" | "continuous" | "benign" | null
//   murmurConfidence    — float 0-1

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { NativeModules } from 'react-native';
import {
  processAudio as apiProcessAudio,
  detectHeart   as apiDetectHeart,
  addNoise      as apiAddNoise,
} from '../../aiStethApp/api/StethApiService';
import { debugLog, debugError } from '../../config/AppConfig';

const { StethoscopeRecorder } = NativeModules;

// ── Thunk 1 ───────────────────────────────────────────────────────────────────
export const processRecordingThunk = createAsyncThunk(
  'separation/processRecording',
  async ({ filePath }, { rejectWithValue }) => {
    try {
      debugLog('[SeparationSlice] processRecording →', filePath);
      const r = await StethoscopeRecorder.processAndSendRecording(filePath);
      if (!r || r.status !== 'success')
        return rejectWithValue(r?.error || 'Separation returned no result');
      return {
        heart: r.heart, lung: r.lung,
        heartWav: r.heartWav || r.heart, lungWav: r.lungWav || r.lung,
        noiseLevel: r.noiseLevel ?? 0, signalQuality: r.signalQuality ?? 1,
        processingMs: r.processingMs ?? 0, lastFilePath: filePath,
      };
    } catch (err) {
      debugError('[SeparationSlice] processRecording error:', err);
      return rejectWithValue(err?.message || 'Processing failed');
    }
  }
);

// ── Thunk 2 ───────────────────────────────────────────────────────────────────
export const processBase64Thunk = createAsyncThunk(
  'separation/processBase64',
  async ({ base64Audio, sampleRate = 44100, filePath = null }, { rejectWithValue }) => {
    try {
      debugLog('[SeparationSlice] processBase64  sr=', sampleRate);
      const r = await apiProcessAudio(base64Audio, sampleRate);
      return {
        heart: r.heart, lung: r.lung,
        heartWav: r.heart, lungWav: r.lung,
        noiseLevel: r.noiseLevel ?? 0, signalQuality: r.signalQuality ?? 1,
        processingMs: r.processingMs ?? 0, lastFilePath: filePath,
      };
    } catch (err) {
      debugError('[SeparationSlice] processBase64 error:', err);
      return rejectWithValue(err?.userMessage || err?.message || 'Processing failed');
    }
  }
);

// ── Thunk 3: detect heart + murmur ───────────────────────────────────────────
export const detectHeartThunk = createAsyncThunk(
  'separation/detectHeart',
  async ({ base64Audio, sampleRate = 44100 }, { rejectWithValue }) => {
    try {
      debugLog('[SeparationSlice] detectHeart  sr=', sampleRate);
      const r = await apiDetectHeart(base64Audio, sampleRate);
      return {
        // Core
        heartDetected:      r.heartDetected,
        heartConfidence:    r.confidence,
        heartBpm:           r.dominant_bpm,
        // Feature scores
        heartSpectralScore:  r.spectral_score,
        heartHfScore:        r.hf_score,
        heartTransientScore: r.transient_score,
        heartDutyScore:      r.duty_score,
        // Diagnostics
        heartCentroidHz:      r.centroid_hz,
        heartHfRatio:         r.hf_ratio,
        heartNTransients:     r.n_transients,
        heartActiveFraction:  r.active_fraction,
        heartRejectionReason: r.rejection_reason,
        // v1 compat
        heartEnergyRatio:    r.energy_ratio ?? null,
        heartPeriodicity:    r.periodicity  ?? null,
        // Murmur
        murmurDetected:    r.murmur_detected,
        murmurType:        r.murmur_type,
        murmurConfidence:  r.murmur_confidence,
      };
    } catch (err) {
      debugError('[SeparationSlice] detectHeart error:', err);
      return rejectWithValue(err?.userMessage || err?.message || 'Heart detection failed');
    }
  }
);

// ── Thunk 4: add noise ────────────────────────────────────────────────────────
export const addNoiseThunk = createAsyncThunk(
  'separation/addNoise',
  async ({ base64Audio, sampleRate = 44100, noiseType = 'white', snrDb = 10 },
         { rejectWithValue }) => {
    try {
      debugLog('[SeparationSlice] addNoise  type=', noiseType, 'snr=', snrDb);
      const r = await apiAddNoise(base64Audio, sampleRate, noiseType, snrDb);
      return { noisyAudio: r.audio, noiseType: r.noiseType, snrDb: r.snrDb };
    } catch (err) {
      debugError('[SeparationSlice] addNoise error:', err);
      return rejectWithValue(err?.userMessage || err?.message || 'Noise injection failed');
    }
  }
);

// ── Initial state ─────────────────────────────────────────────────────────────
const initial = {
  // Separation
  isProcessing:  false,
  progress:      { message: '', percent: 0 },
  heart:         null,
  lung:          null,
  heartWav:      null,
  lungWav:       null,
  noiseLevel:    null,
  signalQuality: null,
  processingMs:  null,
  error:         null,
  lastFilePath:  null,

  // Heart detection — core
  isDetectingHeart:     false,
  heartDetected:        null,
  heartConfidence:      null,
  heartBpm:             null,
  heartDetectError:     null,
  heartRejectionReason: null,

  // Heart detection — v3 feature scores
  heartSpectralScore:  null,
  heartHfScore:        null,
  heartTransientScore: null,
  heartDutyScore:      null,

  // Heart detection — diagnostics
  heartCentroidHz:     null,
  heartHfRatio:        null,
  heartNTransients:    null,
  heartActiveFraction: null,

  // v1 compat
  heartEnergyRatio:    null,
  heartPeriodicity:    null,

  // Murmur
  murmurDetected:   null,
  murmurType:       null,
  murmurConfidence: null,

  // Noise injection
  isAddingNoise: false,
  noisyAudio:    null,
  noiseType:     null,
  snrDb:         null,
  addNoiseError: null,
};

// ── Shared handlers ───────────────────────────────────────────────────────────
const _pending = s => {
  s.isProcessing = true;
  s.error        = null;
  s.heart        = null;
  s.lung         = null;
  s.progress     = { message: 'Processing…', percent: 10 };
};
const _fulfilled = (s, { payload: p }) => {
  s.isProcessing  = false;
  s.heart         = p.heart;
  s.lung          = p.lung;
  s.heartWav      = p.heartWav;
  s.lungWav       = p.lungWav;
  s.noiseLevel    = p.noiseLevel;
  s.signalQuality = p.signalQuality;
  s.processingMs  = p.processingMs;
  s.lastFilePath  = p.lastFilePath;
  s.progress      = { message: 'Done', percent: 100 };
};
const _rejected = (s, { payload }) => {
  s.isProcessing = false;
  s.error        = payload || 'Unknown error';
  s.progress     = { message: '', percent: 0 };
};

// ── Slice ─────────────────────────────────────────────────────────────────────
const separationSlice = createSlice({
  name: 'separation',
  initialState: initial,
  reducers: {
    setProgress:         (s, { payload }) => { s.progress = payload; },
    clearSeparationData: ()               => initial,
    clearSepError:       s               => { s.error = null; },

    clearHeartDetection: s => {
      s.heartDetected        = null;
      s.heartConfidence      = null;
      s.heartBpm             = null;
      s.heartDetectError     = null;
      s.heartRejectionReason = null;
      s.heartSpectralScore   = null;
      s.heartHfScore         = null;
      s.heartTransientScore  = null;
      s.heartDutyScore       = null;
      s.heartCentroidHz      = null;
      s.heartHfRatio         = null;
      s.heartNTransients     = null;
      s.heartActiveFraction  = null;
      s.heartEnergyRatio     = null;
      s.heartPeriodicity     = null;
      s.murmurDetected       = null;
      s.murmurType           = null;
      s.murmurConfidence     = null;
    },

    clearNoisyAudio: s => {
      s.noisyAudio    = null;
      s.noiseType     = null;
      s.snrDb         = null;
      s.addNoiseError = null;
    },
  },

  extraReducers: b => {
    b
      .addCase(processRecordingThunk.pending,   _pending)
      .addCase(processRecordingThunk.fulfilled, _fulfilled)
      .addCase(processRecordingThunk.rejected,  _rejected)
      .addCase(processBase64Thunk.pending,      _pending)
      .addCase(processBase64Thunk.fulfilled,    _fulfilled)
      .addCase(processBase64Thunk.rejected,     _rejected)

      // detectHeart
      .addCase(detectHeartThunk.pending, s => {
        s.isDetectingHeart = true;
        s.heartDetectError = null;
      })
      .addCase(detectHeartThunk.fulfilled, (s, { payload: p }) => {
        s.isDetectingHeart      = false;
        s.heartDetected         = p.heartDetected;
        s.heartConfidence       = p.heartConfidence;
        s.heartBpm              = p.heartBpm;
        s.heartSpectralScore    = p.heartSpectralScore;
        s.heartHfScore          = p.heartHfScore;
        s.heartTransientScore   = p.heartTransientScore;
        s.heartDutyScore        = p.heartDutyScore;
        s.heartCentroidHz       = p.heartCentroidHz;
        s.heartHfRatio          = p.heartHfRatio;
        s.heartNTransients      = p.heartNTransients;
        s.heartActiveFraction   = p.heartActiveFraction;
        s.heartRejectionReason  = p.heartRejectionReason;
        s.heartEnergyRatio      = p.heartEnergyRatio;
        s.heartPeriodicity      = p.heartPeriodicity;
        s.murmurDetected        = p.murmurDetected;
        s.murmurType            = p.murmurType;
        s.murmurConfidence      = p.murmurConfidence;
      })
      .addCase(detectHeartThunk.rejected, (s, { payload }) => {
        s.isDetectingHeart = false;
        s.heartDetectError = payload || 'Heart detection failed';
      })

      // addNoise
      .addCase(addNoiseThunk.pending, s => {
        s.isAddingNoise = true;
        s.addNoiseError = null;
        s.noisyAudio    = null;
      })
      .addCase(addNoiseThunk.fulfilled, (s, { payload: p }) => {
        s.isAddingNoise = false;
        s.noisyAudio    = p.noisyAudio;
        s.noiseType     = p.noiseType;
        s.snrDb         = p.snrDb;
      })
      .addCase(addNoiseThunk.rejected, (s, { payload }) => {
        s.isAddingNoise = false;
        s.addNoiseError = payload || 'Noise injection failed';
      });
  },
});

// ── Actions ───────────────────────────────────────────────────────────────────
export const {
  setProgress, clearSeparationData, clearSepError,
  clearHeartDetection, clearNoisyAudio,
} = separationSlice.actions;

// ── Selectors — Separation ────────────────────────────────────────────────────
export const selectIsProcessing    = s => s.separation.isProcessing;
export const selectProgress        = s => s.separation.progress;
export const selectHeart           = s => s.separation.heart;
export const selectLung            = s => s.separation.lung;
export const selectHeartWav        = s => s.separation.heartWav;
export const selectLungWav         = s => s.separation.lungWav;
export const selectNoiseLevel      = s => s.separation.noiseLevel;
export const selectSignalQuality   = s => s.separation.signalQuality;
export const selectProcessingMs    = s => s.separation.processingMs;
export const selectSepError        = s => s.separation.error;
export const selectHasResults      = s => !!(s.separation.heart && s.separation.lung);
export const selectLastFilePath    = s => s.separation.lastFilePath;

// ── Selectors — Heart detection ───────────────────────────────────────────────
export const selectIsDetectingHeart    = s => s.separation.isDetectingHeart;
export const selectHeartDetected       = s => s.separation.heartDetected;
export const selectHeartConfidence     = s => s.separation.heartConfidence;
export const selectHeartBpm            = s => s.separation.heartBpm;
export const selectHeartDetectError    = s => s.separation.heartDetectError;
export const selectHeartRejectionReason= s => s.separation.heartRejectionReason;
export const selectHeartSpectralScore  = s => s.separation.heartSpectralScore;
export const selectHeartHfScore        = s => s.separation.heartHfScore;
export const selectHeartTransientScore = s => s.separation.heartTransientScore;
export const selectHeartDutyScore      = s => s.separation.heartDutyScore;
export const selectHeartCentroidHz     = s => s.separation.heartCentroidHz;
export const selectHeartHfRatio        = s => s.separation.heartHfRatio;
export const selectHeartNTransients    = s => s.separation.heartNTransients;
export const selectHeartActiveFraction = s => s.separation.heartActiveFraction;
export const selectHeartEnergyRatio    = s => s.separation.heartEnergyRatio;
export const selectHeartPeriodicity    = s => s.separation.heartPeriodicity;

// ── Selectors — Murmur ────────────────────────────────────────────────────────
export const selectMurmurDetected   = s => s.separation.murmurDetected;
export const selectMurmurType       = s => s.separation.murmurType;
export const selectMurmurConfidence = s => s.separation.murmurConfidence;

// ── Selectors — Noise injection ───────────────────────────────────────────────
export const selectIsAddingNoise  = s => s.separation.isAddingNoise;
export const selectNoisyAudio     = s => s.separation.noisyAudio;
export const selectNoiseType      = s => s.separation.noiseType;
export const selectSnrDb          = s => s.separation.snrDb;
export const selectAddNoiseError  = s => s.separation.addNoiseError;

export const { reducer: separationReducer } = separationSlice;
export default separationSlice.reducer;