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

const readBool = (k: string, fallback: boolean): boolean => {
  const raw = read(k, fallback ? "1" : "0").trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "y" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "n" || raw === "off") return false;
  return fallback;
};

const readList = (k: string): string[] => {
  const raw = read(k, "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => String(s || "").trim())
    .filter((s) => s.length > 0);
};

function normalizeWssUrl(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^wss:\/\//i.test(s)) return s;
  if (/^ws:\/\//i.test(s)) return s.replace(/^ws:\/\//i, "wss://");
  if (/^https:\/\//i.test(s)) return s.replace(/^https:\/\//i, "wss://");
  if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, "wss://");
  return `wss://${s.replace(/^\/+/, "")}`;
}

function normalizeHttpsBase(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, "https://");
  if (/^wss:\/\//i.test(s)) return s.replace(/^wss:\/\//i, "https://");
  if (/^ws:\/\//i.test(s)) return s.replace(/^ws:\/\//i, "https://");
  return `https://${s.replace(/^\/+/, "")}`;
}

function normalizeIceUrl(v: string, defaultScheme: "stun" | "turn" = "stun"): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^(stun|stuns|turn|turns):/i.test(s)) return s;
  return `${defaultScheme}:${s.replace(/^\/+/, "")}`;
}

const freeRemoteVideoSeconds = readNumber("EXPO_PUBLIC_FREE_REMOTE_VIDEO_SECONDS", 3000);

const stunUrlsRaw = readList("EXPO_PUBLIC_STUN_URLS")
  .map((u) => normalizeIceUrl(u, "stun"))
  .filter((u) => u.length > 0);

const stunUrls =
  stunUrlsRaw.length > 0
    ? stunUrlsRaw
    : ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

export const APP_CONFIG = {
  SIGNALING_URL: normalizeWssUrl(read("EXPO_PUBLIC_SIGNALING_URL", "wss://comspc.duckdns.org")),

  ICE: {
    stunUrls,
  },

  TURN: {
    host: read("EXPO_PUBLIC_TURN_HOST", "152.67.213.225"),
    port: readPort("EXPO_PUBLIC_TURN_PORT", 3478),
    username: read("EXPO_PUBLIC_TURN_USERNAME", "testuser"),
    password: read("EXPO_PUBLIC_TURN_PASSWORD", "testpass"),
    tcpEnabled: readBool("EXPO_PUBLIC_TURN_TCP_ENABLED", false),
  },

  AUTH_HTTP_BASE_URL: normalizeHttpsBase(read("EXPO_PUBLIC_AUTH_HTTP_BASE_URL", "https://comspc.duckdns.org")),

  ADS: {
    bannerAndroid: read("EXPO_PUBLIC_AD_UNIT_BANNER_ANDROID", ""),
    interstitialAndroid: read("EXPO_PUBLIC_AD_UNIT_INTERSTITIAL_ANDROID", ""),
  },

  PURCHASES: {
    revenueCatKey: read(
      "EXPO_PUBLIC_REVENUECAT_ANDROID_KEY",
      read("EXPO_PUBLIC_REVENUECAT_PUBLIC_SDK_KEY", "goog_uUnNMCAjkegLjEYuqDCYwvwPTGX")
    ),
    entitlementId: read("EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID", "ranchat_premium"),
  },

  POLICY: {
    privacyUrl: read("EXPO_PUBLIC_PRIVACY_POLICY_URL", ""),
  },

  MATCH_TIMEOUT_MS: readNumber("EXPO_PUBLIC_MATCH_TIMEOUT_MS", 1200000),
  FREE_CALL_LIMIT_MS: readNumber("EXPO_PUBLIC_FREE_CALL_LIMIT_MS", freeRemoteVideoSeconds * 1000),

  FREE_LIMITS: {
    remoteVideoSeconds: freeRemoteVideoSeconds,
  },

  PLANS: {
    weekly: { label: "1주", price: 4900, productId: "ranchat_premium:weekly_-plan" },
    monthly: { label: "1개월", price: 14900, productId: "ranchat_premium:monthly2_-plan" },
    yearly: { label: "1년", price: 89000, productId: "ranchat_premium:yearly2_-plan" },
  },
} as const;

export type Gender = "male" | "female";
export type Language = "ko" | "en" | "ja" | "zh" | "es" | "de" | "fr" | "it" | "ru";

export const COUNTRY_OPTIONS: { code: string; label: string; dial?: string }[] = [
  { code: "KR", label: "대한민국", dial: "+82" },
  { code: "JP", label: "일본", dial: "+81" },
  { code: "CN", label: "중국", dial: "+86" },
  { code: "TW", label: "대만", dial: "+886" },
  { code: "HK", label: "홍콩", dial: "+852" },
  { code: "SG", label: "싱가포르", dial: "+65" },
  { code: "TH", label: "태국", dial: "+66" },
  { code: "VN", label: "베트남", dial: "+84" },
  { code: "ID", label: "인도네시아", dial: "+62" },
  { code: "PH", label: "필리핀", dial: "+63" },
  { code: "MY", label: "말레이시아", dial: "+60" },
  { code: "IN", label: "인도", dial: "+91" },
  { code: "US", label: "미국", dial: "+1" },
  { code: "CA", label: "캐나다", dial: "+1" },
  { code: "GB", label: "영국", dial: "+44" },
  { code: "AU", label: "호주", dial: "+61" },
  { code: "DE", label: "독일", dial: "+49" },
  { code: "FR", label: "프랑스", dial: "+33" },
  { code: "RU", label: "러시아", dial: "+7" },
  { code: "ES", label: "스페인", dial: "+34" },
  { code: "IT", label: "이탈리아", dial: "+39" },
  { code: "BR", label: "브라질", dial: "+55" },
  { code: "MX", label: "멕시코", dial: "+52" },
];
