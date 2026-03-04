import { APP_CONFIG } from "../../config/app";

export type TranslatePeerChatInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey: string | null | undefined;
  text: string;
  targetLang: string;
  sourceLang?: string | null;
  roomId?: string | null;
};

export type TranslatePeerChatResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  translatedText: string;
  detectedSourceLang?: string;
};

function asText(v: unknown, maxLen = 300): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function normalizeHttpsBase(v: string): string {
  const s = asText(v, 512);
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s.replace(/\/+$/, "");
  if (/^http:\/\//i.test(s)) return s.replace(/\/+$/, "");
  if (/^wss:\/\//i.test(s)) return s.replace(/^wss:\/\//i, "https://").replace(/\/+$/, "");
  if (/^ws:\/\//i.test(s)) return s.replace(/^ws:\/\//i, "http://").replace(/\/+$/, "");
  return `https://${s.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function httpsBaseFromWs(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    const protocol = u.protocol === "ws:" ? "http" : "https";
    return `${protocol}://${u.host}`;
  } catch {
    return "";
  }
}

function normalizePath(pathLike: string): string {
  const p = asText(pathLike, 320);
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function resolveBases(): string[] {
  const envTranslateBase = asText(process.env.EXPO_PUBLIC_TRANSLATE_HTTP_BASE_URL || "", 512);
  const envTranslationBase = asText(process.env.EXPO_PUBLIC_TRANSLATION_HTTP_BASE_URL || "", 512);
  const cfgAuth = asText(APP_CONFIG.AUTH_HTTP_BASE_URL || "", 512);
  const cfgPopTalk = asText(APP_CONFIG.POPTALK?.httpBaseUrl || "", 512);
  const cfgSignal = asText(APP_CONFIG.SIGNALING_URL || "", 512);

  const raw = [envTranslateBase, envTranslationBase, cfgAuth, cfgPopTalk, httpsBaseFromWs(cfgSignal)]
    .map((v) => normalizeHttpsBase(v))
    .filter((v) => v.length > 0);

  return Array.from(new Set(raw));
}

function resolvePaths(): string[] {
  const customPath = asText(process.env.EXPO_PUBLIC_TRANSLATE_PATH || process.env.EXPO_PUBLIC_TRANSLATION_PATH || "", 260);
  const raw = [
    customPath,
    "/api/translate/chat",
    "/translate/chat",
    "/api/chat/translate",
    "/chat/translate",
    "/api/translate/realtime",
    "/translate/realtime",
  ].filter((v) => v.length > 0);
  return Array.from(new Set(raw.map((v) => normalizePath(v))));
}

function parseSuccess(json: any): { translatedText: string; detectedSourceLang?: string } {
  const translatedText = asText(
    json?.translatedText ||
      json?.translation ||
      json?.translated ||
      json?.result?.translatedText ||
      json?.data?.translatedText ||
      "",
    4000
  );
  const detectedSourceLang = asText(
    json?.detectedSourceLang || json?.detectedLanguage || json?.result?.detectedSourceLang || json?.data?.detectedSourceLang || "",
    24
  );

  return {
    translatedText,
    detectedSourceLang: detectedSourceLang || undefined,
  };
}

export async function translatePeerChatOnServer(input: TranslatePeerChatInput): Promise<TranslatePeerChatResult> {
  const token = asText(input.token, 1000);
  const userId = asText(input.userId, 180);
  const deviceKey = asText(input.deviceKey, 300);
  const text = asText(input.text, 4000);
  const targetLang = asText(input.targetLang, 24).toLowerCase();
  const sourceLang = asText(input.sourceLang || "", 24).toLowerCase();
  const roomId = asText(input.roomId || "", 120);

  if (!token || !userId || !deviceKey || !text || !targetLang) {
    return {
      ok: false,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
      translatedText: "",
    };
  }

  const bases = resolveBases();
  if (bases.length <= 0) {
    return {
      ok: false,
      errorCode: "HTTP_BASE_URL_MISSING",
      errorMessage: "HTTP_BASE_URL_MISSING",
      translatedText: "",
    };
  }

  const paths = resolvePaths();
  let lastFail: TranslatePeerChatResult | null = null;

  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-user-id": userId,
            "x-device-key": deviceKey,
          },
          body: JSON.stringify({
            text,
            sourceLang: sourceLang || undefined,
            targetLang,
            roomId: roomId || undefined,
            userId,
            deviceKey,
            sessionId: deviceKey,
            scene: "call_chat_realtime",
          }),
        });

        const textBody = await res.text().catch(() => "");
        let json: any = {};
        try {
          json = textBody ? JSON.parse(textBody) : {};
        } catch {
          json = {};
        }

        if (res.status === 404) continue;

        const ok = Boolean(res.ok && json && json.ok !== false);
        const parsed = parseSuccess(json);
        if (ok && parsed.translatedText) {
          return {
            ok: true,
            errorCode: "",
            errorMessage: "",
            translatedText: parsed.translatedText,
            detectedSourceLang: parsed.detectedSourceLang,
          };
        }

        lastFail = {
          ok: false,
          errorCode: asText(json?.errorCode || json?.error || `HTTP_${res.status}`, 120) || `HTTP_${res.status}`,
          errorMessage: asText(json?.errorMessage || json?.message || json?.error || `HTTP_${res.status}`, 240) || `HTTP_${res.status}`,
          translatedText: parsed.translatedText || "",
          detectedSourceLang: parsed.detectedSourceLang,
        };
      } catch {
        lastFail = {
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: "NETWORK_ERROR",
          translatedText: "",
        };
      }
    }
  }

  if (lastFail) return lastFail;

  return {
    ok: false,
    errorCode: "TRANSLATE_ROUTE_NOT_FOUND",
    errorMessage: "TRANSLATE_ROUTE_NOT_FOUND",
    translatedText: "",
  };
}
