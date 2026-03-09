import { APP_CONFIG } from "../../config/app";

export type AiChatHistoryTurn = {
  mine: boolean;
  text: string;
};

export type AiChatMode = "reply" | "nudge";

export type FetchAiReplyInput = {
  token?: string;
  userId?: string;
  deviceKey?: string;
  roomId?: string;
  language?: string;
  personaKey?: string;
  lockOutputLanguage?: boolean;
  mode?: AiChatMode;
  message?: string;
  history?: AiChatHistoryTurn[];
  timeoutMs?: number;
};

export type FetchAiReplyResult = {
  ok: boolean;
  replyText: string;
  source: "ollama" | "fallback" | "fastpath" | "capability-fallback" | "error";
  model?: string;
  errorCode?: string;
  errorMessage?: string;
};

const AI_REPLY_CLIENT_TIMEOUT_GRACE_MS = 2500;

function asText(v: unknown, maxLen: number): string {
  return String(v ?? "").trim().slice(0, Math.max(1, Math.trunc(Number(maxLen) || 1)));
}

function normalizeMode(v: unknown): AiChatMode {
  return String(v ?? "").trim().toLowerCase() === "nudge" ? "nudge" : "reply";
}

function normalizeHistory(rows: unknown): AiChatHistoryTurn[] {
  const arr = Array.isArray(rows) ? rows : [];
  const out: AiChatHistoryTurn[] = [];
  for (const row of arr) {
    if (!row || typeof row !== "object") continue;
    const mine = (row as any).mine === true;
    const text = asText((row as any).text, 280);
    if (!text) continue;
    if (/^\[GIFT\]\s*/.test(text)) continue;
    out.push({ mine, text });
  }
  return limitHistoryBySpeaker(out, 4, 4);
}

function limitHistoryBySpeaker(rows: AiChatHistoryTurn[], maxMine: number, maxPeer: number): AiChatHistoryTurn[] {
  const safeMine = Math.max(0, Math.trunc(Number(maxMine) || 0));
  const safePeer = Math.max(0, Math.trunc(Number(maxPeer) || 0));
  let myCount = 0;
  let peerCount = 0;
  const picked: AiChatHistoryTurn[] = [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.mine) {
      if (myCount >= safeMine) continue;
      myCount += 1;
      picked.push(row);
      continue;
    }
    if (peerCount >= safePeer) continue;
    peerCount += 1;
    picked.push(row);
  }
  return picked.reverse();
}

export async function fetchAiReplyOnServer(input: FetchAiReplyInput): Promise<FetchAiReplyResult> {
  const mode = normalizeMode(input.mode);
  const bodyMessage = asText(input.message, 280);
  if (mode !== "nudge" && !bodyMessage) {
    return {
      ok: false,
      replyText: "",
      source: "error",
      errorCode: "AI_REPLY_MESSAGE_EMPTY",
      errorMessage: "AI_REPLY_MESSAGE_EMPTY",
    };
  }

  const base = String(APP_CONFIG.AUTH_HTTP_BASE_URL || "").replace(/\/+$/, "");
  const rawPath = String((APP_CONFIG as any).AI_REPLY_PATH || "/api/ai/reply");
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const url = `${base}${path}`;
  const timeoutMs = Math.max(1500, Math.min(70000, Math.trunc(Number(input.timeoutMs) || 30000)));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs + AI_REPLY_CLIENT_TIMEOUT_GRACE_MS);

  try {
    const token = asText(input.token, 4096);
    const userId = asText(input.userId, 128);
    const deviceKey = asText(input.deviceKey, 256);
    const roomId = asText(input.roomId, 120);
    const language = asText(input.language, 16).toLowerCase();
    const personaKey = asText(input.personaKey, 32).toLowerCase();
    const lockOutputLanguage = input.lockOutputLanguage === true;
    const historyBase = normalizeHistory(input.history);
    const history = mode === "reply" && bodyMessage ? limitHistoryBySpeaker(historyBase, 3, 4) : historyBase;

    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(userId ? { "x-user-id": userId } : {}),
        ...(deviceKey ? { "x-device-key": deviceKey } : {}),
      },
      body: JSON.stringify({
        mode,
        message: bodyMessage,
        roomId,
        language,
        personaKey,
        lockOutputLanguage,
        history,
        timeoutMs,
      }),
    });

    const json = await res.json().catch(() => null);
    const replyText = asText(json?.replyText || json?.reply || "", 320);
    const sourceRaw = String(json?.source || "").trim().toLowerCase();
    const source: FetchAiReplyResult["source"] =
      sourceRaw === "ollama" ||
      sourceRaw === "fallback" ||
      sourceRaw === "fastpath" ||
      sourceRaw === "capability-fallback"
        ? sourceRaw
        : "error";

    if (!res.ok) {
      return {
        ok: false,
        replyText,
        source,
        model: asText(json?.model, 80) || undefined,
        errorCode: asText(json?.errorCode || `HTTP_${res.status}`, 120) || `HTTP_${res.status}`,
        errorMessage: asText(json?.errorMessage || json?.error || "", 220) || `HTTP_${res.status}`,
      };
    }

    return {
      ok: Boolean(json?.ok && replyText),
      replyText,
      source,
      model: asText(json?.model, 80) || undefined,
      errorCode: asText(json?.errorCode, 120) || undefined,
      errorMessage: asText(json?.errorMessage || json?.error, 220) || undefined,
    };
  } catch (e) {
    return {
      ok: false,
      replyText: "",
      source: "error",
      errorCode: "AI_REPLY_REQUEST_FAILED",
      errorMessage: e instanceof Error ? e.message : "AI_REPLY_REQUEST_FAILED",
    };
  } finally {
    clearTimeout(timeout);
  }
}
