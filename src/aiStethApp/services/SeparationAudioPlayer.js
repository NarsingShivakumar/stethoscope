// src/aiStethApp/services/SeparationAudioPlayer.js  v3

import RNFS from 'react-native-fs';
import Sound from 'react-native-sound';
import { Platform } from 'react-native';
import { debugLog, debugError } from '../../config/AppConfig';

Sound.setCategory('Playback', true);

const TMP_DIR = RNFS.CachesDirectoryPath;

const stripBase64Prefix = (input = '') => {
    if (!input) return '';
    const idx = input.indexOf('base64,');
    return idx >= 0 ? input.slice(idx + 7) : input;
};

const makeTempPath = (tag = 'audio') => {
    const safeTag = String(tag).replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    return `${TMP_DIR}/sep_${safeTag}_${Date.now()}.wav`;
};

const safeUnlink = async (path) => {
    if (!path) return;
    try {
        const exists = await RNFS.exists(path);
        if (exists) await RNFS.unlink(path);
    } catch (_) { }
};

const load = async (base64Audio, tag = 'audio') => {
    const cleanBase64 = stripBase64Prefix(base64Audio);
    if (!cleanBase64) {
        throw new Error('Empty audio payload');
    }

    const filePath = makeTempPath(tag);
    await safeUnlink(filePath);
    await RNFS.writeFile(filePath, cleanBase64, 'base64');

    const stat = await RNFS.stat(filePath);
    debugLog?.('SepPlayer load file', {
        filePath,
        size: stat?.size,
        tag,
    });

    if (!stat?.size || Number(stat.size) < 128) {
        throw new Error(`Audio file too small: ${stat?.size || 0} bytes`);
    }

    return await new Promise((resolve, reject) => {
        const sound = new Sound(filePath, Platform.OS === 'android' ? '' : undefined, (error) => {
            if (error) {
                debugError?.('SepPlayer Sound load failed', error);
                safeUnlink(filePath);
                reject(error);
                return;
            }

            const duration = sound.getDuration?.() || 0;
            debugLog?.('SepPlayer loaded', { filePath, duration });

            if (!duration || duration < 0.5) {
                debugError?.('SepPlayer suspicious short duration', { filePath, duration });
            }

            sound.__filePath = filePath;
            resolve({ sound, duration, filePath });
        });
    });
};

const play = (sound, onEnd) => {
    if (!sound) return;
    sound.play((success) => {
        if (!success) {
            debugError?.('SepPlayer playback failed');
        }
        onEnd?.(success);
    });
};

const pause = (sound) => {
    try {
        sound?.pause?.();
    } catch (e) {
        debugError?.('SepPlayer pause failed', e);
    }
};

const resume = (sound, onEnd) => {
    if (!sound) return;
    sound.play((success) => {
        if (!success) {
            debugError?.('SepPlayer resume failed');
        }
        onEnd?.(success);
    });
};

const stop = (sound) => {
    try {
        sound?.stop?.(() => { });
    } catch (e) {
        debugError?.('SepPlayer stop failed', e);
    }
};

const seekTo = (sound, seconds) => {
    try {
        sound?.setCurrentTime?.(Math.max(0, seconds || 0));
    } catch (e) {
        debugError?.('SepPlayer seek failed', e);
    }
};

const getCurrentTime = (sound) =>
    new Promise((resolve) => {
        try {
            if (!sound?.getCurrentTime) {
                resolve(0);
                return;
            }
            sound.getCurrentTime((seconds) => resolve(seconds || 0));
        } catch (_) {
            resolve(0);
        }
    });

const release = async (sound) => {
    if (!sound) return;
    const filePath = sound.__filePath;
    try {
        sound.stop?.(() => { });
    } catch (_) { }
    try {
        sound.release?.();
    } catch (_) { }
    await safeUnlink(filePath);
};

export default {
    load,
    play,
    pause,
    resume,
    stop,
    seekTo,
    getCurrentTime,
    release,
};