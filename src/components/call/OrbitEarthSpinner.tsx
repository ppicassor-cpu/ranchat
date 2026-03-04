import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEvent } from "expo";

type OrbitEarthSpinnerProps = {
  revealProgress?: Animated.Value;
};

type OrbitNode = {
  phase: Animated.Value;
  rotate: Animated.AnimatedInterpolation<string>;
  reverseRotate: Animated.AnimatedInterpolation<string>;
  depthScale: Animated.AnimatedInterpolation<number>;
  depthOpacity: Animated.AnimatedInterpolation<number>;
  frontOpacity: Animated.AnimatedInterpolation<number>;
  backOpacity: Animated.AnimatedInterpolation<number>;
  auraScale: Animated.AnimatedInterpolation<number>;
  auraRingScale: Animated.AnimatedInterpolation<number>;
  auraOpacity: Animated.AnimatedInterpolation<number>;
  sparkleOpacity: Animated.AnimatedInterpolation<number>;
};

const EARTH_VIDEO = require("../../../assets/et.mp4");
const HEART_OFFSETS = [0, 0.5] as const;
const ORBIT_DURATION_MS = 3100;
const ORBIT_SCALE_Y = 0.36;
const ORBIT_TILT_DEG = "-18deg";
const ORBIT_RADIUS = 102;
const EARTH_IDLE_SCALE = 0.2;
const EARTH_ROTATION_PLAYBACK_RATE = 3.2;
const STREAK_ANGLES = [0, 12, 24, 36, 50, 64, 78, 92, 108, 124, 140, 156, 172, 188, 204, 220, 236, 252, 268, 284, 300, 316, 332, 348] as const;
const STREAK_LENGTHS = [92, 360, 120, 210, 98, 480, 136, 260, 104, 420, 128, 300, 96, 540, 122, 280, 110, 500, 132, 320, 102, 460, 126, 380] as const;
const STREAK_WIDTHS = [1.1, 2.8, 1.3, 1.9, 1.15, 3.2, 1.45, 2.2, 1.2, 2.9, 1.6, 2.4, 1.15, 3.4, 1.55, 2.1, 1.3, 3, 1.7, 2.5, 1.2, 3.1, 1.6, 2.3] as const;
const STREAK_OFFSETS = [-112, -238, -126, -170, -118, -328, -138, -196, -120, -286, -134, -214, -116, -352, -132, -204, -124, -336, -140, -232, -118, -304, -136, -258] as const;

function createOrbitNode(offset: number): OrbitNode {
  const phase = new Animated.Value(offset);
  const orbitPhase = phase.interpolate({
    inputRange: [offset, offset + 1],
    outputRange: [offset, offset + 1],
  });
  const range = [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5];
  return {
    phase,
    rotate: phase.interpolate({
      inputRange: [offset, offset + 1],
      outputRange: [`${Math.round(offset * 360)}deg`, `${Math.round(offset * 360 + 360)}deg`],
    }),
    reverseRotate: phase.interpolate({
      inputRange: [offset, offset + 1],
      outputRange: [`${Math.round(-offset * 360)}deg`, `${Math.round(-offset * 360 - 360)}deg`],
    }),
    depthScale: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.84, 1.34, 0.88, 0.36, 0.84, 1.34, 0.88],
    }),
    depthOpacity: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.8, 1, 0.82, 0.36, 0.8, 1, 0.82],
    }),
    frontOpacity: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.5, 1, 0.5, 0, 0.5, 1, 0.5],
    }),
    backOpacity: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.45, 0, 0.45, 1, 0.45, 0, 0.45],
    }),
    auraScale: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.74, 1.14, 0.9, 0.52, 0.74, 1.14, 0.9],
    }),
    auraRingScale: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.92, 1.18, 1.02, 0.7, 0.92, 1.18, 1.02],
    }),
    auraOpacity: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.22, 0.44, 0.3, 0.14, 0.22, 0.44, 0.3],
    }),
    sparkleOpacity: orbitPhase.interpolate({
      inputRange: range,
      outputRange: [0.25, 0.95, 0.42, 0.12, 0.25, 0.95, 0.42],
    }),
  };
}

export default function OrbitEarthSpinner({ revealProgress }: OrbitEarthSpinnerProps) {
  const orbitNodes = useMemo(() => HEART_OFFSETS.map((offset) => createOrbitNode(offset)), []);
  const orbitFxPhase = useRef(new Animated.Value(0)).current;
  const earthSpinPausedRef = useRef(false);
  const [earthVideoReady, setEarthVideoReady] = useState(false);
  const showEarthIconFallback = false;
  const earthPlayer = useVideoPlayer(EARTH_VIDEO, (player) => {
    player.loop = true;
    player.muted = true;
    player.volume = 0;
    player.playbackRate = EARTH_ROTATION_PLAYBACK_RATE;
    player.currentTime = 0;
    player.play();
  });
  const earthPlayerStatus = useEvent(earthPlayer, "statusChange", { status: earthPlayer.status });
  const onEarthFirstFrameRender = useCallback(() => {
    setEarthVideoReady(true);
  }, []);

  useEffect(() => {
    const status = String((earthPlayerStatus as any)?.status || "");
    if (status !== "readyToPlay") return;
    setEarthVideoReady(true);
  }, [(earthPlayerStatus as any)?.status]);

  useEffect(() => {
    orbitNodes.forEach((node, idx) => {
      node.phase.setValue(HEART_OFFSETS[idx]);
    });
    const orbitAnims = orbitNodes.map((node, idx) =>
      Animated.loop(
        Animated.timing(node.phase, {
          toValue: HEART_OFFSETS[idx] + 1,
          duration: ORBIT_DURATION_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        })
      )
    );

    orbitAnims.forEach((anim) => anim.start());

    return () => {
      orbitAnims.forEach((anim) => anim.stop());
    };
  }, [orbitNodes]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(orbitFxPhase, {
        toValue: 1,
        duration: ORBIT_DURATION_MS * 2,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    orbitFxPhase.setValue(0);
    loop.start();
    return () => {
      loop.stop();
    };
  }, [orbitFxPhase]);

  useEffect(() => {
    const playerAny = earthPlayer as any;
    earthSpinPausedRef.current = false;
    try {
      playerAny.playbackRate = EARTH_ROTATION_PLAYBACK_RATE;
      playerAny.play?.();
    } catch {}
    if (!revealProgress) return;
    const listenerId = revealProgress.addListener(({ value }) => {
      const n = Number(value);
      const shouldPauseSpin = Number.isFinite(n) && n >= 0.68;
      if (shouldPauseSpin && !earthSpinPausedRef.current) {
        earthSpinPausedRef.current = true;
        try {
          playerAny.pause?.();
        } catch {}
        return;
      }
      if (!shouldPauseSpin && earthSpinPausedRef.current) {
        earthSpinPausedRef.current = false;
        try {
          playerAny.playbackRate = EARTH_ROTATION_PLAYBACK_RATE;
          playerAny.play?.();
        } catch {}
      }
    });
    return () => {
      revealProgress.removeListener(listenerId);
      earthSpinPausedRef.current = false;
      try {
        playerAny.playbackRate = EARTH_ROTATION_PLAYBACK_RATE;
        playerAny.play?.();
      } catch {}
    };
  }, [earthPlayer, revealProgress]);

  const revealClusterScale =
    revealProgress?.interpolate({
      inputRange: [0, 0.74, 0.88, 1],
      outputRange: [1, 1, 4.2, 24],
      extrapolate: "clamp",
    }) ?? 1;
  const revealClusterOpacity =
    revealProgress?.interpolate({
      inputRange: [0, 0.9, 1],
      outputRange: [1, 1, 0.98],
      extrapolate: "clamp",
    }) ?? 1;
  const revealOrbitScale =
    revealProgress?.interpolate({
      inputRange: [0, 0.03, 0.18, 0.5, 0.8, 1],
      outputRange: [1, 0.82, 0.58, 0.3, 0.05, 0],
      extrapolate: "clamp",
    }) ?? 1;
  const revealEarthScale =
    revealProgress?.interpolate({
      inputRange: [0, 0.74, 0.9, 1],
      outputRange: [1, 1, 1.82, 2.35],
      extrapolate: "clamp",
    }) ?? 1;
  const earthVideoOpacity =
    revealProgress?.interpolate({
      inputRange: [0, 0.97, 1],
      outputRange: [1, 1, 0.9],
      extrapolate: "clamp",
    }) ?? 1;
  const earthNeutralOverlayOpacity =
    revealProgress?.interpolate({
      inputRange: [0, 0.95, 1],
      outputRange: [0, 0, 0.16],
      extrapolate: "clamp",
    }) ?? 0;
  const revealSpeedLineOpacity =
    revealProgress?.interpolate({
      inputRange: [0, 0.74, 0.86, 0.98, 1],
      outputRange: [0, 0, 0.24, 0.9, 0],
      extrapolate: "clamp",
    }) ?? 0;
  const earthScale = Animated.multiply(revealEarthScale, EARTH_IDLE_SCALE);
  const orbitPlaneTransform = [{ rotate: ORBIT_TILT_DEG }, { scaleY: ORBIT_SCALE_Y }, { scale: revealOrbitScale }] as const;
  const orbitGlowOpacity = orbitFxPhase.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.2, 0.55, 0.2],
  });
  const orbitGlowScale = orbitFxPhase.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.994, 1.018, 0.994],
  });
  const orbitShimmerRotate = orbitFxPhase.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.wrap, { opacity: revealClusterOpacity, transform: [{ scale: revealClusterScale }] }]}>
      <Animated.View
        style={[
          styles.orbitPlaneBack,
          {
            transform: orbitPlaneTransform,
          },
        ]}
      >
        <View style={styles.orbitRingGradientShell}>
          <LinearGradient
            colors={["rgba(44, 44, 44, 0.96)", "rgba(78, 78, 78, 0.72)", "rgba(118, 118, 118, 0.9)"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.orbitRingGradientFill}
          />
          <Animated.View style={[styles.orbitRingAura, { opacity: orbitGlowOpacity, transform: [{ scale: orbitGlowScale }] }]} />
          <Animated.View style={[styles.orbitRingShimmerCarrier, { transform: [{ rotate: orbitShimmerRotate }] }]}>
            <LinearGradient
              colors={["rgba(255,255,255,0)", "rgba(255,255,255,0.62)", "rgba(255,255,255,0)"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.orbitRingShimmer}
            />
          </Animated.View>
          <View style={styles.orbitRingCutout} />
        </View>
        {orbitNodes.map((node, idx) => (
          <Animated.View
            key={`orbit_heart_back_${idx}`}
            style={[
              styles.heartCarrier,
              {
                opacity: Animated.multiply(node.depthOpacity, node.backOpacity),
                transform: [{ rotate: node.rotate }, { translateX: ORBIT_RADIUS }, { scale: node.depthScale }],
              },
            ]}
          >
            <Animated.View style={[styles.heartUnsquash, { transform: [{ rotate: node.reverseRotate }, { scaleY: 1 / ORBIT_SCALE_Y }] }]}>
              <View style={styles.heartShell}>
                <Animated.View
                  style={[
                    styles.heartAuraOuter,
                    {
                      opacity: Animated.multiply(node.auraOpacity, node.backOpacity),
                      transform: [{ scale: node.auraScale }],
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.heartAuraRing,
                    {
                      opacity: Animated.multiply(node.auraOpacity, node.backOpacity),
                      transform: [{ scale: node.auraRingScale }],
                    },
                  ]}
                />
                <Ionicons name="heart" size={28} color="rgba(255, 64, 178, 0.92)" style={styles.heartGlow} />
                <Ionicons name="heart" size={18} color="#FFD7F0" style={styles.heartCore} />
                <Animated.View style={[styles.heartSparkDot, { opacity: Animated.multiply(node.sparkleOpacity, node.backOpacity) }]} />
              </View>
            </Animated.View>
          </Animated.View>
        ))}
      </Animated.View>

      <Animated.View style={[styles.earthWrap, { transform: [{ scale: earthScale }] }]}>
        <View style={styles.earthMask}>
          {showEarthIconFallback && !earthVideoReady ? (
            <View pointerEvents="none" style={styles.earthFallbackWrap}>
              <LinearGradient
                colors={["#0D2740", "#114067", "#1A5C8B", "#0F2B47"]}
                start={{ x: 0.14, y: 0.12 }}
                end={{ x: 0.86, y: 0.88 }}
                style={styles.earthFallbackGradient}
              />
              <Ionicons name="earth" size={82} color="#8FD8FF" style={styles.earthFallbackIcon} />
              <View style={styles.earthFallbackGlow} />
            </View>
          ) : null}
          <Animated.View style={[styles.earthVideoFadeWrap, { opacity: earthVideoOpacity }]}>
            <VideoView
              player={earthPlayer}
              style={styles.earthVideo}
              contentFit="cover"
              surfaceType="textureView"
              useExoShutter={false}
              nativeControls={false}
              allowsFullscreen={false}
              allowsPictureInPicture={false}
              onFirstFrameRender={onEarthFirstFrameRender}
            />
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.earthNeutralOverlay, { opacity: earthNeutralOverlayOpacity }]} />
        </View>
      </Animated.View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.orbitPlaneFront,
          {
            transform: orbitPlaneTransform,
          },
        ]}
      >
        {orbitNodes.map((node, idx) => (
          <Animated.View
            key={`orbit_heart_front_${idx}`}
            style={[
              styles.heartCarrier,
              {
                opacity: Animated.multiply(node.depthOpacity, node.frontOpacity),
                transform: [{ rotate: node.rotate }, { translateX: ORBIT_RADIUS }, { scale: node.depthScale }],
              },
            ]}
          >
            <Animated.View style={[styles.heartUnsquash, { transform: [{ rotate: node.reverseRotate }, { scaleY: 1 / ORBIT_SCALE_Y }] }]}>
              <View style={styles.heartShell}>
                <Animated.View
                  style={[
                    styles.heartAuraOuter,
                    {
                      opacity: Animated.multiply(node.auraOpacity, node.frontOpacity),
                      transform: [{ scale: node.auraScale }],
                    },
                  ]}
                />
                <Animated.View
                  style={[
                    styles.heartAuraRing,
                    {
                      opacity: Animated.multiply(node.auraOpacity, node.frontOpacity),
                      transform: [{ scale: node.auraRingScale }],
                    },
                  ]}
                />
                <Ionicons name="heart" size={28} color="rgba(255, 64, 178, 0.92)" style={styles.heartGlow} />
                <Ionicons name="heart" size={18} color="#FFD7F0" style={styles.heartCore} />
                <Animated.View style={[styles.heartSparkDot, { opacity: Animated.multiply(node.sparkleOpacity, node.frontOpacity) }]} />
              </View>
            </Animated.View>
          </Animated.View>
        ))}
      </Animated.View>
      </Animated.View>

      <Animated.View pointerEvents="none" style={[styles.speedLineLayer, { opacity: revealSpeedLineOpacity }]}>
        {STREAK_ANGLES.map((deg, idx) => (
          <Animated.View
            key={`speed_line_${deg}`}
            style={[
              styles.speedLineWrap,
              {
                width: STREAK_WIDTHS[idx],
                height: STREAK_LENGTHS[idx],
                transform: [{ rotate: `${deg}deg` }, { translateY: STREAK_OFFSETS[idx] }],
              },
            ]}
          >
            <LinearGradient
              colors={["rgba(255,255,255,0)", "#FFFFFF", "#FFFFFF", "rgba(255,255,255,0)"]}
              locations={[0, 0.24, 0.72, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.speedLineGradient}
            />
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 280,
    height: 280,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  wrap: {
    width: 280,
    height: 280,
    alignItems: "center",
    justifyContent: "center",
  },
  orbitPlaneBack: {
    position: "absolute",
    width: 246,
    height: 246,
    alignItems: "center",
    justifyContent: "center",
  },
  orbitPlaneFront: {
    position: "absolute",
    width: 246,
    height: 246,
    alignItems: "center",
    justifyContent: "center",
  },
  orbitRingGradientShell: {
    position: "absolute",
    top: 16,
    left: 16,
    width: 214,
    height: 214,
    borderRadius: 107,
    overflow: "hidden",
  },
  orbitRingGradientFill: {
    ...StyleSheet.absoluteFillObject,
  },
  orbitRingAura: {
    position: "absolute",
    top: 0,
    left: 0,
    width: 214,
    height: 214,
    borderRadius: 107,
    borderWidth: 1,
    borderColor: "rgba(98, 98, 98, 0.92)",
  },
  orbitRingShimmerCarrier: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  orbitRingShimmer: {
    marginTop: -1,
    width: 72,
    height: 10,
    borderRadius: 999,
  },
  orbitRingCutout: {
    position: "absolute",
    top: 1,
    left: 1,
    right: 1,
    bottom: 1,
    borderRadius: 106,
    backgroundColor: "#000000",
  },
  heartCarrier: {
    position: "absolute",
    width: 0,
    height: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  heartUnsquash: {
    alignItems: "center",
    justifyContent: "center",
  },
  heartShell: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  heartAuraOuter: {
    position: "absolute",
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "rgba(255, 88, 186, 0.22)",
    shadowColor: "#FF4DB7",
    shadowOpacity: 0.8,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  heartAuraRing: {
    position: "absolute",
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(255, 203, 238, 0.82)",
  },
  heartGlow: {
    position: "absolute",
    textShadowColor: "rgba(255, 43, 170, 0.96)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  heartCore: {
    position: "absolute",
    textShadowColor: "rgba(255, 228, 244, 0.9)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  heartSparkDot: {
    position: "absolute",
    top: 4,
    right: 3,
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: "#FFE5F5",
    shadowColor: "#FFC3E8",
    shadowOpacity: 0.95,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  earthWrap: {
    width: 164,
    height: 164,
    borderRadius: 82,
    alignItems: "center",
    justifyContent: "center",
  },
  earthMask: {
    width: 146,
    height: 146,
    borderRadius: 73,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  earthVideo: {
    width: "116%",
    height: "116%",
    alignSelf: "center",
    marginTop: -12,
  },
  earthVideoFadeWrap: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  earthFallbackWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  earthFallbackGradient: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 73,
  },
  earthFallbackIcon: {
    textShadowColor: "rgba(80, 190, 255, 0.65)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  earthFallbackGlow: {
    position: "absolute",
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(173, 230, 255, 0.17)",
  },
  earthNeutralOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000000",
  },
  speedLineLayer: {
    position: "absolute",
    top: -260,
    left: -260,
    right: -260,
    bottom: -260,
    alignItems: "center",
    justifyContent: "center",
  },
  speedLineWrap: {
    position: "absolute",
    borderRadius: 999,
    overflow: "hidden",
  },
  speedLineGradient: {
    ...StyleSheet.absoluteFillObject,
  },
});


