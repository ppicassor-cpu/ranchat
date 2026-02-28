import { useCallback, useEffect, useRef, useState } from "react";
import mobileAds, { AdEventType } from "react-native-google-mobile-ads";
import { createInterstitial, initAds } from "../services/ads/AdManager";

type UseAdManagerArgs = {
  isPremium: boolean;
  interstitialCooldownMs: number;
};

export default function useAdManager({ isPremium, interstitialCooldownMs }: UseAdManagerArgs) {
  const [adsReady, setAdsReady] = useState(false);
  const adsReadyRef = useRef(false);
  const adsAliveRef = useRef(true);
  const adsInitPromiseRef = useRef<Promise<any> | null>(null);

  const adAllowedRef = useRef(false);
  const interstitialTokenRef = useRef(0);
  const interstitialCleanupRef = useRef<(() => void) | null>(null);
  const interstitialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInterstitialAtRef = useRef<number>(0);

  const waitAdsReady = useCallback(async (maxWaitMs = 1000) => {
    if (adsReadyRef.current) return true;

    try {
      initAds();
    } catch {}

    if (!adsInitPromiseRef.current) {
      try {
        const p = mobileAds().initialize();
        adsInitPromiseRef.current = Promise.resolve(p as any);

        (p as any)
          ?.then?.(() => {
            if (adsReadyRef.current) return;
            adsReadyRef.current = true;
            if (!adsAliveRef.current) return;
            setAdsReady(true);
          })
          .catch?.(() => {});
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

  useEffect(() => {
    adsAliveRef.current = true;
    waitAdsReady(1000);
    return () => {
      adsAliveRef.current = false;
    };
  }, [waitAdsReady]);

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
      const allowed = diff >= interstitialCooldownMs;

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
    [interstitialCooldownMs, isPremium, waitAdsReady]
  );

  const resetAdFlow = useCallback(() => {
    adAllowedRef.current = false;
    interstitialTokenRef.current += 1;

    if (interstitialTimerRef.current) clearTimeout(interstitialTimerRef.current);
    interstitialTimerRef.current = null;

    try {
      interstitialCleanupRef.current?.();
    } catch {}
    interstitialCleanupRef.current = null;
  }, []);

  return {
    adsReady,
    adsReadyRef,
    adAllowedRef,
    interstitialTokenRef,
    interstitialCleanupRef,
    interstitialTimerRef,
    lastInterstitialAtRef,
    waitAdsReady,
    showInterstitialIfAllowed,
    resetAdFlow,
  };
}
