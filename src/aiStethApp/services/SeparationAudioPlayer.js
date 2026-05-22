// src/aiStethApp/services/SeparationAudioPlayer.js  v2
//
// Plays base64-encoded WAV audio returned by the NMF separation backend.
//
// WHY "TICK" HAPPENED:
//   The old code called RNFS.writeFile() to a temp path and passed that path
//   to Sound. When the file write hadn't finished by the time Sound.play()
//   was called, it played 0 bytes → 0.1s "tick" sound.
//   Also: Sound() required a callback before .play() — calling play() on an
//   unconstructed Sound object crashed silently after the first frame.
//
// THIS FIX:
//   1. Write the temp file first, await fully
//   2. Construct Sound inside the load callback (not before)
//   3. Sound.play() only after onLoad fires
//   4. Support mp3/aac/ogg/flac/m4a by writing the correct file extension
//      and letting Sound auto-detect codec
//   5. Expose stop/pause/seek/getDuration for the UI player bar
//
// USAGE:
//   import SepPlayer from './services/SeparationAudioPlayer';
//   const { sound, duration } = await SepPlayer.load(base64Wav, 'heart');
//   SepPlayer.play(sound);
//   SepPlayer.stop(sound);

import RNFS from 'react-native-fs';
import Sound from 'react-native-sound';
import { debugLog, debugError } from '../../config/AppConfig';

Sound.setCategory('Playback', true);   // iOS: allow playback even on silent switch

const TMP_DIR = RNFS.CachesDirectoryPath;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Detect the audio format from a base64 string by checking the file magic bytes.
 * Falls back to 'wav' if unknown.
 */
const detectFormat = (base64) => {
    try {
        // Decode first 4 bytes only
        const head = atob(base64.substring(0, 8));
        const b = (i) => head.charCodeAt(i);
        // WAV:  52 49 46 46  (RIFF)
        if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46) return 'wav';
        // MP3:  FF FB / FF F3 / FF F2  or ID3
        if (b(0) === 0xFF && (b(1) & 0xE0) === 0xE0) return 'mp3';
        if (b(0) === 0x49 && b(1) === 0x44 && b(2) === 0x33) return 'mp3';
        // OGG:  4F 67 67 53  (OggS)
        if (b(0) === 0x4F && b(1) === 0x67 && b(2) === 0x67 && b(3) === 0x53) return 'ogg';
        // FLAC: 66 4C 61 43  (fLaC)
        if (b(0) === 0x66 && b(1) === 0x4C && b(2) === 0x61 && b(3) === 0x43) return 'flac';
        // AAC/M4A: check for ftyp box (offset 4)
        if (b(4) === 0x66 && b(5) === 0x74 && b(6) === 0x79 && b(7) === 0x70) return 'm4a';
    } catch (_) { }
    return 'wav';
};

/** Write base64 audio to a uniquely-named temp file. Returns the full path. */
const writeTemp = async (base64, label = 'audio') => {
    const fmt = detectFormat(base64);
    const name = `steth_${label}_${Date.now()}.${fmt}`;
    const path = `${TMP_DIR}/${name}`;
    await RNFS.writeFile(path, base64, 'base64');
    debugLog('[SepPlayer] wrote temp file:', path);
    return path;
};

/** Load a Sound from a file path. Returns Promise<Sound>. */
const loadSound = (path) =>
    new Promise((resolve, reject) => {
        const s = new Sound(path, '', (err) => {
            if (err) {
                debugError('[SepPlayer] Sound load error:', err, path);
                reject(err);
            } else {
                debugLog('[SepPlayer] Sound loaded  duration=', s.getDuration(), 's');
                resolve(s);
            }
        });
    });

// ── Public API ────────────────────────────────────────────────────────────────

const SeparationAudioPlayer = {

    /**
     * Write base64 audio to a temp file and load it as a Sound object.
     *
     * @param {string} base64  Base64-encoded audio (WAV/MP3/AAC/OGG/FLAC/M4A)
     * @param {string} label   "heart" or "lung" — used in the temp filename
     * @returns {Promise<{ sound: Sound, duration: number, path: string }>}
     */
    async load(base64, label = 'audio') {
        const path = await writeTemp(base64, label);
        const sound = await loadSound(path);
        const duration = sound.getDuration();   // seconds
        return { sound, duration, path };
    },

    /**
     * Play a loaded Sound from the beginning (or resume if paused).
     * @param {Sound}    sound
     * @param {Function} onFinish  Called when playback completes naturally
     */
    play(sound, onFinish) {
        if (!sound) return;
        sound.setCurrentTime(0);
        sound.play((success) => {
            if (!success) debugError('[SepPlayer] Playback failed');
            if (onFinish) onFinish(success);
        });
    },

    /**
     * Resume from current position (does not seek to 0).
     */
    resume(sound, onFinish) {
        if (!sound) return;
        sound.play((success) => {
            if (!success) debugError('[SepPlayer] Resume failed');
            if (onFinish) onFinish(success);
        });
    },

    pause(sound) {
        sound?.pause();
    },

    stop(sound) {
        if (!sound) return;
        sound.stop();
        sound.setCurrentTime(0);
    },

    seek(sound, seconds) {
        sound?.setCurrentTime(seconds);
    },

    getDuration(sound) {
        return sound?.getDuration() ?? 0;
    },

    getCurrentTime(sound) {
        return new Promise((resolve) => {
            if (!sound) return resolve(0);
            sound.getCurrentTime((seconds) => resolve(seconds));
        });
    },

    release(sound) {
        try { sound?.release(); } catch (_) { }
    },

    /** Convenience: play heart output from Redux separation state */
    async playHeartAudio(base64) {
        const { sound } = await SeparationAudioPlayer.load(base64, 'heart');
        return new Promise((resolve, reject) => {
            sound.play((success) => {
                SeparationAudioPlayer.release(sound);
                success ? resolve() : reject(new Error('Heart audio playback failed'));
            });
        });
    },

    /** Convenience: play lung output from Redux separation state */
    async playLungAudio(base64) {
        const { sound } = await SeparationAudioPlayer.load(base64, 'lung');
        return new Promise((resolve, reject) => {
            sound.play((success) => {
                SeparationAudioPlayer.release(sound);
                success ? resolve() : reject(new Error('Lung audio playback failed'));
            });
        });
    },
};

export default SeparationAudioPlayer;