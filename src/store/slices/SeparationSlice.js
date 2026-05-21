// src/store/slices/SeparationSlice.js
//
// REPLACES (all three old slices can be deleted):
//   store/slices/aiStethSlices/AiStethPatientSlice.js
//   store/slices/aiStethSlices/AiStethRecordingSlice.js
//   store/slices/aiStethSlices/AiStethAnalysisSlice.js
//
// Two async thunks:
//   processRecordingThunk({ filePath })
//     → Native StethoscopeRecorder.processAndSendRecording (preprocessing + HTTP)
//     → Used by RecordingSection after stopRecording()
//
//   processBase64Thunk({ base64Audio, sampleRate, filePath })
//     → Calls Flask API directly from JS
//     → Used by PreviousRecordingsScreen "Analyse" button

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { NativeModules } from 'react-native';
import { processAudio as apiProcessAudio } from '../../aiStethApp/api/StethApiService';
import { debugLog, debugError } from '../../config/AppConfig';

const { StethoscopeRecorder } = NativeModules;

// ── Thunk 1: native module pipeline ──────────────────────────────────────────
export const processRecordingThunk = createAsyncThunk(
  'separation/processRecording',
  async ({ filePath }, { rejectWithValue }) => {
    try {
      debugLog('[SeparationSlice] processRecording →', filePath);
      const r = await StethoscopeRecorder.processAndSendRecording(filePath);
      if (!r || r.status !== 'success')
        return rejectWithValue(r?.error || 'Separation returned no result');
      return {
        heart:         r.heart,
        lung:          r.lung,
        heartWav:      r.heartWav || r.heart,
        lungWav:       r.lungWav  || r.lung,
        noiseLevel:    r.noiseLevel    ?? 0,
        signalQuality: r.signalQuality ?? 1,
        processingMs:  r.processingMs  ?? 0,
        lastFilePath:  filePath,
      };
    } catch (err) {
      debugError('[SeparationSlice] processRecording error:', err);
      return rejectWithValue(err?.message || 'Processing failed');
    }
  }
);

// ── Thunk 2: JS-side base64 → Flask (PreviousRecordingsScreen) ────────────────
export const processBase64Thunk = createAsyncThunk(
  'separation/processBase64',
  async ({ base64Audio, sampleRate = 44100, filePath = null }, { rejectWithValue }) => {
    try {
      debugLog('[SeparationSlice] processBase64  sr=', sampleRate);
      const r = await apiProcessAudio(base64Audio, sampleRate);
      return {
        heart:         r.heart,
        lung:          r.lung,
        heartWav:      r.heart,
        lungWav:       r.lung,
        noiseLevel:    r.noiseLevel    ?? 0,
        signalQuality: r.signalQuality ?? 1,
        processingMs:  r.processingMs  ?? 0,
        lastFilePath:  filePath,
      };
    } catch (err) {
      debugError('[SeparationSlice] processBase64 error:', err);
      return rejectWithValue(err?.userMessage || err?.message || 'Processing failed');
    }
  }
);

// ── Slice ─────────────────────────────────────────────────────────────────────
const initial = {
  isProcessing:  false,
  progress:      { message: '', percent: 0 },
  heart:         null,   // base64 raw PCM-16 for AudioTrack
  lung:          null,
  heartWav:      null,   // base64 WAV with header (for saving)
  lungWav:       null,
  noiseLevel:    null,
  signalQuality: null,
  processingMs:  null,
  error:         null,
  lastFilePath:  null,
};

const _pending = state => {
  state.isProcessing = true;
  state.error        = null;
  state.heart        = null;
  state.lung         = null;
  state.progress     = { message: 'Processing…', percent: 10 };
};

const _fulfilled = (state, { payload: p }) => {
  state.isProcessing  = false;
  state.heart         = p.heart;
  state.lung          = p.lung;
  state.heartWav      = p.heartWav;
  state.lungWav       = p.lungWav;
  state.noiseLevel    = p.noiseLevel;
  state.signalQuality = p.signalQuality;
  state.processingMs  = p.processingMs;
  state.lastFilePath  = p.lastFilePath;
  state.progress      = { message: 'Done', percent: 100 };
};

const _rejected = (state, { payload }) => {
  state.isProcessing = false;
  state.error        = payload || 'Unknown error';
  state.progress     = { message: '', percent: 0 };
};

const separationSlice = createSlice({
  name: 'separation',
  initialState: initial,
  reducers: {
    setProgress:         (s, { payload }) => { s.progress = payload; },
    clearSeparationData: ()               => initial,
    clearSepError:       s                => { s.error = null; },
  },
  extraReducers: b => {
    b.addCase(processRecordingThunk.pending,   _pending)
     .addCase(processRecordingThunk.fulfilled, _fulfilled)
     .addCase(processRecordingThunk.rejected,  _rejected)
     .addCase(processBase64Thunk.pending,      _pending)
     .addCase(processBase64Thunk.fulfilled,    _fulfilled)
     .addCase(processBase64Thunk.rejected,     _rejected);
  },
});

export const { setProgress, clearSeparationData, clearSepError } = separationSlice.actions;

// ── Selectors ─────────────────────────────────────────────────────────────────
export const selectIsProcessing   = s => s.separation.isProcessing;
export const selectProgress       = s => s.separation.progress;
export const selectHeart          = s => s.separation.heart;
export const selectLung           = s => s.separation.lung;
export const selectHeartWav       = s => s.separation.heartWav;
export const selectLungWav        = s => s.separation.lungWav;
export const selectNoiseLevel     = s => s.separation.noiseLevel;
export const selectSignalQuality  = s => s.separation.signalQuality;
export const selectProcessingMs   = s => s.separation.processingMs;
export const selectSepError       = s => s.separation.error;
export const selectHasResults     = s => !!(s.separation.heart && s.separation.lung);
export const selectLastFilePath   = s => s.separation.lastFilePath;

export const { reducer: separationReducer } = separationSlice;
export default separationSlice.reducer;