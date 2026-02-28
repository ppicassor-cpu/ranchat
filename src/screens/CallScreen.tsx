// FILE: C:\ranchat\src\screens\CallScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Animated, Easing, View, BackHandler, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useIsFocused } from "@react-navigation/native";
import { APP_CONFIG } from "../config/app";
import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import { useAppStore } from "../store/useAppStore";
import { SignalClient } from "../services/signal/SignalClient";
import { WebRTCSession } from "../services/webrtc/WebRTCSession";
import type { MainStackParamList } from "../navigation/MainStack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "../i18n/LanguageProvider";
import CallBeautySheet from "./CallBeautySheet";
import VideoStage from "../components/call/VideoStage";
import CallControls from "../components/call/CallControls";
import ChatComposer from "../components/call/ChatComposer";
import MatchingOverlay from "../components/call/MatchingOverlay";
import QueueNativeAd256x144 from "../components/call/QueueNativeAd";
import CallOverlays from "../components/call/CallOverlays";
import { MATCH_TIMEOUT_MS, INTERSTITIAL_COOLDOWN_MS, MATCHING_ACTIONS_DELAY_MS } from "../constants/callConfig";
import { POPTALK_CALL_COST_PER_SECOND, POPTALK_CHAT_COST_PER_MESSAGE, POPTALK_LOW_WARNING_THRESHOLD, POPTALK_MATCH_BLOCK_THRESHOLD, POPTALK_REWARDED_AMOUNT, POPTALK_REFRESH_INTERVAL_MS } from "../constants/popTalkConfig";
import useAdManager from "../hooks/useAdManager";
import useBeautyEffects from "../hooks/useBeautyEffects";
import useChatSystem from "../hooks/useChatSystem";
import useMatchingQueue from "../hooks/useMatchingQueue";
import useWebRTC from "../hooks/useWebRTC";
import useSignaling from "../hooks/useSignaling";
import useCallRuntime from "../hooks/useCallRuntime";
import useCallActions from "../hooks/useCallActions";
import usePeerInfo from "../hooks/usePeerInfo";
import useLocalPreview from "../hooks/useLocalPreview";
import usePopTalk from "../hooks/usePopTalk";
import { W, REMOTE_VIDEO_Z_ORDER, LOCAL_VIDEO_Z_ORDER, OVERLAY_LOCAL_HEIGHT_CALLING, styles } from "./CallScreen.styles";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import AppText from "../components/AppText";

type Props = NativeStackScreenProps<MainStackParamList, "Call">;

type Phase = "connecting" | "queued" | "matched" | "calling" | "ended";

export default function CallScreen({ navigation }: Props) {

  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const isScreenFocused = useIsFocused();

  const prefs = useAppStore((s) => s.prefs);
  const isPremium = useAppStore((s) => s.sub.isPremium);
  const popTalk = useAppStore((s: any) => s.popTalk);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);
  const { refreshPopTalk, consumePopTalk, watchRewardedAdAndReward } = usePopTalk();

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);

  const [phase, setPhase] = useState<Phase>("connecting");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isCaller, setIsCaller] = useState(false);

  const [localStreamURL, setLocalStreamURL] = useState<string | null>(null);
  const [remoteStreamURL, setRemoteStreamURL] = useState<string | null>(null);

  const [remoteCamOn, setRemoteCamOn] = useState(true);
  const [remoteMuted, setRemoteMuted] = useState(false);

  const [myCamOn, setMyCamOn] = useState(true);
  const [mySoundOn, setMySoundOn] = useState(true);

  const [noMatchModal, setNoMatchModal] = useState(false);
  const [fastMatchHint, setFastMatchHint] = useState(false);
  const [matchingActionsVisible, setMatchingActionsVisible] = useState(false);

  const [reMatchText, setReMatchText] = useState<string>("");

  const [prefsModal, setPrefsModal] = useState(false);
  const [popTalkLowModal, setPopTalkLowModal] = useState(false);
  const [popTalkMatchBlockModal, setPopTalkMatchBlockModal] = useState(false);
  const [popTalkEmptyModal, setPopTalkEmptyModal] = useState(false);
  const [popTalkAdFailModal, setPopTalkAdFailModal] = useState(false);
  const [popTalkAdFailCount, setPopTalkAdFailCount] = useState(0);

  const wsRef = useRef<SignalClient | null>(null);
  const rtcRef = useRef<WebRTCSession | null>(null);
  const localStreamRef = useRef<any>(null);
  const previewStreamRef = useRef<any>(null);
  const previewOpeningRef = useRef(false);
  const remoteStreamRef = useRef<any>(null);
  const clearLocalPreviewStreamRef = useRef<() => void>(() => {});
  const callDebitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callDebitInFlightRef = useRef(false);
  const popTalkLowPrevRef = useRef<number>(Number(popTalk?.balance ?? 0));
  const popTalkEmptyHandledRef = useRef(false);

  const pendingSignalRef = useRef<{ type: "offer" | "answer" | "ice"; sdp?: any; candidate?: any }[]>([]);
  const endCallAndRequeueRef = useRef<(why: "remote_left" | "disconnect" | "error" | "find_other") => void>(() => {});

  const beginCallGuardRef = useRef(false);
  const callStartTokenRef = useRef(0);

  const enqueuedRef = useRef(false);
  const queueRunningRef = useRef(false);

  const requeueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canStart = useRef(false);

  const [peerInfo, setPeerInfo] = useState<any>(null);
  const phaseRef = useRef<Phase>("connecting");
  const roomIdRef = useRef<string | null>(null);
  const myCamOnRef = useRef<boolean>(true);
  const mySoundOnRef = useRef<boolean>(true);
  const remoteMutedRef = useRef<boolean>(false);
  const isScreenFocusedRef = useRef<boolean>(true);

  const queueTokenRef = useRef(0);
  const matchedSignalTokenRef = useRef(0);
  const myPeerInfoNonceRef = useRef("");
  const beginCallReqRef = useRef<{ ws: SignalClient; rid: string; caller: boolean; qTok: number } | null>(null);
  const peerReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webrtcConnectedRef = useRef(false);
  const webrtcConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endCallOnceRef = useRef(0);
  const suppressEndRelayRef = useRef(false);

  const manualCloseRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);

  const webrtcDownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const webrtcDownTokenRef = useRef(0);
  const matchRevealAnimRef = useRef(new Animated.Value(0));
  const matchRevealRunningRef = useRef(false);

  const [signalUnstable, setSignalUnstable] = useState(false);
  const [authBooting, setAuthBooting] = useState(true);
  const [matchRevealActive, setMatchRevealActive] = useState(false);
  const authBootInFlightRef = useRef(false);

  const {
    adsReady,
    adsReadyRef,
    adAllowedRef,
    interstitialTokenRef,
    interstitialCleanupRef,
    interstitialTimerRef,
    lastInterstitialAtRef,
    waitAdsReady,
    showInterstitialIfAllowed,
    resetAdFlow,
  } = useAdManager({
    isPremium,
    interstitialCooldownMs: INTERSTITIAL_COOLDOWN_MS,
  });

  const {
    beautyOpen,
    setBeautyOpen,
    beautyConfig,
    setBeautyConfig,
    beautyOpenRef,
    beautyOpeningIntentRef,
    openBeauty,
    closeBeauty,
  } = useBeautyEffects({
    localStreamRef,
    localStreamURL,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    clearLocalPreviewStreamRef,
  });

  const onBeforeSendChat = useCallback(
    async (_text: string) => {
      const out = await consumePopTalk(
        POPTALK_CHAT_COST_PER_MESSAGE,
        "chat_message",
        `${Date.now()}_${Math.random().toString(16).slice(2)}`
      );
      if (out.ok) return true;

      const bal = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
      if (out.insufficient || bal <= 0) {
        showGlobalModal(t("poptalk.title"), t("poptalk.chat_block_desc"));
        setPopTalkEmptyModal(true);
        return false;
      }

      showGlobalModal(t("poptalk.title"), t("poptalk.sync_failed"));
      return false;
    },
    [consumePopTalk, showGlobalModal, t]
  );

  const {
    chatInput,
    setChatInput,
    chatMessages,
    setChatMessages,
    chatReady,
    setChatReady,
    chatFeedVisible,
    setChatFeedVisible,
    chatComposerOpen,
    setChatComposerOpen,
    showSwipeGuide,
    setShowSwipeGuide,
    swipeGuideFrame,
    setSwipeGuideFrame,
    chatInputRef,
    chatComposerOpenRef,
    chatOpenPendingRef,
    chatKeyboardVisibleRef,
    chatIgnoreHideUntilRef,
    chatOpenBlockUntilRef,
    chatSeqRef,
    chatFeedOpacityRef,
    chatFeedHideProgressRef,
    lastSwipeRefreshAtRef,
    appendChatMessage,
    sendChat,
    openChatComposer,
    onPressChatControl,
    onChatComposerBackdropPress,
    onChatInputFocus,
    clearChatHideTimer,
    clearSwipeGuideTimer,
    clearSwipeGuideFlipTimer,
    clearChatFocusTimers,
    resetChatFeedAnimations,
    resetChatAndSwipeState,
  } = useChatSystem({
    phase,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    localStreamURL,
    myCamOn,
    rtcRef: rtcRef as React.MutableRefObject<any>,
    beforeSendChat: onBeforeSendChat,
  });

  const {
    noMatchTimerRef,
    matchingActionsTimerRef,
    matchingActionsDeadlineRef,
    premiumNoMatchAutoCloseRef,
    noMatchShownThisCycleRef,
    clearMatchingActionsTimer,
    startMatchingActionsTimer,
    startNoMatchTimer,
    clearNoMatchTimer,
    dismissNoMatch,
  } = useMatchingQueue({
    isScreenFocused,
    isScreenFocusedRef,
    phase,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    beautyOpen,
    beautyOpenRef,
    isPremium,
    wsRef: wsRef as React.MutableRefObject<any>,
    queueRunningRef,
    enqueuedRef,
    manualCloseRef,
    setMatchingActionsVisible,
    setNoMatchModal,
    setFastMatchHint,
    matchTimeoutMs: MATCH_TIMEOUT_MS,
    matchingActionsDelayMs: MATCHING_ACTIONS_DELAY_MS,
  });

  const [stageH, setStageH] = useState(0);

  const localBottom = 0;
  const localCallingHeight = OVERLAY_LOCAL_HEIGHT_CALLING;
  const localCallingHeightRatio = useMemo(() => {
    const raw = String(OVERLAY_LOCAL_HEIGHT_CALLING || "").trim();
    if (raw.endsWith("%")) {
      const pct = Number(raw.slice(0, -1));
      if (Number.isFinite(pct)) return pct / 100;
    }
    return 0.45;
  }, []);
  const localAreaTop = stageH > 0 ? Math.max(0, stageH - localBottom - Math.round(stageH * localCallingHeightRatio)) : 0;
  const remoteBottom = OVERLAY_LOCAL_HEIGHT_CALLING;
  const showLocalOverlay = beautyOpen || phase === "calling";
  const controlsBottom = Math.max(insets.bottom, 8) + 14;
  const matchRevealHeartScale = useMemo(
    () =>
      matchRevealAnimRef.current.interpolate({
        inputRange: [0, 0.28, 1],
        outputRange: [1, 1.28, 30],
      }),
    []
  );
  const matchRevealBackdropOpacity = useMemo(
    () =>
      matchRevealAnimRef.current.interpolate({
        inputRange: [0, 0.75, 1],
        outputRange: [0.92, 0.76, 0],
      }),
    []
  );
  const matchRevealHeartOpacity = useMemo(
    () =>
      matchRevealAnimRef.current.interpolate({
        inputRange: [0, 0.9, 1],
        outputRange: [1, 1, 0.72],
      }),
    []
  );

  const { peerInfoText, myCountryRaw, myLangRaw, myGenderRaw, myFlag } = usePeerInfo({ peerInfo, prefs, t });

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
      onPressBack();
      return true;
    });

    return () => backHandler.remove();
  }, []);

  useEffect(() => {
    canStart.current = Boolean(String(prefs.country || "").length > 0 && String(prefs.gender || "").length > 0);
  }, [prefs.country, prefs.gender]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    roomIdRef.current = roomId;
  }, [roomId]);

  useEffect(() => {
    myCamOnRef.current = myCamOn;
  }, [myCamOn]);

  useEffect(() => {
    mySoundOnRef.current = mySoundOn;
  }, [mySoundOn]);

  useEffect(() => {
    remoteMutedRef.current = remoteMuted;
  }, [remoteMuted]);

  useEffect(() => {
    refreshPopTalk().catch(() => undefined);
    const tm = setInterval(() => {
      refreshPopTalk().catch(() => undefined);
    }, POPTALK_REFRESH_INTERVAL_MS);
    return () => clearInterval(tm);
  }, [refreshPopTalk]);

  useEffect(() => {
    const bal = Number(popTalk?.balance ?? 0);
    const prev = Number(popTalkLowPrevRef.current ?? bal);
    if (phase === "calling" && prev > POPTALK_LOW_WARNING_THRESHOLD && bal <= POPTALK_LOW_WARNING_THRESHOLD && bal > 0) {
      setPopTalkLowModal(true);
    }
    popTalkLowPrevRef.current = bal;
  }, [phase, popTalk?.balance]);

  useEffect(() => {
    if (!popTalkLowModal && !popTalkMatchBlockModal && !popTalkEmptyModal) return;
    setPopTalkAdFailCount(0);
    setPopTalkAdFailModal(false);
  }, [popTalkEmptyModal, popTalkLowModal, popTalkMatchBlockModal]);

  useEffect(() => {
    if (phase === "calling") return;
    popTalkEmptyHandledRef.current = false;
    if (callDebitTimerRef.current) {
      clearInterval(callDebitTimerRef.current);
      callDebitTimerRef.current = null;
    }
    callDebitInFlightRef.current = false;
  }, [phase]);

  const { clearLocalPreviewStream, hasLiveVideoTrack, ensureLocalPreviewStream } = useLocalPreview({
    previewStreamRef,
    localStreamRef,
    previewOpeningRef,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    setLocalStreamURL,
    showGlobalModal,
    t,
  });

  useEffect(() => {
    clearLocalPreviewStreamRef.current = clearLocalPreviewStream;
  }, [clearLocalPreviewStream]);

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    reconnectAttemptRef.current = 0;
  };

  const clearWebrtcDownTimer = () => {
    if (webrtcDownTimerRef.current) clearTimeout(webrtcDownTimerRef.current);
    webrtcDownTimerRef.current = null;
    webrtcDownTokenRef.current += 1;
  };

  const runMatchRevealTransition = useCallback(
    (onDone: () => void) => {
      if (matchRevealRunningRef.current) return false;
      matchRevealRunningRef.current = true;
      setMatchRevealActive(true);
      matchRevealAnimRef.current.stopAnimation();
      matchRevealAnimRef.current.setValue(0);

      Animated.sequence([
        Animated.timing(matchRevealAnimRef.current, {
          toValue: 0.12,
          duration: 280,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(matchRevealAnimRef.current, {
          toValue: 1,
          duration: 1050,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        matchRevealRunningRef.current = false;
        setMatchRevealActive(false);
        matchRevealAnimRef.current.setValue(0);
        if (finished) onDone();
      });
      return true;
    },
    []
  );

  const { stopAll, beginCall } = useCallRuntime({
    endCallAndRequeueRef,
    resetAdFlow,
    requeueTimerRef,
    clearNoMatchTimer,
    clearMatchingActionsTimer,
    setMatchingActionsVisible,
    matchingActionsTimerRef,
    beautyOpenRef,
    beautyOpeningIntentRef,
    clearLocalPreviewStream,
    setBeautyOpen,
    clearReconnectTimer,
    clearWebrtcDownTimer,
    peerReadyTimerRef,
    beginCallReqRef,
    webrtcConnectTimerRef,
    webrtcConnectedRef,
    setSignalUnstable,
    noMatchShownThisCycleRef,
    setFastMatchHint,
    queueRunningRef,
    enqueuedRef,
    roomIdRef,
    wsRef,
    suppressEndRelayRef,
    rtcRef,
    remoteStreamRef,
    previewStreamRef,
    hasLiveVideoTrack,
    localStreamRef,
    setLocalStreamURL,
    setRemoteStreamURL,
    resetChatAndSwipeState,
    setRoomId,
    setPeerInfo,
    setRemoteCamOn,
    matchRevealRunningRef,
    setMatchRevealActive,
    matchRevealAnimRef,
    setPhase,
    manualCloseRef,
    callStartTokenRef,
    beginCallGuardRef,
    queueTokenRef,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    remoteMutedRef,
    setReMatchText,
    runMatchRevealTransition,
    pendingSignalRef,
    myCamOnRef,
    mySoundOnRef,
    matchedSignalTokenRef,
    webrtcDownTokenRef,
    webrtcDownTimerRef,
    setChatReady,
    appendChatMessage,
    t,
  });

  useEffect(() => {
    const bal = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
    if (phase !== "calling") return;
    if (bal > 0) return;
    if (popTalkEmptyHandledRef.current) return;
    popTalkEmptyHandledRef.current = true;
    stopAll(false);
    setPopTalkEmptyModal(true);
  }, [phase, popTalk?.balance, stopAll]);

  const endCallAndRequeue = (why: "remote_left" | "disconnect" | "error" | "find_other") => {
    const tok = queueTokenRef.current;
    if (endCallOnceRef.current === tok) return;
    endCallOnceRef.current = tok;

    suppressEndRelayRef.current = why === "remote_left";

    if (why === "remote_left") {
      setReMatchText(String(t("call.peer_left") || ""));
    } else if (why === "find_other" || why === "disconnect") {
      setReMatchText(String(t("call.connecting") || ""));
    } else {
      setReMatchText("");
    }

    const resetMatchingActions = why !== "disconnect";
    stopAll(false, resetMatchingActions);
    setNoMatchModal(false);

    if (why === "remote_left") {
      setPhase("ended");
      if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = setTimeout(() => {
        setPhase("connecting");
        startQueue(true);
        if (!beautyOpenRef.current) {
          startMatchingActionsTimer(true);
        }
      }, 100);
    } else {
      setPhase("connecting");
      if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = setTimeout(() => {
        startQueue(why !== "disconnect");
      }, 100);
    }
  };
  endCallAndRequeueRef.current = endCallAndRequeue;

  const ensurePopTalkForMatching = useCallback(async () => {
    let snap: any = null;
    try {
      snap = await refreshPopTalk();
    } catch {}
    const bal = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
    if (!snap && bal <= 0) {
      showGlobalModal(t("poptalk.title"), t("poptalk.sync_failed"));
    }
    if (bal <= POPTALK_MATCH_BLOCK_THRESHOLD) {
      setPopTalkMatchBlockModal(true);
      return false;
    }
    return true;
  }, [refreshPopTalk, showGlobalModal, t]);

  const { startQueue } = useSignaling({
    wsRef,
    queueTokenRef,
    queueRunningRef,
    enqueuedRef,
    myPeerInfoNonceRef,
    peerReadyTimerRef,
    beginCallReqRef,
    webrtcConnectTimerRef,
    webrtcConnectedRef,
    suppressEndRelayRef,
    manualCloseRef,
    reconnectAttemptRef,
    authBootInFlightRef,
    noMatchTimerRef,
    noMatchShownThisCycleRef,
    pendingSignalRef,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    beautyOpenRef,
    beautyOpeningIntentRef,
    rtcRef: rtcRef as React.MutableRefObject<any>,
    t,
    navigation,
    myCountryRaw,
    myLangRaw,
    myGenderRaw,
    myFlag,
    setAuthBooting,
    setMatchingActionsVisible,
    setNoMatchModal,
    setPhase,
    setSignalUnstable,
    setPeerInfo,
    setRemoteCamOn,
    setFastMatchHint,
    setReMatchText,
    setRoomId,
    setIsCaller,
    clearReconnectTimer,
    clearWebrtcDownTimer,
    startNoMatchTimer,
    clearNoMatchTimer,
    clearMatchingActionsTimer,
    startMatchingActionsTimer,
    clearLocalPreviewStream,
    beginCall,
    endCallAndRequeue,
    beforeStartQueue: ensurePopTalkForMatching,
  });

  const { toggleCam, toggleSound, toggleRemoteMute } = useWebRTC({
    rtcRef,
    wsRef,
    roomId,
    myCamOn,
    setMyCamOn,
    mySoundOn,
    setMySoundOn,
    remoteMutedRef,
    setRemoteMuted,
    remoteStreamRef,
    beginCallImpl: beginCall,
    endCallAndRequeueImpl: endCallAndRequeue,
  });


  useEffect(() => {
    let alive = true;

    lastInterstitialAtRef.current = 0;

    (async () => {
      try {
        const st: any = useAppStore.getState?.() ?? {};
        const tokenNow = String(st?.auth?.token ?? "").trim();

        if (!tokenNow) {
          setAuthBooting(true);
          await bootstrapDeviceBinding();
        }

        const tokenAfter = String(useAppStore.getState().auth.token ?? "").trim();
        if (!tokenAfter) {
          useAppStore.getState().showGlobalModal(t("auth.title"), "TOKEN_EMPTY");
          navigation.goBack();
          return;
        }

        if (!alive) return;
        setAuthBooting(false);
        startQueue(true);
      } catch (e) {
        if (!alive) return;
        const m = typeof e === "object" && e && "message" in (e as any) ? String((e as any).message) : String(e);
        useAppStore.getState().showGlobalModal(t("auth.title"), m || "BIND_FAILED");
        navigation.goBack();
      }
    })();

    return () => {
      alive = false;
      stopAll(true);
    };
  }, []);

  const {
    onPressBack,
    onExitToHome,
    retry,
    dismissMatchingActions,
    onPressMatchingBeauty,
    onPressMatchingFortune,
    onPressMatchingGame,
    onPressFindOther,
    swipeRefreshPanResponder,
  } = useCallActions({
    stopAll,
    wsRef,
    roomId,
    endCallAndRequeue,
    showInterstitialIfAllowed,
    adAllowedRef,
    setMatchingActionsVisible,
    setNoMatchModal,
    isScreenFocusedRef,
    beautyOpenRef,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    startMatchingActionsTimer,
    clearMatchingActionsTimer,
    setMyCamOn,
    beautyOpeningIntentRef,
    openBeauty,
    ensureLocalPreviewStream,
    setBeautyOpen,
    navigation,
    chatComposerOpen,
    lastSwipeRefreshAtRef,
  });

  const closeAllPopTalkModals = useCallback(() => {
    setPopTalkLowModal(false);
    setPopTalkMatchBlockModal(false);
    setPopTalkEmptyModal(false);
    setPopTalkAdFailModal(false);
  }, []);

  const goShop = useCallback(() => {
    navigation.navigate("Shop");
  }, [navigation]);

  const onPressPopTalkCharge = useCallback(() => {
    closeAllPopTalkModals();
    stopAll(true);
    navigation.navigate("Shop");
  }, [closeAllPopTalkModals, navigation, stopAll]);

  const onPressPopTalkWait = useCallback(() => {
    closeAllPopTalkModals();
    onExitToHome();
  }, [closeAllPopTalkModals, onExitToHome]);

  const onPressWatchPopTalkAd = useCallback(async () => {
    const out = await watchRewardedAdAndReward(POPTALK_REWARDED_AMOUNT, "call_rewarded_ad");
    if (out.ok) {
      setPopTalkAdFailModal(false);
      setPopTalkAdFailCount(0);
      setPopTalkLowModal(false);
      setPopTalkEmptyModal(false);

      setPopTalkMatchBlockModal(false);
      try {
        await refreshPopTalk();
      } catch {}

      const bal = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
      if (bal > POPTALK_MATCH_BLOCK_THRESHOLD && phaseRef.current !== "calling") {
        startQueue(true);
      }
      return;
    }

    setPopTalkAdFailCount((prev) => {
      const next = prev + 1;
      setPopTalkAdFailModal(true);
      return next;
    });
  }, [refreshPopTalk, startQueue, watchRewardedAdAndReward]);

  useEffect(() => {
    if (phase !== "calling") return;

    const tick = async () => {
      if (callDebitInFlightRef.current) return;
      callDebitInFlightRef.current = true;
      try {
        const out = await consumePopTalk(
          POPTALK_CALL_COST_PER_SECOND,
          "call_second",
          `${Date.now()}_${Math.random().toString(16).slice(2)}`
        );

        const bal = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);

        if (!out.ok) {
          if (out.insufficient || bal <= 0) {
            if (popTalkEmptyHandledRef.current) return;
            popTalkEmptyHandledRef.current = true;
            stopAll(false);
            setPopTalkEmptyModal(true);
            return;
          }

          if (popTalkEmptyHandledRef.current) return;
          popTalkEmptyHandledRef.current = true;
          stopAll(false);
          showGlobalModal(t("poptalk.title"), t("poptalk.sync_failed"));
          return;
        }

        if (bal <= 0) {
          if (popTalkEmptyHandledRef.current) return;
          popTalkEmptyHandledRef.current = true;
          stopAll(false);
          setPopTalkEmptyModal(true);
        }
      } finally {
        callDebitInFlightRef.current = false;
      }
    };

    callDebitTimerRef.current = setInterval(() => {
      tick().catch(() => undefined);
    }, 1000);

    return () => {
      if (callDebitTimerRef.current) {
        clearInterval(callDebitTimerRef.current);
        callDebitTimerRef.current = null;
      }
      callDebitInFlightRef.current = false;
    };
  }, [consumePopTalk, phase, showGlobalModal, stopAll, t]);

  return (
    <View style={styles.root}>
      <CallBeautySheet visible={beautyOpen} onClose={closeBeauty} config={beautyConfig} onConfigChange={setBeautyConfig} />


      <VideoStage
        styles={styles}
        phase={phase}
        stageH={stageH}
        onStageLayout={setStageH}
        swipePanHandlers={phase === "calling" ? swipeRefreshPanResponder.panHandlers : undefined}
        showLocalOverlay={showLocalOverlay}
        localBottom={localBottom}
        localCallingHeight={localCallingHeight}
        beautyOpen={beautyOpen}
        localStreamURL={localStreamURL}
        myCamOn={myCamOn}
        localVideoZOrder={LOCAL_VIDEO_Z_ORDER}
        localAreaTop={localAreaTop}
        chatFeedVisible={chatFeedVisible}
        chatMessages={chatMessages}
        chatFeedOpacity={chatFeedOpacityRef.current}
        chatFeedHideProgress={chatFeedHideProgressRef.current}
        remoteBottom={remoteBottom}
        remoteStreamURL={remoteStreamURL}
        remoteCamOn={remoteCamOn}
        remoteVideoZOrder={REMOTE_VIDEO_Z_ORDER}
        peerInfoText={peerInfoText}
        signalUnstable={signalUnstable}
        insetsTop={insets.top}
        showSwipeGuide={showSwipeGuide}
        swipeGuideFrame={swipeGuideFrame}
        t={t}
        overlayLocalHeightCalling={OVERLAY_LOCAL_HEIGHT_CALLING}
      />

      {!isPremium && phase !== "calling" ? (
        <View style={[styles.queueAdDock, { top: insets.top + 55 }]}>
          <QueueNativeAd256x144 styles={styles} width={W} />
        </View>
      ) : null}

      <MatchingOverlay
        styles={styles}
        phase={phase}
        matchRevealActive={matchRevealActive}
        remoteStreamURL={remoteStreamURL}
        matchRevealBackdropOpacity={matchRevealBackdropOpacity}
        matchRevealHeartOpacity={matchRevealHeartOpacity}
        matchRevealHeartScale={matchRevealHeartScale}
        remoteVideoZOrder={REMOTE_VIDEO_Z_ORDER}
        reMatchText={reMatchText}
        authBooting={authBooting}
        fastMatchHint={fastMatchHint}
        roomId={roomId}
        peerInfo={peerInfo}
        t={t}
      />

      {phase === "calling" ? (
        <View pointerEvents="box-none" style={styles.topUiLayer}>
          <Pressable
            onPress={goShop}
            hitSlop={12}
            style={({ pressed }) => [
              styles.shopBtn,
              { top: insets.top + 42, right: 12 },
              pressed ? { opacity: 0.72 } : null,
            ]}
          >
            <Ionicons name="storefront-outline" size={21} color="#fff" />
          </Pressable>
        </View>
      ) : null}

      {phase === "calling" ? (
        <CallControls
          styles={styles}
          controlsBottom={controlsBottom}
          myCamOn={myCamOn}
          mySoundOn={mySoundOn}
          remoteMuted={remoteMuted}
          openBeauty={openBeauty}
          toggleCam={toggleCam}
          toggleSound={toggleSound}
          toggleRemoteMute={toggleRemoteMute}
          onPressChatControl={onPressChatControl}
          openChatComposer={openChatComposer}
        />
      ) : null}

      {phase === "calling" ? (
        <ChatComposer
          styles={styles}
          visible={chatComposerOpen}
          insetsBottom={insets.bottom}
          chatInputRef={chatInputRef}
          chatInput={chatInput}
          setChatInput={setChatInput}
          sendChat={sendChat}
          onBackdropPress={onChatComposerBackdropPress}
          onInputFocus={onChatInputFocus}
        />
      ) : null}

      <CallOverlays
        styles={styles}
        t={t}
        insetsTop={insets.top}
        onPressBack={onPressBack}
        onExitToHome={onExitToHome}
        noMatchModal={noMatchModal}
        isPremium={isPremium}
        onDismissNoMatch={dismissNoMatch}
        onRetry={retry}
        matchingActionsVisible={matchingActionsVisible}
        onPressMatchingBeauty={onPressMatchingBeauty}
        onPressMatchingFortune={onPressMatchingFortune}
        onPressMatchingGame={onPressMatchingGame}
        onDismissMatchingActions={dismissMatchingActions}
        prefsModal={prefsModal}
        setPrefsModal={setPrefsModal}
        prefs={prefs}
        fontScale={fontScale}
        setFontScale={setFontScale}
      />

      <AppModal
        visible={popTalkLowModal}
        title={t("poptalk.low_title")}
        dismissible={true}
        onClose={() => setPopTalkLowModal(false)}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("poptalk.charge")} onPress={onPressPopTalkCharge} />
            <PrimaryButton title={t("poptalk.watch_ad")} onPress={onPressWatchPopTalkAd} />
            <PrimaryButton title={t("common.close")} variant="ghost" onPress={() => setPopTalkLowModal(false)} />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20 }}>
          {t("poptalk.low_desc")}
          {"\n"}
          {t("poptalk.balance_label", {
            balance: Number(popTalk?.balance ?? 0),
            cap: Number(popTalk?.cap ?? 0),
          })}
        </AppText>
      </AppModal>

      <AppModal
        visible={popTalkMatchBlockModal}
        title={t("poptalk.match_block_title")}
        dismissible={false}
        onClose={onPressPopTalkWait}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("poptalk.charge")} onPress={onPressPopTalkCharge} />
            <PrimaryButton title={t("poptalk.watch_ad")} onPress={onPressWatchPopTalkAd} />
            <PrimaryButton title={t("poptalk.wait_recharge")} variant="ghost" onPress={onPressPopTalkWait} />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20 }}>
          {t("poptalk.match_block_desc", { min: POPTALK_MATCH_BLOCK_THRESHOLD })}
          {"\n"}
          {t("poptalk.balance_label", {
            balance: Number(popTalk?.balance ?? 0),
            cap: Number(popTalk?.cap ?? 0),
          })}
        </AppText>
      </AppModal>

      <AppModal
        visible={popTalkEmptyModal}
        title={t("poptalk.empty_title")}
        dismissible={false}
        onClose={onPressPopTalkWait}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("poptalk.charge")} onPress={onPressPopTalkCharge} />
            <PrimaryButton title={t("poptalk.watch_ad")} onPress={onPressWatchPopTalkAd} />
            <PrimaryButton title={t("poptalk.wait_recharge")} variant="ghost" onPress={onPressPopTalkWait} />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20 }}>
          {t("poptalk.empty_desc")}
          {"\n"}
          {t("poptalk.balance_label", {
            balance: Number(popTalk?.balance ?? 0),
            cap: Number(popTalk?.cap ?? 0),
          })}
        </AppText>
      </AppModal>

      <AppModal
        visible={popTalkAdFailModal}
        title={popTalkAdFailCount >= 3 ? t("poptalk.ad_fail_title") : t("poptalk.ad_loading_title")}
        dismissible={false}
        onClose={() => setPopTalkAdFailModal(false)}
        footer={
          popTalkAdFailCount >= 3 ? (
            <View style={{ gap: 10 }}>
              <PrimaryButton title={t("poptalk.charge")} onPress={onPressPopTalkCharge} />
              <PrimaryButton title={t("common.close")} variant="ghost" onPress={() => setPopTalkAdFailModal(false)} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <PrimaryButton title={t("poptalk.retry_ad")} onPress={onPressWatchPopTalkAd} />
              <PrimaryButton title={t("common.close")} variant="ghost" onPress={() => setPopTalkAdFailModal(false)} />
            </View>
          )
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20 }}>
          {popTalkAdFailCount >= 3 ? t("poptalk.ad_fail_desc") : t("poptalk.ad_loading_desc")}
        </AppText>
      </AppModal>
    </View>
  );
}

