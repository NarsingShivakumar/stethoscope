/**
 * hooks/useAudioStream.js
 * ========================
 * Replaces the AiSteth upload + polling pattern from:
 *   - AiStethAnalysisSection.js (polling fetchAIAnalysis every 5s, 40 attempts)
 *   - RecordingSection.js (handleUploadToAiSteth / uploadRecordingComplete)
 *   - AiStethPatientSlice (createPatient)
 *
 * REMOVED:
 *   Polling intervals: POLLING_INTERVALS = { AI_ANALYSIS: 5000, VISUALIZATION: 7000, AUDIO: 5000 }
 *   MAX_POLL_ATTEMPTS = { AI_ANALYSIS: 12, VISUALIZATION: 40, AUDIO: 40 }
 *   fetchAIAnalysis / fetchVisualization / fetchAudioUrl thunks
 *   createPatient / patientUniqueId dependency
 *
 * ADDED:
 *   processRecording(filePath)    → native module → Flask (< 2s total)
 *   processBase64Audio(b64, sr)   → JS-side alternative
 *   playHeart / playLung          → SeparationAudioPlayer
 *   saveAudio                     → SeparationAudioPlayer.saveAudioFile
 *
 * Listens to native events:
 *   onSeparationProgress  { message, percent }
 *   onSeparationDone      { heart, lung, heartWav, lungWav, ... }
 *   onSeparationError     { message }
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { NativeModules, NativeEventEmitter } from 'react-native';
import { processAudio as apiProcessAudio } from '../api/StethApiService';
import { debugLog, debugError } from '../../config/AppConfig';

const { StethoscopeRecorder, SeparationAudioPlayer } = NativeModules;
const emitter = new NativeEventEmitter(StethoscopeRecorder);

export const useAudioStream = () => {
  const [isProcessing,   setIsProcessing]   = useState(false);
  const [progress,       setProgress]       = useState({ message: '', percent: 0 });
  const [heartAudio,     setHeartAudio]     = useState(null); // base64 raw PCM (AudioTrack)
  const [lungAudio,      setLungAudio]      = useState(null);
  const [heartWav,       setHeartWav]       = useState(null); // base64 WAV (saving)
  const [lungWav,        setLungWav]        = useState(null);
  const [noiseLevel,     setNoiseLevel]     = useState(null);
  const [signalQuality,  setSignalQuality]  = useState(null);
  const [processingMs,   setProcessingMs]   = useState(null);
  const [error,          setError]          = useState(null);
  const [isPlayingHeart, setIsPlayingHeart] = useState(false);
  const [isPlayingLung,  setIsPlayingLung]  = useState(false);

  const abortRef = useRef(false);

  // ── Native event listeners ───────────────────────────────────────────────────
  useEffect(() => {
    const s1 = emitter.addListener('onSeparationProgress', e => {
      setProgress({ message: e.message || '', percent: e.percent || 0 });
    });
    const s2 = emitter.addListener('onSeparationDone', e => { _store(e); });
    const s3 = emitter.addListener('onSeparationError', e => {
      setError(e.message || 'Separation failed');
      setIsProcessing(false);
    });
    return () => { s1.remove(); s2.remove(); s3.remove(); };
  }, []);

  const _store = useCallback(r => {
    setHeartAudio(r.heart       || null);
    setLungAudio(r.lung         || null);
    setHeartWav(r.heartWav      || r.heart || null);
    setLungWav(r.lungWav        || r.lung  || null);
    setNoiseLevel(r.noiseLevel     ?? null);
    setSignalQuality(r.signalQuality ?? null);
    setProcessingMs(r.processingMs   ?? null);
    setIsProcessing(false);
    setProgress({ message: 'Done', percent: 100 });
    debugLog('[useAudioStream] stored results  quality=', r.signalQuality,
             'noise=', r.noiseLevel, 'ms=', r.processingMs);
  }, []);

  // ── Pipeline: file path → native preprocessing → Flask ────────────────────
  const processRecording = useCallback(async filePath => {
    if (!filePath) { setError('No file path'); return null; }
    abortRef.current = false;
    setIsProcessing(true); setError(null);
    setHeartAudio(null); setLungAudio(null);
    setProgress({ message: 'Starting…', percent: 0 });

    try {
      const result = await StethoscopeRecorder.processAndSendRecording(filePath);
      if (abortRef.current) return null;
      _store(result);
      return result;
    } catch (err) {
      if (!abortRef.current) {
        debugError('[useAudioStream] processRecording error:', err);
        setError(err?.userMessage || err?.message || 'Processing failed');
        setIsProcessing(false);
      }
      return null;
    }
  }, [_store]);

  // ── Pipeline: pre-encoded base64 → Flask (used by PreviousRecordingsScreen) ─
  const processBase64Audio = useCallback(async (base64Audio, sampleRate = 44100) => {
    abortRef.current = false;
    setIsProcessing(true); setError(null);
    setHeartAudio(null); setLungAudio(null);
    setProgress({ message: 'Sending audio to server…', percent: 20 });

    try {
      const res = await apiProcessAudio(base64Audio, sampleRate);
      if (abortRef.current) return null;
      _store({
        heart:         res.heart,
        lung:          res.lung,
        heartWav:      res.heart,
        lungWav:       res.lung,
        noiseLevel:    res.noiseLevel,
        signalQuality: res.signalQuality,
        processingMs:  res.processingMs,
      });
      return res;
    } catch (err) {
      if (!abortRef.current) {
        setError(err?.userMessage || err?.message || 'Processing failed');
        setIsProcessing(false);
      }
      return null;
    }
  }, [_store]);

  // ── Playback ─────────────────────────────────────────────────────────────────
  const playHeart = useCallback(async () => {
    if (!heartAudio) { setError('No heart audio'); return; }
    try { setIsPlayingHeart(true); await SeparationAudioPlayer.playHeartAudio(heartAudio); }
    catch (e) { setError(e.message || 'Playback failed'); }
    finally { setIsPlayingHeart(false); }
  }, [heartAudio]);

  const playLung = useCallback(async () => {
    if (!lungAudio) { setError('No lung audio'); return; }
    try { setIsPlayingLung(true); await SeparationAudioPlayer.playLungAudio(lungAudio); }
    catch (e) { setError(e.message || 'Playback failed'); }
    finally { setIsPlayingLung(false); }
  }, [lungAudio]);

  const stopPlayback = useCallback(async () => {
    try { await SeparationAudioPlayer.stopPlayback(); }
    catch {}
    setIsPlayingHeart(false); setIsPlayingLung(false);
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const saveAudio = useCallback(async (which, filename) => {
    const wav = which === 'heart' ? heartWav : lungWav;
    if (!wav) { setError(`No ${which} audio to save`); return null; }
    try {
      const r = await SeparationAudioPlayer.saveAudioFile(wav, filename, which);
      return r.filePath;
    } catch (e) { setError(e.message || 'Save failed'); return null; }
  }, [heartWav, lungWav]);

  const reset = useCallback(() => {
    abortRef.current = true;
    setIsProcessing(false); setProgress({ message: '', percent: 0 });
    setHeartAudio(null); setLungAudio(null);
    setHeartWav(null);   setLungWav(null);
    setNoiseLevel(null); setSignalQuality(null); setProcessingMs(null);
    setError(null); setIsPlayingHeart(false); setIsPlayingLung(false);
  }, []);

  return {
    isProcessing, progress,
    heartAudio, lungAudio, heartWav, lungWav,
    noiseLevel, signalQuality, processingMs,
    error, isPlayingHeart, isPlayingLung,
    hasResults: !!(heartAudio && lungAudio),
    processRecording, processBase64Audio,
    playHeart, playLung, stopPlayback,
    saveAudio, reset,
    clearError: useCallback(() => setError(null), []),
  };
};
