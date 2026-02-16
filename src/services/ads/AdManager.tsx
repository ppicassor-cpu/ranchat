//C:\ranchat\src\services\ads\AdManager.tsx
import React from "react";
import { Platform } from "react-native";
import mobileAds, { BannerAd, BannerAdSize, InterstitialAd, TestIds } from "react-native-google-mobile-ads";

let _adsInited = false;

export function initAds() {
  if (_adsInited) return;
  _adsInited = true;

  try {
    const p = mobileAds().initialize();
    if (p && typeof (p as any).catch === "function") (p as any).catch(() => {});
  } catch {}
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
  return InterstitialAd.createForAdRequest(unitId, { requestNonPersonalizedAdsOnly: false });
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

export default { initAds, createInterstitial, BannerBar };
