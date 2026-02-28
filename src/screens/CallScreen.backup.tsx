// FILE: C:\ranchat\src\screens\CallScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Animated, Easing, StyleSheet, View, Pressable, Dimensions, ScrollView, Text, TextInput, Keyboard, BackHandler, NativeModules, Platform, Image, PanResponder, KeyboardAvoidingView, InteractionManager } from "react-native";
import { RTCView, mediaDevices } from "react-native-webrtc";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { theme } from "../config/theme";
import { APP_CONFIG } from "../config/app";
import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import { useAppStore } from "../store/useAppStore";
import { SignalClient, SignalMessage } from "../services/signal/SignalClient";
import { WebRTCSession } from "../services/webrtc/WebRTCSession";
import { createInterstitial, initAds } from "../services/ads/AdManager";
import mobileAds, { AdEventType, NativeAd, NativeAdView, NativeAsset, NativeAssetType, NativeMediaView, NativeMediaAspectRatio } from "react-native-google-mobile-ads";
import { purchasePremium, refreshSubscription } from "../services/purchases/PurchaseManager";
import type { MainStackParamList } from "../navigation/MainStack";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "../i18n/LanguageProvider";
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageName, normalizeLanguageCode } from "../i18n/displayNames";
import CallBeautySheet, { BeautyConfig } from "./CallBeautySheet";
import MatchingWaitActionsModal from "../components/MatchingWaitActionsModal";
import HeartbeatSpinner from "../components/HeartbeatSpinner";

type Props = NativeStackScreenProps<MainStackParamList, "Call">;

type Phase = "connecting" | "queued" | "matched" | "calling" | "ended";
type ChatMessage = { id: string; mine: boolean; text: string };

const MATCH_TIMEOUT_MS = (() => {
  const v = Number((APP_CONFIG as any)?.MATCH_TIMEOUT_MS);
  return Number.isFinite(v) ? v : 60000;
})();

const FREE_CALL_LIMIT_MS = (() => {
  const direct = Number((APP_CONFIG as any)?.FREE_CALL_LIMIT_MS);
  if (Number.isFinite(direct)) return direct;

  const sec = Number((APP_CONFIG as any)?.FREE_LIMITS?.remoteVideoSeconds);
  if (Number.isFinite(sec)) return sec * 1000;

  return 3000 * 1000;
})();

const INTERSTITIAL_COOLDOWN_MS = 4 * 60 * 1000;
const MATCHING_ACTIONS_DELAY_MS = 7500;

function countryCodeToFlagEmoji(code: string) {
  const cc = String(code || "").trim().toUpperCase();
  if (cc.length !== 2) return "";
  const A = 0x1f1e6;
  const c1 = cc.charCodeAt(0) - 65;
  const c2 = cc.charCodeAt(1) - 65;
  if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return "";
  return String.fromCodePoint(A + c1, A + c2);
}

const NATIVE_UNIT_ID = (process.env.EXPO_PUBLIC_AD_UNIT_NATIVE_ANDROID ?? "").trim() || "ca-app-pub-5144004139813427/8416045900";

function QueueNativeAd256x144() {
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);
  const adRef = useRef<NativeAd | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    let alive = true;

    NativeAd.createForAdRequest(NATIVE_UNIT_ID, { aspectRatio: NativeMediaAspectRatio.LANDSCAPE })
      .then((ad) => {
        if (!alive) {
          try {
            ad.destroy();
          } catch {}
          return;
        }
        adRef.current = ad;
        setNativeAd(ad);
      })
      .catch(() => {});

    return () => {
      alive = false;
      try {
        adRef.current?.destroy();
      } catch {}
      adRef.current = null;
    };
  }, []);

  if (!nativeAd) return null;

  return (
    <NativeAdView nativeAd={nativeAd} style={[styles.nativeAd256, { width: W, height: Math.round((W * 202) / 360) }]}>
      <View style={styles.nativeAdInner}>
        <NativeMediaView style={styles.nativeAdMedia} resizeMode="cover" />
        <View style={styles.nativeAdFooter}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={styles.nativeAdHeadline} numberOfLines={1}>
              {nativeAd.headline}
            </Text>
          </NativeAsset>
          <AppText style={styles.nativeAdTag}>{t("common.ad")}</AppText>
        </View>
      </View>
    </NativeAdView>
  );
}

export default function CallScreen({ navigation }: Props) {

  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const isScreenFocused = useIsFocused();

  const prefs = useAppStore((s) => s.prefs);
  const token = useAppStore((s) => s.auth.token);
  const isPremium = useAppStore((s) => s.sub.isPremium);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

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


  const [limitModal, setLimitModal] = useState(false);
  const [remoteVideoAllowed, setRemoteVideoAllowed] = useState(true);

  const [upgradeModal, setUpgradeModal] = useState(false);
  const [noMatchModal, setNoMatchModal] = useState(false);
  const [fastMatchHint, setFastMatchHint] = useState(false);
  const [matchingActionsVisible, setMatchingActionsVisible] = useState(false);

  const [reMatchText, setReMatchText] = useState<string>("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatReady, setChatReady] = useState(false);
  const [chatFeedVisible, setChatFeedVisible] = useState(false);
  const [chatComposerOpen, setChatComposerOpen] = useState(false);
  const [showSwipeGuide, setShowSwipeGuide] = useState(false);
  const [swipeGuideFrame, setSwipeGuideFrame] = useState(0);

  const [prefsModal, setPrefsModal] = useState(false);

  const [beautyOpen, setBeautyOpen] = useState(false);
  const openBeauty = useCallback(() => {
    beautyOpeningIntentRef.current = true;
    setBeautyOpen(true);
  }, []);

  const [beautyConfig, setBeautyConfig] = useState<BeautyConfig>({
    enabled: false,
    preset: "none",
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.5,
    bgFocus: false,
    bgFocusStrength: 0,
  });

  const beautyLastPushAtRef = useRef(0);
  const beautyPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beautyPendingRef = useRef<BeautyConfig | null>(null);
  const beautyEffectStateRef = useRef<{ trackId: string | null; enabled: boolean }>({ trackId: null, enabled: false });

  const getLocalVideoTrack = useCallback(() => {
    const s: any = localStreamRef.current;
    const tracks = (s?.getVideoTracks?.() ?? []) as any[];
    return tracks[0] ?? null;
  }, []);

  const pushBeautyConfigThrottled = useCallback((trackId: string, cfg: BeautyConfig) => {
    beautyPendingRef.current = cfg;

    if (beautyPushTimerRef.current) return;

    const now = Date.now();
    const wait = Math.max(0, 120 - (now - beautyLastPushAtRef.current));

    beautyPushTimerRef.current = setTimeout(() => {
      beautyPushTimerRef.current = null;

      const latest = beautyPendingRef.current;
      if (!latest || !latest.enabled) return;

      try {
        (NativeModules as any)?.WebRTCModule?.mediaStreamTrackSetVideoEffectConfig?.(trackId, latest);
        beautyLastPushAtRef.current = Date.now();
      } catch {}
    }, wait);
  }, []);

  useEffect(() => {
    const track: any = getLocalVideoTrack();
    const trackId = String(track?.id ?? "");
    if (!trackId) return;

    const wantEnabled = Boolean(beautyConfig.enabled);
    const last = beautyEffectStateRef.current;

    if (last.trackId !== trackId || last.enabled !== wantEnabled) {
      try {
        track._setVideoEffects(wantEnabled ? ["beauty"] : []);
      } catch {}
      beautyEffectStateRef.current = { trackId, enabled: wantEnabled };
    }

    if (wantEnabled) {
      pushBeautyConfigThrottled(trackId, beautyConfig);
    }
  }, [beautyConfig.enabled, localStreamURL, getLocalVideoTrack, pushBeautyConfigThrottled]);

  useEffect(() => {
    if (!beautyConfig.enabled) return;

    const track: any = getLocalVideoTrack();
    const trackId = String(track?.id ?? "");
    if (!trackId) return;

    pushBeautyConfigThrottled(trackId, beautyConfig);
  }, [beautyConfig, localStreamURL, getLocalVideoTrack, pushBeautyConfigThrottled]);

  useEffect(() => {
    return () => {
      if (beautyPushTimerRef.current) clearTimeout(beautyPushTimerRef.current);
      beautyPushTimerRef.current = null;
    };
  }, []);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const wsRef = useRef<SignalClient | null>(null);
  const rtcRef = useRef<WebRTCSession | null>(null);
  const chatSeqRef = useRef(0);
  const chatHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatFeedOpacityRef = useRef(new Animated.Value(0));
  const chatFeedHideProgressRef = useRef(new Animated.Value(0));
  const chatInputRef = useRef<TextInput | null>(null);
  const chatComposerOpenRef = useRef(false);
  const chatOpenPendingRef = useRef(false);
  const chatComposerOpenedAtRef = useRef(0);
  const chatIgnoreHideUntilRef = useRef(0);
  const chatOpenBlockUntilRef = useRef(0);
  const chatFocusTimerRefs = useRef<ReturnType<typeof setTimeout>[]>([]);
  const chatKeyboardVisibleRef = useRef(false);
  const swipeGuideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeGuideFlipTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const swipeGuideCamOpenPrevRef = useRef(false);
  const lastSwipeRefreshAtRef = useRef(0);
  const localStreamRef = useRef<any>(null);
  const previewStreamRef = useRef<any>(null);
  const previewOpeningRef = useRef(false);
  const remoteStreamRef = useRef<any>(null);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pendingSignalRef = useRef<{ type: "offer" | "answer" | "ice"; sdp?: any; candidate?: any }[]>([]);

  const beginCallGuardRef = useRef(false);
  const callStartTokenRef = useRef(0);

  const lastInterstitialAtRef = useRef<number>(0);

  const enqueuedRef = useRef(false);
  const queueRunningRef = useRef(false);

  const rebindOnceRef = useRef(false);

  const noMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchingActionsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchingActionsDeadlineRef = useRef(0);
  const requeueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const premiumNoMatchAutoCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noMatchShownThisCycleRef = useRef(false);

  const canStart = useRef(false);

  const [adsReady, setAdsReady] = useState(false);
  const adsReadyRef = useRef(false);
  const adsAliveRef = useRef(true);
  const adsInitPromiseRef = useRef<Promise<any> | null>(null);

  const adAllowedRef = useRef(false);
  const interstitialTokenRef = useRef(0);
  const interstitialCleanupRef = useRef<(() => void) | null>(null);
  const interstitialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [peerInfo, setPeerInfo] = useState<any>(null);

  const beautyOpenRef = useRef(false);
  const beautyOpeningIntentRef = useRef(false);
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

  const waitAdsReady = useCallback(async (maxWaitMs = 1000) => {
    if (adsReadyRef.current) return true;

    try {
      initAds();
    } catch {}

    if (!adsInitPromiseRef.current) {
      try {
        const p = mobileAds().initialize();
        adsInitPromiseRef.current = Promise.resolve(p as any);

        (p as any)?.then?.(() => {
          if (adsReadyRef.current) return;
          adsReadyRef.current = true;
          if (!adsAliveRef.current) return;
          setAdsReady(true);
        }).catch?.(() => {});
      } catch {}
    }

    const p = adsInitPromiseRef.current;
    if (!p) return adsReadyRef.current;

    try {
      await Promise.race([
        p,
        new Promise((resolve) => setTimeout(resolve, Math.max(0, maxWaitMs))),
      ]);
    } catch {}

    return adsReadyRef.current;
  }, []);

  const peerCountryRaw = useMemo(() => String((peerInfo as any)?.country ?? ""), [peerInfo]);
  const peerLangRaw = useMemo(() => String((peerInfo as any)?.language ?? (peerInfo as any)?.lang ?? ""), [peerInfo]);
  const peerFlag = useMemo(() => {
    const direct = String((peerInfo as any)?.flag ?? "").trim();
    return direct || countryCodeToFlagEmoji(peerCountryRaw);
  }, [peerInfo, peerCountryRaw]);
  const peerLangLabel = useMemo(() => {
    return getLanguageName(t, peerLangRaw);
  }, [peerLangRaw, t]);
  const peerGenderRaw = useMemo(() => String((peerInfo as any)?.gender ?? ""), [peerInfo]);
  const peerGenderLabel = useMemo(() => {
    const g = String(peerGenderRaw || "").trim().toLowerCase();
    if (!g) return "";
    if (g === "male" || g === "m") return t("gender.male");
    if (g === "female" || g === "f") return t("gender.female");
    return peerGenderRaw;
  }, [peerGenderRaw, t]);

  const peerInfoText = useMemo(() => {
    const parts: string[] = [];

    const countryPart = (peerFlag ? `${peerFlag} ` : "") + (peerCountryRaw || "");
    if (countryPart.trim()) parts.push(countryPart.trim());

    if (peerLangLabel) parts.push(peerLangLabel);

    if (peerGenderLabel) parts.push(peerGenderLabel);

    return parts.join(" · ");
  }, [peerLangLabel, peerFlag, peerCountryRaw, peerGenderLabel]);

  const myCountryRaw = useMemo(() => String((prefs as any)?.country ?? ""), [prefs]);
  const myLangRaw = useMemo(() => String((prefs as any)?.language ?? (prefs as any)?.lang ?? ""), [prefs]);
  const myFlag = useMemo(() => countryCodeToFlagEmoji(myCountryRaw), [myCountryRaw]);
  const myLangLabel = useMemo(() => getLanguageName(t, myLangRaw), [myLangRaw, t]);
  const myGenderRaw = useMemo(() => String((prefs as any)?.gender ?? ""), [prefs]);
  const myGenderLabel = useMemo(() => {
    const g = String(myGenderRaw || "").trim().toLowerCase();
    if (!g) return "";
    if (g === "male" || g === "m") return t("gender.male");
    if (g === "female" || g === "f") return t("gender.female");
    return myGenderRaw;
  }, [myGenderRaw, t]);

  const clearChatHideTimer = useCallback(() => {
    if (chatHideTimerRef.current) clearTimeout(chatHideTimerRef.current);
    chatHideTimerRef.current = null;
  }, []);

  const clearSwipeGuideTimer = useCallback(() => {
    if (swipeGuideTimerRef.current) clearTimeout(swipeGuideTimerRef.current);
    swipeGuideTimerRef.current = null;
  }, []);

  const clearSwipeGuideFlipTimer = useCallback(() => {
    if (swipeGuideFlipTimerRef.current) clearInterval(swipeGuideFlipTimerRef.current);
    swipeGuideFlipTimerRef.current = null;
  }, []);

  const clearChatFocusTimers = useCallback(() => {
    chatFocusTimerRefs.current.forEach((tm) => clearTimeout(tm));
    chatFocusTimerRefs.current = [];
  }, []);

  const resetChatFeedAnimations = useCallback(() => {
    chatFeedOpacityRef.current.stopAnimation();
    chatFeedHideProgressRef.current.stopAnimation();
    chatFeedOpacityRef.current.setValue(0);
    chatFeedHideProgressRef.current.setValue(0);
  }, []);

  const animateChatFeedOpacity = useCallback((toValue: number, duration: number, onDone?: () => void) => {
    chatFeedOpacityRef.current.stopAnimation();
    Animated.timing(chatFeedOpacityRef.current, {
      toValue,
      duration,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      onDone?.();
    });
  }, []);

  const animateChatFeedHideProgress = useCallback((toValue: number, duration: number, onDone?: () => void) => {
    chatFeedHideProgressRef.current.stopAnimation();
    Animated.timing(chatFeedHideProgressRef.current, {
      toValue,
      duration,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      onDone?.();
    });
  }, []);

  const showChatFeedForAWhile = useCallback(() => {
    setChatFeedVisible(true);
    chatFeedHideProgressRef.current.stopAnimation();
    chatFeedHideProgressRef.current.setValue(0);
    animateChatFeedOpacity(1, 160);
    clearChatHideTimer();
    chatHideTimerRef.current = setTimeout(() => {
      chatHideTimerRef.current = null;
      animateChatFeedHideProgress(1, 420, () => {
        animateChatFeedOpacity(0, 120, () => {
          setChatFeedVisible(false);
          chatFeedHideProgressRef.current.setValue(0);
        });
      });
    }, 7000);
  }, [animateChatFeedHideProgress, animateChatFeedOpacity, clearChatHideTimer]);

  const appendChatMessage = useCallback((mine: boolean, message: string) => {
    const text = String(message || "").trim();
    if (!text) return;

    const id = `${Date.now()}_${chatSeqRef.current++}`;
    setChatMessages((prev) => {
      const next = [...prev, { id, mine, text }];
      return next.length > 5 ? next.slice(next.length - 5) : next;
    });
    showChatFeedForAWhile();
  }, [showChatFeedForAWhile]);

  const sendChat = useCallback(() => {
    const text = String(chatInput || "").trim();
    if (!text) return;

    const ok = rtcRef.current?.sendChatMessage(text);
    if (!ok) return;

    appendChatMessage(true, text);
    setChatInput("");
    clearChatFocusTimers();
    chatOpenPendingRef.current = false;
    chatComposerOpenRef.current = false;
    chatKeyboardVisibleRef.current = false;
    chatIgnoreHideUntilRef.current = 0;
    chatOpenBlockUntilRef.current = 0;
    chatInputRef.current?.blur?.();
    Keyboard.dismiss();
    setChatComposerOpen(false);
  }, [appendChatMessage, chatInput, clearChatFocusTimers]);

  const closeChatComposer = useCallback(() => {
    clearChatFocusTimers();
    chatOpenPendingRef.current = false;
    chatComposerOpenRef.current = false;
    chatKeyboardVisibleRef.current = false;
    chatIgnoreHideUntilRef.current = 0;
    chatOpenBlockUntilRef.current = Date.now() + 320;
    chatInputRef.current?.blur?.();
    Keyboard.dismiss();
    setChatComposerOpen(false);
  }, [clearChatFocusTimers]);

  const queueChatInputFocus = useCallback((extraDelay = 0) => {
    const tm = setTimeout(() => {
      if (!chatComposerOpenRef.current) return;
      const input = chatInputRef.current;
      if (!input) return;
      if (input.isFocused?.()) {
        chatOpenPendingRef.current = false;
        return;
      }
      input.focus?.();
    }, Math.max(0, extraDelay));
    chatFocusTimerRefs.current.push(tm);
  }, []);

  const armChatInputFocus = useCallback(() => {
    if (!chatComposerOpenRef.current && !chatOpenPendingRef.current) return;
    chatIgnoreHideUntilRef.current = Date.now() + 700;
    queueChatInputFocus(0);
    queueChatInputFocus(36);
    queueChatInputFocus(72);
    queueChatInputFocus(144);
    queueChatInputFocus(240);
    queueChatInputFocus(340);
    requestAnimationFrame(() => {
      if (!chatComposerOpenRef.current) return;
      chatInputRef.current?.focus?.();
    });
    try {
      InteractionManager.runAfterInteractions(() => {
        if (!chatComposerOpenRef.current) return;
        chatInputRef.current?.focus?.();
      });
    } catch {}
  }, [queueChatInputFocus]);

  const openChatComposer = useCallback(() => {
    if (phaseRef.current !== "calling") return;
    if (Date.now() < chatOpenBlockUntilRef.current) return;
    if (chatOpenPendingRef.current) return;
    if (chatComposerOpenRef.current) return;

    clearChatFocusTimers();
    chatComposerOpenedAtRef.current = Date.now();
    chatOpenPendingRef.current = true;
    chatComposerOpenRef.current = true;
    setChatComposerOpen(true);
    armChatInputFocus();
  }, [armChatInputFocus, clearChatFocusTimers]);

  const onPressChatControl = useCallback(() => {
    if (!chatComposerOpenRef.current && !chatOpenPendingRef.current) {
      openChatComposer();
      return;
    }
    armChatInputFocus();
  }, [armChatInputFocus, openChatComposer]);

  const onChatComposerBackdropPress = useCallback(() => {
    if (Date.now() - chatComposerOpenedAtRef.current < 260) return;
    closeChatComposer();
  }, [closeChatComposer]);

  useEffect(() => {
    chatComposerOpenRef.current = chatComposerOpen;
  }, [chatComposerOpen]);

  useEffect(() => {
    if (!chatComposerOpen) return;
    armChatInputFocus();
  }, [armChatInputFocus, chatComposerOpen]);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const subShow = Keyboard.addListener(showEvent as any, () => {
      chatKeyboardVisibleRef.current = true;
      if (phaseRef.current !== "calling") return;
      if (!chatComposerOpenRef.current) return;
      chatOpenPendingRef.current = false;
      armChatInputFocus();
    });
    const subHide = Keyboard.addListener(hideEvent as any, () => {
      chatKeyboardVisibleRef.current = false;
      if (Date.now() < chatIgnoreHideUntilRef.current) {
        if (chatComposerOpenRef.current) {
          armChatInputFocus();
        }
        return;
      }
      if (chatOpenPendingRef.current) {
        armChatInputFocus();
        return;
      }

      if (chatComposerOpenRef.current) {
        const openedAgo = Date.now() - chatComposerOpenedAtRef.current;
        if (openedAgo < 220) {
          armChatInputFocus();
          return;
        }

        clearChatFocusTimers();
        chatComposerOpenRef.current = false;
        chatOpenPendingRef.current = false;
        chatIgnoreHideUntilRef.current = 0;
        chatOpenBlockUntilRef.current = Date.now() + 320;
        chatInputRef.current?.blur?.();
        setChatComposerOpen(false);
      }
    });

    return () => {
      try {
        subShow.remove();
      } catch {}
      try {
        subHide.remove();
      } catch {}
    };
  }, [armChatInputFocus, clearChatFocusTimers]);

  useEffect(() => {
    return () => {
      clearChatFocusTimers();
      chatOpenPendingRef.current = false;
      chatComposerOpenRef.current = false;
      chatKeyboardVisibleRef.current = false;
      chatIgnoreHideUntilRef.current = 0;
      chatOpenBlockUntilRef.current = 0;
      chatInputRef.current?.blur?.();
      clearChatHideTimer();
      resetChatFeedAnimations();
      clearSwipeGuideTimer();
      clearSwipeGuideFlipTimer();
    };
  }, [clearChatFocusTimers, clearChatHideTimer, clearSwipeGuideFlipTimer, clearSwipeGuideTimer, resetChatFeedAnimations]);

  useEffect(() => {
    const camOpenedNow = phase === "calling" && myCamOn && Boolean(localStreamURL);

    if (camOpenedNow && !swipeGuideCamOpenPrevRef.current) {
      clearSwipeGuideTimer();
      clearSwipeGuideFlipTimer();
      setShowSwipeGuide(true);
      setSwipeGuideFrame(0);
      swipeGuideFlipTimerRef.current = setInterval(() => {
        setSwipeGuideFrame((prev) => (prev === 0 ? 1 : 0));
      }, 700);
      swipeGuideTimerRef.current = setTimeout(() => {
        setShowSwipeGuide(false);
        swipeGuideTimerRef.current = null;
        clearSwipeGuideFlipTimer();
      }, 10000);
    }

    if (!camOpenedNow) {
      clearSwipeGuideTimer();
      clearSwipeGuideFlipTimer();
      setShowSwipeGuide(false);
      setSwipeGuideFrame(0);
    }

    swipeGuideCamOpenPrevRef.current = camOpenedNow;
  }, [clearSwipeGuideFlipTimer, clearSwipeGuideTimer, localStreamURL, myCamOn, phase]);


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
    beautyOpenRef.current = beautyOpen;
    if (beautyOpen) {
      beautyOpeningIntentRef.current = true;
    }
  }, [beautyOpen]);

  useEffect(() => {
    isScreenFocusedRef.current = isScreenFocused;
  }, [isScreenFocused]);

  useEffect(() => {
    if (!isScreenFocused) {
      clearMatchingActionsTimer(false);
      setMatchingActionsVisible(false);
      return;
    }

    if (beautyOpen) {
      clearMatchingActionsTimer();
      setMatchingActionsVisible(false);
      return;
    }

    if (phase === "connecting" || phase === "queued" || phase === "ended") {
      startMatchingActionsTimer();
      return;
    }

    if (phase === "matched") {
      // Preserve the waiting deadline across transient match/fail/requeue loops.
      clearMatchingActionsTimer(false);
      return;
    }

    if (phase === "calling") {
      clearMatchingActionsTimer(true);
      setMatchingActionsVisible(false);
      return;
    }

    clearMatchingActionsTimer(true);
  }, [beautyOpen, isScreenFocused, phase]);

  useEffect(() => {
    adsAliveRef.current = true;
    waitAdsReady(1000);
    return () => {
      adsAliveRef.current = false;
    };
  }, [waitAdsReady]);

  const clearMatchingActionsTimer = (resetDeadline = true) => {
    if (matchingActionsTimerRef.current) clearTimeout(matchingActionsTimerRef.current);
    matchingActionsTimerRef.current = null;
    if (resetDeadline) {
      matchingActionsDeadlineRef.current = 0;
    }
  };

  const startMatchingActionsTimer = (forceReset = false) => {
    if (forceReset) {
      clearMatchingActionsTimer();
      setMatchingActionsVisible(false);
    } else if (matchingActionsTimerRef.current) {
      return;
    }
    if (!matchingActionsDeadlineRef.current) {
      matchingActionsDeadlineRef.current = Date.now() + MATCHING_ACTIONS_DELAY_MS;
    }
    const waitMs = Math.max(0, matchingActionsDeadlineRef.current - Date.now());
    matchingActionsTimerRef.current = setTimeout(() => {
      matchingActionsTimerRef.current = null;
      if (!isScreenFocusedRef.current) return;
      if (phaseRef.current === "calling") {
        matchingActionsDeadlineRef.current = 0;
        return;
      }
      if (phaseRef.current === "matched") {
        // Keep deadline so failed handshake/requeue can show immediately when overdue.
        return;
      }
      if (beautyOpenRef.current) {
        return;
      }
      matchingActionsDeadlineRef.current = 0;
      setMatchingActionsVisible(true);
    }, waitMs);
  };

  useFocusEffect(
    useCallback(() => {
      if (!isScreenFocusedRef.current) return;
      if (beautyOpenRef.current) return;
      if (phaseRef.current === "calling" || phaseRef.current === "matched") return;
      startMatchingActionsTimer();
    }, [])
  );

  const startNoMatchTimer = () => {
    if (!queueRunningRef.current) return;
    if (noMatchShownThisCycleRef.current) return;
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);

    noMatchTimerRef.current = setTimeout(() => {
      if (!queueRunningRef.current) return;
      if (!enqueuedRef.current) return;
      if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return;
      if (noMatchShownThisCycleRef.current) return;
      noMatchShownThisCycleRef.current = true;

      if (isPremium) {
        setFastMatchHint(true);
        setMatchingActionsVisible(false);
        setNoMatchModal(true);

        if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
        premiumNoMatchAutoCloseRef.current = setTimeout(() => {
          setNoMatchModal(false);
        }, 3000);

        return;
      }

      queueRunningRef.current = false;
      enqueuedRef.current = false;

      try {
        wsRef.current?.leaveQueue();
      } catch {}
      try {
        manualCloseRef.current = true;
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;

      setMatchingActionsVisible(false);
      setNoMatchModal(true);
    }, MATCH_TIMEOUT_MS);
  };

  const clearNoMatchTimer = () => {
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);
    noMatchTimerRef.current = null;

    if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
    premiumNoMatchAutoCloseRef.current = null;
  };

  const clearLocalPreviewStream = useCallback(() => {
    const s: any = previewStreamRef.current;
    if (!s) return;

    try {
      (s as any)?.getTracks?.()?.forEach((t: any) => t?.stop?.());
    } catch {}

    previewStreamRef.current = null;
    if (localStreamRef.current === s) localStreamRef.current = null;

    if (phaseRef.current !== "calling") {
      setLocalStreamURL(null);
    }
  }, []);

  const hasLiveVideoTrack = useCallback((stream: any) => {
    try {
      const tracks = (stream?.getVideoTracks?.() ?? []) as any[];
      if (!tracks.length) return false;
      return tracks.some((t: any) => String(t?.readyState ?? "live").toLowerCase() !== "ended");
    } catch {
      return false;
    }
  }, []);

  const ensureLocalPreviewStream = useCallback(async () => {
    if (phaseRef.current === "calling") return true;

    const existing = previewStreamRef.current;
    if (existing && hasLiveVideoTrack(existing)) {
      localStreamRef.current = existing;
      try {
        setLocalStreamURL(existing.toURL());
      } catch {}
      return true;
    }
    if (existing) {
      try {
        (existing as any)?.getTracks?.()?.forEach((t: any) => t?.stop?.());
      } catch {}
      previewStreamRef.current = null;
      if (localStreamRef.current === existing) localStreamRef.current = null;
      setLocalStreamURL(null);
    }

    if (previewOpeningRef.current) return false;
    previewOpeningRef.current = true;

    try {
      const requestPreviewStream = async (fallback = false) =>
        mediaDevices.getUserMedia({
          audio: false,
          video: fallback
            ? {
                facingMode: "user",
                frameRate: { ideal: 20, max: 20 },
                width: { ideal: 640, max: 640 },
                height: { ideal: 480, max: 480 },
              }
            : {
                facingMode: "user",
                frameRate: { ideal: 24, max: 24 },
                width: { ideal: 720, max: 720 },
                height: { ideal: 540, max: 540 },
              },
        } as any);

      let stream: any = null;
      try {
        stream = await requestPreviewStream(false);
        if (!hasLiveVideoTrack(stream)) throw new Error("PREVIEW_STREAM_NO_LIVE_TRACK");
      } catch {
        try {
          await new Promise((resolve) => setTimeout(resolve, 120));
        } catch {}
        stream = await requestPreviewStream(true);
      }

      if (!stream || !hasLiveVideoTrack(stream)) {
        throw new Error("PREVIEW_STREAM_INVALID");
      }

      previewStreamRef.current = stream;
      localStreamRef.current = stream;
      setLocalStreamURL(stream.toURL());
      return true;
    } catch {
      showGlobalModal(t("common.error_occurred"), t("call.camera_preview_failed"));
      return false;
    } finally {
      previewOpeningRef.current = false;
    }
  }, [hasLiveVideoTrack, showGlobalModal, t]);

  const closeBeauty = useCallback(() => {
    beautyOpeningIntentRef.current = false;
    setBeautyOpen(false);
    if (phaseRef.current !== "calling") {
      clearLocalPreviewStream();
    }
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

  const stopAll = (isUserExit = false, resetMatchingActions = true) => {
    if (isUserExit) {
      manualCloseRef.current = true;
    }

    callStartTokenRef.current += 1;
    beginCallGuardRef.current = false;

    adAllowedRef.current = false;
    interstitialTokenRef.current += 1;

    if (interstitialTimerRef.current) clearTimeout(interstitialTimerRef.current);
    interstitialTimerRef.current = null;

    try {
      interstitialCleanupRef.current?.();
    } catch {}
    interstitialCleanupRef.current = null;

    if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
    requeueTimerRef.current = null;

    clearNoMatchTimer();
    if (resetMatchingActions) {
      clearMatchingActionsTimer(true);
      setMatchingActionsVisible(false);
    } else if (matchingActionsTimerRef.current) {
      clearTimeout(matchingActionsTimerRef.current);
      matchingActionsTimerRef.current = null;
    }
    const keepBeautyOpen = !isUserExit && (beautyOpenRef.current || beautyOpeningIntentRef.current);
    if (!keepBeautyOpen) {
      clearLocalPreviewStream();
      setBeautyOpen(false);
    }

    clearReconnectTimer();
    clearWebrtcDownTimer();

    if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
    peerReadyTimerRef.current = null;
    beginCallReqRef.current = null;

    if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
    webrtcConnectTimerRef.current = null;
    webrtcConnectedRef.current = false;

    setSignalUnstable(false);

    noMatchShownThisCycleRef.current = false;
    setFastMatchHint(false);

    queueRunningRef.current = false;
    enqueuedRef.current = false;

    const rid = roomIdRef.current;

    if (rid) {
      try {
        wsRef.current?.leaveRoom(rid);
      } catch {}
    }

    if (rid && wsRef.current && !suppressEndRelayRef.current) {
      try {
        wsRef.current.relay(rid, { type: "end" });
      } catch {}
    }

    try {
      wsRef.current?.leaveQueue();
    } catch {}

    if (isUserExit) {
      manualCloseRef.current = true;
    }

    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;

    try {
      rtcRef.current?.stop();
    } catch {}
    rtcRef.current = null;

    if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
    limitTimerRef.current = null;

    if (keepBeautyOpen) {
      const preview = previewStreamRef.current;
      if (preview && hasLiveVideoTrack(preview)) {
        localStreamRef.current = preview;
        try {
          setLocalStreamURL(preview.toURL());
        } catch {
          setLocalStreamURL(null);
        }
      } else {
        setLocalStreamURL(null);
      }
    } else {
      setLocalStreamURL(null);
    }
    setRemoteStreamURL(null);
    setChatReady(false);
    setChatInput("");
    setChatMessages([]);
    setChatFeedVisible(false);
    resetChatFeedAnimations();
    chatOpenPendingRef.current = false;
    chatComposerOpenRef.current = false;
    chatIgnoreHideUntilRef.current = 0;
    chatInputRef.current?.blur?.();
    setChatComposerOpen(false);
    clearChatHideTimer();
    clearSwipeGuideTimer();
    clearSwipeGuideFlipTimer();
    setShowSwipeGuide(false);
    setSwipeGuideFrame(0);
    swipeGuideCamOpenPrevRef.current = false;
    chatSeqRef.current = 0;
    setRoomId(null);
    setPeerInfo(null);
    setRemoteVideoAllowed(true);
    setRemoteCamOn(true);
    setLimitModal(false);
    matchRevealRunningRef.current = false;
    setMatchRevealActive(false);
    matchRevealAnimRef.current.stopAnimation();
    matchRevealAnimRef.current.setValue(0);
    setPhase("ended");
  };

  const goHome = useCallback(() => {
    const nav: any = navigation as any;

    let root: any = nav;
    try {
      while (root?.getParent?.()) root = root.getParent();
    } catch {}

    try {
      const st = root?.getState?.();
      const first = st?.routes?.[0]?.name;
      if (first) {
        root.reset({ index: 0, routes: [{ name: first }] });
        return;
      }
    } catch {}

    try {
      root?.popToTop?.();
    } catch {}
  }, [navigation]);

  const onPressBack = () => {
    stopAll(true);
    goHome();
  };

  const showInterstitialIfAllowed = useCallback(
    async (after: () => void) => {
      if (isPremium) {
        after();
        return;
      }

      if (!adAllowedRef.current) {
        after();
        return;
      }

      try {
        interstitialCleanupRef.current?.();
      } catch {}
      interstitialCleanupRef.current = null;

      if (interstitialTimerRef.current) clearTimeout(interstitialTimerRef.current);
      interstitialTimerRef.current = null;

      const token = interstitialTokenRef.current + 1;
      interstitialTokenRef.current = token;

      const now = Date.now();
      const diff = now - (lastInterstitialAtRef.current || 0);
      const allowed = diff >= INTERSTITIAL_COOLDOWN_MS;

      if (!allowed) {
        adAllowedRef.current = false;
        after();
        return;
      }

      const ready = await waitAdsReady(1000);
      if (!ready) {
        adAllowedRef.current = false;
        after();
        return;
      }

      const ad = createInterstitial();

      let done = false;
      const runOnce = () => {
        if (done) return;
        if (interstitialTokenRef.current !== token) return;
        done = true;
        cleanup();
        adAllowedRef.current = false;
        after();
      };

      let unsubClosed: any = null;
      let unsubLoaded: any = null;
      let unsubError: any = null;

      const cleanup = () => {
        try {
          unsubClosed?.();
        } catch {}
        try {
          unsubLoaded?.();
        } catch {}
        try {
          unsubError?.();
        } catch {}
        unsubClosed = null;
        unsubLoaded = null;
        unsubError = null;

        if (interstitialTimerRef.current) clearTimeout(interstitialTimerRef.current);
        interstitialTimerRef.current = null;

        interstitialCleanupRef.current = null;
      };

      interstitialCleanupRef.current = cleanup;

      unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, runOnce);
      unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
        if (interstitialTokenRef.current !== token) return;
        if (!adAllowedRef.current) return;

        try {
          ad.show();
          lastInterstitialAtRef.current = Date.now();
        } catch {
          runOnce();
        }
      });
      unsubError = ad.addAdEventListener(AdEventType.ERROR, runOnce);

      try {
        ad.load();
      } catch {
        runOnce();
        return;
      }

      interstitialTimerRef.current = setTimeout(runOnce, 1500);
    },
    [isPremium]
  );

  const beginCall = async (ws: SignalClient, rid: string, caller: boolean, qTok: number) => {
    if (queueTokenRef.current !== qTok) return;
    if (wsRef.current !== ws) return;

    beginCallReqRef.current = null;
    if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
    peerReadyTimerRef.current = null;

    if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
    webrtcConnectTimerRef.current = null;
    webrtcConnectedRef.current = false;

    if (beginCallGuardRef.current) return;
    beginCallGuardRef.current = true;

    const tokenNow = callStartTokenRef.current + 1;
    callStartTokenRef.current = tokenNow;

    try {
      if (!beautyOpenRef.current && !beautyOpeningIntentRef.current) {
        clearLocalPreviewStream();
      }

      setChatReady(false);
      setChatInput("");
      setChatMessages([]);
      setChatFeedVisible(false);
      resetChatFeedAnimations();
      chatOpenPendingRef.current = false;
      chatComposerOpenRef.current = false;
      chatIgnoreHideUntilRef.current = 0;
      chatInputRef.current?.blur?.();
      setChatComposerOpen(false);
      clearChatHideTimer();
      chatSeqRef.current = 0;
      clearSwipeGuideTimer();
      clearSwipeGuideFlipTimer();
      setShowSwipeGuide(false);
      setSwipeGuideFrame(0);
      swipeGuideCamOpenPrevRef.current = false;

      const rtc = new WebRTCSession({
        onLocalStream: (s) => {
          if (queueTokenRef.current !== qTok) return;
          localStreamRef.current = s as any;
          setLocalStreamURL(s.toURL());
        },
        onRemoteStream: (s) => {
          if (queueTokenRef.current !== qTok) return;
          remoteStreamRef.current = s as any;

          try {
            const tracks = ((s as any)?.getAudioTracks?.() ?? []) as any[];
            tracks.forEach((t: any) => {
              t.enabled = !Boolean(remoteMutedRef.current);
            });
          } catch {}

          setRemoteStreamURL(s.toURL());
          if (phaseRef.current === "matched") {
            setReMatchText("");
            runMatchRevealTransition(() => {
              if (queueTokenRef.current !== qTok) return;
              if (phaseRef.current !== "matched") return;
              setPhase("calling");
            });
          }
        },
        onIceCandidate: (c) => ws.sendIce(rid, c),

        onAnswer: (sdp) => ws.sendAnswer(rid, sdp),
        onOffer: (sdp) => ws.sendOffer(rid, sdp),
        onDataChannelOpen: () => {
          if (queueTokenRef.current !== qTok) return;
          setChatReady(true);
        },
        onDataChannelClose: () => {
          if (queueTokenRef.current !== qTok) return;
          setChatReady(false);
        },
        onDataMessage: (message) => {
          if (queueTokenRef.current !== qTok) return;
          appendChatMessage(false, message);
        },
        onConnectionState: (s) => {
          const st = String(s || "").toLowerCase();

          if (st === "connected") {
            if (queueTokenRef.current !== qTok) return;
            webrtcConnectedRef.current = true;
            if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
            webrtcConnectTimerRef.current = null;
            clearWebrtcDownTimer();
            if ((phaseRef.current === "matched" || phaseRef.current === "calling") && matchedSignalTokenRef.current !== qTok) {
              matchedSignalTokenRef.current = qTok;
              try {
                useAppStore.getState().setCallMatchedSignal(Date.now());
              } catch {}
            }
            return;
          }

          if (st === "failed" || st === "disconnected" || st === "closed") {
            const tokenNow = webrtcDownTokenRef.current + 1;
            webrtcDownTokenRef.current = tokenNow;

            if (webrtcDownTimerRef.current) clearTimeout(webrtcDownTimerRef.current);
            webrtcDownTimerRef.current = setTimeout(() => {
              if (webrtcDownTokenRef.current !== tokenNow) return;
              if (phaseRef.current !== "calling") return;
              if (queueTokenRef.current !== qTok) return;

              suppressEndRelayRef.current = true;
              endCallAndRequeue("remote_left");
            }, 500);

            return;
          }
        },
      });

      rtcRef.current = rtc;
      await rtc.start({ isCaller: caller });

      if (callStartTokenRef.current !== tokenNow) {
        try {
          rtc.stop();
        } catch {}
        return;
      }

      try {
        const pending = pendingSignalRef.current.splice(0);
        for (const p of pending) {
          if (p.type === "offer") {
            await rtcRef.current?.handleRemoteOffer(p.sdp);
          } else if (p.type === "answer") {
            await rtcRef.current?.handleRemoteAnswer(p.sdp);
          } else if (p.type === "ice") {
            await rtcRef.current?.handleRemoteIce(p.candidate);
          }
        }
      } catch {}

      try {
        rtcRef.current?.setLocalVideoEnabled(Boolean(myCamOnRef.current));
      } catch {}
      try {
        rtcRef.current?.setLocalAudioEnabled(Boolean(mySoundOnRef.current));
      } catch {}

      setReMatchText("");

      if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
      webrtcConnectTimerRef.current = setTimeout(() => {
        if (queueTokenRef.current !== qTok) return;
        if (callStartTokenRef.current !== tokenNow) return;
        if (webrtcConnectedRef.current) return;

        suppressEndRelayRef.current = true;
        endCallAndRequeue("disconnect");
      }, 4000);

      try {
        const camEnabled = Boolean(myCamOnRef.current);
        ws.sendCamState(rid, camEnabled);
        ws.relay(rid, { type: "cam", enabled: camEnabled });
      } catch {}

      if (!isPremium) {
        if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
        limitTimerRef.current = setTimeout(() => {
          setRemoteVideoAllowed(false);
          setLimitModal(true);
        }, FREE_CALL_LIMIT_MS);
      }
    } catch (e) {
      if (callStartTokenRef.current !== tokenNow) return;

      useAppStore.getState().showGlobalModal(t("call.error_title"), t("call.error_start"));
      try {
        ws.leaveRoom(rid);
      } catch {}
      endCallAndRequeue("error");
    }
  };

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

const startQueue = (resetMatchingActions = false) => {
  if (queueRunningRef.current) return;
  queueRunningRef.current = true;
  enqueuedRef.current = false;

  const qTok = queueTokenRef.current + 1;
  queueTokenRef.current = qTok;

  myPeerInfoNonceRef.current = `${Date.now()}_${Math.random().toString(16).slice(2)}`;

  if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
  peerReadyTimerRef.current = null;
  beginCallReqRef.current = null;

  if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
  webrtcConnectTimerRef.current = null;
  webrtcConnectedRef.current = false;

  suppressEndRelayRef.current = false;

  // WebSocket 연결 여부를 체크하는 조건 제거 (매칭이 정상적으로 진행되도록)
  if (wsRef.current) {
    try {
      wsRef.current.close();
    } catch {}
    wsRef.current = null;
  }

  manualCloseRef.current = false;
  clearReconnectTimer();
  clearWebrtcDownTimer();

  noMatchShownThisCycleRef.current = false;
  setFastMatchHint(false);

  const st: any = useAppStore.getState?.() ?? {};
  const prefsNow = st.prefs ?? {};
  const queueCountry = String(prefsNow.country || "");
  const queueGender = String(prefsNow.gender || "");

  if (!(queueCountry.length > 0 && queueGender.length > 0)) {
    useAppStore.getState().showGlobalModal(t("call.match_title"), t("call.match_filter_missing"));
    queueRunningRef.current = false;
    navigation.goBack();
    return;
  }

  const tokenNow = String(useAppStore.getState().auth.token ?? "").trim();
  if (!tokenNow) {
    queueRunningRef.current = false;

    if (authBootInFlightRef.current) return;
    authBootInFlightRef.current = true;

    setAuthBooting(true);

    (async () => {
      try {
        await bootstrapDeviceBinding();

        const tokenAfter = String(useAppStore.getState().auth.token ?? "").trim();
        if (!tokenAfter) {
          useAppStore.getState().showGlobalModal(t("auth.title"), "TOKEN_EMPTY");
          navigation.goBack();
          return;
        }

        if (manualCloseRef.current) return;
        setAuthBooting(false);
        startQueue(resetMatchingActions);
      } catch (e) {
        const m = typeof e === "object" && e && "message" in (e as any) ? String((e as any).message) : String(e);
        useAppStore.getState().showGlobalModal(t("auth.title"), m || "BIND_FAILED");
        navigation.goBack();
      } finally {
        authBootInFlightRef.current = false;
      }
    })();

    return;
  }

  setAuthBooting(false);

  if (resetMatchingActions) {
    setMatchingActionsVisible(false);
  }
  setNoMatchModal(false);
  setPhase("connecting");
  startMatchingActionsTimer(resetMatchingActions);

  const ws = new SignalClient({
    onOpen: () => {
      if (wsRef.current !== ws) return;
      if (queueTokenRef.current !== qTok) return;

      setSignalUnstable(false);
      reconnectAttemptRef.current = 0;

      setPhase("queued");
      if (enqueuedRef.current) return;
      enqueuedRef.current = true;
      startNoMatchTimer();
      ws.enqueue(queueCountry, queueGender);
    },
    onClose: () => {
      if (wsRef.current !== ws) return;
      if (queueTokenRef.current !== qTok) return;

      if (manualCloseRef.current) return;

      if (phaseRef.current === "calling") {
        suppressEndRelayRef.current = true;
        endCallAndRequeue("remote_left");
        return;
      }

      if (queueRunningRef.current) {
        endCallAndRequeue("disconnect");
      }
    },
    onMessage: async (msg: SignalMessage) => {
  if (wsRef.current !== ws) return;
  if (queueTokenRef.current !== qTok) return;

  if (msg.type === "signal") {
    const d: any = (msg as any).data;
    const sigType = String(d?.type ?? d?.kind ?? "").toLowerCase();

    if (sigType === "peer_info") {
      if (String(d?.nonce ?? "") === String(myPeerInfoNonceRef.current)) return;

      setPeerInfo(d);

      const req = beginCallReqRef.current;
      if (req && req.ws === ws && req.rid === (msg as any).roomId && req.qTok === qTok) {
        beginCallReqRef.current = null;
        if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
        peerReadyTimerRef.current = null;
        beginCall(ws, req.rid, req.caller, req.qTok);
      }

      return;
    }

    if (sigType === "cam_state" || sigType === "cam") {
      setRemoteCamOn(Boolean(d?.enabled ?? d?.on ?? d?.camOn ?? d?.videoEnabled ?? d?.videoOn));
      return;
    }

    return;
  }

  if (msg.type === "peer_cam") {
    setRemoteCamOn(Boolean((msg as any).enabled));
    return;
  }

  if (msg.type === "queued") {
    if (phaseRef.current === "matched" || phaseRef.current === "calling") return;
    const wasQueued = phaseRef.current === "queued";
    setPhase("queued");
    // Keep existing timers running so repeated `queued` messages do not postpone modals forever.
    if (!wasQueued) {
      if (!noMatchTimerRef.current) {
        startNoMatchTimer();
      }
    }
    return;
  }
  if (msg.type === "match") {
    const rid = String(msg.roomId || "").trim();
    if (!rid) return;

    if (!queueRunningRef.current) {
      return;
    }

    if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") {
      return;
    }

    clearNoMatchTimer();
    // Do not reset waiting deadline or hide modal on transient match state.
    clearMatchingActionsTimer(false);
    if (!beautyOpenRef.current && !beautyOpeningIntentRef.current) {
      clearLocalPreviewStream();
    }
    setNoMatchModal(false);
    setFastMatchHint(false);
    setReMatchText("");
    setPhase("matched");
    queueRunningRef.current = false;
    enqueuedRef.current = false;
    setRoomId(rid);
    setIsCaller(Boolean(msg.isCaller));
    try {
      ws.relay(rid, {
        type: "peer_info",
        nonce: myPeerInfoNonceRef.current,
        country: myCountryRaw,
        language: myLangRaw,
        gender: myGenderRaw,
        flag: myFlag,
      });
    } catch {}

    beginCallReqRef.current = { ws, rid, caller: Boolean(msg.isCaller), qTok };

    if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
    peerReadyTimerRef.current = setTimeout(() => {
      if (wsRef.current !== ws) return;
      if (queueTokenRef.current !== qTok) return;
      const req = beginCallReqRef.current;
      if (!req || req.rid !== rid) return;

      suppressEndRelayRef.current = true;
      endCallAndRequeue("disconnect");
    }, 1500);

    return;
  }
  if (msg.type === "end") {
    queueRunningRef.current = false;
    manualCloseRef.current = true;
    if (phaseRef.current === "calling") {
      endCallAndRequeue("remote_left");
    } else {
      endCallAndRequeue("disconnect");
    }
    clearWebrtcDownTimer();
    webrtcDownTokenRef.current += 1;
    rtcRef.current?.stop();
    return;
  }
  if ((msg as any).type === "offer") {
    if (rtcRef.current) {
      rtcRef.current.handleRemoteOffer((msg as any).sdp);
    } else {
      pendingSignalRef.current.push({ type: "offer", sdp: (msg as any).sdp });
    }
    return;
  }
  if ((msg as any).type === "answer") {
    if (rtcRef.current) {
      rtcRef.current.handleRemoteAnswer((msg as any).sdp);
    } else {
      pendingSignalRef.current.push({ type: "answer", sdp: (msg as any).sdp });
    }
    return;
  }
  if ((msg as any).type === "ice") {
    if (rtcRef.current) {
      rtcRef.current.handleRemoteIce((msg as any).candidate);
    } else {
      pendingSignalRef.current.push({ type: "ice", candidate: (msg as any).candidate });
    }
    return;
  }
  if ((msg as any).type === "cam") {
    setRemoteCamOn(Boolean((msg as any).enabled));
    return;
  }
},
  });

  wsRef.current = ws;

  ws.connect(APP_CONFIG.SIGNALING_URL, tokenNow);
};

  const toggleCam = () => {
    const next = !myCamOn;
    setMyCamOn(next);
    rtcRef.current?.setLocalVideoEnabled(next);

    try {
      if (roomId) {
        wsRef.current?.sendCamState(roomId, next);
        wsRef.current?.relay(roomId, { type: "cam", enabled: next });
      }
    } catch {}
  };

  const toggleSound = () => {
    const next = !mySoundOn;
    setMySoundOn(next);
    rtcRef.current?.setLocalAudioEnabled(next);
  };

  const toggleRemoteMute = () => {
    const next = !Boolean(remoteMutedRef.current);
    remoteMutedRef.current = next;
    setRemoteMuted(next);

    try {
      const s: any = remoteStreamRef.current;
      const tracks = (s?.getAudioTracks?.() ?? []) as any[];
      tracks.forEach((t: any) => {
        t.enabled = !next;
      });
    } catch {}
  };


  const purchase = async () => {
    await purchasePremium();
    await refreshSubscription();
    const nowPremium = useAppStore.getState().sub.isPremium;
    if (nowPremium) {
      setUpgradeModal(false);
      setLimitModal(false);
      setRemoteVideoAllowed(true);
      if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
      limitTimerRef.current = null;
    }
  };

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

  const endCall = () => {
    const go = () => endCallAndRequeue("find_other");

    try {
      wsRef.current?.leaveRoom(roomId || "");
    } catch {}
    try {
      wsRef.current?.close();
    } catch {}

    showInterstitialIfAllowed(go);
  };

  const retry = () => {
    setMatchingActionsVisible(false);
    setNoMatchModal(false);
    endCallAndRequeue("disconnect");
  };

  const dismissNoMatch = () => {
    if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
    premiumNoMatchAutoCloseRef.current = null;
    setNoMatchModal(false);
  };

  const dismissMatchingActions = useCallback(() => {
    setMatchingActionsVisible(false);
    if (!isScreenFocusedRef.current) return;
    if (!beautyOpenRef.current && (phaseRef.current === "connecting" || phaseRef.current === "queued" || phaseRef.current === "ended")) {
      startMatchingActionsTimer(true);
    }
  }, []);

  const onPressMatchingBeauty = useCallback(async () => {
    clearMatchingActionsTimer();
    setMatchingActionsVisible(false);
    setMyCamOn(true);
    beautyOpeningIntentRef.current = true;
    openBeauty();
    const ok = await ensureLocalPreviewStream();
    if (!ok) {
      beautyOpeningIntentRef.current = false;
      setBeautyOpen(false);
      return;
    }
  }, [clearMatchingActionsTimer, ensureLocalPreviewStream, openBeauty]);

  const onPressMatchingFortune = useCallback(() => {
    setMatchingActionsVisible(false);
    navigation.navigate("Fortune");
  }, [navigation]);

  const onPressMatchingGame = useCallback(() => {
    setMatchingActionsVisible(false);
    navigation.navigate("Dino");
  }, [navigation]);

  const onPressFindOther = useCallback(() => {
    adAllowedRef.current = true;

    const go = () => {
      try {
        wsRef.current?.leaveRoom(roomId || "");
      } catch {}
      endCallAndRequeue("find_other");
    };

    showInterstitialIfAllowed(go);
  }, [roomId, showInterstitialIfAllowed]);

  const swipeRefreshPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          if (phaseRef.current !== "calling") return false;
          if (chatComposerOpen) return false;

          const dx = Number(gestureState.dx || 0);
          const dy = Number(gestureState.dy || 0);
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);

          return dx < -18 && absDx > absDy + 10;
        },
        onPanResponderRelease: (_, gestureState) => {
          if (phaseRef.current !== "calling") return;
          if (chatComposerOpen) return;

          const dx = Number(gestureState.dx || 0);
          const dy = Number(gestureState.dy || 0);
          const vx = Number(gestureState.vx || 0);
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          const horizontal = absDx > absDy + 14;
          const passed = dx <= -90 || (dx <= -60 && vx <= -0.42);
          if (!horizontal || !passed) return;

          const now = Date.now();
          if (now - lastSwipeRefreshAtRef.current < 1200) return;
          lastSwipeRefreshAtRef.current = now;
          onPressFindOther();
        },
      }),
    [chatComposerOpen, onPressFindOther]
  );

  const updatePref = useCallback((field: string, value: any) => {
    const st: any = useAppStore.getState?.() ?? {};
    const setPrefs = st.setPrefs;
    const setPref = st.setPref;
    const setPrefsField = st.setPrefsField;

    if (typeof setPrefs === "function") {
      setPrefs({ [field]: value });
    } else if (typeof setPref === "function") {
      setPref(field, value);
    } else if (typeof setPrefsField === "function") {
      setPrefsField(field, value);
    } else {
      showGlobalModal(t("common.settings"), t("setting.save_handler_missing", { field }));
    }
  }, [showGlobalModal, t]);

  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ key: code, label: getLanguageName(t, code) })),
    [t]
  );

  const countryOptions = useMemo(
    () => COUNTRY_CODES.map((code) => ({ key: code, name: getCountryName(t, code) })),
    [t]
  );

  const genderOptions = useMemo(
    () => [
      { key: "male", label: t("gender.male") },
      { key: "female", label: t("gender.female") },
    ],
    [t]
  );

  const currentLanguageLabel = useMemo(() => {
    const cur = normalizeLanguageCode(String((prefs as any)?.language || ""));
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur || t("common.not_set");
  }, [languageOptions, prefs, t]);

  const currentCountryDisplay = useMemo(() => {
    const cur = String((prefs as any)?.country || "").toUpperCase();
    const found = countryOptions.find((x) => x.key === cur);
    const nm = found ? found.name : cur || t("common.not_set");
    const cc = found ? found.key : cur;
    const flag = countryCodeToFlagEmoji(cc);
    if (!cc) return nm;
    return `${flag ? flag + " " : ""}${nm} (${cc})`;
  }, [countryOptions, prefs, t]);

  const currentGenderLabel = useMemo(() => {
    const cur = String((prefs as any)?.gender || "");
    const found = genderOptions.find((x) => x.key === cur);
    return found ? found.label : cur || t("common.not_set");
  }, [genderOptions, prefs, t]);

  return (
    <View style={styles.root}>
      <CallBeautySheet visible={beautyOpen} onClose={closeBeauty} config={beautyConfig} onConfigChange={setBeautyConfig} />


      <View
        style={styles.stage}
        onLayout={(e) => setStageH(Math.round(e.nativeEvent.layout.height))}
      >
        <View style={styles.overlayStage} {...(phase === "calling" ? swipeRefreshPanResponder.panHandlers : {})}>
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
                            zOrder={LOCAL_VIDEO_Z_ORDER}
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
                    { top: localAreaTop + 8, opacity: chatFeedOpacityRef.current },
                  ]}
                >
                  {chatMessages.map((item, idx) => {
                    const distanceFromNewest = chatMessages.length - 1 - idx;
                    const isNewest = distanceFromNewest === 0;
                    const baseOpacity = distanceFromNewest === 0 ? 1 : Math.max(0.26, 0.82 - distanceFromNewest * 0.20);
                    const hideStart = Math.min(0.62, distanceFromNewest * 0.16);
                    const hideEnd = Math.min(0.96, hideStart + 0.34);
                    const hideOpacity = chatFeedHideProgressRef.current.interpolate({
                      inputRange: [0, hideStart, hideEnd, 1],
                      outputRange: [1, 1, 0, 0],
                      extrapolate: "clamp",
                    });
                    const rowOpacity = Animated.multiply(
                      chatFeedOpacityRef.current,
                      Animated.multiply(hideOpacity, baseOpacity)
                    );
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
                    stageH > 0 ? { bottom: localCallingHeight } : { bottom: OVERLAY_LOCAL_HEIGHT_CALLING },
                  ]}
                />
              ) : null}
            </View>
          ) : null}

          {!beautyOpen ? (
            <View style={styles.remoteLayer} pointerEvents="none">
  <View style={[styles.remoteArea, showLocalOverlay ? (stageH > 0 ? { bottom: remoteBottom } : { bottom: OVERLAY_LOCAL_HEIGHT_CALLING }) : { bottom: 0 }]}>
    {remoteStreamURL && remoteVideoAllowed && remoteCamOn ? (
      <RTCView streamURL={remoteStreamURL} style={styles.remoteVideo} objectFit="cover" zOrder={REMOTE_VIDEO_Z_ORDER} />
    ) : (
      <View style={styles.placeholder}>
        {phase === "calling" && !remoteVideoAllowed ? (
          <AppText style={styles.placeholderText}>{t("call.free_time_over")}</AppText>
        ) : phase === "calling" && !remoteCamOn ? (
          <Ionicons name="videocam-off" size={54} color="rgba(255, 255, 255, 0.92)" />
        ) : null}
      </View>
    )}

    {phase === "calling" && (peerInfoText || signalUnstable) ? (
      <View pointerEvents="none" style={[styles.remoteInfoDock, { top: insets.top + 10 }]}>
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
              source={swipeGuideFrame === 0 ? require("../../assets/swipe.png") : require("../../assets/swipe2.png")}
              style={styles.swipeGuideImage}
              resizeMode="contain"
            />
          </View>
        ) : null}


        {!isPremium && phase !== "calling" ? (
          <View style={[styles.queueAdDock, { top: insets.top + 55 }]}>
            <QueueNativeAd256x144 />
          </View>
        ) : null}

        {phase !== "calling" ? (
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
                    <RTCView streamURL={remoteStreamURL} style={styles.matchRevealVideo} objectFit="cover" zOrder={REMOTE_VIDEO_Z_ORDER} />
                  </View>
                  <View style={[styles.matchRevealPiece, styles.matchRevealLobeRight]}>
                    <RTCView streamURL={remoteStreamURL} style={styles.matchRevealVideo} objectFit="cover" zOrder={REMOTE_VIDEO_Z_ORDER} />
                  </View>
                  <View style={[styles.matchRevealPiece, styles.matchRevealBottomDiamond]}>
                    <RTCView
                      streamURL={remoteStreamURL}
                      style={styles.matchRevealVideoDiamond}
                      objectFit="cover"
                      zOrder={REMOTE_VIDEO_Z_ORDER}
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
        ) : null}


        {phase === "calling" ? (
          <View pointerEvents="box-none" style={[styles.controlsOverlay, { bottom: controlsBottom }]}>
            <View style={styles.controlsRow}>
              <Pressable onPress={openBeauty} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name="color-wand" size={22} color="#f3cddb" />
              </Pressable>
              

              <Pressable onPress={toggleCam} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name={myCamOn ? "videocam" : "videocam-off"} size={22} color="#f3cddb" />
              </Pressable>

              <Pressable onPress={toggleSound} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name={mySoundOn ? "mic" : "mic-off"} size={22} color="#f3cddb" />
              </Pressable>

              <Pressable onPress={toggleRemoteMute} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name={remoteMuted ? "volume-mute" : "volume-high"} size={22} color="#f3cddb" />
              </Pressable>

              <Pressable
                onPressIn={openChatComposer}
                onPress={onPressChatControl}
                style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}
              >
                <Ionicons name="chatbubble-ellipses" size={21} color="#f3cddb" />
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {phase === "calling" ? (
        <View
          pointerEvents={chatComposerOpen ? "auto" : "none"}
          style={[styles.chatComposerOverlay, chatComposerOpen ? null : styles.chatComposerOverlayHidden]}
        >
          <View style={styles.chatComposerModalBackdrop}>
            <Pressable style={styles.chatComposerBackdropHit} onPress={onChatComposerBackdropPress} />
            <KeyboardAvoidingView
              behavior={Platform.OS === "ios" ? "padding" : "height"}
              keyboardVerticalOffset={0}
              style={styles.chatComposerModalWrap}
              pointerEvents="box-none"
            >
              <View
                style={[
                  styles.chatComposerDock,
                  { paddingBottom: Math.max(insets.bottom, 8) + 10 },
                  chatComposerOpen ? null : styles.chatComposerDockHidden,
                ]}
              >
                <View style={styles.chatInputRow}>
                  <TextInput
                    ref={chatInputRef}
                    style={styles.chatInput}
                    value={chatInput}
                    onChangeText={setChatInput}
                    placeholder={"메시지 입력"}
                    placeholderTextColor="rgba(255,255,255,0.45)"
                    returnKeyType="send"
                    onSubmitEditing={sendChat}
                    blurOnSubmit={false}
                    showSoftInputOnFocus
                    onFocus={() => {
                      chatOpenPendingRef.current = false;
                      chatKeyboardVisibleRef.current = true;
                    }}
                  />
                  <Pressable
                    onPress={sendChat}
                    style={({ pressed }) => [
                      styles.chatSendBtn,
                      pressed ? { opacity: 0.75 } : null,
                    ]}
                  >
                    <Ionicons name="send" size={18} color="#f3cddb" />
                  </Pressable>
                </View>
              </View>
            </KeyboardAvoidingView>
          </View>
        </View>
      ) : null}

      <View pointerEvents="box-none" style={styles.topUiLayer}>
        <Pressable
          onPress={onPressBack}
          hitSlop={14}
          style={({ pressed }) => [
            styles.backBtn,
            { top: insets.top + 8, left: 12 },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <Ionicons name="chevron-back" size={30} color="#fff" />
        </Pressable>
      </View>

      <AppModal
        visible={limitModal}
        title={t("call.limit_title")}
        dismissible={false}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("call.limit_premium")} onPress={() => setUpgradeModal(true)} />
            <PrimaryButton title={t("common.exit")} onPress={() => { stopAll(); goHome(); }} variant="ghost" />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: theme.colors.sub, lineHeight: 20 }}>
          {t("call.limit_message", { seconds: Math.round(FREE_CALL_LIMIT_MS / 1000) })}
        </AppText>
      </AppModal>

      <AppModal
        visible={upgradeModal}
        title={t("premium.title")}
        dismissible={true}
        onClose={() => setUpgradeModal(false)}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("premium.buy")} onPress={purchase} />
            <PrimaryButton title={t("common.close")} onPress={() => setUpgradeModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: theme.colors.sub, lineHeight: 20 }}>
          {t("premium.upgrade_desc")}
        </AppText>
      </AppModal>

      <AppModal
        visible={noMatchModal}
        title={isPremium ? t("call.fast_matching") : t("call.delay_matching")}
        dismissible={true}
        onClose={dismissNoMatch}
        footer={
          isPremium ? (
            <View style={{ gap: 10 }}>
              <PrimaryButton title={t("common.exit")} onPress={() => { stopAll(); goHome(); }} variant="ghost" />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <PrimaryButton title={t("common.retry")} onPress={retry} />
              <PrimaryButton title={t("common.exit")} onPress={() => { stopAll(); goHome(); }} variant="ghost" />
            </View>
          )
        }
      >
        {isPremium ? (
          <AppText style={{ fontSize: 16, color: theme.colors.sub, lineHeight: 20 }}>
            {t("call.fast_matching_desc")}
          </AppText>
        ) : (
          <AppText style={{ fontSize: 16, color: theme.colors.sub, lineHeight: 20 }}>
            {t("call.delay_matching_desc")}
          </AppText>
        )}
      </AppModal>

      <MatchingWaitActionsModal
        visible={matchingActionsVisible}
        title={t("call.waiting_actions_title")}
        description={t("call.waiting_actions_desc")}
        beautyLabel={t("call.waiting_actions_beauty")}
        fortuneLabel={t("call.waiting_actions_fortune")}
        gameLabel={t("call.waiting_actions_game")}
        closeLabel={t("common.close")}
        onPressBeauty={onPressMatchingBeauty}
        onPressFortune={onPressMatchingFortune}
        onPressGame={onPressMatchingGame}
        onClose={dismissMatchingActions}
      />

      <AppModal
        visible={prefsModal}
        title={t("common.settings")}
        dismissible={true}

        onClose={() => {
          setPrefsModal(false);
          setLangOpen(false);
          setCountryOpen(false);
          setGenderOpen(false);
        }}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("common.close")} onPress={() => setPrefsModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("setting.description")}</AppText>

        <AppText style={styles.sectionTitle}>{t("setting.country")}</AppText>

        <Pressable
          onPress={() => {
            setCountryOpen((v) => !v);
            setLangOpen(false);
            setGenderOpen(false);
          }}
          style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}
        >
          <AppText style={styles.dropdownBtnText}>{currentCountryDisplay}</AppText>
          <AppText style={styles.dropdownChevron}>{countryOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {countryOpen ? (
          <View style={styles.dropdownListWrap}>
            <ScrollView
              style={styles.dropdownScroll}
              contentContainerStyle={styles.dropdownScrollContent}
              showsVerticalScrollIndicator={true}
            >
              {countryOptions.map((opt) => {
                const active = String((prefs as any)?.country || "").toUpperCase() === opt.key;
                const flag = countryCodeToFlagEmoji(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      updatePref("country", opt.key);
                      setCountryOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.dropdownRow,
                      active ? styles.dropdownRowActive : null,
                      pressed ? { opacity: 0.75 } : null,
                    ]}
                  >
                    <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>
                      {flag ? `${flag} ` : ""}
                      {opt.name}
                    </AppText>

                    <View style={styles.countryRight}>
                      <AppText style={[styles.countryCode, active ? styles.countryCodeActive : null]}>({opt.key})</AppText>
                      {active ? <AppText style={styles.dropdownCheck}>✓</AppText> : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <AppText style={styles.sectionTitle}>{t("setting.language")}</AppText>

        <Pressable
          onPress={() => {
            setLangOpen((v) => !v);
            setCountryOpen(false);
            setGenderOpen(false);
          }}
          style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}
        >
          <AppText style={styles.dropdownBtnText}>{currentLanguageLabel}</AppText>
          <AppText style={styles.dropdownChevron}>{langOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {langOpen ? (
          <View style={styles.dropdownList}>
            {languageOptions.map((opt) => {
              const active = normalizeLanguageCode(String((prefs as any)?.language || "")) === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    updatePref("language", opt.key);
                    setLangOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.dropdownRow,
                    active ? styles.dropdownRowActive : null,
                    pressed ? { opacity: 0.75 } : null,
                  ]}
                >
                  <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>{opt.label}</AppText>
                  {active ? <AppText style={styles.dropdownCheck}>✓</AppText> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <AppText style={styles.sectionTitle}>{t("setting.gender")}</AppText>

        <Pressable
          onPress={() => {
            setGenderOpen((v) => !v);
            setCountryOpen(false);
            setLangOpen(false);
          }}
          style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}
        >
          <AppText style={styles.dropdownBtnText}>{currentGenderLabel}</AppText>
          <AppText style={styles.dropdownChevron}>{genderOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {genderOpen ? (
          <View style={styles.dropdownList}>
            {genderOptions.map((opt) => {
              const active = String((prefs as any)?.gender || "") === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    updatePref("gender", opt.key);
                    setGenderOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.dropdownRow,
                    active ? styles.dropdownRowActive : null,
                    pressed ? { opacity: 0.75 } : null,
                  ]}
                >
                  <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>{opt.label}</AppText>
                  {active ? <AppText style={styles.dropdownCheck}>✓</AppText> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <AppText style={styles.sectionTitle}>{t("setting.font_size")}</AppText>
        <AppText style={styles.modalText}>{t("setting.font_size_desc", { percent: Math.round(fontScale * 100) })}</AppText>
        <FontSizeSlider value={fontScale} onChange={setFontScale} />
      </AppModal>
    </View>
  );
}

const W = Dimensions.get("window").width;

const REMOTE_VIDEO_SCALE = 1.22;
const REMOTE_SHIFT_Y = 0;
const REMOTE_VIDEO_Z_ORDER = 0;
const LOCAL_VIDEO_Z_ORDER = 1;

const LOCAL_CROP_Y = 0;
const LOCAL_OVERLAY_RADIUS = 25;
const LOCAL_OUTER_SHADOW_HEIGHT = 60;

const OVERLAY_LOCAL_HEIGHT_CALLING = "45%";


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },

  stage: { flex: 1, position: "relative", backgroundColor: "#000" },

  overlayStage: { flex: 1 },

  localLayer: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 30,
  elevation: 30,
},

localAreaShadow: {
  position: "absolute",
  left: 0,
  right: 0,
  height: "50%",
  backgroundColor: "transparent",
  overflow: "hidden",
  zIndex: 3,
  borderTopLeftRadius: LOCAL_OVERLAY_RADIUS,
  borderTopRightRadius: LOCAL_OVERLAY_RADIUS,
},

localTopShadowGradient: {
  position: "absolute",
  left: 0,
  right: 0,
  height: LOCAL_OUTER_SHADOW_HEIGHT,
  overflow: "hidden",
  zIndex: 4,
  transform: [{ translateY: 0 }],
},

localArea: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "#000000",
  overflow: "hidden",
  borderTopLeftRadius: LOCAL_OVERLAY_RADIUS,
  borderTopRightRadius: LOCAL_OVERLAY_RADIUS,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderLeftWidth: StyleSheet.hairlineWidth,
  borderRightWidth: StyleSheet.hairlineWidth,
  borderColor: "rgba(255,255,255,0.16)",
},

localAreaCalling: {
  height: OVERLAY_LOCAL_HEIGHT_CALLING,
},

  remoteLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    elevation: 10,
  },

  remoteArea: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    borderRadius: 0,
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: "#000",
    overflow: "hidden",
  },

  remoteVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    transform: [{ scale: REMOTE_VIDEO_SCALE }, { translateY: REMOTE_SHIFT_Y }],
  },

  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  placeholderText: { fontSize: 14, color: "rgba(255,255,255,0.75)", fontWeight: "700" },

  backBtn: {
    position: "absolute",
    zIndex: 120,
    elevation: 120,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.16)",
  },

  topUiLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 140,
    elevation: 140,
  },

  remoteInfoDock: {
    position: "absolute",
    top: 0,
    right: 12,
    alignItems: "flex-end",
    justifyContent: "center",
    zIndex: 50,
    elevation: 50,
    gap: 3,
  },

  remoteInfoText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "700",
  },

  remoteInfoSubText: {
    color: "rgba(255, 170, 170, 0.92)",
    fontSize: 11,
    fontWeight: "700",
  },

  localViewport: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    overflow: "hidden",
  },

  localVideoMover: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ translateY: -LOCAL_CROP_Y }],
  },

  localVideoFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    transform: [{ scale: 1 }],
  },

  localEmptyFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },

  localCamOffBgFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },

  camOffOverlayFull: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },

  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  matchRevealBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  matchRevealHeartWrap: {
    position: "absolute",
    width: 164,
    height: 150,
    alignItems: "center",
    justifyContent: "center",
  },
  matchRevealPiece: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: "#000",
  },
  matchRevealLobeLeft: {
    left: 22,
    top: 0,
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  matchRevealLobeRight: {
    left: 78,
    top: 0,
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  matchRevealBottomDiamond: {
    left: 36,
    top: 30,
    width: 92,
    height: 92,
    borderRadius: 16,
    transform: [{ rotate: "45deg" }],
  },
  matchRevealVideo: {
    ...StyleSheet.absoluteFillObject,
  },
  matchRevealVideoDiamond: {
    ...StyleSheet.absoluteFillObject,
    transform: [{ rotate: "-45deg" }, { scale: 1.42 }],
  },
  matchRevealHeartGlow: {
    position: "absolute",
    top: -16,
    textShadowColor: "rgba(255, 214, 236, 0.9)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  matchRevealHeartFill: {
    position: "absolute",
    top: 2,
    textShadowColor: "rgba(255, 240, 248, 0.75)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },

  centerTextDock: {
    position: "absolute",
    left: 18,
    right: 18,
    top: "50%",
    marginTop: 52,
    minHeight: 72,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  centerText: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 24,
  },

  reMatchTextWrap: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
  },

  reMatchTextTop: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 24,
  },

  reMatchTextBottom: {
    textAlign: "center",
    fontSize: 24,
    fontWeight: "800",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 28,
    marginTop: 4,
  },

  queueAdDock: {
    position: "absolute",
    zIndex: 11,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  swipeGuideDock: {
    position: "absolute",
    right: 8,
    top: "50%",
    transform: [{ translateY: -56 }],
    zIndex: 115,
    elevation: 115,
  },
  swipeGuideImage: {
    width: 112,
    height: 112,
    opacity: 0.94,
  },

  nativeAd256: {
    width: 360,
    height: 202,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  nativeAdInner: {
    flex: 1,
  },
  nativeAdMedia: {
    flex: 1,
  },
  nativeAdFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.55)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  nativeAdHeadline: {
    flex: 1,
    fontSize: 12,
    color: "rgba(255,255,255,0.92)",
    fontWeight: "800",
  },
  nativeAdTag: {
    fontSize: 11,
    color: "rgba(255,255,255,0.75)",
    fontWeight: "900",
  },

  controlsOverlay: {
    position: "absolute",
    zIndex: 160,
    elevation: 160,
    left: 0,
    right: 0,
    alignItems: "center",
  },

  chatFeedUnderShadow: {
    position: "absolute",
    top: 0,
    left: 12,
    right: 12,
    height: 78,
    justifyContent: "flex-end",
    gap: 6,
    overflow: "visible",
    zIndex: 65,
    elevation: 65,
  },
  chatFeedRow: {
    width: "100%",
    flexDirection: "row",
  },
  chatFeedRowMine: {
    justifyContent: "flex-end",
  },
  chatFeedRowPeer: {
    justifyContent: "flex-start",
  },
  chatFeedBubble: {
    maxWidth: "84%",
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
  },
  chatFeedBubbleMine: {
    backgroundColor: "rgba(188, 74, 128, 0.56)",
    borderTopRightRadius: 6,
  },
  chatFeedBubblePeer: {
    backgroundColor: "rgba(255, 255, 255, 0.18)",
    borderTopLeftRadius: 6,
  },
  chatFeedText: {
    color: "#fff",
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "600",
  },
  chatFeedTextNewest: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
  },
  chatComposerDock: {
    width: "100%",
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  chatComposerDockHidden: {
    opacity: 0,
    transform: [{ translateY: 20 }],
  },
  chatComposerOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 120,
    elevation: 120,
  },
  chatComposerOverlayHidden: {
    opacity: 0,
  },
  chatComposerModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.01)",
  },
  chatComposerBackdropHit: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  chatComposerModalWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
  chatInputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  chatInput: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    paddingHorizontal: 12,
    color: "#fff",
    backgroundColor: "rgba(0, 0, 0, 0.52)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.24)",
  },
  chatSendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3f323770",
  },

  controlsRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    paddingHorizontal: 12,
  },

  controlBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3f323770",
  },
  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },

  dropdownBtn: {
    width: "100%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownBtnText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownChevron: { fontSize: 12, color: theme.colors.sub, fontWeight: "900" },

  dropdownList: {
    width: "100%",
    marginTop: 8,
    gap: 8,
  },

  dropdownListWrap: {
    width: "100%",
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  dropdownScroll: {
    maxHeight: 210,
  },
  dropdownScrollContent: {
    gap: 8,
  },

  dropdownRow: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownRowActive: {
    backgroundColor: theme.colors.cardSoft,
  },
  dropdownText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownTextActive: { color: theme.colors.pinkDeep },
  dropdownCheck: { fontSize: 14, color: theme.colors.pinkDeep, fontWeight: "900" },

  countryRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  countryCode: { fontSize: 12, color: theme.colors.sub, fontWeight: "800" },
  countryCodeActive: { color: theme.colors.pinkDeep },
});
