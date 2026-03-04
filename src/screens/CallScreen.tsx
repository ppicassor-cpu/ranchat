// FILE: C:\ranchat\src\screens\CallScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Animated, Easing, View, BackHandler, Pressable, Image, ScrollView, type ImageSourcePropType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer } from "expo-video";
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
import {
  POPTALK_CALL_COST_PER_SECOND,
  POPTALK_CHAT_COST_PER_MESSAGE,
  POPTALK_CHAT_TRANSLATE_RECEIVE_COST_PER_MESSAGE,
  POPTALK_LOW_WARNING_THRESHOLD,
  POPTALK_MATCH_BLOCK_THRESHOLD,
  POPTALK_REWARDED_AMOUNT,
  POPTALK_REFRESH_INTERVAL_MS,
} from "../constants/popTalkConfig";
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
import { getGiftById, getGiftDisplayName } from "../constants/giftCatalog";
import { fetchShopGiftInventory, fetchUnifiedWalletState, sendGiftOnServer, receiveGiftOnServer } from "../services/shop/ShopPurchaseService";
import { blockCallPeerOnServer, reportCallPeerOnServer } from "../services/call/CallSafetyService";
import { fetchCallBlockListOnServer } from "../services/call/CallBlockListService";
import { fetchMatchFilterOnServer, saveMatchFilterOnServer, normalizeMatchFilter, createDefaultMatchFilter, MATCH_FILTER_ALL, type MatchFilter, type MatchFilterGender } from "../services/call/MatchFilterService";
import { translatePeerChatOnServer } from "../services/translate/RealtimeTranslateService";
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageName, normalizeLanguageCode } from "../i18n/displayNames";
import { countryCodeToFlagEmoji } from "../utils/countryUtils";
import { isPopTalkUnlimited } from "../utils/poptalkDisplay";

type Props = NativeStackScreenProps<MainStackParamList, "Call">;

type Phase = "connecting" | "queued" | "matched" | "calling" | "ended";
type GiftFxMode = "send" | "receive";
type GiftFxEffect = "spark" | "float" | "shake" | "spin" | "rocket" | "pulse";
type GiftFxStage = "animating" | "notice";

type GiftFxPreset = {
  effect: GiftFxEffect;
  sendStartScale: number;
  sendEndScale: number;
  sendDurationMs: number;
  receivePopScale: number;
  receivePopDurationMs: number;
  noticeDurationMs: number;
};

type GiftFxState = {
  token: number;
  giftId: string;
  giftName: string;
  accent: string;
  mode: GiftFxMode;
  stage: GiftFxStage;
  image: ImageSourcePropType;
  noticeText: string;
};

type CallReportReason = {
  code: string;
  labelKey: string;
  descriptionKey: string;
};

const CALL_REPORT_REASONS: CallReportReason[] = [
  {
    code: "SEXUAL_EXPLICIT",
    labelKey: "call.report.reason.sexual.label",
    descriptionKey: "call.report.reason.sexual.desc",
  },
  {
    code: "MINOR_SAFETY_RISK",
    labelKey: "call.report.reason.minor.label",
    descriptionKey: "call.report.reason.minor.desc",
  },
  {
    code: "HARASSMENT_ABUSE",
    labelKey: "call.report.reason.harassment.label",
    descriptionKey: "call.report.reason.harassment.desc",
  },
  {
    code: "THREAT_OR_VIOLENCE",
    labelKey: "call.report.reason.threat.label",
    descriptionKey: "call.report.reason.threat.desc",
  },
  {
    code: "HATE_SPEECH",
    labelKey: "call.report.reason.hate.label",
    descriptionKey: "call.report.reason.hate.desc",
  },
  {
    code: "SCAM_OR_FRAUD",
    labelKey: "call.report.reason.scam.label",
    descriptionKey: "call.report.reason.scam.desc",
  },
  {
    code: "IMPERSONATION",
    labelKey: "call.report.reason.impersonation.label",
    descriptionKey: "call.report.reason.impersonation.desc",
  },
  {
    code: "SPAM_OR_AD",
    labelKey: "call.report.reason.spam.label",
    descriptionKey: "call.report.reason.spam.desc",
  },
  {
    code: "PRIVACY_VIOLATION",
    labelKey: "call.report.reason.privacy.label",
    descriptionKey: "call.report.reason.privacy.desc",
  },
  {
    code: "OTHER_POLICY",
    labelKey: "call.report.reason.other.label",
    descriptionKey: "call.report.reason.other.desc",
  },
];

const GIFT_IMG_ARROW = require("../../assets/gift/arrow.png");
const GIFT_IMG_BANANA_MILK = require("../../assets/gift/bananamilk.png");
const GIFT_IMG_BOUQUET = require("../../assets/gift/bouquest.png");
const GIFT_IMG_CAKE = require("../../assets/gift/cake.png");
const GIFT_IMG_CANDY = require("../../assets/gift/candy.png");
const GIFT_IMG_COTTON_CANDY = require("../../assets/gift/cottoncandy.png");
const GIFT_IMG_CRYSTAL_ROSE = require("../../assets/gift/crystalrose.png");
const GIFT_IMG_HEART_BALLOON = require("../../assets/gift/heartballoom.png");
const GIFT_IMG_ICE_CREAM = require("../../assets/gift/icecream.png");
const GIFT_IMG_KISS = require("../../assets/gift/lips.png");
const GIFT_IMG_LOVE_HEART = require("../../assets/gift/loveheart.png");
const GIFT_IMG_MAGIC_WAND = require("../../assets/gift/magicstick.png");
const GIFT_IMG_SEAL_STAMP = require("../../assets/gift/personalseal.png");
const GIFT_IMG_RING = require("../../assets/gift/ring.png");
const GIFT_IMG_ROSE = require("../../assets/gift/rose.png");
const GIFT_IMG_SUPERCAR = require("../../assets/gift/supercar.png");
const GIFT_IMG_TEDDY_BEAR = require("../../assets/gift/teddybear.png");
const GIFT_IMG_TOY_HAMMER = require("../../assets/gift/toyhammer.png");

const GIFT_IMAGE_BY_ID: Record<string, ImageSourcePropType> = {
  candy: GIFT_IMG_CANDY,
  banana_milk: GIFT_IMG_BANANA_MILK,
  ice_cream: GIFT_IMG_ICE_CREAM,
  rose: GIFT_IMG_ROSE,
  love_heart: GIFT_IMG_LOVE_HEART,
  cotton_candy: GIFT_IMG_COTTON_CANDY,
  toy_hammer: GIFT_IMG_TOY_HAMMER,
  birthday_cake: GIFT_IMG_CAKE,
  heart_balloon: GIFT_IMG_HEART_BALLOON,
  kiss: GIFT_IMG_KISS,
  arrow: GIFT_IMG_ARROW,
  crystal_rose: GIFT_IMG_CRYSTAL_ROSE,
  magic_wand: GIFT_IMG_MAGIC_WAND,
  teddy_bear: GIFT_IMG_TEDDY_BEAR,
  bouquet: GIFT_IMG_BOUQUET,
  ring: GIFT_IMG_RING,
  supercar: GIFT_IMG_SUPERCAR,
  seal_stamp: GIFT_IMG_SEAL_STAMP,
};

const GIFT_EFFECT_BY_ID: Record<string, GiftFxEffect> = {
  candy: "spark",
  banana_milk: "float",
  ice_cream: "pulse",
  rose: "float",
  love_heart: "pulse",
  cotton_candy: "spark",
  toy_hammer: "shake",
  birthday_cake: "pulse",
  heart_balloon: "float",
  kiss: "shake",
  arrow: "rocket",
  crystal_rose: "spark",
  magic_wand: "spin",
  teddy_bear: "pulse",
  bouquet: "float",
  ring: "spin",
  supercar: "rocket",
  seal_stamp: "shake",
};

const AI_REMOTE_VIDEO_FR = require("../../assets/ai_fr_female.mp4");
const AI_REMOTE_VIDEO_KR = require("../../assets/ai_kr_female.mp4");
const AI_ROOM_ID_PREFIX = "ai_room_";
const AI_FRENCH_CHAT_LINES = [
  "Salut, comment se passe ta journee ?",
  "Tu as mange quoi aujourd'hui ?",
  "Il fait beau chez toi en ce moment ?",
  "Tu ecoutes quel genre de musique ?",
  "Tu preferes le cafe ou le the ?",
  "Tu fais quoi d'habitude le week-end ?",
  "Tu regardes des series ces jours-ci ?",
  "Tu as un hobby prefere en ce moment ?",
  "Tu t'es leve tot aujourd'hui ?",
  "Quel est ton plat prefere ?",
];
const AI_KOREAN_CHAT_LINES = [
  "안녕, 오늘 하루는 어땠어?",
  "오늘 뭐 먹었어?",
  "요즘 날씨 어때?",
  "평소에 어떤 음악 들어?",
  "주말에는 보통 뭐 해?",
  "요즘 보는 드라마 있어?",
  "지금 가장 좋아하는 취미가 뭐야?",
  "오늘 일찍 일어났어?",
  "가장 좋아하는 음식이 뭐야?",
  "오늘 기분은 어때?",
];

type AiProfile = {
  key: string;
  country: string;
  language: string;
  gender: "female";
  peerSessionId: string;
  chatLines: string[];
};

const AI_PROFILES: AiProfile[] = [
  {
    key: "fr_female",
    country: "FR",
    language: "fr",
    gender: "female",
    peerSessionId: "ai_fr_female_bot",
    chatLines: AI_FRENCH_CHAT_LINES,
  },
  {
    key: "kr_female",
    country: "KR",
    language: "ko",
    gender: "female",
    peerSessionId: "ai_kr_female_bot",
    chatLines: AI_KOREAN_CHAT_LINES,
  },
];

type LocalAiRtcStub = {
  stop: () => void;
  sendChatMessage: (text: string) => boolean;
  setLocalVideoEnabled: (_enabled: boolean) => void;
  setLocalAudioEnabled: (_enabled: boolean) => void;
};

function createLocalAiRtcStub(): LocalAiRtcStub {
  return {
    stop: () => {},
    sendChatMessage: (text: string) => String(text || "").trim().length > 0,
    setLocalVideoEnabled: () => {},
    setLocalAudioEnabled: () => {},
  };
}

function colorWithAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, Number(alpha) || 0));
  const clean = String(hex || "").replace("#", "").trim();
  if (clean.length !== 6) return `rgba(255,255,255,${a})`;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return `rgba(255,255,255,${a})`;
  return `rgba(${r},${g},${b},${a})`;
}

export default function CallScreen({ navigation }: Props) {

  const insets = useSafeAreaInsets();
  const { t, currentLang } = useTranslation();
  const isScreenFocused = useIsFocused();

  const prefs = useAppStore((s) => s.prefs);
  const isPremium = useAppStore((s) => s.sub.isPremium);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const auth = useAppStore((s: any) => s.auth);
  const popTalk = useAppStore((s: any) => s.popTalk);
  const persistedCallCamOn = useAppStore((s: any) => Boolean((s?.ui as any)?.callCamOn ?? true));
  const persistedCallMicOn = useAppStore((s: any) => Boolean((s?.ui as any)?.callMicOn ?? true));
  const setAssets = useAppStore((s: any) => s.setAssets);
  const setShop = useAppStore((s: any) => s.setShop);
  const setCallMediaPrefs = useAppStore((s: any) => s.setCallMediaPrefs);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);
  const pendingGiftSend = useAppStore((s: any) => s.pendingGiftSend);
  const clearPendingGiftSend = useAppStore((s: any) => s.clearPendingGiftSend);
  const { refreshPopTalk, consumePopTalk, watchRewardedAdAndReward } = usePopTalk();

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);

  const [phase, setPhaseState] = useState<Phase>("connecting");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isCaller, setIsCaller] = useState(false);

  const [localStreamURL, setLocalStreamURL] = useState<string | null>(null);
  const [remoteStreamURL, setRemoteStreamURL] = useState<string | null>(null);

  const [remoteCamOn, setRemoteCamOn] = useState(true);
  const [remoteMuted, setRemoteMuted] = useState(false);
  const [aiCallActive, setAiCallActive] = useState(false);
  const [aiProfileIndex, setAiProfileIndex] = useState(0);

  const [myCamOn, setMyCamOn] = useState<boolean>(() => persistedCallCamOn);
  const [mySoundOn, setMySoundOn] = useState<boolean>(() => persistedCallMicOn);

  const [noMatchModal, setNoMatchModal] = useState(false);
  const [fastMatchHint, setFastMatchHint] = useState(false);
  const [matchingActionsVisible, setMatchingActionsVisible] = useState(false);
  const [queueNativeAdVisible, setQueueNativeAdVisible] = useState(false);

  const [reMatchText, setReMatchText] = useState<string>("");

  const [prefsModal, setPrefsModal] = useState(false);
  const [popTalkLowModal, setPopTalkLowModal] = useState(false);
  const [popTalkMatchBlockModal, setPopTalkMatchBlockModal] = useState(false);
  const [popTalkEmptyModal, setPopTalkEmptyModal] = useState(false);
  const [popTalkAdFailModal, setPopTalkAdFailModal] = useState(false);
  const [popTalkAdFailCount, setPopTalkAdFailCount] = useState(0);
  const [aiRestrictionNotice, setAiRestrictionNotice] = useState("");
  const [callSafetyMenuVisible, setCallSafetyMenuVisible] = useState(false);
  const [callReportModalVisible, setCallReportModalVisible] = useState(false);
  const [callReportReasonCode, setCallReportReasonCode] = useState<string>(CALL_REPORT_REASONS[0]?.code || "");
  const [callReportSubmitting, setCallReportSubmitting] = useState(false);
  const [callBlockSubmitting, setCallBlockSubmitting] = useState(false);
  const [liveTranslateEnabled, setLiveTranslateEnabled] = useState(false);
  const [translateUpsellModalVisible, setTranslateUpsellModalVisible] = useState(false);
  const [matchFilterModalVisible, setMatchFilterModalVisible] = useState(false);
  const [matchFilterUpsellModalVisible, setMatchFilterUpsellModalVisible] = useState(false);
  const [matchFilterDraft, setMatchFilterDraft] = useState<MatchFilter>(() => createDefaultMatchFilter());
  const [matchFilterLoading, setMatchFilterLoading] = useState(false);
  const [matchFilterSaving, setMatchFilterSaving] = useState(false);

  const wsRef = useRef<SignalClient | null>(null);
  const rtcRef = useRef<WebRTCSession | null>(null);
  const localStreamRef = useRef<any>(null);
  const previewStreamRef = useRef<any>(null);
  const previewOpeningRef = useRef(false);
  const remoteStreamRef = useRef<any>(null);
  const clearLocalPreviewStreamRef = useRef<() => void>(() => {});
  const callDebitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const aiChatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiRestrictionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callDebitInFlightRef = useRef(false);
  const popTalkLowPrevRef = useRef<number>(Number(popTalk?.balance ?? 0));
  const popTalkEmptyHandledRef = useRef(false);
  const popTalkChargeInProgressRef = useRef(false);
  const popTalkChargeGraceUntilRef = useRef(0);
  const restoreMatchingActionsOnNextFocusRef = useRef(false);

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
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const roomIdRef = useRef<string | null>(null);
  const peerSessionIdRef = useRef<string | null>(null);
  const myCamOnRef = useRef<boolean>(true);
  const mySoundOnRef = useRef<boolean>(true);
  const remoteMutedRef = useRef<boolean>(false);
  const isScreenFocusedRef = useRef<boolean>(true);
  const aiCallActiveRef = useRef(false);
  const aiMatchActionKeysRef = useRef<Set<string>>(new Set());
  const aiMatchLastActionAtRef = useRef(0);
  const aiMatchCountRef = useRef(0);
  const aiMatchActionQueueTokenRef = useRef(-1);
  const aiMatchInFlightRef = useRef(false);
  const aiCountedServerRoomRef = useRef<Set<string>>(new Set());

  function showAiRestrictionNotice(message: string) {
    const text = String(message || "").trim();
    if (!text) return;
    setAiRestrictionNotice(text);
    if (aiRestrictionNoticeTimerRef.current) {
      clearTimeout(aiRestrictionNoticeTimerRef.current);
      aiRestrictionNoticeTimerRef.current = null;
    }
    aiRestrictionNoticeTimerRef.current = setTimeout(() => {
      aiRestrictionNoticeTimerRef.current = null;
      setAiRestrictionNotice("");
    }, 2000);
  }

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
  const matchRevealDoneCallbacksRef = useRef<(() => void)[]>([]);
  const matchRevealCompletedRef = useRef(false);
  const mediaPrefsInitializedRef = useRef(false);
  const liveTranslateEnabledRef = useRef(false);
  const isPremiumRef = useRef(isPremium);
  const currentLangRef = useRef<string>(String(currentLang || "ko").trim().toLowerCase() || "ko");
  const translatePrefixRef = useRef<string>(String(t("call.translate.prefix") || "번역"));
  const authRef = useRef<any>(auth);
  const peerLanguageRef = useRef("");
  const appendChatMessageRef = useRef<(mine: boolean, message: string) => void>(() => {});
  const translateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const translateCacheRef = useRef<Map<string, string>>(new Map());
  const matchFilterRef = useRef<MatchFilter>(createDefaultMatchFilter());

  const [signalUnstable, setSignalUnstable] = useState(false);
  const [authBooting, setAuthBooting] = useState(true);
  const [matchRevealActive, setMatchRevealActive] = useState(false);
  const [giftFx, setGiftFx] = useState<GiftFxState | null>(null);
  const authBootInFlightRef = useRef(false);
  const giftFxScaleAnimRef = useRef(new Animated.Value(1));
  const giftFxOpacityAnimRef = useRef(new Animated.Value(0));
  const giftFxTranslateXAnimRef = useRef(new Animated.Value(0));
  const giftFxTranslateYAnimRef = useRef(new Animated.Value(0));
  const giftFxRotateAnimRef = useRef(new Animated.Value(0));
  const giftFxNoticeOpacityAnimRef = useRef(new Animated.Value(0));
  const giftFxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sentGiftDeliveryIdsRef = useRef<Set<string>>(new Set());
  const receivedGiftDeliveryIdsRef = useRef<Set<string>>(new Set());
  const aiChatLineCursorRef = useRef(0);
  const aiRemotePlayerFr = useVideoPlayer(AI_REMOTE_VIDEO_FR, (player) => {
    try {
      player.loop = true;
      player.muted = false;
    } catch {}
  });
  const aiRemotePlayerKr = useVideoPlayer(AI_REMOTE_VIDEO_KR, (player) => {
    try {
      player.loop = true;
      player.muted = false;
    } catch {}
  });
  const normalizedAiProfileIndex = useMemo(() => {
    if (!Number.isFinite(aiProfileIndex)) return 0;
    return Math.max(0, Math.min(Math.trunc(aiProfileIndex), AI_PROFILES.length - 1));
  }, [aiProfileIndex]);
  const activeAiProfile = useMemo(() => AI_PROFILES[normalizedAiProfileIndex] || AI_PROFILES[0], [normalizedAiProfileIndex]);
  const aiRemotePlayer = useMemo(
    () => (normalizedAiProfileIndex === 1 ? aiRemotePlayerKr : aiRemotePlayerFr),
    [aiRemotePlayerFr, aiRemotePlayerKr, normalizedAiProfileIndex]
  );

  const {
    adsReady,
    adsReadyRef,
    adAllowedRef,
    interstitialTokenRef,
    interstitialCleanupRef,
    interstitialTimerRef,
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
  const popTalkUnlimited = useMemo(
    () => isPopTalkUnlimited(popTalk),
    [popTalk?.balance, popTalk?.cap, popTalk?.plan]
  );

  const onBeforeSendChat = useCallback(
    async (_text: string) => {
      if (popTalkUnlimited) return true;
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
    [consumePopTalk, popTalkUnlimited, showGlobalModal, t]
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
    onSwipeRefreshCommitted,
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

  useEffect(() => {
    appendChatMessageRef.current = appendChatMessage;
  }, [appendChatMessage]);

  useEffect(() => {
    liveTranslateEnabledRef.current = liveTranslateEnabled;
  }, [liveTranslateEnabled]);

  useEffect(() => {
    isPremiumRef.current = isPremium;
    if (!isPremium) {
      setLiveTranslateEnabled(false);
      setMatchFilterModalVisible(false);
    }
  }, [isPremium]);

  useEffect(() => {
    currentLangRef.current = String(currentLang || "ko").trim().toLowerCase() || "ko";
  }, [currentLang]);

  useEffect(() => {
    translatePrefixRef.current = String(t("call.translate.prefix") || "번역").trim() || "번역";
  }, [currentLang, t]);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    peerLanguageRef.current = String((peerInfo as any)?.language || (peerInfo as any)?.lang || "").trim().toLowerCase();
  }, [peerInfo]);

  const consumeReceiveTranslateCost = useCallback(async () => {
    if (popTalkUnlimited) return true;
    const out = await consumePopTalk(
      POPTALK_CHAT_TRANSLATE_RECEIVE_COST_PER_MESSAGE,
      "chat_receive_translate",
      `${Date.now()}_${Math.random().toString(16).slice(2)}`
    );
    return Boolean(out.ok);
  }, [consumePopTalk, popTalkUnlimited]);

  const appendIncomingPeerChatMessage = useCallback((message: string) => {
    const rawText = String(message || "").trim();
    if (!rawText) return;

    translateQueueRef.current = translateQueueRef.current
      .then(async () => {
        const append = appendChatMessageRef.current;
        if (!isPremiumRef.current || !liveTranslateEnabledRef.current || rawText.startsWith("[GIFT]")) {
          append(false, rawText);
          return;
        }

        const targetLang = String(currentLangRef.current || "ko").trim().toLowerCase() || "ko";
        const sourceLang = String(peerLanguageRef.current || "").trim().toLowerCase();
        if (sourceLang && sourceLang === targetLang) {
          append(false, rawText);
          return;
        }

        const cacheKey = `${sourceLang || "auto"}|${targetLang}|${rawText}`;
        const cached = translateCacheRef.current.get(cacheKey);
        if (cached) {
          const charged = await consumeReceiveTranslateCost();
          if (!charged) {
            append(false, rawText);
            return;
          }
          append(false, `${rawText}\n${translatePrefixRef.current}: ${cached}`);
          return;
        }

        const authNow = authRef.current;
        const token = String(authNow?.token || "").trim();
        const userId = String(authNow?.userId || "").trim();
        const deviceKey = String(authNow?.deviceKey || "").trim();
        if (!token || !userId || !deviceKey) {
          append(false, rawText);
          return;
        }

        const out = await translatePeerChatOnServer({
          token,
          userId,
          deviceKey,
          text: rawText,
          sourceLang: sourceLang || undefined,
          targetLang,
          roomId: String(roomIdRef.current || "").trim() || undefined,
        });

        const translated = String(out.translatedText || "").trim();
        let canShowTranslation = Boolean(out.ok && translated);
        if (canShowTranslation) {
          const charged = await consumeReceiveTranslateCost();
          if (!charged) {
            canShowTranslation = false;
          }
        }

        const finalText = canShowTranslation
          ? `${rawText}\n${translatePrefixRef.current}: ${translated}`
          : rawText;

        if (canShowTranslation) {
          translateCacheRef.current.set(cacheKey, translated);
        }
        if (translateCacheRef.current.size > 120) {
          const first = translateCacheRef.current.keys().next().value;
          if (first) translateCacheRef.current.delete(first);
        }
        append(false, finalText);
      })
      .catch(() => {
        appendChatMessageRef.current(false, rawText);
      });
  }, [consumeReceiveTranslateCost]);

  const appendIncomingRuntimeMessage = useCallback(
    (mine: boolean, message: string) => {
      if (mine) {
        appendChatMessageRef.current(true, message);
        return;
      }
      appendIncomingPeerChatMessage(message);
    },
    [appendIncomingPeerChatMessage]
  );

  const clearAiChatTimer = useCallback(() => {
    if (!aiChatTimerRef.current) return;
    clearTimeout(aiChatTimerRef.current);
    aiChatTimerRef.current = null;
  }, []);

  useEffect(() => {
    clearAiChatTimer();
    if (!aiCallActive || phase !== "calling") return;

    const schedule = () => {
      const delayMs = 30000 + Math.floor(Math.random() * 30001);
      aiChatTimerRef.current = setTimeout(() => {
        aiChatTimerRef.current = null;
        if (!aiCallActiveRef.current) return;
        if (phaseRef.current !== "calling") return;
        const lines = Array.isArray(activeAiProfile?.chatLines) ? activeAiProfile.chatLines : [];
        if (lines.length <= 0) return;
        const randomIndex = Math.floor(Math.random() * lines.length);
        aiChatLineCursorRef.current = randomIndex;
        const line = String(lines[randomIndex] || "").trim();
        if (line) {
          appendIncomingRuntimeMessage(false, line);
        }
        schedule();
      }, delayMs);
    };

    schedule();
    return clearAiChatTimer;
  }, [activeAiProfile, aiCallActive, appendIncomingRuntimeMessage, clearAiChatTimer, phase]);

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
  const topActionClusterShift = 38;
  const topActionBadgeTop = insets.top + 14 + topActionClusterShift;
  const topActionTranslateTop = insets.top + 42 + topActionClusterShift;
  const topActionShopTop = insets.top + 96 + topActionClusterShift;
  const topActionGiftTop = insets.top + 150 + topActionClusterShift;
  const topActionSafetyTop = insets.top + 204 + topActionClusterShift;
  const callReportReasons = useMemo(
    () =>
      CALL_REPORT_REASONS.map((row) => ({
        code: row.code,
        label: t(row.labelKey),
        description: t(row.descriptionKey),
      })),
    [t]
  );
  const selectedCallReportReason = useMemo(
    () => callReportReasons.find((row) => row.code === callReportReasonCode) || callReportReasons[0] || null,
    [callReportReasonCode, callReportReasons]
  );
  const callSafetySubmitting = callReportSubmitting || callBlockSubmitting;
  const matchRevealProgress = matchRevealAnimRef.current;
  const giftFxRotateDeg = useMemo(
    () =>
      giftFxRotateAnimRef.current.interpolate({
        inputRange: [-360, 360],
        outputRange: ["-360deg", "360deg"],
      }),
    []
  );

  const popTalkBalanceLine = useMemo(() => {
    if (popTalkUnlimited) return t("poptalk.balance_unlimited_label");
    return t("poptalk.balance_label", {
      balance: Number(popTalk?.balance ?? 0),
      cap: Number(popTalk?.cap ?? 0),
    });
  }, [popTalk?.balance, popTalk?.cap, popTalkUnlimited, t]);

  const { isAiPeer, peerInfoText, myCountryRaw, myLangRaw, myGenderRaw, myFlag } = usePeerInfo({ peerInfo, prefs, t });
  const matchFilterCountryOptions = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code, label: `${countryCodeToFlagEmoji(code) || ""} ${getCountryName(t, code)}`.trim() })),
    [t]
  );
  const matchFilterLanguageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ code, label: getLanguageName(t, code) })),
    [t]
  );

  const applyMatchFilterState = useCallback((next: MatchFilter) => {
    const normalized = normalizeMatchFilter(next);
    matchFilterRef.current = normalized;
    setMatchFilterDraft(normalized);
  }, []);

  const toggleMatchFilterCountries = useCallback((value: string) => {
    setMatchFilterDraft((prev) => {
      const normalized = normalizeMatchFilter(prev);
      const key = String(value || "").trim().toUpperCase();
      if (!key) return normalized;
      let nextCountries = [...normalized.countries];
      if (key === MATCH_FILTER_ALL) {
        nextCountries = [MATCH_FILTER_ALL];
      } else {
        const withoutAll = nextCountries.filter((v) => v !== MATCH_FILTER_ALL);
        if (withoutAll.includes(key)) {
          const after = withoutAll.filter((v) => v !== key);
          nextCountries = after.length > 0 ? after : [MATCH_FILTER_ALL];
        } else {
          nextCountries = [...withoutAll, key];
        }
      }
      return normalizeMatchFilter({ ...normalized, countries: nextCountries });
    });
  }, []);

  const toggleMatchFilterLanguages = useCallback((value: string) => {
    setMatchFilterDraft((prev) => {
      const normalized = normalizeMatchFilter(prev);
      const key = String(value || "").trim();
      const normalizedCode = key.toUpperCase() === MATCH_FILTER_ALL ? MATCH_FILTER_ALL : normalizeLanguageCode(key);
      if (!normalizedCode) return normalized;
      let nextLanguages = [...normalized.languages];
      if (normalizedCode === MATCH_FILTER_ALL) {
        nextLanguages = [MATCH_FILTER_ALL];
      } else {
        const withoutAll = nextLanguages.filter((v) => v !== MATCH_FILTER_ALL);
        if (withoutAll.includes(normalizedCode)) {
          const after = withoutAll.filter((v) => v !== normalizedCode);
          nextLanguages = after.length > 0 ? after : [MATCH_FILTER_ALL];
        } else {
          nextLanguages = [...withoutAll, normalizedCode];
        }
      }
      return normalizeMatchFilter({ ...normalized, languages: nextLanguages });
    });
  }, []);

  const setMatchFilterGender = useCallback((gender: MatchFilterGender) => {
    setMatchFilterDraft((prev) => normalizeMatchFilter({ ...prev, gender }));
  }, []);
  const normalizedMatchFilterDraft = useMemo(() => normalizeMatchFilter(matchFilterDraft), [matchFilterDraft]);

  const loadMatchFilter = useCallback(async () => {
    if (!isPremiumRef.current) {
      applyMatchFilterState(createDefaultMatchFilter());
      return;
    }
    const token = String(authRef.current?.token || "").trim();
    const userId = String(authRef.current?.userId || "").trim();
    const deviceKey = String(authRef.current?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) return;
    setMatchFilterLoading(true);
    try {
      const out = await fetchMatchFilterOnServer({ token, userId, deviceKey });
      if (out.ok) {
        applyMatchFilterState(out.filter);
      }
    } finally {
      setMatchFilterLoading(false);
    }
  }, [applyMatchFilterState]);

  useEffect(() => {
    if (!isScreenFocused) return;
    loadMatchFilter().catch(() => undefined);
  }, [isScreenFocused, loadMatchFilter]);

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
    if (!hasHydrated) return;
    if (mediaPrefsInitializedRef.current) return;
    mediaPrefsInitializedRef.current = true;
    setMyCamOn(Boolean(persistedCallCamOn));
    setMySoundOn(Boolean(persistedCallMicOn));
  }, [hasHydrated, persistedCallCamOn, persistedCallMicOn]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!mediaPrefsInitializedRef.current) return;
    setCallMediaPrefs?.({ camOn: Boolean(myCamOn) });
  }, [hasHydrated, myCamOn, setCallMediaPrefs]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!mediaPrefsInitializedRef.current) return;
    setCallMediaPrefs?.({ micOn: Boolean(mySoundOn) });
  }, [hasHydrated, mySoundOn, setCallMediaPrefs]);

  useEffect(() => {
    remoteMutedRef.current = remoteMuted;
  }, [remoteMuted]);

  useEffect(() => {
    aiCallActiveRef.current = aiCallActive;
  }, [aiCallActive]);

  useEffect(() => {
    const rid = String(roomId || "");
    if (!rid.startsWith(AI_ROOM_ID_PREFIX)) {
      setAiCallActive(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (phase !== "matched" && phase !== "calling") return;
    const rid = String(roomId || "").trim();
    if (!rid) return;
    if (rid.startsWith(AI_ROOM_ID_PREFIX)) return;
    const isAiPeer = Boolean((peerInfo as any)?.ai || (peerInfo as any)?.isAi);
    if (!isAiPeer) return;
    if (aiCountedServerRoomRef.current.has(rid)) return;
    aiCountedServerRoomRef.current.add(rid);
    aiMatchCountRef.current += 1;
    if (aiMatchCountRef.current >= 2) {
      aiMatchActionKeysRef.current.clear();
      aiMatchLastActionAtRef.current = 0;
      aiMatchActionQueueTokenRef.current = -1;
      if (aiMatchTimerRef.current) {
        clearTimeout(aiMatchTimerRef.current);
        aiMatchTimerRef.current = null;
      }
    }
  }, [peerInfo, phase, roomId]);

  useEffect(() => {
    const shouldPlay = aiCallActive;
    const players = [aiRemotePlayerFr, aiRemotePlayerKr];
    players.forEach((player, index) => {
      const playerAny = player as any;
      if (!playerAny) return;
      try {
        playerAny.loop = true;
        playerAny.muted = Boolean(remoteMuted);
        if (shouldPlay && index === normalizedAiProfileIndex) {
          playerAny.play?.();
        } else {
          playerAny.pause?.();
        }
      } catch {}
    });
  }, [aiCallActive, aiRemotePlayerFr, aiRemotePlayerKr, normalizedAiProfileIndex, remoteMuted]);

  useEffect(() => {
    return () => {
      giftFxScaleAnimRef.current.stopAnimation();
      giftFxOpacityAnimRef.current.stopAnimation();
      giftFxTranslateXAnimRef.current.stopAnimation();
      giftFxTranslateYAnimRef.current.stopAnimation();
      giftFxRotateAnimRef.current.stopAnimation();
      giftFxNoticeOpacityAnimRef.current.stopAnimation();
      if (giftFxTimerRef.current) {
        clearTimeout(giftFxTimerRef.current);
        giftFxTimerRef.current = null;
      }
      if (aiChatTimerRef.current) {
        clearTimeout(aiChatTimerRef.current);
        aiChatTimerRef.current = null;
      }
      if (aiMatchTimerRef.current) {
        clearTimeout(aiMatchTimerRef.current);
        aiMatchTimerRef.current = null;
      }
      if (aiRestrictionNoticeTimerRef.current) {
        clearTimeout(aiRestrictionNoticeTimerRef.current);
        aiRestrictionNoticeTimerRef.current = null;
      }
      [aiRemotePlayerFr, aiRemotePlayerKr].forEach((player) => {
        try {
          (player as any)?.pause?.();
        } catch {}
      });
    };
  }, [aiRemotePlayerFr, aiRemotePlayerKr]);

  useEffect(() => {
    refreshPopTalk().catch(() => undefined);
    const tm = setInterval(() => {
      refreshPopTalk().catch(() => undefined);
    }, POPTALK_REFRESH_INTERVAL_MS);
    return () => clearInterval(tm);
  }, [refreshPopTalk]);

  useEffect(() => {
    if (popTalkUnlimited) return;
    const bal = Number(popTalk?.balance ?? 0);
    const prev = Number(popTalkLowPrevRef.current ?? bal);
    if (phase === "calling" && prev > POPTALK_LOW_WARNING_THRESHOLD && bal <= POPTALK_LOW_WARNING_THRESHOLD && bal > 0) {
      setPopTalkLowModal(true);
    }
    popTalkLowPrevRef.current = bal;
  }, [phase, popTalk?.balance, popTalkUnlimited]);

  useEffect(() => {
    if (!popTalkLowModal && !popTalkMatchBlockModal && !popTalkEmptyModal) return;
    setPopTalkAdFailCount(0);
    setPopTalkAdFailModal(false);
  }, [popTalkEmptyModal, popTalkLowModal, popTalkMatchBlockModal]);

  useEffect(() => {
    const bal = Number(popTalk?.balance ?? 0);
    if (popTalkUnlimited) {
      if (popTalkLowModal) setPopTalkLowModal(false);
      if (popTalkMatchBlockModal) setPopTalkMatchBlockModal(false);
      if (popTalkEmptyModal) setPopTalkEmptyModal(false);
      popTalkChargeInProgressRef.current = false;
      popTalkChargeGraceUntilRef.current = 0;
      return;
    }
    if (bal > POPTALK_MATCH_BLOCK_THRESHOLD && popTalkMatchBlockModal) {
      setPopTalkMatchBlockModal(false);
    }
    if (bal > 0 && popTalkChargeInProgressRef.current) {
      popTalkChargeInProgressRef.current = false;
      popTalkChargeGraceUntilRef.current = 0;
      setPopTalkEmptyModal(false);
    }
  }, [popTalk?.balance, popTalkEmptyModal, popTalkLowModal, popTalkMatchBlockModal, popTalkUnlimited]);

  useEffect(() => {
    if (phase === "calling") return;
    popTalkEmptyHandledRef.current = false;
    popTalkChargeInProgressRef.current = false;
    popTalkChargeGraceUntilRef.current = 0;
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
      const done = typeof onDone === "function" ? onDone : () => {};
      // If reveal is already running, treat as "started" so callers do not
      // force-skip to calling before the current reveal sequence finishes.
      if (matchRevealRunningRef.current) {
        matchRevealDoneCallbacksRef.current.push(done);
        return true;
      }
      if (matchRevealCompletedRef.current) {
        if (phaseRef.current === "matched") {
          matchRevealCompletedRef.current = false;
        } else {
          try {
            done();
          } catch {}
          return true;
        }
      }
      matchRevealRunningRef.current = true;
      matchRevealCompletedRef.current = false;
      matchRevealDoneCallbacksRef.current = [done];
      setMatchRevealActive(true);
      matchRevealAnimRef.current.stopAnimation();
      matchRevealAnimRef.current.setValue(0);

      Animated.sequence([
        Animated.timing(matchRevealAnimRef.current, {
          toValue: 1,
          duration: 2180,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(120),
      ]).start(({ finished }) => {
        const callbacks = matchRevealDoneCallbacksRef.current.splice(0);
        matchRevealRunningRef.current = false;
        if (!finished) {
          setMatchRevealActive(false);
          matchRevealAnimRef.current.setValue(0);
          matchRevealCompletedRef.current = false;
          return;
        }
        matchRevealCompletedRef.current = true;
        callbacks.forEach((cb) => {
          try {
            cb();
          } catch {}
        });
        // Avoid one-frame snap-back of orbit/heart right before phase switch.
        requestAnimationFrame(() => {
          setMatchRevealActive(false);
          matchRevealAnimRef.current.setValue(0);
        });
      });
      return true;
    },
    []
  );

  useEffect(() => {
    if (phase === "matched") {
      runMatchRevealTransition(() => {});
      return;
    }
    if (phase === "connecting" || phase === "queued" || phase === "ended") {
      matchRevealCompletedRef.current = false;
      matchRevealDoneCallbacksRef.current = [];
    }
  }, [phase, runMatchRevealTransition]);

  const fetchCurrentActiveUserCount = useCallback(async (): Promise<number> => {
    try {
      const base = String(APP_CONFIG.AUTH_HTTP_BASE_URL || "").replace(/\/+$/, "");
      const path = String((APP_CONFIG as any)?.ACTIVE_USERS_PATH || "/api/active-users");
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const res = await fetch(`${base}${normalizedPath}`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return Number.POSITIVE_INFINITY;
      const json = await res.json().catch(() => null);
      const n = Number(json?.activeUsers ?? json?.connectedTotal ?? json?.activeTotal ?? NaN);
      if (!Number.isFinite(n) || n < 0) return Number.POSITIVE_INFINITY;
      return Math.trunc(n);
    } catch {
      return Number.POSITIVE_INFINITY;
    }
  }, []);

  const clearAiMatchTimer = useCallback(() => {
    if (!aiMatchTimerRef.current) return;
    clearTimeout(aiMatchTimerRef.current);
    aiMatchTimerRef.current = null;
  }, []);

  const activateSyntheticAiMatch = useCallback(
    async (qTok: number) => {
      if (aiMatchCountRef.current >= 2) return false;
      if (aiMatchInFlightRef.current) return false;
      if (queueTokenRef.current !== qTok) return false;
      if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return false;
      aiMatchInFlightRef.current = true;
      try {
        const activeUsers = await fetchCurrentActiveUserCount();
        if (!Number.isFinite(activeUsers) || activeUsers > 3) return false;
        if (aiMatchCountRef.current >= 2) return false;
        if (queueTokenRef.current !== qTok) return false;
        if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return false;

        const room = `${AI_ROOM_ID_PREFIX}${Date.now()}_${Math.random().toString(16).slice(2, 9)}`;
        const nextAiProfileIndex = Math.max(0, Math.min(aiMatchCountRef.current, AI_PROFILES.length - 1));
        const aiProfile = AI_PROFILES[nextAiProfileIndex] || AI_PROFILES[0];
        const aiCountry = String(aiProfile.country || "FR").trim().toUpperCase() || "FR";
        const aiLanguage = String(aiProfile.language || "fr").trim().toLowerCase() || "fr";
        const aiSessionId = String(aiProfile.peerSessionId || "ai_profile_bot").trim() || "ai_profile_bot";
        const aiInfo = {
          country: aiCountry,
          language: aiLanguage,
          lang: aiLanguage,
          gender: aiProfile.gender,
          flag: countryCodeToFlagEmoji(aiCountry),
          userId: aiSessionId,
          uid: aiSessionId,
          ai: true,
          isAi: true,
        };

        clearAiMatchTimer();
        clearNoMatchTimer();
        clearMatchingActionsTimer(false);
        clearWebrtcDownTimer();

        queueRunningRef.current = false;
        enqueuedRef.current = false;

        manualCloseRef.current = true;
        try {
          wsRef.current?.leaveQueue();
        } catch {}
        try {
          wsRef.current?.close();
        } catch {}
        wsRef.current = null;
        manualCloseRef.current = false;

        setMyCamOn(true);
        await ensureLocalPreviewStream().catch(() => false);

        rtcRef.current = createLocalAiRtcStub() as any;
        setAiProfileIndex(nextAiProfileIndex);
        peerSessionIdRef.current = aiSessionId;
        aiChatLineCursorRef.current = 0;
        setPeerInfo(aiInfo);
        setRemoteCamOn(true);
        setSignalUnstable(false);
        setNoMatchModal(false);
        setFastMatchHint(false);
        setReMatchText("");
        setMatchingActionsVisible(false);
        setRoomId(room);
        setIsCaller(true);
        setChatReady(true);
        setAiCallActive(true);
        setPhase("matched");
        aiMatchCountRef.current += 1;
        if (aiMatchCountRef.current >= 2) {
          aiMatchActionKeysRef.current.clear();
          aiMatchLastActionAtRef.current = 0;
          aiMatchActionQueueTokenRef.current = -1;
          clearAiMatchTimer();
        }

        const revealStarted = runMatchRevealTransition(() => {
          if (queueTokenRef.current !== qTok) return;
          if (phaseRef.current === "calling") return;
          setPhase("calling");
          try {
            useAppStore.getState().setCallMatchedSignal(Date.now());
          } catch {}
        });
        if (!revealStarted) {
          setPhase("calling");
          try {
            useAppStore.getState().setCallMatchedSignal(Date.now());
          } catch {}
        }
        return true;
      } finally {
        aiMatchInFlightRef.current = false;
      }
    },
    [
      clearAiMatchTimer,
      clearMatchingActionsTimer,
      clearNoMatchTimer,
      clearWebrtcDownTimer,
      ensureLocalPreviewStream,
      fetchCurrentActiveUserCount,
      runMatchRevealTransition,
      setChatReady,
      setFastMatchHint,
      setIsCaller,
      setMatchingActionsVisible,
      setMyCamOn,
      setNoMatchModal,
      setPeerInfo,
      setPhase,
      setReMatchText,
      setRoomId,
      setRemoteCamOn,
      setSignalUnstable,
    ]
  );

  const scheduleAiMatchFromLastAction = useCallback(() => {
    clearAiMatchTimer();
    if (aiMatchCountRef.current >= 2) return;
    if (aiMatchInFlightRef.current) return;
    if (aiMatchActionQueueTokenRef.current !== queueTokenRef.current) return;
    if (aiMatchActionKeysRef.current.size < 2) return;
    if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return;

    const dueAt = Number(aiMatchLastActionAtRef.current || 0) + 7000;
    const waitMs = Math.max(0, dueAt - Date.now());
    const qTok = queueTokenRef.current;
    aiMatchTimerRef.current = setTimeout(() => {
      aiMatchTimerRef.current = null;
      if (queueTokenRef.current !== qTok) return;
      activateSyntheticAiMatch(qTok).catch(() => undefined);
    }, waitMs);
  }, [activateSyntheticAiMatch, clearAiMatchTimer]);

  const markMatchingActionUsed = useCallback(
    (action: string) => {
      const key = String(action || "").trim().toLowerCase();
      if (!key) return;
      if (aiMatchCountRef.current >= 2) return;
      if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return;
      if (aiMatchActionQueueTokenRef.current !== queueTokenRef.current) {
        aiMatchActionQueueTokenRef.current = queueTokenRef.current;
        aiMatchActionKeysRef.current.clear();
        aiMatchLastActionAtRef.current = 0;
      }
      aiMatchActionKeysRef.current.add(key);
      aiMatchLastActionAtRef.current = Date.now();
      scheduleAiMatchFromLastAction();
    },
    [scheduleAiMatchFromLastAction]
  );

  useEffect(() => {
    if (phase === "connecting" || phase === "queued") {
      scheduleAiMatchFromLastAction();
      return;
    }
    clearAiMatchTimer();
  }, [clearAiMatchTimer, phase, scheduleAiMatchFromLastAction]);

  const clearGiftFxTimer = useCallback(() => {
    if (!giftFxTimerRef.current) return;
    clearTimeout(giftFxTimerRef.current);
    giftFxTimerRef.current = null;
  }, []);

  const getGiftFxPreset = useCallback((giftId: string, costKernel: number): GiftFxPreset => {
    const effect = GIFT_EFFECT_BY_ID[giftId] || "pulse";
    const tier = costKernel >= 100000 ? 4 : costKernel >= 20000 ? 3 : costKernel >= 5000 ? 2 : costKernel >= 1000 ? 1 : 0;

    const base: GiftFxPreset = {
      effect,
      sendStartScale: 1.42 + tier * 0.12,
      sendEndScale: 0.24 + tier * 0.03,
      sendDurationMs: 720 + tier * 70,
      receivePopScale: 1.02 + tier * 0.07,
      receivePopDurationMs: 540 + tier * 50,
      noticeDurationMs: 3400,
    };

    if (effect === "rocket") return { ...base, sendDurationMs: 680, receivePopDurationMs: 500, receivePopScale: base.receivePopScale + 0.07 };
    if (effect === "spin") return { ...base, sendDurationMs: 820, receivePopDurationMs: 600 };
    if (effect === "shake") return { ...base, sendDurationMs: 760, receivePopDurationMs: 560 };
    if (effect === "float") return { ...base, sendDurationMs: 860, receivePopDurationMs: 620 };
    if (effect === "spark") return { ...base, sendStartScale: base.sendStartScale + 0.08, receivePopScale: base.receivePopScale + 0.05 };
    return base;
  }, []);

  const triggerGiftFx = useCallback((giftId: string, mode: GiftFxMode) => {
    const gift = getGiftById(giftId);
    if (!gift) return;

    const token = Date.now() + Math.floor(Math.random() * 1000);
    const preset = getGiftFxPreset(gift.id, gift.costKernel);
    const image = GIFT_IMAGE_BY_ID[gift.id] || GIFT_IMG_CANDY;
    const giftName = getGiftDisplayName(t, gift);
    const noticeText =
      mode === "send"
        ? t("call.gift.sent_notice", { name: giftName })
        : t("call.gift.received_notice", { name: giftName });

    clearGiftFxTimer();
    giftFxScaleAnimRef.current.stopAnimation();
    giftFxOpacityAnimRef.current.stopAnimation();
    giftFxTranslateXAnimRef.current.stopAnimation();
    giftFxTranslateYAnimRef.current.stopAnimation();
    giftFxRotateAnimRef.current.stopAnimation();
    giftFxNoticeOpacityAnimRef.current.stopAnimation();

    giftFxScaleAnimRef.current.setValue(mode === "send" ? preset.sendStartScale : 0.05);
    giftFxOpacityAnimRef.current.setValue(1);
    giftFxTranslateXAnimRef.current.setValue(0);
    giftFxTranslateYAnimRef.current.setValue(0);
    giftFxRotateAnimRef.current.setValue(0);
    giftFxNoticeOpacityAnimRef.current.setValue(0);

    setGiftFx({
      token,
      giftId: gift.id,
      giftName,
      accent: gift.accent,
      mode,
      stage: "animating",
      image,
      noticeText,
    });

    if (mode === "send") {
      const sendFx: Animated.CompositeAnimation[] = [
        Animated.timing(giftFxScaleAnimRef.current, {
          toValue: preset.sendEndScale,
          duration: preset.sendDurationMs,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ];
      if (preset.effect === "rocket") {
        sendFx.push(
          Animated.timing(giftFxTranslateYAnimRef.current, {
            toValue: -88,
            duration: preset.sendDurationMs,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          })
        );
      } else if (preset.effect === "float") {
        sendFx.push(
          Animated.timing(giftFxTranslateYAnimRef.current, {
            toValue: -46,
            duration: preset.sendDurationMs,
            easing: Easing.out(Easing.sin),
            useNativeDriver: true,
          })
        );
      } else if (preset.effect === "shake") {
        sendFx.push(
          Animated.sequence([
            Animated.timing(giftFxTranslateXAnimRef.current, { toValue: -14, duration: 110, useNativeDriver: true }),
            Animated.timing(giftFxTranslateXAnimRef.current, { toValue: 14, duration: 110, useNativeDriver: true }),
            Animated.timing(giftFxTranslateXAnimRef.current, { toValue: -9, duration: 90, useNativeDriver: true }),
            Animated.timing(giftFxTranslateXAnimRef.current, { toValue: 0, duration: 90, useNativeDriver: true }),
          ])
        );
      } else if (preset.effect === "spin") {
        sendFx.push(
          Animated.timing(giftFxRotateAnimRef.current, {
            toValue: 320,
            duration: preset.sendDurationMs,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          })
        );
      } else if (preset.effect === "spark") {
        sendFx.push(
          Animated.timing(giftFxRotateAnimRef.current, {
            toValue: 90,
            duration: preset.sendDurationMs,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          })
        );
      }

      Animated.parallel(sendFx).start(({ finished }) => {
        if (!finished) return;
        setGiftFx((prev) => (prev?.token === token ? { ...prev, stage: "notice" } : prev));
        Animated.sequence([
          Animated.timing(giftFxOpacityAnimRef.current, {
            toValue: 0,
            duration: 120,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(giftFxNoticeOpacityAnimRef.current, {
            toValue: 1,
            duration: 150,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.delay(2200),
          Animated.timing(giftFxNoticeOpacityAnimRef.current, {
            toValue: 0,
            duration: 200,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(({ finished: done }) => {
          if (!done) return;
          setGiftFx((prev) => (prev?.token === token ? null : prev));
        });
      });
      return;
    }

    const receiveMotion: Animated.CompositeAnimation[] = [];
    if (preset.effect === "rocket") {
      receiveMotion.push(
        Animated.sequence([
          Animated.timing(giftFxTranslateYAnimRef.current, { toValue: -14, duration: 140, useNativeDriver: true }),
          Animated.timing(giftFxTranslateYAnimRef.current, { toValue: 0, duration: 160, useNativeDriver: true }),
        ])
      );
    } else if (preset.effect === "shake") {
      receiveMotion.push(
        Animated.sequence([
          Animated.timing(giftFxRotateAnimRef.current, { toValue: 18, duration: 90, useNativeDriver: true }),
          Animated.timing(giftFxRotateAnimRef.current, { toValue: -16, duration: 120, useNativeDriver: true }),
          Animated.timing(giftFxRotateAnimRef.current, { toValue: 10, duration: 100, useNativeDriver: true }),
          Animated.timing(giftFxRotateAnimRef.current, { toValue: 0, duration: 100, useNativeDriver: true }),
        ])
      );
    } else if (preset.effect === "spin") {
      receiveMotion.push(
        Animated.timing(giftFxRotateAnimRef.current, {
          toValue: 360,
          duration: preset.receivePopDurationMs + 120,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      );
    } else {
      receiveMotion.push(
        Animated.sequence([
          Animated.timing(giftFxRotateAnimRef.current, { toValue: 14, duration: 110, useNativeDriver: true }),
          Animated.timing(giftFxRotateAnimRef.current, { toValue: -12, duration: 140, useNativeDriver: true }),
          Animated.timing(giftFxRotateAnimRef.current, { toValue: 0, duration: 120, useNativeDriver: true }),
        ])
      );
    }

    Animated.sequence([
      Animated.parallel([
        Animated.timing(giftFxScaleAnimRef.current, {
          toValue: preset.receivePopScale,
          duration: preset.receivePopDurationMs,
          easing: Easing.out(Easing.back(1.4)),
          useNativeDriver: true,
        }),
        ...receiveMotion,
      ]),
      Animated.timing(giftFxScaleAnimRef.current, {
        toValue: 1,
        duration: 170,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(giftFxNoticeOpacityAnimRef.current, {
        toValue: 1,
        duration: 170,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.delay(preset.noticeDurationMs),
      Animated.parallel([
        Animated.timing(giftFxOpacityAnimRef.current, {
          toValue: 0,
          duration: 240,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(giftFxNoticeOpacityAnimRef.current, {
          toValue: 0,
          duration: 240,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    ]).start(({ finished }) => {
      if (!finished) return;
      setGiftFx((prev) => (prev?.token === token ? null : prev));
    });
  }, [clearGiftFxTimer, getGiftFxPreset, t]);

  const syncGiftWalletState = useCallback(async () => {
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId) return null;

    const giftOut = await fetchShopGiftInventory({ token, userId, deviceKey }).catch(() => null);
    if (giftOut?.ok && giftOut.giftStateFound) {
      setShop({
        giftsOwned: giftOut.giftsOwned,
        giftsReceived: giftOut.giftsReceived,
      });
      setAssets({
        kernelCount: Math.max(0, Math.trunc(Number(giftOut.walletKernel ?? 0))),
        updatedAtMs: Date.now(),
      });
      return {
        giftsOwned: giftOut.giftsOwned,
        giftsReceived: giftOut.giftsReceived,
        walletKernel: Math.max(0, Math.trunc(Number(giftOut.walletKernel ?? 0))),
      };
    }

    const walletOut = await fetchUnifiedWalletState({ token, userId, deviceKey }).catch(() => null);
    if (walletOut?.ok) {
      setAssets({
        kernelCount: Math.max(0, Math.trunc(Number(walletOut.walletKernel ?? 0))),
        updatedAtMs: Date.now(),
      });
      if (walletOut.giftStateFound) {
        const giftsOwned = walletOut.giftsOwned || {};
        const giftsReceived = walletOut.giftsReceived || {};
        setShop({
          giftsOwned,
          giftsReceived,
        });
        return {
          giftsOwned,
          giftsReceived,
          walletKernel: Math.max(0, Math.trunc(Number(walletOut.walletKernel ?? 0))),
        };
      }
    }
    return null;
  }, [auth?.deviceKey, auth?.token, auth?.userId, setAssets, setShop]);

  const onGiftSignal = useCallback(
    (giftId: string, payload?: any) => {
      const gift = getGiftById(giftId);
      if (!gift) return;
      const mySessionId = String(auth?.deviceKey || "").trim();
      const fromSessionId = String(payload?._fromSessionId || payload?.fromSessionId || "").trim();
      const incomingDeliveryId = String(payload?.deliveryId || payload?.eventId || "").trim();
      if (fromSessionId && mySessionId && fromSessionId === mySessionId) {
        return;
      }
      if (incomingDeliveryId && sentGiftDeliveryIdsRef.current.has(incomingDeliveryId)) {
        return;
      }
      if (incomingDeliveryId && receivedGiftDeliveryIdsRef.current.has(incomingDeliveryId)) {
        return;
      }
      if (incomingDeliveryId) {
        receivedGiftDeliveryIdsRef.current.add(incomingDeliveryId);
        if (receivedGiftDeliveryIdsRef.current.size > 180) {
          const first = receivedGiftDeliveryIdsRef.current.values().next().value;
          if (first) receivedGiftDeliveryIdsRef.current.delete(first);
        }
      }

      const run = async () => {
        const token = String(auth?.token || "").trim();
        const userId = String(auth?.userId || "").trim();
        const deviceKey = String(auth?.deviceKey || "").trim();
        const deliveryId = String(
          payload?.deliveryId || payload?.eventId || `gift_rx_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
        ).trim();

        if (token && userId) {
          const out = await receiveGiftOnServer({
            token,
            userId,
            deviceKey,
            giftId: gift.id,
            count: 1,
            deliveryId,
            idempotencyKey: deliveryId,
          });

          if (out.ok) {
            if (out.giftStateFound) {
              setShop({
                giftsOwned: out.giftsOwned,
                giftsReceived: out.giftsReceived,
              });
            }
            setAssets({
              kernelCount: Math.max(0, Math.trunc(Number(out.walletKernel ?? 0))),
              updatedAtMs: Date.now(),
            });
          } else {
            await syncGiftWalletState().catch(() => null);
          }
        } else {
          await syncGiftWalletState().catch(() => null);
        }

        triggerGiftFx(gift.id, "receive");
        appendChatMessage(false, `[GIFT] ${t("call.gift.received_notice", { name: getGiftDisplayName(t, gift) })}`);
      };

      run().catch(() => {
        triggerGiftFx(gift.id, "receive");
        appendChatMessage(false, `[GIFT] ${t("call.gift.received_notice", { name: getGiftDisplayName(t, gift) })}`);
        syncGiftWalletState().catch(() => undefined);
      });
    },
    [appendChatMessage, auth?.deviceKey, auth?.token, auth?.userId, setAssets, setShop, syncGiftWalletState, triggerGiftFx]
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
    appendChatMessage: appendIncomingRuntimeMessage,
    t,
  });

  useEffect(() => {
    const bal = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
    if (phase !== "calling") return;
    if (popTalkUnlimited) return;
    if (bal > 0) return;
    if (popTalkEmptyHandledRef.current) return;
    popTalkEmptyHandledRef.current = true;
    stopAll(false);
    setPopTalkEmptyModal(true);
  }, [phase, popTalk?.balance, popTalkUnlimited, stopAll]);

  useEffect(() => {
    if (phase === "calling") return;
    peerSessionIdRef.current = null;
    setCallSafetyMenuVisible(false);
    setCallReportModalVisible(false);
    setCallReportSubmitting(false);
    setCallBlockSubmitting(false);
    setTranslateUpsellModalVisible(false);
    setMatchFilterUpsellModalVisible(false);
  }, [phase]);

  useEffect(() => {
    if (phase === "matched" || phase === "calling") {
      setMatchFilterModalVisible(false);
    }
  }, [phase]);

  useEffect(() => {
    translateCacheRef.current.clear();
  }, [roomId]);

  const endCallAndRequeue = (why: "remote_left" | "disconnect" | "error" | "find_other") => {
    const tok = queueTokenRef.current;
    if (endCallOnceRef.current === tok) return;
    endCallOnceRef.current = tok;

    if (why === "remote_left") {
      suppressEndRelayRef.current = true;
    } else if (why === "find_other") {
      suppressEndRelayRef.current = false;
    }

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
    if (popTalkUnlimited) {
      setPopTalkMatchBlockModal(false);
      return true;
    }
    let snap: any = null;
    try {
      snap = await refreshPopTalk();
    } catch {}

    const snapBalanceRaw = Number(snap?.ok ? snap?.popTalkBalance : NaN);
    const storeBalanceRaw = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
    const bal = Number.isFinite(snapBalanceRaw)
      ? Math.max(0, Math.trunc(snapBalanceRaw))
      : Math.max(0, Math.trunc(storeBalanceRaw));

    if (!snap?.ok && bal <= 0) {
      showGlobalModal(t("poptalk.title"), t("poptalk.sync_failed"));
    }
    if (bal < POPTALK_MATCH_BLOCK_THRESHOLD) {
      setPopTalkMatchBlockModal(true);
      return false;
    }
    setPopTalkMatchBlockModal(false);
    return true;
  }, [popTalkUnlimited, refreshPopTalk, showGlobalModal, t]);

  const getQueueMatchFilter = useCallback(() => {
    if (!isPremiumRef.current) return createDefaultMatchFilter();
    return normalizeMatchFilter(matchFilterRef.current);
  }, []);
  const shouldSkipMatchedPeer = useCallback(
    ({ peerSessionId }: { roomId: string; peerSessionId: string }) => {
      if (aiMatchCountRef.current < 2) return false;
      const sid = String(peerSessionId || "").trim().toLowerCase();
      if (!sid) return false;
      return sid.startsWith("ai_") || sid.startsWith("ai-") || sid.endsWith("_bot") || sid.endsWith("-bot");
    },
    []
  );
  const shouldSkipPeerInfo = useCallback(
    ({ peerInfo }: { roomId: string; peerSessionId: string; peerInfo: any }) => {
      if (aiMatchCountRef.current < 2) return false;
      const isAi = Boolean((peerInfo as any)?.ai || (peerInfo as any)?.isAi);
      return isAi;
    },
    []
  );

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
    myUserId: String(auth?.userId || "").trim(),
    setAuthBooting,
    setMatchingActionsVisible,
    setNoMatchModal,
    setPhase,
    setSignalUnstable,
    setPeerInfo,
    setPeerSessionId: (v) => {
      peerSessionIdRef.current = v;
    },
    setRemoteCamOn,
    onGiftSignal,
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
    getQueueMatchFilter,
    shouldSkipMatch: shouldSkipMatchedPeer,
    shouldSkipPeerInfo,
  });

  useEffect(() => {
    if (!pendingGiftSend) return;
    let closed = false;
    const event = pendingGiftSend;
    clearPendingGiftSend(event.token);
    const gift = getGiftById(event.giftId);

    const run = async () => {
      if (!gift) {
        return;
      }

      if (aiCallActiveRef.current || String(roomIdRef.current || "").startsWith(AI_ROOM_ID_PREFIX)) {
        if (!closed) {
          showAiRestrictionNotice("AI에게는 선물할 수 없습니다.");
        }
        return;
      }

      if (phaseRef.current !== "calling" || !roomIdRef.current) {
        if (!closed) {
          showGlobalModal(t("call.error_title"), t("call.gift.send_only_during_call"));
        }
        return;
      }

      const localOwnedCount = Math.max(
        0,
        Math.trunc(Number((useAppStore.getState() as any)?.shop?.giftsOwned?.[gift.id] ?? 0))
      );
      if (localOwnedCount <= 0) {
        const syncedBefore = await syncGiftWalletState().catch(() => null);
        if (closed) {
          return;
        }
        const ownedCount = Math.max(0, Math.trunc(Number(syncedBefore?.giftsOwned?.[gift.id] ?? 0)));
        if (syncedBefore && ownedCount <= 0) {
          showGlobalModal(t("call.error_title"), t("call.gift.none_to_send"));
          return;
        }
      }

      try {
        const token = String(auth?.token || "").trim();
        const userId = String(auth?.userId || "").trim();
        const deviceKey = String(auth?.deviceKey || "").trim();
        if (!token || !userId) {
          showGlobalModal(t("call.error_title"), t("common.auth_expired"));
          return;
        }

        const deliveryId = `gift_tx_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
        sentGiftDeliveryIdsRef.current.add(deliveryId);
        if (sentGiftDeliveryIdsRef.current.size > 180) {
          const first = sentGiftDeliveryIdsRef.current.values().next().value;
          if (first) sentGiftDeliveryIdsRef.current.delete(first);
        }
        const sendOut = await sendGiftOnServer({
          token,
          userId,
          deviceKey,
          giftId: gift.id,
          count: 1,
          deliveryId,
          idempotencyKey: deliveryId,
        });
        if (!sendOut.ok) {
          await syncGiftWalletState().catch(() => null);
          const errCode = String(sendOut.errorCode || "").toUpperCase();
          if (!closed) {
            if (errCode === "INSUFFICIENT_GIFT") {
              showGlobalModal(t("call.error_title"), t("call.gift.none_to_send"));
            } else if (errCode === "GIFT_SEND_ROUTE_NOT_FOUND") {
              showGlobalModal(t("call.error_title"), t("call.gift.error.route_missing"));
            } else {
              showGlobalModal(t("call.error_title"), sendOut.errorMessage || t("call.gift.error.send_failed"));
            }
          }
          return;
        }
        if (sendOut.giftStateFound) {
          setShop({
            giftsOwned: sendOut.giftsOwned,
            giftsReceived: sendOut.giftsReceived,
          });
        }
        setAssets({
          kernelCount: Math.max(0, Math.trunc(Number(sendOut.walletKernel ?? 0))),
          updatedAtMs: Date.now(),
        });

        const ws = wsRef.current;
        const roomId = roomIdRef.current;
        if (!ws || !roomId || typeof ws.relay !== "function") {
          throw new Error("GIFT_RELAY_UNAVAILABLE");
        }
        ws.relay(roomId, { type: "gift", giftId: gift.id, name: getGiftDisplayName(t, gift), deliveryId });
        triggerGiftFx(gift.id, "send");
        appendChatMessage(true, `[GIFT] ${t("call.gift.sent_notice", { name: getGiftDisplayName(t, gift) })}`);
        await syncGiftWalletState().catch(() => null);
      } catch {
        await syncGiftWalletState().catch(() => null);
        if (!closed) {
          showGlobalModal(t("call.error_title"), t("call.gift.error.send_failed"));
        }
      }
    };

    run().catch(() => {
      if (!closed) {
        showGlobalModal(t("call.error_title"), t("call.gift.error.send_failed"));
      }
    });

    return () => {
      closed = true;
    };
  }, [appendChatMessage, auth?.deviceKey, auth?.token, auth?.userId, clearPendingGiftSend, pendingGiftSend, setAssets, setShop, showAiRestrictionNotice, showGlobalModal, syncGiftWalletState, t, triggerGiftFx]);

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
          useAppStore.getState().showGlobalModal(t("auth.title"), t("auth.token_empty"));
          navigation.goBack();
          return;
        }

        if (!alive) return;
        setAuthBooting(false);
        startQueue(true);
      } catch (e) {
        if (!alive) return;
        const m = typeof e === "object" && e && "message" in (e as any) ? String((e as any).message) : String(e);
        useAppStore.getState().showGlobalModal(t("auth.title"), m || t("auth.bind_failed"));
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
    swipeDragTranslateX,
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
    onSwipeRefreshCommitted,
    onOpenMatchingMiniScreen: () => {
      restoreMatchingActionsOnNextFocusRef.current = true;
    },
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

  const closeCallSafetyModals = useCallback(() => {
    if (callSafetySubmitting) return;
    setCallSafetyMenuVisible(false);
    setCallReportModalVisible(false);
  }, [callSafetySubmitting]);

  const startRematchAfterCallSafety = useCallback(() => {
    setCallSafetyMenuVisible(false);
    setCallReportModalVisible(false);
    try {
      wsRef.current?.leaveRoom(roomIdRef.current || "");
    } catch {}
    endCallAndRequeue("find_other");
  }, [endCallAndRequeue, wsRef]);

  const onPressCallSafetyButton = useCallback(() => {
    if (callSafetySubmitting) return;
    if (phaseRef.current !== "calling") return;
    if (aiCallActiveRef.current || String(roomIdRef.current || "").startsWith(AI_ROOM_ID_PREFIX)) {
      showAiRestrictionNotice("AI에게는 신고/차단을 할 수 없습니다.");
      return;
    }
    if (!roomIdRef.current) {
      showGlobalModal(t("call.safety.menu_title"), t("call.safety.no_active_peer"));
      return;
    }
    setCallSafetyMenuVisible(true);
  }, [callSafetySubmitting, showAiRestrictionNotice, showGlobalModal, t]);

  const onPressTranslateToggle = useCallback(() => {
    if (phaseRef.current !== "calling") return;
    if (!isPremiumRef.current) {
      setTranslateUpsellModalVisible(true);
      return;
    }
    setLiveTranslateEnabled((prev) => !prev);
  }, []);

  const closeTranslateUpsellModal = useCallback(() => {
    setTranslateUpsellModalVisible(false);
  }, []);

  const onPressGoPremiumForTranslate = useCallback(() => {
    setTranslateUpsellModalVisible(false);
    navigation.navigate("Premium");
  }, [navigation]);

  const closeMatchFilterUpsellModal = useCallback(() => {
    setMatchFilterUpsellModalVisible(false);
  }, []);

  const onPressGoPremiumForMatchFilter = useCallback(() => {
    setMatchFilterUpsellModalVisible(false);
    navigation.navigate("Premium");
  }, [navigation]);

  const openMatchFilterModal = useCallback(() => {
    setMatchFilterDraft(normalizeMatchFilter(matchFilterRef.current));
    setMatchFilterModalVisible(true);
  }, []);

  const closeMatchFilterModal = useCallback(() => {
    if (matchFilterSaving) return;
    setMatchFilterModalVisible(false);
  }, [matchFilterSaving]);

  const onPressMatchingFilter = useCallback(() => {
    if (!isPremiumRef.current) {
      setMatchFilterUpsellModalVisible(true);
      return;
    }
    openMatchFilterModal();
  }, [openMatchFilterModal]);

  const onPressMatchingBeautyTracked = useCallback(() => {
    markMatchingActionUsed("beauty");
    void onPressMatchingBeauty();
  }, [markMatchingActionUsed, onPressMatchingBeauty]);

  const onPressMatchingFortuneTracked = useCallback(() => {
    markMatchingActionUsed("fortune");
    onPressMatchingFortune();
  }, [markMatchingActionUsed, onPressMatchingFortune]);

  const onPressMatchingGameTracked = useCallback(() => {
    markMatchingActionUsed("game");
    onPressMatchingGame();
  }, [markMatchingActionUsed, onPressMatchingGame]);

  const onPressMatchingFilterTracked = useCallback(() => {
    markMatchingActionUsed("filter");
    onPressMatchingFilter();
  }, [markMatchingActionUsed, onPressMatchingFilter]);

  const onPressSaveMatchFilter = useCallback(async () => {
    if (matchFilterSaving) return;
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("call.match_filter.title"), t("common.auth_expired"));
      return;
    }
    const normalized = normalizeMatchFilter(matchFilterDraft);
    setMatchFilterSaving(true);
    try {
      const out = await saveMatchFilterOnServer({
        token,
        userId,
        deviceKey,
        filter: normalized,
      });
      if (!out.ok) {
        const code = String(out.errorCode || "").toUpperCase();
        if (code === "MATCH_FILTER_ROUTE_NOT_FOUND") {
          showGlobalModal(t("call.match_filter.title"), t("call.match_filter.route_missing"));
        } else {
          showGlobalModal(t("call.match_filter.title"), out.errorMessage || out.errorCode || t("common.error_occurred"));
        }
        return;
      }
      applyMatchFilterState(out.filter);
      setMatchFilterModalVisible(false);
      // If the user is waiting for a match, immediately restart queue with new filter.
      if (phaseRef.current === "connecting" || phaseRef.current === "queued") {
        retry();
      }
    } finally {
      setMatchFilterSaving(false);
    }
  }, [applyMatchFilterState, auth?.deviceKey, auth?.token, auth?.userId, matchFilterDraft, matchFilterSaving, retry, showGlobalModal, t]);

  const onOpenDelayedMatchConditions = useCallback(() => {
    if (isPremiumRef.current) {
      openMatchFilterModal();
      return;
    }
    setPrefsModal(true);
  }, [openMatchFilterModal, setPrefsModal]);

  const onPressOpenCallReport = useCallback(() => {
    if (callSafetySubmitting) return;
    if (aiCallActiveRef.current || String(roomIdRef.current || "").startsWith(AI_ROOM_ID_PREFIX)) {
      showAiRestrictionNotice("AI에게는 신고를 할 수 없습니다.");
      return;
    }
    setCallSafetyMenuVisible(false);
    setCallReportReasonCode(callReportReasons[0]?.code || "");
    setCallReportModalVisible(true);
  }, [callReportReasons, callSafetySubmitting, showAiRestrictionNotice]);

  const onPressConfirmCallReport = useCallback(async () => {
    if (callReportSubmitting || callBlockSubmitting) return;
    if (aiCallActiveRef.current || String(roomIdRef.current || "").startsWith(AI_ROOM_ID_PREFIX)) {
      showAiRestrictionNotice("AI에게는 신고를 할 수 없습니다.");
      return;
    }
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    const rid = String(roomIdRef.current || "").trim();
    const peerUserId = String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim();
    const selected = selectedCallReportReason;
    if (!selected) {
      showGlobalModal(t("call.report.title"), t("call.report.select_reason"));
      return;
    }
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("call.report.title"), t("common.auth_expired"));
      return;
    }
    if (!rid) {
      showGlobalModal(t("call.report.title"), t("call.report.no_call_info"));
      return;
    }

    setCallReportSubmitting(true);
    try {
      const out = await reportCallPeerOnServer({
        token,
        userId,
        deviceKey,
        roomId: rid,
        peerSessionId: String(peerSessionIdRef.current || "").trim() || undefined,
        peerUserId: peerUserId || undefined,
        reasonCode: selected.code,
        reasonLabel: selected.label,
      });
      if (!out.ok) {
        const errCode = String(out.errorCode || "").toUpperCase();
        if (errCode === "CALL_REPORT_ROUTE_NOT_FOUND") {
          showGlobalModal(t("call.report.title"), t("call.report.route_missing"));
        } else {
          showGlobalModal(t("call.report.title"), out.errorMessage || out.errorCode || t("call.report.submit_failed"));
        }
        return;
      }

      setCallReportModalVisible(false);
      setCallSafetyMenuVisible(false);
      showGlobalModal(t("call.report.received_title"), t("call.report.received_body"));
      setTimeout(() => {
        startRematchAfterCallSafety();
      }, 120);
    } finally {
      setCallReportSubmitting(false);
    }
  }, [auth?.deviceKey, auth?.token, auth?.userId, callBlockSubmitting, callReportSubmitting, peerInfo, selectedCallReportReason, showAiRestrictionNotice, showGlobalModal, startRematchAfterCallSafety, t]);

  const onPressConfirmCallBlock = useCallback(async () => {
    if (callBlockSubmitting || callReportSubmitting) return;
    if (aiCallActiveRef.current || String(roomIdRef.current || "").startsWith(AI_ROOM_ID_PREFIX)) {
      showAiRestrictionNotice("AI에게는 차단을 할 수 없습니다.");
      return;
    }
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    const rid = String(roomIdRef.current || "").trim();
    const peerUserId = String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("call.block.title"), t("common.auth_expired"));
      return;
    }
    if (!rid) {
      showGlobalModal(t("call.block.title"), t("call.block.no_call_info"));
      return;
    }

    setCallBlockSubmitting(true);
    try {
      const out = await blockCallPeerOnServer({
        token,
        userId,
        deviceKey,
        roomId: rid,
        peerSessionId: String(peerSessionIdRef.current || "").trim() || undefined,
        peerUserId: peerUserId || undefined,
        reasonCode: "USER_BLOCK_MANUAL",
        reasonLabel: t("call.block.reason_label"),
      });
      if (!out.ok) {
        const errCode = String(out.errorCode || "").toUpperCase();
        if (errCode === "CALL_BLOCK_ROUTE_NOT_FOUND") {
          showGlobalModal(t("call.block.title"), t("call.block.route_missing"));
        } else {
          showGlobalModal(t("call.block.title"), out.errorMessage || out.errorCode || t("call.block.submit_failed"));
        }
        return;
      }

      // Server-only block policy: treat block as success only after server list reflects it.
      const verify = await fetchCallBlockListOnServer({
        token,
        userId,
        deviceKey,
      });
      if (!verify.ok) {
        const errCode = String(verify.errorCode || "").toUpperCase();
        if (errCode === "CALL_BLOCK_LIST_ROUTE_NOT_FOUND") {
          showGlobalModal(t("call.block.title"), t("call.block.route_missing"));
        } else {
          showGlobalModal(t("call.block.title"), verify.errorMessage || verify.errorCode || t("call.block.submit_failed"));
        }
        return;
      }

      const peerSessionId = String(peerSessionIdRef.current || "").trim();
      const hasServerRecord = Array.isArray(verify.items)
        ? verify.items.some((row) => {
            const rowSession = String((row as any)?.peerSessionKey || "").trim();
            const rowUserId = String((row as any)?.peerUserId || "").trim();
            if (peerSessionId && rowSession && rowSession === peerSessionId) return true;
            if (peerUserId && rowUserId && rowUserId === peerUserId) return true;
            return false;
          })
        : false;

      if (!hasServerRecord) {
        showGlobalModal(t("call.block.title"), t("call.block.submit_failed"));
        return;
      }

      setCallReportModalVisible(false);
      setCallSafetyMenuVisible(false);
      showGlobalModal(t("call.block.done_title"), t("call.block.done_body"));
      setTimeout(() => {
        startRematchAfterCallSafety();
      }, 120);
    } finally {
      setCallBlockSubmitting(false);
    }
  }, [auth?.deviceKey, auth?.token, auth?.userId, callBlockSubmitting, callReportSubmitting, peerInfo, showAiRestrictionNotice, showGlobalModal, startRematchAfterCallSafety, t]);

  const onPressPopTalkCharge = useCallback(() => {
    closeAllPopTalkModals();
    if (phaseRef.current === "calling") {
      popTalkChargeInProgressRef.current = true;
      popTalkChargeGraceUntilRef.current = Date.now() + 3 * 60 * 1000;
      navigation.navigate("Shop", { initialTab: 0 });
      return;
    }
    stopAll(true);
    navigation.navigate("Shop", { initialTab: 0 });
  }, [closeAllPopTalkModals, navigation, stopAll]);

  const onPressPopTalkWait = useCallback(() => {
    closeAllPopTalkModals();
    popTalkChargeInProgressRef.current = false;
    popTalkChargeGraceUntilRef.current = 0;
    onExitToHome();
  }, [closeAllPopTalkModals, onExitToHome]);

  const onPressWatchPopTalkAd = useCallback(async () => {
    const out = await watchRewardedAdAndReward(POPTALK_REWARDED_AMOUNT, "call_rewarded_ad");
    if (out.ok) {
      popTalkChargeInProgressRef.current = false;
      popTalkChargeGraceUntilRef.current = 0;
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

  const onCloseBeautySheet = useCallback(() => {
    closeBeauty();
    const p = String(phaseRef.current || "");
    if (p === "connecting" || p === "queued" || p === "ended") {
      setMatchingActionsVisible(true);
    }
  }, [closeBeauty, setMatchingActionsVisible]);

  useEffect(() => {
    if (!isScreenFocused) return;
    if (!restoreMatchingActionsOnNextFocusRef.current) return;
    restoreMatchingActionsOnNextFocusRef.current = false;
    if (beautyOpenRef.current || beautyOpeningIntentRef.current) return;
    const p = String(phaseRef.current || "");
    if (p === "connecting" || p === "queued" || p === "ended") {
      setMatchingActionsVisible(true);
    }
  }, [isScreenFocused, setMatchingActionsVisible, beautyOpenRef, beautyOpeningIntentRef]);

  useEffect(() => {
    if (phase !== "calling") return;
    if (popTalkUnlimited) return;

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
        const isChargingGrace =
          popTalkChargeInProgressRef.current && Date.now() < popTalkChargeGraceUntilRef.current;

        if (!out.ok) {
          if (isChargingGrace) {
            await refreshPopTalk().catch(() => undefined);
            return;
          }
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
          if (isChargingGrace) {
            await refreshPopTalk().catch(() => undefined);
            return;
          }
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
  }, [consumePopTalk, phase, popTalkUnlimited, refreshPopTalk, showGlobalModal, stopAll, t]);

  const showQueueNativeAd =
    !isPremium &&
    (phase === "connecting" || phase === "queued") &&
    !aiCallActive &&
    !matchRevealActive &&
    !beautyOpen &&
    !beautyOpeningIntentRef.current;
  const shouldShiftMatchingCluster = false;

  return (
    <View style={styles.root}>
      <CallBeautySheet visible={beautyOpen} onClose={onCloseBeautySheet} config={beautyConfig} onConfigChange={setBeautyConfig} />


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
        showAiBadge={isAiPeer}
        signalUnstable={signalUnstable}
        insetsTop={insets.top}
        showSwipeGuide={showSwipeGuide}
        swipeGuideFrame={swipeGuideFrame}
        swipeDragTranslateX={swipeDragTranslateX}
        t={t}
        overlayLocalHeightCalling={OVERLAY_LOCAL_HEIGHT_CALLING}
        aiCallActive={aiCallActive}
        aiRemoteVideoPlayer={aiRemotePlayer}
      />

      {showQueueNativeAd ? (
        <View style={[styles.queueAdDock, { top: insets.top + 55 }]}>
          <QueueNativeAd256x144 styles={styles} width={W} onAdVisibleChange={setQueueNativeAdVisible} />
        </View>
      ) : null}

      {!beautyOpen && !beautyOpeningIntentRef.current ? (
        <MatchingOverlay
          styles={styles}
          phase={phase}
          matchRevealActive={matchRevealActive}
          matchRevealProgress={matchRevealProgress}
          reMatchText={reMatchText}
          authBooting={authBooting}
          fastMatchHint={fastMatchHint}
          matchingActionsVisible={matchingActionsVisible}
          roomId={roomId}
          peerInfo={peerInfo}
          shiftForTopNativeAd={shouldShiftMatchingCluster}
          onPressMatchingBeauty={onPressMatchingBeautyTracked}
          onPressMatchingFortune={onPressMatchingFortuneTracked}
          onPressMatchingGame={onPressMatchingGameTracked}
          onPressMatchingFilter={onPressMatchingFilterTracked}
          t={t}
        />
      ) : null}

      {giftFx ? (
        <View pointerEvents="none" style={styles.giftFxOverlay}>
          {giftFx.stage === "animating" ? (
            <Animated.View
              style={[
                styles.giftFxAnimWrap,
                {
                  opacity: giftFxOpacityAnimRef.current,
                  transform: [
                    { translateX: giftFxTranslateXAnimRef.current },
                    { translateY: giftFxTranslateYAnimRef.current },
                    { rotate: giftFxRotateDeg },
                    { scale: giftFxScaleAnimRef.current },
                  ],
                },
              ]}
            >
              <View
                style={[
                  styles.giftFxGlow,
                  { backgroundColor: giftFx.mode === "send" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.16)" },
                ]}
              />
              <Animated.View
                style={[
                  styles.giftFxPulseRing,
                  {
                    opacity: Animated.multiply(giftFxOpacityAnimRef.current, 0.58),
                    borderColor: giftFx.mode === "send" ? "rgba(255,255,255,0.92)" : "rgba(255,244,221,0.92)",
                    transform: [
                      {
                        scale:
                          giftFx.mode === "send"
                            ? Animated.add(0.78, Animated.multiply(giftFxScaleAnimRef.current, 0.55))
                            : Animated.add(0.84, Animated.multiply(giftFxScaleAnimRef.current, 0.32)),
                      },
                    ],
                  },
                ]}
              />
              {giftFx.mode === "receive" ? <View style={styles.giftFxCoreWhite} /> : null}
              <Animated.View
                style={[
                  styles.giftFxSparkLayer,
                  {
                    opacity: Animated.multiply(giftFxOpacityAnimRef.current, 0.88),
                    transform: [{ rotate: giftFxRotateDeg }],
                  },
                ]}
              >
                <Ionicons
                  name="sparkles"
                  size={14}
                  style={[styles.giftFxSpark, styles.giftFxSparkTop, giftFx.mode === "send" ? styles.giftFxSparkSend : styles.giftFxSparkReceive]}
                />
                <Ionicons
                  name="sparkles"
                  size={12}
                  style={[styles.giftFxSpark, styles.giftFxSparkRight, giftFx.mode === "send" ? styles.giftFxSparkSend : styles.giftFxSparkReceive]}
                />
                <Ionicons
                  name="sparkles"
                  size={11}
                  style={[styles.giftFxSpark, styles.giftFxSparkBottom, giftFx.mode === "send" ? styles.giftFxSparkSend : styles.giftFxSparkReceive]}
                />
                <Ionicons
                  name="sparkles"
                  size={13}
                  style={[styles.giftFxSpark, styles.giftFxSparkLeft, giftFx.mode === "send" ? styles.giftFxSparkSend : styles.giftFxSparkReceive]}
                />
              </Animated.View>
              <Image source={giftFx.image} resizeMode="contain" style={styles.giftFxImage} />
            </Animated.View>
          ) : null}

          {giftFx.mode === "receive" && giftFx.stage === "animating" ? (
            <Animated.View
              style={[
                styles.giftFxNoticeWrap,
                styles.giftFxNoticeRaised,
                {
                  opacity: giftFxNoticeOpacityAnimRef.current,
                },
              ]}
            >
              <AppText style={styles.giftFxNoticeText}>{giftFx.noticeText}</AppText>
            </Animated.View>
          ) : null}

          {giftFx.stage === "notice" ? (
            <Animated.View
              style={[
                styles.giftFxNoticeWrap,
                giftFx.mode === "send" ? styles.giftFxNoticeCenter : styles.giftFxNoticeRaised,
                {
                  opacity: giftFxNoticeOpacityAnimRef.current,
                },
              ]}
            >
              <AppText style={styles.giftFxNoticeText}>{giftFx.noticeText}</AppText>
            </Animated.View>
          ) : null}
        </View>
      ) : null}

      {phase === "calling" ? (
        <View pointerEvents="box-none" style={styles.topUiLayer}>
          <Pressable
            onPress={onPressTranslateToggle}
            hitSlop={12}
            style={({ pressed }) => [
              styles.callTranslateBtn,
              { top: topActionTranslateTop, right: 12 },
              liveTranslateEnabled ? styles.callTranslateBtnActive : null,
              pressed ? { opacity: 0.72 } : null,
            ]}
          >
            <Ionicons
              name={liveTranslateEnabled ? "earth" : "earth-outline"}
              size={22}
              color={liveTranslateEnabled ? "#5FE7FF" : "#FFFFFF"}
            />
          </Pressable>
          <Pressable
            onPress={goShop}
            hitSlop={12}
            style={({ pressed }) => [
              styles.shopBtn,
              { top: topActionShopTop, right: 12 },
              pressed ? { opacity: 0.72 } : null,
            ]}
          >
            <Ionicons name="cart-outline" size={24} color="#fff" />
          </Pressable>
          {liveTranslateEnabled ? (
            <View pointerEvents="none" style={[styles.liveTranslateStatusWrap, { top: topActionBadgeTop, right: 12 }]}>
              <AppText style={styles.liveTranslateStatusText}>{t("call.translate.active_label")}</AppText>
            </View>
          ) : null}
          <Pressable
            onPress={() => navigation.navigate("GiftBox", { mode: "send" })}
            hitSlop={12}
            style={({ pressed }) => [
              styles.giftSendBtn,
              { top: topActionGiftTop, right: 12 },
              pressed ? { opacity: 0.72 } : null,
            ]}
          >
            <Ionicons name="gift-outline" size={22} color="#FFFFFF" />
          </Pressable>
          <Pressable
            onPress={onPressCallSafetyButton}
            hitSlop={12}
            style={({ pressed }) => [
              styles.callSafetyBtn,
              { top: topActionSafetyTop, right: 12 },
              pressed || callSafetySubmitting ? { opacity: 0.72 } : null,
            ]}
          >
            <AppText style={styles.callSafetyBtnText}>{"⚠"}</AppText>
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
          controlsBottom={controlsBottom}
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
        onOpenMatchConditions={onOpenDelayedMatchConditions}
        matchingActionsVisible={matchingActionsVisible}
        onPressMatchingBeauty={onPressMatchingBeautyTracked}
        onPressMatchingFortune={onPressMatchingFortuneTracked}
        onPressMatchingGame={onPressMatchingGameTracked}
        onDismissMatchingActions={dismissMatchingActions}
        prefsModal={prefsModal}
        setPrefsModal={setPrefsModal}
        prefs={prefs}
        fontScale={fontScale}
        setFontScale={setFontScale}
      />

      <AppModal
        visible={Boolean(aiRestrictionNotice)}
        title={t("call.error_title")}
        dismissible={false}
        size="compact"
        onClose={() => undefined}
      >
        <AppText style={styles.modalText}>{aiRestrictionNotice}</AppText>
      </AppModal>

      <AppModal
        visible={translateUpsellModalVisible}
        title={t("call.translate.premium_title")}
        dismissible={true}
        onClose={closeTranslateUpsellModal}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("call.translate.premium_action")} onPress={onPressGoPremiumForTranslate} />
            <PrimaryButton title={t("common.close")} variant="ghost" onPress={closeTranslateUpsellModal} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.translate.premium_desc")}</AppText>
      </AppModal>

      <AppModal
        visible={matchFilterUpsellModalVisible}
        title={t("call.match_filter.premium_title")}
        dismissible={true}
        onClose={closeMatchFilterUpsellModal}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("call.match_filter.premium_action")} onPress={onPressGoPremiumForMatchFilter} />
            <PrimaryButton title={t("common.close")} variant="ghost" onPress={closeMatchFilterUpsellModal} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.match_filter.premium_desc")}</AppText>
      </AppModal>

      <AppModal
        visible={matchFilterModalVisible}
        title={t("call.match_filter.title")}
        dismissible={!matchFilterSaving}
        onClose={closeMatchFilterModal}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton
              title={matchFilterSaving ? t("common.loading") : t("common.save")}
              disabled={matchFilterSaving}
              onPress={onPressSaveMatchFilter}
            />
            <PrimaryButton title={t("common.close")} variant="ghost" disabled={matchFilterSaving} onPress={closeMatchFilterModal} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.match_filter.desc")}</AppText>
        {matchFilterLoading ? <AppText style={styles.modalText}>{t("common.loading")}</AppText> : null}
        <ScrollView style={styles.matchFilterScroll} contentContainerStyle={styles.matchFilterScrollContent} showsVerticalScrollIndicator={false}>
          <AppText style={styles.sectionTitle}>{t("call.match_filter.country_title")}</AppText>
          <View style={styles.matchFilterCountryOptionWrap}>
            <Pressable
              onPress={() => toggleMatchFilterCountries(MATCH_FILTER_ALL)}
              style={({ pressed }) => [
                styles.matchFilterOption,
                styles.matchFilterCountryOption,
                normalizedMatchFilterDraft.countries.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionActive : null,
                pressed ? styles.matchFilterOptionPressed : null,
              ]}
            >
              <AppText
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.matchFilterOptionText,
                  styles.matchFilterCountryOptionText,
                  normalizedMatchFilterDraft.countries.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionTextActive : null,
                ]}
              >
                {t("call.match_filter.any_option")}
              </AppText>
            </Pressable>
            {matchFilterCountryOptions.map((opt) => {
              const active = normalizedMatchFilterDraft.countries.includes(opt.code);
              return (
                <Pressable
                  key={`match_filter_country_${opt.code}`}
                  onPress={() => toggleMatchFilterCountries(opt.code)}
                  style={({ pressed }) => [
                    styles.matchFilterOption,
                    styles.matchFilterCountryOption,
                    active ? styles.matchFilterOptionActive : null,
                    pressed ? styles.matchFilterOptionPressed : null,
                  ]}
                >
                  <AppText
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.matchFilterOptionText, styles.matchFilterCountryOptionText, active ? styles.matchFilterOptionTextActive : null]}
                  >
                    {opt.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText style={styles.sectionTitle}>{t("call.match_filter.language_title")}</AppText>
          <View style={styles.matchFilterLanguageOptionWrap}>
            <Pressable
              onPress={() => toggleMatchFilterLanguages(MATCH_FILTER_ALL)}
              style={({ pressed }) => [
                styles.matchFilterOption,
                styles.matchFilterLanguageOption,
                normalizedMatchFilterDraft.languages.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionActive : null,
                pressed ? styles.matchFilterOptionPressed : null,
              ]}
            >
              <AppText
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.matchFilterOptionText,
                  styles.matchFilterLanguageOptionText,
                  normalizedMatchFilterDraft.languages.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionTextActive : null,
                ]}
              >
                {t("call.match_filter.any_option")}
              </AppText>
            </Pressable>
            {matchFilterLanguageOptions.map((opt) => {
              const active = normalizedMatchFilterDraft.languages.includes(opt.code);
              return (
                <Pressable
                  key={`match_filter_lang_${opt.code}`}
                  onPress={() => toggleMatchFilterLanguages(opt.code)}
                  style={({ pressed }) => [
                    styles.matchFilterOption,
                    styles.matchFilterLanguageOption,
                    active ? styles.matchFilterOptionActive : null,
                    pressed ? styles.matchFilterOptionPressed : null,
                  ]}
                >
                  <AppText
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.matchFilterOptionText, styles.matchFilterLanguageOptionText, active ? styles.matchFilterOptionTextActive : null]}
                  >
                    {opt.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText style={styles.sectionTitle}>{t("call.match_filter.gender_title")}</AppText>
          <View style={styles.matchFilterOptionWrap}>
            {(["male", "female", "all"] as MatchFilterGender[]).map((opt) => {
              const key = opt === "male" ? "gender.male" : opt === "female" ? "gender.female" : "call.match_filter.gender_all";
              const active = normalizedMatchFilterDraft.gender === opt;
              return (
                <Pressable
                  key={`match_filter_gender_${opt}`}
                  onPress={() => setMatchFilterGender(opt)}
                  style={({ pressed }) => [
                    styles.matchFilterOption,
                    active ? styles.matchFilterOptionActive : null,
                    pressed ? styles.matchFilterOptionPressed : null,
                  ]}
                >
                  <AppText style={[styles.matchFilterOptionText, active ? styles.matchFilterOptionTextActive : null]}>{t(key)}</AppText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </AppModal>

      <AppModal
        visible={callSafetyMenuVisible}
        title={t("call.safety.menu_title")}
        dismissible={!callSafetySubmitting}
        onClose={closeCallSafetyModals}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton
              title={t("call.report.action")}
              variant="danger"
              disabled={callSafetySubmitting}
              onPress={onPressOpenCallReport}
            />
            <PrimaryButton
              title={callBlockSubmitting ? t("call.block.processing") : t("call.block.action")}
              variant="danger"
              disabled={callSafetySubmitting}
              onPress={onPressConfirmCallBlock}
            />
            <PrimaryButton title={t("common.close")} variant="ghost" disabled={callSafetySubmitting} onPress={closeCallSafetyModals} />
          </View>
        }
      >
        <AppText style={styles.callSafetyGuideText}>
          {t("call.safety.guide")}
        </AppText>
      </AppModal>

      <AppModal
        visible={callReportModalVisible}
        title={t("call.report.reason_title")}
        dismissible={!callReportSubmitting}
        onClose={closeCallSafetyModals}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton
              title={callReportSubmitting ? t("call.report.submitting") : t("call.report.action")}
              variant="danger"
              disabled={callReportSubmitting}
              onPress={onPressConfirmCallReport}
            />
            <PrimaryButton title={t("common.cancel")} variant="ghost" disabled={callReportSubmitting} onPress={closeCallSafetyModals} />
          </View>
        }
      >
        <ScrollView
          style={styles.callReportReasonScroll}
          contentContainerStyle={styles.callReportReasonList}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          {callReportReasons.map((row) => {
            const selected = row.code === (selectedCallReportReason?.code || "");
            return (
              <Pressable
                key={`call_report_reason_${row.code}`}
                disabled={callReportSubmitting}
                onPress={() => setCallReportReasonCode(row.code)}
                style={({ pressed }) => [
                  styles.callReportReasonRow,
                  selected ? styles.callReportReasonRowActive : null,
                  pressed ? { opacity: 0.78 } : null,
                ]}
              >
                <View style={styles.callReportReasonTextWrap}>
                  <AppText style={[styles.callReportReasonTitle, selected ? styles.callReportReasonTitleActive : null]}>
                    {row.label}
                  </AppText>
                  <AppText style={styles.callReportReasonDescription}>{row.description}</AppText>
                </View>
                <Ionicons
                  name={selected ? "radio-button-on" : "radio-button-off"}
                  size={18}
                  color={selected ? "#B01E56" : "#8B8D96"}
                />
              </Pressable>
            );
          })}
        </ScrollView>
      </AppModal>

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
          {popTalkBalanceLine}
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
          {popTalkBalanceLine}
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
          {popTalkBalanceLine}
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

