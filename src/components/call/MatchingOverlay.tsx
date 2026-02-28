import React from "react";
import { Animated, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { Ionicons } from "@expo/vector-icons";
import AppText from "../AppText";
import HeartbeatSpinner from "../HeartbeatSpinner";

type MatchingOverlayProps = {
  styles: any;
  phase: string;
  matchRevealActive: boolean;
  remoteStreamURL: string | null;
  matchRevealBackdropOpacity: Animated.AnimatedInterpolation<number>;
  matchRevealHeartOpacity: Animated.AnimatedInterpolation<number>;
  matchRevealHeartScale: Animated.AnimatedInterpolation<number>;
  remoteVideoZOrder: number;
  reMatchText: string;
  authBooting: boolean;
  fastMatchHint: boolean;
  roomId: string | null;
  peerInfo: any;
  t: (key: string, params?: any) => string;
};

export default function MatchingOverlay({
  styles,
  phase,
  matchRevealActive,
  remoteStreamURL,
  matchRevealBackdropOpacity,
  matchRevealHeartOpacity,
  matchRevealHeartScale,
  remoteVideoZOrder,
  reMatchText,
  authBooting,
  fastMatchHint,
  roomId,
  peerInfo,
  t,
}: MatchingOverlayProps) {
  if (phase === "calling") return null;

  return (
    <View style={styles.centerOverlay}>
      {matchRevealActive && remoteStreamURL ? (
        <>
          <Animated.View pointerEvents="none" style={[styles.matchRevealBackdrop, { opacity: matchRevealBackdropOpacity }]} />
          <Animated.View
            pointerEvents="none"
            style={[
              styles.matchRevealHeartWrap,
              { opacity: matchRevealHeartOpacity, transform: [{ scale: matchRevealHeartScale }] },
            ]}
          >
            <View style={[styles.matchRevealPiece, styles.matchRevealLobeLeft]}>
              <RTCView
                streamURL={remoteStreamURL}
                style={styles.matchRevealVideo}
                objectFit="cover"
                zOrder={remoteVideoZOrder}
                mirror={true}
              />
            </View>
            <View style={[styles.matchRevealPiece, styles.matchRevealLobeRight]}>
              <RTCView
                streamURL={remoteStreamURL}
                style={styles.matchRevealVideo}
                objectFit="cover"
                zOrder={remoteVideoZOrder}
                mirror={true}
              />
            </View>
            <View style={[styles.matchRevealPiece, styles.matchRevealBottomDiamond]}>
              <RTCView
                streamURL={remoteStreamURL}
                style={styles.matchRevealVideoDiamond}
                objectFit="cover"
                zOrder={remoteVideoZOrder}
                mirror={true}
              />
            </View>
            <Ionicons name="heart" size={178} color="rgba(255, 196, 226, 0.54)" style={styles.matchRevealHeartGlow} />
            <Ionicons name="heart" size={138} color="rgba(255, 231, 244, 0.52)" style={styles.matchRevealHeartFill} />
          </Animated.View>
        </>
      ) : (
        <HeartbeatSpinner />
      )}

      <View style={styles.centerTextDock}>
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
        ) : phase === "matched" && roomId && peerInfo ? (
          <AppText style={styles.centerText}>{t("call.matched")}</AppText>
        ) : phase === "queued" ? (
          <AppText style={styles.centerText}>{String(t("call.connecting") || "")}</AppText>
        ) : phase === "matched" ? (
          <AppText style={styles.centerText}>{t("call.connecting")}</AppText>
        ) : null}
      </View>
    </View>
  );
}
