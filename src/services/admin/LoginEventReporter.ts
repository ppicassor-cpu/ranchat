import Constants from "expo-constants";
import { Platform } from "react-native";
import { APP_CONFIG } from "../../config/app";

type LoginEventInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  provider: string;
  loginAccount?: string | null;
  subscriptionStatus?: string | null;
  isPremium?: boolean | null;
  planId?: string | null;
  storeProductId?: string | null;
  popcornCount?: number | null;
  kernelCount?: number | null;
  totalPaymentKrw?: number | null;
};

function normalizeHttpsBase(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s.replace(/\/+$/, "");
  if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
  if (/^wss:\/\//i.test(s)) return s.replace(/^wss:\/\//i, "https://").replace(/\/+$/, "");
  if (/^ws:\/\//i.test(s)) return s.replace(/^ws:\/\//i, "https://").replace(/\/+$/, "");
  return `https://${s.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function httpsBaseFromWs(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    return `https://${u.host}`;
  } catch {
    return "";
  }
}

function resolveBases(): string[] {
  const base = String(APP_CONFIG.AUTH_HTTP_BASE_URL || "").trim();
  const fromSignal = httpsBaseFromWs(String(APP_CONFIG.SIGNALING_URL || "").trim());
  const out = [base, fromSignal].map((v) => normalizeHttpsBase(v)).filter((v) => v.length > 0);
  return Array.from(new Set(out));
}

function normalizePath(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

function sanitize(v: string | null | undefined, maxLen = 160): string {
  return String(v || "").trim().slice(0, maxLen);
}

function appVersion(): string {
  const direct = sanitize((Constants.expoConfig as any)?.version, 64);
  if (direct) return direct;
  const runtime = sanitize((Constants.expoConfig as any)?.runtimeVersion, 64);
  if (runtime) return runtime;
  return "";
}

function asSafeInt(v: number | null | undefined): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

export async function reportLoginEvent(input: LoginEventInput): Promise<void> {
  const token = sanitize(input.token, 4096);
  const userId = sanitize(input.userId, 128);
  if (!token || !userId) return;

  const bases = resolveBases();
  if (!bases.length) return;

  const paths = [normalizePath("/api/admin/login-events"), normalizePath("/admin/login-events")];
  const payload = {
    userId,
    deviceKey: sanitize(input.deviceKey, 256),
    provider: sanitize(input.provider, 32) || "unknown",
    loginAccount: sanitize(input.loginAccount, 240),
    subscriptionStatus: sanitize(input.subscriptionStatus, 24),
    isPremium: input.isPremium === true ? true : input.isPremium === false ? false : null,
    planId: sanitize(input.planId, 64),
    storeProductId: sanitize(input.storeProductId, 120),
    popcornCount: asSafeInt(input.popcornCount),
    kernelCount: asSafeInt(input.kernelCount),
    totalPaymentKrw: asSafeInt(input.totalPaymentKrw),
    platform: sanitize(Platform.OS, 32),
    appVersion: appVersion(),
    atMs: Date.now(),
  };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": sanitize(input.deviceKey, 256),
  };

  for (const base of bases) {
    for (const path of paths) {
      const url = `${base}${path}`;
      try {
        const res = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });

        if (res.ok) return;
        if (res.status === 404 || res.status === 405) continue;
        return;
      } catch {
        // Try next candidate.
      }
    }
  }
}
