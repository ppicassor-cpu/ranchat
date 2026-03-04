import { useCallback } from "react";
import { APP_CONFIG } from "../config/app";
import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import { SignalClient, SignalMessage } from "../services/signal/SignalClient";
import type { MatchFilter } from "../services/call/MatchFilterService";
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
  myUserId: string;
  setAuthBooting: (v: boolean) => void;
  setMatchingActionsVisible: (v: boolean) => void;
  setNoMatchModal: (v: boolean) => void;
  setPhase: (v: any) => void;
  setSignalUnstable: (v: boolean) => void;
  setPeerInfo: (v: any) => void;
  setPeerSessionId: (v: string | null) => void;
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
  getQueueMatchFilter?: () => MatchFilter | null | undefined;
  shouldSkipMatch?: (args: { roomId: string; peerSessionId: string }) => boolean;
  shouldSkipPeerInfo?: (args: { roomId: string; peerSessionId: string; peerInfo: any }) => boolean;
  tryStartSyntheticMatch?: (args: {
    qTok: number;
    queueCountry: string;
    queueGender: string;
    queueLanguage: string;
    queueMatchFilter: MatchFilter | null | undefined;
  }) => Promise<boolean> | boolean;
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
  myUserId,
  setAuthBooting,
  setMatchingActionsVisible,
  setNoMatchModal,
  setPhase,
  setSignalUnstable,
  setPeerInfo,
  setPeerSessionId,
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
  getQueueMatchFilter,
  shouldSkipMatch,
  shouldSkipPeerInfo,
  tryStartSyntheticMatch,
}: UseSignalingArgs) {
  const onMessage = useCallback(
    async (ws: SignalClient, qTok: number, msg: SignalMessage) => {
      if (wsRef.current !== ws) return;
      if (queueTokenRef.current !== qTok) return;

      if (msg.type === "signal") {
        const d: any = (msg as any).data;
        const fromSessionId = String((msg as any).fromSessionId || "").trim();
        const sigType = String(d?.type ?? d?.kind ?? "").toLowerCase();

        if (sigType === "peer_info") {
          if (String(d?.nonce ?? "") === String(myPeerInfoNonceRef.current)) return;
          const roomId = String((msg as any).roomId || "").trim();
          if (
            shouldSkipPeerInfo?.({
              roomId,
              peerSessionId: fromSessionId,
              peerInfo: d,
            })
          ) {
            if (roomId) {
              try {
                ws.leaveRoom(roomId);
              } catch {}
            }
            endCallAndRequeue("disconnect");
            return;
          }

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
          if (giftId) {
            onGiftSignal?.(giftId, {
              ...(d && typeof d === "object" ? d : {}),
              _fromSessionId: fromSessionId || undefined,
            });
          }
          return;
        }

        return;
      }

      if (msg.type === "peer_cam") {
        setRemoteCamOn(Boolean((msg as any).enabled));
        return;
      }

      if (msg.type === "error") {
        const reason = String((msg as any).message || "").trim().toLowerCase();
        if (reason === "other_device_login" || reason === "session_replaced") {
          manualCloseRef.current = true;
          queueRunningRef.current = false;
          clearNoMatchTimer();
          clearMatchingActionsTimer(false);
          clearWebrtcDownTimer();
          try {
            ws.close();
          } catch {}
          useAppStore.getState().showGlobalModal(t("auth.title"), t("auth.logout_other_device"));
          useAppStore.getState().logoutAndWipe();
        }
        return;
      }

      if (msg.type === "queued") {
        if (phaseRef.current === "matched" || phaseRef.current === "calling") return;
        const wasQueued = phaseRef.current === "queued";
        setPhase("queued");
        startMatchingActionsTimer(false);
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
        const peerSessionId = String((msg as any).peerSessionId || "").trim();

        if (shouldSkipMatch?.({ roomId: rid, peerSessionId })) {
          try {
            ws.leaveRoom(rid);
          } catch {}
          endCallAndRequeue("disconnect");
          return;
        }

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
        setPeerSessionId(peerSessionId || null);
        setRoomId(rid);
        setIsCaller(Boolean(msg.isCaller));
        try {
          const myUid = String(myUserId || "").trim();
          ws.relay(rid, {
            type: "peer_info",
            nonce: myPeerInfoNonceRef.current,
            country: myCountryRaw,
            language: myLangRaw,
            gender: myGenderRaw,
            flag: myFlag,
            userId: myUid || undefined,
            uid: myUid || undefined,
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
      setPeerSessionId,
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
      setMatchingActionsVisible,
      setFastMatchHint,
      setReMatchText,
      enqueuedRef,
      setRoomId,
      setIsCaller,
      myCountryRaw,
      myLangRaw,
      myGenderRaw,
      myFlag,
      myUserId,
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
      const queueLanguage = String(prefsNow.language || prefsNow.lang || "").trim().toLowerCase();
      const queueMatchFilter = getQueueMatchFilter ? getQueueMatchFilter() : null;

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

      if (tryStartSyntheticMatch) {
        let syntheticMatched = false;
        try {
          syntheticMatched = Boolean(
            await Promise.resolve(
              tryStartSyntheticMatch({
                qTok,
                queueCountry,
                queueGender,
                queueLanguage,
                queueMatchFilter,
              })
            )
          );
        } catch {
          syntheticMatched = false;
        }
        if (syntheticMatched) {
          queueRunningRef.current = false;
          enqueuedRef.current = false;
          return;
        }
      }

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
          ws.enqueue(queueCountry, queueGender, queueLanguage, queueMatchFilter || undefined);
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
      getQueueMatchFilter,
      shouldSkipMatch,
      shouldSkipPeerInfo,
      tryStartSyntheticMatch,
    ]
  );

  return {
    wsRef,
    startQueue,
    onMessage,
  };
}
