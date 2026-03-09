import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleSignin, statusCodes } from "@react-native-google-signin/google-signin";
import { APP_CONFIG } from "../../config/app";

export type NativeProvider = "google" | "apple";

export type NativeAuthResult = {
  token: string;
  userId: string;
};

export type GoogleNativeIdentity = {
  idToken: string;
  accessToken: string;
  serverAuthCode: string;
  email: string;
  name: string;
};

export type AppleNativeIdentity = {
  identityToken: string;
  authorizationCode: string;
  email: string;
  fullName: string;
  user: string;
};

type Candidate = {
  method: "POST" | "GET";
  path: string;
};

let googleConfigured = false;
let remoteConfigLoaded = false;
let remoteConfigInFlight: Promise<void> | null = null;
let remoteGoogleWebClientId = "";
let remoteGoogleIosClientId = "";

function toText(v: unknown, maxLen = 2048): string {
  return String(v ?? "")
    .trim()
    .slice(0, maxLen);
}

function normalizePath(v: string): string {
  const raw = toText(v, 256);
  if (!raw) return "/";
  return `/${raw.replace(/^\/+/, "")}`;
}

function normalizeAuthBase(v: string): string {
  const raw = toText(v, 512);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "");
  return `https://${raw.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function readAuthBase(): string {
  const envBase = toText(process.env.EXPO_PUBLIC_AUTH_HTTP_BASE_URL, 512);
  const cfgBase = toText(APP_CONFIG.AUTH_HTTP_BASE_URL, 512);
  return normalizeAuthBase(envBase || cfgBase);
}

async function loadRemoteMobileAuthConfig(): Promise<void> {
  if (remoteConfigLoaded) return;
  if (remoteConfigInFlight) {
    await remoteConfigInFlight;
    return;
  }

  remoteConfigInFlight = (async () => {
    const base = readAuthBase();
    if (!base) return;

    try {
      const res = await fetch(`${base}/api/auth/mobile-config`, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;

      const json: any = await res.json().catch(() => null);
      remoteGoogleWebClientId = toText(
        json?.google?.webClientId ?? json?.googleWebClientId ?? json?.google_web_client_id,
        400
      );
      remoteGoogleIosClientId = toText(
        json?.google?.iosClientId ?? json?.googleIosClientId ?? json?.google_ios_client_id,
        400
      );
      remoteConfigLoaded = Boolean(remoteGoogleWebClientId || remoteGoogleIosClientId);
    } catch {
      // Ignore remote config failures and rely on local env.
    } finally {
      remoteConfigInFlight = null;
    }
  })();

  await remoteConfigInFlight;
}

function pickString(obj: any, keys: string[]): string {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function parseAuthResult(data: any): NativeAuthResult | null {
  const containers = [data, data?.data, data?.result, data?.payload, data?.user].filter(Boolean);
  for (const c of containers) {
    const token = pickString(c, ["token", "accessToken", "access_token", "appToken", "jwt"]);
    const userId = pickString(c, ["userId", "user_id", "uid", "id", "sub"]);
    if (token && userId) return { token, userId };
  }
  return null;
}

function readNativePath(provider: NativeProvider): string {
  const auth: any = (APP_CONFIG as any)?.AUTH ?? {};
  if (provider === "google") {
    return normalizePath(
      toText(
        auth?.GOOGLE?.nativePath || process.env.EXPO_PUBLIC_GOOGLE_AUTH_NATIVE_PATH || "/api/auth/google/native",
        256
      )
    );
  }
  return normalizePath(
    toText(auth?.APPLE?.nativePath || process.env.EXPO_PUBLIC_APPLE_AUTH_NATIVE_PATH || "/api/auth/apple/native", 256)
  );
}

function resolveCandidates(provider: NativeProvider): Candidate[] {
  const configured = readNativePath(provider);

  const defaults =
    provider === "google"
      ? ["/api/auth/google/native", "/api/auth/google/exchange", "/auth/google/exchange", "/api/auth/google/callback"]
      : ["/api/auth/apple/native", "/api/auth/apple/exchange", "/auth/apple/exchange", "/api/auth/apple/callback"];

  const paths = Array.from(new Set([configured, ...defaults].map((p) => normalizePath(p))));
  const out: Candidate[] = [];
  paths.forEach((path) => {
    out.push({ method: "POST", path });
    out.push({ method: "GET", path });
  });
  return out;
}

function isGoogleCancelError(e: any): boolean {
  const code = toText(e?.code, 120);
  if (code && code === statusCodes.SIGN_IN_CANCELLED) return true;
  const msg = toText(e?.message, 500).toLowerCase();
  if (msg.includes("cancel")) return true;
  return false;
}

function formatAppleFullName(credential: AppleAuthentication.AppleAuthenticationCredential): string {
  const first = toText(credential.fullName?.givenName, 120);
  const last = toText(credential.fullName?.familyName, 120);
  return `${first} ${last}`.trim();
}

export async function configureGoogleNativeSdk(): Promise<void> {
  if (googleConfigured) return;

  await loadRemoteMobileAuthConfig();

  const auth: any = (APP_CONFIG as any)?.AUTH ?? {};
  const webClientId = toText(
    auth?.GOOGLE?.webClientId || process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || remoteGoogleWebClientId,
    400
  );
  const iosClientId = toText(
    auth?.GOOGLE?.iosClientId || process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || remoteGoogleIosClientId,
    400
  );

  const config: any = {
    offlineAccess: false,
    forceCodeForRefreshToken: false,
    scopes: ["profile", "email"],
  };
  // On Android, passing a non-web OAuth client ID as webClientId often triggers DEVELOPER_ERROR.
  // Native Android sign-in can proceed without webClientId; we exchange accessToken server-side.
  if (Platform.OS === "ios") {
    if (webClientId) config.webClientId = webClientId;
    if (iosClientId) config.iosClientId = iosClientId;
  }

  GoogleSignin.configure(config);

  googleConfigured = true;
}

export async function getGoogleNativeIdentity(): Promise<GoogleNativeIdentity> {
  try {
    await configureGoogleNativeSdk();
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const signInRes: any = await GoogleSignin.signIn();
    if (signInRes?.type === "cancelled") throw new Error("LOGIN_CANCELLED");

    const data = signInRes?.data ?? signInRes ?? {};
    let idToken = toText(data?.idToken || signInRes?.idToken, 8192);
    let accessToken = toText(data?.accessToken || signInRes?.accessToken, 8192);
    const serverAuthCode = toText(data?.serverAuthCode || signInRes?.serverAuthCode, 2048);
    const email = toText(data?.user?.email || signInRes?.user?.email, 240);
    const name = toText(data?.user?.name || signInRes?.user?.name, 240);

    if (!idToken || !accessToken) {
      const tokenRes: any = await GoogleSignin.getTokens().catch(() => null);
      if (!idToken) idToken = toText(tokenRes?.idToken, 8192);
      if (!accessToken) accessToken = toText(tokenRes?.accessToken, 8192);
    }

    if (!idToken && !serverAuthCode && !accessToken) {
      throw new Error("GOOGLE_TOKEN_MISSING");
    }

    return {
      idToken,
      accessToken,
      serverAuthCode,
      email,
      name,
    };
  } catch (e: any) {
    if (isGoogleCancelError(e)) {
      throw new Error("LOGIN_CANCELLED");
    }
    throw e;
  }
}

export async function getCurrentGoogleNativeEmail(): Promise<string> {
  try {
    await configureGoogleNativeSdk();
    const currentUser: any = GoogleSignin.getCurrentUser?.() || null;
    return toText(currentUser?.user?.email || currentUser?.email, 240).toLowerCase();
  } catch {
    return "";
  }
}

export async function getAppleNativeIdentity(): Promise<AppleNativeIdentity> {
  if (Platform.OS !== "ios") {
    throw new Error("APPLE_LOGIN_IOS_ONLY");
  }

  const available = await AppleAuthentication.isAvailableAsync();
  if (!available) {
    throw new Error("APPLE_LOGIN_NOT_AVAILABLE");
  }

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
  });

  const identityToken = toText(credential.identityToken, 8192);
  const authorizationCode = toText(credential.authorizationCode, 4096);
  if (!identityToken && !authorizationCode) {
    throw new Error("APPLE_TOKEN_MISSING");
  }

  return {
    identityToken,
    authorizationCode,
    email: toText(credential.email, 240),
    fullName: formatAppleFullName(credential),
    user: toText(credential.user, 240),
  };
}

async function callNativeExchange(provider: NativeProvider, payload: Record<string, any>): Promise<NativeAuthResult> {
  const base = readAuthBase();
  if (!base) {
    throw new Error("AUTH_BASE_URL_MISSING");
  }

  const candidates = resolveCandidates(provider);
  let lastError = "";

  for (const c of candidates) {
    const body = {
      provider,
      platform: Platform.OS,
      ...payload,
    };

    const query = new URLSearchParams();
    Object.entries(body).forEach(([k, v]) => {
      if (v == null) return;
      if (String(v).trim().length === 0) return;
      query.set(k, String(v));
    });

    const url = c.method === "GET" ? `${base}${c.path}?${query.toString()}` : `${base}${c.path}`;

    try {
      const res = await fetch(url, {
        method: c.method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(c.method === "POST" ? { body: JSON.stringify(body) } : {}),
      });

      if (!res.ok) {
        if (res.status === 404 || res.status === 405) continue;
        const txt = await res.text().catch(() => "");
        lastError = `HTTP_${res.status}:${txt}`;
        continue;
      }

      const json = await res.json().catch(() => null);
      const auth = parseAuthResult(json);
      if (auth) return auth;

      lastError = "AUTH_RESPONSE_INVALID";
    } catch (e: any) {
      lastError = toText(e?.message || e, 300) || "AUTH_EXCHANGE_FAILED";
    }
  }

  throw new Error(lastError || "AUTH_EXCHANGE_FAILED");
}

export async function exchangeGoogleNativeIdentity(input: GoogleNativeIdentity & { deviceKey: string }): Promise<NativeAuthResult> {
  return callNativeExchange("google", {
    deviceKey: input.deviceKey,
    device_key: input.deviceKey,
    idToken: input.idToken,
    id_token: input.idToken,
    accessToken: input.accessToken,
    access_token: input.accessToken,
    serverAuthCode: input.serverAuthCode,
    server_auth_code: input.serverAuthCode,
    email: input.email,
    name: input.name,
  });
}

export async function exchangeAppleNativeIdentity(input: AppleNativeIdentity & { deviceKey: string }): Promise<NativeAuthResult> {
  return callNativeExchange("apple", {
    deviceKey: input.deviceKey,
    device_key: input.deviceKey,
    identityToken: input.identityToken,
    identity_token: input.identityToken,
    authorizationCode: input.authorizationCode,
    authorization_code: input.authorizationCode,
    email: input.email,
    name: input.fullName,
    user: input.user,
  });
}
