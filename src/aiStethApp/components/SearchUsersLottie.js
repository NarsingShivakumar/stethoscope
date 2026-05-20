// components/SearchUsersLottie.js
import React, { memo, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import LottieView from 'lottie-react-native';

/**
 * IMPORTANT:
 * Put your lottie json files in your project and update the mapping below.
 * Example: src/assets/lottie/heart.json
 */
const LOTTIES = {
  heart: require('../../assets/lottie/heart.json'),
  // add more here if needed
};

const SearchUsersLottie = memo(({
  name = 'heart',
  size = 140,
  autoPlay = true,
  loop = true,
  speed = 1,
  playing = true,
  style,
}) => {
  const ref = useRef(null);

  const source = useMemo(() => {
    return LOTTIES[name] ?? LOTTIES.heart;
  }, [name]);

  useEffect(() => {
    if (!ref.current) return;
    try {
      ref.current.setSpeed?.(speed);
    } catch {}
  }, [speed]);

  useEffect(() => {
    if (!ref.current) return;
    try {
      if (playing) ref.current.play?.();
      else ref.current.pause?.();
    } catch {}
  }, [playing]);

  return (
    <View style={[{ width: size, height: size }, style]}>
      <LottieView
        ref={ref}
        source={source}
        autoPlay={autoPlay}
        loop={loop}
        style={{ width: size, height: size }}
      />
    </View>
  );
});

export default SearchUsersLottie;