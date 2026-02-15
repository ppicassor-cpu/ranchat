//C:\ranchat\src\screens\CallScreen.tsx
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Pressable, Dimensions } from "react-native";
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
import { AdEventType } from "react-native-google-mobile-ads";
import { purchasePremium, refreshSubscription } from "../services/purchases/PurchaseManager";
import type { MainStackParamList } from "../navigation/MainStack";
import AppText from "../components/AppText";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<MainStackParamList, "Call">;

type Phase = "connecting" | "queued" | "matched" | "calling" | "ended";

// ✅ APP_CONFIG 타입에 값이 없어도 TS 에러 없이 동작하도록 fallback 상수로 사용
const MATCH_TIMEOUT_MS = (() => {
  const v = Number((APP_CONFIG as any)?.MATCH_TIMEOUT_MS);
  return Number.isFinite(v) ? v : 20000;
})();

const FREE_CALL_LIMIT_MS = (() => {
  const direct = Number((APP_CONFIG as any)?.FREE_CALL_LIMIT_MS);
  if (Number.isFinite(direct)) return direct;

  const sec = Number((APP_CONFIG as any)?.FREE_LIMITS?.remoteVideoSeconds);
  if (Number.isFinite(sec)) return sec * 1000;

  return 30000;
})();

export default function CallScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();

  const prefs = useAppStore((s) => s.prefs);
  const token = useAppStore((s) => s.auth.token);
  const isPremium = useAppStore((s) => s.sub.isPremium);

  const [phase, setPhase] = useState<Phase>("connecting");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isCaller, setIsCaller] = useState(false);

  const [localStreamURL, setLocalStreamURL] = useState<string | null>(null);
  const [remoteStreamURL, setRemoteStreamURL] = useState<string | null>(null);

  const [myCamOn, setMyCamOn] = useState(true);
  const [mySoundOn, setMySoundOn] = useState(true);

  const [limitModal, setLimitModal] = useState(false);
  const [remoteVideoAllowed, setRemoteVideoAllowed] = useState(true);

  const [upgradeModal, setUpgradeModal] = useState(false);
  const [noMatchModal, setNoMatchModal] = useState(false);

  const wsRef = useRef<SignalClient | null>(null);
  const rtcRef = useRef<WebRTCSession | null>(null);
  const limitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matchInterstitialRef = useRef<ReturnType<typeof createInterstitial> | null>(null);

  const enqueuedRef = useRef(false);
  const queueRunningRef = useRef(false);

  const rebindOnceRef = useRef(false);

  const noMatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requeueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canStart = useRef(false);

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
    setRemoteVideoAllowed(true);
    setLimitModal(false);
    setPhase("ended");
  };

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

      setPhase("calling");

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

    if (!isPremium) matchInterstitialRef.current = createInterstitial();

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
          endCallAndRequeue();
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

          const run = () => beginCall(ws, msg.roomId, Boolean(msg.isCaller));

          if (!isPremium && matchInterstitialRef.current) {
            const ad = matchInterstitialRef.current;

            let done = false;
            const runOnce = () => {
              if (done) return;
              done = true;
              cleanup();
              run();
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
            };

            unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, runOnce);
            unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
              try {
                ad.show();
              } catch {
                runOnce();
              }
            });
            unsubError = ad.addAdEventListener(AdEventType.ERROR, runOnce);

            try {
              ad.load();
            } catch {
              runOnce();
            }

            setTimeout(runOnce, 1500);
            return;
          }

          run();
          return;
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
          endCallAndRequeue();
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
          endCallAndRequeue();
          return;
        }
      },
    });

    wsRef.current = ws;

    const tokenNow = useAppStore.getState().auth.token;
    ws.connect(APP_CONFIG.SIGNALING_URL, tokenNow);
  };

  const endCallAndRequeue = () => {
    stopAll();
    setNoMatchModal(false);
    setPhase("connecting");

    if (requeueTimerRef.current) clearTimeout(requeueTimerRef.current);
    requeueTimerRef.current = setTimeout(() => {
      startQueue();
    }, 350);
  };

  const toggleCam = () => {
    const next = !myCamOn;
    setMyCamOn(next);
    rtcRef.current?.setLocalVideoEnabled(next);
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
    startQueue();
    return () => stopAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endCall = () => {
    try {
      wsRef.current?.leaveRoom(roomId || "");
    } catch {}
    stopAll();
    navigation.goBack();
  };

  const retry = () => {
    setNoMatchModal(false);
    endCallAndRequeue();
  };

  const dismissNoMatch = () => {
    setNoMatchModal(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={endCall} style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.7 } : null]}>
          <Ionicons name="close" size={26} color={theme.colors.text} />
        </Pressable>

        <AppText style={styles.phase}>
          {phase === "connecting" ? "연결 중..." : phase === "queued" ? "매칭 대기 중..." : phase === "matched" ? "매칭됨" : phase === "calling" ? "통화 중" : ""}
        </AppText>

        <View style={{ width: 44 }} />
      </View>

      <View style={styles.stage}>
        {remoteStreamURL && remoteVideoAllowed ? (
          <RTCView streamURL={remoteStreamURL} style={styles.remote} />
        ) : (
          <View style={styles.placeholder}>
            <AppText style={styles.placeholderText}>
              {phase === "calling" && !remoteVideoAllowed ? "무료 통화 시간이 종료되었습니다." : "상대 화면 대기 중..."}
            </AppText>
          </View>
        )}

        {localStreamURL ? <RTCView streamURL={localStreamURL} style={styles.local} /> : null}

        {phase !== "calling" ? (
          <View style={styles.centerOverlay}>
            <Spinner />
          </View>
        ) : null}
      </View>

      <View style={[styles.controls, { paddingBottom: Math.max(insets.bottom, 14) }]}>
        <Pressable onPress={toggleCam} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
          <Ionicons name={myCamOn ? "videocam" : "videocam-off"} size={22} color={theme.colors.text} />
        </Pressable>

        <Pressable onPress={toggleSound} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
          <Ionicons name={mySoundOn ? "mic" : "mic-off"} size={22} color={theme.colors.text} />
        </Pressable>
      </View>

      {!isPremium ? (
        <View style={[styles.banner, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <BannerBar />
        </View>
      ) : null}

      <AppModal
        visible={limitModal}
        title="무료 이용 시간 종료"
        dismissible={false}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="프리미엄 구매" onPress={() => setUpgradeModal(true)} />
            <PrimaryButton title="나가기" onPress={endCall} variant="ghost" />
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
        title="매칭 실패"
        dismissible={true}
        onClose={dismissNoMatch}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="다시 시도" onPress={retry} />
            <PrimaryButton title="나가기" onPress={endCall} variant="ghost" />
          </View>
        }
      >
        <AppText style={{ fontSize: 14, color: theme.colors.sub, lineHeight: 20 }}>
          일정 시간 동안 매칭이 되지 않았습니다.
          {"\n"}필터를 변경하거나 다시 시도해 주세요.
        </AppText>
      </AppModal>
    </View>
  );
}

const W = Dimensions.get("window").width;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  top: {
    height: 56,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  phase: { fontSize: 14, fontWeight: "700", color: theme.colors.text },

  stage: { flex: 1, position: "relative" },
  remote: { flex: 1, backgroundColor: "#000" },
  local: {
    position: "absolute",
    right: 12,
    top: 12,
    width: Math.min(140, W * 0.34),
    height: Math.min(200, W * 0.46),
    backgroundColor: "#000",
    borderRadius: 12,
    overflow: "hidden",
  },
  placeholder: { flex: 1, alignItems: "center", justifyContent: "center" },
  placeholderText: { fontSize: 14, color: theme.colors.sub, fontWeight: "700" },
  centerOverlay: { position: "absolute", left: 0, top: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },

  controls: { paddingHorizontal: 14, paddingTop: 12, flexDirection: "row", justifyContent: "center", gap: 14 },
  controlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: theme.colors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.card,
  },

  banner: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
  },
});
