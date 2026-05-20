// src/hooks/useAudioPlayer.js
import { useState, useEffect, useRef } from 'react';
import Sound from 'react-native-sound';

Sound.setCategory('Playback');

export const useAudioPlayer = () => {
  const [currentSound, setCurrentSound] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentFile, setCurrentFile] = useState(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const progressInterval = useRef(null);

  useEffect(() => {
    return () => {
      if (currentSound) {
        currentSound.stop();
        currentSound.release();
      }
      if (progressInterval.current) {
        clearInterval(progressInterval.current);
      }
    };
  }, []);

  const startProgressTracking = (sound) => {
    progressInterval.current = setInterval(() => {
      if (sound && sound.isLoaded()) {
        sound.getCurrentTime((seconds) => {
          setCurrentTime(seconds);
        });
      }
    }, 100);
  };

  const stopProgressTracking = () => {
    if (progressInterval.current) {
      clearInterval(progressInterval.current);
      progressInterval.current = null;
    }
  };

  const playSound = (filePath, onComplete) => {
    // If already playing this file, pause it
    if (currentFile === filePath && currentSound && isPlaying) {
      currentSound.pause(() => {
        setIsPlaying(false);
        stopProgressTracking();
      });
      return;
    }

    // If playing same file but paused, resume
    if (currentFile === filePath && currentSound && !isPlaying) {
      currentSound.play((success) => {
        if (success) {
          console.log('Successfully finished playing');
        } else {
          console.log('Playback failed');
        }
        setIsPlaying(false);
        stopProgressTracking();
        setCurrentTime(0);
        if (onComplete) onComplete();
      });
      setIsPlaying(true);
      startProgressTracking(currentSound);
      return;
    }

    // Stop and release previous sound
    if (currentSound) {
      currentSound.stop();
      currentSound.release();
      stopProgressTracking();
    }

    // Load and play new sound
    const sound = new Sound(filePath, '', (error) => {
      if (error) {
        console.log('Failed to load the sound', error);
        return;
      }

      // Get duration
      setDuration(sound.getDuration());
      setCurrentFile(filePath);
      setCurrentSound(sound);

      // Play the sound
      sound.play((success) => {
        if (success) {
          console.log('Successfully finished playing');
        } else {
          console.log('Playback failed');
        }
        setIsPlaying(false);
        stopProgressTracking();
        setCurrentTime(0);
        if (onComplete) onComplete();
      });

      setIsPlaying(true);
      startProgressTracking(sound);
    });
  };

  const stopSound = () => {
    if (currentSound) {
      currentSound.stop(() => {
        setIsPlaying(false);
        setCurrentTime(0);
        stopProgressTracking();
      });
    }
  };

  const pauseSound = () => {
    if (currentSound && isPlaying) {
      currentSound.pause(() => {
        setIsPlaying(false);
        stopProgressTracking();
      });
    }
  };

  const seekTo = (time) => {
    if (currentSound) {
      currentSound.setCurrentTime(time);
      setCurrentTime(time);
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return {
    playSound,
    stopSound,
    pauseSound,
    seekTo,
    isPlaying,
    currentFile,
    duration,
    currentTime,
    formatTime,
  };
};
