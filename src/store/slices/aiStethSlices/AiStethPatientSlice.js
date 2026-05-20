// src/store/slices/aiStethSlices/AiStethPatientSlice.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { createPatient as createPatientAPI } from '../../../aiStethApp/api/AiStethApiService';
import { debugLog, debugError } from '../../../config/AppConfig';

// Async Thunks
export const createPatient = createAsyncThunk(
  'aiStethPatient/createPatient',
  async (patientData, { rejectWithValue }) => {
    try {
      const response = await createPatientAPI(patientData);
      debugLog('[PatientSlice] Patient created:', response);
      return response;
    } catch (error) {
      debugError('[PatientSlice] Create patient error:', error);
      return rejectWithValue(error);
    }
  }
);

// Initial State
const initialState = {
  createdPatient: null,
  createPatientLoading: false,
  createPatientError: null,
  currentPatient: null,
};

// Slice
const aiStethPatientSlice = createSlice({
  name: 'aiStethPatient',
  initialState,
  reducers: {
    setCurrentPatient: (state, action) => {
      state.currentPatient = action.payload;
    },
    clearPatientData: (state) => {
      state.createdPatient = null;
      state.createPatientError = null;
      state.currentPatient = null;
    },
    clearPatientError: (state) => {
      state.createPatientError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(createPatient.pending, (state) => {
        state.createPatientLoading = true;
        state.createPatientError = null;
      })
      .addCase(createPatient.fulfilled, (state, action) => {
        state.createPatientLoading = false;
        state.createdPatient = action.payload;
        state.currentPatient = action.payload;
      })
      .addCase(createPatient.rejected, (state, action) => {
        state.createPatientLoading = false;
        state.createPatientError = action.payload;
      });
  },
});

// Actions
export const {
  setCurrentPatient,
  clearPatientData,
  clearPatientError,
} = aiStethPatientSlice.actions;

// Selectors
export const selectCreatedPatient = (state) => state.aiStethPatient.createdPatient;
export const selectCreatePatientLoading = (state) => state.aiStethPatient.createPatientLoading;
export const selectCreatePatientError = (state) => state.aiStethPatient.createPatientError;
export const selectCurrentPatient = (state) => state.aiStethPatient.currentPatient;

// Reducer
export const aiStethPatientReducer = aiStethPatientSlice.reducer;
