"use strict";

const express = require("express");

const PORT = Number(process.env.AI_REPLY_WORKER_PORT || 3002);
const OLLAMA_BASE_URL = String(process.env.AI_REPLY_OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim().replace(/\/+$/, "");
const OLLAMA_MODEL = String(process.env.AI_REPLY_OLLAMA_MODEL || "gemma3:1b-it-qat").trim() || "gemma3:1b-it-qat";
const DEFAULT_TIMEOUT_MS = Number(process.env.AI_REPLY_TIMEOUT_MS || 12000);
const MAX_TEXT_LEN = Number(process.env.AI_REPLY_MAX_REPLY_LEN || 120);
const MAX_REPLY_LINES = Number.isFinite(Number(process.env.AI_REPLY_MAX_LINES))
  ? Math.max(1, Math.min(4, Math.trunc(Number(process.env.AI_REPLY_MAX_LINES))))
  : 2;
const OLLAMA_NUM_CTX = Number.isFinite(Number(process.env.AI_REPLY_NUM_CTX))
  ? Math.max(256, Math.min(2048, Math.trunc(Number(process.env.AI_REPLY_NUM_CTX))))
  : 320;
const OLLAMA_NUM_PREDICT = Number.isFinite(Number(process.env.AI_REPLY_NUM_PREDICT))
  ? Math.max(16, Math.min(96, Math.trunc(Number(process.env.AI_REPLY_NUM_PREDICT))))
  : 18;
const OLLAMA_NUM_THREAD = Number.isFinite(Number(process.env.AI_REPLY_NUM_THREAD))
  ? Math.max(1, Math.min(16, Math.trunc(Number(process.env.AI_REPLY_NUM_THREAD))))
  : 3;

function sanitizeText(v, maxLen = MAX_TEXT_LEN) {
  return String(v || "").replace(/\s+/g, " ").trim().slice(0, Math.max(1, Math.trunc(Number(maxLen) || MAX_TEXT_LEN)));
}

function sanitizeReplyText(v, maxLen = MAX_TEXT_LEN, maxLines = MAX_REPLY_LINES) {
  const hardLen = Math.max(1, Math.trunc(Number(maxLen) || MAX_TEXT_LEN));
  const hardLines = Math.max(1, Math.min(4, Math.trunc(Number(maxLines) || MAX_REPLY_LINES)));
  const raw = String(v || "").replace(/\r/g, "").trim();
  if (!raw) return "";

  let lines = raw
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    const compact = raw.replace(/\s+/g, " ").trim();
    const sentenceLines = compact
      .split(/(?<=[.!?])\s+/)
      .map((line) => line.trim())
      .filter(Boolean);
    lines = sentenceLines.length > 1 ? sentenceLines : compact ? [compact] : [];
  }

  if (!lines.length) return "";

  const picked = [];
  let remaining = hardLen;
  for (const line of lines.slice(0, hardLines)) {
    const budget = picked.length > 0 ? remaining - 1 : remaining;
    if (budget <= 0) break;
    const clipped = line.slice(0, budget).trim();
    if (!clipped) break;
    picked.push(clipped);
    remaining -= clipped.length + (picked.length > 1 ? 1 : 0);
  }

  return picked.join("\n").trim();
}

async function requestOllama(messages, timeoutMs) {
  if (typeof fetch !== "function") {
    return { ok: false, errorCode: "FETCH_UNAVAILABLE", errorMessage: "FETCH_UNAVAILABLE", replyText: "" };
  }
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const tm = setTimeout(() => {
    try {
      if (ctrl) ctrl.abort();
    } catch {}
  }, timeoutMs);

  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        keep_alive: "30m",
        stream: false,
        messages,
        options: {
          temperature: 0.45,
          top_p: 0.9,
          top_k: 40,
          repeat_penalty: 1.2,
          num_ctx: OLLAMA_NUM_CTX,
          num_predict: OLLAMA_NUM_PREDICT,
          num_thread: OLLAMA_NUM_THREAD,
        },
      }),
      signal: ctrl ? ctrl.signal : undefined,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      return {
        ok: false,
        errorCode: `OLLAMA_HTTP_${res.status}`,
        errorMessage: sanitizeText((json && (json.error || json.message)) || `OLLAMA_HTTP_${res.status}`, 220),
        replyText: "",
      };
    }
    const replyText = sanitizeReplyText(json && json.message && json.message.content, MAX_TEXT_LEN, MAX_REPLY_LINES);
    if (!replyText) {
      return { ok: false, errorCode: "OLLAMA_EMPTY_REPLY", errorMessage: "OLLAMA_EMPTY_REPLY", replyText: "" };
    }
    return {
      ok: true,
      errorCode: "",
      errorMessage: "",
      replyText,
      model: sanitizeText((json && json.model) || OLLAMA_MODEL, 80) || OLLAMA_MODEL,
    };
  } catch (e) {
    const isAbort = e && (e.name === "AbortError" || /abort/i.test(String(e.message || "")));
    return {
      ok: false,
      errorCode: isAbort ? "OLLAMA_TIMEOUT" : "OLLAMA_REQUEST_FAILED",
      errorMessage: sanitizeText((e && e.message) || (isAbort ? "OLLAMA_TIMEOUT" : "OLLAMA_REQUEST_FAILED"), 220),
      replyText: "",
    };
  } finally {
    clearTimeout(tm);
  }
}

const app = express();
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    model: OLLAMA_MODEL,
    baseUrl: OLLAMA_BASE_URL,
  });
});

app.post("/reply", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      return res.status(400).json({
        ok: false,
        errorCode: "AI_MESSAGES_EMPTY",
        errorMessage: "AI_MESSAGES_EMPTY",
      });
    }
    const timeoutMs = Number.isFinite(Number(body.timeoutMs))
      ? Math.max(1000, Math.min(70000, Math.trunc(Number(body.timeoutMs))))
      : Math.max(1000, Math.min(70000, Math.trunc(Number(DEFAULT_TIMEOUT_MS) || 60000)));
    const out = await requestOllama(messages, timeoutMs);
    return res.status(out.ok ? 200 : 502).json(out);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "AI_REPLY_WORKER_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "AI_REPLY_WORKER_FAILED",
      replyText: "",
    });
  }
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`[ai-reply-worker] listening on 127.0.0.1:${PORT} model=${OLLAMA_MODEL}`);
});
