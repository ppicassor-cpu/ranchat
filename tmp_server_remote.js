"use strict";

const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const crypto = require("crypto");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { mountSocialAuth } = require("./social_auth");
const { mountShopPurchaseRoutes } = require("./shop_db");

const PORT = Number(process.env.PORT || 3001);

const app = express();
app.use(cors({ origin: "*" }));

app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false }));

const BIND_SECRET = String(process.env.BIND_SECRET || "ranchat_bind_v1").trim();

function deriveBindHash(deviceKey) {
  return crypto.createHmac("sha256", BIND_SECRET).update(String(deviceKey)).digest("hex");
}

const PROFILE_STORE_DIR = process.env.PROFILE_STORE_DIR
  ? String(process.env.PROFILE_STORE_DIR).trim()
  : path.join(__dirname, "data");
const PROFILE_STORE_PATH = process.env.PROFILE_STORE_PATH
  ? String(process.env.PROFILE_STORE_PATH).trim()
  : path.join(PROFILE_STORE_DIR, "profiles.json");
const PROFILE_SAVE_DEBOUNCE_MS = Number(process.env.PROFILE_SAVE_DEBOUNCE_MS || 500);

const POPTALK_TIMEZONE = "Asia/Seoul";
const POPTALK_REGEN_INTERVAL_MS = 5 * 60 * 1000;
const POPTALK_IDEMPOTENCY_LIMIT = Number(process.env.POPTALK_IDEMPOTENCY_LIMIT || 200);
const POPTALK_PLAN_CONFIGS = {
  free: { cap: 1000, regenPerTick: 60 },
  monthly: { cap: 2000, regenPerTick: 200 },
  yearly: { cap: 5000, regenPerTick: 200 },
};

let profileStore = { users: {}, dinoRankEntries: [], popTalkWallets: {} };
let persistTimer = null;

function sanitizeText(v, maxLen = 60) {
  return String(v || "").trim().slice(0, maxLen);
}

function parseBearer(req) {
  const h = String(req.headers.authorization || "").trim();
  if (!h) return "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? String(m[1] || "").trim() : "";
}

function anonymizeKey(v) {
  const raw = String(v || "").trim();
  if (!raw) return "";
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function computeProfileId(req, body) {
  const b = body || {};
  const token = parseBearer(req);
  const userId = sanitizeText(b.userId || req.headers["x-user-id"] || "", 128);
  const deviceKey = sanitizeText(b.deviceKey || req.headers["x-device-key"] || "", 256);

  if (userId) return "u:" + userId;
  if (deviceKey) return "d:" + anonymizeKey(deviceKey);
  if (token) return "t:" + anonymizeKey(token);

  const ip = sanitizeText((req.ip || (req.socket && req.socket.remoteAddress) || ""), 128);
  if (ip) return "ip:" + ip;

  return "";
}

function normalizeBooleanLike(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s) return null;
  if (s === "1" || s === "true" || s === "yes" || s === "y" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "n" || s === "off") return false;
  return null;
}

function parsePopTalkPlan(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("year") || s.includes("annual")) return "yearly";
  if (s.includes("month")) return "monthly";
  if (s.includes("week")) return "monthly";
  if (s.includes("premium") || s.includes("paid") || s.includes("pro") || s.includes("subscriber")) return "monthly";
  if (s.includes("free") || s.includes("basic")) return "free";
  if (s === "yearly" || s === "monthly" || s === "free") return s;
  return null;
}

function normalizePopTalkPlan(raw) {
  return parsePopTalkPlan(raw) || "free";
}

function resolvePopTalkPlanHint(req, body) {
  const b = body || {};
  const candidates = [
    b.plan,
    b.planId,
    b.tier,
    b.subscription,
    b.storeProductId,
    req.headers["x-plan-id"],
    req.headers["x-plan"],
    req.headers["x-store-product-id"],
  ];
  for (const c of candidates) {
    const parsed = parsePopTalkPlan(c);
    if (parsed) return parsed;
  }
  const premiumHint = normalizeBooleanLike(b.isPremium ?? req.headers["x-is-premium"]);
  if (premiumHint === true) return "monthly";
  if (premiumHint === false) return "free";
  return null;
}

function getPopTalkPlanConfig(plan) {
  const normalized = normalizePopTalkPlan(plan);
  return POPTALK_PLAN_CONFIGS[normalized] || POPTALK_PLAN_CONFIGS.free;
}

function getKstDateKey(tsMs) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: POPTALK_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(tsMs));
  } catch {
    const d = new Date(tsMs + 9 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
}

function buildPopTalkSnapshot(wallet, atMs) {
  const nowMs = Number.isFinite(Number(atMs)) ? Math.trunc(Number(atMs)) : now();
  const cap = Math.max(1, Math.trunc(Number(wallet && wallet.cap)));
  const balance = Math.max(0, Math.min(cap, Math.trunc(Number(wallet && wallet.balance))));
  return {
    balance,
    cap,
    plan: normalizePopTalkPlan(wallet && wallet.plan),
    serverNowMs: nowMs,
  };
}

function trimPopTalkIdempotency(wallet) {
  if (!wallet || !wallet.idempotency || typeof wallet.idempotency !== "object") return;
  const entries = Object.entries(wallet.idempotency);
  if (entries.length <= POPTALK_IDEMPOTENCY_LIMIT) return;
  entries.sort((a, b) => Number((b[1] && b[1].at) || 0) - Number((a[1] && a[1].at) || 0));
  wallet.idempotency = Object.fromEntries(entries.slice(0, POPTALK_IDEMPOTENCY_LIMIT));
}

function getPopTalkIdempotencyRecord(wallet, key, kind) {
  const idemKey = sanitizeText(key, 128);
  if (!idemKey) return null;
  const map = wallet && wallet.idempotency && typeof wallet.idempotency === "object" ? wallet.idempotency : null;
  if (!map) return null;
  const rec = map[idemKey];
  if (!rec || rec.kind !== kind || !rec.response) return null;
  const statusRaw = Number(rec.status);
  const status = Number.isFinite(statusRaw) ? Math.max(100, Math.trunc(statusRaw)) : 200;
  return { status, response: rec.response };
}

function savePopTalkIdempotencyRecord(wallet, key, kind, status, response) {
  const idemKey = sanitizeText(key, 128);
  if (!idemKey || !wallet) return;
  if (!wallet.idempotency || typeof wallet.idempotency !== "object") wallet.idempotency = {};
  wallet.idempotency[idemKey] = {
    kind,
    status: Number.isFinite(Number(status)) ? Math.max(100, Math.trunc(Number(status))) : 200,
    response: response && typeof response === "object" ? response : null,
    at: now(),
  };
  trimPopTalkIdempotency(wallet);
  schedulePersistProfileStore();
}

function ensurePopTalkWallet(req, body, options) {
  const opts = options || {};
  const allowPlanHint = opts.allowPlanHint !== false;

  const profileId = computeProfileId(req, body);
  if (!profileId) return { wallet: null, profileId: "", changed: false, errorCode: "profile_id_required" };

  if (!profileStore.popTalkWallets || typeof profileStore.popTalkWallets !== "object") {
    profileStore.popTalkWallets = {};
  }

  const ts = now();
  const todayKst = getKstDateKey(ts);
  const tickNow = Math.trunc(ts / POPTALK_REGEN_INTERVAL_MS);

  let wallet = profileStore.popTalkWallets[profileId];
  let changed = false;

  const hintedPlan = allowPlanHint ? resolvePopTalkPlanHint(req, body) : null;

  if (!wallet || typeof wallet !== "object") {
    const initialPlan = hintedPlan || "free";
    const cfg = getPopTalkPlanConfig(initialPlan);
    wallet = {
      profileId,
      plan: initialPlan,
      cap: cfg.cap,
      balance: cfg.cap,
      updatedAt: ts,
      lastDailyResetKst: todayKst,
      lastRegenTick: tickNow,
      idempotency: {},
    };
    profileStore.popTalkWallets[profileId] = wallet;
    schedulePersistProfileStore();
    return { wallet, profileId, changed: true, errorCode: "" };
  }

  if (!wallet.idempotency || typeof wallet.idempotency !== "object") {
    wallet.idempotency = {};
    changed = true;
  }

  const currentPlan = normalizePopTalkPlan(wallet.plan);
  const nextPlan = hintedPlan || currentPlan;
  const cfg = getPopTalkPlanConfig(nextPlan);
  const regenCap = cfg.cap;

  if (wallet.plan !== nextPlan) {
    wallet.plan = nextPlan;
    changed = true;
  }

  const prevCapRaw = Number(wallet.cap);
  const prevCap = Number.isFinite(prevCapRaw) ? Math.max(1, Math.trunc(prevCapRaw)) : regenCap;
  const prevBalanceRaw = Number(wallet.balance);
  const normalizedBalance = Number.isFinite(prevBalanceRaw) ? Math.max(0, Math.trunc(prevBalanceRaw)) : prevCap;
  if (wallet.balance !== normalizedBalance) {
    wallet.balance = normalizedBalance;
    changed = true;
  }

  const displayCap = Math.max(regenCap, prevCap, wallet.balance);
  if (wallet.cap !== displayCap) {
    wallet.cap = displayCap;
    changed = true;
  }

  const lastDaily = sanitizeText(wallet.lastDailyResetKst || "", 16);
  if (!lastDaily) {
    wallet.lastDailyResetKst = todayKst;
    changed = true;
  }

  const tickRaw = Number(wallet.lastRegenTick);
  const normalizedTick = Number.isFinite(tickRaw) ? Math.max(0, Math.trunc(tickRaw)) : tickNow;
  if (wallet.lastRegenTick !== normalizedTick) {
    wallet.lastRegenTick = normalizedTick;
    changed = true;
  }

  if (wallet.lastDailyResetKst !== todayKst) {
    const resetBalance = Math.max(wallet.balance, regenCap);
    if (resetBalance !== wallet.balance) {
      wallet.balance = resetBalance;
    }
    const nextCapAfterReset = Math.max(regenCap, wallet.cap, wallet.balance);
    if (nextCapAfterReset !== wallet.cap) {
      wallet.cap = nextCapAfterReset;
    }
    wallet.lastDailyResetKst = todayKst;
    wallet.lastRegenTick = tickNow;
    changed = true;
  } else if (tickNow > wallet.lastRegenTick) {
    const deltaTicks = tickNow - wallet.lastRegenTick;
    const regenGain = deltaTicks * cfg.regenPerTick;
    const nextBalance = wallet.balance >= regenCap ? wallet.balance : Math.min(regenCap, wallet.balance + regenGain);
    if (nextBalance !== wallet.balance) {
      wallet.balance = nextBalance;
    }
    const nextCapAfterRegen = Math.max(regenCap, wallet.cap, wallet.balance);
    if (nextCapAfterRegen !== wallet.cap) {
      wallet.cap = nextCapAfterRegen;
    }
    wallet.lastRegenTick = tickNow;
    changed = true;
  }

  trimPopTalkIdempotency(wallet);

  if (changed) {
    wallet.updatedAt = ts;
    schedulePersistProfileStore();
  }

  return { wallet, profileId, changed, errorCode: "" };
}

function ensureStoreDir() {
  try {
    fs.mkdirSync(PROFILE_STORE_DIR, { recursive: true });
  } catch (e) {
    console.error("[profile-sync] ensureStoreDir failed:", e && e.message ? e.message : e);
  }
}

function loadProfileStore() {
  ensureStoreDir();
  try {
    if (!fs.existsSync(PROFILE_STORE_PATH)) {
      profileStore = { users: {}, dinoRankEntries: [], popTalkWallets: {} };
      return;
    }

    const raw = fs.readFileSync(PROFILE_STORE_PATH, "utf8");
    const json = JSON.parse(raw);
    const users = json && typeof json === "object" && json.users && typeof json.users === "object" ? json.users : {};
    const dinoRankEntries =
      json &&
      typeof json === "object" &&
      Array.isArray(json.dinoRankEntries)
        ? json.dinoRankEntries
            .map((it) => {
              const scoreRaw = Number(it && it.score);
              const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.trunc(scoreRaw)) : 0;
              const profileId = sanitizeText(it && it.profileId, 160);
              const flag = sanitizeText(it && it.flag, 8);
              const comment = sanitizeText(it && it.comment, 60);
              const country = sanitizeText(it && it.country, 2).toUpperCase();
              const obtainedAtRaw = Number((it && (it.obtainedAt || it.achievedAt)) || 0);
              const obtainedAt = Number.isFinite(obtainedAtRaw) ? Math.max(0, Math.trunc(obtainedAtRaw)) : 0;
              const createdAtRaw = Number((it && it.createdAt) || 0);
              const createdAt = Number.isFinite(createdAtRaw) ? Math.max(0, Math.trunc(createdAtRaw)) : now();
              const clientEntryId = sanitizeText(it && it.clientEntryId, 128);
              if (!score) return null;
              return {
                entryId: sanitizeText(it && it.entryId, 128) || `e_${createdAt}_${Math.random().toString(16).slice(2, 10)}`,
                profileId,
                score,
                flag,
                comment,
                country,
                obtainedAt,
                createdAt,
                clientEntryId,
              };
            })
            .filter(Boolean)
        : [];
    const popTalkWalletsRaw = json && typeof json === "object" && json.popTalkWallets && typeof json.popTalkWallets === "object" ? json.popTalkWallets : {};
    const popTalkWallets = {};
    Object.entries(popTalkWalletsRaw).forEach(([profileIdRaw, walletRaw]) => {
      const profileId = sanitizeText(profileIdRaw, 160);
      if (!profileId) return;

      const plan = normalizePopTalkPlan(walletRaw && (walletRaw.plan || walletRaw.planId || walletRaw.tier || walletRaw.subscription));
      const cfg = getPopTalkPlanConfig(plan);

      const capRaw = Number(walletRaw && walletRaw.cap);
      const storedCap = Number.isFinite(capRaw) ? Math.max(1, Math.trunc(capRaw)) : cfg.cap;

      const balanceRaw = Number(walletRaw && walletRaw.balance);
      const balance = Number.isFinite(balanceRaw) ? Math.max(0, Math.trunc(balanceRaw)) : storedCap;
      const displayCap = Math.max(cfg.cap, storedCap, balance);

      const updatedAtRaw = Number(walletRaw && walletRaw.updatedAt);
      const updatedAt = Number.isFinite(updatedAtRaw) ? Math.max(0, Math.trunc(updatedAtRaw)) : now();

      const lastDailyResetKstRaw = sanitizeText(walletRaw && walletRaw.lastDailyResetKst, 16);
      const lastDailyResetKst = lastDailyResetKstRaw || getKstDateKey(updatedAt);

      const lastRegenTickRaw = Number(walletRaw && walletRaw.lastRegenTick);
      const lastRegenTick = Number.isFinite(lastRegenTickRaw)
        ? Math.max(0, Math.trunc(lastRegenTickRaw))
        : Math.trunc(updatedAt / POPTALK_REGEN_INTERVAL_MS);

      const idempotencyRaw = walletRaw && walletRaw.idempotency && typeof walletRaw.idempotency === "object" ? walletRaw.idempotency : {};
      const idempotency = {};
      Object.entries(idempotencyRaw).forEach(([idemKeyRaw, recRaw]) => {
        const idemKey = sanitizeText(idemKeyRaw, 128);
        if (!idemKey) return;
        const kind = String((recRaw && recRaw.kind) || "").trim();
        if (kind !== "consume" && kind !== "reward") return;

        const statusRaw = Number(recRaw && recRaw.status);
        const status = Number.isFinite(statusRaw) ? Math.max(100, Math.trunc(statusRaw)) : 200;

        const atRaw = Number(recRaw && recRaw.at);
        const at = Number.isFinite(atRaw) ? Math.max(0, Math.trunc(atRaw)) : 0;

        const response = recRaw && typeof recRaw.response === "object" ? recRaw.response : null;
        if (!response) return;

        idempotency[idemKey] = { kind, status, response, at };
      });

      const wallet = {
        profileId,
        plan,
        cap: displayCap,
        balance: balance,
        updatedAt,
        lastDailyResetKst,
        lastRegenTick,
        idempotency,
      };

      trimPopTalkIdempotency(wallet);
      popTalkWallets[profileId] = wallet;
    });

    profileStore = { users, dinoRankEntries, popTalkWallets };
  } catch (e) {
    console.error("[profile-sync] load failed:", e && e.message ? e.message : e);
    profileStore = { users: {}, dinoRankEntries: [], popTalkWallets: {} };
  }
}

function persistProfileStoreNow() {
  ensureStoreDir();
  const tmpPath = PROFILE_STORE_PATH + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(profileStore, null, 2), "utf8");
    fs.renameSync(tmpPath, PROFILE_STORE_PATH);
  } catch (e) {
    console.error("[profile-sync] persist failed:", e && e.message ? e.message : e);
  }
}

function schedulePersistProfileStore() {
  try {
    if (persistTimer) clearTimeout(persistTimer);
  } catch {}

  persistTimer = setTimeout(() => {
    persistTimer = null;
    persistProfileStoreNow();
  }, PROFILE_SAVE_DEBOUNCE_MS);
}

function upsertProfile(req, body) {
  const profileId = computeProfileId(req, body);
  if (!profileId) return null;

  const b = body || {};
  const country = sanitizeText(b.country || (b.profile && b.profile.country) || "", 2).toUpperCase();
  const language = sanitizeText(b.language || (b.profile && b.profile.language) || "", 32);
  const gender = sanitizeText(b.gender || (b.profile && b.profile.gender) || "", 32);
  const flag = sanitizeText(b.flag || (b.profile && b.profile.flag) || "", 8);
  const comment = sanitizeText(
    b.dinoBestComment || b.comment || b.oneLineComment || (b.profile && (b.profile.comment || b.profile.oneLineComment)) || "",
    60
  );

  const scoreRaw = Number(b.dinoBestScore || (b.stats && b.stats.dinoBestScore) || b.bestScore || b.score || 0);
  const nextBest = Number.isFinite(scoreRaw) ? Math.max(0, Math.trunc(scoreRaw)) : 0;

  const prev = profileStore.users[profileId] || {};
  const prevBest = Number(prev.dinoBestScore || 0);

  const merged = {
    profileId: profileId,
    country: country || prev.country || "",
    language: language || prev.language || "",
    gender: gender || prev.gender || "",
    flag: flag || prev.flag || "",
    dinoBestScore: Math.max(prevBest, nextBest),
    dinoBestComment: comment || prev.dinoBestComment || "",
    updatedAt: now(),
  };

  profileStore.users[profileId] = merged;
  schedulePersistProfileStore();

  return merged;
}

function extractRankEntryBody(body) {
  const b = body || {};
  if (b.entry && typeof b.entry === "object") return b.entry;
  return b;
}

function appendDinoRankEntry(req, body) {
  const profileId = computeProfileId(req, body);
  if (!profileId) return null;

  const base = body || {};
  const e = extractRankEntryBody(base);

  const scoreRaw =
    Number(e.score) ||
    Number(base.score) ||
    Number(base.dinoBestScore) ||
    Number((base.stats && base.stats.dinoBestScore) || 0);
  const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.trunc(scoreRaw)) : 0;
  if (score <= 0) return null;

  const country = sanitizeText(e.country || base.country || "", 2).toUpperCase();
  const flag = sanitizeText(e.flag || base.flag || "", 8);
  const comment = sanitizeText(e.comment || base.comment || base.dinoBestComment || base.oneLineComment || "", 60);
  const obtainedAtRaw = Number(e.obtainedAt || e.achievedAt || base.obtainedAt || base.achievedAt || now());
  const obtainedAt = Number.isFinite(obtainedAtRaw) ? Math.max(0, Math.trunc(obtainedAtRaw)) : now();
  const clientEntryId = sanitizeText(e.clientEntryId || base.clientEntryId || "", 128);
  const createdAt = now();

  const entries = Array.isArray(profileStore.dinoRankEntries) ? profileStore.dinoRankEntries : [];

  if (clientEntryId) {
    const duplicate = entries.find((it) => it && it.profileId === profileId && it.clientEntryId === clientEntryId);
    if (duplicate) return duplicate;
  }

  const next = {
    entryId: `e_${createdAt}_${Math.random().toString(16).slice(2, 10)}`,
    profileId,
    score,
    flag,
    comment,
    country,
    obtainedAt,
    createdAt,
    clientEntryId,
  };

  entries.push(next);
  // Keep history bounded to avoid unbounded growth while preserving enough records.
  if (entries.length > 5000) {
    entries.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    entries.splice(0, entries.length - 5000);
  }
  profileStore.dinoRankEntries = entries;
  schedulePersistProfileStore();

  return next;
}

function buildLeaderboard(limit = 10) {
  const entries = Array.isArray(profileStore.dinoRankEntries) ? profileStore.dinoRankEntries : [];
  return entries
    .map((it) => {
      const scoreRaw = Number(it && it.score);
      const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.trunc(scoreRaw)) : 0;
      const obtainedAtRaw = Number((it && (it.obtainedAt || it.achievedAt)) || 0);
      const obtainedAt = Number.isFinite(obtainedAtRaw) ? Math.max(0, Math.trunc(obtainedAtRaw)) : Number.MAX_SAFE_INTEGER;
      const createdAtRaw = Number((it && it.createdAt) || 0);
      const createdAt = Number.isFinite(createdAtRaw) ? Math.max(0, Math.trunc(createdAtRaw)) : Number.MAX_SAFE_INTEGER;
      return {
        score,
        flag: sanitizeText((it && it.flag) || "", 8),
        comment: sanitizeText((it && it.comment) || "", 60),
        obtainedAt,
        createdAt,
      };
    })
    .filter((it) => it.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.obtainedAt !== b.obtainedAt) return a.obtainedAt - b.obtainedAt;
      return a.createdAt - b.createdAt;
    })
    .slice(0, Math.max(1, limit))
    .map((it, idx) => ({
      rank: idx + 1,
      score: it.score,
      flag: it.flag,
      comment: it.comment,
    }));
}

loadProfileStore();

const __deviceBindHandler = (req, res) => {
  const body = req.body || {};
  const deviceKey = String(body.deviceKey || "").trim();
  const platform = String(body.platform || "").trim();

  if (!deviceKey) return res.status(400).json({ error: "deviceKey_required" });

  const h = deriveBindHash(deviceKey);
  const userId = `u_${h.slice(0, 24)}`;
  const token = `t_${h}`;

  return res.status(200).json({ token, userId, platform });
};

app.post("/api/bind", __deviceBindHandler);
app.post("/bind", __deviceBindHandler);
app.post("/api/device/bind", __deviceBindHandler);
app.post("/device/bind", __deviceBindHandler);

mountSocialAuth(app, { deriveBindHash });

const __profileSyncHandler = (req, res) => {
  try {
    const saved = upsertProfile(req, req.body || {});
    if (!saved) {
      return res.status(400).json({ ok: false, error: "profile_id_required" });
    }

    return res.status(200).json({
      ok: true,
      dinoBestScore: saved.dinoBestScore,
      dinoBestComment: saved.dinoBestComment || null,
      country: saved.country || null,
      language: saved.language || null,
      gender: saved.gender || null,
      flag: saved.flag || null,
      updatedAt: saved.updatedAt,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "profile_sync_failed", detail: String((e && e.message) || e) });
  }
};

[
  "/api/profile/sync",
  "/profile/sync",
  "/api/profile",
  "/profile",
  "/api/user/profile",
  "/api/users/me/profile",
  "/api/me/profile",
  "/api/user-meta",
  "/api/user/meta",
].forEach((p) => {
  app.post(p, __profileSyncHandler);
  app.put(p, __profileSyncHandler);
  app.patch(p, __profileSyncHandler);
});

const __dinoLeaderboardSubmitHandler = (req, res) => {
  try {
    const saved = appendDinoRankEntry(req, req.body || {});
    if (!saved) {
      return res.status(400).json({ ok: false, error: "rank_entry_required" });
    }
    return res.status(200).json({ ok: true, entryId: saved.entryId, score: saved.score });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "rank_submit_failed", detail: String((e && e.message) || e) });
  }
};

[
  "/api/dino/leaderboard/submit",
  "/api/dino/leaderboard/entry",
  "/api/dino/leaderboard",
  "/api/leaderboard/dino/submit",
  "/api/leaderboard/dino/entry",
  "/api/leaderboard/dino",
  "/leaderboard/dino/submit",
  "/leaderboard/dino/entry",
  "/leaderboard/dino",
].forEach((p) => {
  app.post(p, __dinoLeaderboardSubmitHandler);
  app.put(p, __dinoLeaderboardSubmitHandler);
});

const __dinoLeaderboardHandler = (_req, res) => {
  const items = buildLeaderboard(10);
  return res.status(200).json({ items: items });
};

app.get("/api/dino/leaderboard", __dinoLeaderboardHandler);
app.get("/api/leaderboard/dino", __dinoLeaderboardHandler);
app.get("/api/leaderboards/dino", __dinoLeaderboardHandler);
app.get("/leaderboard/dino", __dinoLeaderboardHandler);
app.get("/api/leaderboard", (req, res) => {
  const game = String(req.query.game || "").trim().toLowerCase();
  if (game !== "dino") {
    return res.status(404).json({ error: "not_found" });
  }
  return __dinoLeaderboardHandler(req, res);
});

const __popTalkStateHandler = (req, res) => {
  try {
    const input = { ...(req.query || {}), ...(req.body || {}) };
    const ensured = ensurePopTalkWallet(req, input);
    if (!ensured.wallet) {
      return res.status(400).json({ ok: false, code: ensured.errorCode || "profile_id_required" });
    }

    return res.status(200).json({
      ok: true,
      data: buildPopTalkSnapshot(ensured.wallet),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, code: "POPTALK_STATE_FAILED", detail: String((e && e.message) || e) });
  }
};

const __popTalkConsumeHandler = (req, res) => {
  try {
    const body = req.body || {};
    const amountRaw = Number(body.amount);
    const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.trunc(amountRaw)) : 0;
    if (amount <= 0) {
      return res.status(400).json({ ok: false, code: "INVALID_AMOUNT", message: "INVALID_AMOUNT" });
    }

    const ensured = ensurePopTalkWallet(req, body);
    if (!ensured.wallet) {
      return res.status(400).json({ ok: false, code: ensured.errorCode || "profile_id_required" });
    }

    const wallet = ensured.wallet;
    const idempotencyKey = sanitizeText(body.idempotencyKey || req.headers["x-idempotency-key"] || "", 128);
    const idemHit = getPopTalkIdempotencyRecord(wallet, idempotencyKey, "consume");
    if (idemHit) {
      return res.status(idemHit.status).json(idemHit.response);
    }

    if (wallet.balance < amount) {
      const response = {
        ok: false,
        code: "INSUFFICIENT_BALANCE",
        message: "INSUFFICIENT_BALANCE",
        data: buildPopTalkSnapshot(wallet),
      };
      savePopTalkIdempotencyRecord(wallet, idempotencyKey, "consume", 409, response);
      return res.status(409).json(response);
    }

    wallet.balance = Math.max(0, wallet.balance - amount);
    wallet.updatedAt = now();
    schedulePersistProfileStore();

    const response = {
      ok: true,
      consumed: amount,
      reason: sanitizeText(body.reason || "consume", 64),
      data: buildPopTalkSnapshot(wallet),
    };
    savePopTalkIdempotencyRecord(wallet, idempotencyKey, "consume", 200, response);
    broadcastUnifiedStateByProfile(ensured.profileId, req, body).catch(() => undefined);
    return res.status(200).json(response);
  } catch (e) {
    return res.status(500).json({ ok: false, code: "POPTALK_CONSUME_FAILED", detail: String((e && e.message) || e) });
  }
};

const __popTalkRewardHandler = (req, res) => {
  try {
    const body = req.body || {};
    const amountRaw = Number(body.amount);
    const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.trunc(amountRaw)) : 0;
    if (amount <= 0) {
      return res.status(400).json({ ok: false, code: "INVALID_AMOUNT", message: "INVALID_AMOUNT" });
    }

    const ensured = ensurePopTalkWallet(req, body);
    if (!ensured.wallet) {
      return res.status(400).json({ ok: false, code: ensured.errorCode || "profile_id_required" });
    }

    const wallet = ensured.wallet;
    const idempotencyKey = sanitizeText(body.idempotencyKey || req.headers["x-idempotency-key"] || "", 128);
    const idemHit = getPopTalkIdempotencyRecord(wallet, idempotencyKey, "reward");
    if (idemHit) {
      return res.status(idemHit.status).json(idemHit.response);
    }

    const before = wallet.balance;
    const rewardCap = getPopTalkPlanConfig(wallet.plan).cap;
    const nextBalance = before >= rewardCap ? before : Math.min(rewardCap, before + amount);
    wallet.balance = Math.max(0, nextBalance);
    wallet.cap = Math.max(rewardCap, wallet.cap, wallet.balance);
    wallet.updatedAt = now();
    schedulePersistProfileStore();

    const response = {
      ok: true,
      rewarded: amount,
      granted: Math.max(0, wallet.balance - before),
      reason: sanitizeText(body.reason || "reward", 64),
      data: buildPopTalkSnapshot(wallet),
    };
    savePopTalkIdempotencyRecord(wallet, idempotencyKey, "reward", 200, response);
    broadcastUnifiedStateByProfile(ensured.profileId, req, body).catch(() => undefined);
    return res.status(200).json(response);
  } catch (e) {
    return res.status(500).json({ ok: false, code: "POPTALK_REWARD_FAILED", detail: String((e && e.message) || e) });
  }
};

["/api/poptalk/state", "/api/poptalk", "/poptalk/state", "/poptalk"].forEach((p) => {
  app.get(p, __popTalkStateHandler);
  app.post(p, __popTalkStateHandler);
});

["/api/poptalk/consume", "/api/poptalk/spend", "/poptalk/consume", "/poptalk/spend"].forEach((p) => {
  app.post(p, __popTalkConsumeHandler);
});

["/api/poptalk/reward", "/api/poptalk/rewarded", "/poptalk/reward", "/poptalk/rewarded"].forEach((p) => {
  app.post(p, __popTalkRewardHandler);
});


const walletSubscribersByProfileId = new Map();
let shopRoutes = null;

function getWalletSubscribers(profileId) {
  const pid = sanitizeText(profileId, 180);
  if (!pid) return null;
  let set = walletSubscribersByProfileId.get(pid);
  if (!set) {
    set = new Set();
    walletSubscribersByProfileId.set(pid, set);
  }
  return set;
}

function detachWalletSubscriber(ws) {
  const pid = sanitizeText(ws && ws._walletProfileId, 180);
  if (!pid) return;
  const set = walletSubscribersByProfileId.get(pid);
  if (!set) {
    ws._walletProfileId = "";
    return;
  }
  set.delete(ws);
  if (set.size === 0) walletSubscribersByProfileId.delete(pid);
  ws._walletProfileId = "";
}

function attachWalletSubscriber(ws, profileId) {
  const pid = sanitizeText(profileId, 180);
  if (!pid) return false;
  detachWalletSubscriber(ws);
  const set = getWalletSubscribers(pid);
  if (!set) return false;
  set.add(ws);
  ws._walletProfileId = pid;
  return true;
}

function buildWsPseudoReq(ws, input) {
  const b = input && typeof input === "object" ? input : {};
  const token = sanitizeText(b.token || "", 4096);
  const userId = sanitizeText(b.userId || "", 128);
  const deviceKey = sanitizeText(b.deviceKey || "", 256);
  const planId = sanitizeText(b.planId || "", 64);
  const storeProductId = sanitizeText(b.storeProductId || "", 120);
  const isPremium = b.isPremium === true ? "1" : b.isPremium === false ? "0" : "";
  const remoteIp = sanitizeText(ws && ws._remoteIp, 128);
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "x-user-id": userId,
      "x-device-key": deviceKey,
      "x-plan-id": planId,
      "x-store-product-id": storeProductId,
      "x-is-premium": isPremium,
    },
    ip: remoteIp,
    socket: {
      remoteAddress: remoteIp,
    },
  };
}

function resolvePopTalkSnapshotForUnified(req, input, profileIdHint) {
  const source = input && typeof input === "object" ? input : {};
  if (profileIdHint) {
    const wallet = profileStore.popTalkWallets && profileStore.popTalkWallets[profileIdHint];
    if (wallet && typeof wallet === "object") {
      const refreshed = ensurePopTalkWallet(req, source, { allowPlanHint: true });
      if (refreshed && refreshed.wallet) return buildPopTalkSnapshot(refreshed.wallet);
      return buildPopTalkSnapshot(wallet);
    }
  }
  const ensured = ensurePopTalkWallet(req, source, { allowPlanHint: true });
  if (!ensured.wallet) return null;
  return buildPopTalkSnapshot(ensured.wallet);
}

function applyKernelToPopTalkFromConvert(input) {
  const payload = input && typeof input === "object" ? input : {};
  const req = payload.req || null;
  const body = payload.body && typeof payload.body === "object" ? payload.body : {};
  const profileIdHint = sanitizeText(payload.profileId || "", 180);
  const convertedRaw = Number(payload.convertedPopTalk);
  const convertedPopTalk = Number.isFinite(convertedRaw) ? Math.max(0, Math.trunc(convertedRaw)) : 0;
  const atMsRaw = Number(payload.atMs);
  const atMs = Number.isFinite(atMsRaw) && atMsRaw > 0 ? Math.trunc(atMsRaw) : now();

  const ensureInput = { ...body };
  if (profileIdHint && !ensureInput.profileId) ensureInput.profileId = profileIdHint;

  const ensured = ensurePopTalkWallet(req, ensureInput, { allowPlanHint: true });
  if (!ensured.wallet) {
    return {
      ok: false,
      error: ensured.errorCode || "profile_id_required",
    };
  }

  const wallet = ensured.wallet;
  const beforeBalance = Number.isFinite(Number(wallet.balance)) ? Math.max(0, Math.trunc(Number(wallet.balance))) : 0;
  const beforeCap = Number.isFinite(Number(wallet.cap)) ? Math.max(1, Math.trunc(Number(wallet.cap))) : 1000;
  const nextBalance = beforeBalance + convertedPopTalk;

  wallet.cap = Math.max(beforeCap, nextBalance);
  wallet.balance = Math.max(0, nextBalance);
  wallet.updatedAt = atMs;
  schedulePersistProfileStore();

  return {
    ok: true,
    profileId: ensured.profileId || profileIdHint || "",
    snapshot: buildPopTalkSnapshot(wallet, atMs),
  };
}

async function sendUnifiedStateToWs(ws, reqLike, input) {
  if (!shopRoutes || typeof shopRoutes.resolveUnifiedStateByRequest !== "function") return;
  try {
    const out = await shopRoutes.resolveUnifiedStateByRequest(reqLike, input || {});
    if (!out || !out.ok) {
      safeSend(ws, { type: "wallet_state_error", reason: (out && out.error) || "wallet_state_failed" });
      return;
    }
    safeSend(ws, {
      type: "wallet_state",
      data: {
        popTalk: out.popTalk || null,
        wallet: out.wallet || { popcornBalance: 0, kernelBalance: 0 },
        serverNowMs: Number.isFinite(Number(out.serverNowMs)) ? Math.trunc(Number(out.serverNowMs)) : now(),
      },
    });
  } catch {
    safeSend(ws, { type: "wallet_state_error", reason: "wallet_state_failed" });
  }
}

async function broadcastUnifiedStateByProfile(profileId, reqLike, input) {
  const pid = sanitizeText(profileId, 180);
  if (!pid) return;
  const set = walletSubscribersByProfileId.get(pid);
  if (!set || set.size === 0) return;

  if (reqLike && input) {
    const targets = Array.from(set);
    for (const ws of targets) {
      if (!isWsAlive(ws)) {
        detachWalletSubscriber(ws);
        continue;
      }
      await sendUnifiedStateToWs(ws, reqLike, input);
    }
    return;
  }

  if (!shopRoutes || typeof shopRoutes.getWalletByProfileId !== "function") return;
  let wallet = null;
  try {
    wallet = await shopRoutes.getWalletByProfileId(pid, now());
  } catch {
    wallet = null;
  }
  const popTalkWallet = profileStore.popTalkWallets && profileStore.popTalkWallets[pid];
  const payload = {
    type: "wallet_state",
    data: {
      popTalk: popTalkWallet ? buildPopTalkSnapshot(popTalkWallet) : null,
      wallet: wallet || { popcornBalance: 0, kernelBalance: 0 },
      serverNowMs: now(),
    },
  };
  const targets = Array.from(set);
  targets.forEach((ws) => {
    if (!isWsAlive(ws)) {
      detachWalletSubscriber(ws);
      return;
    }
    safeSend(ws, payload);
  });
}

shopRoutes = mountShopPurchaseRoutes(app, {
  computeProfileId,
  parseBearer,
  sanitizeText,
  anonymizeKey,
  now: () => Date.now(),
  dataDir: PROFILE_STORE_DIR,
  resolvePopTalkSnapshot: resolvePopTalkSnapshotForUnified,
  applyKernelToPopTalk: applyKernelToPopTalkFromConvert,
  onWalletChanged: (evt) => {
    const pid = sanitizeText(evt && evt.profileId, 180);
    if (!pid) return;
    const reqLike = evt && evt.req ? evt.req : null;
    const input = evt && evt.body ? evt.body : null;
    broadcastUnifiedStateByProfile(pid, reqLike, input).catch(() => undefined);
  },
});

const LOGIN_EVENT_MAX = Number(process.env.LOGIN_EVENT_MAX || 500);
const LOGIN_EVENT_SNAPSHOT_LIMIT = Number(process.env.LOGIN_EVENT_SNAPSHOT_LIMIT || 120);
const LOGIN_ACTIVE_WINDOW_MS = Number(process.env.LOGIN_ACTIVE_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_PRESENCE_MAX = Number(process.env.LOGIN_PRESENCE_MAX || 5000);
const LOGIN_EVENT_CLOCK_SKEW_FUTURE_MS = Number(process.env.LOGIN_EVENT_CLOCK_SKEW_FUTURE_MS || 2 * 60 * 1000);
const LOGIN_EVENT_CLOCK_SKEW_PAST_MS = Number(process.env.LOGIN_EVENT_CLOCK_SKEW_PAST_MS || 365 * 24 * 60 * 60 * 1000);
const loginEvents = [];
const loginEventStreams = new Set();
const loginPresenceBySession = new Map();

function sanitizeLoginMonitorField(v, maxLen = 160) {
  return String(v || "").trim().slice(0, maxLen);
}

function getRequestIp(req) {
  const xff = sanitizeLoginMonitorField(req.headers["x-forwarded-for"] || "", 256);
  if (xff) {
    const first = xff.split(",")[0];
    if (first) return sanitizeLoginMonitorField(first, 128);
  }
  const ip = sanitizeLoginMonitorField(req.ip || (req.socket && req.socket.remoteAddress) || "", 128);
  return ip;
}

function shortHash(v, len = 12) {
  const raw = sanitizeLoginMonitorField(v, 4096);
  if (!raw) return "";
  return anonymizeKey(raw).slice(0, Math.max(6, Math.min(64, Math.trunc(Number(len) || 12))));
}

function toSafeInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function normalizeLoginEventAtMs(rawAtMs, serverAtMs = now()) {
  const serverMsRaw = Number(serverAtMs);
  const serverMs = Number.isFinite(serverMsRaw) && serverMsRaw > 0 ? Math.trunc(serverMsRaw) : now();

  const raw = Number(rawAtMs);
  if (!Number.isFinite(raw) || raw <= 0) return serverMs;

  const atMs = Math.trunc(raw);
  const maxFuture = serverMs + Math.max(0, Math.trunc(Number(LOGIN_EVENT_CLOCK_SKEW_FUTURE_MS) || 0));
  const maxPast = serverMs - Math.max(0, Math.trunc(Number(LOGIN_EVENT_CLOCK_SKEW_PAST_MS) || 0));

  if (atMs > maxFuture) return maxFuture;
  if (atMs < maxPast) return maxPast;
  return atMs;
}

function parseSubscriptionStatus(body) {
  const b = body && typeof body === "object" ? body : {};
  const text = sanitizeLoginMonitorField(b.subscriptionStatus || b.subStatus || "", 24).toLowerCase();
  if (text === "paid" || text === "free") return text;
  const premium = normalizeBooleanLike(b.isPremium);
  if (premium === true) return "paid";
  if (premium === false) return "free";
  return "";
}

function buildLoginEvent(req, body) {
  const b = body && typeof body === "object" ? body : {};
  const serverAtMs = now();
  const atMs = normalizeLoginEventAtMs((b.atMs ?? b.timestamp ?? 0), serverAtMs);

  const profileId = computeProfileId(req, b);
  const userIdByProfile = profileId.startsWith("u:") ? profileId.slice(2) : "";

  const userId = sanitizeLoginMonitorField(b.userId || req.headers["x-user-id"] || userIdByProfile, 128);
  const deviceKey = sanitizeLoginMonitorField(b.deviceKey || req.headers["x-device-key"] || "", 256);

  return {
    eventId: "le_" + serverAtMs + "_" + Math.random().toString(16).slice(2, 10),
    atMs,
    atIso: new Date(atMs).toISOString(),
    serverAtMs,
    serverAtIso: new Date(serverAtMs).toISOString(),
    loginAccount: sanitizeLoginMonitorField(b.loginAccount || b.email || b.account || "", 240).toLowerCase(),
    userId,
    profileId: sanitizeLoginMonitorField(profileId, 180),
    subscriptionStatus: parseSubscriptionStatus(b),
    isPremium: normalizeBooleanLike(b.isPremium),
    planId: sanitizeLoginMonitorField(b.planId || "", 64),
    storeProductId: sanitizeLoginMonitorField(b.storeProductId || "", 120),
    popcornCount: toSafeInt(b.popcornCount ?? b.popTalkCount ?? b.popcorn ?? b.popTalkBalance),
    kernelCount: toSafeInt(b.kernelCount ?? b.kernels),
    totalPaymentKrw: toSafeInt(b.totalPaymentKrw ?? b.cumulativePaymentKrw ?? b.totalPaidKrw),
    provider: sanitizeLoginMonitorField(b.provider || b.authProvider || "unknown", 48),
    platform: sanitizeLoginMonitorField(b.platform || "", 24),
    appVersion: sanitizeLoginMonitorField(b.appVersion || b.version || "", 40),
    country: sanitizeLoginMonitorField(b.country || "", 8).toUpperCase(),
    language: sanitizeLoginMonitorField(b.language || "", 16).toLowerCase(),
    gender: sanitizeLoginMonitorField(b.gender || "", 16).toLowerCase(),
    ip: getRequestIp(req),
    tokenHash: shortHash(parseBearer(req), 16),
    deviceHash: shortHash(deviceKey, 16),
  };
}

function getLoginIdentityKey(event) {
  const userId = sanitizeLoginMonitorField((event && event.userId) || "", 128).toLowerCase();
  if (userId) return "u:" + userId;

  const loginAccount = sanitizeLoginMonitorField((event && event.loginAccount) || "", 240).toLowerCase();
  if (loginAccount) return "a:" + loginAccount;

  const profileId = sanitizeLoginMonitorField((event && event.profileId) || "", 180).toLowerCase();
  if (profileId) return "p:" + profileId;

  const deviceHash = sanitizeLoginMonitorField((event && event.deviceHash) || "", 24);
  if (deviceHash) return "d:" + deviceHash;

  const tokenHash = sanitizeLoginMonitorField((event && event.tokenHash) || "", 24);
  if (tokenHash) return "t:" + tokenHash;

  return "";
}

function getLoginPresenceKey(event) {
  const identity = getLoginIdentityKey(event);
  if (identity) return identity;

  return sanitizeLoginMonitorField(
    (event && (event.profileId || event.userId || event.deviceHash || event.tokenHash || event.eventId)) || "",
    200,
  );
}

function upsertLoginPresence(event) {
  const key = getLoginPresenceKey(event);
  if (!key) return null;

  const prev = loginPresenceBySession.get(key);
  const seenAtRaw = Number(event && (event.serverAtMs ?? event.atMs ?? 0));
  const atMs = Number.isFinite(seenAtRaw) && seenAtRaw > 0 ? Math.trunc(seenAtRaw) : now();
  const prevFirst = Number(prev && prev.firstSeenAtMs ? prev.firstSeenAtMs : 0);
  const prevLast = Number(prev && prev.lastSeenAtMs ? prev.lastSeenAtMs : 0);
  const firstSeenAtMs = prevFirst > 0 ? Math.min(prevFirst, atMs) : atMs;
  const lastSeenAtMs = Math.max(prevLast, atMs);

  const row = {
    sessionKey: key,
    firstSeenAtMs,
    firstSeenAtIso: new Date(firstSeenAtMs).toISOString(),
    lastSeenAtMs,
    atMs: lastSeenAtMs,
    atIso: new Date(lastSeenAtMs).toISOString(),
    loginAccount: sanitizeLoginMonitorField((event && event.loginAccount) || (prev && prev.loginAccount) || "", 240).toLowerCase(),
    userId: sanitizeLoginMonitorField((event && event.userId) || (prev && prev.userId) || "", 128),
    profileId: sanitizeLoginMonitorField((event && event.profileId) || (prev && prev.profileId) || "", 180),
    subscriptionStatus: sanitizeLoginMonitorField((event && event.subscriptionStatus) || (prev && prev.subscriptionStatus) || "", 24).toLowerCase(),
    isPremium: event && event.isPremium != null ? event.isPremium : prev && prev.isPremium != null ? prev.isPremium : null,
    planId: sanitizeLoginMonitorField((event && event.planId) || (prev && prev.planId) || "", 64),
    storeProductId: sanitizeLoginMonitorField((event && event.storeProductId) || (prev && prev.storeProductId) || "", 120),
    popcornCount: toSafeInt(event && event.popcornCount != null ? event.popcornCount : prev && prev.popcornCount),
    kernelCount: toSafeInt(event && event.kernelCount != null ? event.kernelCount : prev && prev.kernelCount),
    totalPaymentKrw: toSafeInt(event && event.totalPaymentKrw != null ? event.totalPaymentKrw : prev && prev.totalPaymentKrw),
    provider: sanitizeLoginMonitorField((event && event.provider) || (prev && prev.provider) || "", 48),
    platform: sanitizeLoginMonitorField((event && event.platform) || (prev && prev.platform) || "", 24),
    appVersion: sanitizeLoginMonitorField((event && event.appVersion) || (prev && prev.appVersion) || "", 40),
    country: sanitizeLoginMonitorField((event && event.country) || (prev && prev.country) || "", 8).toUpperCase(),
    language: sanitizeLoginMonitorField((event && event.language) || (prev && prev.language) || "", 16).toLowerCase(),
    gender: sanitizeLoginMonitorField((event && event.gender) || (prev && prev.gender) || "", 16).toLowerCase(),
    ip: sanitizeLoginMonitorField((event && event.ip) || (prev && prev.ip) || "", 128),
    tokenHash: sanitizeLoginMonitorField((event && event.tokenHash) || (prev && prev.tokenHash) || "", 24),
    deviceHash: sanitizeLoginMonitorField((event && event.deviceHash) || (prev && prev.deviceHash) || "", 24),
  };

  loginPresenceBySession.set(key, row);

  if (loginPresenceBySession.size > LOGIN_PRESENCE_MAX) {
    const rows = Array.from(loginPresenceBySession.entries()).sort((a, b) => {
      return Number((a[1] && a[1].lastSeenAtMs) || 0) - Number((b[1] && b[1].lastSeenAtMs) || 0);
    });
    const removeCount = loginPresenceBySession.size - LOGIN_PRESENCE_MAX;
    for (let i = 0; i < removeCount; i += 1) {
      const entry = rows[i];
      if (entry && entry[0]) loginPresenceBySession.delete(entry[0]);
    }
  }

  return row;
}

function listActiveLoginPresence(limit = LOGIN_EVENT_SNAPSHOT_LIMIT, activeWindowMs = LOGIN_ACTIVE_WINDOW_MS) {
  const hardLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(500, Math.trunc(Number(limit))))
    : LOGIN_EVENT_SNAPSHOT_LIMIT;
  const windowMs = Number.isFinite(Number(activeWindowMs))
    ? Math.max(60 * 1000, Math.trunc(Number(activeWindowMs)))
    : LOGIN_ACTIVE_WINDOW_MS;
  const cutoff = now() - windowMs;

  const rows = Array.from(loginPresenceBySession.values())
    .filter((row) => Number((row && row.lastSeenAtMs) || 0) >= cutoff)
    .sort((a, b) => Number((b && b.lastSeenAtMs) || 0) - Number((a && a.lastSeenAtMs) || 0));

  return rows.length > hardLimit ? rows.slice(0, hardLimit) : rows;
}

function writeSseEvent(res, eventName, payload) {
  try {
    const data = JSON.stringify(payload == null ? {} : payload);
    res.write('event: ' + eventName + '\n');
    res.write('data: ' + data + '\n\n');
  } catch {}
}

function broadcastLoginEvent(event) {
  const dead = [];
  loginEventStreams.forEach((res) => {
    try {
      writeSseEvent(res, 'login', event);
    } catch {
      dead.push(res);
    }
  });
  dead.forEach((res) => loginEventStreams.delete(res));
}

function broadcastLoginPresenceUpdate(session) {
  if (!session) return;
  const dead = [];
  loginEventStreams.forEach((res) => {
    try {
      writeSseEvent(res, 'presence_update', session);
    } catch {
      dead.push(res);
    }
  });
  dead.forEach((res) => loginEventStreams.delete(res));
}

function addLoginEvent(event) {
  loginEvents.push(event);
  if (loginEvents.length > LOGIN_EVENT_MAX) {
    loginEvents.splice(0, loginEvents.length - LOGIN_EVENT_MAX);
  }
  const presence = upsertLoginPresence(event);
  broadcastLoginEvent(event);
  broadcastLoginPresenceUpdate(presence);
}

const __adminLoginEventIngestHandler = (req, res) => {
  try {
    const event = buildLoginEvent(req, req.body || {});
    if (!event.userId && !event.profileId) {
      return res.status(400).json({ ok: false, error: "user_id_required" });
    }

    addLoginEvent(event);
    return res.status(200).json({ ok: true, event, total: loginEvents.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "login_event_ingest_failed", detail: String((e && e.message) || e) });
  }
};

const __adminLoginEventListHandler = (req, res) => {
  const limitRaw = Number(req.query.limit || LOGIN_EVENT_SNAPSHOT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : LOGIN_EVENT_SNAPSHOT_LIMIT;
  const rows = loginEvents.slice(Math.max(0, loginEvents.length - limit)).reverse();
  const sessions = listActiveLoginPresence(limit, LOGIN_ACTIVE_WINDOW_MS);

  return res.status(200).json({
    ok: true,
    serverNowMs: now(),
    total: loginEvents.length,
    totalEvents: loginEvents.length,
    activeTotal: sessions.length,
    connectedTotal: sessions.length,
    activeWindowMs: LOGIN_ACTIVE_WINDOW_MS,
    events: rows,
    sessions,
  });
};

const __adminLoginEventStreamHandler = (req, res) => {
  const limitRaw = Number(req.query.limit || LOGIN_EVENT_SNAPSHOT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : LOGIN_EVENT_SNAPSHOT_LIMIT;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  const sessions = listActiveLoginPresence(limit, LOGIN_ACTIVE_WINDOW_MS);
  writeSseEvent(res, 'hello', {
    ok: true,
    serverNowMs: now(),
    total: loginEvents.length,
    totalEvents: loginEvents.length,
    activeTotal: sessions.length,
    connectedTotal: sessions.length,
    activeWindowMs: LOGIN_ACTIVE_WINDOW_MS,
  });

  const rows = loginEvents.slice(Math.max(0, loginEvents.length - limit));
  writeSseEvent(res, 'snapshot', { ok: true, events: rows });
  writeSseEvent(res, 'presence_snapshot', {
    ok: true,
    activeWindowMs: LOGIN_ACTIVE_WINDOW_MS,
    activeTotal: sessions.length,
    sessions,
  });

  loginEventStreams.add(res);

  const ping = setInterval(() => {
    const fresh = listActiveLoginPresence(limit, LOGIN_ACTIVE_WINDOW_MS);
    writeSseEvent(res, 'ping', { now: now(), activeTotal: fresh.length });
    writeSseEvent(res, 'presence_snapshot', {
      ok: true,
      activeWindowMs: LOGIN_ACTIVE_WINDOW_MS,
      activeTotal: fresh.length,
      sessions: fresh,
    });
  }, 15000);

  req.on('close', () => {
    clearInterval(ping);
    loginEventStreams.delete(res);
  });
};

const __adminLoginMonitorPageHandler = (_req, res) => {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RanChat Login Monitor</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0c1222; color: #eaf0ff; }
    .wrap { max-width: 1320px; margin: 0 auto; padding: 20px 16px 28px; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
    .title { font-size: 20px; font-weight: 800; letter-spacing: .2px; }
    .meta { font-size: 13px; color: #9fb0d9; }
    .pill { display: inline-block; margin-left: 8px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #1c2a4d; color: #b8c8f3; }
    .card { border: 1px solid #213257; border-radius: 12px; overflow: hidden; background: #0f1730; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { background: #142044; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #1b2b50; font-size: 12px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    th { color: #a8bbe9; font-weight: 700; }
    td { color: #e8eeff; }
    tr:nth-child(even) td { background: #0d152b; }
    .ok { color: #74f0b5; }
    .warn { color: #ffd166; }
    .tiny { font-size: 11px; color: #9db0df; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <div class="title">RanChat Login Monitor <span class="pill">Realtime</span></div>
        <div class="meta" id="meta">connecting...</div>
      </div>
      <div class="tiny">open this URL directly in browser</div>
    </div>

    <div class="card">
      <table>
        <thead>
          <tr>
            <th style="width: 165px;">Last Access</th>
            <th style="width: 220px;">Login Account</th>
            <th style="width: 180px;">auth.userId</th>
            <th style="width: 100px;">Sub</th>
            <th style="width: 100px;">Popcorn</th>
            <th style="width: 90px;">Kernel</th>
            <th style="width: 130px;">Total Paid(KRW)</th>
            <th>Provider/Device</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>

  <script>
    var rowsEl = document.getElementById('rows');
    var metaEl = document.getElementById('meta');
    var limit = 200;
    var activeWindowMs = 15 * 60 * 1000;
    var map = new Map();
    var metaState = {
      cls: 'warn',
      label: 'connecting',
      activeTotal: 0,
      totalEvents: 0,
      serverNowMs: 0,
    };

    function esc(v) {
      return String(v == null ? '' : v)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function fmtTime(ms) {
      var n = Number(ms || 0);
      if (!Number.isFinite(n) || n <= 0) return '-';
      var d = new Date(n);
      var yyyy = d.getFullYear();
      var MM = String(d.getMonth() + 1).padStart(2, '0');
      var dd = String(d.getDate()).padStart(2, '0');
      var hh = String(d.getHours()).padStart(2, '0');
      var mm = String(d.getMinutes()).padStart(2, '0');
      var ss = String(d.getSeconds()).padStart(2, '0');
      return yyyy + '-' + MM + '-' + dd + ' ' + hh + ':' + mm + ':' + ss;
    }

    function fmtNum(v) {
      var n = Number(v || 0);
      if (!Number.isFinite(n) || n < 0) n = 0;
      return Math.trunc(n).toLocaleString('ko-KR');
    }

    function normalizeSub(e) {
      var raw = String(e && e.subscriptionStatus || '').toLowerCase();
      if (raw === 'paid' || raw === 'free') return raw;
      if (e && e.isPremium === true) return 'paid';
      if (e && e.isPremium === false) return 'free';
      return '-';
    }

    function keyOf(e) {
      var sessionKey = String(e && e.sessionKey || '').trim();
      if (sessionKey) return 's:' + sessionKey;
      var userId = String(e && e.userId || '').trim().toLowerCase();
      if (userId) return 'u:' + userId;
      var loginAccount = String(e && e.loginAccount || '').trim().toLowerCase();
      if (loginAccount) return 'a:' + loginAccount;
      var profileId = String(e && e.profileId || '').trim().toLowerCase();
      if (profileId) return 'p:' + profileId;
      var deviceHash = String(e && e.deviceHash || '').trim();
      if (deviceHash) return 'd:' + deviceHash;
      var tokenHash = String(e && e.tokenHash || '').trim();
      if (tokenHash) return 't:' + tokenHash;
      return String((e && e.eventId) || '');
    }

    function seenMs(e) {
      var n = Number((e && (e.lastSeenAtMs || e.serverAtMs || e.atMs)) || 0);
      if (!Number.isFinite(n) || n <= 0) return 0;
      return Math.trunc(n);
    }

    function renderMeta() {
      metaEl.innerHTML =
        '<span class="' + esc(metaState.cls || 'warn') + '">' + esc(metaState.label || 'connecting') + '</span>' +
        ' | connected users ' + esc(metaState.activeTotal || 0) +
        ' | latest rows ' + esc(map.size) +
        ' | log records ' + esc(metaState.totalEvents || 0) +
        ' | ' + esc(fmtTime(metaState.serverNowMs || Date.now()));
    }

    function updateMeta(next) {
      if (next && typeof next === 'object') {
        if (next.cls) metaState.cls = String(next.cls);
        if (next.label) metaState.label = String(next.label);
        if (Number.isFinite(Number(next.activeTotal))) {
          metaState.activeTotal = Math.max(0, Math.trunc(Number(next.activeTotal)));
        }
        if (Number.isFinite(Number(next.totalEvents))) {
          metaState.totalEvents = Math.max(0, Math.trunc(Number(next.totalEvents)));
        }
        if (Number.isFinite(Number(next.serverNowMs)) && Number(next.serverNowMs) > 0) {
          metaState.serverNowMs = Math.trunc(Number(next.serverNowMs));
        }
      }
      renderMeta();
    }

    function render() {
      var cutoff = Date.now() - Math.max(60 * 1000, Number(activeWindowMs || 0) || (15 * 60 * 1000));
      var arr = Array.from(map.values())
        .filter(function(e) { return seenMs(e) >= cutoff; })
        .sort(function(a, b) { return seenMs(b) - seenMs(a); })
        .slice(0, limit);

      rowsEl.innerHTML = arr.map(function(e) {
        var extra = [e.provider || '-', e.platform || '-', e.appVersion || '-'].join(' / ');
        return '<tr>' +
          '<td>' + esc(fmtTime(seenMs(e))) + '</td>' +
          '<td>' + esc(e.loginAccount || '-') + '</td>' +
          '<td>' + esc(e.userId || '-') + '</td>' +
          '<td>' + esc(normalizeSub(e)) + '</td>' +
          '<td>' + esc(fmtNum(e.popcornCount)) + '</td>' +
          '<td>' + esc(fmtNum(e.kernelCount)) + '</td>' +
          '<td>' + esc(fmtNum(e.totalPaymentKrw)) + '</td>' +
          '<td>' + esc(extra) + '</td>' +
        '</tr>';
      }).join('');

      updateMeta({ activeTotal: arr.length });
    }

    function replaceMany(rows) {
      map.clear();
      (Array.isArray(rows) ? rows : []).forEach(function(e) {
        var id = keyOf(e);
        if (!id) return;
        var prev = map.get(id);
        if (!prev || seenMs(e) >= seenMs(prev)) {
          map.set(id, e);
        }
      });
      render();
    }

    function upsertMany(rows) {
      (Array.isArray(rows) ? rows : []).forEach(function(e) {
        var id = keyOf(e);
        if (!id) return;
        var prev = map.get(id);
        if (!prev || seenMs(e) >= seenMs(prev)) {
          map.set(id, e);
        }
      });
      render();
    }

    async function refreshByHttp() {
      try {
        var res = await fetch('/api/admin/login-events?limit=' + limit, { cache: 'no-store' });
        if (!res.ok) return;
        var json = await res.json();
        var nextWindow = Number(json.activeWindowMs || 0);
        if (Number.isFinite(nextWindow) && nextWindow > 0) activeWindowMs = nextWindow;
        if (Array.isArray(json.sessions)) {
          replaceMany(json.sessions || []);
        } else {
          upsertMany(json.events || []);
        }
        var activeTotal = Number(json.activeTotal != null ? json.activeTotal : map.size || 0);
        var totalEvents = Number(json.totalEvents != null ? json.totalEvents : json.total || 0);
        updateMeta({
          cls: 'ok',
          label: 'connected',
          activeTotal: activeTotal,
          totalEvents: totalEvents,
          serverNowMs: Number(json.serverNowMs || 0),
        });
      } catch (e) {
        updateMeta({ cls: 'warn', label: 'reconnecting' });
      }
    }

    function startSse() {
      try {
        var es = new EventSource('/api/admin/login-events/stream?limit=' + limit);
        es.addEventListener('hello', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            var nextWindow = Number(p.activeWindowMs || 0);
            if (Number.isFinite(nextWindow) && nextWindow > 0) activeWindowMs = nextWindow;
            updateMeta({
              cls: 'ok',
              label: 'realtime connected',
              activeTotal: Number(p.activeTotal || 0),
              totalEvents: Number(p.totalEvents != null ? p.totalEvents : p.total || 0),
              serverNowMs: Number(p.serverNowMs || 0),
            });
          } catch {}
        });
        es.addEventListener('snapshot', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            if (!map.size && Array.isArray(p.events)) upsertMany(p.events || []);
          } catch {}
        });
        es.addEventListener('login', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            if (!map.size) upsertMany([p]);
          } catch {}
        });
        es.addEventListener('presence_snapshot', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            var nextWindow = Number(p.activeWindowMs || 0);
            if (Number.isFinite(nextWindow) && nextWindow > 0) activeWindowMs = nextWindow;
            replaceMany(p.sessions || []);
            updateMeta({ activeTotal: Number(p.activeTotal || map.size || 0) });
          } catch {}
        });
        es.addEventListener('presence_update', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            upsertMany([p]);
            updateMeta({ activeTotal: map.size });
          } catch {}
        });
        es.onerror = function() {
          updateMeta({ cls: 'warn', label: 'realtime reconnecting' });
        };
      } catch {
        updateMeta({ cls: 'warn', label: 'SSE unavailable' });
      }
    }

    updateMeta({ cls: 'warn', label: 'connecting', activeTotal: 0, totalEvents: 0, serverNowMs: Date.now() });
    refreshByHttp();
    setInterval(refreshByHttp, 5000);
    startSse();
  </script>
</body>
</html>`;
  return res.status(200).type("html").send(html);
};

["/api/admin/login-events", "/admin/login-events"].forEach((p) => {
  app.post(p, __adminLoginEventIngestHandler);
  app.get(p, __adminLoginEventListHandler);
});

app.get("/api/admin/login-events/stream", __adminLoginEventStreamHandler);
app.get("/admin/login-monitor", __adminLoginMonitorPageHandler);


app.get("/health", (_req, res) => res.status(200).send("ok"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const sessions = new Map();
const wsToSessionId = new Map();
const queue = [];
const rooms = new Map();

function now() {
  return Date.now();
}

function safeSend(ws, obj) {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  } catch {}
}

function genRoomId() {
  return crypto.randomBytes(16).toString("hex");
}

function removeFromQueue(sessionId) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i] === sessionId) queue.splice(i, 1);
  }
}

function cleanupSession(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  removeFromQueue(sessionId);
  sessions.delete(sessionId);
}

function cleanupWs(ws) {
  const sessionId = wsToSessionId.get(ws);
  if (sessionId) {
    wsToSessionId.delete(ws);
    cleanupSession(sessionId);
  }
}

function isWsAlive(ws) {
  return ws && ws.readyState === WebSocket.OPEN;
}

function getSessionId(ws) {
  return wsToSessionId.get(ws) || null;
}

function clearRoomRefs(ws) {
  try {
    ws._roomId = null;
    ws._peerSessionId = null;
  } catch {}
}

function getPeerSessionIdFromRoom(room, sessionId, fallbackPeerSessionId) {
  if (room && sessionId) {
    if (room.aId === sessionId) return room.bId;
    if (room.bId === sessionId) return room.aId;
  }
  return fallbackPeerSessionId || null;
}

function endRoomByWs(ws, reason) {
  const sessionId = getSessionId(ws);
  const roomId = ws?._roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);

  if (room && room.ended) {
    clearRoomRefs(ws);
    rooms.delete(roomId);
    return;
  }

  if (room) room.ended = true;
  const peerSessionId = getPeerSessionIdFromRoom(room, sessionId, ws?._peerSessionId);
  let peerWs = null;
  if (peerSessionId) {
    const peer = sessions.get(peerSessionId);
    if (peer && isWsAlive(peer.ws) && peer.ws._roomId === roomId) {
      peerWs = peer.ws;
    }
  }

  if (peerWs) {
    clearRoomRefs(peerWs);
    safeSend(peerWs, { type: "end", roomId, reason: reason || "peer_left" });
  }

  safeSend(ws, { type: "end", roomId, reason: reason || "peer_left" });

  clearRoomRefs(ws);
  rooms.delete(roomId);
}

function tryMatch() {
  for (let i = queue.length - 1; i >= 0; i--) {
    const sid = queue[i];
    const s = sessions.get(sid);
    if (!s || !isWsAlive(s.ws)) queue.splice(i, 1);
  }

  while (queue.length >= 2) {
    const aId = queue.shift();
    const bId = queue.shift();

    if (!aId || !bId || aId === bId) continue;

    const a = sessions.get(aId);
    const b = sessions.get(bId);

    if (!a || !b || !isWsAlive(a.ws) || !isWsAlive(b.ws)) {
      if (a && isWsAlive(a.ws)) queue.unshift(aId);
      if (b && isWsAlive(b.ws)) queue.unshift(bId);
      continue;
    }

    const roomId = genRoomId();

    rooms.set(roomId, { aId, bId, ended: false, createdAt: now() });

    a.ws._roomId = roomId;
    b.ws._roomId = roomId;

    a.ws._peerSessionId = bId;
    b.ws._peerSessionId = aId;

    safeSend(a.ws, { type: "matched", roomId, initiator: true, sessionId: aId, peerSessionId: bId });
    safeSend(b.ws, { type: "matched", roomId, initiator: false, sessionId: bId, peerSessionId: aId });

    return;
  }
}

function handleRegister(ws, msg) {
  const token = String(msg.token || "").trim();
  const sessionId = String(msg.sessionId || "").trim();

  if (!token || !sessionId) {
    safeSend(ws, { type: "error", reason: "register_requires_token_and_sessionId" });
    return;
  }

  const existing = sessions.get(sessionId);
  if (existing && existing.ws && existing.ws !== ws) {
    try {
      safeSend(existing.ws, { type: "error", reason: "session_replaced" });
      existing.ws.close(4001, "session_replaced");
    } catch {}
    wsToSessionId.delete(existing.ws);
  }

  sessions.set(sessionId, { ws, token, enqueuedAt: null });
  wsToSessionId.set(ws, sessionId);

  safeSend(ws, { type: "registered", sessionId });
}

function handleEnqueue(ws) {
  const sessionId = getSessionId(ws);
  if (!sessionId) {
    safeSend(ws, { type: "error", reason: "not_registered" });
    return;
  }

  const s = sessions.get(sessionId);
  if (!s || !isWsAlive(s.ws)) {
    safeSend(ws, { type: "error", reason: "invalid_session" });
    return;
  }

  if (ws._roomId) {
    safeSend(ws, { type: "error", reason: "already_in_room" });
    return;
  }

  if (!queue.includes(sessionId)) {
    queue.push(sessionId);
    s.enqueuedAt = now();
  }

  safeSend(ws, { type: "enqueued", sessionId, queueSize: queue.length });

  tryMatch();
}

function handleDequeue(ws) {
  const sessionId = getSessionId(ws);
  if (!sessionId) {
    safeSend(ws, { type: "error", reason: "not_registered" });
    return;
  }

  removeFromQueue(sessionId);

  const s = sessions.get(sessionId);
  if (s) s.enqueuedAt = null;

  safeSend(ws, { type: "dequeued", sessionId, queueSize: queue.length });
}

function handleLeave(ws) {
  const sessionId = getSessionId(ws);
  if (!sessionId) {
    safeSend(ws, { type: "error", reason: "not_registered" });
    return;
  }

  const roomId = ws._roomId;
  endRoomByWs(ws, "peer_left");
  removeFromQueue(sessionId);
  const s = sessions.get(sessionId);
  if (s) s.enqueuedAt = null;
  safeSend(ws, { type: "left_ok", roomId: roomId || null, sessionId });
}

function handleSignal(ws, msg) {
  const sessionId = getSessionId(ws);
  if (!sessionId) {
    safeSend(ws, { type: "error", reason: "not_registered" });
    return;
  }

  const roomId = String(msg.roomId || "").trim();
  if (!roomId || ws._roomId !== roomId) {
    safeSend(ws, { type: "error", reason: "not_in_room" });
    return;
  }

  const peerSessionId = ws._peerSessionId;
  if (!peerSessionId) {
    safeSend(ws, { type: "error", reason: "no_peer" });
    return;
  }

  const peer = sessions.get(peerSessionId);
  if (!peer || !isWsAlive(peer.ws) || peer.ws._roomId !== roomId) {
    safeSend(ws, { type: "error", reason: "peer_not_available" });
    return;
  }

  safeSend(peer.ws, { type: "signal", roomId, fromSessionId: sessionId, data: msg.data ?? null });
}

function handleCam(ws, msg) {
  const sessionId = getSessionId(ws);
  if (!sessionId) {
    safeSend(ws, { type: "error", reason: "not_registered" });
    return;
  }

  const roomId = String(msg.roomId || "").trim();
  if (!roomId || ws._roomId !== roomId) {
    safeSend(ws, { type: "error", reason: "not_in_room" });
    return;
  }

  const peerSessionId = ws._peerSessionId;
  if (!peerSessionId) {
    safeSend(ws, { type: "error", reason: "no_peer" });
    return;
  }

  const peer = sessions.get(peerSessionId);
  if (!peer || !isWsAlive(peer.ws) || peer.ws._roomId !== roomId) {
    safeSend(ws, { type: "error", reason: "peer_not_available" });
    return;
  }

  const enabled = msg.enabled === true ? true : msg.enabled === false ? false : false;

  safeSend(peer.ws, { type: "cam", roomId, fromSessionId: sessionId, enabled });
}

async function handleWalletSubscribe(ws, msg) {
  const input = msg && typeof msg === "object" ? msg : {};
  const reqLike = buildWsPseudoReq(ws, input);
  const profileId = sanitizeText(computeProfileId(reqLike, input), 180);
  if (!profileId) {
    safeSend(ws, { type: "error", reason: "wallet_profile_id_required" });
    return;
  }
  const ok = attachWalletSubscriber(ws, profileId);
  if (!ok) {
    safeSend(ws, { type: "error", reason: "wallet_subscribe_failed" });
    return;
  }
  safeSend(ws, { type: "wallet_subscribed", profileId });
  await sendUnifiedStateToWs(ws, reqLike, input);
}

function handleWalletUnsubscribe(ws) {
  detachWalletSubscriber(ws);
  safeSend(ws, { type: "wallet_unsubscribed" });
}

const HEARTBEAT_INTERVAL_MS = Number(process.env.WS_HEARTBEAT_MS || 15000);
const heartbeatTimer = setInterval(() => {
  try {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        try { ws.terminate(); } catch {}
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
  } catch {}
}, HEARTBEAT_INTERVAL_MS);

wss.on("close", () => {
  try {
    clearInterval(heartbeatTimer);
  } catch {}
});

wss.on("connection", (ws, req) => {
  ws._remoteIp = sanitizeText(
    (req && req.headers && req.headers["x-forwarded-for"]) ||
      (req && req.socket && req.socket.remoteAddress) ||
      "",
    128
  );
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    let msg = null;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      safeSend(ws, { type: "error", reason: "invalid_json" });
      return;
    }
    const type = String(msg.type || "").trim();

    switch (type) {
      case "register":
        handleRegister(ws, msg);
        break;
      case "enqueue":
        handleEnqueue(ws);
        break;
      case "dequeue":
        handleDequeue(ws);
        break;
      case "leave":
        handleLeave(ws);
        break;
      case "signal":
        handleSignal(ws, msg);
        break;
      case "cam":
        handleCam(ws, msg);
        break;
      case "wallet_subscribe":
        handleWalletSubscribe(ws, msg).catch(() => {
          safeSend(ws, { type: "error", reason: "wallet_subscribe_failed" });
        });
        break;
      case "wallet_unsubscribe":
        handleWalletUnsubscribe(ws);
        break;
      default:
        safeSend(ws, { type: "error", reason: "unknown_type" });
        break;
    }
  });

  ws.on("close", () => {
    detachWalletSubscriber(ws);
    endRoomByWs(ws, "disconnect");
    cleanupWs(ws);
  });

  ws.on("error", () => {
    detachWalletSubscriber(ws);
    endRoomByWs(ws, "error");
    cleanupWs(ws);
  });

  safeSend(ws, { type: "hello" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[rtc-signal] listening on 0.0.0.0:${PORT}`);
});

app.get("/api/active-users", (_req, res) => {
  res.status(200).json({ activeUsers: wss.clients.size });
});
