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

function normalizePath(v: string, fallback: string): string {
  const raw = String(v || "").trim();
  const use = raw || fallback;
  if (!use) return "/";
  return `/${use.replace(/^\/+/, "")}`;
}

function normalizeCallbackScheme(v: string, fallback: string): string {
  const raw = String(v || "").trim() || fallback;
  const clean = raw.replace(/:.*$/, "").replace(/[^a-zA-Z0-9+.-]/g, "");
  return clean || fallback;
}

function normalizeCallbackPath(v: string, fallback: string): string {
  const raw = String(v || "").trim() || fallback;
  return raw.replace(/^\/+/, "").replace(/\/+$/, "");
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
    host: read("EXPO_PUBLIC_TURN_HOST", "comspc.duckdns.org"),
    port: readPort("EXPO_PUBLIC_TURN_PORT", 3478),
    username: read("EXPO_PUBLIC_TURN_USERNAME", "testuser"),
    password: read("EXPO_PUBLIC_TURN_PASSWORD", "testpass"),
    tcpEnabled: readBool("EXPO_PUBLIC_TURN_TCP_ENABLED", false),
  },

  AUTH_HTTP_BASE_URL: normalizeHttpsBase(read("EXPO_PUBLIC_AUTH_HTTP_BASE_URL", "https://comspc.duckdns.org")),

  AUTH: {
    callbackScheme: normalizeCallbackScheme(read("EXPO_PUBLIC_AUTH_CALLBACK_SCHEME", "ranchat"), "ranchat"),
    callbackPath: normalizeCallbackPath(read("EXPO_PUBLIC_AUTH_CALLBACK_PATH", "auth/callback"), "auth/callback"),
    GOOGLE: {
      webClientId: read("EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID", ""),
      iosClientId: read("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID", ""),
      nativePath: normalizePath(read("EXPO_PUBLIC_GOOGLE_AUTH_NATIVE_PATH", "/api/auth/google/native"), "/api/auth/google/native"),
      startPath: normalizePath(read("EXPO_PUBLIC_GOOGLE_AUTH_START_PATH", "/api/auth/google/start"), "/api/auth/google/start"),
      exchangePath: normalizePath(
        read("EXPO_PUBLIC_GOOGLE_AUTH_EXCHANGE_PATH", "/api/auth/google/callback"),
        "/api/auth/google/callback"
      ),
    },
    APPLE: {
      nativePath: normalizePath(read("EXPO_PUBLIC_APPLE_AUTH_NATIVE_PATH", "/api/auth/apple/native"), "/api/auth/apple/native"),
      startPath: normalizePath(read("EXPO_PUBLIC_APPLE_AUTH_START_PATH", "/api/auth/apple/start"), "/api/auth/apple/start"),
      exchangePath: normalizePath(
        read("EXPO_PUBLIC_APPLE_AUTH_EXCHANGE_PATH", "/api/auth/apple/callback"),
        "/api/auth/apple/callback"
      ),
    },
  },

  ACTIVE_USERS_PATH: normalizePath(read("EXPO_PUBLIC_ACTIVE_USERS_PATH", "/api/active-users"), "/api/active-users"),

  ADS: {
    bannerAndroid: read("EXPO_PUBLIC_AD_UNIT_BANNER_ANDROID", ""),
    bannerIos: read("EXPO_PUBLIC_AD_UNIT_BANNER_IOS", ""),
    interstitialAndroid: read("EXPO_PUBLIC_AD_UNIT_INTERSTITIAL_ANDROID", ""),
    interstitialIos: read("EXPO_PUBLIC_AD_UNIT_INTERSTITIAL_IOS", ""),
    rewardedAndroid: read("EXPO_PUBLIC_AD_UNIT_REWARDED_ANDROID", ""),
    rewardedIos: read("EXPO_PUBLIC_AD_UNIT_REWARDED_IOS", ""),
  },

  POPTALK: {
    httpBaseUrl: normalizeHttpsBase(read("EXPO_PUBLIC_POPTALK_HTTP_BASE_URL", "")),
    statePath: normalizePath(read("EXPO_PUBLIC_POPTALK_STATE_PATH", "/api/poptalk/state"), "/api/poptalk/state"),
    consumePath: normalizePath(read("EXPO_PUBLIC_POPTALK_CONSUME_PATH", "/api/poptalk/consume"), "/api/poptalk/consume"),
    rewardPath: normalizePath(read("EXPO_PUBLIC_POPTALK_REWARD_PATH", "/api/poptalk/reward"), "/api/poptalk/reward"),
    kernelConvertPath: normalizePath(
      read("EXPO_PUBLIC_POPTALK_KERNEL_CONVERT_PATH", "/api/poptalk/kernel-convert"),
      "/api/poptalk/kernel-convert"
    ),
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
    weekly: { label: "1 week", price: 4900, productId: "ranchat_premium:weekly_-plan" },
    monthly: { label: "1 month", price: 14900, productId: "ranchat_premium:monthly2_-plan" },
    yearly: { label: "1 year", price: 89000, productId: "ranchat_premium:yearly2_-plan" },
  },
} as const;

export type Gender = "male" | "female";
export type Language = "ko" | "en" | "ja" | "zh" | "es" | "de" | "fr" | "it" | "ru";

export const COUNTRY_OPTIONS: { code: string; label: string; dial?: string }[] = [
  { code: "KR", label: "Korea", dial: "+82" },
  { code: "JP", label: "Japan", dial: "+81" },
  { code: "CN", label: "China", dial: "+86" },
  { code: "TW", label: "Taiwan", dial: "+886" },
  { code: "HK", label: "Hong Kong", dial: "+852" },
  { code: "SG", label: "Singapore", dial: "+65" },
  { code: "TH", label: "Thailand", dial: "+66" },
  { code: "VN", label: "Vietnam", dial: "+84" },
  { code: "ID", label: "Indonesia", dial: "+62" },
  { code: "PH", label: "Philippines", dial: "+63" },
  { code: "MY", label: "Malaysia", dial: "+60" },
  { code: "IN", label: "India", dial: "+91" },
  { code: "US", label: "United States", dial: "+1" },
  { code: "CA", label: "Canada", dial: "+1" },
  { code: "GB", label: "United Kingdom", dial: "+44" },
  { code: "AU", label: "Australia", dial: "+61" },
  { code: "DE", label: "Germany", dial: "+49" },
  { code: "FR", label: "France", dial: "+33" },
  { code: "RU", label: "Russia", dial: "+7" },
  { code: "ES", label: "Spain", dial: "+34" },
  { code: "IT", label: "Italy", dial: "+39" },
  { code: "BR", label: "Brazil", dial: "+55" },
  { code: "MX", label: "Mexico", dial: "+52" },
];
