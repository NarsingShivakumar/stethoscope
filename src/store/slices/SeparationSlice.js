// src/store/slices/SeparationSlice.js v5

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { NativeModules } from 'react-native';
import {
  processAudio as apiProcessAudio,
  detectHeart as apiDetectHeart,
  addNoise as apiAddNoise,
  analyzeAudioFile,
} from '../../aiStethApp/api/StethApiService';
import { debugLog, debugError } from '../../config/AppConfig';

const { StethoscopeRecorder } = NativeModules;

export const processRecordingThunk = createAsyncThunk(
  'separation/processRecording',
  async ({ filePath }, { rejectWithValue }) => {
    try {
      const r = await StethoscopeRecorder.processAndSendRecording(filePath);
      if (!r || r.status !== 'success') {
        return rejectWithValue(r?.error || 'Separation returned no result');
      }
      return {
        heart: r.heart,
        lung: r.lung,
        heartWav: r.heartWav || r.heart,
        lungWav: r.lungWav || r.lung,
        noiseLevel: r.noiseLevel ?? 0,
        signalQuality: r.signalQuality ?? 1,
        processingMs: r.processingMs ?? 0,
        lastFilePath: filePath,
      };
    } catch (err) {
      return rejectWithValue(err?.message || 'Processing failed');
    }
  }
);

export const processBase64Thunk = createAsyncThunk(
  'separation/processBase64',
  async ({ base64Audio, sampleRate = 44100, filePath = null }, { rejectWithValue }) => {
    try {
      const r = await apiProcessAudio(base64Audio, sampleRate);
      return {
        heart: r.heart,
        lung: r.lung,
        heartWav: r.heart,
        lungWav: r.lung,
        noiseLevel: r.noiseLevel ?? 0,
        signalQuality: r.signalQuality ?? 1,
        processingMs: r.processingMs ?? 0,
        lastFilePath: filePath,
      };
    } catch (err) {
      return rejectWithValue(err?.userMessage || err?.message || 'Processing failed');
    }
  }
);

export const detectHeartThunk = createAsyncThunk(
  'separation/detectHeart',
  async ({ base64Audio, sampleRate = 44100 }, { rejectWithValue }) => {
    try {
      const r = await apiDetectHeart(base64Audio, sampleRate);
      return {
        heartDetected: r.heartDetected,
        heartConfidence: r.confidence,
        heartBpm: r.dominant_bpm,
        heartSpectralScore: r.spectral_score,
        heartHfScore: r.hf_score,
        heartTransientScore: r.transient_score,
        heartDutyScore: r.duty_score,
        heartCentroidHz: r.centroid_hz,
        heartHfRatio: r.hf_ratio,
        heartNTransients: r.n_transients,
        heartActiveFraction: r.active_fraction,
        heartRejectionReason: r.rejection_reason,
        heartEnergyRatio: r.energy_ratio ?? null,
        heartPeriodicity: r.periodicity ?? null,
        murmurDetected: r.murmur_detected,
        murmurType: r.murmur_type,
        murmurConfidence: r.murmur_confidence,
      };
    } catch (err) {
      return rejectWithValue(err?.userMessage || err?.message || 'Heart detection failed');
    }
  }
);

export const addNoiseThunk = createAsyncThunk(
  'separation/addNoise',
  async ({ base64Audio, sampleRate = 44100, noiseType = 'white', snrDb = 10 }, { rejectWithValue }) => {
    try {
      const r = await apiAddNoise(base64Audio, sampleRate, noiseType, snrDb);
      return { noisyAudio: r.audio, noiseType: r.noiseType, snrDb: r.snrDb };
    } catch (err) {
      return rejectWithValue(err?.userMessage || err?.message || 'Noise injection failed');
    }
  }
);

export const analyzeAudioThunk = createAsyncThunk(
  'separation/analyzeAudio',
  async ({ fileUri }, { rejectWithValue }) => {
    try {
      const res = await analyzeAudioFile(fileUri);
      return res;
    } catch (err) {
      return rejectWithValue(err?.userMessage || err?.message || 'Analysis failed');
    }
  }
);

const initial = {
  isProcessing: false,
  progress: { message: '', percent: 0 },
  heart: null,
  lung: null,
  heartWav: null,
  lungWav: null,
  noiseLevel: null,
  signalQuality: null,
  processingMs: null,
  error: null,
  lastFilePath: null,

  isDetectingHeart: false,
  heartDetected: null,
  heartConfidence: null,
  heartBpm: null,
  heartDetectError: null,
  heartRejectionReason: null,

  heartSpectralScore: null,
  heartHfScore: null,
  heartTransientScore: null,
  heartDutyScore: null,

  heartCentroidHz: null,
  heartHfRatio: null,
  heartNTransients: null,
  heartActiveFraction: null,

  heartEnergyRatio: null,
  heartPeriodicity: null,

  murmurDetected: null,
  murmurType: null,
  murmurConfidence: null,

  isAddingNoise: false,
  noisyAudio: null,
  noiseType: null,
  snrDb: null,
  addNoiseError: null,

  inputLengthMs: null,
  cardiacCycles: [],
  extraSounds: [],
  murmurs: [],
  noiseSegments: [],
  audioOutputs: null,
  timeline: [],
  lungAnalysis: null,
};

const _pending = s => {
  s.isProcessing = true;
  s.error = null;
  s.heart = null;
  s.lung = null;
  s.progress = { message: 'Processing…', percent: 10 };
};

const _fulfilled = (s, { payload: p }) => {
  s.isProcessing = false;
  s.heart = p.heart;
  s.lung = p.lung;
  s.heartWav = p.heartWav;
  s.lungWav = p.lungWav;
  s.noiseLevel = p.noiseLevel;
  s.signalQuality = p.signalQuality;
  s.processingMs = p.processingMs;
  s.lastFilePath = p.lastFilePath;
  s.progress = { message: 'Done', percent: 100 };
};

const _rejected = (s, { payload }) => {
  s.isProcessing = false;
  s.error = payload || 'Unknown error';
  s.progress = { message: '', percent: 0 };
};

const separationSlice = createSlice({
  name: 'separation',
  initialState: initial,
  reducers: {
    setProgress: (s, { payload }) => { s.progress = payload; },
    clearSeparationData: () => initial,
    clearSepError: s => { s.error = null; },
    clearHeartDetection: s => {
      s.heartDetected = null;
      s.heartConfidence = null;
      s.heartBpm = null;
      s.heartDetectError = null;
      s.heartRejectionReason = null;
      s.heartSpectralScore = null;
      s.heartHfScore = null;
      s.heartTransientScore = null;
      s.heartDutyScore = null;
      s.heartCentroidHz = null;
      s.heartHfRatio = null;
      s.heartNTransients = null;
      s.heartActiveFraction = null;
      s.heartEnergyRatio = null;
      s.heartPeriodicity = null;
      s.murmurDetected = null;
      s.murmurType = null;
      s.murmurConfidence = null;
    },
    clearNoisyAudio: s => {
      s.noisyAudio = null;
      s.noiseType = null;
      s.snrDb = null;
      s.addNoiseError = null;
    },
    clearClinicalAnalysis: s => {
      s.inputLengthMs = null;
      s.cardiacCycles = [];
      s.extraSounds = [];
      s.murmurs = [];
      s.noiseSegments = [];
      s.audioOutputs = null;
      s.timeline = [];
      s.lungAnalysis = null;
    },
  },
  extraReducers: b => {
    b.addCase(processRecordingThunk.pending, _pending)
      .addCase(processRecordingThunk.fulfilled, _fulfilled)
      .addCase(processRecordingThunk.rejected, _rejected)
      .addCase(processBase64Thunk.pending, _pending)
      .addCase(processBase64Thunk.fulfilled, _fulfilled)
      .addCase(processBase64Thunk.rejected, _rejected)
      .addCase(detectHeartThunk.pending, s => {
        s.isDetectingHeart = true;
        s.heartDetectError = null;
      })
      .addCase(detectHeartThunk.fulfilled, (s, { payload: p }) => {
        s.isDetectingHeart = false;
        s.heartDetected = p.heartDetected;
        s.heartConfidence = p.heartConfidence;
        s.heartBpm = p.heartBpm;
        s.heartSpectralScore = p.heartSpectralScore;
        s.heartHfScore = p.heartHfScore;
        s.heartTransientScore = p.heartTransientScore;
        s.heartDutyScore = p.heartDutyScore;
        s.heartCentroidHz = p.heartCentroidHz;
        s.heartHfRatio = p.heartHfRatio;
        s.heartNTransients = p.heartNTransients;
        s.heartActiveFraction = p.heartActiveFraction;
        s.heartRejectionReason = p.heartRejectionReason;
        s.heartEnergyRatio = p.heartEnergyRatio;
        s.heartPeriodicity = p.heartPeriodicity;
        s.murmurDetected = p.murmurDetected;
        s.murmurType = p.murmurType;
        s.murmurConfidence = p.murmurConfidence;
      })
      .addCase(detectHeartThunk.rejected, (s, { payload }) => {
        s.isDetectingHeart = false;
        s.heartDetectError = payload || 'Heart detection failed';
      })
      .addCase(addNoiseThunk.pending, s => {
        s.isAddingNoise = true;
        s.addNoiseError = null;
        s.noisyAudio = null;
      })
      .addCase(addNoiseThunk.fulfilled, (s, { payload: p }) => {
        s.isAddingNoise = false;
        s.noisyAudio = p.noisyAudio;
        s.noiseType = p.noiseType;
        s.snrDb = p.snrDb;
      })
      .addCase(addNoiseThunk.rejected, (s, { payload }) => {
        s.isAddingNoise = false;
        s.addNoiseError = payload || 'Noise injection failed';
      })
      .addCase(analyzeAudioThunk.fulfilled, (s, { payload: p }) => {
        s.isProcessing = false;
        s.inputLengthMs = p.duration_ms ?? p.input_length_ms ?? null;
        s.cardiacCycles = p.cardiac_cycles ?? [];
        s.extraSounds = p.extra_sounds ?? [];
        s.murmurs = p.murmurs ?? [];
        s.noiseSegments = p.noise_segments ?? [];
        s.audioOutputs = p.audio_outputs ?? p.outputs ?? null;
        s.timeline = p.timeline ?? [];
        s.lungAnalysis = p.lung_analysis ?? null;
        s.signalQuality = p.signal_quality ?? s.signalQuality;
        s.noiseLevel = p.noise_level ?? s.noiseLevel;
      })
      .addCase(analyzeAudioThunk.pending, s => {
        s.isProcessing = true;
        s.error = null;
      })
      .addCase(analyzeAudioThunk.rejected, (s, { payload }) => {
        s.isProcessing = false;
        s.error = payload || 'Analysis failed';
      });
  },
});

export const {
  setProgress,
  clearSeparationData,
  clearSepError,
  clearHeartDetection,
  clearNoisyAudio,
  clearClinicalAnalysis,
} = separationSlice.actions;

export const selectIsProcessing = s => s.separation.isProcessing;
export const selectProgress = s => s.separation.progress;
export const selectHeart = s => s.separation.heart;
export const selectLung = s => s.separation.lung;
export const selectHeartWav = s => s.separation.heartWav;
export const selectLungWav = s => s.separation.lungWav;
export const selectNoiseLevel = s => s.separation.noiseLevel;
export const selectSignalQuality = s => s.separation.signalQuality;
export const selectProcessingMs = s => s.separation.processingMs;
export const selectSepError = s => s.separation.error;
export const selectHasResults = s => !!(s.separation.heart && s.separation.lung);
export const selectLastFilePath = s => s.separation.lastFilePath;

export const selectInputLengthMs = s => s.separation.inputLengthMs;
export const selectCardiacCycles = s => s.separation.cardiacCycles;
export const selectExtraSounds = s => s.separation.extraSounds;
export const selectMurmurs = s => s.separation.murmurs;
export const selectNoiseSegments = s => s.separation.noiseSegments;
export const selectAudioOutputs = s => s.separation.audioOutputs;
export const selectTimeline = s => s.separation.timeline;
export const selectLungAnalysis = s => s.separation.lungAnalysis;

export const selectIsDetectingHeart = s => s.separation.isDetectingHeart;
export const selectHeartDetected = s => s.separation.heartDetected;
export const selectHeartConfidence = s => s.separation.heartConfidence;
export const selectHeartBpm = s => s.separation.heartBpm;
export const selectHeartDetectError = s => s.separation.heartDetectError;
export const selectHeartRejectionReason = s => s.separation.heartRejectionReason;
export const selectHeartSpectralScore = s => s.separation.heartSpectralScore;
export const selectHeartHfScore = s => s.separation.heartHfScore;
export const selectHeartTransientScore = s => s.separation.heartTransientScore;
export const selectHeartDutyScore = s => s.separation.heartDutyScore;
export const selectHeartCentroidHz = s => s.separation.heartCentroidHz;
export const selectHeartHfRatio = s => s.separation.heartHfRatio;
export const selectHeartNTransients = s => s.separation.heartNTransients;
export const selectHeartActiveFraction = s => s.separation.heartActiveFraction;
export const selectHeartEnergyRatio = s => s.separation.heartEnergyRatio;
export const selectHeartPeriodicity = s => s.separation.heartPeriodicity;

export const selectMurmurDetected = s => s.separation.murmurDetected;
export const selectMurmurType = s => s.separation.murmurType;
export const selectMurmurConfidence = s => s.separation.murmurConfidence;

export const selectIsAddingNoise = s => s.separation.isAddingNoise;
export const selectNoisyAudio = s => s.separation.noisyAudio;
export const selectNoiseType = s => s.separation.noiseType;
export const selectSnrDb = s => s.separation.snrDb;
export const selectAddNoiseError = s => s.separation.addNoiseError;

export const { reducer: separationReducer } = separationSlice;
export default separationSlice.reducer;