// FILE: C:\ranchat\src\screens\CallScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ActivityIndicator, StyleSheet, View, Pressable, Dimensions, ScrollView, Text, BackHandler } from "react-native";
import { RTCView } from "react-native-webrtc";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
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

type Props = NativeStackScreenProps<MainStackParamList, "Call">;

type Phase = "connecting" | "queued" | "matched" | "calling" | "ended";

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

function countryCodeToFlagEmoji(code: string) {
  const cc = String(code || "").trim().toUpperCase();
  if (cc.length !== 2) return "";
  const A = 0x1f1e6;
  const c1 = cc.charCodeAt(0) - 65;
  const c2 = cc.charCodeAt(1) - 65;
  if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return "";
  return String.fromCodePoint(A + c1, A + c2);
}

function normalizeLanguageLabel(v: string, uiLang: string) {
  const s = String(v || "").trim();
  const lower = s.toLowerCase();
  if (!s) return "";

  const code = (() => {
    if (lower === "ko" || lower === "kor" || lower === "korean") return "ko";
    if (lower === "en" || lower === "eng" || lower === "english") return "en";
    if (lower === "ja" || lower === "jpn" || lower === "japanese") return "ja";
    if (lower === "zh" || lower === "chi" || lower === "chinese") return "zh";
    return lower;
  })();

  const u = String(uiLang || "").trim().toLowerCase();

  const MAP: Record<string, Record<string, string>> = {
    ko: { ko: "한국어", en: "영어", ja: "일본어", zh: "중국어", es: "스페인어", de: "독일어", fr: "프랑스어", it: "이탈리아어", ru: "러시아어" },
    en: { ko: "Korean", en: "English", ja: "Japanese", zh: "Chinese", es: "Spanish", de: "German", fr: "French", it: "Italian", ru: "Russian" },
    ja: { ko: "韓国語", en: "英語", ja: "日本語", zh: "中国語", es: "スペイン語", de: "ドイツ語", fr: "フランス語", it: "イタリア語", ru: "ロシア語" },
    zh: { ko: "韩语", en: "英语", ja: "日语", zh: "中文", es: "西班牙语", de: "德语", fr: "法语", it: "意大利语", ru: "俄语" },
    es: { ko: "Coreano", en: "Inglés", ja: "Japonés", zh: "Chino", es: "Español", de: "Alemán", fr: "Francés", it: "Italiano", ru: "Ruso" },
    de: { ko: "Koreanisch", en: "Englisch", ja: "Japanisch", zh: "Chinesisch", es: "Spanisch", de: "Deutsch", fr: "Französisch", it: "Italienisch", ru: "Russisch" },
    fr: { ko: "Coréen", en: "Anglais", ja: "Japonais", zh: "Chinois", es: "Espagnol", de: "Allemand", fr: "Français", it: "Italien", ru: "Russe" },
    it: { ko: "Coreano", en: "Inglese", ja: "Giapponese", zh: "Cinese", es: "Spagnolo", de: "Tedesco", fr: "Francese", it: "Italiano", ru: "Russo" },
    ru: { ko: "Корейский", en: "Английский", ja: "Японский", zh: "Китайский", es: "Испанский", de: "Немецкий", fr: "Французский", it: "Итальянский", ru: "Русский" },
  };

  const dict = MAP[u] || MAP.en;
  return dict[code] || s;
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
  const { t, currentLang } = useTranslation();

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

  const [reMatchText, setReMatchText] = useState<string>("");

  const [prefsModal, setPrefsModal] = useState(false);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const wsRef = useRef<SignalClient | null>(null);
  const rtcRef = useRef<WebRTCSession | null>(null);
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

  const phaseRef = useRef<Phase>("connecting");
  const roomIdRef = useRef<string | null>(null);
  const myCamOnRef = useRef<boolean>(true);
  const mySoundOnRef = useRef<boolean>(true);
  const remoteMutedRef = useRef<boolean>(false);

  const queueTokenRef = useRef(0);
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

  const [signalUnstable, setSignalUnstable] = useState(false);
  const [authBooting, setAuthBooting] = useState(true);
  const authBootInFlightRef = useRef(false);

  const [stageH, setStageH] = useState(0);

  const localBottom = 0;
  const callingRatio = Number(String(OVERLAY_LOCAL_HEIGHT_CALLING).replace("%", "")) / 100;
  const localCallingHeight = stageH > 0 ? Math.round(stageH * callingRatio) : 0;
  const remoteBottom = stageH > 0 ? localBottom + localCallingHeight : 0;

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
    return normalizeLanguageLabel(peerLangRaw, String(currentLang || ""));
  }, [peerLangRaw, currentLang]);
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
  const myLangLabel = useMemo(() => normalizeLanguageLabel(myLangRaw, String(currentLang || "")), [myLangRaw, currentLang]);
  const myGenderRaw = useMemo(() => String((prefs as any)?.gender ?? ""), [prefs]);
  const myGenderLabel = useMemo(() => {
    const g = String(myGenderRaw || "").trim().toLowerCase();
    if (!g) return "";
    if (g === "male" || g === "m") return t("gender.male");
    if (g === "female" || g === "f") return t("gender.female");
    return myGenderRaw;
  }, [myGenderRaw, t]);


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
    adsAliveRef.current = true;
    waitAdsReady(1000);
    return () => {
      adsAliveRef.current = false;
    };
  }, [waitAdsReady]);

  const startNoMatchTimer = () => {
    if (noMatchShownThisCycleRef.current) return;
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);

    noMatchTimerRef.current = setTimeout(() => {
      if (noMatchShownThisCycleRef.current) return;
      noMatchShownThisCycleRef.current = true;

      if (isPremium) {
        setFastMatchHint(true);
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

      setNoMatchModal(true);
    }, MATCH_TIMEOUT_MS);
  };

  const clearNoMatchTimer = () => {
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);
    noMatchTimerRef.current = null;

    if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
    premiumNoMatchAutoCloseRef.current = null;
  };

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

  const stopAll = (isUserExit = false) => {
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

    setLocalStreamURL(null);
    setRemoteStreamURL(null);
    setRoomId(null);
    setPeerInfo(null);
    setRemoteVideoAllowed(true);
    setRemoteCamOn(true);
    setLimitModal(false);
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
      const rtc = new WebRTCSession({
        onLocalStream: (s) => {
          if (queueTokenRef.current !== qTok) return;
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
        },
        onIceCandidate: (c) => ws.sendIce(rid, c),

        onAnswer: (sdp) => ws.sendAnswer(rid, sdp),
        onOffer: (sdp) => ws.sendOffer(rid, sdp),
        onConnectionState: (s) => {
          const st = String(s || "").toLowerCase();

          if (st === "connected") {
            if (queueTokenRef.current !== qTok) return;
            webrtcConnectedRef.current = true;
            if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
            webrtcConnectTimerRef.current = null;
            clearWebrtcDownTimer();
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
      setPhase("calling");

      if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
      webrtcConnectTimerRef.current = setTimeout(() => {
        if (queueTokenRef.current !== qTok) return;
        if (callStartTokenRef.current !== tokenNow) return;
        if (webrtcConnectedRef.current) return;

        suppressEndRelayRef.current = true;
        endCallAndRequeue("disconnect");
      }, 4000);

      try {
        ws.relay(rid, { type: "cam", enabled: Boolean(myCamOnRef.current) });
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
    } else if (why === "find_other") {
      setReMatchText(String(t("call.connecting") || ""));
    } else {
      setReMatchText("");
    }

    stopAll(false);
    setNoMatchModal(false);

    if (why === "remote_left") {
      setPhase("ended");
      if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = setTimeout(() => {
        setPhase("connecting");
        startQueue();
      }, 100);
    } else {
      setPhase("connecting");
      if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
      requeueTimerRef.current = setTimeout(() => {
        startQueue();
      }, 100);
    }
  };

const startQueue = () => {
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
        startQueue();
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

  setNoMatchModal(false);
  setPhase("connecting");
  startNoMatchTimer();

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

    if (String(d?.type ?? "").toLowerCase() === "peer_info") {
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

    return;
  }

  if (msg.type === "queued") {
    setPhase("queued");
    startNoMatchTimer();
    return;
  }
  if (msg.type === "match") {
    if (phaseRef.current === "calling") {
      return;
    }
    clearNoMatchTimer();
    setNoMatchModal(false);
    setFastMatchHint(false);
    queueRunningRef.current = false;
    enqueuedRef.current = false;
    setRoomId(msg.roomId);
    setIsCaller(Boolean(msg.isCaller));
    try {
      ws.relay(msg.roomId, {
        type: "peer_info",
        nonce: myPeerInfoNonceRef.current,
        country: myCountryRaw,
        language: myLangRaw,
        gender: myGenderRaw,
        flag: myFlag,
      });
    } catch {}

    beginCallReqRef.current = { ws, rid: msg.roomId, caller: Boolean(msg.isCaller), qTok };

    if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
    peerReadyTimerRef.current = setTimeout(() => {
      if (wsRef.current !== ws) return;
      if (queueTokenRef.current !== qTok) return;
      const req = beginCallReqRef.current;
      if (!req || req.rid !== msg.roomId) return;

      suppressEndRelayRef.current = true;
      endCallAndRequeue("disconnect");
    }, 1500);

    return;
  }
  if (msg.type === "end") {
    queueRunningRef.current = false;
    manualCloseRef.current = true;
    endCallAndRequeue("remote_left");
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
      if (roomId) wsRef.current?.relay(roomId, { type: "cam", enabled: next });
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
        startQueue();
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
    setNoMatchModal(false);
    endCallAndRequeue("disconnect");
  };

  const dismissNoMatch = () => {
    if (premiumNoMatchAutoCloseRef.current) clearTimeout(premiumNoMatchAutoCloseRef.current);
    premiumNoMatchAutoCloseRef.current = null;
    setNoMatchModal(false);
  };

  const onPressFindOther = () => {
    adAllowedRef.current = true;

    const go = () => {
      try {
        wsRef.current?.leaveRoom(roomId || "");
      } catch {}
      endCallAndRequeue("find_other");
    };

    showInterstitialIfAllowed(go);
  };

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
      showGlobalModal(t("common.settings"), `${field} 저장 함수가 스토어에 없습니다. (setPrefs/setPref/setPrefsField)`);
    }
  }, [showGlobalModal, t]);

  const languageOptions = useMemo(
    () => [
      { key: "ko", label: "한국어" },
      { key: "en", label: "English" },
      { key: "ja", label: "日本語" },
      { key: "zh", label: "中文" },
      { key: "es", label: "Español" },
    ],
    []
  );

  const countryOptions = useMemo(
    () => [
      { key: "KR", name: "Korea" },
      { key: "US", name: "United States" },
      { key: "JP", name: "Japan" },
      { key: "CN", name: "China" },
      { key: "TW", name: "Taiwan" },
      { key: "HK", name: "Hong Kong" },
      { key: "SG", name: "Singapore" },
      { key: "TH", name: "Thailand" },
      { key: "VN", name: "Vietnam" },
      { key: "PH", name: "Philippines" },
      { key: "ID", name: "Indonesia" },
      { key: "MY", name: "Malaysia" },
      { key: "IN", name: "India" },
      { key: "AU", name: "Australia" },
      { key: "CA", name: "Canada" },
      { key: "GB", name: "United Kingdom" },
      { key: "DE", name: "Germany" },
      { key: "FR", name: "France" },
      { key: "ES", name: "Spain" },
      { key: "IT", name: "Italy" },
      { key: "BR", name: "Brazil" },
      { key: "MX", name: "Mexico" },
    ],
    []
  );

  const genderOptions = useMemo(
    () => [
      { key: "male", label: t("gender.male") },
      { key: "female", label: t("gender.female") },
    ],
    [t]
  );

  const currentLanguageLabel = useMemo(() => {
    const cur = String((prefs as any)?.language || "");
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
      <Pressable
        onPress={onPressBack}
        style={({ pressed }) => [
          styles.backBtn,
          { top: insets.top + 8, left: 12 },
          pressed ? { opacity: 0.7 } : null,
        ]}
      >
        <Ionicons name="chevron-back" size={30} color="#fff" />
      </Pressable>


      <View style={styles.stage} onLayout={(e) => setStageH(Math.round(e.nativeEvent.layout.height))}>
        <View style={styles.overlayStage}>
          <View style={styles.localLayer}>
            <View
              style={[
                styles.localArea,
                stageH > 0 ? { bottom: localBottom, height: localCallingHeight } : { bottom: localBottom },
                stageH > 0 ? null : styles.localAreaCalling,
              ]}
            >
              {localStreamURL && phase === "calling" ? (
                myCamOn ? (
                  <View style={styles.localViewport} collapsable={false}>
                    <View style={styles.localVideoMover} collapsable={false}>
                      <RTCView
                        streamURL={localStreamURL}
                        style={styles.localVideoFull}
                        objectFit="cover"
                        zOrder={0}
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

          <View style={styles.remoteLayer}>
  <View style={[styles.remoteArea, stageH > 0 ? { bottom: remoteBottom } : { bottom: OVERLAY_LOCAL_HEIGHT_CALLING }]}>
    {remoteStreamURL && remoteVideoAllowed && remoteCamOn ? (
      <RTCView streamURL={remoteStreamURL} style={styles.remoteVideo} objectFit="cover" zOrder={0} />
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

        </View>


        {!isPremium && phase !== "calling" ? (
          <View style={[styles.queueAdDock, { top: insets.top + 55 }]}>
            <QueueNativeAd256x144 />
          </View>
        ) : null}

        {phase !== "calling" ? (
          <View style={styles.centerOverlay}>
            <ActivityIndicator />

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
              ) : phase === "matched" ? (
                <AppText style={styles.centerText}>{t("call.matched")}</AppText>
              ) : phase === "queued" ? (
                <AppText style={styles.centerText}>{String(t("call.connecting") || "")}</AppText>
              ) : null}
            </View>

          </View>
        ) : null}


        {phase === "calling" ? (
          <View pointerEvents="box-none" style={[styles.controlsOverlay, { bottom: Math.max(insets.bottom, 8) + 14 }]}>
            <View style={styles.controlsRow}>
              <Pressable onPress={() => setPrefsModal(true)} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
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

              <Pressable onPress={onPressFindOther} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name="refresh" size={22} color="#f3cddb" />
              </Pressable>
            </View>
          </View>
        ) : null}
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
              const active = String((prefs as any)?.language || "") === opt.key;
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

const LOCAL_CROP_Y = 16;

const OVERLAY_LOCAL_HEIGHT_CALLING = "45%";


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },

  stage: { flex: 1, position: "relative", backgroundColor: "#c0b2b2" },

  overlayStage: { flex: 1 },

  localLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1,
    elevation: 1,
  },

  localArea: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "50%",
    backgroundColor: "#000",
    overflow: "hidden",
  },

  localAreaCalling: {
    height: OVERLAY_LOCAL_HEIGHT_CALLING,
  },

  remoteLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    elevation: 2,
  },

  remoteArea: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
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
    zIndex: 20,
    elevation: 20,
    width: 44,
    height: 44,
    alignItems: "flex-start",
    justifyContent: "center",
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
    fontWeight: "800",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  remoteInfoSubText: {
    color: "rgba(255, 170, 170, 0.92)",
    fontSize: 11,
    fontWeight: "900",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
    transform: [{ scale: 1.08 }],
  },

  localEmptyFull: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0)",
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

  centerTextDock: {
    marginTop: 28,
    alignItems: "center",
    justifyContent: "center",
  },

  centerText: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 20,
  },

  reMatchTextWrap: {
    alignItems: "center",
    justifyContent: "center",
  },

  reMatchTextTop: {
    textAlign: "center",
    fontSize: 20,
    fontWeight: "600",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 26,
  },

  reMatchTextBottom: {
    textAlign: "center",
    fontSize: 24,
    fontWeight: "800",
    color: "rgba(139, 139, 139, 0.85)",
    lineHeight: 30,
    marginTop: 5,
  },

  queueAdDock: {
    position: "absolute",
    zIndex: 11,
    left: 0,
    right: 0,
    alignItems: "center",
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
    zIndex: 12,
    left: 0,
    right: 0,
    alignItems: "center",
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