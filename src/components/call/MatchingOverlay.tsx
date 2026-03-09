import React, { useEffect, useRef } from "react";
import { Animated, Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AppText from "../AppText";
import OrbitEarthSpinner from "./OrbitEarthSpinner";

type MatchingOverlayProps = {
  styles: any;
  phase: string;
  matchRevealActive: boolean;
  matchRevealProgress: Animated.Value;
  reMatchText: string;
  authBooting: boolean;
  fastMatchHint: boolean;
  matchingActionsVisible: boolean;
  roomId: string | null;
  peerInfo: any;
  shiftForTopNativeAd: boolean;
  onPressMatchingBeauty: () => void;
  onPressMatchingFortune: () => void;
  onPressMatchingGame: () => void;
  onPressMatchingFilter: () => void;
  t: (key: string, params?: any) => string;
};

export default function MatchingOverlay({
  styles,
  phase,
  matchRevealActive,
  matchRevealProgress,
  reMatchText,
  authBooting,
  fastMatchHint,
  matchingActionsVisible,
  roomId,
  peerInfo,
  shiftForTopNativeAd,
  onPressMatchingBeauty,
  onPressMatchingFortune,
  onPressMatchingGame,
  onPressMatchingFilter,
  t,
}: MatchingOverlayProps) {
  const isCalling = phase === "calling";
  const matchedRevealStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== "matched") {
      matchedRevealStartedRef.current = false;
      return;
    }
    if (matchRevealActive) {
      matchedRevealStartedRef.current = true;
    }
  }, [matchRevealActive, phase]);
  const hideOrbitSpinner = phase === "matched" && !matchRevealActive && matchedRevealStartedRef.current;
  const showOrbitSpinner =
    !hideOrbitSpinner &&
    (matchRevealActive ||
      authBooting ||
      fastMatchHint ||
      Boolean(reMatchText) ||
      phase === "connecting" ||
      phase === "queued" ||
      phase === "matched");
  const matchingClusterShiftY = 0;

  return (
    <View
      pointerEvents={isCalling ? "none" : "auto"}
      style={[styles.centerOverlay, isCalling ? { opacity: 0 } : null]}
    >
      {matchRevealActive ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.matchRevealBackdrop,
            {
              opacity: matchRevealProgress.interpolate({
                inputRange: [0, 0.84, 1],
                outputRange: [1, 1, 1],
                extrapolate: "clamp",
              }),
            },
          ]}
        />
      ) : null}

      {showOrbitSpinner ? (
        <View style={{ transform: [{ translateY: matchingClusterShiftY }] }}>
          <OrbitEarthSpinner revealProgress={matchRevealProgress} />
        </View>
      ) : null}

      <View style={[styles.centerTextDock, { transform: [{ translateY: matchingClusterShiftY }] }]}>
        <View style={styles.centerTextMainWrap}>
          {reMatchText ? (
            <View style={styles.reMatchTextWrap}>
              <AppText style={styles.reMatchTextTop}>{String(reMatchText).split("\n")[0] || ""}</AppText>
              {String(reMatchText).split("\n")[1] ? (
                <AppText style={styles.reMatchTextBottom}>{String(reMatchText).split("\n")[1]}</AppText>
              ) : null}
            </View>
          ) : authBooting ? (
            <AppText style={styles.centerText}>{t("call.connecting")}</AppText>
          ) : fastMatchHint ? (
            <AppText style={styles.centerText}>{t("call.fast_matching")}</AppText>
          ) : phase === "connecting" ? (
            <AppText style={styles.centerText}>{t("call.connecting")}</AppText>
          ) : phase === "matched" ? (
            <AppText style={styles.centerText}>{t("call.matched")}</AppText>
          ) : phase === "queued" ? (
            <AppText style={styles.centerText}>{String(t("call.connecting") || "")}</AppText>
          ) : null}
        </View>

        {matchingActionsVisible && !authBooting && !matchRevealActive ? (
          <View style={styles.matchingActionsDock}>
            <AppText style={styles.matchingActionsDesc}>{t("call.waiting_actions_desc")}</AppText>

            <View style={styles.matchingActionRow}>
              <Pressable onPress={onPressMatchingBeauty} style={({ pressed }) => [styles.matchingActionBtn, pressed ? styles.matchingActionBtnPressed : null]}>
                <View style={styles.matchingActionIconWrap}>
                  <Ionicons name="sparkles" size={18} color="#EDEDED" />
                </View>
                <AppText numberOfLines={1} style={styles.matchingActionLabel}>
                  {t("call.waiting_actions_beauty")}
                </AppText>
              </Pressable>

              <Pressable onPress={onPressMatchingFortune} style={({ pressed }) => [styles.matchingActionBtn, pressed ? styles.matchingActionBtnPressed : null]}>
                <View style={styles.matchingActionIconWrap}>
                  <Ionicons name="planet" size={18} color="#EDEDED" />
                </View>
                <AppText numberOfLines={1} style={styles.matchingActionLabel}>
                  {t("call.waiting_actions_fortune")}
                </AppText>
              </Pressable>

              <Pressable onPress={onPressMatchingGame} style={({ pressed }) => [styles.matchingActionBtn, pressed ? styles.matchingActionBtnPressed : null]}>
                <View style={styles.matchingActionIconWrap}>
                  <Ionicons name="game-controller" size={18} color="#EDEDED" />
                </View>
                <AppText numberOfLines={1} style={styles.matchingActionLabel}>
                  {t("call.waiting_actions_game")}
                </AppText>
              </Pressable>

              <Pressable onPress={onPressMatchingFilter} style={({ pressed }) => [styles.matchingActionBtn, pressed ? styles.matchingActionBtnPressed : null]}>
                <View style={styles.matchingActionIconWrap}>
                  <Ionicons name="funnel-outline" size={18} color="#EDEDED" />
                </View>
                <AppText numberOfLines={1} style={styles.matchingActionLabel}>
                  {t("call.waiting_actions_filter")}
                </AppText>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}
