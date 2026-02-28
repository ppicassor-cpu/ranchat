import React from "react";
import { Animated, Image, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AppText from "../AppText";

type ChatMessage = { id: string; mine: boolean; text: string };

type VideoStageProps = {
  styles: any;
  phase: string;
  stageH: number;
  onStageLayout: (height: number) => void;
  swipePanHandlers?: any;
  showLocalOverlay: boolean;
  localBottom: number;
  localCallingHeight: string | number;
  beautyOpen: boolean;
  localStreamURL: string | null;
  myCamOn: boolean;
  localVideoZOrder: number;
  localAreaTop: number;
  chatFeedVisible: boolean;
  chatMessages: ChatMessage[];
  chatFeedOpacity: Animated.Value;
  chatFeedHideProgress: Animated.Value;
  remoteBottom: string | number;
  remoteStreamURL: string | null;
  remoteCamOn: boolean;
  remoteVideoZOrder: number;
  peerInfoText: string;
  signalUnstable: boolean;
  insetsTop: number;
  showSwipeGuide: boolean;
  swipeGuideFrame: number;
  t: (key: string, params?: any) => string;
  overlayLocalHeightCalling: string | number;
};

export default function VideoStage({
  styles,
  phase,
  stageH,
  onStageLayout,
  swipePanHandlers,
  showLocalOverlay,
  localBottom,
  localCallingHeight,
  beautyOpen,
  localStreamURL,
  myCamOn,
  localVideoZOrder,
  localAreaTop,
  chatFeedVisible,
  chatMessages,
  chatFeedOpacity,
  chatFeedHideProgress,
  remoteBottom,
  remoteStreamURL,
  remoteCamOn,
  remoteVideoZOrder,
  peerInfoText,
  signalUnstable,
  insetsTop,
  showSwipeGuide,
  swipeGuideFrame,
  t,
  overlayLocalHeightCalling,
}: VideoStageProps) {
  return (
    <View style={styles.stage} onLayout={(e) => onStageLayout(Math.round(e.nativeEvent.layout.height))}>
      <View style={styles.overlayStage} {...(phase === "calling" ? swipePanHandlers || {} : {})}>
        {showLocalOverlay ? (
          <View style={styles.localLayer} pointerEvents="none">
            <View
              style={[
                styles.localAreaShadow,
                stageH > 0 ? { bottom: localBottom, height: localCallingHeight } : { bottom: localBottom },
                stageH > 0 ? null : styles.localAreaCalling,
                beautyOpen ? { top: 0, bottom: 0, height: "100%" } : null,
              ]}
            >
              <View style={styles.localArea}>
                {localStreamURL && (phase === "calling" || beautyOpen) ? (
                  myCamOn ? (
                    <View style={styles.localViewport} collapsable={false}>
                      <View style={styles.localVideoMover} collapsable={false}>
                        <RTCView
                          streamURL={localStreamURL}
                          style={styles.localVideoFull}
                          objectFit="cover"
                          zOrder={localVideoZOrder}
                          mirror={true}
                        />
                      </View>
                    </View>
                  ) : (
                    <View style={styles.localCamOffBgFull} />
                  )
                ) : (
                  <View style={styles.localEmptyFull} />
                )}

                {!myCamOn ? (
                  <View style={styles.camOffOverlayFull}>
                    <Ionicons name="videocam-off" size={54} color="rgba(255, 255, 255, 0.92)" />
                  </View>
                ) : null}
              </View>
            </View>

            {phase === "calling" && chatFeedVisible && chatMessages.length > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.chatFeedUnderShadow,
                  { top: localAreaTop + 8, opacity: chatFeedOpacity },
                ]}
              >
                {chatMessages.map((item, idx) => {
                  const distanceFromNewest = chatMessages.length - 1 - idx;
                  const isNewest = distanceFromNewest === 0;
                  const baseOpacity = distanceFromNewest === 0 ? 1 : Math.max(0.26, 0.82 - distanceFromNewest * 0.2);
                  const hideStart = Math.min(0.62, distanceFromNewest * 0.16);
                  const hideEnd = Math.min(0.96, hideStart + 0.34);
                  const hideOpacity = chatFeedHideProgress.interpolate({
                    inputRange: [0, hideStart, hideEnd, 1],
                    outputRange: [1, 1, 0, 0],
                    extrapolate: "clamp",
                  });
                  const rowOpacity = Animated.multiply(chatFeedOpacity, Animated.multiply(hideOpacity as any, baseOpacity as any));
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.chatFeedRow,
                        item.mine ? styles.chatFeedRowMine : styles.chatFeedRowPeer,
                        { opacity: rowOpacity },
                      ]}
                    >
                      <View style={[styles.chatFeedBubble, item.mine ? styles.chatFeedBubbleMine : styles.chatFeedBubblePeer]}>
                        <AppText style={[styles.chatFeedText, isNewest ? styles.chatFeedTextNewest : null]}>{item.text}</AppText>
                      </View>
                    </View>
                  );
                })}
              </Animated.View>
            ) : null}

            {!beautyOpen ? (
              <LinearGradient
                pointerEvents="none"
                colors={["rgba(0, 0, 0, 0)", "rgba(0, 0, 0, 0.14)", "rgba(0, 0, 0, 0.28)", "rgba(0, 0, 0, 0.58)", "rgb(0, 0, 0)"]}
                locations={[0, 0.2, 0.45, 0.72, 1]}
                style={[
                  styles.localTopShadowGradient,
                  stageH > 0 ? { bottom: localCallingHeight } : { bottom: overlayLocalHeightCalling },
                ]}
              />
            ) : null}
          </View>
        ) : null}

        {!beautyOpen ? (
          <View style={styles.remoteLayer} pointerEvents="none">
            <View style={[styles.remoteArea, showLocalOverlay ? (stageH > 0 ? { bottom: remoteBottom } : { bottom: overlayLocalHeightCalling }) : { bottom: 0 }]}>
              {remoteStreamURL && remoteCamOn ? (
                <RTCView
                  streamURL={remoteStreamURL}
                  style={styles.remoteVideo}
                  objectFit="cover"
                  zOrder={remoteVideoZOrder}
                  mirror={true}
                />
              ) : (
                <View style={styles.placeholder}>
                  {phase === "calling" && !remoteCamOn ? (
                    <Ionicons name="videocam-off" size={54} color="rgba(255, 255, 255, 0.92)" />
                  ) : null}
                </View>
              )}

              {phase === "calling" && (peerInfoText || signalUnstable) ? (
                <View pointerEvents="none" style={[styles.remoteInfoDock, { top: insetsTop + 10 }]}>
                  {peerInfoText ? <AppText style={styles.remoteInfoText}>{peerInfoText}</AppText> : null}
                  {signalUnstable ? <AppText style={styles.remoteInfoSubText}>{t("call.network_unstable")}</AppText> : null}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </View>

      {showSwipeGuide && phase === "calling" ? (
        <View pointerEvents="none" style={styles.swipeGuideDock}>
          <Image
            source={swipeGuideFrame === 0 ? require("../../../assets/swipe.png") : require("../../../assets/swipe2.png")}
            style={styles.swipeGuideImage}
            resizeMode="contain"
          />
        </View>
      ) : null}
    </View>
  );
}
