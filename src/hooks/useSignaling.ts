import { useCallback } from "react";
import { APP_CONFIG } from "../config/app";
import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import { SignalClient, SignalMessage } from "../services/signal/SignalClient";
import { useAppStore } from "../store/useAppStore";
import { PEER_INFO_WAIT_TIMEOUT_MS } from "../constants/callConfig";

type UseSignalingArgs = {
  wsRef: React.MutableRefObject<SignalClient | null>;
  queueTokenRef: React.MutableRefObject<number>;
  queueRunningRef: React.MutableRefObject<boolean>;
  enqueuedRef: React.MutableRefObject<boolean>;
  myPeerInfoNonceRef: React.MutableRefObject<string>;
  peerReadyTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  beginCallReqRef: React.MutableRefObject<{ ws: SignalClient; rid: string; caller: boolean; qTok: number } | null>;
  webrtcConnectTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  webrtcConnectedRef: React.MutableRefObject<boolean>;
  suppressEndRelayRef: React.MutableRefObject<boolean>;
  manualCloseRef: React.MutableRefObject<boolean>;
  reconnectAttemptRef: React.MutableRefObject<number>;
  authBootInFlightRef: React.MutableRefObject<boolean>;
  noMatchTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  noMatchShownThisCycleRef: React.MutableRefObject<boolean>;
  pendingSignalRef: React.MutableRefObject<{ type: "offer" | "answer" | "ice"; sdp?: any; candidate?: any }[]>;
  phaseRef: React.MutableRefObject<string>;
  beautyOpenRef: React.MutableRefObject<boolean>;
  beautyOpeningIntentRef: React.MutableRefObject<boolean>;
  rtcRef: React.MutableRefObject<any>;
  t: (key: string, params?: any) => string;
  navigation: any;
  myCountryRaw: string;
  myLangRaw: string;
  myGenderRaw: string;
  myFlag: string;
  setAuthBooting: (v: boolean) => void;
  setMatchingActionsVisible: (v: boolean) => void;
  setNoMatchModal: (v: boolean) => void;
  setPhase: (v: any) => void;
  setSignalUnstable: (v: boolean) => void;
  setPeerInfo: (v: any) => void;
  setRemoteCamOn: (v: boolean) => void;
  onGiftSignal?: (giftId: string, payload?: any) => void;
  setFastMatchHint: (v: boolean) => void;
  setReMatchText: (v: string) => void;
  setRoomId: (v: string | null) => void;
  setIsCaller: (v: boolean) => void;
  clearReconnectTimer: () => void;
  clearWebrtcDownTimer: () => void;
  startNoMatchTimer: () => void;
  clearNoMatchTimer: () => void;
  clearMatchingActionsTimer: (resetDeadline?: boolean) => void;
  startMatchingActionsTimer: (forceReset?: boolean) => void;
  clearLocalPreviewStream: () => void;
  beginCall: (ws: SignalClient, rid: string, caller: boolean, qTok: number) => Promise<void> | void;
  endCallAndRequeue: (why: "remote_left" | "disconnect" | "error" | "find_other") => void;
  beforeStartQueue?: () => Promise<boolean> | boolean;
};

export default function useSignaling({
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
  phaseRef,
  beautyOpenRef,
  beautyOpeningIntentRef,
  rtcRef,
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
  beforeStartQueue,
}: UseSignalingArgs) {
  const onMessage = useCallback(
    async (ws: SignalClient, qTok: number, msg: SignalMessage) => {
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

        if (sigType === "gift") {
          const giftId = String(d?.giftId ?? d?.id ?? "").trim();
          if (giftId) onGiftSignal?.(giftId, d);
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
          beginCallReqRef.current = null;
          beginCall(ws, req.rid, req.caller, req.qTok);
        }, PEER_INFO_WAIT_TIMEOUT_MS);

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
    [
      wsRef,
      queueTokenRef,
      myPeerInfoNonceRef,
      setPeerInfo,
      beginCallReqRef,
      peerReadyTimerRef,
      beginCall,
      setRemoteCamOn,
      onGiftSignal,
      phaseRef,
      setPhase,
      noMatchTimerRef,
      startNoMatchTimer,
      queueRunningRef,
      clearNoMatchTimer,
      clearMatchingActionsTimer,
      beautyOpenRef,
      beautyOpeningIntentRef,
      clearLocalPreviewStream,
      setNoMatchModal,
      setFastMatchHint,
      setReMatchText,
      enqueuedRef,
      setRoomId,
      setIsCaller,
      myCountryRaw,
      myLangRaw,
      myGenderRaw,
      myFlag,
      suppressEndRelayRef,
      endCallAndRequeue,
      clearWebrtcDownTimer,
      rtcRef,
      pendingSignalRef,
      manualCloseRef,
    ]
  );

  const startQueue = useCallback(
    async (resetMatchingActions = false) => {
      if (queueRunningRef.current) return;

      if (beforeStartQueue) {
        let ok = false;
        try {
          ok = Boolean(await Promise.resolve(beforeStartQueue()));
        } catch {
          ok = false;
        }
        if (!ok) return;
      }

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

          if (phaseRef.current === "matched" || phaseRef.current === "calling") {
            setSignalUnstable(true);
            return;
          }

          if (queueRunningRef.current) {
            endCallAndRequeue("disconnect");
          }
        },
        onMessage: async (msg: SignalMessage) => {
          await onMessage(ws, qTok, msg);
        },
      });

      wsRef.current = ws;
      ws.connect(APP_CONFIG.SIGNALING_URL, tokenNow);
    },
    [
      queueRunningRef,
      enqueuedRef,
      queueTokenRef,
      myPeerInfoNonceRef,
      peerReadyTimerRef,
      beginCallReqRef,
      webrtcConnectTimerRef,
      webrtcConnectedRef,
      suppressEndRelayRef,
      wsRef,
      manualCloseRef,
      clearReconnectTimer,
      clearWebrtcDownTimer,
      noMatchShownThisCycleRef,
      setFastMatchHint,
      t,
      navigation,
      authBootInFlightRef,
      setAuthBooting,
      setMatchingActionsVisible,
      setNoMatchModal,
      setPhase,
      startMatchingActionsTimer,
      setSignalUnstable,
      reconnectAttemptRef,
      startNoMatchTimer,
      phaseRef,
      endCallAndRequeue,
      onMessage,
      beforeStartQueue,
    ]
  );

  return {
    wsRef,
    startQueue,
    onMessage,
  };
}
