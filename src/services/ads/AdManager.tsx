// FILE: C:\ranchat\src\services\ads\AdManager.tsx
import React from "react";
import { Platform } from "react-native";
import mobileAds, { AdEventType, BannerAd, BannerAdSize, InterstitialAd, TestIds } from "react-native-google-mobile-ads";

let _initPromise: Promise<boolean> | null = null;
let _adsReady = false;

let _interstitialShowing = false;

type ReadyListener = (ready: boolean) => void;
const _readyListeners = new Set<ReadyListener>();

export function isAdsReady() {
  return _adsReady;
}

export function onAdsReady(cb: ReadyListener) {
  _readyListeners.add(cb);

  // 이미 ready면 즉시(비동기) 1회 통지
  if (_adsReady) {
    setTimeout(() => {
      try {
        cb(true);
      } catch {}
    }, 0);
  }

  return () => {
    _readyListeners.delete(cb);
  };
}

function notifyReady(v: boolean) {
  _adsReady = v;
  _readyListeners.forEach((fn) => {
    try {
      fn(v);
    } catch {}
  });
}

export function initAds() {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    try {
      await mobileAds().initialize();
      notifyReady(true);
      return true;
    } catch {
      // initialize 실패해도 앱은 계속 돌아가야 함(너무 빡빡하게 막지 않기)
      notifyReady(false);
      return false;
    }
  })();

  return _initPromise;
}

function getBannerUnitId() {
  const android = String(process.env.EXPO_PUBLIC_AD_UNIT_BANNER_ANDROID ?? "").trim();
  const ios = String(process.env.EXPO_PUBLIC_AD_UNIT_BANNER_IOS ?? "").trim();
  const envId = Platform.OS === "ios" ? ios : android;
  return envId || (Platform.OS === "ios" ? TestIds.BANNER : "ca-app-pub-5144004139813427/1738956911");
}

function getInterstitialUnitId() {
  const android = String(process.env.EXPO_PUBLIC_AD_UNIT_INTERSTITIAL_ANDROID ?? "").trim();
  const ios = String(process.env.EXPO_PUBLIC_AD_UNIT_INTERSTITIAL_IOS ?? "").trim();
  const envId = Platform.OS === "ios" ? ios : android;
  return envId || (Platform.OS === "ios" ? TestIds.INTERSTITIAL : "ca-app-pub-5144004139813427/9729127571");
}

export function createInterstitial() {
  const unitId = getInterstitialUnitId();
  const ad = InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: false });

  // ✅ 전역 1회 가드: 닫힘/에러에서만 해제
  try {
    ad.addAdEventListener(AdEventType.CLOSED, () => {
      _interstitialShowing = false;
    });
  } catch {}

  try {
    ad.addAdEventListener(AdEventType.ERROR, () => {
      _interstitialShowing = false;
    });
  } catch {}

  // ✅ show() 직전에 true, 이미 true면 show 무시
  try {
    const origShow = (ad as any).show?.bind(ad);
    if (typeof origShow === "function") {
      (ad as any).show = async (...args: any[]) => {
        if (_interstitialShowing) return;
        _interstitialShowing = true;
        try {
          return await origShow(...args);
        } catch (e) {
          _interstitialShowing = false;
          throw e;
        }
      };
    }
  } catch {}

  return ad;
}

export function BannerBar() {
  const unitId = getBannerUnitId();
  return (
    <BannerAd
      unitId={unitId}
      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
      requestOptions={{ requestNonPersonalizedAdsOnly: false }}
    />
  );
}

export default { initAds, createInterstitial, BannerBar, isAdsReady, onAdsReady };