import type React from "react";
import { SignalClient } from "../services/signal/SignalClient";
import { WebRTCSession } from "../services/webrtc/WebRTCSession";
import { useAppStore } from "../store/useAppStore";

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
    webrtcConnectedRef.current = false;

    if (beginCallGuardRef.current) return;
    beginCallGuardRef.current = true;

    const tokenNow = callStartTokenRef.current + 1;
    callStartTokenRef.current = tokenNow;

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
              endCallAndRequeueRef.current("remote_left");
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
        endCallAndRequeueRef.current("disconnect");
      }, 4000);

      try {
        const camEnabled = Boolean(myCamOnRef.current);
        ws.sendCamState(rid, camEnabled);
        ws.relay(rid, { type: "cam", enabled: camEnabled });
      } catch {}

    } catch {
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
