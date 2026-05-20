// src/store/slices/aiStethSlices/StethoscopeSlice.js
import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  isConnected: false,
  connectedDevice: null,
  isAudioReady: false,
};

const stethoscopeSlice = createSlice({
  name: 'stethoscope',
  initialState,
  reducers: {
    setIsConnected: (state, action) => {
      state.isConnected = action.payload;
    },
    connectDevice: (state, action) => {
      state.connectedDevice = action.payload;
      state.isConnected = true;
    },
    disconnectDevice: (state) => {
      state.connectedDevice = null;
      state.isConnected = false;
      state.isAudioReady = false;
    },
    setAudioReady: (state, action) => {
      state.isAudioReady = action.payload;
    },

  },
});

// Export actions
export const {
  setIsConnected,
  connectDevice,
  disconnectDevice,
  setAudioReady,
} = stethoscopeSlice.actions;

// Export reducer
export const stethoscopeReducer = stethoscopeSlice.reducer;
