import type React from "react";
import { useCallback } from "react";
import { mediaDevices } from "react-native-webrtc";

type UseLocalPreviewArgs = {
  previewStreamRef: React.MutableRefObject<any>;
  localStreamRef: React.MutableRefObject<any>;
  previewOpeningRef: React.MutableRefObject<boolean>;
  phaseRef: React.MutableRefObject<string>;
  setLocalStreamURL: (url: string | null) => void;
  showGlobalModal: (title: string, message: string) => void;
  t: (key: string, params?: any) => string;
};

export default function useLocalPreview({
  previewStreamRef,
  localStreamRef,
  previewOpeningRef,
  phaseRef,
  setLocalStreamURL,
  showGlobalModal,
  t,
}: UseLocalPreviewArgs) {
  const clearLocalPreviewStream = useCallback(() => {
    const s: any = previewStreamRef.current;
    if (!s) return;

    try {
      (s as any)?.getTracks?.()?.forEach((t: any) => t?.stop?.());
    } catch {}

    previewStreamRef.current = null;
    if (localStreamRef.current === s) localStreamRef.current = null;

    if (phaseRef.current !== "calling") {
      setLocalStreamURL(null);
    }
  }, [localStreamRef, phaseRef, previewStreamRef, setLocalStreamURL]);

  const hasLiveVideoTrack = useCallback((stream: any) => {
    try {
      const tracks = (stream?.getVideoTracks?.() ?? []) as any[];
      if (!tracks.length) return false;
      return tracks.some((t: any) => String(t?.readyState ?? "live").toLowerCase() !== "ended");
    } catch {
      return false;
    }
  }, []);

  const ensureLocalPreviewStream = useCallback(async () => {
    if (phaseRef.current === "calling") return true;

    const existing = previewStreamRef.current;
    if (existing && hasLiveVideoTrack(existing)) {
      localStreamRef.current = existing;
      try {
        setLocalStreamURL(existing.toURL());
      } catch {}
      return true;
    }
    if (existing) {
      try {
        (existing as any)?.getTracks?.()?.forEach((t: any) => t?.stop?.());
      } catch {}
      previewStreamRef.current = null;
      if (localStreamRef.current === existing) localStreamRef.current = null;
      setLocalStreamURL(null);
    }

    if (previewOpeningRef.current) return false;
    previewOpeningRef.current = true;

    try {
      const requestPreviewStream = async (fallback = false) =>
        mediaDevices.getUserMedia({
          audio: false,
          video: fallback
            ? {
                facingMode: "user",
                frameRate: { ideal: 20, max: 20 },
                width: { ideal: 640, max: 640 },
                height: { ideal: 480, max: 480 },
              }
            : {
                facingMode: "user",
                frameRate: { ideal: 24, max: 24 },
                width: { ideal: 720, max: 720 },
                height: { ideal: 540, max: 540 },
              },
        } as any);

      let stream: any = null;
      try {
        stream = await requestPreviewStream(false);
        if (!hasLiveVideoTrack(stream)) throw new Error("PREVIEW_STREAM_NO_LIVE_TRACK");
      } catch {
        try {
          await new Promise((resolve) => setTimeout(resolve, 120));
        } catch {}
        stream = await requestPreviewStream(true);
      }

      if (!stream || !hasLiveVideoTrack(stream)) {
        throw new Error("PREVIEW_STREAM_INVALID");
      }

      previewStreamRef.current = stream;
      localStreamRef.current = stream;
      setLocalStreamURL(stream.toURL());
      return true;
    } catch {
      showGlobalModal(t("common.error_occurred"), t("call.camera_preview_failed"));
      return false;
    } finally {
      previewOpeningRef.current = false;
    }
  }, [hasLiveVideoTrack, localStreamRef, phaseRef, previewOpeningRef, previewStreamRef, setLocalStreamURL, showGlobalModal, t]);

  return {
    clearLocalPreviewStream,
    hasLiveVideoTrack,
    ensureLocalPreviewStream,
  };
}
