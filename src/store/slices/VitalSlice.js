import { createSlice, current } from '@reduxjs/toolkit';

const initialState = {
  heightCm: null,
  weightValue: null,
  temperatureValue: null,
  bloodPressure: null,
  spO2Value: null,
  bloodSugarValue: null,
  isKardiaProcess: false,
  ecgType: "6ECG",
  spirometry: null,
  ecg: null,
  eyetest: null,
  aisteth: null,
  aiStethScreen: 'device', // Store current AI Steth screen state
  hasVitalProcessing: false,
  isAiStethRecording: false,
  visitType: "CONSULTATION"

};

const VitalsSlice = createSlice({
  name: 'vitals',
  initialState,
  reducers: {
    setVital(state, action) {
      const { key, value } = action.payload;
      state[key] = value;
      if (key !== "isKardiaProcess") {
        state.hasVitalProcessing = false;
      }
    },
    resetVitals: (state, action) => {
      const { resetAll } = action.payload || {}

      if (resetAll) {
        console.log("reset succesfully", initialState, { currentPayload: action.payload });
        return initialState;
      }
      return {
        ...initialState,
        visitType: state.visitType,
      };
    },
    setVitalProcessing(state, action) {
      const { key, value } = action.payload;
      state.hasVitalProcessing = value;
      if (value === false && key) {
        state[key] = null;
      }
    },
    setAiStethScreen(state, action) {
      state.aiStethScreen = action.payload;
    },
    setAiStethRecording(state, action) {
      state.isAiStethRecording = action.payload;
    },
    setVitalStatus(state, action) {
      state.visitType = action.payload;
    }
  },
});

export const { setVital, resetVitals, setVitalProcessing, setAiStethScreen, setAiStethRecording, setVitalStatus } = VitalsSlice.actions;
export const { reducer: vitalsDataReducer } = VitalsSlice;
