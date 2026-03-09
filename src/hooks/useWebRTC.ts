import { useCallback } from "react";
import { SignalClient } from "../services/signal/SignalClient";
import { WebRTCSession } from "../services/webrtc/WebRTCSession";

type EndReason = "remote_left" | "disconnect" | "error" | "find_other";

type UseWebRTCArgs = {
  rtcRef: React.MutableRefObject<WebRTCSession | null>;
  wsRef: React.MutableRefObject<SignalClient | null>;
  roomId: string | null;
  myCamOn: boolean;
  setMyCamOn: (next: boolean) => void;
  mySoundOn: boolean;
  setMySoundOn: (next: boolean) => void;
  remoteMutedRef: React.MutableRefObject<boolean>;
  setRemoteMuted: (next: boolean) => void;
  remoteStreamRef: React.MutableRefObject<any>;
  beginCallImpl: (ws: SignalClient, rid: string, caller: boolean, qTok: number) => Promise<void> | void;
  endCallAndRequeueImpl: (why: EndReason) => void;
};

export default function useWebRTC({
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
  beginCallImpl,
  endCallAndRequeueImpl,
}: UseWebRTCArgs) {
  const beginCall = useCallback(
    (ws: SignalClient, rid: string, caller: boolean, qTok: number) => beginCallImpl(ws, rid, caller, qTok),
    [beginCallImpl]
  );

  const endCallAndRequeue = useCallback((why: EndReason) => endCallAndRequeueImpl(why), [endCallAndRequeueImpl]);

  const toggleCam = useCallback(() => {
    const next = !myCamOn;
    setMyCamOn(next);
    rtcRef.current?.setLocalVideoEnabled(next);

    try {
      if (roomId) {
        wsRef.current?.sendCamState(roomId, next);
        wsRef.current?.relay(roomId, { type: "cam", enabled: next });
      }
    } catch {}
  }, [myCamOn, roomId, rtcRef, setMyCamOn, wsRef]);

  const toggleSound = useCallback(() => {
    const next = !mySoundOn;
    setMySoundOn(next);
    rtcRef.current?.setLocalAudioEnabled(next);

    try {
      if (roomId) {
        wsRef.current?.sendMicState(roomId, next);
        wsRef.current?.relay(roomId, { type: "mic", enabled: next });
      }
    } catch {}
  }, [mySoundOn, rtcRef, setMySoundOn]);

  const toggleRemoteMute = useCallback(() => {
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
  }, [remoteMutedRef, remoteStreamRef, setRemoteMuted]);

  return {
    rtcRef,
    beginCall,
    endCallAndRequeue,
    toggleCam,
    toggleSound,
    toggleRemoteMute,
  };
}
