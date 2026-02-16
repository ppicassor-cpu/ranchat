// FILE: C:\ranchat\src\screens\CallScreen.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { StyleSheet, View, Pressable, Dimensions, ScrollView } from "react-native";
import { RTCView } from "react-native-webrtc";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import Spinner from "../components/Spinner";
import { theme } from "../config/theme";
import { APP_CONFIG } from "../config/app";
import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import { useAppStore } from "../store/useAppStore";
import { SignalClient, SignalMessage } from "../services/signal/SignalClient";
import { WebRTCSession } from "../services/webrtc/WebRTCSession";
import { BannerBar, createInterstitial } from "../services/ads/AdManager";
import { AdEventType, NativeAd, NativeAdView, NativeAsset, NativeAssetType, NativeMediaView, NativeMediaAspectRatio, TestIds } from "react-native-google-mobile-ads";
import { purchasePremium, refreshSubscription } from "../services/purchases/PurchaseManager";
import type { MainStackParamList } from "../navigation/MainStack";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<MainStackParamList, "Call">;

type Phase = "connecting" | "queued" | "matched" | "calling" | "ended";

// ✅ APP_CONFIG 타입에 값이 없어도 TS 에러 없이 동작하도록 fallback 상수로 사용
const MATCH_TIMEOUT_MS = (() => {
  const v = Number((APP_CONFIG as any)?.MATCH_TIMEOUT_MS);
  return Number.isFinite(v) ? v : 20000;
})();

// ✅ 무료 30초 제한을 3000초로 변경(사실상 비활성 수준)
const FREE_CALL_LIMIT_MS = (() => {
  const direct = Number((APP_CONFIG as any)?.FREE_CALL_LIMIT_MS);
  if (Number.isFinite(direct)) return direct;

  const sec = Number((APP_CONFIG as any)?.FREE_LIMITS?.remoteVideoSeconds);
  if (Number.isFinite(sec)) return sec * 1000;

  return 3000 * 1000;
})();

// ✅ 전면광고 재노출 쿨다운(3분)
const INTERSTITIAL_COOLDOWN_MS = 3 * 60 * 1000;

function countryCodeToFlagEmoji(code: string) {
  const cc = String(code || "").trim().toUpperCase();
  if (cc.length !== 2) return "";
  const A = 0x1f1e6;
  const c1 = cc.charCodeAt(0) - 65;
  const c2 = cc.charCodeAt(1) - 65;
  if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return "";
  return String.fromCodePoint(A + c1, A + c2);
}

function normalizeLanguageLabel(v: string) {
  const s = String(v || "").trim();
  const lower = s.toLowerCase();
  if (!s) return "";
  if (lower === "ko" || lower === "kor" || lower === "korean") return "한국어";
  if (lower === "en" || lower === "eng" || lower === "english") return "English";
  if (lower === "ja" || lower === "jpn" || lower === "japanese") return "日本語";
  if (lower === "zh" || lower === "chi" || lower === "chinese") return "中文";
  return s;
}

const NATIVE_UNIT_ID = (process.env.EXPO_PUBLIC_AD_UNIT_NATIVE_ANDROID ?? "").trim() || TestIds.NATIVE;

function QueueNativeAd256x144() {
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);
  const adRef = useRef<NativeAd | null>(null);

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
    <NativeAdView nativeAd={nativeAd} style={[styles.nativeAd256, { width: 360, height: 202 }]}>
      <View style={styles.nativeAdInner}>
        <NativeMediaView style={styles.nativeAdMedia} resizeMode="cover" />
        <View style={styles.nativeAdFooter}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <AppText style={styles.nativeAdHeadline}>{nativeAd.headline}</AppText>
          </NativeAsset>
          <AppText style={styles.nativeAdTag}>광고</AppText>
        </View>
      </View>
    </NativeAdView>
  );
}

export default function CallScreen({ navigation }: Props) {

  const insets = useSafeAreaInsets();

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

  const [myCamOn, setMyCamOn] = useState(true);
  const [mySoundOn, setMySoundOn] = useState(true);

  const [limitModal, setLimitModal] = useState(false);
  const [remoteVideoAllowed, setRemoteVideoAllowed] = useState(true);

  const [upgradeModal, setUpgradeModal] = useState(false);
  const [noMatchModal, setNoMatchModal] = useState(false);

  const [reMatchText, setReMatchText] = useState<string>("");

  const [prefsModal, setPrefsModal] = useState(false);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const wsRef = useRef<SignalClient | null>(null);
  const rtcRef = useRef<WebRTCSession | null>(null);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matchInterstitialRef = useRef<ReturnType<typeof createInterstitial> | null>(null);
  const lastInterstitialAtRef = useRef<number>(0);

  const enqueuedRef = useRef(false);
  const queueRunningRef = useRef(false);

  const rebindOnceRef = useRef(false);

  const noMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requeueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canStart = useRef(false);

  const adAllowedRef = useRef(false);
  const interstitialTokenRef = useRef(0);
  const interstitialCleanupRef = useRef<(() => void) | null>(null);
  const interstitialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [peerInfo, setPeerInfo] = useState<any>(null);

  const peerCountryRaw = useMemo(() => String((peerInfo as any)?.country ?? ""), [peerInfo]);
  const peerLangRaw = useMemo(() => String((peerInfo as any)?.language ?? (peerInfo as any)?.lang ?? ""), [peerInfo]);
  const peerFlag = useMemo(() => {
    const direct = String((peerInfo as any)?.flag ?? "").trim();
    return direct || countryCodeToFlagEmoji(peerCountryRaw);
  }, [peerInfo, peerCountryRaw]);
  const peerLangLabel = useMemo(() => {
    const direct = String((peerInfo as any)?.languageLabel ?? "").trim();
    return direct || normalizeLanguageLabel(peerLangRaw);
  }, [peerInfo, peerLangRaw]);
  const peerGenderRaw = useMemo(() => String((peerInfo as any)?.gender ?? ""), [peerInfo]);
  const peerGenderLabel = useMemo(() => {
    const direct = String((peerInfo as any)?.genderLabel ?? "").trim();
    if (direct) return direct;
    const g = String(peerGenderRaw || "").trim().toLowerCase();
    if (!g) return "";
    if (g === "male" || g === "m") return "남성";
    if (g === "female" || g === "f") return "여성";
    return peerGenderRaw;
  }, [peerInfo, peerGenderRaw]);

  const peerInfoText = useMemo(() => {
    const parts: string[] = [];
    if (peerLangLabel) parts.push(peerLangLabel);

    const countryPart = (peerFlag ? `${peerFlag} ` : "") + (peerCountryRaw || "");
    if (countryPart.trim()) parts.push(countryPart.trim());

    if (peerGenderLabel) parts.push(peerGenderLabel);

    return parts.join(" · ");
  }, [peerLangLabel, peerFlag, peerCountryRaw, peerGenderLabel]);

  const myCountryRaw = useMemo(() => String((prefs as any)?.country ?? ""), [prefs]);
  const myLangRaw = useMemo(() => String((prefs as any)?.language ?? (prefs as any)?.lang ?? ""), [prefs]);
  const myFlag = useMemo(() => countryCodeToFlagEmoji(myCountryRaw), [myCountryRaw]);
  const myLangLabel = useMemo(() => normalizeLanguageLabel(myLangRaw), [myLangRaw]);
  const myGenderRaw = useMemo(() => String((prefs as any)?.gender ?? ""), [prefs]);
  const myGenderLabel = useMemo(() => {
    const g = String(myGenderRaw || "").trim().toLowerCase();
    if (!g) return "";
    if (g === "male" || g === "m") return "남성";
    if (g === "female" || g === "f") return "여성";
    return myGenderRaw;
  }, [myGenderRaw]);


  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  useEffect(() => {
    canStart.current = Boolean(String(prefs.country || "").length > 0 && String(prefs.gender || "").length > 0);
  }, [prefs.country, prefs.gender]);

  const startNoMatchTimer = () => {
    if (isPremium) return;
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);

    noMatchTimerRef.current = setTimeout(() => {
      setNoMatchModal(true);
    }, MATCH_TIMEOUT_MS);
  };

  const clearNoMatchTimer = () => {
    if (noMatchTimerRef.current) clearTimeout(noMatchTimerRef.current);
    noMatchTimerRef.current = null;
  };

  const stopAll = () => {
    adAllowedRef.current = false;
    interstitialTokenRef.current += 1;

    if (interstitialTimerRef.current) clearTimeout(interstitialTimerRef.current);
    interstitialTimerRef.current = null;

    try {
      interstitialCleanupRef.current?.();
    } catch {}
    interstitialCleanupRef.current = null;

    matchInterstitialRef.current = null;

    if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
    requeueTimerRef.current = null;

    clearNoMatchTimer();

    queueRunningRef.current = false;
    enqueuedRef.current = false;

    try {
      wsRef.current?.leaveQueue();
    } catch {}
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
    stopAll();
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

  const beginCall = async (ws: SignalClient, rid: string, caller: boolean) => {
    try {
      const rtc = new WebRTCSession({
        onLocalStream: (s) => setLocalStreamURL(s.toURL()),
        onRemoteStream: (s) => setRemoteStreamURL(s.toURL()),
        onIceCandidate: (c) => ws.sendIce(rid, c),
        onAnswer: (sdp) => ws.sendAnswer(rid, sdp),
        onOffer: (sdp) => ws.sendOffer(rid, sdp),
      });

      rtcRef.current = rtc;
      await rtc.start({ isCaller: caller });

      setReMatchText("");
      setPhase("calling");

      try {
        ws.relay(rid, { type: "cam", enabled: Boolean(myCamOn) });
      } catch {}


      if (!isPremium) {
        if (limitTimerRef.current) clearTimeout(limitTimerRef.current);
        limitTimerRef.current = setTimeout(() => {
          setRemoteVideoAllowed(false);
          setLimitModal(true);
        }, FREE_CALL_LIMIT_MS);
      }
    } catch (e) {
      useAppStore.getState().showGlobalModal("통화", "통화를 시작할 수 없습니다.");
      ws.leaveRoom(rid);
      stopAll();
      navigation.goBack();
    }
  };

  const endCallAndRequeue = (why: "remote_left" | "disconnect" | "error" | "find_other") => {
    if (why === "remote_left") {
      setReMatchText("상대방이 방을 떠났습니다.\n새로운 매칭을 시작합니다.");
    } else if (why === "find_other") {
      setReMatchText("새로운 상대를 찾는 중...");
    } else {
      setReMatchText("");
    }


    stopAll();
    setNoMatchModal(false);
    setPhase("connecting");

    if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
    requeueTimerRef.current = setTimeout(() => {
      startQueue();
    }, 350);
  };

  const startQueue = () => {
    if (queueRunningRef.current) return;
    queueRunningRef.current = true;
    enqueuedRef.current = false;

    if (!canStart.current) {
      useAppStore.getState().showGlobalModal("매칭", "필터(나라/성별)가 설정되지 않았습니다.");
      queueRunningRef.current = false;
      navigation.goBack();
      return;
    }

    setNoMatchModal(false);
    setPhase("connecting");
    startNoMatchTimer();

    matchInterstitialRef.current = null;

    const ws = new SignalClient({
      onOpen: () => {
        setPhase("queued");

        if (enqueuedRef.current) return;
        enqueuedRef.current = true;

        startNoMatchTimer();
        ws.enqueue(String(prefs.country), String(prefs.gender));
      },
      onClose: () => {
        if (queueRunningRef.current) {
          endCallAndRequeue("disconnect");
        }
      },
      onMessage: async (msg: SignalMessage) => {
        if (msg.type === "queued") {
          setPhase("queued");
          startNoMatchTimer();
          return;
        }

        if (msg.type === "match") {
          clearNoMatchTimer();

          setRoomId(msg.roomId);
          setIsCaller(Boolean(msg.isCaller));
          setPhase("matched");

          try {
            ws.relay(msg.roomId, {
              type: "peer_info",
              country: myCountryRaw,
              language: myLangRaw,
              gender: myGenderRaw,
              flag: myFlag,
              languageLabel: myLangLabel,
              genderLabel: myGenderLabel,
            });
          } catch {}

          const run = () => beginCall(ws, msg.roomId, Boolean(msg.isCaller));

          run();
          return;
        }

        if (msg.type === "signal") {
          const d: any = (msg as any).data;
          const t = String(d?.type ?? d?.kind ?? "").toLowerCase();

          if (t === "cam") {
            setRemoteCamOn(Boolean(d?.enabled));
            return;
          }

          if (t === "peer_info") {
            setPeerInfo({
              country: String(d?.country ?? "").trim(),
              language: String(d?.language ?? d?.lang ?? "").trim(),
              gender: String(d?.gender ?? "").trim(),
              flag: String(d?.flag ?? "").trim(),
              languageLabel: String(d?.languageLabel ?? "").trim(),
              genderLabel: String(d?.genderLabel ?? "").trim(),
            });
            return;
          }
        }

        if (msg.type === "offer") {
          await rtcRef.current?.handleRemoteOffer(msg.sdp);
          return;
        }
        if (msg.type === "answer") {
          await rtcRef.current?.handleRemoteAnswer(msg.sdp);
          return;
        }
        if (msg.type === "ice") {
          await rtcRef.current?.handleRemoteIce(msg.candidate);
          return;
        }
        if (msg.type === "end") {
          endCallAndRequeue("remote_left");
          return;
        }

        if (msg.type === "error") {
          const reason = String(msg.message ?? "").trim();
          const reasonLower = reason.toLowerCase();

          if (reasonLower === "not_registered") {
            if (rebindOnceRef.current) {
              useAppStore.getState().showGlobalModal("인증", reason || "not_registered");
              stopAll();
              navigation.goBack();
              return;
            }

            rebindOnceRef.current = true;
            stopAll();
            setNoMatchModal(false);
            setPhase("connecting");

            (async () => {
              try {
                await bootstrapDeviceBinding();
                startQueue();
              } catch (e) {
                const m = typeof e === "object" && e && "message" in (e as any) ? String((e as any).message) : String(e);
                useAppStore.getState().showGlobalModal("인증", m || "BIND_FAILED");
                navigation.goBack();
              }
            })();

            return;
          }

          useAppStore.getState().showGlobalModal("매칭", reason || "오류가 발생했습니다.");
          endCallAndRequeue("error");
          return;
        }
      },
    });

    wsRef.current = ws;

    const tokenNow = useAppStore.getState().auth.token;
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
    lastInterstitialAtRef.current = Date.now();
    startQueue();
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endCall = () => {
    const go = () => endCallAndRequeue("find_other");

    try {
      wsRef.current?.leaveRoom(roomId || "");
    } catch {}

    showInterstitialIfAllowed(go);
  };

  const retry = () => {
    setNoMatchModal(false);
    endCallAndRequeue("disconnect");
  };

  const dismissNoMatch = () => {
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

  const setLanguage = useCallback(
    (lang: string) => {
      const st: any = useAppStore.getState?.() ?? {};
      const setPrefs = st.setPrefs;
      const setPref = st.setPref;
      const setPrefsField = st.setPrefsField;

      if (typeof setPrefs === "function") {
        setPrefs({ language: lang });
      } else if (typeof setPref === "function") {
        setPref("language", lang);
      } else if (typeof setPrefsField === "function") {
        setPrefsField("language", lang);
      } else {
        showGlobalModal("설정", "언어 저장 함수가 스토어에 없습니다. (setPrefs/setPref/setPrefsField)");
      }
    },
    [showGlobalModal]
  );

  const setCountry = useCallback(
    (iso: string) => {
      const st: any = useAppStore.getState?.() ?? {};
      const setPrefs = st.setPrefs;
      const setPref = st.setPref;
      const setPrefsField = st.setPrefsField;

      if (typeof setPrefs === "function") {
        setPrefs({ country: iso });
      } else if (typeof setPref === "function") {
        setPref("country", iso);
      } else if (typeof setPrefsField === "function") {
        setPrefsField("country", iso);
      } else {
        showGlobalModal("설정", "나라 저장 함수가 스토어에 없습니다. (setPrefs/setPref/setPrefsField)");
      }
    },
    [showGlobalModal]
  );

  const setGender = useCallback(
    (gender: string) => {
      const st: any = useAppStore.getState?.() ?? {};
      const setPrefs = st.setPrefs;
      const setPref = st.setPref;
      const setPrefsField = st.setPrefsField;

      if (typeof setPrefs === "function") {
        setPrefs({ gender });
      } else if (typeof setPref === "function") {
        setPref("gender", gender);
      } else if (typeof setPrefsField === "function") {
        setPrefsField("gender", gender);
      } else {
        showGlobalModal("설정", "성별 저장 함수가 스토어에 없습니다. (setPrefs/setPref/setPrefsField)");
      }
    },
    [showGlobalModal]
  );

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
      { key: "male", label: "남성" },
      { key: "female", label: "여성" },
    ],
    []
  );

  const currentLanguageLabel = useMemo(() => {
    const cur = String((prefs as any)?.language || "");
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur || "미설정";
  }, [languageOptions, prefs]);

  const currentCountryDisplay = useMemo(() => {
    const cur = String((prefs as any)?.country || "").toUpperCase();
    const found = countryOptions.find((x) => x.key === cur);
    const nm = found ? found.name : cur || "미설정";
    const cc = found ? found.key : cur;
    const flag = countryCodeToFlagEmoji(cc);
    if (!cc) return nm;
    return `${flag ? flag + " " : ""}${nm} (${cc})`;
  }, [countryOptions, prefs]);

  const currentGenderLabel = useMemo(() => {
    const cur = String((prefs as any)?.gender || "");
    const found = genderOptions.find((x) => x.key === cur);
    return found ? found.label : cur || "미설정";
  }, [genderOptions, prefs]);

  return (
    <View style={styles.root}>
      {/* ✅ 상단 헤더 제거, 뒤로가기만 오버레이(테두리 없음) */}
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


      <View style={styles.stage}>
        {/* ✅ 상대 영상 풀스크린/배경 블랙 */}
        {remoteStreamURL && remoteVideoAllowed && remoteCamOn ? (
          <RTCView streamURL={remoteStreamURL} style={styles.remote} objectFit="cover" zOrder={0} />
        ) : (
          <View style={styles.placeholder}>
            {phase === "calling" && !remoteVideoAllowed ? (
              <AppText style={styles.placeholderText}>무료 통화 시간이 종료되었습니다.</AppText>
            ) : phase === "calling" && !remoteCamOn ? (
              <Ionicons name="videocam-off" size={54} color="rgba(255, 255, 255, 0.92)" />
            ) : null}
          </View>
        )}


        {/* ✅ 내 캠 + 버튼(카메라/마이크/설정) 아래로 이동 + 선(라인) 제거 + 캠 OFF 오버레이 */}
        {phase === "calling" ? (
          <View style={[styles.localDock, { top: insets.top + 12, right: 12 }]}>
            <View style={styles.localFrame}>
              {localStreamURL ? (
                myCamOn ? (
                  <RTCView streamURL={localStreamURL} style={styles.localVideo} objectFit="cover" zOrder={1} />
                ) : (
                  <View style={styles.localCamOffBg} />
                )
              ) : (
                <View style={styles.localEmpty} />
              )}

              {!myCamOn ? (
                <View style={styles.camOffOverlay}>
                  <Ionicons name="videocam-off" size={34} color="rgba(255, 255, 255, 0.92)" />
                </View>
              ) : null}
            </View>


            <View style={styles.localControls}>
              <Pressable onPress={toggleCam} style={({ pressed }) => [styles.iconCircle, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name={myCamOn ? "videocam" : "videocam-off"} size={20} color="#fff" />
              </Pressable>

              <Pressable onPress={toggleSound} style={({ pressed }) => [styles.iconCircle, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name={mySoundOn ? "mic" : "mic-off"} size={20} color="#fff" />
              </Pressable>

              <Pressable onPress={() => setPrefsModal(true)} style={({ pressed }) => [styles.iconCircle, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name="settings-outline" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        ) : null}

        {!isPremium && phase !== "calling" ? (
          <View style={[styles.queueAdDock, { top: insets.top + 96 }]}>
            <QueueNativeAd256x144 />
          </View>
        ) : null}


        {/* ✅ 연결/재매칭 상태 오버레이(상대 나가면 안내문+스피너+자동 재매칭) */}
        {phase !== "calling" ? (
          <View style={styles.centerOverlay}>
            <Spinner />

            {reMatchText || phase === "connecting" || phase === "matched" ? <View style={{ height: 12 }} /> : null}

            {reMatchText ? (
              <AppText style={styles.centerText}>{reMatchText}</AppText>
            ) : phase === "connecting" ? (
              <AppText style={styles.centerText}>연결 중...</AppText>
            ) : phase === "matched" ? (
              <AppText style={styles.centerText}>매칭됨</AppText>
            ) : null}

          </View>
        ) : null}


        {/* ✅ 우측하단 배너 + 그 위 내 나라/국기/언어 + 아이콘(다른상대찾기) */}
        {!isPremium ? (
          <View style={[styles.bannerDock, { paddingBottom: Math.max(insets.bottom, 8), left: 0, right: 0 }]}>
            <View style={styles.myInfoRow}>
              <View style={styles.myInfoCenter}>
                {peerInfoText ? <AppText style={styles.myInfoText}>{peerInfoText}</AppText> : null}
              </View>

              <Pressable onPress={onPressFindOther} style={({ pressed }) => [styles.findOtherBtn, pressed ? { opacity: 0.7 } : null]}>
                <Ionicons name="sync-circle" size={60} color="rgba(255, 205, 230, 0.84)" />
              </Pressable>
            </View>

            <BannerBar />
          </View>
        ) : null}
      </View>

      <AppModal
        visible={limitModal}
        title="무료 이용 시간 종료"
        dismissible={false}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="프리미엄 구매" onPress={() => setUpgradeModal(true)} />
            <PrimaryButton title="나가기" onPress={() => { stopAll(); goHome(); }} variant="ghost" />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: theme.colors.sub, lineHeight: 20 }}>
          무료 통화 시간(예: {Math.round(FREE_CALL_LIMIT_MS / 1000)}초)이 종료되었습니다.
          {"\n"}프리미엄을 구매하면 제한 없이 이용할 수 있습니다.
        </AppText>
      </AppModal>

      <AppModal
        visible={upgradeModal}
        title="프리미엄"
        dismissible={true}
        onClose={() => setUpgradeModal(false)}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="구매하기" onPress={purchase} />
            <PrimaryButton title="닫기" onPress={() => setUpgradeModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: theme.colors.sub, lineHeight: 20 }}>
          프리미엄 구매 시 광고 제거 및 통화 제한이 해제됩니다.
        </AppText>
      </AppModal>

      <AppModal
        visible={noMatchModal}
        title="매칭이 지연되고 있습니다"
        dismissible={true}
        onClose={dismissNoMatch}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="다시 시도" onPress={retry} />
            <PrimaryButton title="나가기" onPress={() => { stopAll(); goHome(); }} variant="ghost" />
          </View>
        }
      >
        <AppText style={{ fontSize: 16, color: theme.colors.sub, lineHeight: 20 }}>
          조금만 기다렸다가 다시 시도해 주세요.
        </AppText>
      </AppModal>

      <AppModal
        visible={prefsModal}
        title="설정"
        dismissible={true}
        onClose={() => {
          setPrefsModal(false);
          setLangOpen(false);
          setCountryOpen(false);
          setGenderOpen(false);
        }}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="닫기" onPress={() => setPrefsModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.modalText}>나라/언어/성별을 설정하세요.</AppText>

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>나라(지역)</AppText>

        <View style={{ height: 0 }} />

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
                      setCountry(opt.key);
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

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>언어</AppText>

        <View style={{ height: 0 }} />

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
                    setLanguage(opt.key);
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

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>성별</AppText>

        <View style={{ height: 0 }} />

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
                    setGender(opt.key);
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

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>글자 크기</AppText>
        <AppText style={styles.modalText}>바를 좌우로 드래그해서 조절하세요. ({Math.round(fontScale * 100)}%)</AppText>
        <FontSizeSlider value={fontScale} onChange={setFontScale} />
      </AppModal>
    </View>
  );
}

const W = Dimensions.get("window").width;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },

  stage: { flex: 1, position: "relative", backgroundColor: "#000" },

  remote: { ...StyleSheet.absoluteFillObject, backgroundColor: "#000" },

  placeholder: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", backgroundColor: "#000" },
  placeholderText: { fontSize: 14, color: "rgba(255,255,255,0.75)", fontWeight: "700" },

  backBtn: {
    position: "absolute",
    zIndex: 20,
    width: 44,
    height: 44,
    alignItems: "flex-start",
    justifyContent: "center",
  },

  localDock: {
    position: "absolute",
    zIndex: 15,
    alignItems: "flex-end",
    gap: 10,
  },

  localFrame: {
    width: Math.min(180, W * 0.36),
    height: Math.min(200, W * 0.46),
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#000",
  },

  localVideo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    transform: [{ scale: 1.03 }],
  },

  localEmpty: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  localCamOffBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
    borderRadius: 12,
  },

  camOffOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
    borderRadius: 12,
  },

  localControls: {
    width: Math.min(140, W * 0.34),
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    position: "relative",
    right: -6,
  },

  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
  },

  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  centerText: {
    textAlign: "center",
    fontSize: 16,
    fontWeight: "700",
    color: "rgba(201, 201, 201, 0.85)",
    lineHeight: 20,
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

  bannerDock: {
    position: "absolute",
    zIndex: 12,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    gap: 6,
  },

  myInfoRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    position: "relative",
    minHeight: 52,
  },

  myInfoCenter: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  myInfoText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 15,
    fontWeight: "600",
  },

  findOtherBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    position: "absolute",
    right: 12,
    top: -40,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },

  dropdownBtn: {
    width: "100%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
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
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownRowActive: {
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.cardSoft,
  },
  dropdownText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownTextActive: { color: theme.colors.pinkDeep },
  dropdownCheck: { fontSize: 14, color: theme.colors.pinkDeep, fontWeight: "900" },

  countryRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  countryCode: { fontSize: 12, color: theme.colors.sub, fontWeight: "800" },
  countryCodeActive: { color: theme.colors.pinkDeep },
});
