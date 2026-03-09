import { useRef } from "react";
import type React from "react";
import { SignalClient } from "../services/signal/SignalClient";
import { WebRTCSession } from "../services/webrtc/WebRTCSession";
import { useAppStore } from "../store/useAppStore";
import { WEBRTC_CONNECT_TIMEOUT_MS, WEBRTC_DOWN_GRACE_MS } from "../constants/callConfig";

type EndReason = "remote_left" | "disconnect" | "error" | "find_other";

type UseCallRuntimeArgs = {
  endCallAndRequeueRef: React.MutableRefObject<(why: EndReason) => void>;
  resetAdFlow: () => void;
  requeueTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  clearNoMatchTimer: () => void;
  clearMatchingActionsTimer: (resetDeadline?: boolean) => void;
  setMatchingActionsVisible: (v: boolean) => void;
  matchingActionsTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  beautyOpenRef: React.MutableRefObject<boolean>;
  beautyOpeningIntentRef: React.MutableRefObject<boolean>;
  clearLocalPreviewStream: () => void;
  setBeautyOpen: (v: boolean) => void;
  clearReconnectTimer: () => void;
  clearWebrtcDownTimer: () => void;
  peerReadyTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  beginCallReqRef: React.MutableRefObject<{ ws: SignalClient; rid: string; caller: boolean; qTok: number } | null>;
  webrtcConnectTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  webrtcConnectedRef: React.MutableRefObject<boolean>;
  setCallTransportReady: (v: boolean) => void;
  setSignalUnstable: (v: boolean) => void;
  noMatchShownThisCycleRef: React.MutableRefObject<boolean>;
  setFastMatchHint: (v: boolean) => void;
  queueRunningRef: React.MutableRefObject<boolean>;
  enqueuedRef: React.MutableRefObject<boolean>;
  roomIdRef: React.MutableRefObject<string | null>;
  wsRef: React.MutableRefObject<SignalClient | null>;
  suppressEndRelayRef: React.MutableRefObject<boolean>;
  rtcRef: React.MutableRefObject<WebRTCSession | null>;
  remoteStreamRef: React.MutableRefObject<any>;
  previewStreamRef: React.MutableRefObject<any>;
  hasLiveVideoTrack: (stream: any) => boolean;
  localStreamRef: React.MutableRefObject<any>;
  setLocalStreamURL: (url: string | null) => void;
  setRemoteStreamURL: (url: string | null) => void;
  resetChatAndSwipeState: () => void;
  setRoomId: (v: string | null) => void;
  setPeerInfo: (v: any) => void;
  setRemoteCamOn: (v: boolean) => void;
  matchRevealRunningRef: React.MutableRefObject<boolean>;
  setMatchRevealActive: (v: boolean) => void;
  matchRevealAnimRef: React.MutableRefObject<any>;
  setPhase: (v: any) => void;
  manualCloseRef: React.MutableRefObject<boolean>;
  callStartTokenRef: React.MutableRefObject<number>;
  beginCallGuardRef: React.MutableRefObject<boolean>;
  queueTokenRef: React.MutableRefObject<number>;
  phaseRef: React.MutableRefObject<string>;
  isCallerRef: React.MutableRefObject<boolean>;
  remoteMutedRef: React.MutableRefObject<boolean>;
  setReMatchText: (v: string) => void;
  runMatchRevealTransition: (onDone: () => void) => boolean;
  pendingSignalRef: React.MutableRefObject<{ type: "offer" | "answer" | "ice"; sdp?: any; candidate?: any }[]>;
  myCamOnRef: React.MutableRefObject<boolean>;
  mySoundOnRef: React.MutableRefObject<boolean>;
  matchedSignalTokenRef: React.MutableRefObject<number>;
  webrtcDownTokenRef: React.MutableRefObject<number>;
  webrtcDownTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setChatReady: (v: boolean) => void;
  appendChatMessage: (mine: boolean, message: string) => void;
  t: (key: string, params?: any) => string;
};

export default function useCallRuntime({
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
  phaseRef,
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
  appendChatMessage,
  t,
}: UseCallRuntimeArgs) {
  const connectionRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iceHealthTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iceHealthInFlightRef = useRef(false);
  const connectTimeoutRetryRef = useRef(0);
  const connectionRecoveryAttemptRef = useRef(0);
  const lastIceHealthRef = useRef({
    selectedPairId: "",
    bytesSent: 0,
    bytesReceived: 0,
    at: 0,
  });
  const clearConnectionRecoveryTimer = () => {
    if (connectionRecoveryTimerRef.current) clearTimeout(connectionRecoveryTimerRef.current);
    connectionRecoveryTimerRef.current = null;
    connectionRecoveryAttemptRef.current = 0;
  };
  const clearIceHealthTimer = () => {
    if (iceHealthTimerRef.current) clearInterval(iceHealthTimerRef.current);
    iceHealthTimerRef.current = null;
    iceHealthInFlightRef.current = false;
    lastIceHealthRef.current = {
      selectedPairId: "",
      bytesSent: 0,
      bytesReceived: 0,
      at: 0,
    };
  };

  const markTransportHealthy = (qTok: number) => {
    if (queueTokenRef.current !== qTok) return;
    webrtcConnectedRef.current = true;
    connectTimeoutRetryRef.current = 0;
    connectionRecoveryAttemptRef.current = 0;
    setCallTransportReady(true);
    if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
    webrtcConnectTimerRef.current = null;
    clearWebrtcDownTimer();
    clearConnectionRecoveryTimer();
    setSignalUnstable(false);
    if ((phaseRef.current === "matched" || phaseRef.current === "calling") && matchedSignalTokenRef.current !== qTok) {
      matchedSignalTokenRef.current = qTok;
      try {
        useAppStore.getState().setCallMatchedSignal(Date.now());
      } catch {}
    }
  };

  const promoteToCalling = (qTok: number) => {
    if (queueTokenRef.current !== qTok) return;
    if (phaseRef.current === "calling") return;
    setReMatchText("");
    const started = runMatchRevealTransition(() => {
      if (queueTokenRef.current !== qTok) return;
      if (phaseRef.current === "calling") return;
      setPhase("calling");
    });
    if (!started && phaseRef.current !== "calling") {
      setPhase("calling");
    }
  };

  const startIceHealthTimer = (rtc: WebRTCSession, qTok: number, tokenNow: number) => {
    clearIceHealthTimer();
    iceHealthTimerRef.current = setInterval(() => {
      if (iceHealthInFlightRef.current) return;
      if (queueTokenRef.current !== qTok || callStartTokenRef.current !== tokenNow || rtcRef.current !== rtc) {
        clearIceHealthTimer();
        return;
      }
      if (phaseRef.current !== "matched" && phaseRef.current !== "calling") {
        clearIceHealthTimer();
        return;
      }

      iceHealthInFlightRef.current = true;
      rtc
        .getIcePathInfo()
        .then((info) => {
          if (queueTokenRef.current !== qTok || callStartTokenRef.current !== tokenNow || rtcRef.current !== rtc) return;

          const selectedPairId = String(info?.selectedPairId || "").trim();
          const bytesSent = Math.max(0, Number(info?.bytesSent || 0));
          const bytesReceived = Math.max(0, Number(info?.bytesReceived || 0));
          const hadTransport =
            Boolean(selectedPairId) ||
            bytesSent > 0 ||
            bytesReceived > 0 ||
            Boolean(info?.localCandidateType) ||
            Boolean(info?.remoteCandidateType);
          if (!hadTransport) return;

          const prev = lastIceHealthRef.current;
          const trafficAdvanced = bytesSent > prev.bytesSent || bytesReceived > prev.bytesReceived;
          lastIceHealthRef.current = {
            selectedPairId,
            bytesSent,
            bytesReceived,
            at: Date.now(),
          };

          markTransportHealthy(qTok);
          if (trafficAdvanced || selectedPairId || phaseRef.current === "matched") {
            promoteToCalling(qTok);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          iceHealthInFlightRef.current = false;
        });
    }, 2500);
  };

  const scheduleConnectionRecovery = (qTok: number, delayMs: number, tokenNow: number) => {
    clearConnectionRecoveryTimer();
    const runRecovery = () => {
      if (queueTokenRef.current !== qTok) return;
      if (callStartTokenRef.current !== tokenNow) return;
      if (phaseRef.current !== "matched" && phaseRef.current !== "calling") return;

      const rtc = rtcRef.current;
      if (!rtc) return;

      connectionRecoveryAttemptRef.current += 1;
      const attempt = connectionRecoveryAttemptRef.current;
      if (isCallerRef.current || attempt % 3 === 0) {
        rtc.restartIce?.().catch?.(() => undefined);
      }
      if (attempt % 4 === 0) {
        rtc
          .refreshLocalMedia?.({
            videoEnabled: Boolean(myCamOnRef.current),
            audioEnabled: Boolean(mySoundOnRef.current),
          })
          .catch?.(() => undefined);
      }

      connectionRecoveryTimerRef.current = setTimeout(runRecovery, 3200);
    };
    connectionRecoveryTimerRef.current = setTimeout(runRecovery, Math.max(180, Math.trunc(delayMs)));
  };

  const stopAll = (isUserExit = false, resetMatchingActions = true) => {
    if (isUserExit) {
      manualCloseRef.current = true;
    }

    callStartTokenRef.current += 1;
    beginCallGuardRef.current = false;

    resetAdFlow();

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
    clearConnectionRecoveryTimer();
    clearIceHealthTimer();

    if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
    peerReadyTimerRef.current = null;
    beginCallReqRef.current = null;
    pendingSignalRef.current = [];

    if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
    webrtcConnectTimerRef.current = null;
    connectTimeoutRetryRef.current = 0;
    webrtcConnectedRef.current = false;
    setCallTransportReady(false);

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
    resetChatAndSwipeState();
    roomIdRef.current = null;
    setRoomId(null);
    setPeerInfo(null);
    setRemoteCamOn(true);
    matchRevealRunningRef.current = false;
    setMatchRevealActive(false);
    matchRevealAnimRef.current.stopAnimation();
    matchRevealAnimRef.current.setValue(0);
    setPhase("ended");
  };

  const beginCall = async (ws: SignalClient, rid: string, caller: boolean, qTok: number) => {
    if (queueTokenRef.current !== qTok) return;
    if (wsRef.current !== ws) return;

    beginCallReqRef.current = null;
    if (peerReadyTimerRef.current) clearTimeout(peerReadyTimerRef.current);
    peerReadyTimerRef.current = null;

    if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
    webrtcConnectTimerRef.current = null;
    connectTimeoutRetryRef.current = 0;
    webrtcConnectedRef.current = false;
    setCallTransportReady(false);

    if (beginCallGuardRef.current) return;
    beginCallGuardRef.current = true;

    const tokenNow = callStartTokenRef.current + 1;
    callStartTokenRef.current = tokenNow;

    const scheduleConnectTimeout = () => {
      if (webrtcConnectTimerRef.current) clearTimeout(webrtcConnectTimerRef.current);
      webrtcConnectTimerRef.current = setTimeout(() => {
        if (queueTokenRef.current !== qTok) return;
        if (callStartTokenRef.current !== tokenNow) return;
        if (webrtcConnectedRef.current) return;
        if (phaseRef.current !== "matched" && phaseRef.current !== "calling") return;

        if (connectTimeoutRetryRef.current < 1) {
          connectTimeoutRetryRef.current += 1;
          setSignalUnstable(true);
          if (caller) {
            rtcRef.current?.restartIce?.().catch?.(() => undefined);
          }
          scheduleConnectTimeout();
          return;
        }

        if (caller && connectTimeoutRetryRef.current < 3) {
          connectTimeoutRetryRef.current += 1;
          setSignalUnstable(true);
          rtcRef.current?.restartIce?.().catch?.(() => undefined);
          scheduleConnectTimeout();
          return;
        }

        suppressEndRelayRef.current = true;
        endCallAndRequeueRef.current("disconnect");
      }, WEBRTC_CONNECT_TIMEOUT_MS);
    };
    scheduleConnectTimeout();

    try {
      if (!beautyOpenRef.current && !beautyOpeningIntentRef.current) {
        clearLocalPreviewStream();
      }

      resetChatAndSwipeState();

      const rtc = new WebRTCSession({
        onLocalStream: (s) => {
          if (queueTokenRef.current !== qTok) return;
          localStreamRef.current = s as any;
          setLocalStreamURL(s.toURL());
        },
        onRemoteStream: (s) => {
          if (queueTokenRef.current !== qTok) return;
          remoteStreamRef.current = s as any;
          markTransportHealthy(qTok);

          try {
            const tracks = ((s as any)?.getAudioTracks?.() ?? []) as any[];
            tracks.forEach((t: any) => {
              t.enabled = !Boolean(remoteMutedRef.current);
            });
          } catch {}

          setRemoteStreamURL(s.toURL());
          promoteToCalling(qTok);
        },
        onIceCandidate: (c) => ws.sendIce(rid, c),
        onAnswer: (sdp) => ws.sendAnswer(rid, sdp),
        onOffer: (sdp) => ws.sendOffer(rid, sdp),
        onDataChannelOpen: () => {
          if (queueTokenRef.current !== qTok) return;
          markTransportHealthy(qTok);
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

          if (st === "connected" || st === "completed") {
            if (queueTokenRef.current !== qTok) return;
            markTransportHealthy(qTok);
            promoteToCalling(qTok);
            return;
          }

          if (st === "connecting" || st === "checking") {
            if (queueTokenRef.current !== qTok) return;
            if (phaseRef.current !== "matched" && phaseRef.current !== "calling") return;
            setSignalUnstable(true);
            return;
          }

          if (st === "failed" || st === "disconnected" || st === "closed") {
            if (queueTokenRef.current !== qTok) return;
            if (phaseRef.current !== "matched" && phaseRef.current !== "calling") return;
            setSignalUnstable(true);
            scheduleConnectionRecovery(qTok, st === "disconnected" ? 900 : 180, tokenNow);
            const downToken = webrtcDownTokenRef.current + 1;
            webrtcDownTokenRef.current = downToken;

            if (!webrtcConnectedRef.current) {
              setCallTransportReady(false);
              if (webrtcDownTimerRef.current) clearTimeout(webrtcDownTimerRef.current);
              webrtcDownTimerRef.current = setTimeout(() => {
                if (webrtcDownTokenRef.current !== downToken) return;
                if (phaseRef.current !== "matched" && phaseRef.current !== "calling") return;
                if (queueTokenRef.current !== qTok) return;
                if (webrtcConnectedRef.current) return;

                suppressEndRelayRef.current = true;
                endCallAndRequeueRef.current("disconnect");
              }, Math.max(WEBRTC_DOWN_GRACE_MS, st === "disconnected" ? 45000 : 30000));
            }

            return;
          }
        },
      });

      rtcRef.current = rtc;
      await rtc.start({ isCaller: caller });
      startIceHealthTimer(rtc, qTok, tokenNow);

      if (callStartTokenRef.current !== tokenNow) {
        try {
          rtc.stop();
        } catch {}
        clearIceHealthTimer();
        return;
      }

      if (phaseRef.current === "matched") {
        promoteToCalling(qTok);
      }

      try {
        const pending = pendingSignalRef.current.splice(0);
        const orderedPending = [
          ...pending.filter((p) => p.type === "offer"),
          ...pending.filter((p) => p.type === "answer"),
          ...pending.filter((p) => p.type === "ice"),
        ];
        for (const p of orderedPending) {
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

      try {
        const camEnabled = Boolean(myCamOnRef.current);
        ws.sendCamState(rid, camEnabled);
        ws.relay(rid, { type: "cam", enabled: camEnabled });
      } catch {}
      try {
        const micEnabled = Boolean(mySoundOnRef.current);
        ws.sendMicState(rid, micEnabled);
        ws.relay(rid, { type: "mic", enabled: micEnabled });
      } catch {}

    } catch {
      clearIceHealthTimer();
      if (callStartTokenRef.current !== tokenNow) return;

      useAppStore.getState().showGlobalModal(t("call.error_title"), t("call.error_start"));
      try {
        ws.leaveRoom(rid);
      } catch {}
      endCallAndRequeueRef.current("error");
    }
  };

  return {
    stopAll,
    beginCall,
  };
}
