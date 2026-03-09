"use strict";

const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || 4500);
const TRANSLATE_RETRY_COUNT = Number(process.env.TRANSLATE_RETRY_COUNT || 2);

function fallbackSanitize(v, maxLen = 256) {
  return String(v || "").trim().slice(0, Math.max(1, Number(maxLen) || 256));
}

function normalizeLangCode(raw, fallback = "") {
  const clean = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .slice(0, 24);
  if (!clean) return fallback;
  if (!/^[a-z]{2,8}(?:-[a-z0-9]{2,8})?$/.test(clean)) return fallback;
  return clean;
}

function parseTranslatedPayload(payload, sanitizeText) {
  const data = payload && typeof payload === "object" ? payload : null;
  const rows = data && Array.isArray(data[0]) ? data[0] : [];
  const translatedText = rows
    .map((row) => {
      if (!Array.isArray(row)) return "";
      return sanitizeText(row[0] || "", 4000);
    })
    .join("")
    .trim();
  const detectedSourceLang = normalizeLangCode(data && data[2], "");
  return {
    translatedText,
    detectedSourceLang: detectedSourceLang || undefined,
  };
}

async function translateViaGoogleGtx(text, sourceLang, targetLang, sanitizeText) {
  const qs = new URLSearchParams({
    client: "gtx",
    sl: sourceLang || "auto",
    tl: targetLang,
    dt: "t",
    q: text,
  });
  const url = `https://translate.googleapis.com/translate_a/single?${qs.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, TRANSLATE_TIMEOUT_MS));
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`TRANSLATE_UPSTREAM_HTTP_${res.status}`);
  }

  const bodyText = await res.text();
  let json;
  try {
    json = JSON.parse(bodyText || "[]");
  } catch {
    throw new Error("TRANSLATE_UPSTREAM_PARSE_FAILED");
  }

  const parsed = parseTranslatedPayload(json, sanitizeText);
  if (!parsed.translatedText) {
    throw new Error("TRANSLATE_EMPTY_RESULT");
  }
  return parsed;
}

async function translateWithRetry(text, sourceLang, targetLang, sanitizeText) {
  const attempts = Math.max(1, Math.min(4, Math.trunc(Number(TRANSLATE_RETRY_COUNT) || 2)));
  let lastError = null;
  const sourceLangCandidates = sourceLang && sourceLang !== "auto" ? [sourceLang, "auto"] : ["auto"];

  for (const sourceCandidate of sourceLangCandidates) {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await translateViaGoogleGtx(text, sourceCandidate, targetLang, sanitizeText);
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error("TRANSLATE_FAILED");
}

function mountRealtimeTranslateRoutes(app, deps) {
  const d = deps && typeof deps === "object" ? deps : {};
  const sanitizeText = typeof d.sanitizeText === "function" ? d.sanitizeText : fallbackSanitize;

  async function handler(req, res) {
    try {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      const authHeader = sanitizeText(req.headers.authorization || "", 1800);
      const userId = sanitizeText(body.userId || req.headers["x-user-id"] || "", 128);
      const deviceKey = sanitizeText(body.deviceKey || req.headers["x-device-key"] || "", 256);
      const text = sanitizeText(body.text || "", 4000);
      const targetLang = normalizeLangCode(body.targetLang || req.headers["x-target-lang"], "");
      const sourceLang = normalizeLangCode(body.sourceLang || req.headers["x-source-lang"], "auto");

      if (!authHeader && !userId && !deviceKey) {
        return res.status(401).json({ ok: false, errorCode: "AUTH_REQUIRED", errorMessage: "AUTH_REQUIRED" });
      }
      if (!text) {
        return res.status(400).json({ ok: false, errorCode: "TEXT_REQUIRED", errorMessage: "TEXT_REQUIRED" });
      }
      if (!targetLang) {
        return res.status(400).json({ ok: false, errorCode: "TARGET_LANG_REQUIRED", errorMessage: "TARGET_LANG_REQUIRED" });
      }

      if (sourceLang && sourceLang !== "auto" && sourceLang === targetLang) {
        return res.status(200).json({
          ok: true,
          translatedText: text,
          detectedSourceLang: sourceLang,
          provider: "short_circuit",
        });
      }

      const out = await translateWithRetry(text, sourceLang || "auto", targetLang, sanitizeText);
      return res.status(200).json({
        ok: true,
        translatedText: out.translatedText,
        detectedSourceLang: out.detectedSourceLang,
        provider: "google_gtx",
      });
    } catch (e) {
      const message = sanitizeText((e && e.message) || e || "TRANSLATE_FAILED", 220) || "TRANSLATE_FAILED";
      return res.status(502).json({
        ok: false,
        errorCode: "TRANSLATE_FAILED",
        errorMessage: message,
      });
    }
  }

  [
    "/api/translate/chat",
    "/translate/chat",
    "/api/chat/translate",
    "/chat/translate",
    "/api/translate/realtime",
    "/translate/realtime",
  ].forEach((p) => {
    app.post(p, handler);
  });

  return {
    routes: [
      "/api/translate/chat",
      "/translate/chat",
      "/api/chat/translate",
      "/chat/translate",
      "/api/translate/realtime",
      "/translate/realtime",
    ],
  };
}

module.exports = {
  mountRealtimeTranslateRoutes,
};
