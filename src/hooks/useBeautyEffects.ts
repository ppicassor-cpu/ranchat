import { useCallback, useEffect, useRef, useState } from "react";
import { NativeModules } from "react-native";
import type { BeautyConfig } from "../screens/CallBeautySheet";

type UseBeautyEffectsArgs = {
  localStreamRef: React.MutableRefObject<any>;
  localStreamURL: string | null;
  phaseRef: React.MutableRefObject<string>;
  clearLocalPreviewStreamRef: React.MutableRefObject<() => void>;
};

export default function useBeautyEffects({
  localStreamRef,
  localStreamURL,
  phaseRef,
  clearLocalPreviewStreamRef,
}: UseBeautyEffectsArgs) {
  const [beautyOpen, setBeautyOpen] = useState(false);
  const [beautyConfig, setBeautyConfig] = useState<BeautyConfig>({
    enabled: false,
    preset: "none",
    brightness: 0.5,
    saturation: 0.5,
    contrast: 0.5,
    bgFocus: false,
    bgFocusStrength: 0,
  });

  const beautyOpenRef = useRef(false);
  const beautyOpeningIntentRef = useRef(false);

  const beautyLastPushAtRef = useRef(0);
  const beautyPushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beautyPendingRef = useRef<BeautyConfig | null>(null);
  const beautyEffectStateRef = useRef<{ trackId: string | null; enabled: boolean }>({ trackId: null, enabled: false });

  const openBeauty = useCallback(() => {
    beautyOpeningIntentRef.current = true;
    setBeautyConfig((prev) => {
      if (prev.enabled) return prev;
      return {
        ...prev,
        enabled: true,
      };
    });
    setBeautyOpen(true);
  }, []);

  const getLocalVideoTrack = useCallback(() => {
    const s: any = localStreamRef.current;
    const tracks = (s?.getVideoTracks?.() ?? []) as any[];
    return tracks[0] ?? null;
  }, [localStreamRef]);

  const pushBeautyConfigThrottled = useCallback((trackId: string, cfg: BeautyConfig) => {
    beautyPendingRef.current = cfg;

    if (beautyPushTimerRef.current) return;

    const now = Date.now();
    const wait = Math.max(0, 120 - (now - beautyLastPushAtRef.current));

    beautyPushTimerRef.current = setTimeout(() => {
      beautyPushTimerRef.current = null;

      const latest = beautyPendingRef.current;
      if (!latest || !latest.enabled) return;

      try {
        (NativeModules as any)?.WebRTCModule?.mediaStreamTrackSetVideoEffectConfig?.(trackId, latest);
        beautyLastPushAtRef.current = Date.now();
      } catch {}
    }, wait);
  }, []);

  useEffect(() => {
    const track: any = getLocalVideoTrack();
    const trackId = String(track?.id ?? "");
    if (!trackId) return;

    const wantEnabled = Boolean(beautyConfig.enabled);
    const last = beautyEffectStateRef.current;

    if (last.trackId !== trackId || last.enabled !== wantEnabled) {
      try {
        track._setVideoEffects(wantEnabled ? ["beauty"] : []);
      } catch {}
      beautyEffectStateRef.current = { trackId, enabled: wantEnabled };
    }

    if (wantEnabled) {
      pushBeautyConfigThrottled(trackId, beautyConfig);
    }
  }, [beautyConfig.enabled, localStreamURL, getLocalVideoTrack, pushBeautyConfigThrottled]);

  useEffect(() => {
    if (!beautyConfig.enabled) return;

    const track: any = getLocalVideoTrack();
    const trackId = String(track?.id ?? "");
    if (!trackId) return;

    pushBeautyConfigThrottled(trackId, beautyConfig);
  }, [beautyConfig, localStreamURL, getLocalVideoTrack, pushBeautyConfigThrottled]);

  useEffect(() => {
    return () => {
      if (beautyPushTimerRef.current) clearTimeout(beautyPushTimerRef.current);
      beautyPushTimerRef.current = null;
    };
  }, []);

  useEffect(() => {
    beautyOpenRef.current = beautyOpen;
    if (beautyOpen) {
      beautyOpeningIntentRef.current = true;
    }
  }, [beautyOpen]);

  const closeBeauty = useCallback(() => {
    beautyOpeningIntentRef.current = false;
    setBeautyOpen(false);
    if (phaseRef.current !== "calling") {
      clearLocalPreviewStreamRef.current?.();
    }
  }, [clearLocalPreviewStreamRef, phaseRef]);

  return {
    beautyOpen,
    setBeautyOpen,
    beautyConfig,
    setBeautyConfig,
    beautyOpenRef,
    beautyOpeningIntentRef,
    openBeauty,
    closeBeauty,
  };
}
