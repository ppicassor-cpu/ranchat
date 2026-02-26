import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const WAVE_WIDTH = 112;
const WAVE_HEIGHT = 44;
const WAVE_DOT_STEP = 1.8;
const WAVE_DOT_CORE = 1.6;
const WAVE_DOT_GLOW = 6.2;
const WAVE_DOT_WHITE_OUTER = 9.6;
const NEON_PINK_CORE = "#ff76d9";
const WHITE_NEON_GLOW = "rgba(255, 255, 255, 0.09)";
const WHITE_NEON_OUTER = "rgba(255, 255, 255, 0.035)";

type WavePoint = { x: number; y: number };

const ECG_POINTS: WavePoint[] = [
  { x: 0, y: 22 },
  { x: 12, y: 22 },
  { x: 20, y: 20.4 },
  { x: 28, y: 22 },
  { x: 36, y: 22 },
  { x: 45, y: 23.3 },
  { x: 52, y: 7 },
  { x: 57, y: 35.5 },
  { x: 63, y: 22 },
  { x: 74, y: 22 },
  { x: 83, y: 15.8 },
  { x: 92, y: 19.8 },
  { x: 100, y: 22 },
  { x: 112, y: 22 },
];

function sampleWaveDots(points: WavePoint[], step: number): WavePoint[] {
  const dots: WavePoint[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const distance = Math.hypot(dx, dy);
    const count = Math.max(1, Math.floor(distance / step));
    for (let j = 0; j <= count; j += 1) {
      const t = j / count;
      dots.push({
        x: p1.x + dx * t,
        y: p1.y + dy * t,
      });
    }
  }
  return dots;
}

const WAVE_DOTS = sampleWaveDots(ECG_POINTS, WAVE_DOT_STEP);
const RIGHT_WAVE_DOTS = WAVE_DOTS.map((dot) => ({ x: dot.x, y: WAVE_HEIGHT - dot.y }));

export default function HeartbeatSpinner() {
  const leftReveal = useRef(new Animated.Value(0)).current;
  const rightReveal = useRef(new Animated.Value(0)).current;
  const heartScale = useRef(new Animated.Value(0.72)).current;
  const heartOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(leftReveal, {
            toValue: 1,
            duration: 900,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(rightReveal, {
            toValue: 1,
            duration: 900,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: false,
          }),
        ]),
        Animated.delay(40),
        Animated.parallel([
          Animated.timing(heartOpacity, {
            toValue: 1,
            duration: 130,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(heartScale, {
              toValue: 1.2,
              duration: 170,
              easing: Easing.out(Easing.back(1.2)),
              useNativeDriver: true,
            }),
            Animated.timing(heartScale, {
              toValue: 1,
              duration: 170,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.delay(170),
        Animated.parallel([
          Animated.timing(leftReveal, {
            toValue: 0,
            duration: 260,
            easing: Easing.in(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(rightReveal, {
            toValue: 0,
            duration: 260,
            easing: Easing.in(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(heartOpacity, {
            toValue: 0,
            duration: 250,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(heartScale, {
            toValue: 0.74,
            duration: 260,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.delay(110),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [heartOpacity, heartScale, leftReveal, rightReveal]);

  const leftWaveWidth = leftReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0, WAVE_WIDTH],
  });
  const rightWaveWidth = rightReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [0, WAVE_WIDTH],
  });
  const waveOpacity = leftReveal.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.12, 0.58, 1],
  });
  const pulseScale = heartScale.interpolate({
    inputRange: [0.74, 1.2],
    outputRange: [0.82, 1.7],
  });
  const pulseScaleFar = heartScale.interpolate({
    inputRange: [0.74, 1.2],
    outputRange: [1.08, 2.15],
  });
  const pulseOpacity = heartOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.3],
  });
  const pulseFarOpacity = heartOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.15],
  });
  const auraScale = heartScale.interpolate({
    inputRange: [0.74, 1.2],
    outputRange: [0.9, 1.9],
  });
  const auraOpacity = heartOpacity.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.32],
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.wavesRow}>
        <View style={styles.waveLane}>
          <Animated.View style={[styles.waveMask, { width: leftWaveWidth, opacity: waveOpacity }]}>
            <View style={styles.waveWrap}>
              {WAVE_DOTS.map((dot, idx) => (
                <View
                  key={`low-${idx}`}
                  style={[
                    styles.waveDotWhiteOuter,
                    {
                      left: dot.x - WAVE_DOT_WHITE_OUTER / 2,
                      top: dot.y - WAVE_DOT_WHITE_OUTER / 2,
                    },
                  ]}
                />
              ))}
              {WAVE_DOTS.map((dot, idx) => (
                <View
                  key={`lg-${idx}`}
                  style={[
                    styles.waveDotGlow,
                    {
                      left: dot.x - WAVE_DOT_GLOW / 2,
                      top: dot.y - WAVE_DOT_GLOW / 2,
                    },
                  ]}
                />
              ))}
              {WAVE_DOTS.map((dot, idx) => (
                <View
                  key={`lc-${idx}`}
                  style={[
                    styles.waveDotCore,
                    {
                      left: dot.x - WAVE_DOT_CORE / 2,
                      top: dot.y - WAVE_DOT_CORE / 2,
                    },
                  ]}
                />
              ))}
            </View>
          </Animated.View>
        </View>

        <View style={styles.centerGap} />

        <View style={[styles.waveLane, styles.waveLaneRight]}>
          <Animated.View style={[styles.waveMask, styles.waveMaskRight, { width: rightWaveWidth, opacity: waveOpacity }]}>
            <View style={[styles.waveWrap, styles.waveWrapRight]}>
              {RIGHT_WAVE_DOTS.map((dot, idx) => (
                <View
                  key={`row-${idx}`}
                  style={[
                    styles.waveDotWhiteOuter,
                    {
                      left: dot.x - WAVE_DOT_WHITE_OUTER / 2,
                      top: dot.y - WAVE_DOT_WHITE_OUTER / 2,
                    },
                  ]}
                />
              ))}
              {RIGHT_WAVE_DOTS.map((dot, idx) => (
                <View
                  key={`rg-${idx}`}
                  style={[
                    styles.waveDotGlow,
                    {
                      left: dot.x - WAVE_DOT_GLOW / 2,
                      top: dot.y - WAVE_DOT_GLOW / 2,
                    },
                  ]}
                />
              ))}
              {RIGHT_WAVE_DOTS.map((dot, idx) => (
                <View
                  key={`rc-${idx}`}
                  style={[
                    styles.waveDotCore,
                    {
                      left: dot.x - WAVE_DOT_CORE / 2,
                      top: dot.y - WAVE_DOT_CORE / 2,
                    },
                  ]}
                />
              ))}
            </View>
          </Animated.View>
        </View>
      </View>

      <Animated.View style={[styles.heartAura, { opacity: auraOpacity, transform: [{ scale: auraScale }] }]} />
      <Animated.View style={[styles.pulseRing, { opacity: pulseOpacity, transform: [{ scale: pulseScale }] }]} />
      <Animated.View style={[styles.pulseRingFar, { opacity: pulseFarOpacity, transform: [{ scale: pulseScaleFar }] }]} />

      <Animated.View style={[styles.heartWrap, { opacity: heartOpacity, transform: [{ scale: heartScale }] }]}>
        <Ionicons name="heart" size={34} color="rgba(255, 104, 218, 0.62)" style={styles.heartGlowIcon} />
        <Ionicons name="heart" size={26} color="#ffdff6" style={styles.heartCoreIcon} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 280,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  wavesRow: {
    width: 280,
    height: WAVE_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  waveLane: {
    width: WAVE_WIDTH,
    height: WAVE_HEIGHT,
    justifyContent: "center",
  },
  waveLaneRight: {
    alignItems: "flex-end",
  },
  centerGap: {
    width: 0,
  },
  waveMask: {
    height: WAVE_HEIGHT,
    overflow: "hidden",
    position: "relative",
  },
  waveMaskRight: {
    marginLeft: "auto",
  },
  waveWrap: {
    width: WAVE_WIDTH,
    height: WAVE_HEIGHT,
    position: "absolute",
    left: 0,
    top: 0,
  },
  waveWrapRight: {
    left: undefined,
    right: 0,
  },
  waveDotGlow: {
    position: "absolute",
    width: WAVE_DOT_GLOW,
    height: WAVE_DOT_GLOW,
    borderRadius: WAVE_DOT_GLOW / 2,
    backgroundColor: WHITE_NEON_GLOW,
  },
  waveDotWhiteOuter: {
    position: "absolute",
    width: WAVE_DOT_WHITE_OUTER,
    height: WAVE_DOT_WHITE_OUTER,
    borderRadius: WAVE_DOT_WHITE_OUTER / 2,
    backgroundColor: WHITE_NEON_OUTER,
  },
  waveDotCore: {
    position: "absolute",
    width: WAVE_DOT_CORE,
    height: WAVE_DOT_CORE,
    borderRadius: WAVE_DOT_CORE / 2,
    backgroundColor: NEON_PINK_CORE,
  },
  heartAura: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255, 100, 214, 0.34)",
  },
  pulseRing: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 2,
    borderColor: "rgba(255, 126, 221, 0.72)",
  },
  pulseRingFar: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: 1.5,
    borderColor: "rgba(255, 152, 227, 0.38)",
  },
  heartWrap: {
    position: "absolute",
    top: 6,
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  heartGlowIcon: {
    position: "absolute",
    textShadowColor: "rgba(255, 96, 214, 0.9)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  heartCoreIcon: {
    position: "absolute",
    textShadowColor: "rgba(255, 132, 224, 0.82)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: Platform.OS === "android" ? 6 : 8,
  },
});
