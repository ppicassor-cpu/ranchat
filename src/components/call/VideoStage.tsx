import React from "react";
import { Animated, Image, View } from "react-native";
import { RTCView } from "react-native-webrtc";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { VideoView } from "expo-video";
import AppText from "../AppText";

type ChatMessage = {
  id: string;
  mine: boolean;
  text: string;
  displayName?: string;
  avatarUrl?: string | null;
};

type VideoStageProps = {
  styles: any;
  phase: string;
  mediaSurfaceEpoch?: number;
  stageH: number;
  onStageLayout: (height: number) => void;
  swipePanHandlers?: any;
  showLocalOverlay: boolean;
  localBottom: number;
  localCallingHeight: string | number;
  beautyOpen: boolean;
  localStreamURL: string | null;
  myCamOn: boolean;
  mySoundOn: boolean;
  localMicLevelAnim: Animated.Value;
  peerSoundOn: boolean;
  remoteMicLevelAnim: Animated.Value;
  myDisplayName?: string;
  myAvatarUrl?: string | null;
  localVideoZOrder: number;
  localAreaTop: number;
  chatFeedVisible: boolean;
  chatMessages: ChatMessage[];
  chatFeedOpacity: Animated.Value;
  chatFeedHideProgress: Animated.Value;
  remoteBottom: string | number;
  remoteStreamURL: string | null;
  remoteCamOn: boolean;
  peerDisplayName?: string;
  peerAvatarUrl?: string | null;
  remoteVideoZOrder: number;
  peerInfoText: string;
  showAiBadge?: boolean;
  signalUnstable: boolean;
  insetsTop: number;
  showSwipeGuide: boolean;
  swipeGuideFrame: number;
  swipeDragTranslateX?: Animated.Value;
  t: (key: string, params?: any) => string;
  overlayLocalHeightCalling: string | number;
  aiCallActive?: boolean;
  aiRemoteVideoPlayer?: any | null;
  swipeGuideAvoidTopRight?: boolean;
};

export default function VideoStage({
  styles,
  phase,
  mediaSurfaceEpoch = 0,
  stageH,
  onStageLayout,
  swipePanHandlers,
  showLocalOverlay,
  localBottom,
  localCallingHeight,
  beautyOpen,
  localStreamURL,
  myCamOn,
  mySoundOn,
  localMicLevelAnim,
  peerSoundOn,
  remoteMicLevelAnim,
  myDisplayName = "",
  myAvatarUrl = null,
  localVideoZOrder,
  localAreaTop,
  chatFeedVisible,
  chatMessages,
  chatFeedOpacity,
  chatFeedHideProgress,
  remoteBottom,
  remoteStreamURL,
  remoteCamOn,
  peerDisplayName = "",
  peerAvatarUrl = null,
  remoteVideoZOrder,
  peerInfoText,
  showAiBadge = false,
  signalUnstable,
  insetsTop,
  showSwipeGuide,
  swipeGuideFrame,
  swipeDragTranslateX,
  t,
  overlayLocalHeightCalling,
  aiCallActive = false,
  aiRemoteVideoPlayer = null,
  swipeGuideAvoidTopRight = false,
}: VideoStageProps) {
  const canShowAiRemoteVideo = (phase === "matched" || phase === "calling") && aiCallActive;
  const buildMicRingStyle = (soundOn: boolean, micLevelAnim: Animated.Value, variant: "primary" | "secondary") => ({
    opacity: soundOn
      ? micLevelAnim.interpolate({
          inputRange: variant === "primary" ? [0, 0.08, 0.4, 1] : [0, 0.12, 0.45, 1],
          outputRange: variant === "primary" ? [0, 0.08, 0.24, 0.48] : [0, 0.04, 0.14, 0.28],
          extrapolate: "clamp",
        })
      : 0,
    transform: [
      {
        scale: soundOn
          ? micLevelAnim.interpolate({
              inputRange: [0, 1],
              outputRange: variant === "primary" ? [1.02, 1.36] : [1.04, 1.58],
              extrapolate: "clamp",
            })
          : variant === "primary"
          ? 1.02
          : 1.04,
      },
    ],
  });
  const renderAvatar = (
    avatarUrl: string | null | undefined,
    containerStyle: any,
    imageStyle: any,
    fallbackStyle: any,
    iconSize: number,
    overlayStyle?: any,
    fallbackIconName: any = "person-outline",
    overlayNode?: React.ReactNode
  ) => (
    <View style={containerStyle}>
      {avatarUrl ? (
        <Image source={{ uri: avatarUrl }} style={imageStyle} />
      ) : (
        <View style={fallbackStyle}>
          <Ionicons name={fallbackIconName} size={iconSize} color="rgba(255,255,255,0.92)" />
        </View>
      )}
      {overlayStyle ? <View pointerEvents="none" style={overlayStyle} /> : null}
      {overlayNode}
    </View>
  );
  const renderCamOffAvatarStage = (
    avatarUrl: string | null | undefined,
    soundOn: boolean,
    micLevelAnim: Animated.Value,
    avatarDockStyle?: any
  ) => (
    <View style={styles.camOffOverlayFull}>
      <View style={[styles.camOffAvatarDock, avatarDockStyle]}>
        <View style={styles.camOffAvatarWaveWrap}>
          <Animated.View
            pointerEvents="none"
            style={[styles.localMicWaveRingPrimary, buildMicRingStyle(soundOn, micLevelAnim, "primary")]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.localMicWaveRingSecondary, buildMicRingStyle(soundOn, micLevelAnim, "secondary")]}
          />
          {renderAvatar(
            avatarUrl,
            [styles.stageAvatarWrapLarge, !soundOn ? styles.stageAvatarWrapMuted : null],
            styles.stageAvatarImage,
            styles.stageAvatarFallbackLarge,
            34,
            styles.stageAvatarDimOverlay,
            !soundOn ? "mic-off" : "person-outline",
            soundOn || !avatarUrl ? null : (
              <View pointerEvents="none" style={styles.stageAvatarMuteBadge}>
                <Ionicons name="mic-off" size={16} color="#FFF7FB" />
              </View>
            ),
          )}
        </View>
      </View>
    </View>
  );
  const swipeGuideAvoidStyle =
    swipeGuideAvoidTopRight && phase === "calling"
      ? {
          top: Math.max(Math.round(stageH * 0.5 + 45), Math.round(insetsTop + 350)),
          transform: [{ translateY: 0 }],
        }
      : null;
  const remoteCamOffAvatarDockStyle =
    stageH > 0
      ? {
          marginTop: Math.max(90, Math.round(stageH * 0.14)),
        }
      : {
          marginTop: 90,
        };
  return (
    <View style={styles.stage} onLayout={(e) => onStageLayout(Math.round(e.nativeEvent.layout.height))}>
      <Animated.View
        style={[styles.overlayStage, swipeDragTranslateX ? { transform: [{ translateX: swipeDragTranslateX }] } : null]}
        {...(phase === "calling" ? swipePanHandlers || {} : {})}
      >
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
                    <View key={`local-surface-${mediaSurfaceEpoch}`} style={styles.localViewport} collapsable={false}>
                      <View style={styles.localVideoMover} collapsable={false}>
                        <RTCView
                          key={`local-rtc-${mediaSurfaceEpoch}-${localStreamURL || "none"}`}
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
                  renderCamOffAvatarStage(myAvatarUrl, mySoundOn, localMicLevelAnim)
                ) : null}
              </View>
            </View>

            {phase === "calling" && chatFeedVisible && chatMessages.length > 0 ? (
              <Animated.View
                pointerEvents="none"
                style={[
                  styles.chatFeedUnderShadow,
                  { top: Math.max(0, localAreaTop - 10), opacity: chatFeedOpacity },
                ]}
              >
                {chatMessages.map((item, idx) => {
                  const distanceFromNewest = chatMessages.length - 1 - idx;
                  const isNewest = distanceFromNewest === 0;
                  const isGiftSystemMessage = /^\[GIFT\]\s*/.test(String(item.text || ""));
                  const messageText = isGiftSystemMessage ? String(item.text || "").replace(/^\[GIFT\]\s*/, "") : item.text;
                  const baseOpacity = distanceFromNewest === 0 ? 1 : Math.max(0.26, 0.82 - distanceFromNewest * 0.2);
                  const messageCount = Math.max(1, chatMessages.length);
                  const slot = 1 / messageCount;
                  // Hide animation starts from oldest row and moves downward in order.
                  const hideStart = Math.min(0.99, idx * slot);
                  const hideEnd = Math.min(1, hideStart + slot * 0.9);
                  const rowOpacity = chatFeedHideProgress.interpolate({
                    inputRange: [0, hideStart, hideEnd, 1],
                    outputRange: [baseOpacity, baseOpacity, 0, 0],
                    extrapolate: "clamp",
                  });
                  return (
                    <Animated.View
                      key={item.id}
                      style={[
                        styles.chatFeedRow,
                        item.mine ? styles.chatFeedRowMine : styles.chatFeedRowPeer,
                        { opacity: rowOpacity },
                      ]}
                    >
                      <View style={[styles.chatFeedCluster, item.mine ? styles.chatFeedClusterMine : styles.chatFeedClusterPeer]}>
                        <View
                          style={[
                            styles.chatFeedMessageRow,
                            item.mine ? styles.chatFeedMessageRowMine : styles.chatFeedMessageRowPeer,
                          ]}
                        >
                          <View
                            style={[
                              styles.chatFeedBubble,
                              item.mine ? styles.chatFeedBubbleMine : styles.chatFeedBubblePeer,
                              isGiftSystemMessage
                                ? item.mine
                                  ? styles.chatFeedBubbleGiftMine
                                  : styles.chatFeedBubbleGiftPeer
                                : null,
                            ]}
                          >
                            <AppText
                              style={[
                                styles.chatFeedText,
                                isNewest ? styles.chatFeedTextNewest : null,
                                isGiftSystemMessage ? styles.chatFeedTextGift : null,
                                isGiftSystemMessage && isNewest ? styles.chatFeedTextGiftNewest : null,
                              ]}
                            >
                              {messageText}
                            </AppText>
                          </View>
                        </View>
                      </View>
                    </Animated.View>
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
              {canShowAiRemoteVideo && aiRemoteVideoPlayer && remoteCamOn ? (
                <VideoView
                  key={`remote-ai-${mediaSurfaceEpoch}`}
                  player={aiRemoteVideoPlayer}
                  style={styles.remoteVideo}
                  contentFit="cover"
                  nativeControls={false}
                />
              ) : remoteStreamURL && remoteCamOn ? (
                <RTCView
                  key={`remote-rtc-${mediaSurfaceEpoch}-${remoteStreamURL || "none"}`}
                  streamURL={remoteStreamURL}
                  style={styles.remoteVideo}
                  objectFit="cover"
                  zOrder={remoteVideoZOrder}
                  mirror={true}
                />
              ) : (
                <View style={styles.placeholder}>
                  {phase === "calling" && !remoteCamOn
                    ? renderCamOffAvatarStage(peerAvatarUrl, peerSoundOn, remoteMicLevelAnim, remoteCamOffAvatarDockStyle)
                    : null}
                </View>
              )}

              {phase === "calling" && (peerInfoText || signalUnstable) ? (
                <View pointerEvents="none" style={[styles.remoteInfoDock, { top: insetsTop + 2 }]}>
                  {showAiBadge ? (
                    <View style={styles.remoteInfoMetaLine}>
                      <View style={styles.aiPeerBadge}>
                        <AppText style={styles.aiPeerBadgeText}>AI</AppText>
                      </View>
                      {peerInfoText ? (
                        <AppText style={styles.remoteInfoText} numberOfLines={2}>
                          {peerInfoText}
                        </AppText>
                      ) : null}
                    </View>
                  ) : peerInfoText ? (
                    <AppText style={styles.remoteInfoText} numberOfLines={2}>
                      {peerInfoText}
                    </AppText>
                  ) : null}
                  {signalUnstable ? <AppText style={styles.remoteInfoSubText}>{t("call.network_unstable")}</AppText> : null}
                </View>
              ) : null}
              {phase === "calling" && (peerDisplayName || peerAvatarUrl) ? (
                <View pointerEvents="none" style={[styles.remoteProfileDock, { top: insetsTop + 10 }]}>
                  {renderAvatar(peerAvatarUrl, styles.remoteInfoAvatarWrap, styles.remoteInfoAvatarImage, styles.remoteInfoAvatarFallback, 20)}
                  {peerDisplayName ? (
                    <AppText style={styles.remoteInfoNicknameText} numberOfLines={1}>
                      {peerDisplayName}
                    </AppText>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}
      </Animated.View>

      {showSwipeGuide && phase === "calling" ? (
        <View pointerEvents="none" style={[styles.swipeGuideDock, swipeGuideAvoidStyle]}>
          <View style={styles.swipeGuideTextWrap}>
            <AppText ignoreUiScale style={styles.swipeGuideTextBottom}>
              {t("call.swipe_guide_line1")}
            </AppText>
            <AppText ignoreUiScale style={styles.swipeGuideTextTop}>
              {t("call.swipe_guide_line2")}
            </AppText>
          </View>
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
