import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  uploadAudioFile as uploadAudioFileAPI,
  createPHR as createPHRAPI,
} from '../../../aiStethApp/api/AiStethApiService';
import { setCurrentAnalysisSession } from './AiStethAnalysisSlice';
import { debugLog, debugError } from '../../../config/AppConfig';

// Async Thunks
export const uploadAudioFile = createAsyncThunk(
  'aiStethRecording/uploadAudioFile',
  async ({ fileName, patientUniqueId, filePath }, { rejectWithValue }) => {
    try {
      const response = await uploadAudioFileAPI(fileName, patientUniqueId, filePath);
      debugLog('[RecordingSlice] Audio uploaded:', response);
      return response;
    } catch (error) {
      debugError('[RecordingSlice] Upload error:', error);
      return rejectWithValue(error);
    }
  }
);

export const createPHR = createAsyncThunk(
  'aiStethRecording/createPHR',
  async (phrData, { rejectWithValue }) => {
    try {
      const response = await createPHRAPI(phrData);
      debugLog('[RecordingSlice] PHR created:', response);
      return response;
    } catch (error) {
      debugError('[RecordingSlice] PHR error:', error);
      return rejectWithValue(error);
    }
  }
);

export const uploadRecordingComplete = createAsyncThunk(
  'aiStethRecording/uploadRecordingComplete',
  async ({ fileName, patientUniqueId, filePath, notes }, { dispatch, rejectWithValue }) => {
    try {
      debugLog('[RecordingSlice] Starting complete upload flow...');

      // Step 1: Upload audio file
      const uploadResult = await dispatch(uploadAudioFile({
        fileName,
        patientUniqueId,
        filePath
      })).unwrap();

      // Step 2: Create PHR
      const phrResult = await dispatch(createPHR({
        originalFileName: uploadResult.originalFileName,
        savedFileName: uploadResult.savedAs,
        patientUniqueId,
        notes: notes || '',
        description: 'Heart recording',
      })).unwrap();

      const combined = {
        upload: uploadResult,
        phr: phrResult,
        fileName: uploadResult.savedAs,
      };

      // Set analysis context
      dispatch(
        setCurrentAnalysisSession({
          patientUniqueId,
          fileName: uploadResult.savedAs,
          phrId: phrResult.phrId,
        })
      );

      return combined;
    } catch (error) {
      debugError('[RecordingSlice] Upload flow error:', error);
      return rejectWithValue(error);
    }
  }
);

// Initial State
const initialState = {
  uploadedAudio: null,
  uploadLoading: false,
  uploadError: null,
  createdPHR: null,
  createPHRLoading: false,
  createPHRError: null,
  completeUploadResult: null,
  completeUploadLoading: false,
  completeUploadError: null,
};

// Slice
const aiStethRecordingSlice = createSlice({
  name: 'aiStethRecording',
  initialState,
  reducers: {
    clearUploadData: (state) => {
      state.uploadedAudio = null;
      state.uploadError = null;
    },
    clearPHRData: (state) => {
      state.createdPHR = null;
      state.createPHRError = null;
    },
    clearCompleteUploadResult: (state) => {
      state.completeUploadResult = null;
      state.completeUploadError = null;
    },
    clearAllRecordingData: (state) => {
      return initialState;
    },
  },
  extraReducers: (builder) => {
    builder
      // Upload Audio File
      .addCase(uploadAudioFile.pending, (state) => {
        state.uploadLoading = true;
        state.uploadError = null;
      })
      .addCase(uploadAudioFile.fulfilled, (state, action) => {
        state.uploadLoading = false;
        state.uploadedAudio = action.payload;
      })
      .addCase(uploadAudioFile.rejected, (state, action) => {
        state.uploadLoading = false;
        state.uploadError = action.payload;
      })
      // Create PHR
      .addCase(createPHR.pending, (state) => {
        state.createPHRLoading = true;
        state.createPHRError = null;
      })
      .addCase(createPHR.fulfilled, (state, action) => {
        state.createPHRLoading = false;
        state.createdPHR = action.payload;
      })
      .addCase(createPHR.rejected, (state, action) => {
        state.createPHRLoading = false;
        state.createPHRError = action.payload;
      })
      // Complete Upload Flow
      .addCase(uploadRecordingComplete.pending, (state) => {
        state.completeUploadLoading = true;
        state.completeUploadError = null;
      })
      .addCase(uploadRecordingComplete.fulfilled, (state, action) => {
        state.completeUploadLoading = false;
        state.completeUploadResult = action.payload;
        state.uploadedAudio = action.payload.upload;
        state.createdPHR = action.payload.phr;
      })
      .addCase(uploadRecordingComplete.rejected, (state, action) => {
        state.completeUploadLoading = false;
        state.completeUploadError = action.payload;
      });
  },
});

// Actions
export const {
  clearUploadData,
  clearPHRData,
  clearCompleteUploadResult,
  clearAllRecordingData,
} = aiStethRecordingSlice.actions;

// Selectors
export const selectUploadedAudio = (state) => state.aiStethRecording.uploadedAudio;
export const selectUploadLoading = (state) => state.aiStethRecording.uploadLoading;
export const selectCreatedPHR = (state) => state.aiStethRecording.createdPHR;
export const selectCompleteUploadResult = (state) => state.aiStethRecording.completeUploadResult;
export const selectCompleteUploadLoading = (state) => state.aiStethRecording.completeUploadLoading;
export const selectCompleteUploadError = (state) => state.aiStethRecording.completeUploadError;

// Reducer
export const aiStethRecordingReducer = aiStethRecordingSlice.reducer;
