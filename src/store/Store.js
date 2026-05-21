// store.js
import { configureStore, combineReducers } from '@reduxjs/toolkit';
import { stethoscopeReducer } from './slices/StethoscopeSlice';
// import { fireBaseReducer } from './FireBaseUpdateSlice';

// import { stethoscopeReducer } from './StethoscopeSlice';
import { aiStethPatientReducer } from './slices/aiStethSlices/AiStethPatientSlice';
import { aiStethRecordingReducer } from './slices/aiStethSlices/AiStethRecordingSlice';
import { aiStethAnalysisReducer } from './slices/aiStethSlices/AiStethAnalysisSlice';
import { separationReducer }  from './slices/SeparationSlice';




// Combine reducers
const rootReducer = combineReducers({

  // fireBase: fireBaseReducer,

  // ai steth
  stethoscope: stethoscopeReducer,
  aiStethPatient: aiStethPatientReducer,
  aiStethRecording: aiStethRecordingReducer,
  aiStethAnalysis: aiStethAnalysisReducer,
  separation:  separationReducer,   // replaces aiStethPatient + aiStethRecording + aiStethAnalysis

  // Add other modules if needed
});

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: false,
    }),
});

export default store;
