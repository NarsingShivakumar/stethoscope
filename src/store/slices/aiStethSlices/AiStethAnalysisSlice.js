// src/store/slices/aiStethSlices/AiStethAnalysisSlice.js

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import {
  getAIAnalysis,
  getVisualizationUrl,
  getAudioUrl,
} from '../../../aiStethApp/api/AiStethApiService';
import { debugLog } from '../../../config/AppConfig';

// Async Thunks
export const fetchAIAnalysis = createAsyncThunk(
  'aiStethAnalysis/fetchAIAnalysis',
  async ({ patientUniqueId, fileName }, { rejectWithValue }) => {
    try {
      const response = await getAIAnalysis(patientUniqueId, fileName);
      // console.log("getAIAnalysis::", response)
      return response;
    } catch (error) {
      return rejectWithValue(error);
    }
  }
);

export const fetchVisualization = createAsyncThunk(
  'aiStethAnalysis/fetchVisualization',
  async ({ fileName, patientUniqueId, isDenoised = false }, { rejectWithValue }) => {
    try {
      const response = await getVisualizationUrl(fileName, patientUniqueId, isDenoised);
      // console.log("getVisualizationUrl::", isDenoised, response)
      return { ...response, isDenoised };

    } catch (error) {
      return rejectWithValue(error);
    }
  }
);

export const fetchAudioUrl = createAsyncThunk(
  'aiStethAnalysis/fetchAudioUrl',
  async ({ fileName, patientUniqueId, isDenoised = false }, { rejectWithValue }) => {
    try {
      const response = await getAudioUrl(fileName, patientUniqueId, isDenoised);
      // console.log("getAudioUrl::", isDenoised, response)
      return { ...response, isDenoised };
    } catch (error) {
      return rejectWithValue(error);
    }
  }
);

// NEW: Check if pending analysis is ready
export const checkPendingAnalysis = createAsyncThunk(
  'aiStethAnalysis/checkPendingAnalysis',
  async ({ patientUniqueId, fileName }, { dispatch, rejectWithValue }) => {
    try {
      // Try to fetch AI analysis
      const analysisResponse = await getAIAnalysis(patientUniqueId, fileName);

      if (analysisResponse && analysisResponse.Code === 'Success') {
        // Analysis is ready, remove from pending queue
        dispatch(removeFromPendingAnalysisQueue({ fileName }));
        return {
          analysis: analysisResponse,
          fileName,
          patientUniqueId,
          ready: true,
        };
      }

      return {
        fileName,
        patientUniqueId,
        ready: false,
      };
    } catch (error) {
      // Analysis not ready yet or error occurred
      return rejectWithValue({
        error,
        fileName,
        patientUniqueId,
        ready: false,
      });
    }
  }
);

// NEW: Batch check all pending analyses
export const checkAllPendingAnalyses = createAsyncThunk(
  'aiStethAnalysis/checkAllPendingAnalyses',
  async (_, { getState, dispatch }) => {
    const state = getState();
    const pendingQueue = selectPendingAnalysisQueue(state);

    const results = await Promise.allSettled(
      pendingQueue.map((item) =>
        dispatch(checkPendingAnalysis({
          patientUniqueId: item.patientUniqueId,
          fileName: item.fileName,
        })).unwrap()
      )
    );

    return results.filter((r) => r.status === 'fulfilled' && r.value.ready);
  }
);

// Initial State
const initialState = {
  // AI Analysis JSON
  aiAnalysis: null,
  aiAnalysisLoading: false,
  aiAnalysisError: null,
  aiAnalysisPending: true, // NEW: Track if still processing

  // Visualization URLs (ground truth + denoised)
  visualization: null,
  visualizationDenoised: null,
  visualizationLoading: false,
  visualizationError: null,
  visualizationGTPending: true, // NEW
  visualizationDenoisedPending: true, // NEW

  // Audio URLs (ground truth + denoised)
  audioUrl: null,
  audioUrlDenoised: null,
  audioLoading: false,
  audioError: null,
  audioGTPending: true, // NEW
  audioDenoisedPending: true, // NEW

  // Current analysis context
  currentAnalysisSession: null,

  // Convenience fields
  lastFileName: null,
  lastPatientId: null,

  // NEW: Track skipped/pending analysis for later retrieval
  pendingAnalysisQueue: [], // [{patientUniqueId, fileName, timestamp, uploadedAt}]
  userSkippedAnalysis: false,
};

const aiStethAnalysisSlice = createSlice({
  name: 'aiStethAnalysis',
  initialState,
  reducers: {
    setCurrentAnalysisSession: (state, action) => {
      state.currentAnalysisSession = action.payload;
      if (action.payload?.fileName) {
        state.lastFileName = action.payload.fileName;
      }
      if (action.payload?.patientUniqueId) {
        state.lastPatientId = action.payload.patientUniqueId;
      }
    },
    clearAIAnalysis: (state) => {
      state.aiAnalysis = null;
      state.aiAnalysisError = null;
      state.aiAnalysisPending = true;
    },
    clearVisualization: (state) => {
      state.visualization = null;
      state.visualizationDenoised = null;
      state.visualizationError = null;
      state.visualizationGTPending = true;
      state.visualizationDenoisedPending = true;
    },
    clearAudioUrls: (state) => {
      state.audioUrl = null;
      state.audioUrlDenoised = null;
      state.audioError = null;
      state.audioGTPending = true;
      state.audioDenoisedPending = true;
    },
    clearAllAnalysisData: (state) => {
      state.aiAnalysis = null;
      state.visualization = null;
      state.visualizationDenoised = null;
      state.audioUrl = null;
      state.audioUrlDenoised = null;
      state.currentAnalysisSession = null;
      state.lastFileName = null;
      state.lastPatientId = null;
      // Reset pending states
      state.aiAnalysisPending = true;
      state.visualizationGTPending = true;
      state.visualizationDenoisedPending = true;
      state.audioGTPending = true;
      state.audioDenoisedPending = true;
    },
    clearAllErrors: (state) => {
      state.aiAnalysisError = null;
      state.visualizationError = null;
      state.audioError = null;
    },
    // NEW: Add to pending analysis queue when user skips
    addToPendingAnalysisQueue: (state, action) => {
      const { patientUniqueId, fileName } = action.payload;
      const existingIndex = state.pendingAnalysisQueue.findIndex(
        (item) => item.fileName === fileName && item.patientUniqueId === patientUniqueId
      );

      if (existingIndex === -1) {
        state.pendingAnalysisQueue.push({
          patientUniqueId,
          fileName,
          timestamp: new Date().toISOString(),
          uploadedAt: new Date().toISOString(),
        });
      }
      state.userSkippedAnalysis = true;
    },
    // NEW: Remove from pending queue when analysis completes
    removeFromPendingAnalysisQueue: (state, action) => {
      const { fileName } = action.payload;
      state.pendingAnalysisQueue = state.pendingAnalysisQueue.filter(
        (item) => item.fileName !== fileName
      );
      if (state.pendingAnalysisQueue.length === 0) {
        state.userSkippedAnalysis = false;
      }
    },
    // NEW: Clear pending queue
    clearPendingAnalysisQueue: (state) => {
      state.pendingAnalysisQueue = [];
      state.userSkippedAnalysis = false;
    },
    // NEW: Mark that user skipped analysis
    setUserSkippedAnalysis: (state, action) => {
      state.userSkippedAnalysis = action.payload;
    },
  },
  extraReducers: (builder) => {
    // AI Analysis
    builder.addCase(fetchAIAnalysis.pending, (state) => {
      state.aiAnalysisLoading = true;
      state.aiAnalysisError = null;
    });
    builder.addCase(fetchAIAnalysis.fulfilled, (state, action) => {
      state.aiAnalysisLoading = false;
      state.aiAnalysis = action.payload;
      state.aiAnalysisPending = false; // Mark as complete
    });
    builder.addCase(fetchAIAnalysis.rejected, (state, action) => {
      state.aiAnalysisLoading = false;
      state.aiAnalysisError = action.payload;
      // Keep pending=true if error suggests it's still processing
    });

    // Visualization
    builder.addCase(fetchVisualization.pending, (state) => {
      state.visualizationLoading = true;
      state.visualizationError = null;
    });
    builder.addCase(fetchVisualization.fulfilled, (state, action) => {
      state.visualizationLoading = false;
      if (action.payload.isDenoised) {
        state.visualizationDenoised = action.payload;
        state.visualizationDenoisedPending = false;
      } else {
        state.visualization = action.payload;
        state.visualizationGTPending = false;
      }
    });
    builder.addCase(fetchVisualization.rejected, (state, action) => {
      state.visualizationLoading = false;
      state.visualizationError = action.payload;
    });

    // Audio URL
    builder.addCase(fetchAudioUrl.pending, (state) => {
      state.audioLoading = true;
      state.audioError = null;
    });
    builder.addCase(fetchAudioUrl.fulfilled, (state, action) => {
      state.audioLoading = false;
      if (action.payload.isDenoised) {
        state.audioUrlDenoised = action.payload;
        state.audioDenoisedPending = false;
      } else {
        state.audioUrl = action.payload;
        state.audioGTPending = false;
      }
    });
    builder.addCase(fetchAudioUrl.rejected, (state, action) => {
      state.audioLoading = false;
      state.audioError = action.payload;
    });
  },
});

// Actions
export const {
  setCurrentAnalysisSession,
  clearAIAnalysis,
  clearVisualization,
  clearAudioUrls,
  clearAllAnalysisData,
  clearAllErrors,
  addToPendingAnalysisQueue,
  removeFromPendingAnalysisQueue,
  clearPendingAnalysisQueue,
  setUserSkippedAnalysis,
} = aiStethAnalysisSlice.actions;

// Selectors
export const selectAIAnalysis = (state) => state.aiStethAnalysis.aiAnalysis;
export const selectAIAnalysisLoading = (state) => state.aiStethAnalysis.aiAnalysisLoading;
export const selectAIAnalysisError = (state) => state.aiStethAnalysis.aiAnalysisError;
export const selectAIAnalysisPending = (state) => state.aiStethAnalysis.aiAnalysisPending;

export const selectVisualization = (state) => state.aiStethAnalysis.visualization;
export const selectVisualizationDenoised = (state) => state.aiStethAnalysis.visualizationDenoised;
export const selectVisualizationLoading = (state) => state.aiStethAnalysis.visualizationLoading;
export const selectVisualizationGTPending = (state) => state.aiStethAnalysis.visualizationGTPending;
export const selectVisualizationDenoisedPending = (state) => state.aiStethAnalysis.visualizationDenoisedPending;

export const selectAudioUrl = (state) => state.aiStethAnalysis.audioUrl;
export const selectAudioUrlDenoised = (state) => state.aiStethAnalysis.audioUrlDenoised;
export const selectAudioLoading = (state) => state.aiStethAnalysis.audioLoading;
export const selectAudioGTPending = (state) => state.aiStethAnalysis.audioGTPending;
export const selectAudioDenoisedPending = (state) => state.aiStethAnalysis.audioDenoisedPending;

export const selectCurrentAnalysisSession = (state) => state.aiStethAnalysis.currentAnalysisSession;
export const selectLastAnalysedFileName = (state) => state.aiStethAnalysis.lastFileName;
export const selectLastAnalysedPatientId = (state) => state.aiStethAnalysis.lastPatientId;

// NEW: Selectors for pending analysis management
export const selectPendingAnalysisQueue = (state) => state.aiStethAnalysis.pendingAnalysisQueue;
export const selectUserSkippedAnalysis = (state) => state.aiStethAnalysis.userSkippedAnalysis;
export const selectHasPendingAnalysis = (state) => state.aiStethAnalysis.pendingAnalysisQueue.length > 0;

// Reducer
export const aiStethAnalysisReducer = aiStethAnalysisSlice.reducer;