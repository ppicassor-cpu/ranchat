// FILE: C:\ranchat\src\screens\CallScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Animated, Easing, View, BackHandler, Pressable, Image, ScrollView, AppState, InteractionManager, type AppStateStatus, type ImageSourcePropType } from "react-native";
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
import {
  fetchCallContactsOnServer,
  fetchRecallInviteStatusOnServer,
  recallCallContactOnServer,
  respondRecallInviteOnServer,
  setCallFriendOnServer,
  type CallContactItem,
} from "../services/call/CallContactService";
import { fetchAiReplyOnServer } from "../services/ai/AiChatService";
import {
  fetchMatchFilterOnServer,
  saveMatchFilterOnServer,
  normalizeMatchFilter,
  createDefaultMatchFilter,
  MATCH_FILTER_ALL,
  MATCH_INTEREST_OPTIONS,
  type MatchFilter,
  type MatchFilterGender,
} from "../services/call/MatchFilterService";
import { translatePeerChatOnServer } from "../services/translate/RealtimeTranslateService";
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageName, normalizeLanguageCode } from "../i18n/displayNames";
import { countryCodeToFlagEmoji } from "../utils/countryUtils";
import { formatDisplayName, resolveDisplayName } from "../utils/displayName";
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

type ActiveUsersSnapshot = {
  activeUsers: number;
  queuedUsers: number;
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
const AI_INITIAL_GREETING_DELAY_MS = 1500;
const AI_SERVER_REPLY_TIMEOUT_MS = 12000;
const AI_IDLE_NUDGE_DELAY_MS = 15000;
const AI_IDLE_NUDGE_REPLY_PENDING_GRACE_MS = AI_SERVER_REPLY_TIMEOUT_MS + 5000;
const AI_INITIAL_GREETING_TEXTS: Record<string, string> = {
  ko: "안녕 반가워. 카메라에 내 얼굴 잘 보여?",
  fr: "Salut, ravi de te rencontrer. Tu vois bien mon visage a la camera ?",
  en: "Hi, nice to meet you. Can you see my face clearly on camera?",
};
const AI_IDLE_NUDGE_TEXTS: Record<string, string[]> = {
  ko: [
    "뭐해? 갑자기 조용해졌네. 아무 말이나 해줘.",
    "왜 말이 없어? 오늘 있었던 일 하나만 말해봐.",
    "나 듣고 있는데 조용하네. 요즘 뭐에 꽂혀 있어?",
    "잠깐 딴 데 보고 왔어? 한마디라도 해줘.",
  ],
  fr: [
    "Tu fais quoi ? Tu es devenu super silencieux d'un coup.",
    "Pourquoi tu ne dis rien ? Dis-moi juste un petit truc.",
    "Je suis toujours la. Raconte-moi un detail de ta journee.",
    "Petit blanc total... tu pensais a quoi ?",
  ],
  en: [
    "What are you up to? You got quiet all of a sudden.",
    "Why so quiet? Tell me even one small thing.",
    "I am still here. Give me one random detail about your day.",
    "That got silent fast. What are you thinking about?",
  ],
};

const AI_HISTORY_TRANSLATION_PREFIXES = ["translation", "translated", "번역", "traduction", "翻訳", "翻译"];

function normalizeCallLanguage(value: string | null | undefined): string {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const normalized = normalizeLanguageCode(raw);
  if (normalized) return normalized;
  const short = raw.split(/[_-]/)[0];
  return normalizeLanguageCode(short) || short;
}

function formatCallDisplayName(value: unknown, fallback = ""): string {
  return formatDisplayName(value, fallback);
}

function normalizeAiLocalCompareKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\u00c0-\u024f]+/g, " ")
    .trim();
}

function stripTranslatedChatText(text: string, translatePrefix?: string): string {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  if (lines.length < 2) return raw;
  const lastLine = String(lines[lines.length - 1] || "").trim();
  if (!lastLine) return raw;
  const labels = new Set(
    [translatePrefix, ...AI_HISTORY_TRANSLATION_PREFIXES]
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value) => value.length > 0)
  );
  const isTranslationLine = Array.from(labels).some((label) => lastLine.toLowerCase().startsWith(`${label}:`));
  if (!isTranslationLine) return raw;
  return lines.slice(0, -1).join("\n").trim();
}

function getAiIdleNudgeDelayMs(): number {
  return AI_IDLE_NUDGE_DELAY_MS;
}

function getAiInitialGreeting(language: string): string {
  const lang = String(language || "").trim().toLowerCase();
  return AI_INITIAL_GREETING_TEXTS[lang] || AI_INITIAL_GREETING_TEXTS.en;
}

function pickAiIdleNudgeFallback(language: string): string {
  const lang = String(language || "").trim().toLowerCase();
  const list = AI_IDLE_NUDGE_TEXTS[lang] || AI_IDLE_NUDGE_TEXTS.en;
  return list[Math.floor(Math.random() * list.length)] || list[0] || "Say something. I am listening.";
}

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
    country: "JP",
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
  getLocalAudioLevel: () => Promise<number>;
};

function createLocalAiRtcStub(): LocalAiRtcStub {
  return {
    stop: () => {},
    sendChatMessage: (text: string) => String(text || "").trim().length > 0,
    setLocalVideoEnabled: () => {},
    setLocalAudioEnabled: () => {},
    getLocalAudioLevel: async () => 0,
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

export default function CallScreen({ navigation, route }: Props) {

  const insets = useSafeAreaInsets();
  const { t, currentLang } = useTranslation();
  const isScreenFocused = useIsFocused();

  const prefs = useAppStore((s) => s.prefs);
  const isPremium = useAppStore((s) => s.sub.isPremium);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const auth = useAppStore((s: any) => s.auth);
  const profile = useAppStore((s: any) => s.profile);
  const popTalk = useAppStore((s: any) => s.popTalk);
  const persistedCallCamOn = useAppStore((s: any) => Boolean((s?.ui as any)?.callCamOn ?? true));
  const persistedCallMicOn = useAppStore((s: any) => Boolean((s?.ui as any)?.callMicOn ?? true));
  const persistedCallSpeakerOn = useAppStore((s: any) => Boolean((s?.ui as any)?.callSpeakerOn ?? true));
  const setAssets = useAppStore((s: any) => s.setAssets);
  const setShop = useAppStore((s: any) => s.setShop);
  const setCallMediaPrefs = useAppStore((s: any) => s.setCallMediaPrefs);
  const aiMatchingDisabledByUser = useAppStore((s: any) => (s?.ui as any)?.aiMatchingDisabledByUser || {});
  const setAiMatchingDisabledForUser = useAppStore((s: any) => s.setAiMatchingDisabledForUser);
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
  const [remoteMuted, setRemoteMuted] = useState<boolean>(() => !persistedCallSpeakerOn);
  const [peerSoundOn, setPeerSoundOn] = useState(true);
  const [aiCallActive, setAiCallActive] = useState(false);
  const [aiProfileIndex, setAiProfileIndex] = useState(0);
  const [mediaSurfaceEpoch, setMediaSurfaceEpoch] = useState(0);
  const localMicLevelAnim = useRef(new Animated.Value(0)).current;
  const remoteMicLevelAnim = useRef(new Animated.Value(0)).current;
  const localMicActivityLevelRef = useRef(0);
  const remoteMicActivityLevelRef = useRef(0);
  const peerMicSignalLevelRef = useRef(0);
  const peerMicSignalAtRef = useRef(0);
  const lastSentMicSignalLevelRef = useRef(-1);
  const lastSentMicSignalAtRef = useRef(0);
  const lastSentMicSignalEnabledRef = useRef(true);

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
  const [popTalkSyncFailedModal, setPopTalkSyncFailedModal] = useState(false);
  const [popTalkAdFailModal, setPopTalkAdFailModal] = useState(false);
  const [popTalkAdFailCount, setPopTalkAdFailCount] = useState(0);
  const [popTalkRewardAdBusy, setPopTalkRewardAdBusy] = useState(false);
  const [popTalkShortageModalSuppressUntil, setPopTalkShortageModalSuppressUntil] = useState(0);
  const popTalkRewardAdBusyRef = useRef(false);
  const [aiRestrictionNotice, setAiRestrictionNotice] = useState("");
  const [callSafetyMenuVisible, setCallSafetyMenuVisible] = useState(false);
  const [aiMatchStopConfirmVisible, setAiMatchStopConfirmVisible] = useState(false);
  const [aiRetryAllowConfirmVisible, setAiRetryAllowConfirmVisible] = useState(false);
  const [callReportModalVisible, setCallReportModalVisible] = useState(false);
  const [callReportReasonCode, setCallReportReasonCode] = useState<string>(CALL_REPORT_REASONS[0]?.code || "");
  const [callReportSubmitting, setCallReportSubmitting] = useState(false);
  const [callBlockSubmitting, setCallBlockSubmitting] = useState(false);
  const [liveTranslateEnabled, setLiveTranslateEnabled] = useState(false);
  const [translateNotice, setTranslateNotice] = useState("");
  const [translateUpsellModalVisible, setTranslateUpsellModalVisible] = useState(false);
  const [matchFilterModalVisible, setMatchFilterModalVisible] = useState(false);
  const [matchFilterUpsellModalVisible, setMatchFilterUpsellModalVisible] = useState(false);
  const [matchFilterDraft, setMatchFilterDraft] = useState<MatchFilter>(() => createDefaultMatchFilter());
  const [matchFilterLoading, setMatchFilterLoading] = useState(false);
  const [matchFilterSaving, setMatchFilterSaving] = useState(false);
  const [callContactsModalVisible, setCallContactsModalVisible] = useState(false);
  const [callContactsLoading, setCallContactsLoading] = useState(false);
  const [callContacts, setCallContacts] = useState<CallContactItem[]>([]);
  const [callFriendAdded, setCallFriendAdded] = useState(false);
  const [callContactMutating, setCallContactMutating] = useState<"" | "friend" | "favorite" | "recall">("");
  const [callDisconnectModalVisible, setCallDisconnectModalVisible] = useState(false);

  const wsRef = useRef<SignalClient | null>(null);
  const rtcRef = useRef<WebRTCSession | null>(null);
  const localStreamRef = useRef<any>(null);
  const previewStreamRef = useRef<any>(null);
  const previewOpeningRef = useRef(false);
  const remoteStreamRef = useRef<any>(null);
  const clearLocalPreviewStreamRef = useRef<() => void>(() => {});
  const callDebitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callContactsLoadSeqRef = useRef(0);
  const callContactsStateSeqRef = useRef(0);
  const appResumeMediaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mediaRecoveryInFlightRef = useRef(false);
  const hasLiveVideoTrackRef = useRef<(stream: any) => boolean>(() => false);
  const refreshLocalPreviewStreamRef = useRef<() => Promise<boolean>>(async () => false);
  const aiChatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiIdleNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiRestrictionNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const translateNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callDebitInFlightRef = useRef(false);
  const popTalkLowPrevRef = useRef<number>(Number(popTalk?.balance ?? 0));
  const popTalkEmptyHandledRef = useRef(false);
  const popTalkChargeInProgressRef = useRef(false);
  const popTalkChargeGraceUntilRef = useRef(0);
  const restoreMatchingActionsOnNextFocusRef = useRef(false);
  const restartMatchingActionsAfterBeautyCloseRef = useRef(false);

  const pendingSignalRef = useRef<{ type: "offer" | "answer" | "ice"; sdp?: any; candidate?: any }[]>([]);
  const endCallAndRequeueRef = useRef<(why: "remote_left" | "disconnect" | "error" | "find_other") => void>(() => {});

  const beginCallGuardRef = useRef(false);
  const callStartTokenRef = useRef(0);

  const enqueuedRef = useRef(false);
  const queueRunningRef = useRef(false);

  const requeueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reMatchTextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canStart = useRef(false);

  const [peerInfo, setPeerInfo] = useState<any>(null);
  const phaseRef = useRef<Phase>("connecting");
  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);
  const roomIdRef = useRef<string | null>(null);
  const isCallerRef = useRef(false);
  const peerSessionIdRef = useRef<string | null>(null);
  const myCamOnRef = useRef<boolean>(true);
  const mySoundOnRef = useRef<boolean>(true);
  const remoteMutedRef = useRef<boolean>(false);
  const isScreenFocusedRef = useRef<boolean>(true);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const aiCallActiveRef = useRef(false);
  const aiLastObservedChatIdRef = useRef("");
  const aiReplyQueueRef = useRef<Promise<void>>(Promise.resolve());
  const aiLastUserChatAtRef = useRef(0);
  const aiReplyPendingCountRef = useRef(0);
  const aiIdleNudgeBlockedUntilRef = useRef(0);
  const aiMatchActionKeysRef = useRef<Set<string>>(new Set());
  const aiMatchLastActionAtRef = useRef(0);
  const aiMatchActionQueueTokenRef = useRef(-1);
  const aiMatchInFlightRef = useRef(false);
  const aiSyntheticProfileCursorRef = useRef(0);
  const aiEligibleActiveUsersRef = useRef<number>(Number.POSITIVE_INFINITY);
  const aiMatchingDisabledRef = useRef(false);

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

  function showTranslateNotice(message: string) {
    const text = String(message || "").trim();
    if (!text) return;
    setTranslateNotice(text);
    if (translateNoticeTimerRef.current) {
      clearTimeout(translateNoticeTimerRef.current);
      translateNoticeTimerRef.current = null;
    }
    translateNoticeTimerRef.current = setTimeout(() => {
      translateNoticeTimerRef.current = null;
      setTranslateNotice("");
    }, 1800);
  }

  const clearReMatchTextTimer = useCallback(() => {
    if (reMatchTextTimerRef.current) {
      clearTimeout(reMatchTextTimerRef.current);
      reMatchTextTimerRef.current = null;
    }
  }, []);

  const clearOutgoingRecallDelayTimer = useCallback(() => {
    if (outgoingRecallDelayTimerRef.current) {
      clearTimeout(outgoingRecallDelayTimerRef.current);
      outgoingRecallDelayTimerRef.current = null;
    }
  }, []);

  const queueTokenRef = useRef(0);
  const matchedSignalTokenRef = useRef(0);
  const myPeerInfoNonceRef = useRef("");
  const beginCallReqRef = useRef<{ ws: SignalClient; rid: string; caller: boolean; qTok: number } | null>(null);
  const peerReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const webrtcConnectedRef = useRef(false);
  const webrtcConnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const endCallOnceRef = useRef(-1);
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
  const currentLangRef = useRef<string>(normalizeCallLanguage(currentLang) || "ko");
  const translatePrefixRef = useRef<string>(String(t("call.translate.prefix") || "번역"));
  const authRef = useRef<any>(auth);
  const peerLanguageRef = useRef("");
  const translateDetectedPeerLanguageRef = useRef("");
  const appendChatMessageRef = useRef<(mine: boolean, message: string) => void>(() => {});
  const translateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const translateCacheRef = useRef<Map<string, string>>(new Map());
  const matchFilterRef = useRef<MatchFilter>(createDefaultMatchFilter());

  const [signalUnstable, setSignalUnstable] = useState(false);
  const [callTransportReady, setCallTransportReady] = useState(false);
  const [outgoingRecallAwaitingAccept, setOutgoingRecallAwaitingAccept] = useState(false);
  const [outgoingRecallInviteId, setOutgoingRecallInviteId] = useState("");
  const [outgoingRecallDelayModalVisible, setOutgoingRecallDelayModalVisible] = useState(false);
  const [outgoingRecallResultModal, setOutgoingRecallResultModal] = useState<{ title: string; body: string } | null>(null);
  const [recallAcceptedModalVisible, setRecallAcceptedModalVisible] = useState(false);
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
  const outgoingRecallDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingRecallTargetRef = useRef<{ peerSessionId?: string; peerProfileId?: string } | null>(null);
  const recallAcceptedHeartTiltAnimRef = useRef(new Animated.Value(0));
  const recallAcceptedHeartScaleAnimRef = useRef(new Animated.Value(1));
  const recallAcceptedHeartLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const recallAcceptedRevealPlayedRef = useRef(false);
  const outgoingRecallDelayShownRef = useRef(false);
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
  const getEffectivePeerLanguage = useCallback(() => {
    const fallbackAiLanguage = aiCallActiveRef.current ? String(activeAiProfile?.language || "") : "";
    return normalizeCallLanguage(peerLanguageRef.current || translateDetectedPeerLanguageRef.current || fallbackAiLanguage);
  }, [activeAiProfile]);
  const aiRemotePlayer = useMemo(
    () => (normalizedAiProfileIndex === 1 ? aiRemotePlayerKr : aiRemotePlayerFr),
    [aiRemotePlayerFr, aiRemotePlayerKr, normalizedAiProfileIndex]
  );

  const refreshCallMediaSurfaces = useCallback(() => {
    const currentPhase = String(phaseRef.current || "");
    if (currentPhase !== "matched" && currentPhase !== "calling") return;

    setMediaSurfaceEpoch((prev) => prev + 1);

    try {
      const local = localStreamRef.current as any;
      const localUrl = typeof local?.toURL === "function" ? String(local.toURL() || "") : "";
      if (localUrl) setLocalStreamURL(localUrl);
    } catch {}

    try {
      const remote = remoteStreamRef.current as any;
      const remoteUrl = typeof remote?.toURL === "function" ? String(remote.toURL() || "") : "";
      if (remoteUrl) setRemoteStreamURL(remoteUrl);
    } catch {}

    requestAnimationFrame(() => {
      try {
        aiRemotePlayerFr.play();
      } catch {}
      try {
        aiRemotePlayerKr.play();
      } catch {}
    });
  }, [aiRemotePlayerFr, aiRemotePlayerKr]);

  const recoverForegroundCallMedia = useCallback(async () => {
    const currentPhase = String(phaseRef.current || "");
    if (currentPhase !== "matched" && currentPhase !== "calling") return;

    if (mediaRecoveryInFlightRef.current) {
      refreshCallMediaSurfaces();
      return;
    }

    mediaRecoveryInFlightRef.current = true;
    try {
      if (aiCallActiveRef.current) {
        const shouldRefreshPreview =
          Boolean(myCamOnRef.current) ||
          !hasLiveVideoTrackRef.current(localStreamRef.current) ||
          !hasLiveVideoTrackRef.current(previewStreamRef.current);
        if (shouldRefreshPreview) {
          await refreshLocalPreviewStreamRef.current().catch(() => false);
        }
      } else {
        await rtcRef.current?.refreshLocalMedia?.({
          videoEnabled: Boolean(myCamOnRef.current),
          audioEnabled: Boolean(mySoundOnRef.current),
        });
      }
    } catch {}
    finally {
      refreshCallMediaSurfaces();
      mediaRecoveryInFlightRef.current = false;
    }
  }, [refreshCallMediaSurfaces]);

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

      showGlobalModal(t("poptalk.sync_failed_title"), t("poptalk.sync_failed"));
      return false;
    },
    [consumePopTalk, popTalkUnlimited, showGlobalModal, t]
  );
  const myChatDisplayName = useMemo(() => {
    return formatCallDisplayName(profile?.nickname, String(t("call.chat_me_label") || "나").trim() || "나");
  }, [profile?.nickname, t]);
  const myChatAvatarUrl = useMemo(() => {
    const avatarUrl = String(profile?.avatarUrl || "").trim();
    return avatarUrl || null;
  }, [profile?.avatarUrl]);
  const peerChatDisplayName = useMemo(() => {
    const isAiTarget = aiCallActive || Boolean((peerInfo as any)?.ai || (peerInfo as any)?.isAi);
    const fallback = isAiTarget
      ? String(t("call.chat_ai_label") || "AI").trim() || "AI"
      : String(t("call.chat_peer_label") || "상대").trim() || "상대";
    return resolveDisplayName({
      nickname: (peerInfo as any)?.nickname,
      loginAccount: (peerInfo as any)?.loginAccount,
      email: (peerInfo as any)?.email,
      userId: (peerInfo as any)?.userId || (peerInfo as any)?.uid,
      profileId: (peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId,
      displayName: (peerInfo as any)?.displayName,
      name: (peerInfo as any)?.name,
      fallback,
    });
  }, [aiCallActive, peerInfo, t]);
  const peerDisplayName = useMemo(
    () =>
      formatCallDisplayName(
        peerChatDisplayName,
        aiCallActive || Boolean((peerInfo as any)?.ai || (peerInfo as any)?.isAi)
          ? String(t("call.chat_ai_label") || "AI").trim() || "AI"
          : String(t("call.chat_peer_label") || "상대").trim() || "상대"
      ),
    [aiCallActive, peerChatDisplayName, peerInfo, t]
  );
  const peerChatAvatarUrl = useMemo(() => {
    const avatarUrl = String((peerInfo as any)?.avatarUrl || (peerInfo as any)?.avatarDataUrl || "").trim();
    return avatarUrl || null;
  }, [peerInfo]);
  const resolveChatMessageProfile = useCallback(
    (mine: boolean) => {
      if (mine) {
        return {
          displayName: myChatDisplayName,
          avatarUrl: myChatAvatarUrl,
        };
      }
      return {
        displayName: peerDisplayName,
        avatarUrl: peerChatAvatarUrl,
      };
    },
    [myChatAvatarUrl, myChatDisplayName, peerChatAvatarUrl, peerDisplayName]
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
    resolveChatMessageProfile,
  });
  const aiChatMessagesRef = useRef<typeof chatMessages>([]);

  useEffect(() => {
    appendChatMessageRef.current = appendChatMessage;
  }, [appendChatMessage]);

  useEffect(() => {
    aiChatMessagesRef.current = chatMessages;
  }, [chatMessages]);

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
    currentLangRef.current = normalizeCallLanguage(currentLang) || "ko";
  }, [currentLang]);

  useEffect(() => {
    translatePrefixRef.current = String(t("call.translate.prefix") || "번역").trim() || "번역";
  }, [currentLang, t]);

  useEffect(() => {
    authRef.current = auth;
  }, [auth]);

  useEffect(() => {
    peerLanguageRef.current = normalizeCallLanguage((peerInfo as any)?.language || (peerInfo as any)?.lang || "");
    if (peerLanguageRef.current) {
      translateDetectedPeerLanguageRef.current = "";
    }
  }, [peerInfo]);

  useEffect(() => {
    if (!liveTranslateEnabled) return;
    const targetLang = normalizeCallLanguage(currentLangRef.current || "ko") || "ko";
    const sourceLang = getEffectivePeerLanguage();
    if (!sourceLang || sourceLang !== targetLang) return;
    setLiveTranslateEnabled(false);
    showTranslateNotice(t("call.translate.same_language_notice"));
  }, [currentLang, getEffectivePeerLanguage, liveTranslateEnabled, peerInfo, t]);

  const consumeReceiveTranslateCost = useCallback(async () => {
    if (popTalkUnlimited) return true;
    const out = await consumePopTalk(
      POPTALK_CHAT_TRANSLATE_RECEIVE_COST_PER_MESSAGE,
      "chat_receive_translate",
      `${Date.now()}_${Math.random().toString(16).slice(2)}`
    );
    return Boolean(out.ok);
  }, [consumePopTalk, popTalkUnlimited]);

  const appendIncomingPeerChatMessage = useCallback((message: string, sourceLangOverride?: string | null) => {
    const rawText = String(message || "").trim();
    if (!rawText) return;

    translateQueueRef.current = translateQueueRef.current
      .then(async () => {
        const append = appendChatMessageRef.current;
        if (!isPremiumRef.current || !liveTranslateEnabledRef.current || rawText.startsWith("[GIFT]")) {
          append(false, rawText);
          return;
        }

        const targetLang = normalizeCallLanguage(currentLangRef.current || "ko") || "ko";
        const sourceLang = normalizeCallLanguage(sourceLangOverride || "") || getEffectivePeerLanguage();
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

        const detectedSourceLang = normalizeCallLanguage(out.detectedSourceLang || "");
        if (!sourceLang && detectedSourceLang && detectedSourceLang !== targetLang) {
          translateDetectedPeerLanguageRef.current = detectedSourceLang;
        }

        const translated = String(out.translatedText || "").trim();
        let canShowTranslation =
          Boolean(out.ok && translated) &&
          normalizeAiLocalCompareKey(translated) !== normalizeAiLocalCompareKey(rawText);
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
  }, [consumeReceiveTranslateCost, getEffectivePeerLanguage]);

  const appendIncomingRuntimeMessage = useCallback(
    (mine: boolean, message: string, sourceLangOverride?: string | null) => {
      if (mine) {
        appendChatMessageRef.current(true, message);
        return;
      }
      appendIncomingPeerChatMessage(message, sourceLangOverride);
    },
    [appendIncomingPeerChatMessage]
  );

  const buildAiReplyHistory = useCallback((rows: typeof chatMessages, excludeLatestMine = false) => {
    const sourceRows = excludeLatestMine ? rows.slice(0, -1) : rows.slice();
    const normalized = sourceRows
      .map((row) => ({
        mine: Boolean(row && row.mine),
        text: stripTranslatedChatText(String((row && row.text) || "").trim(), translatePrefixRef.current),
      }))
      .filter((row) => row.text.length > 0 && !/^\[GIFT\]\s*/.test(row.text));
    const maxMine = excludeLatestMine ? 3 : 4;
    let myCount = 0;
    let peerCount = 0;
    const picked: typeof normalized = [];
    for (let i = normalized.length - 1; i >= 0; i -= 1) {
      const row = normalized[i];
      if (row.mine) {
        if (myCount >= maxMine) continue;
        myCount += 1;
        picked.push(row);
        continue;
      }
      if (peerCount >= 4) continue;
      peerCount += 1;
      picked.push(row);
    }
    return picked.reverse();
  }, []);

  const clearAiChatTimer = useCallback(() => {
    if (!aiChatTimerRef.current) return;
    clearTimeout(aiChatTimerRef.current);
    aiChatTimerRef.current = null;
  }, []);

  const clearAiIdleNudgeTimer = useCallback(() => {
    if (!aiIdleNudgeTimerRef.current) return;
    clearTimeout(aiIdleNudgeTimerRef.current);
    aiIdleNudgeTimerRef.current = null;
  }, []);

  const scheduleAiIdleNudge = useCallback(() => {
    clearAiIdleNudgeTimer();
    if (!aiCallActiveRef.current) return;
    if (phaseRef.current !== "calling") return;

    const qTok = queueTokenRef.current;
    const delayMs = getAiIdleNudgeDelayMs();
    aiIdleNudgeTimerRef.current = setTimeout(() => {
      aiIdleNudgeTimerRef.current = null;
      if (!aiCallActiveRef.current) return;
      if (phaseRef.current !== "calling") return;
      if (queueTokenRef.current !== qTok) return;
      if (aiReplyPendingCountRef.current > 0) {
        scheduleAiIdleNudge();
        return;
      }

      const blockedUntil = Number(aiIdleNudgeBlockedUntilRef.current || 0);
      if (blockedUntil > Date.now()) {
        scheduleAiIdleNudge();
        return;
      }

      const lastUserChatAt = Number(aiLastUserChatAtRef.current || 0);
      if (lastUserChatAt > 0 && Date.now() - lastUserChatAt < AI_IDLE_NUDGE_DELAY_MS) {
        scheduleAiIdleNudge();
        return;
      }

      const aiLanguage = normalizeCallLanguage(activeAiProfile?.language || currentLangRef.current || "en") || "en";
      aiReplyQueueRef.current = aiReplyQueueRef.current
        .then(async () => {
          if (!aiCallActiveRef.current) return;
          if (phaseRef.current !== "calling") return;
          if (queueTokenRef.current !== qTok) return;

          const authNow = authRef.current;
          const out = await fetchAiReplyOnServer({
            token: String(authNow?.token || ""),
            userId: String(authNow?.userId || ""),
            deviceKey: String(authNow?.deviceKey || ""),
            roomId: String(roomIdRef.current || ""),
            language: aiLanguage,
            personaKey: String(activeAiProfile?.key || ""),
            lockOutputLanguage: aiLanguage === "fr",
            mode: "nudge",
            message: "",
            history: buildAiReplyHistory(aiChatMessagesRef.current, false),
            timeoutMs: AI_SERVER_REPLY_TIMEOUT_MS,
          });

          if (!aiCallActiveRef.current) return;
          if (phaseRef.current !== "calling") return;
          if (queueTokenRef.current !== qTok) return;

          const line = String(out.replyText || "").trim() || pickAiIdleNudgeFallback(aiLanguage);
          appendIncomingRuntimeMessage(false, line, aiLanguage);
          scheduleAiIdleNudge();
        })
        .catch(() => {
          if (!aiCallActiveRef.current) return;
          if (phaseRef.current !== "calling") return;
          if (queueTokenRef.current !== qTok) return;
          appendIncomingRuntimeMessage(false, pickAiIdleNudgeFallback(aiLanguage), aiLanguage);
          scheduleAiIdleNudge();
        });
    }, delayMs);
  }, [activeAiProfile, appendIncomingRuntimeMessage, buildAiReplyHistory, clearAiIdleNudgeTimer]);

  useEffect(() => {
    const latest = chatMessages.length > 0 ? chatMessages[chatMessages.length - 1] : null;
    if (!latest) {
      aiLastObservedChatIdRef.current = "";
      return;
    }
    if (latest.id === aiLastObservedChatIdRef.current) return;
    aiLastObservedChatIdRef.current = latest.id;
    if (!aiCallActiveRef.current) return;
    if (phaseRef.current !== "calling") return;
    if (!latest.mine) return;

    const userText = String(latest.text || "").trim();
    if (!userText) return;
    if (/^\[GIFT\]\s*/.test(userText)) return;

    const qTok = queueTokenRef.current;
    const aiLanguage = normalizeCallLanguage(activeAiProfile?.language || currentLangRef.current || "en") || "en";
    const observedAt = Date.now();
    const history = buildAiReplyHistory(chatMessages, true);

    aiLastUserChatAtRef.current = observedAt;
        aiReplyPendingCountRef.current += 1;
        aiIdleNudgeBlockedUntilRef.current = Math.max(aiIdleNudgeBlockedUntilRef.current, observedAt + AI_IDLE_NUDGE_REPLY_PENDING_GRACE_MS);
        clearAiIdleNudgeTimer();

    aiReplyQueueRef.current = aiReplyQueueRef.current
      .then(async () => {
        const canContinue = () =>
          aiCallActiveRef.current && phaseRef.current === "calling" && queueTokenRef.current === qTok;
        if (!aiCallActiveRef.current) return;
        if (phaseRef.current !== "calling") return;
        if (queueTokenRef.current !== qTok) return;

        const authNow = authRef.current;
        const out = await fetchAiReplyOnServer({
          token: String(authNow?.token || ""),
          userId: String(authNow?.userId || ""),
          deviceKey: String(authNow?.deviceKey || ""),
          roomId: String(roomIdRef.current || ""),
          language: aiLanguage,
          personaKey: String(activeAiProfile?.key || ""),
          lockOutputLanguage: aiLanguage === "fr",
          message: userText,
          history,
          timeoutMs: AI_SERVER_REPLY_TIMEOUT_MS,
        });

        if (!canContinue()) return;

        const line = String(out.replyText || "").trim();
        if (!line) {
          return;
        }
        if (!canContinue()) return;
        appendIncomingRuntimeMessage(false, line, aiLanguage);
        aiIdleNudgeBlockedUntilRef.current = 0;
        return;
      })
      .catch(() => {
        if (!aiCallActiveRef.current) return;
        if (phaseRef.current !== "calling") return;
        if (queueTokenRef.current !== qTok) return;
      })
      .finally(() => {
        aiReplyPendingCountRef.current = Math.max(0, aiReplyPendingCountRef.current - 1);
        if (!aiCallActiveRef.current) return;
        if (phaseRef.current !== "calling") return;
        if (queueTokenRef.current !== qTok) return;
        scheduleAiIdleNudge();
      });
  }, [activeAiProfile, appendIncomingRuntimeMessage, buildAiReplyHistory, chatMessages, clearAiIdleNudgeTimer, scheduleAiIdleNudge]);

  useEffect(() => {
    clearAiChatTimer();
    clearAiIdleNudgeTimer();
    aiLastObservedChatIdRef.current = "";
    if (!aiCallActive || phase !== "calling") return;

    aiChatTimerRef.current = setTimeout(() => {
      aiChatTimerRef.current = null;
      if (!aiCallActiveRef.current) return;
      if (phaseRef.current !== "calling") return;
      const line = getAiInitialGreeting(String(activeAiProfile?.language || ""));
      if (!line) return;
      appendIncomingRuntimeMessage(false, line, String(activeAiProfile?.language || ""));
      scheduleAiIdleNudge();
    }, AI_INITIAL_GREETING_DELAY_MS);
    return () => {
      clearAiChatTimer();
      clearAiIdleNudgeTimer();
    };
  }, [activeAiProfile, aiCallActive, appendIncomingRuntimeMessage, clearAiChatTimer, clearAiIdleNudgeTimer, phase, scheduleAiIdleNudge]);

  useEffect(() => {
    if (aiCallActive && phase === "calling") return;
    clearAiChatTimer();
    clearAiIdleNudgeTimer();
  }, [aiCallActive, clearAiChatTimer, clearAiIdleNudgeTimer, phase]);

  const {
    noMatchTimerRef,
    matchingActionsTimerRef,
    matchingActionsDeadlineRef,
    premiumNoMatchAutoCloseRef,
    noMatchShownThisCycleRef,
    clearMatchingActionsTimer,
    startMatchingActionsTimer,
    startNoMatchTimer,
    resetNoMatchTimer,
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
  const topActionClusterShift = 72;
  const topActionRight = 23;
  const topActionBadgeTop = insets.top + 14 + topActionClusterShift;
  const topActionTranslateTop = insets.top + 42 + topActionClusterShift;
  const topActionShopTop = insets.top + 96 + topActionClusterShift;
  const topActionGiftTop = insets.top + 150 + topActionClusterShift;
  const topActionSafetyTop = insets.top + 204 + topActionClusterShift;
  const topActionAiStopTop = topActionSafetyTop + 54;
  useEffect(() => {
    let cancelled = false;
    let polling = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const animateLevel = (nextLevel: number) => {
      Animated.timing(localMicLevelAnim, {
        toValue: Math.max(0, Math.min(1, nextLevel)),
        duration: 150,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    };

    const resetLevel = () => {
      localMicActivityLevelRef.current = 0;
      lastSentMicSignalLevelRef.current = -1;
      lastSentMicSignalAtRef.current = 0;
      lastSentMicSignalEnabledRef.current = true;
      animateLevel(0);
    };

    if (phase !== "calling" || myCamOn || beautyOpen) {
      resetLevel();
      return () => {
        cancelled = true;
        if (timer) clearInterval(timer);
      };
    }

    const tick = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const rtcAny: any = rtcRef.current as any;
        const rawLevel =
          mySoundOn && rtcAny && typeof rtcAny.getLocalAudioLevel === "function"
            ? await rtcAny.getLocalAudioLevel()
            : 0;
        if (!cancelled) {
          const normalizedLevel = Number.isFinite(Number(rawLevel)) ? Math.max(0, Math.min(1, Number(rawLevel))) : 0;
          const detected = normalizedLevel >= 0.01;
          const prevLevel = localMicActivityLevelRef.current;
          const boostedLevel = detected ? Math.max(0.36, Math.min(1, 0.28 + normalizedLevel * 1.95)) : 0;
          const nextLevel = detected
            ? Math.max(prevLevel * 0.74, boostedLevel)
            : Math.max(0, prevLevel * 0.82 - 0.04);
          localMicActivityLevelRef.current = nextLevel;
          Animated.timing(localMicLevelAnim, {
            toValue: nextLevel,
            duration: detected ? 210 : 340,
            easing: detected ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();

          const ws = wsRef.current;
          const rid = String(roomIdRef.current || "").trim();
          const now = Date.now();
          const signalLevel = mySoundOn ? nextLevel : 0;
          const quantizedLevel = Math.max(0, Math.min(1, Math.round(signalLevel * 12) / 12));
          const shouldSendSignal =
            rid.length > 0 &&
            Boolean(ws) &&
            (lastSentMicSignalEnabledRef.current !== Boolean(mySoundOn) ||
              Math.abs(quantizedLevel - lastSentMicSignalLevelRef.current) >= 0.08 ||
              now - lastSentMicSignalAtRef.current >= 520);
          if (shouldSendSignal) {
            try {
              ws?.relay(rid, { type: "mic_level", enabled: Boolean(mySoundOn), level: quantizedLevel });
              lastSentMicSignalEnabledRef.current = Boolean(mySoundOn);
              lastSentMicSignalLevelRef.current = quantizedLevel;
              lastSentMicSignalAtRef.current = now;
            } catch {}
          }
        }
      } catch {
        if (!cancelled) {
          localMicActivityLevelRef.current = 0;
          animateLevel(0);
        }
      } finally {
        polling = false;
      }
    };

    void tick();
    timer = setInterval(() => {
      void tick();
    }, 180);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      resetLevel();
    };
  }, [beautyOpen, localMicLevelAnim, myCamOn, mySoundOn, phase]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let polling = false;

    const animateLevel = (value: number) => {
      Animated.timing(remoteMicLevelAnim, {
        toValue: value,
        duration: value > 0 ? 220 : 340,
        easing: value > 0 ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    };

    const resetLevel = () => {
      remoteMicActivityLevelRef.current = 0;
      animateLevel(0);
    };

    if (phase !== "calling" || remoteCamOn || beautyOpen) {
      resetLevel();
      return () => {
        cancelled = true;
        if (timer) clearInterval(timer);
      };
    }

    const tick = async () => {
      if (cancelled || polling) return;
      polling = true;
      try {
        const rtcAny: any = rtcRef.current as any;
        const signalAgeMs = Date.now() - Number(peerMicSignalAtRef.current || 0);
        let rawLevel = signalAgeMs <= 700 ? Number(peerMicSignalLevelRef.current || 0) : 0;
        if (rawLevel <= 0.001 && peerSoundOn && rtcAny && typeof rtcAny.getRemoteAudioLevel === "function") {
          rawLevel = await rtcAny.getRemoteAudioLevel();
        }
        if (!cancelled) {
          const normalizedLevel = Number.isFinite(Number(rawLevel)) ? Math.max(0, Math.min(1, Number(rawLevel))) : 0;
          const detected = normalizedLevel >= 0.01;
          const prevLevel = remoteMicActivityLevelRef.current;
          const boostedLevel = detected ? Math.max(0.36, Math.min(1, 0.28 + normalizedLevel * 1.9)) : 0;
          const nextLevel = detected
            ? Math.max(prevLevel * 0.74, boostedLevel)
            : Math.max(0, prevLevel * 0.82 - 0.04);
          remoteMicActivityLevelRef.current = nextLevel;
          Animated.timing(remoteMicLevelAnim, {
            toValue: nextLevel,
            duration: detected ? 210 : 340,
            easing: detected ? Easing.out(Easing.cubic) : Easing.out(Easing.quad),
            useNativeDriver: true,
          }).start();
        }
      } catch {
        if (!cancelled) {
          remoteMicActivityLevelRef.current = 0;
          animateLevel(0);
        }
      } finally {
        polling = false;
      }
    };

    void tick();
    timer = setInterval(() => {
      void tick();
    }, 180);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      resetLevel();
    };
  }, [beautyOpen, peerSoundOn, phase, remoteCamOn, remoteMicLevelAnim]);

  useEffect(() => {
    if (phase === "matched" || phase === "calling") return;
    setPeerSoundOn(true);
    peerMicSignalLevelRef.current = 0;
    peerMicSignalAtRef.current = 0;
  }, [phase]);

  const onPeerMicLevelSignal = useCallback((level: number, enabled?: boolean) => {
    const normalizedLevel = Number.isFinite(Number(level)) ? Math.max(0, Math.min(1, Number(level))) : 0;
    peerMicSignalLevelRef.current = normalizedLevel;
    peerMicSignalAtRef.current = Date.now();
    if (typeof enabled === "boolean") {
      setPeerSoundOn(Boolean(enabled));
    }
  }, []);

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
  const recallAcceptedHeartRotate = useMemo(
    () =>
      recallAcceptedHeartTiltAnimRef.current.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: ["-12deg", "0deg", "12deg"],
      }),
    []
  );
  const stopRecallAcceptedHeartLoop = useCallback(() => {
    recallAcceptedHeartLoopRef.current?.stop?.();
    recallAcceptedHeartLoopRef.current = null;
    recallAcceptedHeartTiltAnimRef.current.stopAnimation();
    recallAcceptedHeartScaleAnimRef.current.stopAnimation();
  }, []);

  const popTalkBalanceLine = useMemo(() => {
    if (popTalkUnlimited) return t("poptalk.balance_unlimited_label");
    return t("poptalk.balance_label", {
      balance: Number(popTalk?.balance ?? 0),
      cap: Number(popTalk?.cap ?? 0),
    });
  }, [popTalk?.balance, popTalk?.cap, popTalkUnlimited, t]);
  const popTalkShortageModalSuppressed = popTalkRewardAdBusy || popTalkShortageModalSuppressUntil > Date.now();

  const extendPopTalkShortageModalSuppression = useCallback((durationMs: number) => {
    const nextUntil = Date.now() + Math.max(0, Math.trunc(durationMs));
    setPopTalkShortageModalSuppressUntil((prev) => Math.max(prev, nextUntil));
  }, []);

  const waitForPopTalkModalDismiss = useCallback(async () => {
    await new Promise<void>((resolve) => {
      InteractionManager.runAfterInteractions(() => {
        setTimeout(resolve, 90);
      });
    });
  }, []);

  useEffect(() => {
    if (popTalkShortageModalSuppressUntil <= 0) return;
    const remaining = popTalkShortageModalSuppressUntil - Date.now();
    if (remaining <= 0) {
      setPopTalkShortageModalSuppressUntil(0);
      return;
    }
    const targetUntil = popTalkShortageModalSuppressUntil;
    const tm = setTimeout(() => {
      setPopTalkShortageModalSuppressUntil((prev) => (prev === targetUntil ? 0 : prev));
    }, remaining + 32);
    return () => clearTimeout(tm);
  }, [popTalkShortageModalSuppressUntil]);

  const { isAiPeer, peerInfoText, myCountryRaw, myLangRaw, myGenderRaw, myFlag } = usePeerInfo({ peerInfo, prefs, t });
  const directCallEntryMode = useMemo(() => String(route.params?.entryMode || "").trim().toLowerCase(), [route.params?.entryMode]);
  const isDirectRecallEntry = directCallEntryMode === "contactrecall" || directCallEntryMode === "contactrecallaccept";
  const currentAuthUserId = useMemo(() => String(auth?.userId || "").trim(), [auth?.userId]);
  const aiMatchingDisabled = useMemo(() => {
    if (!currentAuthUserId) return false;
    const map =
      aiMatchingDisabledByUser && typeof aiMatchingDisabledByUser === "object"
        ? (aiMatchingDisabledByUser as Record<string, boolean>)
        : {};
    return Boolean(map[currentAuthUserId]);
  }, [aiMatchingDisabledByUser, currentAuthUserId]);
  const isAiSafetyTarget = useMemo(() => {
    const rid = String(roomId || "").trim();
    return phase === "calling" && (aiCallActive || isAiPeer || rid.startsWith(AI_ROOM_ID_PREFIX));
  }, [aiCallActive, isAiPeer, phase, roomId]);
  const topActionContactBaseTop = isAiSafetyTarget ? topActionAiStopTop : topActionSafetyTop;
  const topActionFriendTop = topActionContactBaseTop + 54;
  const canRecallSavedContact = phase === "connecting" || phase === "queued";
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

  const toggleMatchFilterInterests = useCallback((value: string) => {
    setMatchFilterDraft((prev) => {
      const normalized = normalizeMatchFilter(prev);
      const key = String(value || "").trim().toLowerCase();
      if (!key) return normalized;
      let nextInterests = [...normalized.interests];
      if (key.toUpperCase() === MATCH_FILTER_ALL) {
        nextInterests = [MATCH_FILTER_ALL];
      } else {
        const withoutAll = nextInterests.filter((v) => v !== MATCH_FILTER_ALL);
        if (withoutAll.includes(key)) {
          const after = withoutAll.filter((v) => v !== key);
          nextInterests = after.length > 0 ? after : [MATCH_FILTER_ALL];
        } else {
          nextInterests = [...withoutAll, key];
        }
      }
      return normalizeMatchFilter({ ...normalized, interests: nextInterests });
    });
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
    isScreenFocusedRef.current = isScreenFocused;
    if (!isScreenFocused) return;
    const currentPhase = String(phaseRef.current || "");
    if (currentPhase !== "matched" && currentPhase !== "calling") return;
    const timer = setTimeout(() => {
      refreshCallMediaSurfaces();
    }, 60);
    return () => clearTimeout(timer);
  }, [isScreenFocused, refreshCallMediaSurfaces]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;
      const becameActive = (prevState === "background" || prevState === "inactive") && nextState === "active";
      if (!becameActive) return;
      if (!isScreenFocusedRef.current) return;
      if (appResumeMediaTimerRef.current) {
        clearTimeout(appResumeMediaTimerRef.current);
      }
      appResumeMediaTimerRef.current = setTimeout(() => {
        appResumeMediaTimerRef.current = null;
        recoverForegroundCallMedia().catch(() => undefined);
      }, 90);
    });
    return () => {
      if (appResumeMediaTimerRef.current) {
        clearTimeout(appResumeMediaTimerRef.current);
        appResumeMediaTimerRef.current = null;
      }
      sub.remove();
    };
  }, [recoverForegroundCallMedia]);

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
    isCallerRef.current = isCaller;
  }, [isCaller]);

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
    setRemoteMuted(!Boolean(persistedCallSpeakerOn));
  }, [hasHydrated, persistedCallCamOn, persistedCallMicOn, persistedCallSpeakerOn]);

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
    if (!hasHydrated) return;
    if (!mediaPrefsInitializedRef.current) return;
    setCallMediaPrefs?.({ speakerOn: !Boolean(remoteMuted) });
  }, [hasHydrated, remoteMuted, setCallMediaPrefs]);

  useEffect(() => {
    aiCallActiveRef.current = aiCallActive;
    aiLastObservedChatIdRef.current = "";
    aiLastUserChatAtRef.current = 0;
    aiReplyPendingCountRef.current = 0;
    aiIdleNudgeBlockedUntilRef.current = 0;
    if (!aiCallActive) {
      aiReplyQueueRef.current = Promise.resolve();
    }
  }, [aiCallActive]);

  useEffect(() => {
    aiMatchingDisabledRef.current = aiMatchingDisabled;
  }, [aiMatchingDisabled]);

  useEffect(() => {
    const rid = String(roomId || "");
    if (!rid.startsWith(AI_ROOM_ID_PREFIX)) {
      setAiCallActive(false);
    }
  }, [roomId]);

  useEffect(() => {
    if (phase === "matched" || phase === "calling") return;
    if (!aiCallActive) return;
    setAiCallActive(false);
  }, [aiCallActive, phase]);

  useEffect(() => {
    if (phase !== "matched" && phase !== "calling") return;
    clearReMatchTextTimer();
  }, [clearReMatchTextTimer, phase]);

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
      if (aiIdleNudgeTimerRef.current) {
        clearTimeout(aiIdleNudgeTimerRef.current);
        aiIdleNudgeTimerRef.current = null;
      }
      if (aiMatchTimerRef.current) {
        clearTimeout(aiMatchTimerRef.current);
        aiMatchTimerRef.current = null;
      }
      if (aiRestrictionNoticeTimerRef.current) {
        clearTimeout(aiRestrictionNoticeTimerRef.current);
        aiRestrictionNoticeTimerRef.current = null;
      }
      if (translateNoticeTimerRef.current) {
        clearTimeout(translateNoticeTimerRef.current);
        translateNoticeTimerRef.current = null;
      }
      clearReMatchTextTimer();
      [aiRemotePlayerFr, aiRemotePlayerKr].forEach((player) => {
        try {
          (player as any)?.pause?.();
        } catch {}
      });
    };
  }, [aiRemotePlayerFr, aiRemotePlayerKr, clearReMatchTextTimer]);

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
    if (popTalkRewardAdBusyRef.current || popTalkShortageModalSuppressed) {
      popTalkLowPrevRef.current = bal;
      return;
    }
    if (phase === "calling" && callTransportReady && prev > POPTALK_LOW_WARNING_THRESHOLD && bal <= POPTALK_LOW_WARNING_THRESHOLD && bal > 0) {
      setPopTalkLowModal(true);
    }
    popTalkLowPrevRef.current = bal;
  }, [callTransportReady, phase, popTalk?.balance, popTalkShortageModalSuppressed, popTalkUnlimited]);

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
    if (phase === "calling" && callTransportReady) return;
    popTalkEmptyHandledRef.current = false;
    popTalkChargeInProgressRef.current = false;
    popTalkChargeGraceUntilRef.current = 0;
    if (callDebitTimerRef.current) {
      clearInterval(callDebitTimerRef.current);
      callDebitTimerRef.current = null;
    }
    callDebitInFlightRef.current = false;
  }, [callTransportReady, phase]);

  const { clearLocalPreviewStream, hasLiveVideoTrack, ensureLocalPreviewStream, refreshLocalPreviewStream } = useLocalPreview({
    previewStreamRef,
    localStreamRef,
    previewOpeningRef,
    phaseRef: phaseRef as React.MutableRefObject<string>,
    setLocalStreamURL,
    showGlobalModal,
    t,
  });
  hasLiveVideoTrackRef.current = hasLiveVideoTrack;
  refreshLocalPreviewStreamRef.current = refreshLocalPreviewStream;

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
        try {
          done();
        } catch {}
        return true;
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
    if (phase === "matched" || phase === "calling") {
      return;
    }
    matchRevealRunningRef.current = false;
    matchRevealCompletedRef.current = false;
    matchRevealDoneCallbacksRef.current = [];
    matchRevealAnimRef.current.stopAnimation();
    matchRevealAnimRef.current.setValue(0);
    setMatchRevealActive(false);
  }, [phase]);

  const fetchCurrentActiveUsersSnapshot = useCallback(async (): Promise<ActiveUsersSnapshot> => {
    try {
      const base = String(APP_CONFIG.AUTH_HTTP_BASE_URL || "").replace(/\/+$/, "");
      const path = String((APP_CONFIG as any)?.ACTIVE_USERS_PATH || "/api/active-users");
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const separator = normalizedPath.includes("?") ? "&" : "?";
      const res = await fetch(`${base}${normalizedPath}${separator}ts=${Date.now()}`, {
        method: "GET",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      if (!res.ok) {
        return {
          activeUsers: Number.POSITIVE_INFINITY,
          queuedUsers: Number.POSITIVE_INFINITY,
        };
      }
      const json = await res.json().catch(() => null);
      const candidates = [
        json?.eligibleActiveUsers,
        json?.activeUsers,
        json?.wsClients,
        json?.registeredSessions,
        json?.queuedUsers,
        json?.loginPresenceActive,
        json?.connectedTotal,
        json?.activeTotal,
      ]
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v >= 0);
      const activeUsers = candidates.length ? Math.trunc(Math.max(...candidates)) : Number.POSITIVE_INFINITY;
      const queuedRaw = Number(json?.queuedUsers);
      const queuedUsers = Number.isFinite(queuedRaw) && queuedRaw >= 0 ? Math.trunc(queuedRaw) : Number.POSITIVE_INFINITY;
      return {
        activeUsers,
        queuedUsers,
      };
    } catch {
      return {
        activeUsers: Number.POSITIVE_INFINITY,
        queuedUsers: Number.POSITIVE_INFINITY,
      };
    }
  }, []);

  const fetchCurrentActiveUserCount = useCallback(async (): Promise<number> => {
    const snapshot = await fetchCurrentActiveUsersSnapshot();
    return snapshot.activeUsers;
  }, [fetchCurrentActiveUsersSnapshot]);

  const clearAiMatchTimer = useCallback(() => {
    if (!aiMatchTimerRef.current) return;
    clearTimeout(aiMatchTimerRef.current);
    aiMatchTimerRef.current = null;
  }, []);

  const activateSyntheticAiMatch = useCallback(
    async (qTok: number) => {
      if (isDirectRecallEntry) return false;
      if (aiMatchingDisabledRef.current) return false;
      if (aiMatchInFlightRef.current) return false;
      if (queueTokenRef.current !== qTok) return false;
      if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return false;
      aiMatchInFlightRef.current = true;
      try {
        const snapshot = await fetchCurrentActiveUsersSnapshot();
        const activeUsers = snapshot.activeUsers;
        const queuedUsers = snapshot.queuedUsers;
        aiEligibleActiveUsersRef.current = activeUsers;
        const selfQueuedOffset = phaseRef.current === "queued" ? 1 : 0;
        const waitingUsersExceptMe = Math.max(0, queuedUsers - selfQueuedOffset);
        if (!Number.isFinite(activeUsers) || activeUsers > 3) return false;
        if (!Number.isFinite(queuedUsers) || waitingUsersExceptMe > 0) return false;
        if (queueTokenRef.current !== qTok) return false;
        if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return false;

        // Re-check just before synthetic match commit to avoid race/stale reads.
        const snapshotConfirm = await fetchCurrentActiveUsersSnapshot();
        const activeUsersConfirm = snapshotConfirm.activeUsers;
        const queuedUsersConfirm = snapshotConfirm.queuedUsers;
        aiEligibleActiveUsersRef.current = Math.max(activeUsers, activeUsersConfirm);
        const selfQueuedOffsetConfirm = phaseRef.current === "queued" ? 1 : 0;
        const waitingUsersExceptMeConfirm = Math.max(0, queuedUsersConfirm - selfQueuedOffsetConfirm);
        if (!Number.isFinite(activeUsersConfirm) || activeUsersConfirm > 3) return false;
        if (!Number.isFinite(queuedUsersConfirm) || waitingUsersExceptMeConfirm > 0) return false;
        if (queueTokenRef.current !== qTok) return false;
        if (phaseRef.current !== "connecting" && phaseRef.current !== "queued") return false;

        const room = `${AI_ROOM_ID_PREFIX}${Date.now()}_${Math.random().toString(16).slice(2, 9)}`;
        const profileCount = Math.max(1, AI_PROFILES.length);
        const nextAiProfileIndex = Math.max(0, Math.min(aiSyntheticProfileCursorRef.current % profileCount, profileCount - 1));
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
          nickname: "AI",
          avatarUrl: null,
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
      peerLanguageRef.current = normalizeCallLanguage(aiLanguage) || "";
      translateDetectedPeerLanguageRef.current = "";
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
        aiSyntheticProfileCursorRef.current = (nextAiProfileIndex + 1) % profileCount;

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
      fetchCurrentActiveUsersSnapshot,
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
      isDirectRecallEntry,
    ]
  );

  const scheduleAiMatchFromLastAction = useCallback(() => {
    clearAiMatchTimer();
    if (aiMatchingDisabledRef.current) return;
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
      if (aiMatchingDisabledRef.current) return;
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
    setCallTransportReady,
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
    isCallerRef,
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
    if (phase !== "calling" || !callTransportReady) return;
    if (popTalkUnlimited) return;
    if (popTalkRewardAdBusyRef.current) return;
    if (popTalkShortageModalSuppressed) return;
    if (bal > 0) return;
    if (popTalkEmptyHandledRef.current) return;
    popTalkEmptyHandledRef.current = true;
    stopAll(false);
    setPopTalkEmptyModal(true);
  }, [callTransportReady, phase, popTalk?.balance, popTalkShortageModalSuppressed, popTalkUnlimited, stopAll]);

  useEffect(() => {
    if (phase === "matched" || phase === "calling") return;
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
    if (phase !== "ended") return;
    setOutgoingRecallAwaitingAccept(false);
  }, [phase]);

  useEffect(() => {
    if (outgoingRecallAwaitingAccept) return;
    clearOutgoingRecallDelayTimer();
    outgoingRecallDelayShownRef.current = false;
    setOutgoingRecallDelayModalVisible(false);
    setOutgoingRecallInviteId("");
  }, [clearOutgoingRecallDelayTimer, outgoingRecallAwaitingAccept]);

  useEffect(() => {
    clearOutgoingRecallDelayTimer();
    if (!outgoingRecallAwaitingAccept || !outgoingRecallInviteId || outgoingRecallDelayShownRef.current) {
      return;
    }
    outgoingRecallDelayTimerRef.current = setTimeout(() => {
      outgoingRecallDelayTimerRef.current = null;
      outgoingRecallDelayShownRef.current = true;
      setOutgoingRecallDelayModalVisible(true);
    }, 20000);
    return () => {
      clearOutgoingRecallDelayTimer();
    };
  }, [clearOutgoingRecallDelayTimer, outgoingRecallAwaitingAccept, outgoingRecallInviteId]);

  useEffect(() => {
    if (!outgoingRecallAwaitingAccept || !outgoingRecallInviteId) return;
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) return;

    let closed = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = async () => {
      const out = await fetchRecallInviteStatusOnServer({
        token,
        userId,
        deviceKey,
        inviteId: outgoingRecallInviteId,
      }).catch(() => null);
      if (closed || !out) return;
      if (!out.ok) {
        const errCode = String(out.errorCode || "").toUpperCase();
        if (errCode === "RECALL_INVITE_NOT_FOUND") {
          presentOutgoingRecallResult(t("call.contact.outgoing_expired_title"), t("call.contact.outgoing_expired_body"));
        }
        return;
      }

      const status = String(out.status || "").trim().toLowerCase();
      if (!status || status === "pending") {
        return;
      }
      if (status === "accepted") {
        setOutgoingRecallDelayModalVisible(false);
        return;
      }
      if (status === "declined") {
        presentOutgoingRecallResult(t("call.contact.outgoing_declined_title"), t("call.contact.outgoing_declined_body"));
        return;
      }
      if (status === "blocked") {
        presentOutgoingRecallResult(t("call.contact.outgoing_declined_title"), t("call.contact.outgoing_declined_body"));
        return;
      }
      if (status === "expired") {
        presentOutgoingRecallResult(t("call.contact.outgoing_expired_title"), t("call.contact.outgoing_expired_body"));
      }
    };

    void poll();
    timer = setInterval(() => {
      void poll();
    }, 2500);
    return () => {
      closed = true;
      if (timer) clearInterval(timer);
    };
  }, [
    auth?.deviceKey,
    auth?.token,
    auth?.userId,
    outgoingRecallAwaitingAccept,
    outgoingRecallInviteId,
    t,
  ]);

  useEffect(() => {
    translateCacheRef.current.clear();
  }, [roomId]);

  useEffect(() => {
    if (!outgoingRecallAwaitingAccept) {
      recallAcceptedRevealPlayedRef.current = false;
      setRecallAcceptedModalVisible(false);
      stopRecallAcceptedHeartLoop();
      recallAcceptedHeartTiltAnimRef.current.setValue(0);
      recallAcceptedHeartScaleAnimRef.current.setValue(1);
      return;
    }
    if ((phase === "matched" || phase === "calling") && !recallAcceptedModalVisible) {
      recallAcceptedRevealPlayedRef.current = false;
      setRecallAcceptedModalVisible(true);
    }
  }, [outgoingRecallAwaitingAccept, phase, recallAcceptedModalVisible, stopRecallAcceptedHeartLoop]);

  useEffect(() => {
    if (!recallAcceptedModalVisible || callTransportReady) {
      stopRecallAcceptedHeartLoop();
      return;
    }
    if (recallAcceptedHeartLoopRef.current) return;
    recallAcceptedHeartTiltAnimRef.current.setValue(0);
    recallAcceptedHeartScaleAnimRef.current.setValue(1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(recallAcceptedHeartTiltAnimRef.current, {
          toValue: -1,
          duration: 180,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(recallAcceptedHeartTiltAnimRef.current, {
          toValue: 1,
          duration: 260,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(recallAcceptedHeartTiltAnimRef.current, {
          toValue: 0,
          duration: 180,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    recallAcceptedHeartLoopRef.current = loop;
    loop.start();
    return () => {
      stopRecallAcceptedHeartLoop();
      recallAcceptedHeartTiltAnimRef.current.setValue(0);
      recallAcceptedHeartScaleAnimRef.current.setValue(1);
    };
  }, [callTransportReady, recallAcceptedModalVisible, stopRecallAcceptedHeartLoop]);

  useEffect(() => {
    if (!recallAcceptedModalVisible) return;
    setOutgoingRecallDelayModalVisible(false);
  }, [recallAcceptedModalVisible]);

  useEffect(() => {
    if (!recallAcceptedModalVisible || !outgoingRecallAwaitingAccept || !callTransportReady) return;
    if (recallAcceptedRevealPlayedRef.current) return;
    recallAcceptedRevealPlayedRef.current = true;
    setOutgoingRecallDelayModalVisible(false);
    stopRecallAcceptedHeartLoop();
    Animated.timing(recallAcceptedHeartScaleAnimRef.current, {
      toValue: 1.95,
      duration: 360,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      recallAcceptedHeartScaleAnimRef.current.setValue(1);
      recallAcceptedHeartTiltAnimRef.current.setValue(0);
      setRecallAcceptedModalVisible(false);
      setOutgoingRecallAwaitingAccept(false);
    });
  }, [callTransportReady, outgoingRecallAwaitingAccept, recallAcceptedModalVisible, stopRecallAcceptedHeartLoop]);

  const endCallAndRequeue = (why: "remote_left" | "disconnect" | "error" | "find_other") => {
    const tok = queueTokenRef.current;
    if (endCallOnceRef.current === tok) return;
    endCallOnceRef.current = tok;
    clearReMatchTextTimer();
    const phaseBeforeEnd = phaseRef.current;

    if (why === "remote_left") {
      suppressEndRelayRef.current = true;
    } else if (why === "find_other") {
      suppressEndRelayRef.current = false;
    }

    if (why === "remote_left") {
      setReMatchText(String(t("call.peer_left") || ""));
      reMatchTextTimerRef.current = setTimeout(() => {
        reMatchTextTimerRef.current = null;
        if (phaseRef.current === "matched" || phaseRef.current === "calling") return;
        setReMatchText(String(t("call.connecting") || ""));
      }, 4000);
    } else if (why === "find_other" || why === "disconnect") {
      setReMatchText(String(t("call.connecting") || ""));
    } else {
      setReMatchText("");
    }

    setAiCallActive(false);
    const resetMatchingActions = why !== "disconnect";
    stopAll(false, resetMatchingActions);
    setNoMatchModal(false);

    const shouldPauseAfterDisconnect =
      why === "disconnect" && (phaseBeforeEnd === "matched" || phaseBeforeEnd === "calling");

    const restartQueue = async (nextResetMatchingActions: boolean, reshowMatchingActions: boolean) => {
      endCallOnceRef.current = -1;
      const started = await Promise.resolve(startQueue(nextResetMatchingActions));
      if (!started) {
        setPhase("ended");
        setReMatchText("");
        return;
      }
      if (reshowMatchingActions && !beautyOpenRef.current) {
        startMatchingActionsTimer(true);
      }
    };

    setPhase("ended");
    if (shouldPauseAfterDisconnect) {
      setReMatchText("");
      setCallDisconnectModalVisible(true);
      return;
    }
    if (why === "remote_left") {
      if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = setTimeout(() => {
        void restartQueue(true, true);
      }, 100);
    } else {
      if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = setTimeout(() => {
        void restartQueue(why !== "disconnect", false);
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
      showGlobalModal(t("poptalk.sync_failed_title"), t("poptalk.sync_failed"));
    }
    if (bal < POPTALK_MATCH_BLOCK_THRESHOLD) {
      if (popTalkShortageModalSuppressed) return false;
      setPopTalkMatchBlockModal(true);
      return false;
    }
    aiEligibleActiveUsersRef.current = await fetchCurrentActiveUserCount();
    setPopTalkMatchBlockModal(false);
    return true;
  }, [fetchCurrentActiveUserCount, popTalkShortageModalSuppressed, popTalkUnlimited, refreshPopTalk, showGlobalModal, t]);

  const getQueueMatchFilter = useCallback(() => {
    if (!isPremiumRef.current) return createDefaultMatchFilter();
    return normalizeMatchFilter(matchFilterRef.current);
  }, []);
  const shouldSkipMatchedPeer = useCallback(
    ({ peerSessionId }: { roomId: string; peerSessionId: string }) => {
      const sid = String(peerSessionId || "").trim().toLowerCase();
      if (!sid) return false;
      const isAiSession = sid.startsWith("ai_") || sid.startsWith("ai-") || sid.endsWith("_bot") || sid.endsWith("-bot");
      if (!isAiSession) return false;
      if (isDirectRecallEntry) return true;
      if (aiMatchingDisabledRef.current) return true;
      const activeUsers = Number(aiEligibleActiveUsersRef.current);
      return !Number.isFinite(activeUsers) || activeUsers > 3;
    },
    [isDirectRecallEntry]
  );
  const shouldSkipPeerInfo = useCallback(
    ({ peerInfo }: { roomId: string; peerSessionId: string; peerInfo: any }) => {
      const isAi = Boolean((peerInfo as any)?.ai || (peerInfo as any)?.isAi);
      if (!isAi) return false;
      if (isDirectRecallEntry) return true;
      if (aiMatchingDisabledRef.current) return true;
      const activeUsers = Number(aiEligibleActiveUsersRef.current);
      return !Number.isFinite(activeUsers) || activeUsers > 3;
    },
    [isDirectRecallEntry]
  );
  const pendingHomeRecallTargetRef = useRef<{
    mode: "contactRecall" | "contactRecallAccept";
    peerSessionId?: string;
    peerProfileId?: string;
    inviteId?: string;
  } | null>(
    String(route.params?.entryMode || "").trim().toLowerCase() === "contactrecallaccept"
      ? {
          mode: "contactRecallAccept",
          inviteId: String(route.params?.recallInviteId || "").trim() || undefined,
        }
      : String(route.params?.entryMode || "").trim().toLowerCase() === "contactrecall"
      ? {
          mode: "contactRecall",
          peerSessionId: String(route.params?.recallPeerSessionId || "").trim() || undefined,
          peerProfileId: String(route.params?.recallPeerProfileId || "").trim() || undefined,
        }
      : null
  );
  const beforeInitialEnqueue = useCallback(
    async () => {
      const target = pendingHomeRecallTargetRef.current;
      if (!target) return true;
      pendingHomeRecallTargetRef.current = null;

      const token = String(useAppStore.getState().auth.token ?? auth?.token ?? "").trim();
      const userId = String(useAppStore.getState().auth.userId ?? auth?.userId ?? "").trim();
      const deviceKey = String(useAppStore.getState().auth.deviceKey ?? auth?.deviceKey ?? "").trim();
      if (!token || !userId || !deviceKey) {
        showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
        requestAnimationFrame(() => navigation.goBack());
        return false;
      }

      setNoMatchModal(false);
      setFastMatchHint(false);
      setReMatchText(String(t("call.connecting") || ""));

      const out =
        target.mode === "contactRecallAccept"
          ? await respondRecallInviteOnServer({
              token,
              userId,
              deviceKey,
              inviteId: String(target.inviteId || "").trim() || undefined,
              accept: true,
            })
          : await beginOutgoingRecallRequest({
              peerSessionId: String(target.peerSessionId || "").trim() || undefined,
              peerProfileId: String(target.peerProfileId || "").trim() || undefined,
            });
      if (out.ok) {
        if (target.mode !== "contactRecall" || (out as any)?.invitePending !== true) {
          setOutgoingRecallAwaitingAccept(false);
          setOutgoingRecallInviteId("");
        }
        return false;
      }

      setOutgoingRecallAwaitingAccept(false);
      setOutgoingRecallInviteId("");
      const errCode = String((out as any)?.errorCode || "").toUpperCase();
      if (target.mode === "contactRecall" || !errCode) {
        return false;
      }
      if (errCode === "CALL_RECALL_ROUTE_NOT_FOUND" || errCode === "CALL_RECALL_RESPOND_ROUTE_NOT_FOUND") {
        showGlobalModal(t("call.contact.title"), t("call.contact.route_missing"));
      } else if (["PEER_NOT_WAITING", "PEER_NOT_AVAILABLE", "PEER_ALREADY_IN_ROOM", "ACTOR_SESSION_OFFLINE"].includes(errCode)) {
        presentOutgoingRecallResult(t("call.contact.outgoing_unavailable_title"), t("call.contact.outgoing_unavailable_body"));
        return false;
      } else if (["RECALL_INVITE_NOT_FOUND", "RECALL_INVITE_EXPIRED", "RECALL_INVITE_FORBIDDEN"].includes(errCode)) {
        presentOutgoingRecallResult(t("call.contact.outgoing_expired_title"), t("call.contact.outgoing_expired_body"));
        return false;
      } else {
        presentOutgoingRecallResult(
          t("call.contact.title"),
          (out as any)?.errorMessage || (out as any)?.errorCode || t("call.contact.recall_failed")
        );
        return false;
      }
      requestAnimationFrame(() => navigation.goBack());
      return false;
    },
    [auth?.deviceKey, auth?.token, auth?.userId, clearNoMatchTimer, navigation, showGlobalModal, t]
  );

  const { startQueue } = useSignaling({
    wsRef,
    roomIdRef,
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
    myCamOnRef,
    mySoundOnRef,
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
    setPeerSoundOn,
    onPeerMicLevel: onPeerMicLevelSignal,
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
    beforeInitialEnqueue,
    beforeStartQueue: ensurePopTalkForMatching,
    getQueueMatchFilter,
    shouldSkipMatch: shouldSkipMatchedPeer,
    shouldSkipPeerInfo,
    tryStartSyntheticMatch: ({ qTok }) => activateSyntheticAiMatch(qTok),
  });

  const retryMatchingAfterRecoveryModal = useCallback(async () => {
    setCallDisconnectModalVisible(false);
    setPopTalkSyncFailedModal(false);
    popTalkEmptyHandledRef.current = false;
    popTalkChargeInProgressRef.current = false;
    popTalkChargeGraceUntilRef.current = 0;
    if (requeueTimerRef.current) {
      clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = null;
    }
    clearNoMatchTimer();
    clearMatchingActionsTimer(false);
    clearReMatchTextTimer();
    setMatchingActionsVisible(false);
    setNoMatchModal(false);
    setFastMatchHint(false);
    endCallOnceRef.current = -1;
    stopAll(false, false);
    setCallDisconnectModalVisible(false);
    setReMatchText(String(t("call.connecting") || ""));
    const started = await Promise.resolve(startQueue(false));
    if (!started) {
      setPhase("ended");
      setReMatchText("");
    }
  }, [clearMatchingActionsTimer, clearNoMatchTimer, clearReMatchTextTimer, setMatchingActionsVisible, startQueue, stopAll, t]);

  const retryAfterCallDisconnect = useCallback(async () => {
    await retryMatchingAfterRecoveryModal();
  }, [retryMatchingAfterRecoveryModal]);

  async function beginOutgoingRecallRequest(target: { peerSessionId?: string; peerProfileId?: string }) {
    const peerSessionId = String(target?.peerSessionId || "").trim();
    const peerProfileId = String(target?.peerProfileId || "").trim();
    if (!peerSessionId && !peerProfileId) {
      showGlobalModal(t("call.contact.title"), t("call.contact.recall_unavailable"));
      return { ok: false as const };
    }

    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
      return { ok: false as const };
    }

    outgoingRecallTargetRef.current = {
      peerSessionId: peerSessionId || undefined,
      peerProfileId: peerProfileId || undefined,
    };

    const out = await recallCallContactOnServer({
      token,
      userId,
      deviceKey,
      peerSessionId: peerSessionId || undefined,
      peerProfileId: peerProfileId || undefined,
    });
    if (!out.ok) {
      const errCode = String(out.errorCode || "").toUpperCase();
      if (errCode === "CALL_RECALL_ROUTE_NOT_FOUND") {
        showGlobalModal(t("call.contact.title"), t("call.contact.route_missing"));
      } else if (["PEER_NOT_WAITING", "PEER_NOT_AVAILABLE", "PEER_ALREADY_IN_ROOM", "ACTOR_SESSION_OFFLINE"].includes(errCode)) {
        presentOutgoingRecallResult(t("call.contact.outgoing_unavailable_title"), t("call.contact.outgoing_unavailable_body"));
      } else if (errCode === "RECALL_BLOCKED") {
        presentOutgoingRecallResult(t("call.contact.outgoing_declined_title"), t("call.contact.outgoing_declined_body"));
      } else {
        presentOutgoingRecallResult(t("call.contact.title"), out.errorMessage || out.errorCode || t("call.contact.recall_failed"));
      }
      return { ok: false as const };
    }

    if ((out as any)?.invitePending === true) {
      clearNoMatchTimer();
      setOutgoingRecallAwaitingAccept(true);
      setOutgoingRecallInviteId(String((out as any)?.inviteId || "").trim());
      setOutgoingRecallDelayModalVisible(false);
      setOutgoingRecallResultModal(null);
      outgoingRecallDelayShownRef.current = false;
      setReMatchText(String(t("call.contact.waiting_accept") || ""));
      return { ok: true as const, invitePending: true };
    }

    setOutgoingRecallAwaitingAccept(false);
    setOutgoingRecallInviteId("");
    return { ok: true as const, invitePending: false };
  }

  async function retryOutgoingRecallRequest() {
    const target = outgoingRecallTargetRef.current;
    if (!target) return;
    setOutgoingRecallDelayModalVisible(false);
    setOutgoingRecallResultModal(null);
    const hasLiveSignal = Boolean(wsRef.current && phaseRef.current !== "ended");
    if (hasLiveSignal) {
      await beginOutgoingRecallRequest(target);
      return;
    }

    pendingHomeRecallTargetRef.current = {
      mode: "contactRecall",
      peerSessionId: String(target.peerSessionId || "").trim() || undefined,
      peerProfileId: String(target.peerProfileId || "").trim() || undefined,
    };
    outgoingRecallDelayShownRef.current = false;
    setOutgoingRecallAwaitingAccept(false);
    setOutgoingRecallInviteId("");
    setNoMatchModal(false);
    clearNoMatchTimer();
    clearMatchingActionsTimer(false);
    clearReMatchTextTimer();
    setFastMatchHint(false);
    setReMatchText(String(t("call.connecting") || ""));
    endCallOnceRef.current = -1;
    const started = await Promise.resolve(startQueue(false));
    if (!started) {
      setPhase("ended");
      setReMatchText("");
    }
  }

  function exitOutgoingRecallFlow() {
    clearOutgoingRecallDelayTimer();
    outgoingRecallDelayShownRef.current = false;
    setOutgoingRecallDelayModalVisible(false);
    setOutgoingRecallResultModal(null);
    setOutgoingRecallInviteId("");
    setOutgoingRecallAwaitingAccept(false);
    outgoingRecallTargetRef.current = null;
    setNoMatchModal(false);
    clearNoMatchTimer();
    clearMatchingActionsTimer(false);
    clearReMatchTextTimer();
    setReMatchText("");
    setFastMatchHint(false);
    queueRunningRef.current = false;
    enqueuedRef.current = false;
    manualCloseRef.current = true;
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    manualCloseRef.current = false;
    setPhase("ended");
    requestAnimationFrame(() => navigation.goBack());
  }

  function presentOutgoingRecallResult(title: string, body: string) {
    clearOutgoingRecallDelayTimer();
    outgoingRecallDelayShownRef.current = false;
    setOutgoingRecallDelayModalVisible(false);
    setOutgoingRecallInviteId("");
    setOutgoingRecallAwaitingAccept(false);
    setNoMatchModal(false);
    clearNoMatchTimer();
    clearMatchingActionsTimer(false);
    clearReMatchTextTimer();
    setReMatchText("");
    setFastMatchHint(false);
    queueRunningRef.current = false;
    enqueuedRef.current = false;
    manualCloseRef.current = true;
    try {
      wsRef.current?.close();
    } catch {}
    wsRef.current = null;
    manualCloseRef.current = false;
    setPhase("ended");
    setOutgoingRecallResultModal({ title, body });
  }

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
          showAiRestrictionNotice(t("call.gift.ai_unavailable"));
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
        const activeRoomId = String(roomIdRef.current || "").trim();
        const activePeerSessionId = String(peerSessionIdRef.current || "").trim();
        const activePeerProfileId = String((peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId || "").trim();
        const currentContact = Array.isArray(callContacts)
          ? callContacts.find((row) => {
              const rowRoomId = String((row as any)?.roomId || "").trim();
              const rowPeerSessionId = String((row as any)?.peerSessionId || "").trim();
              const rowPeerProfileId = String((row as any)?.peerProfileId || "").trim();
              if (activeRoomId && rowRoomId && rowRoomId === activeRoomId) return true;
              if (activePeerSessionId && rowPeerSessionId && rowPeerSessionId === activePeerSessionId) return true;
              if (activePeerProfileId && rowPeerProfileId && rowPeerProfileId === activePeerProfileId) return true;
              return false;
            })
          : null;
        const receiverProfileId =
          activePeerProfileId ||
          String(currentContact?.peerProfileId || "").trim();
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
          receiverProfileId: receiverProfileId || undefined,
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
        if (ws && roomId && typeof ws.relay === "function") {
          ws.relay(roomId, { type: "gift", giftId: gift.id, name: getGiftDisplayName(t, gift), deliveryId });
        }
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
  }, [appendChatMessage, auth?.deviceKey, auth?.token, auth?.userId, callContacts, clearPendingGiftSend, peerInfo, pendingGiftSend, setAssets, setShop, showAiRestrictionNotice, showGlobalModal, syncGiftWalletState, t, triggerGiftFx]);

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
    retry: retryMatchingNow,
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
    resetNoMatchTimer,
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

  const onPressRetryFromNoMatch = useCallback(() => {
    setNoMatchModal(false);
    if (!aiMatchingDisabled) {
      retryMatchingNow();
      return;
    }
    setAiRetryAllowConfirmVisible(true);
  }, [aiMatchingDisabled, retryMatchingNow]);

  const onPressConfirmAllowAiRetry = useCallback(() => {
    setAiRetryAllowConfirmVisible(false);
    const uid = String(currentAuthUserId || "").trim();
    if (uid) {
      setAiMatchingDisabledForUser(uid, false);
    }
    retryMatchingNow();
  }, [currentAuthUserId, retryMatchingNow, setAiMatchingDisabledForUser]);

  const onPressKeepAiBlockedRetry = useCallback(() => {
    setAiRetryAllowConfirmVisible(false);
    retryMatchingNow();
  }, [retryMatchingNow]);

  const closeAllPopTalkModals = useCallback(() => {
    setPopTalkLowModal(false);
    setPopTalkMatchBlockModal(false);
    setPopTalkEmptyModal(false);
    setPopTalkSyncFailedModal(false);
    setPopTalkAdFailModal(false);
  }, []);

  const goShop = useCallback(() => {
    navigation.navigate("Shop");
  }, [navigation]);

  const closeCallSafetyModals = useCallback(() => {
    if (callSafetySubmitting) return;
    setCallSafetyMenuVisible(false);
    setAiMatchStopConfirmVisible(false);
    setCallReportModalVisible(false);
  }, [callSafetySubmitting]);

  const startRematchAfterCallSafety = useCallback(() => {
    setCallSafetyMenuVisible(false);
    setAiMatchStopConfirmVisible(false);
    setCallReportModalVisible(false);
    try {
      wsRef.current?.leaveRoom(roomIdRef.current || "");
    } catch {}
    endCallAndRequeue("find_other");
  }, [endCallAndRequeue, wsRef]);

  const onPressCallSafetyButton = useCallback(() => {
    if (callSafetySubmitting) return;
    if (phaseRef.current !== "calling") return;
    if (!roomIdRef.current) {
      showGlobalModal(t("call.safety.menu_title"), t("call.safety.no_active_peer"));
      return;
    }
    setCallSafetyMenuVisible(true);
  }, [callSafetySubmitting, showGlobalModal, t]);

  const onPressDisableAiMatching = useCallback(() => {
    if (callSafetySubmitting) return;
    setAiMatchStopConfirmVisible(true);
  }, [callSafetySubmitting]);

  const onPressConfirmDisableAiMatching = useCallback(() => {
    if (callSafetySubmitting) return;
    const uid = String(auth?.userId || "").trim();
    if (!uid) {
      setAiMatchStopConfirmVisible(false);
      showGlobalModal(t("call.safety.menu_title"), t("common.auth_expired"));
      return;
    }
    setAiMatchStopConfirmVisible(false);
    setAiMatchingDisabledForUser(uid, true);
    showGlobalModal(t("call.safety.menu_title"), t("call.ai_matching_stop_done"));
    startRematchAfterCallSafety();
  }, [auth?.userId, callSafetySubmitting, setAiMatchingDisabledForUser, showGlobalModal, startRematchAfterCallSafety, t]);

  const onPressTranslateToggle = useCallback(() => {
    if (phaseRef.current !== "calling") return;
    if (!isPremiumRef.current) {
      setTranslateUpsellModalVisible(true);
      return;
    }
    if (liveTranslateEnabledRef.current) {
      setLiveTranslateEnabled(false);
      return;
    }
    const targetLang = normalizeCallLanguage(currentLangRef.current || "ko") || "ko";
    const sourceLang = getEffectivePeerLanguage();
    if (sourceLang && sourceLang === targetLang) {
      setLiveTranslateEnabled(false);
      showTranslateNotice(t("call.translate.same_language_notice"));
      return;
    }
    setLiveTranslateEnabled(true);
  }, [getEffectivePeerLanguage, t]);

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
    resetNoMatchTimer();
    if (!isPremiumRef.current) {
      setMatchFilterUpsellModalVisible(true);
      return;
    }
    openMatchFilterModal();
  }, [openMatchFilterModal, resetNoMatchTimer]);

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
        retryMatchingNow();
      }
    } finally {
      setMatchFilterSaving(false);
    }
  }, [applyMatchFilterState, auth?.deviceKey, auth?.token, auth?.userId, matchFilterDraft, matchFilterSaving, retryMatchingNow, showGlobalModal, t]);

  const onOpenDelayedMatchConditions = useCallback(() => {
    onPressMatchingFilter();
  }, [onPressMatchingFilter]);

  const onPressOpenCallReport = useCallback(() => {
    if (callSafetySubmitting) return;
    if (aiCallActiveRef.current || String(roomIdRef.current || "").startsWith(AI_ROOM_ID_PREFIX)) {
      showAiRestrictionNotice(t("call.report.ai_unavailable"));
      return;
    }
    setCallSafetyMenuVisible(false);
    setCallReportReasonCode(callReportReasons[0]?.code || "");
    setCallReportModalVisible(true);
  }, [callReportReasons, callSafetySubmitting, showAiRestrictionNotice]);

  const onPressConfirmCallReport = useCallback(async () => {
    if (callReportSubmitting || callBlockSubmitting) return;
    if (aiCallActiveRef.current || String(roomIdRef.current || "").startsWith(AI_ROOM_ID_PREFIX)) {
      showAiRestrictionNotice(t("call.report.ai_unavailable"));
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
      showAiRestrictionNotice(t("call.block.ai_unavailable"));
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

  const mergeCallContactIntoState = useCallback((nextContact?: CallContactItem | null) => {
    if (!nextContact) return;
    callContactsStateSeqRef.current += 1;
    setCallContacts((prev) => {
      const filtered = prev.filter((row) => {
        const sameKey = nextContact.contactKey && String(row.contactKey || "") === String(nextContact.contactKey || "");
        const samePeerSessionId =
          nextContact.peerSessionId && String(row.peerSessionId || "") === String(nextContact.peerSessionId || "");
        const samePeerProfileId =
          nextContact.peerProfileId && String(row.peerProfileId || "") === String(nextContact.peerProfileId || "");
        const samePeerUserId =
          nextContact.peerUserId && String(row.peerUserId || "") === String(nextContact.peerUserId || "");
        return !sameKey && !samePeerSessionId && !samePeerProfileId && !samePeerUserId;
      });
      if (!nextContact.isFriend && !nextContact.isFavorite) {
        return filtered;
      }
      return [nextContact, ...filtered];
    });
  }, []);

  const removeCallContactFromState = useCallback((target?: {
    contactKey?: string | null;
    peerSessionId?: string | null;
    peerProfileId?: string | null;
    peerUserId?: string | null;
  }) => {
    const contactKey = String(target?.contactKey || "").trim();
    const peerSessionId = String(target?.peerSessionId || "").trim();
    const peerProfileId = String(target?.peerProfileId || "").trim();
    const peerUserId = String(target?.peerUserId || "").trim();
    if (!contactKey && !peerSessionId && !peerProfileId && !peerUserId) return;
    callContactsStateSeqRef.current += 1;
    setCallContacts((prev) =>
      prev.filter((row) => {
        const sameKey = contactKey && String(row.contactKey || "").trim() === contactKey;
        const samePeerSessionId = peerSessionId && String(row.peerSessionId || "").trim() === peerSessionId;
        const samePeerProfileId = peerProfileId && String(row.peerProfileId || "").trim() === peerProfileId;
        const samePeerUserId = peerUserId && String(row.peerUserId || "").trim() === peerUserId;
        return !sameKey && !samePeerSessionId && !samePeerProfileId && !samePeerUserId;
      })
    );
  }, []);

  const findCurrentCallContact = useCallback(
    (rows: CallContactItem[]) => {
      const activeRoomId = String(roomIdRef.current || roomId || "").trim();
      const peerSessionId = String(peerSessionIdRef.current || "").trim();
      const peerProfileId = String((peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId || "").trim();
      const peerUserId = String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim();
      return (
        rows.find((row) => {
          const rowRoomId = String(row.roomId || "").trim();
          const rowPeerSessionId = String(row.peerSessionId || "").trim();
          const rowPeerProfileId = String(row.peerProfileId || "").trim();
          const rowPeerUserId = String(row.peerUserId || "").trim();
          if (activeRoomId && rowRoomId && rowRoomId === activeRoomId) return true;
          if (peerSessionId && rowPeerSessionId && rowPeerSessionId === peerSessionId) return true;
          if (peerProfileId && rowPeerProfileId && rowPeerProfileId === peerProfileId) return true;
          if (peerUserId && rowPeerUserId && rowPeerUserId === peerUserId) return true;
          return false;
        }) || null
      );
    },
    [peerInfo, roomId]
  );

  const loadCallContacts = useCallback(
    async (options?: {
      showErrors?: boolean;
      showSpinner?: boolean;
      guardRoomId?: string;
      roomId?: string;
      peerSessionId?: string;
      peerProfileId?: string;
      peerUserId?: string;
    }) => {
      const requestSeq = callContactsLoadSeqRef.current + 1;
      callContactsLoadSeqRef.current = requestSeq;
      const stateSeqAtStart = callContactsStateSeqRef.current;
      const showErrors = options?.showErrors === true;
      const showSpinner = options?.showSpinner !== false;
      const guardRoomId = String(options?.guardRoomId || "").trim();
      const activeRoomId = String(options?.roomId || roomIdRef.current || roomId || "").trim();
      const peerSessionId = String(options?.peerSessionId || "").trim();
      const peerProfileId = String(options?.peerProfileId || "").trim();
      const peerUserId = String(options?.peerUserId || "").trim();
      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();
      if (!token || !userId || !deviceKey) {
        callContactsStateSeqRef.current += 1;
        setCallContacts([]);
        if (showErrors) {
          showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
        }
        return null;
      }

      if (showSpinner) {
        setCallContactsLoading(true);
      }
      try {
        const out = await fetchCallContactsOnServer({
          token,
          userId,
          deviceKey,
          limit: 200,
          roomId: activeRoomId || undefined,
          peerSessionId: peerSessionId || undefined,
          peerProfileId: peerProfileId || undefined,
          peerUserId: peerUserId || undefined,
        });
        if (!out.ok) {
          if (showErrors) {
            const errCode = String(out.errorCode || "").toUpperCase();
            if (errCode === "CALL_CONTACT_LIST_ROUTE_NOT_FOUND") {
              showGlobalModal(t("call.contact.title"), t("call.contact.route_missing"));
            } else {
              showGlobalModal(t("call.contact.title"), out.errorMessage || out.errorCode || t("common.error_occurred"));
            }
          }
          return null;
        }
        if (callContactsLoadSeqRef.current !== requestSeq) {
          return null;
        }
        if (callContactsStateSeqRef.current !== stateSeqAtStart) {
          return null;
        }
        if (guardRoomId) {
          const currentRoomId = String(roomIdRef.current || roomId || "").trim();
          if (currentRoomId !== guardRoomId || phaseRef.current !== "calling") {
            return null;
          }
        }
        callContactsStateSeqRef.current += 1;
        setCallContacts(out.contacts);
        return out.contacts;
      } finally {
        if (showSpinner) {
          setCallContactsLoading(false);
        }
      }
    },
    [auth?.deviceKey, auth?.token, auth?.userId, roomId, showGlobalModal, t]
  );

  const reloadCurrentCallContact = useCallback(
    async (options?: { showErrors?: boolean; showSpinner?: boolean; guardRoomId?: string }) => {
      const rows = await loadCallContacts({
        showErrors: options?.showErrors,
        showSpinner: options?.showSpinner,
        guardRoomId: options?.guardRoomId,
        roomId: String(options?.guardRoomId || roomIdRef.current || roomId || "").trim() || undefined,
        peerSessionId: String(peerSessionIdRef.current || "").trim(),
        peerProfileId: String((peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId || "").trim(),
        peerUserId: String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim(),
      });
      if (!rows) return null;
      return findCurrentCallContact(rows);
    },
    [findCurrentCallContact, loadCallContacts, peerInfo]
  );

  const fetchCurrentCallContactSnapshot = useCallback(
    async (guardRoomId?: string) => {
      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();
      if (!token || !userId || !deviceKey) return null;

      const out = await fetchCallContactsOnServer({
        token,
        userId,
        deviceKey,
        limit: 200,
        roomId: String(guardRoomId || roomIdRef.current || roomId || "").trim() || undefined,
        peerSessionId: String(peerSessionIdRef.current || "").trim() || undefined,
        peerProfileId: String((peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId || "").trim() || undefined,
        peerUserId: String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim() || undefined,
      });
      if (!out.ok) return null;

      if (guardRoomId) {
        const currentRoomId = String(roomIdRef.current || roomId || "").trim();
        if (currentRoomId !== String(guardRoomId || "").trim() || phaseRef.current !== "calling") {
          return null;
        }
      }

      callContactsStateSeqRef.current += 1;
      setCallContacts(out.contacts);
      return findCurrentCallContact(out.contacts);
    },
    [auth?.deviceKey, auth?.token, auth?.userId, findCurrentCallContact, peerInfo, roomId]
  );

  const onPressOpenCallContacts = useCallback(() => {
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
      return;
    }
    setCallContactsModalVisible(true);
    void loadCallContacts({ showErrors: true, showSpinner: true });
  }, [auth?.deviceKey, auth?.token, auth?.userId, loadCallContacts, showGlobalModal, t]);

  const onPressToggleCallFriend = useCallback(async () => {
    if (callContactMutating) return;
    const activeRoomId = String(roomIdRef.current || roomId || "").trim();
    if (phaseRef.current !== "calling" || !activeRoomId) {
      showGlobalModal(t("call.contact.title"), t("call.contact.require_active_call"));
      return;
    }
    if (aiCallActiveRef.current || activeRoomId.startsWith(AI_ROOM_ID_PREFIX)) {
      showAiRestrictionNotice(t("call.contact.ai_unavailable"));
      return;
    }
    const preflightContact =
      (await fetchCurrentCallContactSnapshot(activeRoomId || undefined)) ||
      (await reloadCurrentCallContact({
        showErrors: false,
        showSpinner: false,
        guardRoomId: activeRoomId || undefined,
      }));
    const currentContact = preflightContact || findCurrentCallContact(callContacts);
    const currentFriend =
      typeof currentContact?.isFriend === "boolean" ? Boolean(currentContact.isFriend) : Boolean(callFriendAdded);
    const activePeerSessionId =
      String(peerSessionIdRef.current || "").trim() ||
      String(currentContact?.peerSessionId || "").trim();
    const activePeerProfileId =
      String((peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId || "").trim() ||
      String(currentContact?.peerProfileId || "").trim();
    const activePeerUserId =
      String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim() ||
      String(currentContact?.peerUserId || "").trim();

    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
      return;
    }

    const nextEnabled = !currentFriend;
    setCallFriendAdded(nextEnabled);
    setCallContactMutating("friend");
    try {
      type FriendMutationResult = {
        ok: boolean;
        errorCode: string;
        errorMessage: string;
        contact?: CallContactItem;
      };
      const mutationInput = {
        token,
        userId,
        deviceKey,
        roomId: activeRoomId,
        peerSessionId: activePeerSessionId || undefined,
        peerProfileId: activePeerProfileId || undefined,
        peerUserId: activePeerUserId || undefined,
        peerCountry: String((peerInfo as any)?.country || "").trim() || undefined,
        peerLanguage: String((peerInfo as any)?.language || (peerInfo as any)?.lang || "").trim() || undefined,
        peerGender: String((peerInfo as any)?.gender || "").trim() || undefined,
        peerFlag:
          String((peerInfo as any)?.flag || "").trim() ||
          countryCodeToFlagEmoji(String((peerInfo as any)?.country || "").trim()) ||
          undefined,
        enabled: nextEnabled,
      };
      let out: FriendMutationResult | null = null;
      const signalOut = await wsRef.current?.sendCallFriend({
          roomId: mutationInput.roomId,
          enabled: mutationInput.enabled,
          peerSessionId: mutationInput.peerSessionId,
          peerProfileId: mutationInput.peerProfileId,
          peerUserId: mutationInput.peerUserId,
          peerCountry: mutationInput.peerCountry,
          peerLanguage: mutationInput.peerLanguage,
          peerGender: mutationInput.peerGender,
          peerFlag: mutationInput.peerFlag,
        });
      if (signalOut) {
        out = {
          ok: signalOut.ok,
          errorCode: signalOut.errorCode,
          errorMessage: signalOut.errorMessage,
          contact: signalOut.contact as CallContactItem | undefined,
        };
      }
      if (!out || (!out.ok && ["SIGNAL_UNAVAILABLE", "SIGNAL_TIMEOUT", "SIGNAL_RESET", "SIGNAL_CLOSED"].includes(String(out.errorCode || "").toUpperCase()))) {
        out = (await setCallFriendOnServer(mutationInput)) as FriendMutationResult;
      }
      if (!out) {
        setCallFriendAdded(currentFriend);
        showGlobalModal(t("call.contact.title"), t("call.contact.save_failed"));
        return;
      }
      if (!out.ok) {
        const refreshedContact =
          (await fetchCurrentCallContactSnapshot(activeRoomId || undefined)) ||
          (await reloadCurrentCallContact({
            showErrors: false,
            showSpinner: false,
            guardRoomId: activeRoomId || undefined,
          }));
        const refreshedFriend = Boolean(refreshedContact?.isFriend);
        if (refreshedFriend === nextEnabled) {
          setCallFriendAdded(refreshedFriend);
          return;
        }
        setCallFriendAdded(currentFriend);
        const errCode = String(out.errorCode || "").toUpperCase();
        if (errCode === "INVALID_INPUT" || errCode === "ROOM_OR_PEER_REQUIRED") {
          showGlobalModal(t("call.contact.title"), t("call.contact.require_active_call"));
        } else if (errCode === "CALL_FRIEND_ROUTE_NOT_FOUND") {
          showGlobalModal(t("call.contact.title"), t("call.contact.route_missing"));
        } else {
          showGlobalModal(t("call.contact.title"), out.errorMessage || out.errorCode || t("call.contact.save_failed"));
        }
        return;
      }

      const resolvedFriend = Boolean(out.contact?.isFriend ?? nextEnabled);
      setCallFriendAdded(resolvedFriend);
      if (out.contact) {
        mergeCallContactIntoState(out.contact);
      } else if (!resolvedFriend) {
        removeCallContactFromState({
          contactKey: currentContact?.contactKey,
          peerSessionId: activePeerSessionId || currentContact?.peerSessionId,
          peerProfileId: activePeerProfileId || currentContact?.peerProfileId,
          peerUserId: activePeerUserId || currentContact?.peerUserId,
        });
      }
      const refreshedContact =
        (await fetchCurrentCallContactSnapshot(activeRoomId || undefined)) ||
        (await reloadCurrentCallContact({
          showErrors: false,
          showSpinner: false,
          guardRoomId: activeRoomId || undefined,
        }));
      if (refreshedContact) {
        setCallFriendAdded(Boolean(refreshedContact.isFriend));
      } else if (!resolvedFriend) {
        setCallFriendAdded(false);
      }
      if (callContactsModalVisible && !refreshedContact) {
        void loadCallContacts({ showErrors: false, showSpinner: false });
      }
    } finally {
      setCallContactMutating("");
    }
  }, [
    auth?.deviceKey,
    auth?.token,
    auth?.userId,
    callContactMutating,
    callFriendAdded,
    callContactsModalVisible,
    callContacts,
    findCurrentCallContact,
    fetchCurrentCallContactSnapshot,
    loadCallContacts,
    mergeCallContactIntoState,
    removeCallContactFromState,
    peerInfo,
    reloadCurrentCallContact,
    roomId,
    showAiRestrictionNotice,
    showGlobalModal,
    t,
    wsRef,
  ]);

  const onPressRecallContact = useCallback(
    async (item: CallContactItem) => {
      if (callContactMutating) return;
      if (!canRecallSavedContact) {
        showGlobalModal(t("call.contact.title"), t("call.contact.recall_waiting_only"));
        return;
      }
      if (!item.canRecall && !item.isOnline) {
        showGlobalModal(t("call.contact.title"), t("call.contact.recall_unavailable"));
        return;
      }

      if (!String(auth?.token || "").trim() || !String(auth?.userId || "").trim() || !String(auth?.deviceKey || "").trim()) {
        showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
        return;
      }

      setCallContactMutating("recall");
      try {
        const out = await beginOutgoingRecallRequest({
          peerSessionId: String(item.peerSessionId || "").trim() || undefined,
          peerProfileId: String(item.peerProfileId || "").trim() || undefined,
        });
        if (!out.ok) {
          void loadCallContacts({ showErrors: false, showSpinner: false });
          return;
        }

        setCallContactsModalVisible(false);
      } finally {
        setCallContactMutating("");
      }
    },
    [auth?.deviceKey, auth?.token, auth?.userId, callContactMutating, canRecallSavedContact, loadCallContacts, showGlobalModal, t]
  );

  useEffect(() => {
    if (phase === "calling") {
      setCallContactsModalVisible(false);
      setCallDisconnectModalVisible(false);
    }
  }, [phase]);

  useEffect(() => {
    if (phase !== "calling") {
      setCallFriendAdded(false);
      return;
    }
    const current = findCurrentCallContact(callContacts);
    if (current) {
      setCallFriendAdded(Boolean(current.isFriend));
    }
  }, [callContacts, findCurrentCallContact, phase, roomId]);

  useEffect(() => {
    callContactsStateSeqRef.current += 1;
    setCallContacts([]);
    setCallFriendAdded(false);
  }, [roomId]);

  useEffect(() => {
    let closed = false;
    if (phase !== "calling") return;
    if (callContactsModalVisible) return;
    if (
      !roomId ||
      (
        !String(peerSessionIdRef.current || "").trim() &&
        !String((peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId || "").trim() &&
        !String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim()
      )
    ) {
      return;
    }

    (async () => {
      const activeRoomId = String(roomIdRef.current || roomId || "").trim();
      const ok = await loadCallContacts({
        showErrors: false,
        showSpinner: false,
        guardRoomId: activeRoomId || undefined,
        roomId: activeRoomId || undefined,
        peerSessionId: String(peerSessionIdRef.current || "").trim(),
        peerProfileId: String((peerInfo as any)?.profileId || (peerInfo as any)?.peerProfileId || "").trim(),
        peerUserId: String((peerInfo as any)?.userId || (peerInfo as any)?.uid || "").trim(),
      });
      if (!ok || closed) return;
    })();

    return () => {
      closed = true;
    };
  }, [callContactsModalVisible, loadCallContacts, peerInfo, phase, roomId]);

  const formatCallContactTime = useCallback((value: number) => {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "";
    }
  }, []);

  const getCallContactTitle = useCallback(
    (item: CallContactItem) => {
      return resolveDisplayName({
        nickname: item.peerNickname,
        loginAccount: item.peerLoginAccount,
        userId: item.peerUserId,
        profileId: item.peerProfileId,
        contactKey: item.contactKey,
        fallback: t("call.contact.unknown_peer"),
      });
    },
    [t]
  );

  const getCallContactInfoText = useCallback(
    (item: CallContactItem) => {
      const flag = String(item.peerFlag || countryCodeToFlagEmoji(String(item.peerCountry || "").trim()) || "").trim();
      const parts: string[] = [];
      const countryCode = String(item.peerCountry || "").trim().toUpperCase();
      const languageCode = normalizeLanguageCode(String(item.peerLanguage || "").trim());
      const genderCode = String(item.peerGender || "").trim().toLowerCase();
      if (countryCode) {
        parts.push(getCountryName(t, countryCode));
      }
      if (languageCode) {
        parts.push(getLanguageName(t, languageCode));
      }
      if (genderCode === "male") {
        parts.push(t("gender.male"));
      } else if (genderCode === "female") {
        parts.push(t("gender.female"));
      }
      const base = parts.filter(Boolean).join(" / ");
      return `${flag ? `${flag} ` : ""}${base}`.trim();
    },
    [t]
  );

  const getCallContactStatusText = useCallback(
    (item: CallContactItem) => {
      if (item.canRecall) return t("call.contact.status_waiting");
      if (item.isOnline) return t("call.contact.status_online");
      return t("call.contact.status_offline");
    },
    [t]
  );

  const onPressPopTalkCharge = useCallback(() => {
    closeAllPopTalkModals();
    if (phaseRef.current === "calling" && webrtcConnectedRef.current) {
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

  const onPressPopTalkReconnect = useCallback(() => {
    void retryMatchingAfterRecoveryModal();
  }, [retryMatchingAfterRecoveryModal]);

  const onCloseCallDisconnectToHome = useCallback(() => {
    setCallDisconnectModalVisible(false);
    onExitToHome();
  }, [onExitToHome]);

  const onPressWatchPopTalkAd = useCallback(async () => {
    if (popTalkRewardAdBusyRef.current) return;
    popTalkRewardAdBusyRef.current = true;
    setPopTalkRewardAdBusy(true);
    extendPopTalkShortageModalSuppression(90 * 1000);
    closeAllPopTalkModals();
    popTalkChargeInProgressRef.current = true;
    popTalkChargeGraceUntilRef.current = Date.now() + 45 * 1000;

    try {
      await waitForPopTalkModalDismiss();
      const out = await watchRewardedAdAndReward(POPTALK_REWARDED_AMOUNT, "call_rewarded_ad");
      if (out.ok) {
        setPopTalkAdFailModal(false);
        setPopTalkAdFailCount(0);
        closeAllPopTalkModals();
        try {
          await refreshPopTalk();
        } catch {}

        const bal = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
        if (bal > 0) {
          popTalkChargeInProgressRef.current = false;
          popTalkChargeGraceUntilRef.current = 0;
          extendPopTalkShortageModalSuppression(2500);
        } else {
          // Keep the shortage modals suppressed briefly while reward sync catches up.
          popTalkChargeGraceUntilRef.current = Date.now() + 15 * 1000;
          extendPopTalkShortageModalSuppression(15 * 1000);
        }
        if (bal > POPTALK_MATCH_BLOCK_THRESHOLD && phaseRef.current !== "calling") {
          startQueue(true);
        }
        return;
      }

      popTalkChargeInProgressRef.current = false;
      popTalkChargeGraceUntilRef.current = 0;
      extendPopTalkShortageModalSuppression(2500);
      setPopTalkAdFailCount((prev) => {
        const next = prev + 1;
        setPopTalkAdFailModal(true);
        return next;
      });
    } finally {
      setPopTalkLowModal(false);
      setPopTalkMatchBlockModal(false);
      setPopTalkEmptyModal(false);
      popTalkRewardAdBusyRef.current = false;
      setPopTalkRewardAdBusy(false);
    }
  }, [closeAllPopTalkModals, extendPopTalkShortageModalSuppression, refreshPopTalk, startQueue, waitForPopTalkModalDismiss, watchRewardedAdAndReward]);

  const onCloseBeautySheet = useCallback(() => {
    closeBeauty();
    const p = String(phaseRef.current || "");
    if (p === "connecting" || p === "queued" || p === "ended") {
      restartMatchingActionsAfterBeautyCloseRef.current = true;
    }
  }, [closeBeauty]);

  useEffect(() => {
    if (beautyOpen) return;
    if (!restartMatchingActionsAfterBeautyCloseRef.current) return;
    restartMatchingActionsAfterBeautyCloseRef.current = false;
    const p = String(phaseRef.current || "");
    if (p === "connecting" || p === "queued" || p === "ended") {
      resetNoMatchTimer();
      setMatchingActionsVisible(true);
      startMatchingActionsTimer(false);
    }
  }, [beautyOpen, resetNoMatchTimer, setMatchingActionsVisible, startMatchingActionsTimer]);

  useEffect(() => {
    if (!isScreenFocused) return;
    if (!restoreMatchingActionsOnNextFocusRef.current) return;
    restoreMatchingActionsOnNextFocusRef.current = false;
    if (beautyOpenRef.current || beautyOpeningIntentRef.current) return;
    const p = String(phaseRef.current || "");
    if (p === "connecting" || p === "queued" || p === "ended") {
      resetNoMatchTimer();
      setMatchingActionsVisible(true);
      startMatchingActionsTimer(false);
    }
  }, [beautyOpenRef, beautyOpeningIntentRef, isScreenFocused, resetNoMatchTimer, setMatchingActionsVisible, startMatchingActionsTimer]);

  useEffect(() => {
    if (phase !== "calling" || !callTransportReady) return;
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
          stopAll(false, false);
          setPhase("ended");
          setReMatchText("");
          setPopTalkSyncFailedModal(true);
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
  }, [callTransportReady, consumePopTalk, phase, popTalkUnlimited, refreshPopTalk, showGlobalModal, stopAll, t]);

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
        mediaSurfaceEpoch={mediaSurfaceEpoch}
        stageH={stageH}
        onStageLayout={setStageH}
        swipePanHandlers={phase === "calling" ? swipeRefreshPanResponder.panHandlers : undefined}
        showLocalOverlay={showLocalOverlay}
        localBottom={localBottom}
        localCallingHeight={localCallingHeight}
        beautyOpen={beautyOpen}
        localStreamURL={localStreamURL}
        myCamOn={myCamOn}
        mySoundOn={mySoundOn}
        localMicLevelAnim={localMicLevelAnim}
        peerSoundOn={peerSoundOn}
        remoteMicLevelAnim={remoteMicLevelAnim}
        myDisplayName={myChatDisplayName}
        myAvatarUrl={myChatAvatarUrl}
        localVideoZOrder={LOCAL_VIDEO_Z_ORDER}
        localAreaTop={localAreaTop}
        chatFeedVisible={chatFeedVisible}
        chatMessages={chatMessages}
        chatFeedOpacity={chatFeedOpacityRef.current}
        chatFeedHideProgress={chatFeedHideProgressRef.current}
        remoteBottom={remoteBottom}
        remoteStreamURL={remoteStreamURL}
        remoteCamOn={remoteCamOn}
        peerDisplayName={peerDisplayName}
        peerAvatarUrl={peerChatAvatarUrl}
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
        swipeGuideAvoidTopRight={isAiSafetyTarget}
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
              { top: topActionTranslateTop, right: topActionRight },
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
              { top: topActionShopTop, right: topActionRight },
              pressed ? { opacity: 0.72 } : null,
            ]}
          >
            <Ionicons name="cart-outline" size={24} color="#fff" />
          </Pressable>
          {liveTranslateEnabled ? (
            <View pointerEvents="none" style={[styles.liveTranslateStatusWrap, { top: topActionBadgeTop, right: topActionRight }]}>
              <AppText style={styles.liveTranslateStatusText}>{t("call.translate.active_label")}</AppText>
            </View>
          ) : null}
          <Pressable
            onPress={() => navigation.navigate("GiftBox", { mode: "send" })}
            hitSlop={12}
            style={({ pressed }) => [
              styles.giftSendBtn,
              { top: topActionGiftTop, right: topActionRight },
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
              { top: topActionSafetyTop, right: topActionRight },
              pressed || callSafetySubmitting ? { opacity: 0.72 } : null,
            ]}
          >
            <AppText style={styles.callSafetyBtnText}>{"⚠"}</AppText>
          </Pressable>
          {isAiSafetyTarget ? (
            <Pressable
              onPress={onPressDisableAiMatching}
              hitSlop={12}
              disabled={callSafetySubmitting}
              style={({ pressed }) => [
                styles.callAiStopBtn,
                { top: topActionAiStopTop, right: topActionRight },
                callSafetySubmitting ? { opacity: 0.62 } : null,
                pressed ? styles.callAiStopBtnPressed : null,
              ]}
            >
              <AppText style={styles.callAiStopBtnText}>{"🚫"}</AppText>
            </Pressable>
          ) : null}
          {!isAiSafetyTarget ? (
            <>
              <Pressable
                onPress={onPressToggleCallFriend}
                hitSlop={12}
                disabled={Boolean(callContactMutating) || !roomId}
                style={({ pressed }) => [
                  styles.callContactQuickBtn,
                  { top: topActionFriendTop, right: topActionRight },
                  callFriendAdded ? styles.callContactQuickBtnActive : null,
                  callContactMutating || !roomId ? { opacity: 0.62 } : null,
                  pressed ? { opacity: 0.72 } : null,
                ]}
              >
                <Ionicons name={callFriendAdded ? "people" : "person-add-outline"} size={22} color="#FFFFFF" />
              </Pressable>
            </>
          ) : null}
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
        noMatchModal={noMatchModal && !outgoingRecallAwaitingAccept}
        isPremium={isPremium}
        onDismissNoMatch={dismissNoMatch}
        onRetry={onPressRetryFromNoMatch}
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
        visible={Boolean(translateNotice)}
        title={t("call.translate.premium_title")}
        dismissible={false}
        size="compact"
        onClose={() => undefined}
      >
        <AppText style={styles.modalText}>{translateNotice}</AppText>
      </AppModal>

      <AppModal
        visible={outgoingRecallDelayModalVisible}
        title={t("call.contact.outgoing_wait_title")}
        dismissible={true}
        size="compact"
        onClose={() => setOutgoingRecallDelayModalVisible(false)}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("call.contact.outgoing_wait_retry")} onPress={() => {
              void retryOutgoingRecallRequest();
            }} />
            <PrimaryButton title={t("call.contact.outgoing_wait_close")} variant="ghost" onPress={exitOutgoingRecallFlow} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.contact.outgoing_wait_body")}</AppText>
      </AppModal>

      <AppModal
        visible={Boolean(outgoingRecallResultModal)}
        title={outgoingRecallResultModal?.title}
        dismissible={false}
        size="compact"
        onClose={() => undefined}
        footer={
          <View style={{ gap: 10 }}>
            {outgoingRecallTargetRef.current ? (
              <PrimaryButton title={t("call.contact.outgoing_wait_retry")} onPress={() => {
                void retryOutgoingRecallRequest();
              }} />
            ) : null}
            <PrimaryButton title={t("common.close")} onPress={exitOutgoingRecallFlow} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{outgoingRecallResultModal?.body}</AppText>
      </AppModal>

      <AppModal
        visible={recallAcceptedModalVisible}
        title={t("call.contact.accepted_title")}
        dismissible={false}
        size="compact"
        onClose={() => undefined}
      >
        <View style={styles.recallAcceptedModalBody}>
          <AppText style={styles.modalText}>{t("call.contact.accepted_body")}</AppText>
          <Animated.View
            style={[
              styles.recallAcceptedHeartWrap,
              {
                transform: [
                  { rotate: recallAcceptedHeartRotate },
                  { scale: recallAcceptedHeartScaleAnimRef.current },
                ],
              },
            ]}
          >
            <AppText style={styles.recallAcceptedHeartText}>♥</AppText>
          </Animated.View>
        </View>
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

          <AppText style={styles.sectionTitle}>{t("call.match_filter.interest_title")}</AppText>
          <View style={styles.matchFilterInterestOptionWrap}>
            <Pressable
              onPress={() => toggleMatchFilterInterests(MATCH_FILTER_ALL)}
              style={({ pressed }) => [
                styles.matchFilterOption,
                styles.matchFilterInterestOption,
                normalizedMatchFilterDraft.interests.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionActive : null,
                pressed ? styles.matchFilterOptionPressed : null,
              ]}
            >
              <AppText
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.matchFilterOptionText,
                  styles.matchFilterInterestOptionText,
                  normalizedMatchFilterDraft.interests.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionTextActive : null,
                ]}
              >
                {t("call.match_filter.any_option")}
              </AppText>
            </Pressable>
            {MATCH_INTEREST_OPTIONS.map((opt) => {
              const active = normalizedMatchFilterDraft.interests.includes(opt.id);
              return (
                <Pressable
                  key={`match_filter_interest_${opt.id}`}
                  onPress={() => toggleMatchFilterInterests(opt.id)}
                  style={({ pressed }) => [
                    styles.matchFilterOption,
                    styles.matchFilterInterestOption,
                    active ? styles.matchFilterOptionActive : null,
                    pressed ? styles.matchFilterOptionPressed : null,
                  ]}
                >
                  <AppText
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.matchFilterOptionText, styles.matchFilterInterestOptionText, active ? styles.matchFilterOptionTextActive : null]}
                  >
                    {t(opt.labelKey)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </AppModal>

      <AppModal
        visible={callContactsModalVisible}
        title={t("call.contact.title")}
        dismissible={callContactMutating !== "recall"}
        onClose={() => {
          if (callContactMutating === "recall") return;
          setCallContactsModalVisible(false);
        }}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton
              title={callContactsLoading ? t("common.loading") : t("common.retry")}
              variant="ghost"
              disabled={Boolean(callContactMutating)}
              onPress={() => {
                void loadCallContacts({ showErrors: true, showSpinner: true });
              }}
            />
            <PrimaryButton
              title={t("common.close")}
              variant="ghost"
              disabled={callContactMutating === "recall"}
              onPress={() => setCallContactsModalVisible(false)}
            />
          </View>
        }
      >
        {callContactsLoading ? <AppText style={styles.modalText}>{t("common.loading")}</AppText> : null}
        {!callContactsLoading && callContacts.length <= 0 ? <AppText style={styles.callContactEmptyText}>{t("call.contact.empty")}</AppText> : null}
        {callContacts.length > 0 ? (
          <ScrollView style={styles.callContactsScroll} contentContainerStyle={styles.callContactsList} showsVerticalScrollIndicator>
            {callContacts.map((item) => {
              const lastCallLabel = formatCallContactTime(item.lastCallAtMs);
              const infoText = getCallContactInfoText(item);
              const statusText = getCallContactStatusText(item);
              const statusStyle = item.canRecall
                ? styles.callContactStatusWaiting
                : item.isOnline
                  ? styles.callContactStatusOnline
                  : styles.callContactStatusOffline;
              const recallEnabled = canRecallSavedContact && (item.canRecall || item.isOnline) && !callContactMutating;
              return (
                <View key={item.contactKey || item.peerSessionId || item.peerProfileId} style={styles.callContactRow}>
                  <View style={styles.callContactRowTop}>
                    <View style={styles.callContactTextWrap}>
                      <View style={styles.callContactBadgeRow}>
                        {item.isFriend ? (
                          <View style={styles.callContactBadge}>
                            <AppText style={styles.callContactBadgeText}>{t("call.contact.friend_badge")}</AppText>
                          </View>
                        ) : null}
                      </View>
                      <AppText style={styles.callContactTitle}>{getCallContactTitle(item)}</AppText>
                      {infoText ? <AppText style={styles.callContactMeta}>{infoText}</AppText> : null}
                      <AppText style={[styles.callContactMeta, statusStyle]}>{statusText}</AppText>
                      {lastCallLabel ? (
                        <AppText style={styles.callContactMeta}>{t("call.contact.last_call_at", { time: lastCallLabel })}</AppText>
                      ) : null}
                    </View>
                    <PrimaryButton
                      title={recallEnabled ? t("call.contact.recall") : t("call.contact.recall_unavailable")}
                      style={styles.callContactActionBtn}
                      textStyle={styles.callContactActionBtnText}
                      variant={recallEnabled ? "primary" : "ghost"}
                      disabled={!recallEnabled}
                      onPress={() => {
                        void onPressRecallContact(item);
                      }}
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
        ) : null}
      </AppModal>

      <AppModal
        visible={callDisconnectModalVisible}
        title={t("poptalk.sync_failed_title")}
        dismissible={false}
        onClose={onCloseCallDisconnectToHome}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("common.retry")} onPress={() => void retryAfterCallDisconnect()} />
            <PrimaryButton title={t("common.close")} variant="ghost" onPress={onCloseCallDisconnectToHome} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.network_unstable")}</AppText>
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
        <AppText style={styles.callSafetyGuideText}>{t("call.safety.guide")}</AppText>
      </AppModal>

      <AppModal
        visible={aiMatchStopConfirmVisible}
        title={t("call.ai_matching_stop_confirm_title")}
        dismissible={!callSafetySubmitting}
        onClose={() => {
          if (callSafetySubmitting) return;
          setAiMatchStopConfirmVisible(false);
        }}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("common.confirm")} disabled={callSafetySubmitting} onPress={onPressConfirmDisableAiMatching} />
            <PrimaryButton
              title={t("common.cancel")}
              variant="ghost"
              disabled={callSafetySubmitting}
              onPress={() => setAiMatchStopConfirmVisible(false)}
            />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.ai_matching_stop_confirm_body")}</AppText>
      </AppModal>

      <AppModal
        visible={aiRetryAllowConfirmVisible}
        title={t("call.retry_allow_ai_title")}
        dismissible={true}
        onClose={() => setAiRetryAllowConfirmVisible(false)}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("common.confirm")} onPress={onPressConfirmAllowAiRetry} />
            <PrimaryButton title={t("call.retry_allow_ai_no")} variant="ghost" onPress={onPressKeepAiBlockedRetry} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.retry_allow_ai_body")}</AppText>
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
        visible={!popTalkShortageModalSuppressed && popTalkLowModal}
        title={t("poptalk.low_title")}
        dismissible={true}
        onClose={() => setPopTalkLowModal(false)}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("poptalk.charge")} disabled={popTalkRewardAdBusy} onPress={onPressPopTalkCharge} />
            <PrimaryButton title={t("poptalk.watch_ad")} disabled={popTalkRewardAdBusy} onPress={onPressWatchPopTalkAd} />
            <PrimaryButton title={t("common.close")} variant="ghost" disabled={popTalkRewardAdBusy} onPress={() => setPopTalkLowModal(false)} />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20, textAlign: "center" }}>
          {t("poptalk.low_desc")}
          {"\n"}
          {popTalkBalanceLine}
        </AppText>
      </AppModal>

      <AppModal
        visible={!popTalkShortageModalSuppressed && popTalkMatchBlockModal}
        title={t("poptalk.match_block_title")}
        dismissible={false}
        onClose={onPressPopTalkWait}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("poptalk.charge")} disabled={popTalkRewardAdBusy} onPress={onPressPopTalkCharge} />
            <PrimaryButton title={t("poptalk.watch_ad")} disabled={popTalkRewardAdBusy} onPress={onPressWatchPopTalkAd} />
            <PrimaryButton title={t("poptalk.wait_recharge")} variant="ghost" disabled={popTalkRewardAdBusy} onPress={onPressPopTalkWait} />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20, textAlign: "center" }}>
          {t("poptalk.match_block_desc", { min: POPTALK_MATCH_BLOCK_THRESHOLD })}
          {"\n"}
          {popTalkBalanceLine}
        </AppText>
      </AppModal>

      <AppModal
        visible={!popTalkShortageModalSuppressed && popTalkEmptyModal}
        title={t("poptalk.empty_title")}
        dismissible={false}
        onClose={onPressPopTalkWait}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("poptalk.charge")} disabled={popTalkRewardAdBusy} onPress={onPressPopTalkCharge} />
            <PrimaryButton title={t("poptalk.watch_ad")} disabled={popTalkRewardAdBusy} onPress={onPressWatchPopTalkAd} />
            <PrimaryButton title={t("poptalk.wait_recharge")} variant="ghost" disabled={popTalkRewardAdBusy} onPress={onPressPopTalkWait} />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20, textAlign: "center" }}>
          {t("poptalk.empty_desc")}
          {"\n"}
          {popTalkBalanceLine}
        </AppText>
      </AppModal>

      <AppModal
        visible={popTalkSyncFailedModal}
        title={t("poptalk.sync_failed_title")}
        dismissible={false}
        onClose={() => undefined}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("common.retry")} onPress={onPressPopTalkReconnect} />
            <PrimaryButton title={t("common.close")} variant="ghost" onPress={onPressPopTalkWait} />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20, textAlign: "center" }}>
          {t("poptalk.sync_failed")}
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
              <PrimaryButton title={t("poptalk.retry_ad")} disabled={popTalkRewardAdBusy} onPress={onPressWatchPopTalkAd} />
              <PrimaryButton title={t("common.close")} variant="ghost" onPress={() => setPopTalkAdFailModal(false)} />
            </View>
          )
        }
      >
        <AppText style={{ fontSize: 14, color: "#666", lineHeight: 20, textAlign: "center" }}>
          {popTalkAdFailCount >= 3 ? t("poptalk.ad_fail_desc") : t("poptalk.ad_loading_desc")}
        </AppText>
      </AppModal>
    </View>
  );
}

