// FILE: C:\ranchat\src\config\app.ts
import Constants from "expo-constants";

const env = (Constants.expoConfig?.extra ?? {}) as Record<string, any>;

const read = (k: string, fallback = ""): string => {
  const v = (process.env as any)?.[k];
  if (typeof v === "string" && v.trim().length > 0) return v.trim();
  const e = env?.[k];
  if (typeof e === "string" && e.trim().length > 0) return e.trim();
  return fallback;
};

const readNumber = (k: string, fallback: number): number => {
  const raw = read(k, String(fallback));
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

const readPort = (k: string, fallback: number): number => {
  const n = readNumber(k, fallback);
  if (!Number.isFinite(n) || n < 1 || n > 65535) return fallback;
  return Math.trunc(n);
};

const freeRemoteVideoSeconds = readNumber("EXPO_PUBLIC_FREE_REMOTE_VIDEO_SECONDS", 3000);

export const APP_CONFIG = {
  SIGNALING_URL: read("EXPO_PUBLIC_SIGNALING_URL", "ws://152.67.213.225:3001"),

  TURN: {
    host: read("EXPO_PUBLIC_TURN_HOST", "152.67.213.225"),
    port: readPort("EXPO_PUBLIC_TURN_PORT", 3478),
    username: read("EXPO_PUBLIC_TURN_USERNAME", "testuser"),
    password: read("EXPO_PUBLIC_TURN_PASSWORD", "testpass"),
  },

  // ✅ 4000(다른 프로젝트) 안 건드리고, 기본값을 3001로 고정
  AUTH_HTTP_BASE_URL: read("EXPO_PUBLIC_AUTH_HTTP_BASE_URL", "http://152.67.213.225:3001"),

  ADS: {
    bannerAndroid: read("EXPO_PUBLIC_AD_UNIT_BANNER_ANDROID", ""),
    interstitialAndroid: read("EXPO_PUBLIC_AD_UNIT_INTERSTITIAL_ANDROID", ""),
  },

  PURCHASES: {
    revenueCatKey: read("EXPO_PUBLIC_REVENUECAT_PUBLIC_SDK_KEY", ""),
    entitlementId: read("EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID", "premium"),
  },

  POLICY: {
    privacyUrl: read("EXPO_PUBLIC_PRIVACY_POLICY_URL", ""),
  },

  MATCH_TIMEOUT_MS: readNumber("EXPO_PUBLIC_MATCH_TIMEOUT_MS", 20000),
  FREE_CALL_LIMIT_MS: readNumber("EXPO_PUBLIC_FREE_CALL_LIMIT_MS", freeRemoteVideoSeconds * 1000),

  FREE_LIMITS: {
    remoteVideoSeconds: freeRemoteVideoSeconds,
  },

  PLANS: {
    weekly: { label: "1주", price: 4900 },
    monthly: { label: "1개월", price: 14900 },
    halfYear: { label: "6개월", price: 44900 },
  },
} as const;

export type Gender = "male" | "female";
export type Language = "ko" | "en";

export const COUNTRY_OPTIONS: { code: string; label: string; dial?: string }[] = [
  { code: "KR", label: "대한민국", dial: "+82" },
  { code: "JP", label: "일본", dial: "+81" },
  { code: "US", label: "미국", dial: "+1" },
  { code: "CA", label: "캐나다", dial: "+1" },
  { code: "GB", label: "영국", dial: "+44" },
  { code: "AU", label: "호주", dial: "+61" },
  { code: "DE", label: "독일", dial: "+49" },
  { code: "FR", label: "프랑스", dial: "+33" },
  { code: "SG", label: "싱가포르", dial: "+65" },
  { code: "TH", label: "태국", dial: "+66" },
];
