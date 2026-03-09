"use strict";

const http = require("http");
const express = require("express");
const WebSocket = require("ws");
const crypto = require("crypto");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
let nodemailer = null;
let createRedisClient = null;
try {
  nodemailer = require("nodemailer");
} catch {}
try {
  ({ createClient: createRedisClient } = require("redis"));
} catch {}
const { mountShopPurchaseRoutes } = require("./shop_db");
const { mountAiReplyRoutes, sanitizeAiReplyText, closeAiReplyService } = require("./server/ai_reply");
const { mountPublicApiRoutes } = require("./server/public_api_routes");

const PORT = Number(process.env.PORT || 3001);

const app = express();
app.use(cors({ origin: "*" }));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

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
const PROFILE_STORE_BACKEND = String(process.env.PROFILE_STORE_BACKEND || "json")
  .trim()
  .toLowerCase();
const PROFILE_SQLITE_PATH = process.env.PROFILE_SQLITE_PATH
  ? String(process.env.PROFILE_SQLITE_PATH).trim()
  : path.join(PROFILE_STORE_DIR, "profiles.db");
const PROFILE_SAVE_DEBOUNCE_MS = Number(process.env.PROFILE_SAVE_DEBOUNCE_MS || 500);
const PROFILE_STORE_CLUSTER_REFRESH_MS = Number(process.env.PROFILE_STORE_CLUSTER_REFRESH_MS || 5000);
const LOGIN_EVENTS_STORE_PATH = process.env.LOGIN_EVENTS_STORE_PATH
  ? String(process.env.LOGIN_EVENTS_STORE_PATH).trim()
  : path.join(PROFILE_STORE_DIR, "login_events.json");
const LOGIN_EVENTS_SAVE_DEBOUNCE_MS = Number(process.env.LOGIN_EVENTS_SAVE_DEBOUNCE_MS || 500);

const POPTALK_TIMEZONE = "Asia/Seoul";
const POPTALK_REGEN_INTERVAL_MS = 5 * 60 * 1000;
const POPTALK_IDEMPOTENCY_LIMIT = Number(process.env.POPTALK_IDEMPOTENCY_LIMIT || 200);
const POPTALK_PLAN_CONFIGS = {
  free: { cap: 1000, regenPerTick: 60 },
  monthly: { cap: 2000, regenPerTick: 200 },
  yearly: { cap: 5000, regenPerTick: 200 },
};
const POPTALK_UNLIMITED_CAP = Number(process.env.POPTALK_UNLIMITED_CAP || 1000000000);
const CALL_REPORTS_LIMIT = Number(process.env.CALL_REPORTS_LIMIT || 50000);
const CALL_REPORT_EMAIL_TO = String(process.env.CALL_REPORT_EMAIL_TO || "ppicassor@gmail.com").trim();
const CALL_RECALL_INVITE_TTL_MS = Number(process.env.CALL_RECALL_INVITE_TTL_MS || 30000);
const PROFILE_PERSIST_BATCH_MS = Number(process.env.PROFILE_PERSIST_BATCH_MS || PROFILE_SAVE_DEBOUNCE_MS || 800);
const PROFILE_NICKNAME_MIN_LEN = 2;
const PROFILE_NICKNAME_MAX_LEN = 12;
const PROFILE_INTEREST_MAX_COUNT = 3;
const PROFILE_AVATAR_DATA_URL_MAX_LEN = Number(process.env.PROFILE_AVATAR_DATA_URL_MAX_LEN || 380000);
const RESERVED_PROFILE_NICKNAME_TOKENS = [
  "admin",
  "administrator",
  "operator",
  "staff",
  "moderator",
  "mod",
  "master",
  "official",
  "manager",
  "\uAD00\uB9AC\uC790",
  "\uC6B4\uC601\uC790",
  "\uC6B4\uC601\uD300",
  "\uC5B4\uB4DC\uBBFC",
  "\uB9E4\uB2C8\uC800",
  "\uB9C8\uC2A4\uD130",
];
const KST_TZ_OFFSET_MS = 9 * 60 * 60 * 1000;
const kstDateCache = new Map();
const kstDateFormatter = (() => {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: POPTALK_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return null;
  }
})();
const RTC_CLUSTER_ENABLED = String(process.env.RTC_CLUSTER_ENABLED || "0").trim().toLowerCase() === "1";
const RTC_REDIS_URL = String(process.env.RTC_REDIS_URL || process.env.REDIS_URL || "redis://127.0.0.1:6379").trim();
const RTC_CLUSTER_PREFIX = String(process.env.RTC_CLUSTER_PREFIX || "rtc-signal")
  .trim()
  .replace(/[^a-zA-Z0-9:_-]/g, "")
  .slice(0, 64) || "rtc-signal";
const RTC_SESSION_TTL_SEC = Number(process.env.RTC_SESSION_TTL_SEC || 90);
const RTC_ROOM_TTL_SEC = Number(process.env.RTC_ROOM_TTL_SEC || 3600);
const RTC_WS_RECONNECT_GRACE_MS = Number(process.env.RTC_WS_RECONNECT_GRACE_MS || 12000);
const WS_HEARTBEAT_MS = Number(process.env.WS_HEARTBEAT_MS || 15000);
const WS_HEARTBEAT_MISS_LIMIT = Math.max(2, Number(process.env.WS_HEARTBEAT_MISS_LIMIT || 3));
const RTC_MATCH_CANDIDATE_MAX_AGE_MS = (() => {
  const explicit = Math.max(0, Number(process.env.RTC_MATCH_CANDIDATE_MAX_AGE_MS || 0));
  if (explicit > 0) return Math.max(15000, explicit);
  return Math.max(30000, RTC_WS_RECONNECT_GRACE_MS + WS_HEARTBEAT_MS);
})();
const RTC_MATCH_LOCK_MS = Number(process.env.RTC_MATCH_LOCK_MS || 1500);
const RTC_MATCH_SCAN_LIMIT = Number(process.env.RTC_MATCH_SCAN_LIMIT || 200);
const RTC_WORKER_ID = `${process.pid}_${crypto.randomBytes(4).toString("hex")}`;
const RTC_QUEUE_KEY = `${RTC_CLUSTER_PREFIX}:queue`;
const RTC_MATCH_LOCK_KEY = `${RTC_CLUSTER_PREFIX}:match-lock`;
const RTC_CHANNEL_PREFIX = `${RTC_CLUSTER_PREFIX}:worker:`;
const RTC_CHANNEL_PROFILE_SYNC = `${RTC_CLUSTER_PREFIX}:profile-store-sync`;
const RTC_CHANNEL_LOGIN_EVENTS = `${RTC_CLUSTER_PREFIX}:login-events`;

function createEmptyProfileStore() {
  return { users: {}, dinoRankEntries: [], popTalkWallets: {}, callReports: [], callBlocks: {} };
}

let profileStore = createEmptyProfileStore();
let persistTimer = null;
let loginEventsPersistTimer = null;
let persistDirty = false;
let persistInFlight = false;
let persistBatch = [];
let profileStoreBackend = "json";
let profileStoreBackendReady = false;
let profileStoreSqlite = null;
let readProfileStoreFromSqliteStmt = null;
let writeProfileStoreToSqliteStmt = null;
let countProfileStoreKvStmt = null;
let deleteProfileStoreKvStmt = null;
let countProfileUsersStmt = null;
let listProfileUsersStmt = null;
let upsertProfileUserStmt = null;
let countProfileWalletsStmt = null;
let listProfileWalletsStmt = null;
let upsertProfileWalletStmt = null;
let countProfileDinoEntriesStmt = null;
let listProfileDinoEntriesStmt = null;
let insertProfileDinoEntryStmt = null;
let deleteAllProfileDinoEntriesStmt = null;
let countCallReportsStmt = null;
let listCallReportsStmt = null;
let upsertCallReportStmt = null;
let countCallBlocksStmt = null;
let listCallBlocksStmt = null;
let upsertCallBlockStmt = null;
let deleteAllCallBlocksStmt = null;
let profileStoreDomainTx = null;
const profileStoreDirtyState = {
  users: new Set(),
  wallets: new Set(),
  dinoEntryIds: new Set(),
  callReportIds: new Set(),
  callBlockPairs: new Set(),
  fullUsers: false,
  fullWallets: false,
  fullDino: false,
  fullCallReports: false,
  fullCallBlocks: false,
};
let countLoginEventsSqliteStmt = null;
let insertLoginEventSqliteStmt = null;
let listLoginEventsSqliteStmt = null;
let listLoginEventsByAtRangeSqliteStmt = null;
let upsertLoginPresenceSqliteStmt = null;
let listActiveLoginPresenceSqliteStmt = null;
let listAllLoginPresenceSqliteStmt = null;
let countLoginPresenceSqliteStmt = null;
let countActiveLoginPresenceSqliteStmt = null;
let loginEventTotalCount = 0;
let rtcRedis = null;
let rtcRedisSub = null;
let rtcClusterReady = false;
let lastClusterProfileStoreRefreshAt = 0;
const callRecallInviteStore = new Map();

function sanitizeText(v, maxLen = 60) {
  return String(v || "").trim().slice(0, maxLen);
}

function hasOwn(input, key) {
  return Boolean(input && typeof input === "object" && Object.prototype.hasOwnProperty.call(input, key));
}

function createProfileError(statusCode, errorCode, detail) {
  const err = new Error(String(detail || errorCode || "profile_error").trim() || "profile_error");
  err.statusCode = Number.isFinite(Number(statusCode)) ? Math.max(400, Math.trunc(Number(statusCode))) : 400;
  err.errorCode = sanitizeText(errorCode || "profile_error", 80) || "profile_error";
  err.exposeMessage = sanitizeText(detail || errorCode || "profile_error", 240) || "profile_error";
  return err;
}

function normalizeProfileNicknameKey(value) {
  return String(value || "").trim().toLowerCase();
}

function createDefaultProfileNickname(profileId) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return "";
  const suffix = sanitizeText(anonymizeKey(pid), 12).slice(0, 6).toUpperCase();
  return `user${suffix || "000000"}`;
}

const GENERATED_PROFILE_NICKNAME_RE = /^user[A-Z0-9]{6}$/;

function isGeneratedProfileNickname(value) {
  const text = sanitizeText(value || "", PROFILE_NICKNAME_MAX_LEN);
  return Boolean(text) && GENERATED_PROFILE_NICKNAME_RE.test(text);
}

function pickPreferredProfileNickname(...values) {
  let fallback = "";
  for (const value of values) {
    const text = sanitizeText(value || "", PROFILE_NICKNAME_MAX_LEN);
    if (!text) continue;
    if (!fallback) fallback = text;
    if (!isGeneratedProfileNickname(text)) return text;
  }
  return fallback;
}

function findBestStoredProfileRowByLoginAccount(rawLoginAccount, excludeProfileId = "") {
  const loginAccount = normalizeLoginAccountValue(rawLoginAccount);
  const excludeId = sanitizeText(excludeProfileId || "", 180);
  if (!loginAccount) return null;
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : {};
  let best = null;
  let bestRank = -1;
  let bestUpdatedAt = 0;

  for (const [profileIdRaw, rowRaw] of Object.entries(users)) {
    const row = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
    const profileId = sanitizeText(row.profileId || profileIdRaw, 180);
    if (!profileId || profileId === excludeId) continue;
    if (normalizeLoginAccountValue(row.loginAccount || row.email || row.account || "") !== loginAccount) continue;

    const nickname = sanitizeText(row.nickname || "", PROFILE_NICKNAME_MAX_LEN);
    const avatarUrl = resolveStoredProfileAvatarUrl(row);
    const interests = normalizeMatchInterestArray(row.interests, { allowAll: false, fallbackToAll: false }).slice(0, PROFILE_INTEREST_MAX_COUNT);
    const rank =
      (nickname && !isGeneratedProfileNickname(nickname) ? 8 : 0) +
      (avatarUrl ? 4 : 0) +
      (interests.length > 0 ? 2 : 0) +
      (normalizeMatchCountry(row.country || "") ? 1 : 0) +
      (normalizeMatchLanguage(row.language || row.lang || "") ? 1 : 0) +
      (normalizeMatchGender(row.gender || "") ? 1 : 0);
    const updatedAt = normalizeRtcInt(row.updatedAt, 0);

    if (!best || rank > bestRank || (rank === bestRank && updatedAt > bestUpdatedAt)) {
      best = row;
      bestRank = rank;
      bestUpdatedAt = updatedAt;
    }
  }

  return best;
}

function sanitizeStoredProfileAvatarDataUrl(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return "";
  if (value.length > PROFILE_AVATAR_DATA_URL_MAX_LEN) return "";
  if (!/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return "";
  return value;
}

function resolveStoredProfileNickname(row, profileId) {
  const direct = sanitizeText(row && row.nickname, PROFILE_NICKNAME_MAX_LEN);
  return direct || createDefaultProfileNickname(profileId);
}

function resolveStoredProfileAvatarUrl(row) {
  return sanitizeStoredProfileAvatarDataUrl(row && (row.avatarDataUrl || row.avatarUrl));
}

function resolveProfileNicknameOwnerProfileId(nicknameKey, excludeProfileId = "") {
  const targetKey = normalizeProfileNicknameKey(nicknameKey);
  const excludeId = sanitizeText(excludeProfileId || "", 180);
  if (!targetKey) return "";
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : {};
  for (const [profileIdRaw, rowRaw] of Object.entries(users)) {
    const profileId = sanitizeText((rowRaw && rowRaw.profileId) || profileIdRaw, 180);
    if (!profileId || profileId === excludeId) continue;
    const row = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
    const candidateKey = normalizeProfileNicknameKey(resolveStoredProfileNickname(row, profileId));
    if (candidateKey && candidateKey === targetKey) {
      return profileId;
    }
  }
  return "";
}

function validateProfileNickname(rawNickname, profileId) {
  const nickname = sanitizeText(rawNickname || "", PROFILE_NICKNAME_MAX_LEN);
  if (!nickname) {
    throw createProfileError(400, "nickname_required", "nickname_required");
  }
  if (nickname.length < PROFILE_NICKNAME_MIN_LEN || nickname.length > PROFILE_NICKNAME_MAX_LEN) {
    throw createProfileError(400, "nickname_invalid", "nickname_invalid");
  }
  if (!/^[A-Za-z0-9\uAC00-\uD7A3]+$/.test(nickname)) {
    throw createProfileError(400, "nickname_invalid", "nickname_invalid");
  }

  const nicknameKey = normalizeProfileNicknameKey(nickname);
  const compact = nicknameKey.replace(/[0-9]/g, "");
  if (RESERVED_PROFILE_NICKNAME_TOKENS.some((token) => compact.includes(normalizeProfileNicknameKey(token)))) {
    throw createProfileError(400, "nickname_reserved", "nickname_reserved");
  }

  const duplicateProfileId = resolveProfileNicknameOwnerProfileId(nicknameKey, profileId);
  if (duplicateProfileId) {
    throw createProfileError(409, "nickname_taken", "nickname_taken");
  }

  return {
    nickname,
    nicknameKey,
  };
}

function buildPublicProfilePayload(profileId, row) {
  const pid = sanitizeText(profileId || "", 180);
  const source = row && typeof row === "object" ? row : {};
  const loginAccount = normalizeLoginAccountValue(
    source.loginAccount || source.email || source.account || readStoredLoginAccountByProfileId(pid)
  );
  const alias = findBestStoredProfileRowByLoginAccount(loginAccount, pid) || {};
  const aliasProfileId = sanitizeText(alias.profileId || "", 180);
  const avatarUrl = resolveStoredProfileAvatarUrl(source) || resolveStoredProfileAvatarUrl(alias);
  const preferredNickname = pickPreferredProfileNickname(source.nickname, alias.nickname);
  return {
    nickname: preferredNickname || resolveStoredProfileNickname(source, pid) || resolveStoredProfileNickname(alias, aliasProfileId) || null,
    avatarUrl: avatarUrl || null,
    interests: normalizeMatchInterestArray(
      (Array.isArray(source.interests) && source.interests.length > 0 ? source.interests : alias.interests),
      { allowAll: false, fallbackToAll: false }
    ).slice(0, PROFILE_INTEREST_MAX_COUNT),
    avatarUpdatedAt: normalizeRtcInt(source.avatarUpdatedAt || alias.avatarUpdatedAt, 0) || null,
  };
}

function sanitizeClusterKey(v, maxLen = 64) {
  return String(v || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, maxLen);
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

function normalizeCallSafetyStoreShape() {
  if (!profileStore || typeof profileStore !== "object") profileStore = {};
  if (!Array.isArray(profileStore.callReports)) profileStore.callReports = [];
  if (!profileStore.callBlocks || typeof profileStore.callBlocks !== "object") profileStore.callBlocks = {};
}

function resetProfileStoreDirtyState() {
  profileStoreDirtyState.users.clear();
  profileStoreDirtyState.wallets.clear();
  profileStoreDirtyState.dinoEntryIds.clear();
  profileStoreDirtyState.callReportIds.clear();
  profileStoreDirtyState.callBlockPairs.clear();
  profileStoreDirtyState.fullUsers = false;
  profileStoreDirtyState.fullWallets = false;
  profileStoreDirtyState.fullDino = false;
  profileStoreDirtyState.fullCallReports = false;
  profileStoreDirtyState.fullCallBlocks = false;
}

function markProfileStoreDirty(change) {
  const c = change && typeof change === "object" ? change : null;
  const type = sanitizeText(c && c.type, 40).toLowerCase();
  if (!type) {
    profileStoreDirtyState.fullUsers = true;
    profileStoreDirtyState.fullWallets = true;
    profileStoreDirtyState.fullDino = true;
    profileStoreDirtyState.fullCallReports = true;
    profileStoreDirtyState.fullCallBlocks = true;
    return;
  }

  switch (type) {
    case "user":
      if (c.profileId) profileStoreDirtyState.users.add(sanitizeText(c.profileId, 180));
      else profileStoreDirtyState.fullUsers = true;
      break;
    case "wallet":
      if (c.profileId) profileStoreDirtyState.wallets.add(sanitizeText(c.profileId, 180));
      else profileStoreDirtyState.fullWallets = true;
      break;
    case "dino_entry":
      if (c.entryId) profileStoreDirtyState.dinoEntryIds.add(sanitizeText(c.entryId, 128));
      else profileStoreDirtyState.fullDino = true;
      break;
    case "dino_full":
      profileStoreDirtyState.fullDino = true;
      break;
    case "call_report":
      if (c.reportId) profileStoreDirtyState.callReportIds.add(sanitizeText(c.reportId, 128));
      else profileStoreDirtyState.fullCallReports = true;
      break;
    case "call_report_full":
      profileStoreDirtyState.fullCallReports = true;
      break;
    case "call_block":
      if (c.actorSessionKey && c.peerSessionKey) {
        profileStoreDirtyState.callBlockPairs.add(`${sanitizeText(c.actorSessionKey, 128)}|${sanitizeText(c.peerSessionKey, 128)}`);
      } else {
        profileStoreDirtyState.fullCallBlocks = true;
      }
      break;
    case "call_block_full":
      profileStoreDirtyState.fullCallBlocks = true;
      break;
    default:
      profileStoreDirtyState.fullUsers = true;
      profileStoreDirtyState.fullWallets = true;
      profileStoreDirtyState.fullDino = true;
      profileStoreDirtyState.fullCallReports = true;
      profileStoreDirtyState.fullCallBlocks = true;
      break;
  }
}

function toSessionKey(sessionId) {
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return "";
  return sanitizeText(anonymizeKey(sid), 128);
}

function profileIdFromSignalSession(sessionId, token, userId = "") {
  const uid = sanitizeText(userId || "", 128);
  if (uid) return "u:" + uid;
  const sid = sanitizeText(sessionId || "", 256);
  if (sid) return "d:" + toSessionKey(sid);
  const tok = sanitizeText(token || "", 400);
  if (tok) return "t:" + sanitizeText(anonymizeKey(tok), 128);
  return "";
}

function getRtcSessionRedisKey(sessionId) {
  return `${RTC_CLUSTER_PREFIX}:session:${sanitizeClusterKey(sessionId || "", 256)}`;
}

function getRtcRoomRedisKey(roomId) {
  return `${RTC_CLUSTER_PREFIX}:room:${sanitizeClusterKey(roomId || "", 128)}`;
}

function getRtcWorkerChannel(workerId) {
  return `${RTC_CHANNEL_PREFIX}${sanitizeClusterKey(workerId || "", 128)}`;
}

function parseRtcJson(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeRtcInt(raw, fallback = 0) {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
}

function isRtcClusterActive() {
  return Boolean(RTC_CLUSTER_ENABLED && rtcClusterReady && rtcRedis && rtcRedisSub);
}

function resolveSessionMatchFilter(row) {
  const session = row && typeof row === "object" ? row : {};
  const source = sanitizeText(session.matchFilterSource || "", 24).toLowerCase();
  const storedFilter = readStoredMatchFilter(session.profileId);
  if (source === "incoming") {
    return normalizeMatchFilterPayload(session.matchFilter || storedFilter || null);
  }
  return normalizeMatchFilterPayload(storedFilter || session.matchFilter || null);
}

function resolveSessionMatchFilterSource(row) {
  const session = row && typeof row === "object" ? row : {};
  const source = sanitizeText(session.matchFilterSource || "", 24).toLowerCase();
  if (source === "incoming") return "incoming";
  return readStoredMatchFilter(session.profileId) ? "stored" : "default";
}

function buildRtcSessionRecord(sessionId, entry, overrides) {
  const row = entry && typeof entry === "object" ? entry : {};
  const ws = row.ws;
  const storedProfile = resolveStoredProfileMatchData(row.profileId);
  const pendingSignals = normalizeRtcBufferedSignals(row.pendingSignals);
  const base = {
    sessionId: sanitizeText(sessionId || row.sessionId || "", 256),
    workerId: RTC_WORKER_ID,
    sessionKey: sanitizeText(row.sessionKey || "", 128),
    profileId: sanitizeText(row.profileId || "", 180),
    country: normalizeMatchCountry(row.country || storedProfile.country || ""),
    language: normalizeMatchLanguage(row.language || row.lang || storedProfile.language || ""),
    gender: normalizeMatchGender(row.gender || storedProfile.gender || ""),
    interests: normalizeMatchInterestArray(row.interests || storedProfile.interests, { allowAll: false, fallbackToAll: false }),
    matchFilter: resolveSessionMatchFilter(row),
    matchFilterSource: resolveSessionMatchFilterSource(row),
    enqueuedAt: normalizeRtcInt(row.enqueuedAt, 0),
    roomId: sanitizeText((ws && ws._roomId) || row.roomId || "", 128),
    peerSessionId: sanitizeText((ws && ws._peerSessionId) || row.peerSessionId || "", 256),
    pendingSignals,
    updatedAt: now(),
  };
  return Object.assign(base, overrides || {});
}

function normalizeRtcBufferedSignalPayload(raw) {
  const payload = raw && typeof raw === "object" ? raw : null;
  if (!payload) return null;
  const type = sanitizeText(payload.type || "", 24).toLowerCase();
  if (type !== "signal" && type !== "cam" && type !== "end") return null;
  const roomId = sanitizeText(payload.roomId || "", 128);
  if (!roomId) return null;
  if (type === "cam") {
    return {
      type: "cam",
      roomId,
      fromSessionId: sanitizeText(payload.fromSessionId || "", 256) || undefined,
      enabled: payload.enabled === true ? true : payload.enabled === false ? false : false,
    };
  }
  if (type === "end") {
    return {
      type: "end",
      roomId,
      reason: sanitizeText(payload.reason || "", 80) || undefined,
    };
  }
  return {
    type: "signal",
    roomId,
    fromSessionId: sanitizeText(payload.fromSessionId || "", 256) || undefined,
    data: payload.data ?? null,
  };
}

function normalizeRtcBufferedSignals(raw) {
  const items = Array.isArray(raw) ? raw : [];
  return items
    .map((item) => normalizeRtcBufferedSignalPayload(item))
    .filter(Boolean)
    .slice(-48);
}

function queueRtcBufferedSignal(sessionId, entry, payload) {
  const sid = sanitizeText(sessionId || "", 256);
  const row = entry && typeof entry === "object" ? entry : null;
  const normalized = normalizeRtcBufferedSignalPayload(payload);
  if (!sid || !row || !normalized) return false;
  const activeRoomId = sanitizeText(row.roomId || "", 128);
  if (!activeRoomId || normalized.roomId !== activeRoomId) return false;
  const pending = normalizeRtcBufferedSignals(row.pendingSignals).filter((item) => sanitizeText(item.roomId || "", 128) === activeRoomId);
  pending.push(normalized);
  row.pendingSignals = pending.slice(-48);
  if (isRtcClusterActive()) {
    setRtcSessionRecord(sid, row, {
      pendingSignals: row.pendingSignals,
      updatedAt: now(),
    }).catch(() => {});
  }
  return true;
}

function isRtcRoomDeliveryReady(entry, ws, payload) {
  const row = entry && typeof entry === "object" ? entry : null;
  const socket = ws || (row && row.ws);
  if (!row || !isWsAlive(socket)) return false;
  const payloadRoomId = sanitizeText((payload && payload.roomId) || "", 128);
  if (!payloadRoomId) return true;
  const socketRoomId = sanitizeText((socket && socket._roomId) || "", 128);
  const entryRoomId = sanitizeText(row.roomId || "", 128);
  return socketRoomId === payloadRoomId && entryRoomId === payloadRoomId;
}

function flushRtcBufferedSignals(sessionId, entry, ws) {
  const sid = sanitizeText(sessionId || "", 256);
  const row = entry && typeof entry === "object" ? entry : null;
  if (!sid || !row || !isWsAlive(ws)) return 0;
  const activeRoomId = sanitizeText((ws && ws._roomId) || row.roomId || "", 128);
  const pending = normalizeRtcBufferedSignals(row.pendingSignals);
  if (!activeRoomId || pending.length <= 0) {
    row.pendingSignals = [];
    return 0;
  }
  const deliverable = pending.filter((item) => sanitizeText(item.roomId || "", 128) === activeRoomId);
  row.pendingSignals = pending.filter((item) => sanitizeText(item.roomId || "", 128) !== activeRoomId);
  if (isRtcClusterActive()) {
    setRtcSessionRecord(sid, row, {
      pendingSignals: row.pendingSignals,
      updatedAt: now(),
    }).catch(() => {});
  }
  deliverable.forEach((item) => {
    safeSend(ws, item);
  });
  return deliverable.length;
}

async function setRtcSessionRecord(sessionId, entry, overrides) {
  if (!isRtcClusterActive()) return;
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return;
  const record = buildRtcSessionRecord(sid, entry, overrides);
  await rtcRedis.set(getRtcSessionRedisKey(sid), JSON.stringify(record), {
    EX: Math.max(15, normalizeRtcInt(RTC_SESSION_TTL_SEC, 90)),
  });
}

async function getRtcQueueSize() {
  if (!isRtcClusterActive()) return getLocalQueueSize();
  try {
    return normalizeRtcInt(await rtcRedis.zCard(RTC_QUEUE_KEY), 0);
  } catch {
    return getLocalQueueSize();
  }
}

async function addRtcQueueMember(sessionId, score) {
  if (!isRtcClusterActive()) return;
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return;
  await rtcRedis.zAdd(RTC_QUEUE_KEY, [{ score: normalizeRtcInt(score, now()), value: sid }]);
}

async function removeRtcQueueMembers(sessionIds) {
  if (!isRtcClusterActive()) return;
  const ids = Array.from(new Set((Array.isArray(sessionIds) ? sessionIds : [sessionIds]).map((it) => sanitizeText(it || "", 256)).filter(Boolean)));
  if (!ids.length) return;
  await rtcRedis.sendCommand(["ZREM", RTC_QUEUE_KEY, ...ids]);
}

async function listRtcQueueMembers(limit = RTC_MATCH_SCAN_LIMIT) {
  if (!isRtcClusterActive()) return [];
  const capped = Math.max(2, normalizeRtcInt(limit, RTC_MATCH_SCAN_LIMIT));
  return rtcRedis.zRange(RTC_QUEUE_KEY, 0, capped - 1);
}

async function getRtcSessionRecord(sessionId) {
  if (!isRtcClusterActive()) return null;
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return null;
  return parseRtcJson(await rtcRedis.get(getRtcSessionRedisKey(sid)));
}

async function getRtcSessionRecordMap(sessionIds) {
  const ids = Array.from(new Set((Array.isArray(sessionIds) ? sessionIds : []).map((it) => sanitizeText(it || "", 256)).filter(Boolean)));
  const map = new Map();
  if (!isRtcClusterActive() || !ids.length) return map;
  const rows = await rtcRedis.mGet(ids.map((sid) => getRtcSessionRedisKey(sid)));
  ids.forEach((sid, idx) => {
    const parsed = parseRtcJson(rows[idx]);
    if (parsed) map.set(sid, parsed);
  });
  return map;
}

async function deleteRtcSessionRecord(sessionId) {
  if (!isRtcClusterActive()) return;
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return;
  try {
    await removeRtcQueueMembers([sid]);
    await rtcRedis.del(getRtcSessionRedisKey(sid));
  } catch (e) {
    console.error("[rtc-cluster] delete session failed:", e && e.message ? e.message : e);
  }
}

async function setRtcRoomRecord(roomId, room) {
  if (!isRtcClusterActive()) return;
  const rid = sanitizeText(roomId || "", 128);
  if (!rid || !room || typeof room !== "object") return;
  await rtcRedis.set(getRtcRoomRedisKey(rid), JSON.stringify(room), {
    EX: Math.max(60, normalizeRtcInt(RTC_ROOM_TTL_SEC, 3600)),
  });
}

async function getRtcRoomRecord(roomId) {
  if (!isRtcClusterActive()) return null;
  const rid = sanitizeText(roomId || "", 128);
  if (!rid) return null;
  return parseRtcJson(await rtcRedis.get(getRtcRoomRedisKey(rid)));
}

async function deleteRtcRoomRecord(roomId) {
  if (!isRtcClusterActive()) return;
  const rid = sanitizeText(roomId || "", 128);
  if (!rid) return;
  try {
    await rtcRedis.del(getRtcRoomRedisKey(rid));
  } catch (e) {
    console.error("[rtc-cluster] delete room failed:", e && e.message ? e.message : e);
  }
}

async function publishRtcWorkerMessage(workerId, payload) {
  if (!isRtcClusterActive()) return false;
  const wid = sanitizeClusterKey(workerId || "", 128);
  if (!wid || !payload || typeof payload !== "object") return false;
  try {
    const delivered = normalizeRtcInt(
      await rtcRedis.publish(getRtcWorkerChannel(wid), JSON.stringify(payload)),
      0
    );
    return delivered > 0;
  } catch (e) {
    console.error("[rtc-cluster] worker publish failed:", e && e.message ? e.message : e);
    return false;
  }
}

async function publishRtcSessionMessage(sessionId, payload) {
  if (!isRtcClusterActive()) return false;
  const record = await getRtcSessionRecord(sessionId);
  if (!record || !record.workerId) return false;
  return publishRtcWorkerMessage(record.workerId, Object.assign({}, payload || {}, {
    sessionId: sanitizeText(sessionId || "", 256),
  }));
}

async function publishProfileStoreSync() {
  if (!isRtcClusterActive()) return;
  try {
    await rtcRedis.publish(RTC_CHANNEL_PROFILE_SYNC, JSON.stringify({ workerId: RTC_WORKER_ID, at: now() }));
  } catch (e) {
    console.error("[rtc-cluster] profile sync publish failed:", e && e.message ? e.message : e);
  }
}

async function publishLoginEventSync(event, presence) {
  if (!isRtcClusterActive()) return;
  try {
    await rtcRedis.publish(
      RTC_CHANNEL_LOGIN_EVENTS,
      JSON.stringify({
        workerId: RTC_WORKER_ID,
        at: now(),
        total: loginEventTotalCount,
        event: event || null,
        presence: presence || null,
        latestSession: event ? loginLatestSessionByIdentity.get(getLoginIdentityKey(event)) || null : null,
      })
    );
  } catch (e) {
    console.error("[login-events] cluster publish failed:", e && e.message ? e.message : e);
  }
}

function applyLoginEventClusterSync(message) {
  const msg = message && typeof message === "object" ? message : null;
  if (!msg || String(msg.workerId || "") === RTC_WORKER_ID) return;
  if (Number.isFinite(Number(msg.total)) && Number(msg.total) > 0) {
    loginEventTotalCount = Math.max(loginEventTotalCount, Math.trunc(Number(msg.total)));
  }
  const event = hydrateLoginEventForRead(msg.event);
  if (event) appendRecentLoginEventCache(event);
  const hasPresence = Object.prototype.hasOwnProperty.call(msg, "presence");
  const presence = hasPresence
    ? (msg.presence && typeof msg.presence === "object" ? msg.presence : null)
    : event
      ? upsertLoginPresence(event)
      : null;
  if (Object.prototype.hasOwnProperty.call(msg, "latestSession")) {
    applyLatestLoginSessionRecord(msg.latestSession);
  } else if (event) {
    evaluateLoginSessionConflict(event);
  }
  if (presence) {
    loginPresenceBySession.set(String(presence.sessionKey || getLoginPresenceKey(presence)), presence);
    const uid = normalizeLoginUserId(presence.userId);
    if (uid && presence.loginAccount) rememberLoginAccountByUserId(uid, presence.loginAccount);
  }
  if (event) broadcastLoginEvent(event);
  if (presence) broadcastLoginPresenceUpdate(presence);
}

function applyRtcMessageToLocalSession(msg) {
  const sessionId = sanitizeText(msg && msg.sessionId, 256);
  if (!sessionId) return false;
  const entry = sessions.get(sessionId);
  if (!entry) return false;
  let queued = false;
  const normalizedPayload = msg && msg.payload && typeof msg.payload === "object"
    ? normalizeRtcBufferedSignalPayload(msg.payload)
    : null;
  const incomingRoomId = sanitizeText(
    (msg && msg.roomId) || (normalizedPayload && normalizedPayload.roomId) || "",
    128
  ) || "";
  const incomingPeerSessionId = sanitizeText(
    (msg && msg.peerSessionId) ||
      ((normalizedPayload && normalizedPayload.type !== "end" && normalizedPayload.fromSessionId) || ""),
    256
  ) || "";

  if (incomingRoomId) {
    entry.roomId = incomingRoomId;
    if (isWsAlive(entry.ws)) {
      entry.ws._roomId = entry.roomId || null;
    }
  }
  if (incomingPeerSessionId || Object.prototype.hasOwnProperty.call(msg || {}, "peerSessionId")) {
    entry.peerSessionId = incomingPeerSessionId;
    if (isWsAlive(entry.ws)) {
      entry.ws._peerSessionId = entry.peerSessionId || null;
    }
  }

  if (Object.prototype.hasOwnProperty.call(msg || {}, "enqueuedAt")) {
    entry.enqueuedAt = normalizeRtcInt(msg.enqueuedAt, 0) || null;
  }

  if (normalizedPayload) {
    const payload = normalizedPayload;
    const shouldBuffer =
      !isRtcRoomDeliveryReady(entry, entry.ws, payload);
    if (shouldBuffer) {
      queued = queueRtcBufferedSignal(sessionId, entry, payload) || queued;
    } else if (isWsAlive(entry.ws)) {
      safeSend(entry.ws, payload);
    } else if (queueRtcBufferedSignal(sessionId, entry, payload)) {
      queued = true;
    }
  }

  if (msg && msg.clearRoom === true && !queued) {
    entry.roomId = "";
    entry.peerSessionId = "";
    entry.enqueuedAt = null;
    entry.pendingSignals = [];
    if (isWsAlive(entry.ws)) {
      clearRoomRefs(entry.ws);
    }
    if (isRtcClusterActive()) {
      setRtcSessionRecord(sessionId, entry, {
        roomId: "",
        peerSessionId: "",
        enqueuedAt: 0,
        pendingSignals: [],
        updatedAt: now(),
      }).catch(() => {});
    }
  }

  if (isWsAlive(entry.ws) && msg && msg.close === true) {
    try {
      entry.ws.close(normalizeRtcInt(msg.code, 4001) || 4001, sanitizeText(msg.reason || "cluster_close", 120) || "cluster_close");
    } catch {}
  }

  return isWsAlive(entry.ws) || queued;
}

async function releaseRtcMatchLock(lockToken) {
  if (!isRtcClusterActive() || !lockToken) return;
  const script =
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
  try {
    await rtcRedis.eval(script, {
      keys: [RTC_MATCH_LOCK_KEY],
      arguments: [String(lockToken)],
    });
  } catch {}
}

async function withRtcMatchLock(fn) {
  if (!isRtcClusterActive() || typeof fn !== "function") return false;
  const token = `${RTC_WORKER_ID}:${now()}:${Math.random().toString(16).slice(2, 10)}`;
  const acquired = await rtcRedis.set(RTC_MATCH_LOCK_KEY, token, {
    NX: true,
    PX: Math.max(500, normalizeRtcInt(RTC_MATCH_LOCK_MS, 1500)),
  });
  if (!acquired) return false;
  try {
    await fn();
    return true;
  } finally {
    await releaseRtcMatchLock(token);
  }
}

async function initRtcClusterBridge() {
  if (!RTC_CLUSTER_ENABLED) return;
  if (!createRedisClient) {
    throw new Error("RTC_CLUSTER_REDIS_CLIENT_MISSING");
  }

  rtcRedis = createRedisClient({ url: RTC_REDIS_URL });
  rtcRedis.on("error", (e) => {
    console.error("[rtc-cluster] redis error:", e && e.message ? e.message : e);
  });
  rtcRedisSub = rtcRedis.duplicate();
  rtcRedisSub.on("error", (e) => {
    console.error("[rtc-cluster] redis sub error:", e && e.message ? e.message : e);
  });

  await rtcRedis.connect();
  await rtcRedisSub.connect();
  await rtcRedisSub.subscribe(getRtcWorkerChannel(RTC_WORKER_ID), (raw) => {
    const msg = parseRtcJson(raw);
    if (!msg || typeof msg !== "object") return;
    applyRtcMessageToLocalSession(msg);
  });
  await rtcRedisSub.subscribe(RTC_CHANNEL_PROFILE_SYNC, () => {
    try {
      loadProfileStore();
    } catch (e) {
      console.error("[rtc-cluster] profile reload failed:", e && e.message ? e.message : e);
    }
  });
  await rtcRedisSub.subscribe(RTC_CHANNEL_LOGIN_EVENTS, (raw) => {
    const msg = parseRtcJson(raw);
    if (!msg || typeof msg !== "object") return;
    applyLoginEventClusterSync(msg);
  });

  rtcClusterReady = true;
  console.log(`[rtc-cluster] ready worker=${RTC_WORKER_ID} redis=${RTC_REDIS_URL}`);
}

function sanitizeReasonCode(v) {
  const raw = String(v || "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
  return sanitizeText(raw, 80);
}

function sanitizeReasonLabel(v) {
  return sanitizeText(v || "", 120);
}

function sanitizeReasonDetail(v) {
  return sanitizeText(v || "", 1200);
}

function resolveBlockPair(sessionIdA, sessionIdB) {
  const aKey = toSessionKey(sessionIdA);
  const bKey = toSessionKey(sessionIdB);
  if (!aKey || !bKey || aKey === bKey) return null;
  return { aKey, bKey };
}

function hasBlockBetweenSessions(sessionIdA, sessionIdB) {
  const pair = resolveBlockPair(sessionIdA, sessionIdB);
  if (!pair) return false;
  normalizeCallSafetyStoreShape();
  const blocks = profileStore.callBlocks;
  return Boolean((blocks[pair.aKey] && blocks[pair.aKey][pair.bKey]) || (blocks[pair.bKey] && blocks[pair.bKey][pair.aKey]));
}

function putCallBlock(sessionIdA, sessionIdB, payload) {
  const pair = resolveBlockPair(sessionIdA, sessionIdB);
  if (!pair) return null;
  normalizeCallSafetyStoreShape();
  const blocks = profileStore.callBlocks;
  const createdAt = Number.isFinite(Number(payload && payload.createdAt)) ? Math.max(0, Math.trunc(Number(payload.createdAt))) : now();
  if (!blocks[pair.aKey] || typeof blocks[pair.aKey] !== "object") blocks[pair.aKey] = {};
  blocks[pair.aKey][pair.bKey] = {
    createdAt,
    blockedAt: Number.isFinite(Number(payload && payload.blockedAt)) ? Math.max(0, Math.trunc(Number(payload.blockedAt))) : createdAt,
    reasonCode: sanitizeReasonCode(payload && payload.reasonCode),
    reasonLabel: sanitizeReasonLabel(payload && payload.reasonLabel),
    roomId: sanitizeText(payload && payload.roomId, 120),
    reporterProfileId: sanitizeText(payload && payload.reporterProfileId, 180),
    peerProfileId: sanitizeText(payload && payload.peerProfileId, 180),
    peerUserId: sanitizeText(payload && payload.peerUserId, 128),
  };
  schedulePersistProfileStore({ type: "call_block", actorSessionKey: pair.aKey, peerSessionKey: pair.bKey });
  return {
    actorSessionKey: pair.aKey,
    peerSessionKey: pair.bKey,
  };
}

function resolveCallBlockActorContext(req, body) {
  const b = body || {};
  const actorSessionId = sanitizeText(b.sessionId || b.deviceKey || "", 256);
  const actorSessionKey = toSessionKey(actorSessionId);
  const reporterProfileId = sanitizeText(computeProfileId(req, b), 180);
  if (!actorSessionKey && !reporterProfileId) {
    return { ok: false, errorCode: "SESSION_ID_REQUIRED", errorMessage: "SESSION_ID_REQUIRED" };
  }
  return {
    ok: true,
    actorSessionId,
    actorSessionKey,
    reporterProfileId,
  };
}

function collectCallBlockTargetKeys(rawValues) {
  const set = new Set();
  const values = Array.isArray(rawValues) ? rawValues : [rawValues];
  values.forEach((value) => {
    const raw = sanitizeText(value, 256);
    if (!raw) return;
    set.add(raw);
    if (/^[a-f0-9]{32,128}$/i.test(raw)) {
      set.add(raw.toLowerCase());
    }
    const hashed = toSessionKey(raw);
    if (hashed) set.add(hashed);
  });
  return set;
}

function listCallBlocksForActor(actorSessionId, reporterProfileId, limit = 200) {
  normalizeCallSafetyStoreShape();
  const actorSessionKey = toSessionKey(actorSessionId);
  const profileId = sanitizeText(reporterProfileId, 180);
  const hardLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.trunc(Number(limit)))) : 200;
  const itemsByPeerSessionKey = new Map();

  Object.entries(profileStore.callBlocks || {}).forEach(([storedActorSessionKey, targets]) => {
    const targetMap = targets && typeof targets === "object" ? targets : {};
    Object.entries(targetMap).forEach(([peerSessionKey, row]) => {
      const meta = row && typeof row === "object" ? row : {};
      const ownerProfileId = sanitizeText(meta.reporterProfileId, 180);
      const ownedByActor =
        (actorSessionKey && storedActorSessionKey === actorSessionKey) ||
        (profileId && ownerProfileId && ownerProfileId === profileId);
      if (!ownedByActor) return;

      const createdAtMs = normalizeRtcInt(meta.createdAt, 0);
      const blockedAtMs = normalizeRtcInt(meta.blockedAt || meta.updatedAt || meta.createdAt, createdAtMs);
      const item = {
        peerSessionKey: sanitizeText(peerSessionKey, 128),
        peerProfileId: sanitizeText(meta.peerProfileId, 180),
        peerUserId: sanitizeText(meta.peerUserId, 128),
        roomId: sanitizeText(meta.roomId, 120),
        reasonCode: sanitizeReasonCode(meta.reasonCode),
        reasonLabel: sanitizeReasonLabel(meta.reasonLabel),
        blockedAtMs,
        createdAtMs,
      };
      if (!item.peerSessionKey) return;

      const prev = itemsByPeerSessionKey.get(item.peerSessionKey);
      if (!prev || Number(item.blockedAtMs || 0) >= Number(prev.blockedAtMs || 0)) {
        itemsByPeerSessionKey.set(item.peerSessionKey, item);
      }
    });
  });

  const items = Array.from(itemsByPeerSessionKey.values())
    .sort((a, b) => {
      if (Number(b.blockedAtMs || 0) !== Number(a.blockedAtMs || 0)) return Number(b.blockedAtMs || 0) - Number(a.blockedAtMs || 0);
      return Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0);
    })
    .slice(0, hardLimit);

  return {
    actorSessionKey,
    items,
  };
}

function removeCallBlocksForActor(actorSessionId, reporterProfileId, peerSessionIds) {
  normalizeCallSafetyStoreShape();
  const actorSessionKey = toSessionKey(actorSessionId);
  const profileId = sanitizeText(reporterProfileId, 180);
  const targetKeys = collectCallBlockTargetKeys(peerSessionIds);
  if (targetKeys.size <= 0) {
    return {
      actorSessionKey,
      removedCount: 0,
    };
  }

  let removedCount = 0;
  Object.keys(profileStore.callBlocks || {}).forEach((storedActorSessionKey) => {
    const targetMap = profileStore.callBlocks[storedActorSessionKey];
    if (!targetMap || typeof targetMap !== "object") return;

    Object.keys(targetMap).forEach((peerSessionKey) => {
      const meta = targetMap[peerSessionKey] && typeof targetMap[peerSessionKey] === "object" ? targetMap[peerSessionKey] : {};
      const ownerProfileId = sanitizeText(meta.reporterProfileId, 180);
      const ownedByActor =
        (actorSessionKey && storedActorSessionKey === actorSessionKey) ||
        (profileId && ownerProfileId && ownerProfileId === profileId);
      if (!ownedByActor || !targetKeys.has(peerSessionKey)) return;
      delete targetMap[peerSessionKey];
      removedCount += 1;
    });

    if (Object.keys(targetMap).length <= 0) {
      delete profileStore.callBlocks[storedActorSessionKey];
    }
  });

  if (removedCount > 0) {
    schedulePersistProfileStore({ type: "call_block_full" });
  }

  return {
    actorSessionKey,
    removedCount,
  };
}

function normalizeCallContactRow(raw) {
  const row = raw && typeof raw === "object" ? raw : {};
  const peerUserId = sanitizeText(row.peerUserId, 128);
  const peerProfileId = sanitizeText(row.peerProfileId, 180) || profileIdFromUserId(peerUserId);
  const peerSessionId = sanitizeText(row.peerSessionId, 256);
  const peerSessionKey = sanitizeText(row.peerSessionKey || toSessionKey(peerSessionId), 128);
  const contactKey = sanitizeText(row.contactKey || peerProfileId || peerSessionKey, 180);
  const friendAt = normalizeRtcInt(row.friendAt, 0);
  const favoriteAt = normalizeRtcInt(row.favoriteAt, 0);
  const recallBlockedAt = normalizeRtcInt(row.recallBlockedAt || row.recall_blocked_at || 0, 0);
  const lastCallAt = normalizeRtcInt(row.lastCallAt || row.updatedAt || row.createdAt, 0);
  const updatedAt = normalizeRtcInt(row.updatedAt || lastCallAt || now(), now());
  const peerInterests = normalizeMatchInterestArray(row.peerInterests || row.peer_interests || row.interests, {
    allowAll: false,
    fallbackToAll: false,
  }).slice(0, PROFILE_INTEREST_MAX_COUNT);
  return {
    contactKey,
    peerProfileId,
    peerSessionId,
    peerSessionKey,
    peerUserId,
    peerNickname: sanitizeText(row.peerNickname || row.nickname || "", PROFILE_NICKNAME_MAX_LEN),
    peerAvatarUrl: resolveStoredProfileAvatarUrl({ avatarDataUrl: row.peerAvatarUrl || row.peer_avatar_url || row.avatarDataUrl, avatarUrl: row.peerAvatarUrl || row.peer_avatar_url || row.avatarUrl }),
    peerLoginAccount: normalizeLoginAccountValue(row.peerLoginAccount),
    peerCountry: normalizeMatchCountry(row.peerCountry || ""),
    peerLanguage: normalizeMatchLanguage(row.peerLanguage || row.peerLang || ""),
    peerGender: normalizeMatchGender(row.peerGender || ""),
    peerFlag: sanitizeText(row.peerFlag, 8),
    peerInterests,
    roomId: sanitizeText(row.roomId, 120),
    isFriend: row.isFriend === true,
    isFavorite: row.isFavorite === true,
    friendAt,
    favoriteAt,
    recallBlockedAt,
    isRecallBlocked: recallBlockedAt > 0,
    lastCallAt,
    updatedAt,
  };
}

function ensureProfileUser(profileId) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return null;
  if (!profileStore || typeof profileStore !== "object") profileStore = createEmptyProfileStore();
  if (!profileStore.users || typeof profileStore.users !== "object") profileStore.users = {};
  const prev = profileStore.users[pid] && typeof profileStore.users[pid] === "object" ? profileStore.users[pid] : { profileId: pid };
  const next = {
    ...prev,
    profileId: sanitizeText(prev.profileId || pid, 180) || pid,
    nickname: sanitizeText(prev.nickname || "", PROFILE_NICKNAME_MAX_LEN),
    nicknameKey: normalizeProfileNicknameKey(prev.nicknameKey || prev.nickname || ""),
    avatarDataUrl: sanitizeStoredProfileAvatarDataUrl(prev.avatarDataUrl || prev.avatarUrl),
    avatarUpdatedAt: normalizeRtcInt(prev.avatarUpdatedAt, 0),
  };
  profileStore.users[pid] = next;
  return next;
}

function ensureCallContactsMap(profileId) {
  const user = ensureProfileUser(profileId);
  if (!user) return null;
  const prev = user.callContacts && typeof user.callContacts === "object" ? user.callContacts : {};
  user.callContacts = prev;
  return prev;
}

function findExistingCallContactEntry(map, incoming) {
  const sourceMap = map && typeof map === "object" ? map : {};
  const next = incoming && typeof incoming === "object" ? incoming : {};
  const incomingContactKey = sanitizeText(next.contactKey, 180);
  const incomingPeerSessionId = sanitizeText(next.peerSessionId, 256);
  const incomingPeerProfileId = sanitizeText(next.peerProfileId, 180);
  const incomingPeerSessionKey = sanitizeText(next.peerSessionKey || toSessionKey(incomingPeerSessionId), 128);
  const incomingPeerUserId = sanitizeText(next.peerUserId, 128);

  let matchedKey = "";
  let matchedRow = null;

  Object.entries(sourceMap).forEach(([storedKeyRaw, rawRow]) => {
    const storedKey = sanitizeText(storedKeyRaw, 180);
    const row = normalizeCallContactRow(rawRow);
    if (!row.contactKey) return;

    const sameContactKey = incomingContactKey && row.contactKey === incomingContactKey;
    const samePeerSessionId = incomingPeerSessionId && row.peerSessionId === incomingPeerSessionId;
    const samePeerProfileId = incomingPeerProfileId && row.peerProfileId === incomingPeerProfileId;
    const samePeerSessionKey = incomingPeerSessionKey && row.peerSessionKey === incomingPeerSessionKey;
    const samePeerUserId = incomingPeerUserId && row.peerUserId === incomingPeerUserId;

    if (!sameContactKey && !samePeerSessionId && !samePeerProfileId && !samePeerSessionKey && !samePeerUserId) {
      return;
    }

    if (!matchedRow) {
      matchedKey = storedKey || row.contactKey;
      matchedRow = row;
      return;
    }

    const currentHasProfile = sanitizeText(matchedRow.peerProfileId, 180);
    const nextHasProfile = sanitizeText(row.peerProfileId, 180);
    if (!currentHasProfile && nextHasProfile) {
      matchedKey = storedKey || row.contactKey;
      matchedRow = row;
    }
  });

  return {
    key: matchedKey,
    row: matchedRow,
  };
}

function upsertCallContact(profileId, payload, options) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return null;
  const map = ensureCallContactsMap(pid);
  if (!map) return null;
  const opts = options && typeof options === "object" ? options : {};
  const incoming = normalizeCallContactRow(payload);
  if (!incoming.contactKey) return null;

  const existing = findExistingCallContactEntry(map, incoming);
  const prev = normalizeCallContactRow(existing.row || map[incoming.contactKey] || {});
  const ts = now();
  const kind = sanitizeText(opts.kind || "", 24).toLowerCase();
  const enabled = typeof opts.enabled === "boolean" ? opts.enabled : true;
  const canonicalKey =
    sanitizeText(incoming.peerProfileId || prev.peerProfileId || existing.key || incoming.contactKey, 180) ||
    incoming.contactKey;

  const next = {
    ...prev,
    ...incoming,
    contactKey: canonicalKey,
    peerProfileId: incoming.peerProfileId || prev.peerProfileId || "",
    peerSessionId: incoming.peerSessionId || prev.peerSessionId || "",
    peerSessionKey: incoming.peerSessionKey || prev.peerSessionKey || "",
    peerUserId: incoming.peerUserId || prev.peerUserId || "",
    peerNickname: incoming.peerNickname || prev.peerNickname || "",
    peerAvatarUrl: incoming.peerAvatarUrl || prev.peerAvatarUrl || "",
    peerLoginAccount: incoming.peerLoginAccount || prev.peerLoginAccount || "",
    peerCountry: incoming.peerCountry || prev.peerCountry || "",
    peerLanguage: incoming.peerLanguage || prev.peerLanguage || "",
    peerGender: incoming.peerGender || prev.peerGender || "",
    peerFlag: incoming.peerFlag || prev.peerFlag || "",
    peerInterests:
      normalizeMatchInterestArray(incoming.peerInterests || prev.peerInterests, {
        allowAll: false,
        fallbackToAll: false,
      }).slice(0, PROFILE_INTEREST_MAX_COUNT),
    roomId: incoming.roomId || prev.roomId || "",
    isFriend: prev.isFriend === true,
    isFavorite: prev.isFavorite === true,
    friendAt: normalizeRtcInt(prev.friendAt, 0),
    favoriteAt: normalizeRtcInt(prev.favoriteAt, 0),
    recallBlockedAt: normalizeRtcInt(prev.recallBlockedAt, 0),
    lastCallAt: incoming.lastCallAt || prev.lastCallAt || ts,
    updatedAt: ts,
  };

  if (kind === "friend") {
    next.isFriend = enabled;
    next.friendAt = enabled ? (next.friendAt || ts) : 0;
  }
  if (kind === "favorite") {
    next.isFavorite = enabled;
    next.favoriteAt = enabled ? (next.favoriteAt || ts) : 0;
  }
  if (kind === "recall_block") {
    next.recallBlockedAt = enabled ? (next.recallBlockedAt || ts) : 0;
  }

  Object.entries(map).forEach(([storedKeyRaw, rawRow]) => {
    const storedKey = sanitizeText(storedKeyRaw, 180);
    const row = normalizeCallContactRow(rawRow);
    const sameContactKey = storedKey === canonicalKey;
    const samePeerSessionId = next.peerSessionId && row.peerSessionId === next.peerSessionId;
    const samePeerProfileId = next.peerProfileId && row.peerProfileId === next.peerProfileId;
    const samePeerSessionKey = next.peerSessionKey && row.peerSessionKey === next.peerSessionKey;
    const samePeerUserId = next.peerUserId && row.peerUserId === next.peerUserId;
    if (!sameContactKey && !samePeerSessionId && !samePeerProfileId && !samePeerSessionKey && !samePeerUserId) {
      return;
    }
    delete map[storedKeyRaw];
  });

  map[canonicalKey] = next;

  if (next.isFriend !== true && next.isFavorite !== true && normalizeRtcInt(next.recallBlockedAt, 0) <= 0) {
    delete map[canonicalKey];
  }

  const user = ensureProfileUser(pid);
  if (user) {
    user.updatedAt = ts;
  }
  schedulePersistProfileStore({ type: "user", profileId: pid });
  return normalizeCallContactRow(map[canonicalKey] || next);
}

function listCallContacts(profileId, limit = 200) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return [];
  const user = ensureProfileUser(pid);
  const map = user && user.callContacts && typeof user.callContacts === "object" ? user.callContacts : {};
  const hardLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.trunc(Number(limit)))) : 200;
  return Object.values(map)
    .map((row) => normalizeCallContactRow(row))
    .filter((row) => row.contactKey && (row.isFriend || row.isFavorite))
    .sort((a, b) => {
      const aRank = (a.isFavorite ? 2 : 0) + (a.isFriend ? 1 : 0);
      const bRank = (b.isFavorite ? 2 : 0) + (b.isFriend ? 1 : 0);
      if (bRank !== aRank) return bRank - aRank;
      if (Number(b.lastCallAt || 0) !== Number(a.lastCallAt || 0)) return Number(b.lastCallAt || 0) - Number(a.lastCallAt || 0);
      return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    })
    .slice(0, hardLimit);
}

function compareCallContactRows(aRaw, bRaw) {
  const a = normalizeCallContactRow(aRaw);
  const b = normalizeCallContactRow(bRaw);
  const aRank = (a.isFavorite ? 2 : 0) + (a.isFriend ? 1 : 0);
  const bRank = (b.isFavorite ? 2 : 0) + (b.isFriend ? 1 : 0);
  if (bRank !== aRank) return bRank - aRank;
  if (Number(b.lastCallAt || 0) !== Number(a.lastCallAt || 0)) return Number(b.lastCallAt || 0) - Number(a.lastCallAt || 0);
  return Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
}

function mergeCallContactRows(rows) {
  const sorted = (Array.isArray(rows) ? rows : []).map((row) => normalizeCallContactRow(row)).sort(compareCallContactRows);
  const merged = [];

  sorted.forEach((row) => {
    if (!row.contactKey) return;
    const existingIndex = merged.findIndex((current) => {
      const sameContactKey = row.contactKey && current.contactKey === row.contactKey;
      const samePeerSessionId = row.peerSessionId && current.peerSessionId === row.peerSessionId;
      const samePeerProfileId = row.peerProfileId && current.peerProfileId === row.peerProfileId;
      const samePeerSessionKey = row.peerSessionKey && current.peerSessionKey === row.peerSessionKey;
      const samePeerUserId = row.peerUserId && current.peerUserId === row.peerUserId;
      return Boolean(sameContactKey || samePeerSessionId || samePeerProfileId || samePeerSessionKey || samePeerUserId);
    });

    if (existingIndex < 0) {
      merged.push(row);
      return;
    }

    const prev = merged[existingIndex];
    merged[existingIndex] = normalizeCallContactRow({
      ...prev,
      ...row,
      contactKey: row.contactKey || prev.contactKey,
      peerProfileId: row.peerProfileId || prev.peerProfileId,
      peerSessionId: row.peerSessionId || prev.peerSessionId,
      peerSessionKey: row.peerSessionKey || prev.peerSessionKey,
      peerUserId: row.peerUserId || prev.peerUserId,
      peerLoginAccount: row.peerLoginAccount || prev.peerLoginAccount,
      peerCountry: row.peerCountry || prev.peerCountry,
      peerLanguage: row.peerLanguage || prev.peerLanguage,
      peerGender: row.peerGender || prev.peerGender,
      peerFlag: row.peerFlag || prev.peerFlag,
      peerInterests:
        normalizeMatchInterestArray(row.peerInterests || prev.peerInterests, {
          allowAll: false,
          fallbackToAll: false,
        }).slice(0, PROFILE_INTEREST_MAX_COUNT),
      roomId: row.roomId || prev.roomId,
      isFriend: prev.isFriend === true || row.isFriend === true,
      isFavorite: prev.isFavorite === true || row.isFavorite === true,
      friendAt: Math.max(normalizeRtcInt(prev.friendAt, 0), normalizeRtcInt(row.friendAt, 0)),
      favoriteAt: Math.max(normalizeRtcInt(prev.favoriteAt, 0), normalizeRtcInt(row.favoriteAt, 0)),
      recallBlockedAt: Math.max(normalizeRtcInt(prev.recallBlockedAt, 0), normalizeRtcInt(row.recallBlockedAt, 0)),
      lastCallAt: Math.max(normalizeRtcInt(prev.lastCallAt, 0), normalizeRtcInt(row.lastCallAt, 0)),
      updatedAt: Math.max(normalizeRtcInt(prev.updatedAt, 0), normalizeRtcInt(row.updatedAt, 0)),
    });
  });

  return merged.sort(compareCallContactRows);
}

function listStoredCallContactRows(profileId) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return [];
  const user = ensureProfileUser(pid);
  const map = user && user.callContacts && typeof user.callContacts === "object" ? user.callContacts : {};
  return Object.values(map).map((row) => normalizeCallContactRow(row)).filter((row) => row.contactKey);
}

function isMutualFriendCallContact(peerProfileId, viewerProfileIds) {
  const pid = sanitizeText(peerProfileId || "", 180);
  const ids = Array.isArray(viewerProfileIds)
    ? viewerProfileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean)
    : [];
  if (!pid || ids.length <= 0) return false;

  const viewerProfileIdSet = new Set(ids);
  const viewerUserIdSet = new Set(ids.map((value) => extractUserIdFromProfileId(value)).filter(Boolean));

  return listCallContacts(pid, 500).some((rowRaw) => {
    const row = normalizeCallContactRow(rowRaw);
    if (row.isFriend !== true) return false;
    const rowPeerProfileId = sanitizeText(row.peerProfileId || "", 180);
    const rowPeerUserId = sanitizeText(row.peerUserId || "", 128);
    if (rowPeerProfileId && viewerProfileIdSet.has(rowPeerProfileId)) return true;
    if (rowPeerUserId && viewerUserIdSet.has(rowPeerUserId)) return true;
    return false;
  });
}

function isRecallBlockedForProfile(profileId, actor) {
  const pid = sanitizeText(profileId || "", 180);
  const actorMeta = actor && typeof actor === "object" ? actor : {};
  const actorSessionId = sanitizeText(actorMeta.sessionId || "", 256);
  const actorProfileId = sanitizeText(actorMeta.profileId || "", 180);
  const actorUserId = sanitizeText(actorMeta.userId || "", 128);
  if (!pid || (!actorSessionId && !actorProfileId && !actorUserId)) return false;
  return listStoredCallContactRows(pid).some((row) => {
    if (normalizeRtcInt(row.recallBlockedAt, 0) <= 0) return false;
    return Boolean(
      (actorProfileId && sanitizeText(row.peerProfileId || "", 180) === actorProfileId) ||
      (actorSessionId && sanitizeText(row.peerSessionId || "", 256) === actorSessionId) ||
      (actorUserId && sanitizeText(row.peerUserId || "", 128) === actorUserId)
    );
  });
}

async function resolveActorProfileIds(req, body) {
  const b = body || {};
  const actorSessionId = sanitizeText(b.sessionId || b.deviceKey || "", 256);
  const userId = sanitizeText(b.userId || (req && req.headers && req.headers["x-user-id"]) || "", 128);
  const token = parseBearer(req);
  const ids = [];
  const pushId = (value) => {
    const pid = sanitizeText(value || "", 180);
    if (!pid || ids.includes(pid)) return;
    ids.push(pid);
  };

  if (actorSessionId) {
    const actorLive = await resolvePeerSessionForCallContact(actorSessionId);
    pushId(actorLive && actorLive.profileId);
    pushId(profileIdFromSignalSession(actorSessionId, token, userId));
    pushId(profileIdFromSignalSession(actorSessionId, token));
  }

  pushId(computeProfileId(req, body));
  return ids;
}

async function resolveActorProfileIdsForSignal(actorSessionId) {
  const sid = sanitizeText(actorSessionId || "", 256);
  if (!sid) return [];
  const ids = [];
  const pushId = (value) => {
    const pid = sanitizeText(value || "", 180);
    if (!pid || ids.includes(pid)) return;
    ids.push(pid);
  };

  const actorLive = await resolvePeerSessionForCallContact(sid);
  pushId(actorLive && actorLive.profileId);

  const local = sessions.get(sid);
  pushId(local && local.profileId);
  pushId(profileIdFromSignalSession(sid, local && local.token, local && local.userId));
  pushId(profileIdFromSignalSession(sid, local && local.token));

  if (isRtcClusterActive()) {
    const record = await getRtcSessionRecord(sid);
    pushId(record && record.profileId);
    pushId(profileIdFromSignalSession(sid, record && record.token, record && record.userId));
    pushId(profileIdFromSignalSession(sid, record && record.token));
  }

  return ids;
}

function applyCallContactMutation(profileIds, payload, options) {
  const ids = Array.isArray(profileIds)
    ? profileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean)
    : [sanitizeText(profileIds || "", 180)].filter(Boolean);
  if (ids.length <= 0) {
    return {
      row: null,
      profileIds: [],
    };
  }

  let selectedRow = null;
  ids.forEach((profileId) => {
    const row = upsertCallContact(profileId, payload, options);
    if (!selectedRow && row) {
      selectedRow = row;
    }
  });

  return {
    row: selectedRow,
    profileIds: ids,
  };
}

function resolveLocalProfileSessionForCallContact(profileId, preferredSessionId = "") {
  const pid = sanitizeText(profileId || "", 180);
  const preferredSid = sanitizeText(preferredSessionId || "", 256);
  if (!pid) return null;
  let preferred = null;
  let waiting = null;
  let online = null;
  sessions.forEach((entry, sessionId) => {
    if (!entry || !isWsAlive(entry.ws)) return;
    if (sanitizeText(entry.profileId || "", 180) !== pid) return;
    const next = {
      sessionId,
      sessionKey: sanitizeText(entry.sessionKey || toSessionKey(sessionId), 128),
      profileId: pid,
      country: normalizeMatchCountry(entry.country || ""),
      language: normalizeMatchLanguage(entry.language || entry.lang || ""),
      gender: normalizeMatchGender(entry.gender || ""),
      interests: normalizeMatchInterestArray(entry.interests, { allowAll: false, fallbackToAll: false }),
      roomId: sanitizeText((entry.ws && entry.ws._roomId) || "", 128),
      enqueuedAt: normalizeRtcInt(entry.enqueuedAt, 0),
      online: true,
      source: "local_profile",
    };
    if (preferredSid && sessionId === preferredSid) {
      preferred = next;
      return;
    }
    if (!next.roomId && next.enqueuedAt > 0 && !waiting) {
      waiting = next;
      return;
    }
    if (!online) {
      online = next;
    }
  });
  return preferred || waiting || online || null;
}

async function resolveQueuedProfileSessionForCallContact(profileId, preferredSessionId = "") {
  const pid = sanitizeText(profileId || "", 180);
  const preferredSid = sanitizeText(preferredSessionId || "", 256);
  if (!pid || !isRtcClusterActive()) return null;
  const queued = await listRtcQueueMembers(Math.max(RTC_MATCH_SCAN_LIMIT, 1000));
  if (!Array.isArray(queued) || queued.length <= 0) return null;
  const sessionMap = await getRtcSessionRecordMap(queued);
  let waiting = null;
  queued.forEach((sid) => {
    const record = sessionMap.get(sid);
    if (!record) return;
    if (sanitizeText(record.profileId || "", 180) !== pid) return;
    if (sanitizeText(record.roomId || "", 128)) return;
    if (normalizeRtcInt(record.enqueuedAt, 0) <= 0) return;
    const next = {
      sessionId: sid,
      sessionKey: sanitizeText(record.sessionKey || toSessionKey(sid), 128),
      profileId: pid,
      country: normalizeMatchCountry(record.country || ""),
      language: normalizeMatchLanguage(record.language || record.lang || ""),
      gender: normalizeMatchGender(record.gender || ""),
      interests: normalizeMatchInterestArray(record.interests, { allowAll: false, fallbackToAll: false }),
      roomId: "",
      enqueuedAt: normalizeRtcInt(record.enqueuedAt, 0),
      online: true,
      source: "cluster_queue_profile",
    };
    if (preferredSid && sid === preferredSid) {
      waiting = next;
      return;
    }
    if (!waiting) {
      waiting = next;
    }
  });
  return waiting;
}

async function resolvePeerSessionForCallContact(sessionId, profileId = "") {
  const sid = sanitizeText(sessionId || "", 256);
  const pid = sanitizeText(profileId || "", 180);
  if (sid) {
    const local = sessions.get(sid);
    if (local && isWsAlive(local.ws)) {
      return {
        sessionId: sid,
        sessionKey: sanitizeText(local.sessionKey || toSessionKey(sid), 128),
        profileId: sanitizeText(local.profileId || "", 180),
        country: normalizeMatchCountry(local.country || ""),
        language: normalizeMatchLanguage(local.language || local.lang || ""),
        gender: normalizeMatchGender(local.gender || ""),
        interests: normalizeMatchInterestArray(local.interests, { allowAll: false, fallbackToAll: false }),
        roomId: sanitizeText((local.ws && local.ws._roomId) || "", 128),
        enqueuedAt: normalizeRtcInt(local.enqueuedAt, 0),
        online: true,
        source: "local",
      };
    }
    if (isRtcClusterActive()) {
      const remote = await getRtcSessionRecord(sid);
      if (remote) {
        return {
          sessionId: sid,
          sessionKey: sanitizeText(remote.sessionKey || toSessionKey(sid), 128),
          profileId: sanitizeText(remote.profileId || "", 180),
          country: normalizeMatchCountry(remote.country || ""),
          language: normalizeMatchLanguage(remote.language || remote.lang || ""),
          gender: normalizeMatchGender(remote.gender || ""),
          interests: normalizeMatchInterestArray(remote.interests, { allowAll: false, fallbackToAll: false }),
          roomId: sanitizeText(remote.roomId || "", 128),
          enqueuedAt: normalizeRtcInt(remote.enqueuedAt, 0),
          online: true,
          source: "cluster",
        };
      }
    }
  }
  const localByProfile = resolveLocalProfileSessionForCallContact(pid, sid);
  if (localByProfile) return localByProfile;
  const queuedByProfile = await resolveQueuedProfileSessionForCallContact(pid, sid);
  if (queuedByProfile) return queuedByProfile;
  return null;
}

function extractUserIdFromProfileId(profileId) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid || !pid.startsWith("u:")) return "";
  return normalizeLoginUserId(pid.slice(2));
}

function profileIdFromUserId(userId) {
  const uid = normalizeLoginUserId(userId);
  return uid ? `u:${uid}` : "";
}

function resolveActiveHomePresenceForProfile(profileId, excludeSessionKey = "") {
  const userId = extractUserIdFromProfileId(profileId);
  if (!userId) return null;
  const excludeKey = sanitizeText(excludeSessionKey || "", 200);
  const rows = listActiveLoginPresence(500, LOGIN_ACTIVE_WINDOW_MS);
  let matched = null;
  rows.forEach((rowRaw) => {
    const row = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
    if (normalizeLoginUserId(row.userId) !== userId) return;
    const sessionKey = sanitizeText(row.sessionKey || "", 200);
    if (excludeKey && sessionKey === excludeKey) return;
    if (!matched) {
      matched = row;
      return;
    }
    if (normalizeRtcInt(row.lastSeenAtMs, 0) > normalizeRtcInt(matched.lastSeenAtMs, 0)) {
      matched = row;
    }
  });
  return matched;
}

function cleanupCallRecallInvites() {
  const nowMs = now();
  callRecallInviteStore.forEach((row, inviteId) => {
    const invite = row && typeof row === "object" ? row : {};
    const expiresAt = normalizeRtcInt(invite.expiresAtMs || invite.expiresAt || 0, 0);
    const updatedAt = normalizeRtcInt(invite.updatedAtMs || invite.updatedAt || invite.createdAtMs || invite.createdAt || 0, 0);
    const status = sanitizeText(invite.status || "pending", 24).toLowerCase();
    if (status === "pending" && expiresAt > 0 && expiresAt <= nowMs) {
      invite.status = "expired";
      invite.updatedAtMs = nowMs;
      callRecallInviteStore.set(inviteId, invite);
      return;
    }
    if (status !== "pending" && updatedAt > 0 && updatedAt + CALL_RECALL_INVITE_TTL_MS <= nowMs) {
      callRecallInviteStore.delete(inviteId);
    }
  });
}

function createCallRecallInvite(input) {
  cleanupCallRecallInvites();
  const payload = input && typeof input === "object" ? input : {};
  const actorSessionId = sanitizeText(payload.actorSessionId || "", 256);
  const actorProfileId = sanitizeText(payload.actorProfileId || "", 180);
  const peerSessionId = sanitizeText(payload.peerSessionId || "", 256);
  const peerProfileId = sanitizeText(payload.peerProfileId || "", 180);
  if (!actorSessionId || !actorProfileId || !peerProfileId) return null;

  const actorSeed = buildRtcPeerInfoSeed(
    {
      ...(payload.actorLive && typeof payload.actorLive === "object" ? payload.actorLive : {}),
      sessionId: actorSessionId,
      profileId: actorProfileId,
    },
    actorSessionId
  );
  const createdAtMs = now();
  const inviteId = `recall_${createdAtMs}_${crypto.randomBytes(4).toString("hex")}`;
  const invite = {
    inviteId,
    status: "pending",
    createdAtMs,
    updatedAtMs: createdAtMs,
    expiresAtMs: createdAtMs + CALL_RECALL_INVITE_TTL_MS,
    actorSessionId,
    actorProfileId,
    actorSessionKey: sanitizeText(payload.actorSessionKey || toSessionKey(actorSessionId), 128),
    actorNickname: sanitizeText(actorSeed.nickname || actorSeed.displayName || "", PROFILE_NICKNAME_MAX_LEN),
    actorAvatarUrl: resolveStoredProfileAvatarUrl({ avatarUrl: actorSeed.avatarUrl }),
    actorCountry: normalizeMatchCountry(actorSeed.country || ""),
    actorLanguage: normalizeMatchLanguage(actorSeed.language || actorSeed.lang || ""),
    actorGender: normalizeMatchGender(actorSeed.gender || ""),
    actorFlag: sanitizeText(actorSeed.flag || "", 8),
    actorLoginAccount: resolveCallReportLoginAccount(actorProfileId, ""),
    peerSessionId,
    peerProfileId,
    peerPresenceSessionKey: sanitizeText(payload.peerPresenceSessionKey || "", 200),
  };
  callRecallInviteStore.set(inviteId, invite);
  return invite;
}

function listPendingCallRecallInvitesForPeer(peerProfileIds, peerSessionId = "") {
  cleanupCallRecallInvites();
  const sessionId = sanitizeText(peerSessionId || "", 256);
  const profileIdSet = new Set(
    (Array.isArray(peerProfileIds) ? peerProfileIds : []).map((value) => sanitizeText(value || "", 180)).filter(Boolean)
  );
  return Array.from(callRecallInviteStore.values())
    .filter((row) => {
      const invite = row && typeof row === "object" ? row : {};
      if (sanitizeText(invite.status || "", 24).toLowerCase() !== "pending") return false;
      const invitePeerProfileId = sanitizeText(invite.peerProfileId || "", 180);
      const invitePeerSessionId = sanitizeText(invite.peerSessionId || "", 256);
      if (invitePeerProfileId && profileIdSet.has(invitePeerProfileId)) return true;
      if (sessionId && invitePeerSessionId && invitePeerSessionId === sessionId) return true;
      return false;
    })
    .sort((a, b) => normalizeRtcInt(b.createdAtMs, 0) - normalizeRtcInt(a.createdAtMs, 0));
}

function serializeCallRecallInviteStatus(invite) {
  const row = invite && typeof invite === "object" ? invite : {};
  return {
    inviteId: sanitizeText(row.inviteId || "", 128),
    status: sanitizeText(row.status || "pending", 24).toLowerCase() || "pending",
    actorSessionId: sanitizeText(row.actorSessionId || "", 256) || undefined,
    actorProfileId: sanitizeText(row.actorProfileId || "", 180) || undefined,
    peerSessionId: sanitizeText(row.peerSessionId || "", 256) || undefined,
    peerProfileId: sanitizeText(row.peerProfileId || "", 180) || undefined,
    acceptedPeerSessionId: sanitizeText(row.acceptedPeerSessionId || "", 256) || undefined,
    createdAtMs: normalizeRtcInt(row.createdAtMs || row.createdAt, 0),
    updatedAtMs: normalizeRtcInt(row.updatedAtMs || row.updatedAt, 0),
    expiresAtMs: normalizeRtcInt(row.expiresAtMs || row.expiresAt, 0),
  };
}

async function enrichCallContactRow(row, viewerProfileIds = []) {
  const base = normalizeCallContactRow(row);
  if (!base.contactKey) return null;
  const live = await resolvePeerSessionForCallContact(base.peerSessionId, base.peerProfileId);
  const homePresence = !live && base.peerProfileId ? resolveActiveHomePresenceForProfile(base.peerProfileId) : null;
  const online = Boolean((live && live.online) || homePresence);
  const waiting = Boolean(live && !live.roomId && normalizeRtcInt(live.enqueuedAt, 0) > 0);
  const resolvedPeerProfileId = base.peerProfileId || sanitizeText(live && live.profileId, 180) || profileIdFromUserId(base.peerUserId);
  const storedProfile = getStoredProfileUserRow(resolvedPeerProfileId);
  const storedMatch = resolveStoredProfileMatchData(resolvedPeerProfileId);
  const publicProfile = buildPublicProfilePayload(resolvedPeerProfileId, storedProfile);
  const aliasProfile = findBestStoredProfileRowByLoginAccount(resolveCallReportLoginAccount(resolvedPeerProfileId, base.peerLoginAccount), resolvedPeerProfileId) || {};
  const storedNickname = pickPreferredProfileNickname(
    publicProfile.nickname,
    resolveStoredProfileNickname(storedProfile, resolvedPeerProfileId),
    base.peerNickname
  );
  const storedAvatarUrl =
    resolveStoredProfileAvatarUrl({ avatarDataUrl: publicProfile.avatarUrl, avatarUrl: publicProfile.avatarUrl }) ||
    resolveStoredProfileAvatarUrl(storedProfile);
  const storedInterests = normalizeMatchInterestArray(publicProfile.interests || storedProfile.interests || base.peerInterests, {
    allowAll: false,
    fallbackToAll: false,
  }).slice(0, PROFILE_INTEREST_MAX_COUNT);
  const resolvedCountry =
    normalizeMatchCountry((live && live.country) || (homePresence && homePresence.country) || storedMatch.country || storedProfile.country || aliasProfile.country || "") ||
    base.peerCountry;
  const resolvedLanguage =
    normalizeMatchLanguage((live && live.language) || (homePresence && homePresence.language) || storedMatch.language || storedProfile.language || storedProfile.lang || aliasProfile.language || aliasProfile.lang || "") ||
    base.peerLanguage;
  const resolvedGender =
    normalizeMatchGender((live && live.gender) || (homePresence && homePresence.gender) || storedMatch.gender || storedProfile.gender || aliasProfile.gender || "") ||
    base.peerGender;
  const resolvedFlag =
    sanitizeText((homePresence && homePresence.flag) || storedProfile.flag || aliasProfile.flag || "", 8) ||
    base.peerFlag;
  return {
    ...base,
    peerSessionId: sanitizeText(live && live.sessionId, 256) || base.peerSessionId,
    peerProfileId: resolvedPeerProfileId,
    peerSessionKey: sanitizeText(live && live.sessionKey, 128) || base.peerSessionKey,
    peerNickname: pickPreferredProfileNickname(storedNickname, base.peerNickname),
    peerAvatarUrl: storedAvatarUrl || base.peerAvatarUrl || undefined,
    peerCountry: resolvedCountry,
    peerLanguage: resolvedLanguage,
    peerGender: resolvedGender,
    peerFlag: resolvedFlag,
    peerLoginAccount:
      base.peerLoginAccount ||
      sanitizeText(homePresence && homePresence.loginAccount, 240) ||
      resolveCallReportLoginAccount(resolvedPeerProfileId, ""),
    peerInterests: storedInterests,
    isOnline: online,
    canRecall: waiting,
    isMutualFriend: base.isFriend === true && isMutualFriendCallContact(resolvedPeerProfileId, viewerProfileIds),
  };
}

function matchesCallContactFilter(row, filters) {
  const meta = filters && typeof filters === "object" ? filters : {};
  const roomId = sanitizeText(meta.roomId || "", 120);
  const peerSessionId = sanitizeText(meta.peerSessionId || "", 256);
  const peerProfileId = sanitizeText(meta.peerProfileId || "", 180);
  const peerUserId = sanitizeText(meta.peerUserId || "", 128);
  if (!roomId && !peerSessionId && !peerProfileId && !peerUserId) return true;
  const rowRoomId = sanitizeText(row && row.roomId, 120);
  const rowPeerSessionId = sanitizeText(row && row.peerSessionId, 256);
  const rowPeerProfileId = sanitizeText(row && row.peerProfileId, 180);
  const rowPeerUserId = sanitizeText(row && row.peerUserId, 128);
  return Boolean(
    (roomId && rowRoomId === roomId) ||
    (peerSessionId && rowPeerSessionId === peerSessionId) ||
    (peerProfileId && rowPeerProfileId === peerProfileId) ||
    (peerUserId && rowPeerUserId === peerUserId)
  );
}

async function listEnrichedCallContacts(profileId, limit = 200, filters = null) {
  const rows = listCallContacts(profileId, limit).filter((row) => matchesCallContactFilter(row, filters));
  const enriched = await Promise.all(rows.map((row) => enrichCallContactRow(row, [profileId])));
  return enriched.filter(Boolean);
}

async function listEnrichedCallContactsForProfiles(profileIds, limit = 200, filters = null) {
  const ids = Array.isArray(profileIds) ? profileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean) : [];
  if (ids.length <= 0) return [];
  const hardLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.trunc(Number(limit)))) : 200;
  const rows = mergeCallContactRows(
    ids.flatMap((profileId) => listCallContacts(profileId, Math.max(hardLimit * 3, 300)))
  ).filter((row) => matchesCallContactFilter(row, filters));
  const enriched = await Promise.all(rows.slice(0, hardLimit).map((row) => enrichCallContactRow(row, ids)));
  return enriched.filter(Boolean);
}

async function listEnrichedFollowerCallContactsForProfiles(profileIds, limit = 200, filters = null) {
  const ids = Array.isArray(profileIds) ? profileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean) : [];
  if (ids.length <= 0) return [];

  const hardLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.trunc(Number(limit)))) : 200;
  const viewerProfileIdSet = new Set(ids);
  const viewerUserIdSet = new Set(ids.map((value) => extractUserIdFromProfileId(value)).filter(Boolean));
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : {};
  const rows = [];

  Object.entries(users).forEach(([profileIdRaw, rowRaw]) => {
    const source = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
    const followerProfileId = sanitizeText(source.profileId || profileIdRaw, 180);
    if (!followerProfileId) return;
    if (viewerProfileIdSet.has(followerProfileId)) return;
    const followerUserId = extractUserIdFromProfileId(followerProfileId);
    if (followerUserId && viewerUserIdSet.has(followerUserId)) return;

    listStoredCallContactRows(followerProfileId).forEach((item) => {
      if (item.isFriend !== true) return;
      if (!callContactMatchesViewer(item, viewerProfileIdSet, viewerUserIdSet)) return;
      const reverseRow = buildFollowerCallContactRow(followerProfileId, item);
      if (reverseRow) rows.push(reverseRow);
    });
  });

  const merged = mergeCallContactRows(rows).filter((row) => matchesCallContactFilter(row, filters));
  const enriched = await Promise.all(merged.slice(0, hardLimit).map((row) => enrichCallContactRow(row, ids)));
  return enriched.filter(Boolean);
}

async function tryRecallContactPair(actorSessionId, peerSessionId, peerProfileId = "") {
  const actorSid = sanitizeText(actorSessionId || "", 256);
  const peerSid = sanitizeText(peerSessionId || "", 256);
  const peerPid = sanitizeText(peerProfileId || "", 180);
  if (!actorSid || (!peerSid && !peerPid)) {
    return { ok: false, errorCode: "PEER_SESSION_ID_REQUIRED", errorMessage: "PEER_SESSION_ID_REQUIRED" };
  }

  const actorLive = await resolvePeerSessionForCallContact(actorSid);
  const peerLive = await resolvePeerSessionForCallContact(peerSid, peerPid);
  const peerHomePresence = !peerLive && peerPid ? resolveActiveHomePresenceForProfile(peerPid) : null;
  if (!actorLive) {
    return { ok: false, errorCode: "ACTOR_SESSION_OFFLINE", errorMessage: "ACTOR_SESSION_OFFLINE" };
  }
  const actorProfileId = sanitizeText(actorLive.profileId || "", 180);
  const actorUserId = extractUserIdFromProfileId(actorProfileId);
  const actorBlockMeta = {
    sessionId: actorSid,
    profileId: actorProfileId,
    userId: actorUserId,
  };
  if (!peerLive && !peerHomePresence) {
    return { ok: false, errorCode: "PEER_NOT_AVAILABLE", errorMessage: "PEER_NOT_AVAILABLE" };
  }
  if (peerPid && isRecallBlockedForProfile(peerPid, actorBlockMeta)) {
    return { ok: false, errorCode: "RECALL_BLOCKED", errorMessage: "RECALL_BLOCKED" };
  }
  if (!peerLive && peerHomePresence) {
    const invite = createCallRecallInvite({
      actorSessionId: actorSid,
      actorProfileId,
      actorSessionKey: sanitizeText(actorLive.sessionKey || toSessionKey(actorSid), 128),
      actorLive,
      peerSessionId: peerSid,
      peerProfileId: peerPid,
      peerPresenceSessionKey: sanitizeText(peerHomePresence.sessionKey || "", 200),
    });
    if (!invite) {
      return { ok: false, errorCode: "RECALL_INVITE_FAILED", errorMessage: "RECALL_INVITE_FAILED" };
    }
    return {
      ok: true,
      actorSessionId: actorSid,
      peerSessionId: peerSid || undefined,
      invitePending: true,
      inviteId: invite.inviteId,
    };
  }
  const resolvedPeerSid = sanitizeText(peerLive.sessionId || peerSid, 256);
  if (!resolvedPeerSid || actorSid === resolvedPeerSid) {
    return { ok: false, errorCode: "INVALID_PEER_SESSION", errorMessage: "INVALID_PEER_SESSION" };
  }
  const resolvedPeerProfileId = sanitizeText(peerLive.profileId || peerPid, 180);
  if (resolvedPeerProfileId && isRecallBlockedForProfile(resolvedPeerProfileId, actorBlockMeta)) {
    return { ok: false, errorCode: "RECALL_BLOCKED", errorMessage: "RECALL_BLOCKED" };
  }
  if (hasBlockBetweenSessions(actorSid, resolvedPeerSid)) {
    return { ok: false, errorCode: "PAIR_BLOCKED", errorMessage: "PAIR_BLOCKED" };
  }
  if (actorLive.roomId) {
    return { ok: false, errorCode: "ACTOR_ALREADY_IN_ROOM", errorMessage: "ACTOR_ALREADY_IN_ROOM" };
  }
  if (peerLive.roomId) {
    return { ok: false, errorCode: "PEER_ALREADY_IN_ROOM", errorMessage: "PEER_ALREADY_IN_ROOM" };
  }
  if (normalizeRtcInt(peerLive.enqueuedAt, 0) <= 0) {
    return { ok: false, errorCode: "PEER_NOT_WAITING", errorMessage: "PEER_NOT_WAITING" };
  }

  if (isRtcClusterActive()) {
    const actorRecord = await getRtcSessionRecord(actorSid);
    const peerRecord = await getRtcSessionRecord(resolvedPeerSid);
    if (!actorRecord || !peerRecord) {
      return { ok: false, errorCode: "SESSION_LOOKUP_FAILED", errorMessage: "SESSION_LOOKUP_FAILED" };
    }
    const created = await createClusterRoom(actorRecord, peerRecord);
    if (!created) {
      return { ok: false, errorCode: "RECALL_MATCH_FAILED", errorMessage: "RECALL_MATCH_FAILED" };
    }
    return { ok: true, actorSessionId: actorSid, peerSessionId: resolvedPeerSid };
  }

  const actorEntry = sessions.get(actorSid);
  const peerEntry = sessions.get(resolvedPeerSid);
  if (!actorEntry || !peerEntry || !isWsAlive(actorEntry.ws) || !isWsAlive(peerEntry.ws)) {
    return { ok: false, errorCode: "SESSION_LOOKUP_FAILED", errorMessage: "SESSION_LOOKUP_FAILED" };
  }
  removeLocalQueueMember(actorSid);
  removeLocalQueueMember(resolvedPeerSid);
  actorEntry.enqueuedAt = null;
  peerEntry.enqueuedAt = null;
  const created = createRoom(actorSid, resolvedPeerSid);
  if (!created) {
    return { ok: false, errorCode: "RECALL_MATCH_FAILED", errorMessage: "RECALL_MATCH_FAILED" };
  }
  return { ok: true, actorSessionId: actorSid, peerSessionId: resolvedPeerSid };
}

async function respondToCallRecallInvite(inviteId, peerSessionId, peerProfileIds, accept, blockFuture = false) {
  cleanupCallRecallInvites();
  const inviteKey = sanitizeText(inviteId || "", 128);
  const peerSid = sanitizeText(peerSessionId || "", 256);
  const peerIds = Array.isArray(peerProfileIds) ? peerProfileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean) : [];
  if (!inviteKey || !peerSid) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT" };
  }

  const invite = callRecallInviteStore.get(inviteKey);
  if (!invite || sanitizeText(invite.status || "", 24).toLowerCase() !== "pending") {
    return { ok: false, errorCode: "RECALL_INVITE_NOT_FOUND", errorMessage: "RECALL_INVITE_NOT_FOUND" };
  }
  if (normalizeRtcInt(invite.expiresAtMs, 0) <= now()) {
    callRecallInviteStore.delete(inviteKey);
    return { ok: false, errorCode: "RECALL_INVITE_EXPIRED", errorMessage: "RECALL_INVITE_EXPIRED" };
  }

  const invitePeerProfileId = sanitizeText(invite.peerProfileId || "", 180);
  if (invitePeerProfileId && peerIds.length > 0 && !peerIds.includes(invitePeerProfileId)) {
    return { ok: false, errorCode: "RECALL_INVITE_FORBIDDEN", errorMessage: "RECALL_INVITE_FORBIDDEN" };
  }

  if (!accept) {
    if (blockFuture) {
      applyCallContactMutation(
        peerIds,
        {
          peerSessionId: sanitizeText(invite.actorSessionId || "", 256),
          peerProfileId: sanitizeText(invite.actorProfileId || "", 180),
          peerSessionKey: sanitizeText(invite.actorSessionKey || "", 128),
          peerNickname: sanitizeText(invite.actorNickname || "", PROFILE_NICKNAME_MAX_LEN),
          peerLoginAccount: sanitizeText(invite.actorLoginAccount || "", 240),
          peerCountry: sanitizeText(invite.actorCountry || "", 16),
          peerLanguage: sanitizeText(invite.actorLanguage || "", 16),
          peerGender: sanitizeText(invite.actorGender || "", 16),
          peerFlag: sanitizeText(invite.actorFlag || "", 8),
          peerUserId: extractUserIdFromProfileId(sanitizeText(invite.actorProfileId || "", 180)),
        },
        { kind: "recall_block", enabled: true }
      );
    }
    invite.status = blockFuture ? "blocked" : "declined";
    invite.updatedAtMs = now();
    callRecallInviteStore.set(inviteKey, invite);
    return { ok: true, inviteId: inviteKey, declined: !blockFuture, blocked: blockFuture };
  }

  const actorSid = sanitizeText(invite.actorSessionId || "", 256);
  const actorPid = sanitizeText(invite.actorProfileId || "", 180);
  const actorLive = await resolvePeerSessionForCallContact(actorSid, actorPid);
  const peerLive = await resolvePeerSessionForCallContact(peerSid, invitePeerProfileId);
  if (!actorLive) {
    invite.status = "expired";
    invite.updatedAtMs = now();
    callRecallInviteStore.set(inviteKey, invite);
    return { ok: false, errorCode: "ACTOR_SESSION_OFFLINE", errorMessage: "ACTOR_SESSION_OFFLINE" };
  }
  if (!peerLive) {
    return { ok: false, errorCode: "PEER_NOT_AVAILABLE", errorMessage: "PEER_NOT_AVAILABLE" };
  }
  const resolvedPeerSid = sanitizeText(peerLive.sessionId || peerSid, 256);
  if (!resolvedPeerSid || actorSid === resolvedPeerSid) {
    return { ok: false, errorCode: "INVALID_PEER_SESSION", errorMessage: "INVALID_PEER_SESSION" };
  }
  if (hasBlockBetweenSessions(actorSid, resolvedPeerSid)) {
    return { ok: false, errorCode: "PAIR_BLOCKED", errorMessage: "PAIR_BLOCKED" };
  }
  if (actorLive.roomId) {
    return { ok: false, errorCode: "ACTOR_ALREADY_IN_ROOM", errorMessage: "ACTOR_ALREADY_IN_ROOM" };
  }
  if (peerLive.roomId) {
    return { ok: false, errorCode: "PEER_ALREADY_IN_ROOM", errorMessage: "PEER_ALREADY_IN_ROOM" };
  }

  if (isRtcClusterActive()) {
    const actorRecord = await getRtcSessionRecord(actorSid);
    const peerRecord = await getRtcSessionRecord(resolvedPeerSid);
    if (!actorRecord || !peerRecord) {
      return { ok: false, errorCode: "SESSION_LOOKUP_FAILED", errorMessage: "SESSION_LOOKUP_FAILED" };
    }
    const created = await createClusterRoom(actorRecord, peerRecord);
    if (!created) {
      return { ok: false, errorCode: "RECALL_MATCH_FAILED", errorMessage: "RECALL_MATCH_FAILED" };
    }
  } else {
    const actorEntry = sessions.get(actorSid);
    const peerEntry = sessions.get(resolvedPeerSid);
    if (!actorEntry || !peerEntry || !isWsAlive(actorEntry.ws) || !isWsAlive(peerEntry.ws)) {
      return { ok: false, errorCode: "SESSION_LOOKUP_FAILED", errorMessage: "SESSION_LOOKUP_FAILED" };
    }
    removeLocalQueueMember(actorSid);
    removeLocalQueueMember(resolvedPeerSid);
    actorEntry.enqueuedAt = null;
    peerEntry.enqueuedAt = null;
    const created = createRoom(actorSid, resolvedPeerSid);
    if (!created) {
      return { ok: false, errorCode: "RECALL_MATCH_FAILED", errorMessage: "RECALL_MATCH_FAILED" };
    }
  }

  invite.status = "accepted";
  invite.updatedAtMs = now();
  invite.acceptedPeerSessionId = resolvedPeerSid;
  callRecallInviteStore.set(inviteKey, invite);
  return { ok: true, inviteId: inviteKey, actorSessionId: actorSid, peerSessionId: resolvedPeerSid };
}

function appendCallReport(report) {
  normalizeCallSafetyStoreShape();
  const list = profileStore.callReports;
  const row = {
    reportId: sanitizeText(report && report.reportId, 128) || `r_${now()}_${Math.random().toString(16).slice(2, 10)}`,
    createdAt: Number.isFinite(Number(report && report.createdAt)) ? Math.max(0, Math.trunc(Number(report.createdAt))) : now(),
    roomId: sanitizeText(report && report.roomId, 120),
    reasonCode: sanitizeReasonCode(report && report.reasonCode),
    reasonLabel: sanitizeReasonLabel(report && report.reasonLabel),
    reasonDetail: sanitizeReasonDetail(report && report.reasonDetail),
    reporterProfileId: sanitizeText(report && report.reporterProfileId, 180),
    reporterSessionKey: sanitizeText(report && report.reporterSessionKey, 128),
    reporterLoginAccount: normalizeLoginAccountValue(report && report.reporterLoginAccount),
    targetProfileId: sanitizeText(report && report.targetProfileId, 180),
    targetSessionKey: sanitizeText(report && report.targetSessionKey, 128),
    targetLoginAccount: normalizeLoginAccountValue(report && report.targetLoginAccount),
    status: sanitizeText(report && report.status, 40) || "new",
    emailStatus: sanitizeText(report && report.emailStatus, 40) || "pending",
    emailError: sanitizeText(report && report.emailError, 220),
    source: sanitizeText(report && report.source, 80),
  };
  list.push(row);
  if (list.length > CALL_REPORTS_LIMIT) {
    list.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    list.splice(0, list.length - CALL_REPORTS_LIMIT);
  }
  schedulePersistProfileStore({ type: "call_report", reportId: row.reportId });
  return row;
}

function updateCallReportMailResult(reportId, ok, code) {
  if (!reportId) return;
  normalizeCallSafetyStoreShape();
  const list = profileStore.callReports;
  const target = list.find((row) => String(row && row.reportId || "") === String(reportId));
  if (!target) return;
  target.emailStatus = ok ? "sent" : "failed";
  target.emailError = ok ? "" : sanitizeText(code || "EMAIL_SEND_FAILED", 220);
  schedulePersistProfileStore({ type: "call_report", reportId: target.reportId });
}

function resolveCallReportLoginAccount(profileId, fallbackLoginAccount = "") {
  const stored = readStoredLoginAccountByProfileId(profileId);
  if (stored) return stored;
  return normalizeLoginAccountValue(fallbackLoginAccount);
}

async function trySendCallReportMail(reportRow) {
  const to = sanitizeText(CALL_REPORT_EMAIL_TO, 240);
  if (!to) return { ok: false, code: "CALL_REPORT_EMAIL_TO_MISSING" };
  if (!nodemailer) return { ok: false, code: "NODEMAILER_NOT_INSTALLED" };

  const host = sanitizeText(process.env.CALL_REPORT_SMTP_HOST || "", 240);
  const user = sanitizeText(process.env.CALL_REPORT_SMTP_USER || "", 240);
  const pass = String(process.env.CALL_REPORT_SMTP_PASS || "").trim();
  const from = sanitizeText(process.env.CALL_REPORT_SMTP_FROM || user, 240);
  const portRaw = Number(process.env.CALL_REPORT_SMTP_PORT || 465);
  const port = Number.isFinite(portRaw) ? Math.max(1, Math.trunc(portRaw)) : 465;
  const secureRaw = String(process.env.CALL_REPORT_SMTP_SECURE || "").trim().toLowerCase();
  const secure = secureRaw
    ? secureRaw === "1" || secureRaw === "true" || secureRaw === "yes"
    : port === 465;

  if (!host || !user || !pass || !from) return { ok: false, code: "SMTP_NOT_CONFIGURED" };

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const ts = Number(reportRow && reportRow.createdAt) || now();
  const dateIso = new Date(ts).toISOString();
  const subject = `[RanChat] 신고 접수 ${sanitizeText(reportRow && reportRow.reasonCode, 80)} (${dateIso})`;
  const text = [
    `reportId: ${sanitizeText(reportRow && reportRow.reportId, 128)}`,
    `createdAt: ${dateIso}`,
    `roomId: ${sanitizeText(reportRow && reportRow.roomId, 120)}`,
    `reasonCode: ${sanitizeText(reportRow && reportRow.reasonCode, 80)}`,
    `reasonLabel: ${sanitizeText(reportRow && reportRow.reasonLabel, 120)}`,
    `reasonDetail: ${sanitizeText(reportRow && reportRow.reasonDetail, 1200)}`,
    `reporterProfileId: ${sanitizeText(reportRow && reportRow.reporterProfileId, 180)}`,
    `reporterSessionKey: ${sanitizeText(reportRow && reportRow.reporterSessionKey, 128)}`,
    `targetProfileId: ${sanitizeText(reportRow && reportRow.targetProfileId, 180)}`,
    `targetSessionKey: ${sanitizeText(reportRow && reportRow.targetSessionKey, 128)}`,
  ].join("\n");

  await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });

  return { ok: true, code: "EMAIL_SENT" };
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

function normalizeMatchLanguage(v) {
  const lower = String(v || "").trim().toLowerCase();
  if (!lower) return "";
  if (lower === "kr" || lower === "kor" || lower === "korean") return "ko";
  if (lower === "eng" || lower === "english") return "en";
  if (lower === "jpn" || lower === "japanese") return "ja";
  if (lower === "chi" || lower === "chinese") return "zh";
  return lower;
}

function normalizeMatchGender(v) {
  const gender = String(v || "").trim().toLowerCase();
  if (gender === "male" || gender === "m") return "male";
  if (gender === "female" || gender === "f") return "female";
  if (gender === "all") return "all";
  return "";
}

function normalizeMatchCountry(v) {
  return normalizeCountryCode(v);
}

function normalizeMatchFilterArray(raw, kind) {
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? [raw] : [];
  const out = [];
  for (const item of arr) {
    const value = String(item || "").trim();
    if (!value) continue;
    const upper = value.toUpperCase();
    if (upper === "ALL") return ["ALL"];
    if (kind === "country") {
      const code = normalizeMatchCountry(value);
      if (!code) continue;
      if (!out.includes(code)) out.push(code);
      continue;
    }
    const language = normalizeMatchLanguage(value);
    if (!language) continue;
    if (!out.includes(language)) out.push(language);
  }
  return out.length > 0 ? out : ["ALL"];
}

const MATCH_INTEREST_IDS = new Set([
  "movies",
  "music",
  "travel",
  "food",
  "games",
  "fitness",
  "fashion",
  "pets",
  "books",
  "daily",
]);

function normalizeMatchInterestArray(raw, options) {
  const cfg = options && typeof options === "object" ? options : {};
  const allowAll = cfg.allowAll !== false;
  const fallbackToAll = cfg.fallbackToAll !== false;
  const arr = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? [raw] : [];
  const out = [];
  for (const item of arr) {
    const value = String(item || "").trim().toLowerCase();
    if (!value) continue;
    if (allowAll && value.toUpperCase() === "ALL") return ["ALL"];
    if (!MATCH_INTEREST_IDS.has(value)) continue;
    if (!out.includes(value)) out.push(value);
  }
  if (out.length > 0) return out;
  return allowAll && fallbackToAll ? ["ALL"] : [];
}

function buildDefaultMatchFilter() {
  return { countries: ["ALL"], languages: ["ALL"], gender: "all", interests: ["ALL"], updatedAt: now() };
}

function normalizeMatchFilterPayload(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const countries = normalizeMatchFilterArray(src.countries || src.countryCodes || src.countryFilter || src.country, "country");
  const languages = normalizeMatchFilterArray(src.languages || src.languageCodes || src.languageFilter || src.language, "language");
  const gender = normalizeMatchGender(src.gender || src.genderFilter) || "all";
  const interests = normalizeMatchInterestArray(src.interests || src.interestCodes || src.interestFilter, {
    allowAll: true,
    fallbackToAll: true,
  });
  const updatedAt = Number.isFinite(Number(src.updatedAt)) ? Math.trunc(Number(src.updatedAt)) : now();
  return { countries, languages, gender, interests, updatedAt };
}

function buildProfileUsersStore(rawUsers, rawMatchFilters = null) {
  const nextUsers = {};
  const users = rawUsers && typeof rawUsers === "object" ? rawUsers : {};
  Object.entries(users).forEach(([profileIdRaw, rowRaw]) => {
    const row = rowRaw && typeof rowRaw === "object" ? rowRaw : {};
    const profileId = sanitizeText(row.profileId || profileIdRaw, 180);
    if (!profileId) return;
    const nextRow = {
      ...row,
      profileId,
      nickname: sanitizeText(row.nickname || "", PROFILE_NICKNAME_MAX_LEN),
      nicknameKey: normalizeProfileNicknameKey(row.nicknameKey || row.nickname || ""),
      avatarDataUrl: sanitizeStoredProfileAvatarDataUrl(row.avatarDataUrl || row.avatarUrl),
      interests: normalizeMatchInterestArray(row.interests, { allowAll: false, fallbackToAll: false }),
      avatarUpdatedAt: normalizeRtcInt(row.avatarUpdatedAt, 0),
    };
    if (row.matchFilter && typeof row.matchFilter === "object") {
      nextRow.matchFilter = normalizeMatchFilterPayload(row.matchFilter);
    }
    nextUsers[profileId] = nextRow;
  });

  const matchFilters = rawMatchFilters && typeof rawMatchFilters === "object" ? rawMatchFilters : {};
  Object.entries(matchFilters).forEach(([profileIdRaw, filterRaw]) => {
    const profileId = sanitizeText(profileIdRaw, 180);
    if (!profileId) return;
    const prev = nextUsers[profileId] && typeof nextUsers[profileId] === "object" ? nextUsers[profileId] : { profileId, updatedAt: now() };
    nextUsers[profileId] = {
      ...prev,
      profileId,
      matchFilter: normalizeMatchFilterPayload(filterRaw),
    };
  });

  return nextUsers;
}

function resolveStoredProfileMatchData(profileId) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return { country: "", language: "", gender: "", interests: [] };
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : {};
  const row = users[pid] && typeof users[pid] === "object" ? users[pid] : {};
  const alias = findBestStoredProfileRowByLoginAccount(readStoredLoginAccountByProfileId(pid), pid) || {};
  return {
    country: normalizeMatchCountry(row.country || alias.country || ""),
    language: normalizeMatchLanguage(row.language || row.lang || alias.language || alias.lang || ""),
    gender: normalizeMatchGender(row.gender || alias.gender || ""),
    interests: normalizeMatchInterestArray(
      (Array.isArray(row.interests) && row.interests.length > 0 ? row.interests : alias.interests),
      { allowAll: false, fallbackToAll: false }
    ),
  };
}

function getStoredProfileUserRow(profileId) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return {};
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : {};
  return users[pid] && typeof users[pid] === "object" ? users[pid] : {};
}

function resolvePreferredCallContactProfileId(rawProfileId, fallbackLoginAccount = "") {
  const profileId = sanitizeText(rawProfileId || "", 180);
  if (extractUserIdFromProfileId(profileId)) return profileId;
  const loginAccount = readStoredLoginAccountByProfileId(profileId) || normalizeLoginAccountValue(fallbackLoginAccount);
  const alias = findBestStoredProfileRowByLoginAccount(loginAccount, profileId) || {};
  const aliasProfileId = sanitizeText(alias.profileId || "", 180);
  if (aliasProfileId && extractUserIdFromProfileId(aliasProfileId)) return aliasProfileId;
  return profileId || aliasProfileId || "";
}

function buildCallContactAggregateKey(rawProfileId, fallbackLoginAccount = "") {
  const profileId = sanitizeText(rawProfileId || "", 180);
  const userId = extractUserIdFromProfileId(profileId);
  if (userId) return `u:${userId}`;
  const loginAccount = readStoredLoginAccountByProfileId(profileId) || normalizeLoginAccountValue(fallbackLoginAccount);
  if (loginAccount) {
    return `l:${sanitizeText(anonymizeKey(loginAccount), 64)}`;
  }
  return profileId;
}

function callContactMatchesViewer(row, viewerProfileIdSet, viewerUserIdSet) {
  const base = normalizeCallContactRow(row);
  const peerProfileId = sanitizeText(base.peerProfileId || "", 180);
  const peerUserId = sanitizeText(base.peerUserId || "", 128);
  if (peerProfileId && viewerProfileIdSet.has(peerProfileId)) return true;
  if (peerUserId && viewerUserIdSet.has(peerUserId)) return true;
  return false;
}

function buildFollowerCallContactRow(followerProfileId, row) {
  const sourceProfileId = sanitizeText(followerProfileId || "", 180);
  const base = normalizeCallContactRow(row);
  if (!sourceProfileId || !base.contactKey || base.isFriend !== true) return null;

  const followerLoginAccount = resolveCallReportLoginAccount(sourceProfileId, "");
  const peerProfileId = resolvePreferredCallContactProfileId(sourceProfileId, followerLoginAccount) || sourceProfileId;
  const storedProfile = getStoredProfileUserRow(peerProfileId);
  const alias = findBestStoredProfileRowByLoginAccount(followerLoginAccount, peerProfileId) || {};

  return normalizeCallContactRow({
    contactKey: buildCallContactAggregateKey(peerProfileId, followerLoginAccount) || peerProfileId || sourceProfileId,
    peerProfileId,
    peerUserId: extractUserIdFromProfileId(peerProfileId),
    peerNickname: pickPreferredProfileNickname(storedProfile.nickname, alias.nickname),
    peerAvatarUrl: resolveStoredProfileAvatarUrl(storedProfile) || resolveStoredProfileAvatarUrl(alias),
    peerLoginAccount: followerLoginAccount,
    peerCountry: normalizeMatchCountry(storedProfile.country || alias.country || ""),
    peerLanguage: normalizeMatchLanguage(storedProfile.language || storedProfile.lang || alias.language || alias.lang || ""),
    peerGender: normalizeMatchGender(storedProfile.gender || alias.gender || ""),
    peerFlag: sanitizeText(storedProfile.flag || alias.flag || "", 8),
    peerInterests: normalizeMatchInterestArray(
      (Array.isArray(storedProfile.interests) && storedProfile.interests.length > 0 ? storedProfile.interests : alias.interests),
      { allowAll: false, fallbackToAll: false }
    ).slice(0, PROFILE_INTEREST_MAX_COUNT),
    isFriend: true,
    friendAt: base.friendAt,
    lastCallAt: base.lastCallAt,
    updatedAt: base.updatedAt,
  });
}

function buildRtcPeerInfoSeed(entryOrRecord, fallbackSessionId = "") {
  const source = entryOrRecord && typeof entryOrRecord === "object" ? entryOrRecord : {};
  const sessionId = sanitizeText(source.sessionId || fallbackSessionId || "", 256);
  const token = sanitizeText(source.token || "", 400);
  const userId = sanitizeText(source.userId || "", 128);
  const profileId = sanitizeText(source.profileId || profileIdFromSignalSession(sessionId, token, userId), 180);
  const storedMatch = resolveStoredProfileMatchData(profileId);
  const storedProfileRow = getStoredProfileUserRow(profileId);
  const publicProfile = buildPublicProfilePayload(profileId, storedProfileRow);
  const loginAccount = resolveCallReportLoginAccount(
    profileId,
    source.loginAccount || source.email || source.account || ""
  );
  const country = normalizeMatchCountry(source.country || storedMatch.country || "");
  const language = normalizeMatchLanguage(source.language || source.lang || storedMatch.language || "");
  const gender = normalizeMatchGender(source.gender || storedMatch.gender || "");
  const nickname = sanitizeText(publicProfile.nickname || "", PROFILE_NICKNAME_MAX_LEN);
  const avatarUrl = resolveStoredProfileAvatarUrl({ avatarUrl: publicProfile.avatarUrl, avatarDataUrl: publicProfile.avatarUrl });

  const payload = {
    type: "peer_info",
    source: "server_match_seed",
    serverSeeded: true,
    sessionId: sessionId || undefined,
    peerSessionId: sessionId || undefined,
    profileId: profileId || undefined,
    peerProfileId: profileId || undefined,
    country: country || undefined,
    language: language || undefined,
    gender: gender || undefined,
    nickname: nickname || undefined,
    avatarUrl: avatarUrl || undefined,
    loginAccount: loginAccount || undefined,
    email: loginAccount || undefined,
  };

  return Object.values(payload).some(Boolean) ? payload : null;
}

function readStoredMatchFilter(profileId) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return null;
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : {};
  const row = users[pid] && typeof users[pid] === "object" ? users[pid] : null;
  if (row && row.matchFilter && typeof row.matchFilter === "object") {
    return normalizeMatchFilterPayload(row.matchFilter);
  }
  const legacyMap = profileStore && profileStore.matchFilters && typeof profileStore.matchFilters === "object" ? profileStore.matchFilters : null;
  const legacy = legacyMap ? legacyMap[pid] : null;
  if (legacy && typeof legacy === "object") {
    return normalizeMatchFilterPayload(legacy);
  }
  return null;
}

function resolveStoredMatchFilter(profileId) {
  return readStoredMatchFilter(profileId) || buildDefaultMatchFilter();
}

function saveMatchFilter(profileId, rawFilter) {
  const pid = sanitizeText(profileId || "", 180);
  if (!pid) return buildDefaultMatchFilter();
  if (!profileStore || typeof profileStore !== "object") profileStore = createEmptyProfileStore();
  if (!profileStore.users || typeof profileStore.users !== "object") profileStore.users = {};
  const prev = profileStore.users[pid] && typeof profileStore.users[pid] === "object" ? profileStore.users[pid] : { profileId: pid };
  const normalized = normalizeMatchFilterPayload(rawFilter);
  profileStore.users[pid] = {
    ...prev,
    profileId: sanitizeText(prev.profileId || pid, 180) || pid,
    matchFilter: normalized,
    updatedAt: now(),
  };
  if (profileStore.matchFilters && typeof profileStore.matchFilters === "object") {
    profileStore.matchFilters[pid] = normalized;
  }
  schedulePersistProfileStore({ type: "user", profileId: pid });
  return normalized;
}

function buildSessionProfileFromEnqueue(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    country: normalizeMatchCountry(src.country),
    language: normalizeMatchLanguage(src.language || src.lang),
    gender: normalizeMatchGender(src.gender),
    interests: normalizeMatchInterestArray(src.interests, { allowAll: false, fallbackToAll: false }),
  };
}

function isProfileAcceptedByFilter(filter, profile) {
  const normalizedFilter = normalizeMatchFilterPayload(filter || {});
  const target = profile && typeof profile === "object" ? profile : {};
  const targetCountry = normalizeMatchCountry(target.country);
  const targetLanguage = normalizeMatchLanguage(target.language || target.lang);
  const targetGender = normalizeMatchGender(target.gender);
  const targetInterests = normalizeMatchInterestArray(target.interests, { allowAll: false, fallbackToAll: false });

  const countryOk = normalizedFilter.countries.includes("ALL") || (targetCountry && normalizedFilter.countries.includes(targetCountry));
  const languageOk = normalizedFilter.languages.includes("ALL") || (targetLanguage && normalizedFilter.languages.includes(targetLanguage));
  const genderOk = normalizedFilter.gender === "all" || (targetGender && normalizedFilter.gender === targetGender);
  const interestsOk =
    normalizedFilter.interests.includes("ALL") ||
    normalizedFilter.interests.some((interest) => targetInterests.includes(interest));
  return Boolean(countryOk && languageOk && genderOk && interestsOk);
}

function isSessionPairMatchCompatible(aSession, bSession) {
  const a = aSession && typeof aSession === "object" ? aSession : {};
  const b = bSession && typeof bSession === "object" ? bSession : {};
  const aFilter = resolveSessionMatchFilter(a);
  const bFilter = resolveSessionMatchFilter(b);
  const aProfile = { country: a.country, language: a.language, gender: a.gender, interests: a.interests };
  const bProfile = { country: b.country, language: b.language, gender: b.gender, interests: b.interests };
  return isProfileAcceptedByFilter(aFilter, bProfile) && isProfileAcceptedByFilter(bFilter, aProfile);
}

function normalizeBooleanLike(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") {
    if (v === 1) return true;
    if (v === 0) return false;
  }
  const s = String(v ?? "").trim().toLowerCase();
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

function normalizePopTalkTimestamp(raw) {
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function resolvePopTalkPremiumExpiresAtMs(req, body) {
  const b = body || {};
  const headers = (req && req.headers) || {};
  return normalizePopTalkTimestamp(
    b.premiumExpiresAtMs ??
      b.subscriptionExpiresAtMs ??
      b.subscriptionEndsAtMs ??
      headers["x-premium-expires-at-ms"] ??
      headers["x-subscription-expires-at-ms"] ??
      headers["x-subscription-ends-at-ms"]
  );
}

function resolvePopTalkPlanHint(req, body, atMs) {
  const b = body || {};
  const headers = (req && req.headers) || {};
  const nowMs = normalizePopTalkTimestamp(atMs) || now();
  const premiumExpiresAtMs = resolvePopTalkPremiumExpiresAtMs(req, b);
  const premiumExpired = premiumExpiresAtMs > 0 && nowMs >= premiumExpiresAtMs;
  const premiumHint = normalizeBooleanLike(b.isPremium ?? headers["x-is-premium"]);
  if (premiumHint === false) return "free";
  const candidates = [
    b.plan,
    b.planId,
    b.tier,
    b.subscription,
    b.storeProductId,
    headers["x-plan-id"],
    headers["x-plan"],
    headers["x-store-product-id"],
  ];
  for (const c of candidates) {
    const parsed = parsePopTalkPlan(c);
    if (parsed) return premiumExpired && parsed !== "free" ? "free" : parsed;
  }
  if (premiumHint === true) return premiumExpired ? "free" : "monthly";
  return null;
}

function getPopTalkPlanConfig(plan) {
  const normalized = normalizePopTalkPlan(plan);
  return POPTALK_PLAN_CONFIGS[normalized] || POPTALK_PLAN_CONFIGS.free;
}

function computePopTalkDisplayCap(plan, balance, options) {
  const cfg = getPopTalkPlanConfig(plan);
  const normalizedBalance = Number.isFinite(Number(balance)) ? Math.max(0, Math.trunc(Number(balance))) : 0;
  const unlimitedActive = Boolean(options && options.unlimitedActive);
  return unlimitedActive ? Math.max(cfg.cap, normalizedBalance, POPTALK_UNLIMITED_CAP) : Math.max(cfg.cap, normalizedBalance);
}

function getKstDateKey(tsMs) {
  const safeTs = Number.isFinite(Number(tsMs)) ? Math.trunc(Number(tsMs)) : Date.now();
  const dayKey = Math.floor((safeTs + KST_TZ_OFFSET_MS) / 86400000);
  const cached = kstDateCache.get(dayKey);
  if (cached) return cached;

  let dateStr = "";
  try {
    if (kstDateFormatter) dateStr = kstDateFormatter.format(new Date(safeTs));
  } catch {}

  if (!dateStr) {
    const d = new Date(safeTs + KST_TZ_OFFSET_MS);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    dateStr = y + "-" + m + "-" + day;
  }

  kstDateCache.set(dayKey, dateStr);
  if (kstDateCache.size > 100) kstDateCache.clear();
  return dateStr;
}

function buildPopTalkSnapshot(wallet, atMs) {
  const nowMs = Number.isFinite(Number(atMs)) ? Math.trunc(Number(atMs)) : now();
  const unlimitedUntilMs = normalizePopTalkTimestamp(wallet && wallet.unlimitedUntilMs);
  const unlimitedActive = unlimitedUntilMs > nowMs;
  const premiumExpiresAtMs = normalizePopTalkTimestamp(wallet && wallet.premiumExpiresAtMs);
  const plan = unlimitedActive ? "monthly" : premiumExpiresAtMs > 0 && premiumExpiresAtMs <= nowMs ? "free" : normalizePopTalkPlan(wallet && wallet.plan);
  const balanceRaw = Number(wallet && wallet.balance);
  const normalizedBalance = Number.isFinite(balanceRaw) ? Math.max(0, Math.trunc(balanceRaw)) : 0;
  const displayBalance = unlimitedActive ? Math.max(normalizedBalance, POPTALK_UNLIMITED_CAP) : normalizedBalance;
  const cap = computePopTalkDisplayCap(plan, displayBalance, { unlimitedActive });
  const balance = Math.max(0, Math.min(cap, displayBalance));
  return {
    balance,
    cap,
    plan,
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
  schedulePersistProfileStore({ type: "wallet", profileId });
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

  const hintedPlan = allowPlanHint ? resolvePopTalkPlanHint(req, body, ts) : null;
  const hintedPremiumExpiresAtMs = allowPlanHint ? resolvePopTalkPremiumExpiresAtMs(req, body) : 0;

  if (!wallet || typeof wallet !== "object") {
    const initialPlan = hintedPlan || "free";
    const cfg = getPopTalkPlanConfig(initialPlan);
    wallet = {
      profileId,
      plan: initialPlan,
      cap: cfg.cap,
      balance: cfg.cap,
      unlimitedUntilMs: 0,
      premiumExpiresAtMs: hintedPremiumExpiresAtMs,
      updatedAt: ts,
      lastDailyResetKst: todayKst,
      lastRegenTick: tickNow,
      idempotency: {},
    };
    profileStore.popTalkWallets[profileId] = wallet;
    schedulePersistProfileStore({ type: "wallet", profileId });
    return { wallet, profileId, changed: true, errorCode: "" };
  }

  if (!wallet.idempotency || typeof wallet.idempotency !== "object") {
    wallet.idempotency = {};
    changed = true;
  }

  const unlimitedUntilRaw = Number(wallet.unlimitedUntilMs);
  const unlimitedUntilMs = Number.isFinite(unlimitedUntilRaw) ? Math.max(0, Math.trunc(unlimitedUntilRaw)) : 0;
  if (wallet.unlimitedUntilMs !== unlimitedUntilMs) {
    wallet.unlimitedUntilMs = unlimitedUntilMs;
    changed = true;
  }

  const storedPremiumExpiresAtMs = normalizePopTalkTimestamp(wallet.premiumExpiresAtMs);
  if (wallet.premiumExpiresAtMs !== storedPremiumExpiresAtMs) {
    wallet.premiumExpiresAtMs = storedPremiumExpiresAtMs;
    changed = true;
  }
  if (allowPlanHint) {
    if (hintedPremiumExpiresAtMs > 0 && wallet.premiumExpiresAtMs !== hintedPremiumExpiresAtMs) {
      wallet.premiumExpiresAtMs = hintedPremiumExpiresAtMs;
      changed = true;
    } else if (hintedPlan === "free" && wallet.premiumExpiresAtMs !== 0) {
      wallet.premiumExpiresAtMs = 0;
      changed = true;
    }
  }

  if (unlimitedUntilMs > 0 && ts >= unlimitedUntilMs) {
    const freeCfg = getPopTalkPlanConfig("free");
    const bal = Number.isFinite(Number(wallet.balance)) ? Math.max(0, Math.trunc(Number(wallet.balance))) : 0;
    wallet.unlimitedUntilMs = 0;
    wallet.plan = "free";
    wallet.cap = freeCfg.cap;
    wallet.balance = Math.min(bal, freeCfg.cap);
    changed = true;
  }

  const unlimitedActive = Number(wallet.unlimitedUntilMs) > ts;
  const premiumExpiresAtMs = normalizePopTalkTimestamp(wallet.premiumExpiresAtMs);
  const premiumExpired = !unlimitedActive && premiumExpiresAtMs > 0 && premiumExpiresAtMs <= ts;
  if (premiumExpired && wallet.premiumExpiresAtMs !== 0) {
    wallet.premiumExpiresAtMs = 0;
    changed = true;
  }
  const currentPlan = unlimitedActive ? "monthly" : normalizePopTalkPlan(wallet.plan);
  const storedPlan = premiumExpired ? "free" : currentPlan;
  const nextPlan = unlimitedActive ? "monthly" : hintedPlan || storedPlan;
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

  if (unlimitedActive && wallet.balance < POPTALK_UNLIMITED_CAP) {
    wallet.balance = POPTALK_UNLIMITED_CAP;
    changed = true;
  }

  const displayCap = computePopTalkDisplayCap(nextPlan, wallet.balance, { unlimitedActive });
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

  if (unlimitedActive) {
    if (wallet.lastDailyResetKst !== todayKst) {
      wallet.lastDailyResetKst = todayKst;
      changed = true;
    }
    if (wallet.lastRegenTick !== tickNow) {
      wallet.lastRegenTick = tickNow;
      changed = true;
    }
    if (wallet.balance < POPTALK_UNLIMITED_CAP) {
      wallet.balance = POPTALK_UNLIMITED_CAP;
      changed = true;
    }
    if (wallet.cap < wallet.balance) {
      wallet.cap = wallet.balance;
      changed = true;
    }
  } else if (wallet.lastDailyResetKst !== todayKst) {
    const resetBalance = Math.max(wallet.balance, regenCap);
    if (resetBalance !== wallet.balance) {
      wallet.balance = resetBalance;
    }
    const nextCapAfterReset = computePopTalkDisplayCap(nextPlan, wallet.balance, { unlimitedActive: false });
    if (nextCapAfterReset !== wallet.cap) {
      wallet.cap = nextCapAfterReset;
    }
    wallet.lastDailyResetKst = todayKst;
    wallet.lastRegenTick = tickNow;
    changed = true;
  } else if (tickNow > wallet.lastRegenTick) {
    // Free plan must not be auto-restored to 1000 during the day.
    // Allow 1000 top-up only at initial wallet creation and daily KST reset.
    if (nextPlan === "free") {
      wallet.lastRegenTick = tickNow;
      changed = true;
    } else {
      const deltaTicks = tickNow - wallet.lastRegenTick;
      const regenGain = deltaTicks * cfg.regenPerTick;
      const nextBalance = wallet.balance >= regenCap ? wallet.balance : Math.min(regenCap, wallet.balance + regenGain);
      if (nextBalance !== wallet.balance) {
        wallet.balance = nextBalance;
      }
      const nextCapAfterRegen = computePopTalkDisplayCap(nextPlan, wallet.balance, { unlimitedActive: false });
      if (nextCapAfterRegen !== wallet.cap) {
        wallet.cap = nextCapAfterRegen;
      }
      wallet.lastRegenTick = tickNow;
      changed = true;
    }
  }

  trimPopTalkIdempotency(wallet);

  if (changed) {
    wallet.updatedAt = ts;
    schedulePersistProfileStore({ type: "wallet", profileId });
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

function safeJsonStringify(value, fallback = "{}") {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function parseJsonSafe(raw, fallback = null) {
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function ensureProfileStoreSqliteTables() {
  if (!profileStoreSqlite) return;
  profileStoreSqlite.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      k TEXT PRIMARY KEY,
      v TEXT NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile_users (
      profileId TEXT PRIMARY KEY,
      updatedAt INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS poptalk_wallets (
      profileId TEXT PRIMARY KEY,
      updatedAt INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dino_rank_entries (
      entryId TEXT PRIMARY KEY,
      profileId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      obtainedAt INTEGER NOT NULL,
      score INTEGER NOT NULL,
      clientEntryId TEXT,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dino_rank_entries_score_created
      ON dino_rank_entries(score DESC, obtainedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_dino_rank_entries_profile_client
      ON dino_rank_entries(profileId, clientEntryId);
    CREATE TABLE IF NOT EXISTS call_reports (
      reportId TEXT PRIMARY KEY,
      createdAt INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS call_blocks (
      actorSessionKey TEXT NOT NULL,
      peerSessionKey TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY(actorSessionKey, peerSessionKey)
    );
  `);

  readProfileStoreFromSqliteStmt = profileStoreSqlite.prepare("SELECT v FROM kv WHERE k = ?");
  writeProfileStoreToSqliteStmt = profileStoreSqlite.prepare(
    "INSERT INTO kv (k, v, updatedAt) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updatedAt = excluded.updatedAt"
  );
  countProfileStoreKvStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM kv WHERE k = ?");
  deleteProfileStoreKvStmt = profileStoreSqlite.prepare("DELETE FROM kv WHERE k = ?");
  countProfileUsersStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM profile_users");
  listProfileUsersStmt = profileStoreSqlite.prepare("SELECT profileId, updatedAt, data FROM profile_users");
  upsertProfileUserStmt = profileStoreSqlite.prepare(
    "INSERT INTO profile_users (profileId, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(profileId) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data"
  );
  countProfileWalletsStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM poptalk_wallets");
  listProfileWalletsStmt = profileStoreSqlite.prepare("SELECT profileId, updatedAt, data FROM poptalk_wallets");
  upsertProfileWalletStmt = profileStoreSqlite.prepare(
    "INSERT INTO poptalk_wallets (profileId, updatedAt, data) VALUES (?, ?, ?) ON CONFLICT(profileId) DO UPDATE SET updatedAt = excluded.updatedAt, data = excluded.data"
  );
  countProfileDinoEntriesStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM dino_rank_entries");
  listProfileDinoEntriesStmt = profileStoreSqlite.prepare(
    "SELECT entryId, profileId, createdAt, score, clientEntryId, data FROM dino_rank_entries ORDER BY createdAt ASC"
  );
  insertProfileDinoEntryStmt = profileStoreSqlite.prepare(
    "INSERT INTO dino_rank_entries (entryId, profileId, createdAt, obtainedAt, score, clientEntryId, data) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entryId) DO UPDATE SET profileId = excluded.profileId, createdAt = excluded.createdAt, obtainedAt = excluded.obtainedAt, score = excluded.score, clientEntryId = excluded.clientEntryId, data = excluded.data"
  );
  deleteAllProfileDinoEntriesStmt = profileStoreSqlite.prepare("DELETE FROM dino_rank_entries");
  countCallReportsStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM call_reports");
  listCallReportsStmt = profileStoreSqlite.prepare("SELECT reportId, createdAt, data FROM call_reports ORDER BY createdAt ASC");
  upsertCallReportStmt = profileStoreSqlite.prepare(
    "INSERT INTO call_reports (reportId, createdAt, data) VALUES (?, ?, ?) ON CONFLICT(reportId) DO UPDATE SET createdAt = excluded.createdAt, data = excluded.data"
  );
  countCallBlocksStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM call_blocks");
  listCallBlocksStmt = profileStoreSqlite.prepare(
    "SELECT actorSessionKey, peerSessionKey, createdAt, data FROM call_blocks"
  );
  upsertCallBlockStmt = profileStoreSqlite.prepare(
    "INSERT INTO call_blocks (actorSessionKey, peerSessionKey, createdAt, data) VALUES (?, ?, ?, ?) ON CONFLICT(actorSessionKey, peerSessionKey) DO UPDATE SET createdAt = excluded.createdAt, data = excluded.data"
  );
  deleteAllCallBlocksStmt = profileStoreSqlite.prepare("DELETE FROM call_blocks");
  profileStoreDomainTx = profileStoreSqlite.transaction((dirtyState) => {
    const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : {};
    const wallets = profileStore && profileStore.popTalkWallets && typeof profileStore.popTalkWallets === "object" ? profileStore.popTalkWallets : {};
    const dinoEntries = Array.isArray(profileStore && profileStore.dinoRankEntries) ? profileStore.dinoRankEntries : [];
    const callReports = Array.isArray(profileStore && profileStore.callReports) ? profileStore.callReports : [];
    const callBlocks = profileStore && profileStore.callBlocks && typeof profileStore.callBlocks === "object" ? profileStore.callBlocks : {};

    if (dirtyState.fullUsers) {
      Object.keys(users).forEach((profileId) => {
        const row = users[profileId];
        if (!profileId || !row) return;
        upsertProfileUserStmt.run(profileId, normalizeRtcInt(row.updatedAt, now()), safeJsonStringify(row));
      });
    } else {
      dirtyState.users.forEach((profileId) => {
        const row = users[profileId];
        if (!profileId || !row) return;
        upsertProfileUserStmt.run(profileId, normalizeRtcInt(row.updatedAt, now()), safeJsonStringify(row));
      });
    }

    if (dirtyState.fullWallets) {
      Object.keys(wallets).forEach((profileId) => {
        const row = wallets[profileId];
        if (!profileId || !row) return;
        upsertProfileWalletStmt.run(profileId, normalizeRtcInt(row.updatedAt, now()), safeJsonStringify(row));
      });
    } else {
      dirtyState.wallets.forEach((profileId) => {
        const row = wallets[profileId];
        if (!profileId || !row) return;
        upsertProfileWalletStmt.run(profileId, normalizeRtcInt(row.updatedAt, now()), safeJsonStringify(row));
      });
    }

    if (dirtyState.fullDino) {
      deleteAllProfileDinoEntriesStmt.run();
      dinoEntries.forEach((row) => {
        if (!row || !row.entryId) return;
        insertProfileDinoEntryStmt.run(
          sanitizeText(row.entryId, 128),
          sanitizeText(row.profileId, 180),
          normalizeRtcInt(row.createdAt, now()),
          normalizeRtcInt(row.obtainedAt || row.achievedAt, now()),
          normalizeRtcInt(row.score, 0),
          sanitizeText(row.clientEntryId, 128),
          safeJsonStringify(row)
        );
      });
    } else {
      const entryMap = new Map(dinoEntries.map((row) => [sanitizeText(row && row.entryId, 128), row]));
      dirtyState.dinoEntryIds.forEach((entryId) => {
        const row = entryMap.get(entryId);
        if (!entryId || !row) return;
        insertProfileDinoEntryStmt.run(
          sanitizeText(row.entryId, 128),
          sanitizeText(row.profileId, 180),
          normalizeRtcInt(row.createdAt, now()),
          normalizeRtcInt(row.obtainedAt || row.achievedAt, now()),
          normalizeRtcInt(row.score, 0),
          sanitizeText(row.clientEntryId, 128),
          safeJsonStringify(row)
        );
      });
    }

    if (dirtyState.fullCallReports) {
      profileStoreSqlite.prepare("DELETE FROM call_reports").run();
      callReports.forEach((row) => {
        if (!row || !row.reportId) return;
        upsertCallReportStmt.run(
          sanitizeText(row.reportId, 128),
          normalizeRtcInt(row.createdAt, now()),
          safeJsonStringify(row)
        );
      });
    } else {
      const reportMap = new Map(callReports.map((row) => [sanitizeText(row && row.reportId, 128), row]));
      dirtyState.callReportIds.forEach((reportId) => {
        const row = reportMap.get(reportId);
        if (!reportId || !row) return;
        upsertCallReportStmt.run(
          sanitizeText(row.reportId, 128),
          normalizeRtcInt(row.createdAt, now()),
          safeJsonStringify(row)
        );
      });
    }

    if (dirtyState.fullCallBlocks) {
      deleteAllCallBlocksStmt.run();
      Object.entries(callBlocks).forEach(([actorSessionKey, targets]) => {
        const targetMap = targets && typeof targets === "object" ? targets : {};
        Object.entries(targetMap).forEach(([peerSessionKey, row]) => {
          if (!actorSessionKey || !peerSessionKey || !row) return;
          upsertCallBlockStmt.run(
            sanitizeText(actorSessionKey, 128),
            sanitizeText(peerSessionKey, 128),
            normalizeRtcInt(row.createdAt, now()),
            safeJsonStringify(row)
          );
        });
      });
    } else {
      dirtyState.callBlockPairs.forEach((pairKey) => {
        const parts = String(pairKey || "").split("|");
        const actorSessionKey = sanitizeText(parts[0] || "", 128);
        const peerSessionKey = sanitizeText(parts[1] || "", 128);
        const row = actorSessionKey && callBlocks[actorSessionKey] ? callBlocks[actorSessionKey][peerSessionKey] : null;
        if (!actorSessionKey || !peerSessionKey || !row) return;
        upsertCallBlockStmt.run(
          actorSessionKey,
          peerSessionKey,
          normalizeRtcInt(row.createdAt, now()),
          safeJsonStringify(row)
        );
      });
    }
  });
}

function countSqliteRows(stmt, arg) {
  if (!stmt) return 0;
  try {
    const row = arg === undefined ? stmt.get() : stmt.get(arg);
    return normalizeRtcInt(row && row.total, 0);
  } catch {
    return 0;
  }
}

function hasStructuredProfileStoreSqliteData() {
  return (
    countSqliteRows(countProfileUsersStmt) > 0 ||
    countSqliteRows(countProfileWalletsStmt) > 0 ||
    countSqliteRows(countProfileDinoEntriesStmt) > 0 ||
    countSqliteRows(countCallReportsStmt) > 0 ||
    countSqliteRows(countCallBlocksStmt) > 0
  );
}

function importLegacyProfileStoreToSqlite(json) {
  if (!profileStoreSqlite) return;
  const legacy = json && typeof json === "object" ? json : createEmptyProfileStore();
  const users = buildProfileUsersStore(legacy.users, legacy.matchFilters);
  const wallets = legacy.popTalkWallets && typeof legacy.popTalkWallets === "object" ? legacy.popTalkWallets : {};
  const dinoEntries = Array.isArray(legacy.dinoRankEntries) ? legacy.dinoRankEntries : [];
  const callReports = Array.isArray(legacy.callReports) ? legacy.callReports : [];
  const callBlocks = legacy.callBlocks && typeof legacy.callBlocks === "object" ? legacy.callBlocks : {};

  profileStoreSqlite.transaction(() => {
    profileStoreSqlite.prepare("DELETE FROM profile_users").run();
    profileStoreSqlite.prepare("DELETE FROM poptalk_wallets").run();
    deleteAllProfileDinoEntriesStmt.run();
    profileStoreSqlite.prepare("DELETE FROM call_reports").run();
    deleteAllCallBlocksStmt.run();

    Object.keys(users).forEach((profileId) => {
      const row = users[profileId];
      if (!profileId || !row) return;
      upsertProfileUserStmt.run(profileId, normalizeRtcInt(row.updatedAt, now()), safeJsonStringify(row));
    });
    Object.keys(wallets).forEach((profileId) => {
      const row = wallets[profileId];
      if (!profileId || !row) return;
      upsertProfileWalletStmt.run(profileId, normalizeRtcInt(row.updatedAt, now()), safeJsonStringify(row));
    });
    dinoEntries.forEach((row) => {
      if (!row || !row.entryId) return;
      insertProfileDinoEntryStmt.run(
        sanitizeText(row.entryId, 128),
        sanitizeText(row.profileId, 180),
        normalizeRtcInt(row.createdAt, now()),
        normalizeRtcInt(row.obtainedAt || row.achievedAt, now()),
        normalizeRtcInt(row.score, 0),
        sanitizeText(row.clientEntryId, 128),
        safeJsonStringify(row)
      );
    });
    callReports.forEach((row) => {
      if (!row || !row.reportId) return;
      upsertCallReportStmt.run(
        sanitizeText(row.reportId, 128),
        normalizeRtcInt(row.createdAt, now()),
        safeJsonStringify(row)
      );
    });
    Object.entries(callBlocks).forEach(([actorSessionKey, targets]) => {
      const targetMap = targets && typeof targets === "object" ? targets : {};
      Object.entries(targetMap).forEach(([peerSessionKey, row]) => {
        if (!actorSessionKey || !peerSessionKey || !row) return;
        upsertCallBlockStmt.run(
          sanitizeText(actorSessionKey, 128),
          sanitizeText(peerSessionKey, 128),
          normalizeRtcInt(row.createdAt, now()),
          safeJsonStringify(row)
        );
      });
    });
  })();
}

function maybeMigrateLegacyProfileStoreKvRow() {
  if (!profileStoreSqlite || hasStructuredProfileStoreSqliteData()) return;
  const legacyCount = countSqliteRows(countProfileStoreKvStmt, "profileStore");
  if (!legacyCount) return;
  const row = readProfileStoreFromSqliteStmt ? readProfileStoreFromSqliteStmt.get("profileStore") : null;
  const json = parseJsonSafe(row && row.v, null);
  if (!json || typeof json !== "object") return;
  importLegacyProfileStoreToSqlite(json);
  try {
    deleteProfileStoreKvStmt.run("profileStore");
  } catch {}
}

function loadProfileStoreFromSqliteTables() {
  const users = {};
  const wallets = {};
  const dinoRankEntries = [];
  const callReports = [];
  const callBlocks = {};

  (listProfileUsersStmt ? listProfileUsersStmt.all() : []).forEach((row) => {
    const parsed = parseJsonSafe(row && row.data, null);
    const profileId = sanitizeText((parsed && parsed.profileId) || (row && row.profileId) || "", 180);
    if (profileId && parsed && typeof parsed === "object") users[profileId] = parsed;
  });
  (listProfileWalletsStmt ? listProfileWalletsStmt.all() : []).forEach((row) => {
    const parsed = parseJsonSafe(row && row.data, null);
    const profileId = sanitizeText((parsed && parsed.profileId) || (row && row.profileId) || "", 180);
    if (profileId && parsed && typeof parsed === "object") wallets[profileId] = parsed;
  });
  (listProfileDinoEntriesStmt ? listProfileDinoEntriesStmt.all() : []).forEach((row) => {
    const parsed = parseJsonSafe(row && row.data, null);
    if (parsed && typeof parsed === "object") dinoRankEntries.push(parsed);
  });
  (listCallReportsStmt ? listCallReportsStmt.all() : []).forEach((row) => {
    const parsed = parseJsonSafe(row && row.data, null);
    if (parsed && typeof parsed === "object") callReports.push(parsed);
  });
  (listCallBlocksStmt ? listCallBlocksStmt.all() : []).forEach((row) => {
    const actorSessionKey = sanitizeText(row && row.actorSessionKey, 128);
    const peerSessionKey = sanitizeText(row && row.peerSessionKey, 128);
    const parsed = parseJsonSafe(row && row.data, null);
    if (!actorSessionKey || !peerSessionKey || !parsed || typeof parsed !== "object") return;
    if (!callBlocks[actorSessionKey] || typeof callBlocks[actorSessionKey] !== "object") callBlocks[actorSessionKey] = {};
    callBlocks[actorSessionKey][peerSessionKey] = parsed;
  });

  return {
    users: buildProfileUsersStore(users),
    dinoRankEntries,
    popTalkWallets: wallets,
    callReports,
    callBlocks,
  };
}

function ensureProfileStoreBackend() {
  if (profileStoreBackendReady) return;
  profileStoreBackendReady = true;

  if (PROFILE_STORE_BACKEND !== "sqlite") {
    profileStoreBackend = "json";
    return;
  }

  try {
    const BetterSqlite3 = require("better-sqlite3");
    ensureStoreDir();
    profileStoreSqlite = new BetterSqlite3(PROFILE_SQLITE_PATH);
    profileStoreSqlite.pragma("journal_mode = WAL");
    profileStoreSqlite.pragma("synchronous = NORMAL");
    ensureProfileStoreSqliteTables();
    profileStoreBackend = "sqlite";
    console.log(`[profile-sync] storage backend=sqlite path=${PROFILE_SQLITE_PATH}`);
  } catch (e) {
    profileStoreBackend = "json";
    profileStoreSqlite = null;
    readProfileStoreFromSqliteStmt = null;
    writeProfileStoreToSqliteStmt = null;
    countProfileStoreKvStmt = null;
    deleteProfileStoreKvStmt = null;
    countProfileUsersStmt = null;
    listProfileUsersStmt = null;
    upsertProfileUserStmt = null;
    countProfileWalletsStmt = null;
    listProfileWalletsStmt = null;
    upsertProfileWalletStmt = null;
    countProfileDinoEntriesStmt = null;
    listProfileDinoEntriesStmt = null;
    insertProfileDinoEntryStmt = null;
    deleteAllProfileDinoEntriesStmt = null;
    countCallReportsStmt = null;
    listCallReportsStmt = null;
    upsertCallReportStmt = null;
    countCallBlocksStmt = null;
    listCallBlocksStmt = null;
    upsertCallBlockStmt = null;
    deleteAllCallBlocksStmt = null;
    countLoginEventsSqliteStmt = null;
    insertLoginEventSqliteStmt = null;
    listLoginEventsSqliteStmt = null;
    listLoginEventsByAtRangeSqliteStmt = null;
    upsertLoginPresenceSqliteStmt = null;
    listActiveLoginPresenceSqliteStmt = null;
    listAllLoginPresenceSqliteStmt = null;
    countLoginPresenceSqliteStmt = null;
    countActiveLoginPresenceSqliteStmt = null;
    profileStoreDomainTx = null;
    console.error("[profile-sync] sqlite init failed, fallback json:", e && e.message ? e.message : e);
  }
}

function loadProfileStore() {
  ensureStoreDir();
  ensureProfileStoreBackend();
  try {
    let json = null;
    if (profileStoreBackend === "sqlite") {
      maybeMigrateLegacyProfileStoreKvRow();
      profileStore = loadProfileStoreFromSqliteTables();
      resetProfileStoreDirtyState();
      lastClusterProfileStoreRefreshAt = now();
      return;
    } else {
      if (!fs.existsSync(PROFILE_STORE_PATH)) {
        profileStore = createEmptyProfileStore();
        lastClusterProfileStoreRefreshAt = now();
        return;
      }
      const raw = fs.readFileSync(PROFILE_STORE_PATH, "utf8");
      json = JSON.parse(raw);
    }
    const users = buildProfileUsersStore(json && typeof json === "object" ? json.users : null, json && typeof json === "object" ? json.matchFilters : null);
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
    const snapshotNowMs = now();
    Object.entries(popTalkWalletsRaw).forEach(([profileIdRaw, walletRaw]) => {
      const profileId = sanitizeText(profileIdRaw, 160);
      if (!profileId) return;

      const storedPlan = normalizePopTalkPlan(walletRaw && (walletRaw.plan || walletRaw.planId || walletRaw.tier || walletRaw.subscription));
      const cfg = getPopTalkPlanConfig(storedPlan);

      const capRaw = Number(walletRaw && walletRaw.cap);
      const storedCap = Number.isFinite(capRaw) ? Math.max(1, Math.trunc(capRaw)) : cfg.cap;

      const balanceRaw = Number(walletRaw && walletRaw.balance);
      const balance = Number.isFinite(balanceRaw) ? Math.max(0, Math.trunc(balanceRaw)) : storedCap;

      const updatedAtRaw = Number(walletRaw && walletRaw.updatedAt);
      const updatedAt = Number.isFinite(updatedAtRaw) ? Math.max(0, Math.trunc(updatedAtRaw)) : now();
      const unlimitedUntilMs = normalizePopTalkTimestamp(walletRaw && walletRaw.unlimitedUntilMs);
      const premiumExpiresAtMs = normalizePopTalkTimestamp(walletRaw && walletRaw.premiumExpiresAtMs);
      const unlimitedActive = unlimitedUntilMs > snapshotNowMs;
      const plan = unlimitedActive ? "monthly" : premiumExpiresAtMs > 0 && premiumExpiresAtMs <= snapshotNowMs ? "free" : storedPlan;
      const displayCap = computePopTalkDisplayCap(plan, balance, { unlimitedActive });

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
        unlimitedUntilMs,
        premiumExpiresAtMs: premiumExpiresAtMs > snapshotNowMs ? premiumExpiresAtMs : 0,
        updatedAt,
        lastDailyResetKst,
        lastRegenTick,
        idempotency,
      };

      trimPopTalkIdempotency(wallet);
      popTalkWallets[profileId] = wallet;
    });

    const callReportsRaw = json && typeof json === "object" && Array.isArray(json.callReports) ? json.callReports : [];
    const callReports = callReportsRaw
      .map((it) => ({
        reportId: sanitizeText(it && it.reportId, 128) || `r_${now()}_${Math.random().toString(16).slice(2, 10)}`,
        createdAt: Number.isFinite(Number(it && it.createdAt)) ? Math.max(0, Math.trunc(Number(it && it.createdAt))) : now(),
        roomId: sanitizeText(it && it.roomId, 120),
        reasonCode: sanitizeReasonCode(it && it.reasonCode),
        reasonLabel: sanitizeReasonLabel(it && it.reasonLabel),
        reasonDetail: sanitizeReasonDetail(it && it.reasonDetail),
        reporterProfileId: sanitizeText(it && it.reporterProfileId, 180),
        reporterSessionKey: sanitizeText(it && it.reporterSessionKey, 128),
        reporterLoginAccount: normalizeLoginAccountValue(it && it.reporterLoginAccount),
        targetProfileId: sanitizeText(it && it.targetProfileId, 180),
        targetSessionKey: sanitizeText(it && it.targetSessionKey, 128),
        targetLoginAccount: normalizeLoginAccountValue(it && it.targetLoginAccount),
        status: sanitizeText(it && it.status, 40) || "new",
        emailStatus: sanitizeText(it && it.emailStatus, 40) || "pending",
        emailError: sanitizeText(it && it.emailError, 220),
        source: sanitizeText(it && it.source, 80),
      }))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0))
      .slice(-CALL_REPORTS_LIMIT);

    const callBlocksRaw = json && typeof json === "object" && json.callBlocks && typeof json.callBlocks === "object" ? json.callBlocks : {};
    const callBlocks = {};
    Object.entries(callBlocksRaw).forEach(([actorKeyRaw, targetsRaw]) => {
      const actorKey = sanitizeText(actorKeyRaw, 128);
      if (!actorKey || !targetsRaw || typeof targetsRaw !== "object") return;
      const nextTargets = {};
      Object.entries(targetsRaw).forEach(([targetKeyRaw, metaRaw]) => {
        const targetKey = sanitizeText(targetKeyRaw, 128);
        if (!targetKey || targetKey === actorKey) return;
        nextTargets[targetKey] = {
          createdAt: Number.isFinite(Number(metaRaw && metaRaw.createdAt))
            ? Math.max(0, Math.trunc(Number(metaRaw.createdAt)))
            : 0,
          blockedAt: Number.isFinite(Number(metaRaw && (metaRaw.blockedAt || metaRaw.updatedAt || metaRaw.createdAt)))
            ? Math.max(0, Math.trunc(Number(metaRaw.blockedAt || metaRaw.updatedAt || metaRaw.createdAt)))
            : 0,
          reasonCode: sanitizeReasonCode(metaRaw && metaRaw.reasonCode),
          reasonLabel: sanitizeReasonLabel(metaRaw && metaRaw.reasonLabel),
          roomId: sanitizeText(metaRaw && metaRaw.roomId, 120),
          reporterProfileId: sanitizeText(metaRaw && metaRaw.reporterProfileId, 180),
          peerProfileId: sanitizeText(metaRaw && metaRaw.peerProfileId, 180),
          peerUserId: sanitizeText(metaRaw && metaRaw.peerUserId, 128),
        };
      });
      if (Object.keys(nextTargets).length > 0) {
        callBlocks[actorKey] = nextTargets;
      }
    });

    profileStore = { users, dinoRankEntries, popTalkWallets, callReports, callBlocks };
    resetProfileStoreDirtyState();
    lastClusterProfileStoreRefreshAt = now();
  } catch (e) {
    console.error("[profile-sync] load failed:", e && e.message ? e.message : e);
    profileStore = createEmptyProfileStore();
    resetProfileStoreDirtyState();
    lastClusterProfileStoreRefreshAt = now();
  }
}

async function persistProfileStoreNow() {
  ensureProfileStoreBackend();
  if (profileStoreBackend === "sqlite" && profileStoreDomainTx) {
    try {
      const dirtyState = {
        users: new Set(profileStoreDirtyState.users),
        wallets: new Set(profileStoreDirtyState.wallets),
        dinoEntryIds: new Set(profileStoreDirtyState.dinoEntryIds),
        callReportIds: new Set(profileStoreDirtyState.callReportIds),
        callBlockPairs: new Set(profileStoreDirtyState.callBlockPairs),
        fullUsers: profileStoreDirtyState.fullUsers,
        fullWallets: profileStoreDirtyState.fullWallets,
        fullDino: profileStoreDirtyState.fullDino,
        fullCallReports: profileStoreDirtyState.fullCallReports,
        fullCallBlocks: profileStoreDirtyState.fullCallBlocks,
      };
      profileStoreDomainTx(dirtyState);
      resetProfileStoreDirtyState();
      await publishProfileStoreSync();
      return;
    } catch (e) {
      console.error("[profile-sync] sqlite persist failed:", e && e.message ? e.message : e);
    }
  }

  ensureStoreDir();
  const tmpPath = PROFILE_STORE_PATH + ".tmp";
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(profileStore), "utf8");
    await fs.promises.rename(tmpPath, PROFILE_STORE_PATH);
    await publishProfileStoreSync();
  } catch (e) {
    console.error("[profile-sync] persist failed:", e && e.message ? e.message : e);
  }
}

function schedulePersistProfileStore(changedData = null) {
  if (changedData !== null) {
    persistBatch.push(changedData);
    markProfileStoreDirty(changedData);
  } else {
    markProfileStoreDirty(null);
  }
  persistDirty = true;

  if (persistTimer) return;

  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (!persistDirty || persistInFlight) return;

    persistDirty = false;
    persistInFlight = true;
    try {
      await persistProfileStoreNow();
      persistBatch = [];
    } catch (e) {
      console.error("[profile-sync] persist batch failed:", e && e.message ? e.message : e);
      persistDirty = true;
    } finally {
      persistInFlight = false;
      if (persistDirty) schedulePersistProfileStore();
    }
  }, PROFILE_PERSIST_BATCH_MS);
}

function upsertProfile(req, body) {
  const profileId = computeProfileId(req, body);
  if (!profileId) return null;

  const b = body || {};
  const nestedProfile = b.profile && typeof b.profile === "object" ? b.profile : {};
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

  if (!profileStore || typeof profileStore !== "object") profileStore = createEmptyProfileStore();
  if (!profileStore.users || typeof profileStore.users !== "object") profileStore.users = {};
  const prev = profileStore.users[profileId] && typeof profileStore.users[profileId] === "object" ? profileStore.users[profileId] : {};
  const prevBest = Number(prev.dinoBestScore || 0);
  const prevAvatarUrl = resolveStoredProfileAvatarUrl(prev);
  const hasNicknameField = hasOwn(b, "nickname") || hasOwn(nestedProfile, "nickname");
  const hasAvatarField =
    hasOwn(b, "avatarDataUrl") ||
    hasOwn(b, "avatarUrl") ||
    hasOwn(nestedProfile, "avatarDataUrl") ||
    hasOwn(nestedProfile, "avatarUrl");
  const hasInterestsField = hasOwn(b, "interests") || hasOwn(nestedProfile, "interests");

  let nextNickname = sanitizeText(prev.nickname || "", PROFILE_NICKNAME_MAX_LEN);
  let nextNicknameKey = sanitizeText(prev.nicknameKey || "", PROFILE_NICKNAME_MAX_LEN);
  if (hasNicknameField) {
    const validated = validateProfileNickname(
      hasOwn(b, "nickname") ? b.nickname : nestedProfile.nickname,
      profileId
    );
    nextNickname = validated.nickname;
    nextNicknameKey = validated.nicknameKey;
  }

  let nextAvatarDataUrl = prevAvatarUrl || "";
  let nextAvatarUpdatedAt = normalizeRtcInt(prev.avatarUpdatedAt, 0);
  if (hasAvatarField) {
    const avatarInput = hasOwn(b, "avatarDataUrl")
      ? b.avatarDataUrl
      : hasOwn(b, "avatarUrl")
        ? b.avatarUrl
        : hasOwn(nestedProfile, "avatarDataUrl")
          ? nestedProfile.avatarDataUrl
          : nestedProfile.avatarUrl;
    const avatarTrimmed = String(avatarInput ?? "").trim();
    if (!avatarTrimmed) {
      nextAvatarDataUrl = "";
      nextAvatarUpdatedAt = 0;
    } else {
      const sanitizedAvatar = sanitizeStoredProfileAvatarDataUrl(avatarTrimmed);
      if (!sanitizedAvatar) {
        throw createProfileError(400, "avatar_invalid", "avatar_invalid");
      }
      nextAvatarDataUrl = sanitizedAvatar;
      nextAvatarUpdatedAt = now();
    }
  }

  const nextInterests = hasInterestsField
    ? normalizeMatchInterestArray(hasOwn(b, "interests") ? b.interests : nestedProfile.interests, {
        allowAll: false,
        fallbackToAll: false,
      }).slice(0, PROFILE_INTEREST_MAX_COUNT)
    : normalizeMatchInterestArray(prev.interests, { allowAll: false, fallbackToAll: false }).slice(0, PROFILE_INTEREST_MAX_COUNT);

  const merged = {
    profileId: profileId,
    country: country || prev.country || "",
    language: language || prev.language || "",
    gender: gender || prev.gender || "",
    flag: flag || prev.flag || "",
    dinoBestScore: Math.max(prevBest, nextBest),
    dinoBestComment: comment || prev.dinoBestComment || "",
    nickname: nextNickname || "",
    nicknameKey: nextNicknameKey || "",
    avatarDataUrl: nextAvatarDataUrl || "",
    interests: nextInterests,
    avatarUpdatedAt: nextAvatarUpdatedAt || 0,
    ...(prev.matchFilter && typeof prev.matchFilter === "object" ? { matchFilter: normalizeMatchFilterPayload(prev.matchFilter) } : {}),
    updatedAt: now(),
  };

  profileStore.users[profileId] = merged;
  schedulePersistProfileStore({ type: "user", profileId });

  try {
    const mergedCountry = normalizeCountryCode(merged.country || "");
    let touchedLoginEvents = false;
    if (mergedCountry) {
      const sessions = Array.from(loginPresenceBySession.entries());
      sessions.forEach(([sessionKey, row]) => {
        if (!row || row.profileId !== profileId) return;
        const prevCountry = normalizeCountryCode(row.country || "");
        if (prevCountry) return;
        const nextRow = { ...row, country: mergedCountry };
        loginPresenceBySession.set(sessionKey, nextRow);
        broadcastLoginPresenceUpdate(nextRow);
      });

      for (let i = loginEvents.length - 1; i >= 0; i -= 1) {
        const ev = loginEvents[i];
        if (!ev || ev.profileId !== profileId) continue;
        const prevCountry = normalizeCountryCode(ev.country || "");
        if (prevCountry) continue;
        ev.country = mergedCountry;
        touchedLoginEvents = true;
      }
    }
    if (touchedLoginEvents) schedulePersistLoginEvents();
  } catch {}

  return {
    ...merged,
    ...buildPublicProfilePayload(profileId, merged),
  };
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
  let trimmed = false;
  if (entries.length > 5000) {
    entries.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    entries.splice(0, entries.length - 5000);
    trimmed = true;
  }
  profileStore.dinoRankEntries = entries;
  schedulePersistProfileStore(trimmed ? { type: "dino_full" } : { type: "dino_entry", entryId: next.entryId });

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

mountPublicApiRoutes(app, {
  appendDinoRankEntry,
  broadcastUnifiedStateByProfile,
  buildLeaderboard,
  buildPopTalkSnapshot,
  computePopTalkDisplayCap,
  computeProfileId,
  deriveBindHash,
  ensurePopTalkWallet,
  getPopTalkIdempotencyRecord,
  getPopTalkPlanConfig,
  now,
  persistProfileStoreNow,
  profileIdFromSignalSession,
  readStoredMatchFilter,
  resolveStoredMatchFilter,
  sanitizeAiReplyText,
  sanitizeText,
  saveMatchFilter,
  savePopTalkIdempotencyRecord,
  schedulePersistProfileStore,
  upsertProfile,
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
  const premiumExpiresAtMs = resolvePopTalkPremiumExpiresAtMs(null, b);
  const remoteIp = sanitizeText(ws && ws._remoteIp, 128);
  return {
    headers: {
      authorization: token ? `Bearer ${token}` : "",
      "x-user-id": userId,
      "x-device-key": deviceKey,
      "x-plan-id": planId,
      "x-store-product-id": storeProductId,
      "x-is-premium": isPremium,
      "x-premium-expires-at-ms": premiumExpiresAtMs > 0 ? String(premiumExpiresAtMs) : "",
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
  const planOverrideRaw = payload.popTalkPlanOverride || body.popTalkPlanOverride || body.planOverride || "";
  const planOverride = parsePopTalkPlan(planOverrideRaw);
  const unlimitedUntilRaw = Number(payload.unlimitedUntilMs ?? body.unlimitedUntilMs);
  const unlimitedUntilMs = Number.isFinite(unlimitedUntilRaw) ? Math.max(0, Math.trunc(unlimitedUntilRaw)) : 0;

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
  const nextBalance = beforeBalance + convertedPopTalk;

  if (planOverride) {
    wallet.plan = planOverride;
  }
  if (unlimitedUntilMs > atMs) {
    wallet.unlimitedUntilMs = unlimitedUntilMs;
  }
  const unlimitedActive = Number(wallet.unlimitedUntilMs) > atMs;

  wallet.balance = Math.max(0, nextBalance);
  if (unlimitedActive) {
    wallet.plan = "monthly";
    wallet.balance = Math.max(wallet.balance, POPTALK_UNLIMITED_CAP);
  }
  wallet.cap = computePopTalkDisplayCap(wallet.plan, wallet.balance, { unlimitedActive });
  wallet.updatedAt = atMs;
  schedulePersistProfileStore({ type: "wallet", profileId: ensured.profileId || profileIdHint });

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
        wallet: out.wallet || { kernelBalance: 0 },
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
      wallet: wallet || { kernelBalance: 0 },
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

const LOGIN_EVENT_MAX = Number(process.env.LOGIN_EVENT_MAX || 20000);
const LOGIN_EVENT_CACHE_MAX = Number(process.env.LOGIN_EVENT_CACHE_MAX || 1200);
const LOGIN_EVENT_SNAPSHOT_LIMIT = Number(process.env.LOGIN_EVENT_SNAPSHOT_LIMIT || 120);
const LOGIN_ACTIVE_WINDOW_MS = Number(process.env.LOGIN_ACTIVE_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_PRESENCE_MAX = Number(process.env.LOGIN_PRESENCE_MAX || 5000);
const LOGIN_EVENT_CLOCK_SKEW_FUTURE_MS = Number(process.env.LOGIN_EVENT_CLOCK_SKEW_FUTURE_MS || 2 * 60 * 1000);
const LOGIN_EVENT_CLOCK_SKEW_PAST_MS = Number(process.env.LOGIN_EVENT_CLOCK_SKEW_PAST_MS || 365 * 24 * 60 * 60 * 1000);
const loginEvents = [];
const loginEventStreams = new Set();
const loginPresenceBySession = new Map();
const loginAccountByUserId = new Map();
const loginLatestSessionByIdentity = new Map();
const LOGIN_ACCOUNT_BY_USER_MAX = Number(process.env.LOGIN_ACCOUNT_BY_USER_MAX || 20000);
const LOGIN_SESSION_CLAIM_PROVIDERS = new Set(["google_native", "apple_native", "device_bind"]);

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

function normalizeCountryCode(raw) {
  const code = sanitizeLoginMonitorField(raw || "", 16).toUpperCase();
  if (/^[A-Z]{2}$/.test(code)) return code;
  return "";
}

function readRequestCountryByHeaders(req) {
  const headers = req && req.headers ? req.headers : {};
  const candidates = [
    headers["x-geo-country"],
    headers["x-country-code"],
    headers["x-country"],
    headers["cf-ipcountry"],
    headers["cloudfront-viewer-country"],
    headers["x-vercel-ip-country"],
    headers["x-appengine-country"],
    headers["x-azure-ref-country"],
  ];
  for (const c of candidates) {
    const code = normalizeCountryCode(c);
    if (code) return code;
  }
  return "";
}

function readRequestCountryByAcceptLanguage(req) {
  const raw = sanitizeLoginMonitorField((req && req.headers && req.headers["accept-language"]) || "", 256);
  if (!raw) return "";
  const first = raw.split(",")[0] || "";
  const match = first.match(/-([A-Za-z]{2})(?:$|[^A-Za-z])/);
  if (!match || !match[1]) return "";
  return normalizeCountryCode(match[1]);
}

function readStoredCountryByProfileId(rawProfileId) {
  const profileId = sanitizeLoginMonitorField(rawProfileId || "", 180);
  if (!profileId) return "";
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : null;
  if (!users) return "";
  const row = users[profileId];
  if (!row || typeof row !== "object") return "";
  return normalizeCountryCode(row.country || row.region || "");
}

function readStoredLoginAccountByProfileId(rawProfileId) {
  const profileId = sanitizeLoginMonitorField(rawProfileId || "", 180);
  if (!profileId) return "";
  const users = profileStore && profileStore.users && typeof profileStore.users === "object" ? profileStore.users : null;
  if (!users) return "";
  const row = users[profileId];
  if (!row || typeof row !== "object") return "";
  return normalizeLoginAccountValue(row.loginAccount || row.email || row.account || "");
}

function rememberProfileLoginAccount(rawProfileId, rawLoginAccount) {
  const profileId = sanitizeLoginMonitorField(rawProfileId || "", 180);
  const loginAccount = normalizeLoginAccountValue(rawLoginAccount);
  if (!profileId || !loginAccount) return;
  if (!profileStore || typeof profileStore !== "object") return;
  if (!profileStore.users || typeof profileStore.users !== "object") profileStore.users = {};
  const prev = profileStore.users[profileId] || {};
  if (normalizeLoginAccountValue(prev.loginAccount || "") === loginAccount) return;
  profileStore.users[profileId] = {
    ...prev,
    profileId: sanitizeText(prev.profileId || profileId, 180) || profileId,
    loginAccount,
    updatedAt: now(),
  };
  schedulePersistProfileStore({ type: "user", profileId });
}

function resolveRequestCountry(req, rawCountry, rawProfileId = "") {
  const fromBody = normalizeCountryCode(rawCountry);
  if (fromBody) return fromBody;
  const fromHeader = readRequestCountryByHeaders(req);
  if (fromHeader) return fromHeader;
  const fromLang = readRequestCountryByAcceptLanguage(req);
  if (fromLang) return fromLang;
  return readStoredCountryByProfileId(rawProfileId);
}

function normalizeLoginUserId(rawUserId) {
  return sanitizeLoginMonitorField(rawUserId || "", 128).toLowerCase();
}

function normalizeLoginAccountValue(rawLoginAccount) {
  const loginAccount = sanitizeLoginMonitorField(rawLoginAccount || "", 240).toLowerCase();
  if (!loginAccount) return "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(loginAccount)) return "";
  return loginAccount;
}

function rememberLoginAccountByUserId(rawUserId, rawLoginAccount) {
  const userId = normalizeLoginUserId(rawUserId);
  const loginAccount = normalizeLoginAccountValue(rawLoginAccount);
  if (!userId || !loginAccount) return "";
  if (loginAccountByUserId.has(userId)) {
    loginAccountByUserId.delete(userId);
  }
  loginAccountByUserId.set(userId, loginAccount);
  if (loginAccountByUserId.size > LOGIN_ACCOUNT_BY_USER_MAX) {
    const removeCount = loginAccountByUserId.size - LOGIN_ACCOUNT_BY_USER_MAX;
    for (let i = 0; i < removeCount; i += 1) {
      const firstKey = loginAccountByUserId.keys().next().value;
      if (!firstKey) break;
      loginAccountByUserId.delete(firstKey);
    }
  }
  return loginAccount;
}

function stabilizeLoginAccount(rawUserId, rawLoginAccount) {
  const userId = normalizeLoginUserId(rawUserId);
  const loginAccount = normalizeLoginAccountValue(rawLoginAccount);
  if (userId && loginAccount) {
    return rememberLoginAccountByUserId(userId, loginAccount);
  }
  if (userId) {
    const remembered = normalizeLoginAccountValue(loginAccountByUserId.get(userId) || "");
    if (remembered) return remembered;
  }
  return loginAccount;
}

function pickNonEmptyLoginAccount(...candidates) {
  for (const raw of candidates) {
    const v = normalizeLoginAccountValue(raw);
    if (v) return v;
  }
  return "";
}

function pickNonEmptyValue(...candidates) {
  for (const raw of candidates) {
    const v = sanitizeLoginMonitorField(raw || "", 240);
    if (v) return v;
  }
  return "";
}

function resolveStableLoginAccount(rawUserId, ...candidates) {
  const userId = normalizeLoginUserId(rawUserId);
  const picked = pickNonEmptyLoginAccount(...candidates);
  const stabilized = stabilizeLoginAccount(userId, picked);
  if (stabilized) return stabilized;
  return "";
}

function normalizeLoginProvider(rawProvider) {
  return sanitizeLoginMonitorField(rawProvider || "", 48).toLowerCase();
}

function getLoginSessionFingerprint(event) {
  const deviceHash = sanitizeLoginMonitorField((event && event.deviceHash) || "", 24);
  if (deviceHash) return "d:" + deviceHash;

  const tokenHash = sanitizeLoginMonitorField((event && event.tokenHash) || "", 24);
  if (tokenHash) return "t:" + tokenHash;

  const ip = sanitizeLoginMonitorField((event && event.ip) || "", 128);
  if (ip) return "i:" + ip;

  return "";
}

function buildLatestLoginSessionRecord(event) {
  const identityKey = getLoginIdentityKey(event);
  const sessionFingerprint = getLoginSessionFingerprint(event);
  if (!identityKey || !sessionFingerprint) return null;

  const seenAtMs = normalizeRtcInt(event && (event.serverAtMs ?? event.atMs), now());
  return {
    identityKey,
    sessionFingerprint,
    provider: normalizeLoginProvider(event && event.provider),
    seenAtMs,
    updatedAtMs: seenAtMs,
  };
}

function rememberLatestLoginSession(event, replaceExisting = false) {
  const next = buildLatestLoginSessionRecord(event);
  if (!next) return null;

  const prev = loginLatestSessionByIdentity.get(next.identityKey);
  if (!prev || replaceExisting) {
    loginLatestSessionByIdentity.set(next.identityKey, next);
    return next;
  }

  if (sanitizeLoginMonitorField(prev.sessionFingerprint || "", 160) !== next.sessionFingerprint) {
    return prev;
  }

  const merged = {
    ...prev,
    provider: next.provider || prev.provider || "",
    seenAtMs: Math.max(normalizeRtcInt(prev.seenAtMs, 0), next.seenAtMs),
    updatedAtMs: Math.max(normalizeRtcInt(prev.updatedAtMs, 0), next.updatedAtMs),
  };
  loginLatestSessionByIdentity.set(next.identityKey, merged);
  return merged;
}

function resolveViewerCallContactForRecallInvite(viewerProfileIds, actorProfileId = "", actorSessionId = "") {
  const ids = Array.isArray(viewerProfileIds)
    ? viewerProfileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean)
    : [];
  const pid = sanitizeText(actorProfileId || "", 180);
  const sid = sanitizeText(actorSessionId || "", 256);
  if (ids.length <= 0 || (!pid && !sid)) return null;
  const mergedRows = mergeCallContactRows(ids.flatMap((profileId) => listCallContacts(profileId, 500)));
  return (
    mergedRows.find((row) => {
      const item = normalizeCallContactRow(row);
      return (pid && item.peerProfileId === pid) || (sid && item.peerSessionId === sid);
    }) || null
  );
}

async function enrichPendingCallRecallInvite(invite, viewerProfileIds = []) {
  const base = invite && typeof invite === "object" ? invite : null;
  if (!base) return null;

  const actorSessionId = sanitizeText(base.actorSessionId || "", 256);
  let actorProfileId = sanitizeText(base.actorProfileId || "", 180);
  const actorLive = await resolvePeerSessionForCallContact(actorSessionId, actorProfileId);
  if (!actorProfileId) actorProfileId = sanitizeText(actorLive && actorLive.profileId, 180);

  const viewerContact = resolveViewerCallContactForRecallInvite(viewerProfileIds, actorProfileId, actorSessionId);
  const storedProfile = getStoredProfileUserRow(actorProfileId);
  const publicProfile = buildPublicProfilePayload(actorProfileId, storedProfile);
  const actorHomePresence = !actorLive && actorProfileId ? resolveActiveHomePresenceForProfile(actorProfileId) : null;

  const actorNickname = pickPreferredProfileNickname(
    publicProfile.nickname,
    viewerContact && viewerContact.peerNickname,
    base.actorNickname
  );
  const actorAvatarUrl =
    resolveStoredProfileAvatarUrl({ avatarDataUrl: base.actorAvatarUrl, avatarUrl: base.actorAvatarUrl }) ||
    resolveStoredProfileAvatarUrl({ avatarDataUrl: publicProfile.avatarUrl, avatarUrl: publicProfile.avatarUrl }) ||
    "";
  const actorCountry = normalizeMatchCountry(base.actorCountry || (actorLive && actorLive.country) || (actorHomePresence && actorHomePresence.country) || "");
  const actorLanguage = normalizeMatchLanguage(
    base.actorLanguage || (actorLive && actorLive.language) || (actorHomePresence && actorHomePresence.language) || ""
  );
  const actorGender = normalizeMatchGender(base.actorGender || (actorLive && actorLive.gender) || (actorHomePresence && actorHomePresence.gender) || "");
  const actorFlag = sanitizeText(base.actorFlag || (actorHomePresence && actorHomePresence.flag) || "", 8);
  const actorLoginAccount = normalizeLoginAccountValue(
    base.actorLoginAccount || (viewerContact && viewerContact.peerLoginAccount) || resolveCallReportLoginAccount(actorProfileId, "")
  );

  return {
    ...base,
    actorSessionId: actorSessionId || undefined,
    actorProfileId: actorProfileId || undefined,
    actorNickname: actorNickname || undefined,
    actorAvatarUrl: actorAvatarUrl || undefined,
    actorCountry: actorCountry || undefined,
    actorLanguage: actorLanguage || undefined,
    actorGender: actorGender || undefined,
    actorFlag: actorFlag || undefined,
    actorLoginAccount: actorLoginAccount || undefined,
  };
}

function applyLatestLoginSessionRecord(record) {
  const row = record && typeof record === "object" ? record : null;
  if (!row) return null;

  const identityKey = sanitizeLoginMonitorField(row.identityKey || "", 240).toLowerCase();
  const sessionFingerprint = sanitizeLoginMonitorField(row.sessionFingerprint || "", 160);
  if (!identityKey || !sessionFingerprint) return null;

  const next = {
    identityKey,
    sessionFingerprint,
    provider: normalizeLoginProvider(row.provider),
    seenAtMs: normalizeRtcInt(row.seenAtMs ?? row.updatedAtMs, 0),
    updatedAtMs: normalizeRtcInt(row.updatedAtMs ?? row.seenAtMs, 0),
  };
  const prev = loginLatestSessionByIdentity.get(identityKey);
  if (!prev) {
    loginLatestSessionByIdentity.set(identityKey, next);
    return next;
  }

  if (sanitizeLoginMonitorField(prev.sessionFingerprint || "", 160) === next.sessionFingerprint) {
    const merged = {
      ...prev,
      provider: next.provider || prev.provider || "",
      seenAtMs: Math.max(normalizeRtcInt(prev.seenAtMs, 0), next.seenAtMs),
      updatedAtMs: Math.max(normalizeRtcInt(prev.updatedAtMs, 0), next.updatedAtMs),
    };
    loginLatestSessionByIdentity.set(identityKey, merged);
    return merged;
  }

  const prevAtMs = Math.max(normalizeRtcInt(prev.updatedAtMs, 0), normalizeRtcInt(prev.seenAtMs, 0));
  const nextAtMs = Math.max(next.updatedAtMs, next.seenAtMs);
  if (nextAtMs <= prevAtMs) {
    return prev;
  }

  loginLatestSessionByIdentity.set(identityKey, next);
  return next;
}

function isLoginSessionClaimProvider(rawProvider) {
  return LOGIN_SESSION_CLAIM_PROVIDERS.has(normalizeLoginProvider(rawProvider));
}

function evaluateLoginSessionConflict(event) {
  const identityKey = getLoginIdentityKey(event);
  const sessionFingerprint = getLoginSessionFingerprint(event);
  if (!identityKey || !sessionFingerprint) {
    return {
      forceLogout: false,
      reason: "",
      latestSession: null,
      shouldUpdatePresence: true,
      latestSessionChanged: false,
    };
  }

  const existing = loginLatestSessionByIdentity.get(identityKey);
  if (!existing) {
    return {
      forceLogout: false,
      reason: "",
      latestSession: rememberLatestLoginSession(event, true),
      shouldUpdatePresence: true,
      latestSessionChanged: true,
    };
  }

  if (sanitizeLoginMonitorField(existing.sessionFingerprint || "", 160) === sessionFingerprint) {
    return {
      forceLogout: false,
      reason: "",
      latestSession: rememberLatestLoginSession(event, false),
      shouldUpdatePresence: true,
      latestSessionChanged: false,
    };
  }

  if (isLoginSessionClaimProvider(event && event.provider)) {
    return {
      forceLogout: false,
      reason: "",
      latestSession: rememberLatestLoginSession(event, true),
      shouldUpdatePresence: true,
      latestSessionChanged: true,
    };
  }

  return {
    forceLogout: true,
    reason: "other_device_login",
    latestSession: existing,
    shouldUpdatePresence: false,
    latestSessionChanged: false,
  };
}

function rebuildLatestLoginSessionIndex() {
  loginLatestSessionByIdentity.clear();
  const rows = Array.isArray(loginEvents) ? loginEvents.slice() : [];
  rows
    .sort((a, b) => Number(a && a.serverAtMs || 0) - Number(b && b.serverAtMs || 0))
    .forEach((event) => {
      const identityKey = getLoginIdentityKey(event);
      const sessionFingerprint = getLoginSessionFingerprint(event);
      if (!identityKey || !sessionFingerprint) return;

      if (!loginLatestSessionByIdentity.has(identityKey)) {
        rememberLatestLoginSession(event, true);
        return;
      }

      if (isLoginSessionClaimProvider(event && event.provider)) {
        rememberLatestLoginSession(event, true);
        return;
      }

      rememberLatestLoginSession(event, false);
    });
}

function normalizeLoadedLoginEvent(rawEvent, index = 0) {
  const e = rawEvent && typeof rawEvent === "object" ? rawEvent : {};
  const atMsRaw = Number(e.atMs ?? e.serverAtMs ?? 0);
  const atMs = Number.isFinite(atMsRaw) && atMsRaw > 0 ? Math.trunc(atMsRaw) : now();
  const serverAtMsRaw = Number(e.serverAtMs ?? atMs);
  const serverAtMs = Number.isFinite(serverAtMsRaw) && serverAtMsRaw > 0 ? Math.trunc(serverAtMsRaw) : atMs;
  const userId = sanitizeLoginMonitorField(e.userId || "", 128);
  const profileId = sanitizeLoginMonitorField(e.profileId || "", 180);
  if (!userId && !profileId) return null;

  return {
    eventId: sanitizeLoginMonitorField(e.eventId || `le_restore_${serverAtMs}_${index}`, 96),
    atMs,
    atIso: new Date(atMs).toISOString(),
    serverAtMs,
    serverAtIso: new Date(serverAtMs).toISOString(),
    loginAccount: resolveStableLoginAccount(userId, e.loginAccount || e.email || e.account || ""),
    userId,
    profileId,
    subscriptionStatus: sanitizeLoginMonitorField(e.subscriptionStatus || "", 24).toLowerCase(),
    isPremium: e && e.isPremium != null ? normalizeBooleanLike(e.isPremium) : null,
    planId: sanitizeLoginMonitorField(e.planId || "", 64),
    storeProductId: sanitizeLoginMonitorField(e.storeProductId || "", 120),
    popTalkCount: toSafeInt(e.popTalkCount ?? e.popTalkBalance),
    kernelCount: toSafeInt(e.kernelCount),
    totalPaymentKrw: toSafeInt(e.totalPaymentKrw),
    provider: sanitizeLoginMonitorField(e.provider || "unknown", 48),
    platform: sanitizeLoginMonitorField(e.platform || "", 24),
    appVersion: sanitizeLoginMonitorField(e.appVersion || "", 40),
    country: normalizeCountryCode(e.country || e.countryCode || ""),
    language: sanitizeLoginMonitorField(e.language || "", 16).toLowerCase(),
    gender: sanitizeLoginMonitorField(e.gender || "", 16).toLowerCase(),
    ip: sanitizeLoginMonitorField(e.ip || "", 128),
    tokenHash: sanitizeLoginMonitorField(e.tokenHash || "", 24),
    deviceHash: sanitizeLoginMonitorField(e.deviceHash || "", 24),
  };
}

function hydrateLoginEventForRead(event) {
  const row = event && typeof event === "object" ? { ...event } : null;
  if (!row) return null;
  if (!normalizeCountryCode(row.country || "")) {
    row.country = readStoredCountryByProfileId(row.profileId);
  }
  if (!normalizeLoginAccountValue(row.loginAccount || "")) {
    row.loginAccount = readStoredLoginAccountByProfileId(row.profileId);
  }
  return row;
}

function ensureLoginEventsSqliteTables() {
  if (!profileStoreSqlite) return;
  profileStoreSqlite.exec(`
    CREATE TABLE IF NOT EXISTS login_events (
      eventId TEXT PRIMARY KEY,
      serverAtMs INTEGER NOT NULL,
      atMs INTEGER NOT NULL,
      identityKey TEXT NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_events_serverAtMs ON login_events(serverAtMs DESC);
    CREATE INDEX IF NOT EXISTS idx_login_events_atMs ON login_events(atMs DESC);
    CREATE INDEX IF NOT EXISTS idx_login_events_identityKey ON login_events(identityKey);
    CREATE TABLE IF NOT EXISTS login_presence (
      sessionKey TEXT PRIMARY KEY,
      lastSeenAtMs INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_presence_lastSeenAtMs ON login_presence(lastSeenAtMs DESC);
  `);
  countLoginEventsSqliteStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM login_events");
  insertLoginEventSqliteStmt = profileStoreSqlite.prepare(
    "INSERT INTO login_events (eventId, serverAtMs, atMs, identityKey, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(eventId) DO UPDATE SET serverAtMs = excluded.serverAtMs, atMs = excluded.atMs, identityKey = excluded.identityKey, data = excluded.data"
  );
  listLoginEventsSqliteStmt = profileStoreSqlite.prepare(
    "SELECT data FROM login_events ORDER BY serverAtMs DESC LIMIT ?"
  );
  listLoginEventsByAtRangeSqliteStmt = profileStoreSqlite.prepare(
    "SELECT data FROM login_events WHERE atMs >= ? AND atMs <= ? ORDER BY serverAtMs ASC LIMIT ?"
  );
  upsertLoginPresenceSqliteStmt = profileStoreSqlite.prepare(
    "INSERT INTO login_presence (sessionKey, lastSeenAtMs, data) VALUES (?, ?, ?) ON CONFLICT(sessionKey) DO UPDATE SET lastSeenAtMs = excluded.lastSeenAtMs, data = excluded.data"
  );
  listActiveLoginPresenceSqliteStmt = profileStoreSqlite.prepare(
    "SELECT data FROM login_presence WHERE lastSeenAtMs >= ? ORDER BY lastSeenAtMs DESC LIMIT ?"
  );
  listAllLoginPresenceSqliteStmt = profileStoreSqlite.prepare(
    "SELECT data FROM login_presence ORDER BY lastSeenAtMs DESC"
  );
  countLoginPresenceSqliteStmt = profileStoreSqlite.prepare("SELECT COUNT(1) AS total FROM login_presence");
  countActiveLoginPresenceSqliteStmt = profileStoreSqlite.prepare(
    "SELECT COUNT(1) AS total FROM login_presence WHERE lastSeenAtMs >= ?"
  );
}

function appendRecentLoginEventCache(event) {
  const row = hydrateLoginEventForRead(event);
  if (!row) return;
  loginEvents.push(row);
  if (loginEvents.length > LOGIN_EVENT_CACHE_MAX) {
    loginEvents.splice(0, loginEvents.length - LOGIN_EVENT_CACHE_MAX);
  }
}

function listRecentLoginEventsFromStore(limit = LOGIN_EVENT_SNAPSHOT_LIMIT) {
  const hardLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(500, Math.trunc(Number(limit)))) : LOGIN_EVENT_SNAPSHOT_LIMIT;
  if (profileStoreBackend === "sqlite" && profileStoreSqlite && !listLoginEventsSqliteStmt) ensureLoginEventsSqliteTables();
  if (profileStoreBackend === "sqlite" && listLoginEventsSqliteStmt) {
    return listLoginEventsSqliteStmt
      .all(hardLimit)
      .map((row, index) => hydrateLoginEventForRead(normalizeLoadedLoginEvent(parseJsonSafe(row && row.data, null), index)))
      .filter(Boolean);
  }
  return loginEvents.slice(Math.max(0, loginEvents.length - hardLimit)).reverse().map((row) => hydrateLoginEventForRead(row)).filter(Boolean);
}

function listLoginEventsByAtRange(minAtMs, maxAtMs, limit = LOGIN_EVENT_MAX) {
  const minMs = normalizeRtcInt(minAtMs, 0);
  const maxMs = normalizeRtcInt(maxAtMs, 0);
  const hardLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(LOGIN_EVENT_MAX, Math.trunc(Number(limit)))) : LOGIN_EVENT_MAX;
  if (profileStoreBackend === "sqlite" && profileStoreSqlite && !listLoginEventsByAtRangeSqliteStmt) ensureLoginEventsSqliteTables();
  if (profileStoreBackend === "sqlite" && listLoginEventsByAtRangeSqliteStmt) {
    return listLoginEventsByAtRangeSqliteStmt
      .all(minMs, maxMs, hardLimit)
      .map((row, index) => hydrateLoginEventForRead(normalizeLoadedLoginEvent(parseJsonSafe(row && row.data, null), index)))
      .filter(Boolean);
  }
  return loginEvents.filter((event) => {
    const atMs = getLoginSeenAtMs(event);
    return atMs >= minMs && atMs <= maxMs;
  });
}

function persistLoginEventsNow() {
  if (profileStoreBackend === "sqlite" && insertLoginEventSqliteStmt) return;
  try {
    fs.mkdirSync(path.dirname(LOGIN_EVENTS_STORE_PATH), { recursive: true });
    const tmpPath = `${LOGIN_EVENTS_STORE_PATH}.tmp`;
    const payload = {
      updatedAt: now(),
      total: loginEventTotalCount,
      events: loginEvents,
    };
    fs.writeFileSync(tmpPath, JSON.stringify(payload), "utf8");
    fs.renameSync(tmpPath, LOGIN_EVENTS_STORE_PATH);
  } catch (e) {
    console.error("[login-events] persist failed:", e && e.message ? e.message : e);
  }
}

function schedulePersistLoginEvents() {
  if (profileStoreBackend === "sqlite" && insertLoginEventSqliteStmt) return;
  try {
    if (loginEventsPersistTimer) clearTimeout(loginEventsPersistTimer);
  } catch {}
  loginEventsPersistTimer = setTimeout(() => {
    loginEventsPersistTimer = null;
    persistLoginEventsNow();
  }, Math.max(0, Math.trunc(Number(LOGIN_EVENTS_SAVE_DEBOUNCE_MS) || 0)));
}

function rebuildLoginPresenceFromEvents() {
  loginPresenceBySession.clear();
  loginAccountByUserId.clear();
  const rows =
    profileStoreBackend === "sqlite" && listAllLoginPresenceSqliteStmt
      ? listAllLoginPresenceSqliteStmt
          .all()
          .map((row, index) => hydrateLoginEventForRead(normalizeLoadedLoginEvent(parseJsonSafe(row && row.data, null), index)))
          .filter(Boolean)
      : loginEvents;
  for (const event of rows) {
    const uid = normalizeLoginUserId(event && event.userId);
    if (uid && event && event.loginAccount) rememberLoginAccountByUserId(uid, event.loginAccount);
    upsertLoginPresence(event);
  }
}

function loadLoginEventsStore() {
  try {
    if (profileStoreBackend === "sqlite" && profileStoreSqlite) {
      ensureLoginEventsSqliteTables();
      const total = countSqliteRows(countLoginEventsSqliteStmt);
      if (total === 0 && fs.existsSync(LOGIN_EVENTS_STORE_PATH)) {
        const rawLegacy = fs.readFileSync(LOGIN_EVENTS_STORE_PATH, "utf8");
        const parsedLegacy = parseJsonSafe(rawLegacy, null);
        const rowsLegacy = Array.isArray(parsedLegacy) ? parsedLegacy : Array.isArray(parsedLegacy && parsedLegacy.events) ? parsedLegacy.events : [];
        if (rowsLegacy.length) {
          const tx = profileStoreSqlite.transaction((rows) => {
            rows.forEach((rawRow, index) => {
              const row = normalizeLoadedLoginEvent(rawRow, index);
              if (!row) return;
              insertLoginEventSqliteStmt.run(
                sanitizeLoginMonitorField(row.eventId, 96),
                normalizeRtcInt(row.serverAtMs, now()),
                normalizeRtcInt(row.atMs, now()),
                getLoginIdentityKey(row),
                safeJsonStringify(row)
              );
              upsertLoginPresenceSqliteStmt.run(
                sanitizeLoginMonitorField(getLoginPresenceKey(row), 200),
                normalizeRtcInt(row.serverAtMs || row.atMs, now()),
                safeJsonStringify(upsertLoginPresence(row))
              );
              appendRecentLoginEventCache(row);
            });
          });
          tx(rowsLegacy);
        }
      }
      loginEventTotalCount = countSqliteRows(countLoginEventsSqliteStmt);
      loginEvents.splice(0, loginEvents.length, ...listRecentLoginEventsFromStore(Math.min(LOGIN_EVENT_CACHE_MAX, LOGIN_EVENT_MAX)).slice().reverse());
      rebuildLoginPresenceFromEvents();
      rebuildLatestLoginSessionIndex();
      return;
    }

    if (!fs.existsSync(LOGIN_EVENTS_STORE_PATH)) return;
    const raw = fs.readFileSync(LOGIN_EVENTS_STORE_PATH, "utf8");
    if (!raw) return;
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.events) ? parsed.events : [];
    if (!rows.length) return;

    const normalized = [];
    for (let i = 0; i < rows.length; i += 1) {
      const row = normalizeLoadedLoginEvent(rows[i], i);
      if (!row) continue;
      normalized.push(row);
    }
    normalized.sort((a, b) => Number(a.serverAtMs || 0) - Number(b.serverAtMs || 0));
    const trimmed = normalized.length > LOGIN_EVENT_MAX ? normalized.slice(normalized.length - LOGIN_EVENT_MAX) : normalized;
    loginEvents.splice(0, loginEvents.length, ...trimmed);
    loginEventTotalCount = trimmed.length;
    rebuildLoginPresenceFromEvents();
    rebuildLatestLoginSessionIndex();
  } catch (e) {
    console.error("[login-events] load failed:", e && e.message ? e.message : e);
  }
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
  const loginAccount = resolveStableLoginAccount(
    userId,
    b.loginAccount || b.email || b.account || "",
    readStoredLoginAccountByProfileId(profileId),
  );
  const signalProfileId = deviceKey ? profileIdFromSignalSession(deviceKey, parseBearer(req), userId) : "";
  const country = resolveRequestCountry(req, b.country || b.countryCode || b.region || "", profileId);
  rememberProfileLoginAccount(profileId, loginAccount);
  if (signalProfileId && signalProfileId !== profileId) {
    rememberProfileLoginAccount(signalProfileId, loginAccount);
  }

  return {
    eventId: "le_" + serverAtMs + "_" + Math.random().toString(16).slice(2, 10),
    atMs,
    atIso: new Date(atMs).toISOString(),
    serverAtMs,
    serverAtIso: new Date(serverAtMs).toISOString(),
    loginAccount,
    userId,
    profileId: sanitizeLoginMonitorField(profileId, 180),
    subscriptionStatus: parseSubscriptionStatus(b),
    isPremium: normalizeBooleanLike(b.isPremium),
    planId: sanitizeLoginMonitorField(b.planId || "", 64),
    storeProductId: sanitizeLoginMonitorField(b.storeProductId || "", 120),
    popTalkCount: toSafeInt(b.popTalkCount ?? b.popTalkBalance),
    kernelCount: toSafeInt(b.kernelCount ?? b.kernels),
    totalPaymentKrw: toSafeInt(b.totalPaymentKrw ?? b.cumulativePaymentKrw ?? b.totalPaidKrw),
    provider: sanitizeLoginMonitorField(b.provider || b.authProvider || "unknown", 48),
    platform: sanitizeLoginMonitorField(b.platform || "", 24),
    appVersion: sanitizeLoginMonitorField(b.appVersion || b.version || "", 40),
    country,
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
  const mergedProfileId = sanitizeLoginMonitorField((event && event.profileId) || (prev && prev.profileId) || "", 180);
  const mergedUserId = sanitizeLoginMonitorField((event && event.userId) || (prev && prev.userId) || "", 128);
  const mergedLoginAccount = resolveStableLoginAccount(
    mergedUserId,
    event && event.loginAccount,
    prev && prev.loginAccount,
    readStoredLoginAccountByProfileId(mergedProfileId),
  );
  const mergedCountry = normalizeCountryCode(
    pickNonEmptyValue(
      event && event.country,
      prev && prev.country,
      readStoredCountryByProfileId(mergedProfileId),
    ),
  );

  const row = {
    sessionKey: key,
    firstSeenAtMs,
    firstSeenAtIso: new Date(firstSeenAtMs).toISOString(),
    lastSeenAtMs,
    atMs: lastSeenAtMs,
    atIso: new Date(lastSeenAtMs).toISOString(),
    loginAccount: mergedLoginAccount,
    userId: mergedUserId,
    profileId: mergedProfileId,
    subscriptionStatus: sanitizeLoginMonitorField((event && event.subscriptionStatus) || (prev && prev.subscriptionStatus) || "", 24).toLowerCase(),
    isPremium: event && event.isPremium != null ? event.isPremium : prev && prev.isPremium != null ? prev.isPremium : null,
    planId: sanitizeLoginMonitorField((event && event.planId) || (prev && prev.planId) || "", 64),
    storeProductId: sanitizeLoginMonitorField((event && event.storeProductId) || (prev && prev.storeProductId) || "", 120),
    popTalkCount: toSafeInt(
      event && event.popTalkCount != null
        ? event.popTalkCount
          : prev && prev.popTalkCount != null
            ? prev.popTalkCount
            : 0
    ),
    kernelCount: toSafeInt(event && event.kernelCount != null ? event.kernelCount : prev && prev.kernelCount),
    totalPaymentKrw: toSafeInt(event && event.totalPaymentKrw != null ? event.totalPaymentKrw : prev && prev.totalPaymentKrw),
    provider: sanitizeLoginMonitorField((event && event.provider) || (prev && prev.provider) || "", 48),
    platform: sanitizeLoginMonitorField((event && event.platform) || (prev && prev.platform) || "", 24),
    appVersion: sanitizeLoginMonitorField((event && event.appVersion) || (prev && prev.appVersion) || "", 40),
    country: mergedCountry,
    language: sanitizeLoginMonitorField((event && event.language) || (prev && prev.language) || "", 16).toLowerCase(),
    gender: sanitizeLoginMonitorField((event && event.gender) || (prev && prev.gender) || "", 16).toLowerCase(),
    ip: sanitizeLoginMonitorField((event && event.ip) || (prev && prev.ip) || "", 128),
    tokenHash: sanitizeLoginMonitorField((event && event.tokenHash) || (prev && prev.tokenHash) || "", 24),
    deviceHash: sanitizeLoginMonitorField((event && event.deviceHash) || (prev && prev.deviceHash) || "", 24),
  };
  rememberProfileLoginAccount(mergedProfileId, mergedLoginAccount);

  loginPresenceBySession.set(key, row);

  pruneLoginPresenceOverflow();

  return row;
}

function pruneLoginPresenceOverflow() {
  const overflow = loginPresenceBySession.size - LOGIN_PRESENCE_MAX;
  if (overflow <= 0) return;

  if (overflow === 1) {
    let oldestKey = "";
    let oldestAt = Number.POSITIVE_INFINITY;
    loginPresenceBySession.forEach((row, key) => {
      const seenAt = Number((row && row.lastSeenAtMs) || 0);
      if (seenAt < oldestAt) {
        oldestAt = seenAt;
        oldestKey = key;
      }
    });
    if (oldestKey) loginPresenceBySession.delete(oldestKey);
    return;
  }

  const rows = Array.from(loginPresenceBySession.entries()).sort((a, b) => {
    return Number((a[1] && a[1].lastSeenAtMs) || 0) - Number((b[1] && b[1].lastSeenAtMs) || 0);
  });
  for (let i = 0; i < overflow; i += 1) {
    const entry = rows[i];
    if (entry && entry[0]) loginPresenceBySession.delete(entry[0]);
  }
}

function countActiveLoginPresence(activeWindowMs = LOGIN_ACTIVE_WINDOW_MS) {
  const windowMs = Number.isFinite(Number(activeWindowMs))
    ? Math.max(60 * 1000, Math.trunc(Number(activeWindowMs)))
    : LOGIN_ACTIVE_WINDOW_MS;
  const cutoff = now() - windowMs;

  if (profileStoreBackend === "sqlite" && profileStoreSqlite && !countActiveLoginPresenceSqliteStmt) ensureLoginEventsSqliteTables();
  if (profileStoreBackend === "sqlite" && countActiveLoginPresenceSqliteStmt) {
    return countSqliteRows(countActiveLoginPresenceSqliteStmt, cutoff);
  }

  let total = 0;
  loginPresenceBySession.forEach((row) => {
    if (Number((row && row.lastSeenAtMs) || 0) >= cutoff) total += 1;
  });
  return total;
}

function listActiveLoginPresence(limit = LOGIN_EVENT_SNAPSHOT_LIMIT, activeWindowMs = LOGIN_ACTIVE_WINDOW_MS) {
  const hardLimit = Number.isFinite(Number(limit))
    ? Math.max(1, Math.min(500, Math.trunc(Number(limit))))
    : LOGIN_EVENT_SNAPSHOT_LIMIT;
  const windowMs = Number.isFinite(Number(activeWindowMs))
    ? Math.max(60 * 1000, Math.trunc(Number(activeWindowMs)))
    : LOGIN_ACTIVE_WINDOW_MS;
  const cutoff = now() - windowMs;

  if (profileStoreBackend === "sqlite" && profileStoreSqlite && !listActiveLoginPresenceSqliteStmt) ensureLoginEventsSqliteTables();
  if (profileStoreBackend === "sqlite" && listActiveLoginPresenceSqliteStmt) {
    return listActiveLoginPresenceSqliteStmt
      .all(cutoff, hardLimit)
      .map((row, index) => parseJsonSafe(row && row.data, null) || normalizeLoadedLoginEvent(row, index))
      .filter(Boolean);
  }

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
    if (typeof res.flush === 'function') {
      try {
        res.flush();
      } catch {}
    }
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

function persistLoginEventToStore(event, presence) {
  if (profileStoreBackend === "sqlite" && profileStoreSqlite && !insertLoginEventSqliteStmt) ensureLoginEventsSqliteTables();
  if (profileStoreBackend === "sqlite" && insertLoginEventSqliteStmt && upsertLoginPresenceSqliteStmt) {
    profileStoreSqlite.transaction(() => {
      insertLoginEventSqliteStmt.run(
        sanitizeLoginMonitorField(event && event.eventId, 96),
        normalizeRtcInt(event && event.serverAtMs, now()),
        normalizeRtcInt(event && event.atMs, now()),
        getLoginIdentityKey(event),
        safeJsonStringify(event)
      );
      if (presence && presence.sessionKey) {
        upsertLoginPresenceSqliteStmt.run(
          sanitizeLoginMonitorField(presence.sessionKey, 200),
          normalizeRtcInt(presence.lastSeenAtMs || presence.atMs, now()),
          safeJsonStringify(presence)
        );
      }
      profileStoreSqlite
        .prepare("DELETE FROM login_events WHERE eventId IN (SELECT eventId FROM login_events ORDER BY serverAtMs DESC LIMIT -1 OFFSET ?)")
        .run(LOGIN_EVENT_MAX);
      profileStoreSqlite
        .prepare("DELETE FROM login_presence WHERE sessionKey IN (SELECT sessionKey FROM login_presence ORDER BY lastSeenAtMs DESC LIMIT -1 OFFSET ?)")
        .run(LOGIN_PRESENCE_MAX);
    })();
    loginEventTotalCount = countSqliteRows(countLoginEventsSqliteStmt);
    return;
  }
  schedulePersistLoginEvents();
}

function addLoginEvent(event, options) {
  const opts = options && typeof options === "object" ? options : {};
  if (profileStoreBackend === "sqlite" && insertLoginEventSqliteStmt) {
    appendRecentLoginEventCache(event);
  } else {
    loginEvents.push(event);
    if (loginEvents.length > LOGIN_EVENT_MAX) {
      loginEvents.splice(0, loginEvents.length - LOGIN_EVENT_MAX);
    }
  }
  const presence = opts.skipPresenceUpdate ? null : upsertLoginPresence(event);
  loginEventTotalCount = Math.max(0, loginEventTotalCount + 1);
  persistLoginEventToStore(event, presence);
  broadcastLoginEvent(event);
  broadcastLoginPresenceUpdate(presence);
  publishLoginEventSync(event, presence).catch(() => {});
}

loadLoginEventsStore();

const __adminLoginEventIngestHandler = async (req, res) => {
  try {
    const event = buildLoginEvent(req, req.body || {});
    if (!event.userId && !event.profileId) {
      return res.status(400).json({ ok: false, error: "user_id_required" });
    }

    const conflict = evaluateLoginSessionConflict(event);
    addLoginEvent(event, {
      skipPresenceUpdate: !conflict.shouldUpdatePresence,
    });
    await persistProfileStoreNow();
    return res.status(200).json({
      ok: true,
      event,
      total: loginEventTotalCount,
      forceLogout: Boolean(conflict.forceLogout),
      reason: sanitizeLoginMonitorField(conflict.reason || "", 80),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "login_event_ingest_failed", detail: String((e && e.message) || e) });
  }
};

const __adminLoginEventListHandler = (req, res) => {
  const limitRaw = Number(req.query.limit || LOGIN_EVENT_SNAPSHOT_LIMIT);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : LOGIN_EVENT_SNAPSHOT_LIMIT;
  const rows = listRecentLoginEventsFromStore(limit);
  const sessions = listActiveLoginPresence(limit, LOGIN_ACTIVE_WINDOW_MS);

  return res.status(200).json({
    ok: true,
    serverNowMs: now(),
    total: loginEventTotalCount,
    totalEvents: loginEventTotalCount,
    activeTotal: sessions.length,
    connectedTotal: sessions.length,
    activeWindowMs: LOGIN_ACTIVE_WINDOW_MS,
    events: rows,
    sessions,
  });
};

function sanitizeLoginDateKey(rawDate) {
  const text = sanitizeLoginMonitorField(rawDate || "", 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  return text;
}

function sanitizeLoginTimeZone(rawTimeZone) {
  const text = sanitizeLoginMonitorField(rawTimeZone || "", 64);
  if (!text) return "Asia/Seoul";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: text }).format(new Date(now()));
    return text;
  } catch {
    return "Asia/Seoul";
  }
}

function getLoginDateKeyInTimeZone(ms, timeZone = "Asia/Seoul") {
  const atMs = Number(ms);
  if (!Number.isFinite(atMs) || atMs <= 0) return "";

  const d = new Date(Math.trunc(atMs));
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: String(timeZone || "Asia/Seoul"),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(d);

    let year = "";
    let month = "";
    let day = "";
    parts.forEach((part) => {
      if (part.type === "year") year = part.value;
      if (part.type === "month") month = part.value;
      if (part.type === "day") day = part.value;
    });
    if (year && month && day) return year + "-" + month + "-" + day;
  } catch {}

  const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
  const MM = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return yyyy + "-" + MM + "-" + dd;
}

function getLoginSeenAtMs(event) {
  const raw = Number(event && (event.atMs ?? event.serverAtMs ?? 0));
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.trunc(raw);
}

function getLoginDailyUniqueKey(event) {
  const identity = getLoginIdentityKey(event);
  if (identity) return identity;
  return sanitizeLoginMonitorField(
    (event && (event.profileId || event.userId || event.loginAccount || event.deviceHash || event.tokenHash || event.eventId)) || "",
    240,
  ).toLowerCase();
}

function normalizeDailySubscriptionStatus(row) {
  const raw = sanitizeLoginMonitorField((row && row.subscriptionStatus) || "", 24).toLowerCase();
  if (raw === "paid" || raw === "free") return raw;
  if (row && row.isPremium === true) return "paid";
  if (row && row.isPremium === false) return "free";
  return "unknown";
}

function pushCounter(counterMap, rawKey) {
  const key = sanitizeLoginMonitorField(rawKey || "", 64).toLowerCase() || "unknown";
  counterMap.set(key, (counterMap.get(key) || 0) + 1);
}

function toCounterRows(counterMap) {
  return Array.from(counterMap.entries())
    .map(([key, count]) => ({ key, count: Math.max(0, Math.trunc(Number(count) || 0)) }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    });
}

function getApproxLoginAtRangeForDate(dateKey) {
  const safeDateKey = sanitizeLoginDateKey(dateKey);
  const startUtcMs = Date.parse(`${safeDateKey || "1970-01-01"}T00:00:00.000Z`);
  if (!Number.isFinite(startUtcMs)) {
    return { minAtMs: 0, maxAtMs: Number.MAX_SAFE_INTEGER };
  }
  return {
    minAtMs: Math.max(0, startUtcMs - 14 * 60 * 60 * 1000),
    maxAtMs: startUtcMs + (24 + 14) * 60 * 60 * 1000 - 1,
  };
}

function buildDailyLoginUniqueSnapshot(dateKey, timeZone, limit = 2000) {
  const safeDateKey = sanitizeLoginDateKey(dateKey) || getLoginDateKeyInTimeZone(now(), timeZone);
  const safeTimeZone = sanitizeLoginTimeZone(timeZone);
  const hardLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(5000, Math.trunc(Number(limit)))) : 2000;

  const range = getApproxLoginAtRangeForDate(safeDateKey);
  const dayEvents = listLoginEventsByAtRange(range.minAtMs, range.maxAtMs, LOGIN_EVENT_MAX).filter((event) => {
    const atMs = getLoginSeenAtMs(event);
    if (atMs <= 0) return false;
    return getLoginDateKeyInTimeZone(atMs, safeTimeZone) === safeDateKey;
  });

  const uniqueMap = new Map();
  dayEvents.forEach((event) => {
    const key = getLoginDailyUniqueKey(event);
    if (!key) return;
    const seenAtMs = getLoginSeenAtMs(event) || now();
    const prev = uniqueMap.get(key);
    if (!prev) {
      const firstProfileId = sanitizeLoginMonitorField((event && event.profileId) || "", 180);
      const firstUserId = sanitizeLoginMonitorField((event && event.userId) || "", 128);
      const firstLoginAccount = resolveStableLoginAccount(
        firstUserId,
        sanitizeLoginMonitorField((event && event.loginAccount) || "", 240).toLowerCase(),
        readStoredLoginAccountByProfileId(firstProfileId),
      );
      const firstCountry = normalizeCountryCode(
        pickNonEmptyValue(
          sanitizeLoginMonitorField((event && event.country) || "", 8).toUpperCase(),
          readStoredCountryByProfileId(firstProfileId),
        ),
      );
      uniqueMap.set(key, {
        sessionKey: key,
        firstSeenAtMs: seenAtMs,
        firstSeenAtIso: new Date(seenAtMs).toISOString(),
        lastSeenAtMs: seenAtMs,
        lastSeenAtIso: new Date(seenAtMs).toISOString(),
        eventCount: 1,
        loginAccount: firstLoginAccount,
        userId: firstUserId,
        profileId: firstProfileId,
        subscriptionStatus: sanitizeLoginMonitorField((event && event.subscriptionStatus) || "", 24).toLowerCase(),
        isPremium: event && event.isPremium != null ? event.isPremium : null,
        popTalkCount: toSafeInt(event && event.popTalkCount),
        kernelCount: toSafeInt(event && event.kernelCount),
        totalPaymentKrw: toSafeInt(event && event.totalPaymentKrw),
        provider: sanitizeLoginMonitorField((event && event.provider) || "", 48),
        platform: sanitizeLoginMonitorField((event && event.platform) || "", 24),
        appVersion: sanitizeLoginMonitorField((event && event.appVersion) || "", 40),
        country: firstCountry,
        language: sanitizeLoginMonitorField((event && event.language) || "", 16).toLowerCase(),
        gender: sanitizeLoginMonitorField((event && event.gender) || "", 16).toLowerCase(),
        ip: sanitizeLoginMonitorField((event && event.ip) || "", 128),
        tokenHash: sanitizeLoginMonitorField((event && event.tokenHash) || "", 24),
        deviceHash: sanitizeLoginMonitorField((event && event.deviceHash) || "", 24),
      });
      return;
    }

    prev.eventCount = Math.max(1, Math.trunc(Number(prev.eventCount || 0)) + 1);
    if (seenAtMs < prev.firstSeenAtMs) {
      prev.firstSeenAtMs = seenAtMs;
      prev.firstSeenAtIso = new Date(seenAtMs).toISOString();
    }
    if (seenAtMs >= prev.lastSeenAtMs) {
      prev.lastSeenAtMs = seenAtMs;
      prev.lastSeenAtIso = new Date(seenAtMs).toISOString();
      prev.profileId = sanitizeLoginMonitorField((event && event.profileId) || prev.profileId || "", 180);
      prev.userId = sanitizeLoginMonitorField((event && event.userId) || prev.userId || "", 128);
      prev.loginAccount = resolveStableLoginAccount(
        prev.userId,
        event && event.loginAccount,
        prev.loginAccount,
        readStoredLoginAccountByProfileId(prev.profileId),
      );
      prev.subscriptionStatus = sanitizeLoginMonitorField((event && event.subscriptionStatus) || prev.subscriptionStatus || "", 24).toLowerCase();
      prev.isPremium = event && event.isPremium != null ? event.isPremium : prev.isPremium;
      prev.popTalkCount = toSafeInt(
        event && event.popTalkCount != null
          ? event.popTalkCount
          : prev.popTalkCount
      );
      prev.kernelCount = toSafeInt(event && event.kernelCount != null ? event.kernelCount : prev.kernelCount);
      prev.totalPaymentKrw = toSafeInt(event && event.totalPaymentKrw != null ? event.totalPaymentKrw : prev.totalPaymentKrw);
      prev.provider = sanitizeLoginMonitorField((event && event.provider) || prev.provider || "", 48);
      prev.platform = sanitizeLoginMonitorField((event && event.platform) || prev.platform || "", 24);
      prev.appVersion = sanitizeLoginMonitorField((event && event.appVersion) || prev.appVersion || "", 40);
      prev.country = normalizeCountryCode(
        pickNonEmptyValue(
          sanitizeLoginMonitorField((event && event.country) || "", 8).toUpperCase(),
          prev.country,
          readStoredCountryByProfileId(prev.profileId),
        ),
      );
      prev.language = sanitizeLoginMonitorField((event && event.language) || prev.language || "", 16).toLowerCase();
      prev.gender = sanitizeLoginMonitorField((event && event.gender) || prev.gender || "", 16).toLowerCase();
      prev.ip = sanitizeLoginMonitorField((event && event.ip) || prev.ip || "", 128);
      prev.tokenHash = sanitizeLoginMonitorField((event && event.tokenHash) || prev.tokenHash || "", 24);
      prev.deviceHash = sanitizeLoginMonitorField((event && event.deviceHash) || prev.deviceHash || "", 24);
    }
    rememberProfileLoginAccount(prev.profileId, prev.loginAccount);
  });

  const allRows = Array.from(uniqueMap.values()).sort((a, b) => Number(b.lastSeenAtMs || 0) - Number(a.lastSeenAtMs || 0));
  const rows = allRows.length > hardLimit ? allRows.slice(0, hardLimit) : allRows;

  let paid = 0;
  let free = 0;
  let unknown = 0;
  const providers = new Map();
  const platforms = new Map();
  allRows.forEach((row) => {
    const sub = normalizeDailySubscriptionStatus(row);
    if (sub === "paid") paid += 1;
    else if (sub === "free") free += 1;
    else unknown += 1;
    pushCounter(providers, row && row.provider);
    pushCounter(platforms, row && row.platform);
  });

  return {
    date: safeDateKey,
    timeZone: safeTimeZone,
    totalEvents: dayEvents.length,
    uniqueTotal: allRows.length,
    rows,
    stats: {
      paid,
      free,
      unknown,
      providers: toCounterRows(providers),
      platforms: toCounterRows(platforms),
    },
  };
}

const __adminLoginEventDailyHandler = (req, res) => {
  try {
    const limitRaw = Number(req.query.limit || 2000);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(5000, Math.trunc(limitRaw))) : 2000;
    const timeZone = sanitizeLoginTimeZone(req.query.tz || req.query.timeZone || "Asia/Seoul");
    const dateRaw = sanitizeLoginDateKey(req.query.date || "");
    const dateKey = dateRaw || getLoginDateKeyInTimeZone(now(), timeZone);
    const snapshot = buildDailyLoginUniqueSnapshot(dateKey, timeZone, limit);

    return res.status(200).json({
      ok: true,
      serverNowMs: now(),
      ...snapshot,
      limit,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: "login_daily_list_failed",
      detail: String((e && e.message) || e),
    });
  }
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
  if (res.socket && typeof res.socket.setNoDelay === 'function') {
    try {
      res.socket.setNoDelay(true);
    } catch {}
  }

  const sessions = listActiveLoginPresence(limit, LOGIN_ACTIVE_WINDOW_MS);
  writeSseEvent(res, 'hello', {
    ok: true,
    serverNowMs: now(),
    total: loginEventTotalCount,
    totalEvents: loginEventTotalCount,
    activeTotal: sessions.length,
    connectedTotal: sessions.length,
    activeWindowMs: LOGIN_ACTIVE_WINDOW_MS,
  });

  const rows = listRecentLoginEventsFromStore(limit).slice().reverse();
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
    .titleRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .title { font-size: 20px; font-weight: 800; letter-spacing: .2px; }
    .meta { font-size: 13px; color: #9fb0d9; }
    .pill { display: inline-block; margin-left: 8px; padding: 3px 8px; border-radius: 999px; font-size: 11px; font-weight: 700; background: #1c2a4d; color: #b8c8f3; }
    .ctrlBtn { border: 1px solid #31508a; background: #173066; color: #d9e8ff; border-radius: 999px; font-size: 12px; font-weight: 700; line-height: 1; padding: 7px 11px; cursor: pointer; }
    .ctrlBtn:hover { filter: brightness(1.08); }
    .ctrlBtn.active { background: #2551a3; border-color: #4d78c8; }
    .ctrlBtn.subtle { background: #162646; border-color: #2a3f6c; color: #c8d8f8; }
    .dateInput { background: #0d1d40; color: #eaf0ff; border: 1px solid #2d4678; border-radius: 8px; padding: 6px 8px; font-size: 12px; }
    .dailyPanel { margin-top: 10px; display: grid; gap: 8px; }
    .dailyControls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .card { border: 1px solid #213257; border-radius: 12px; overflow-x: auto; overflow-y: hidden; background: #0f1730; -webkit-overflow-scrolling: touch; }
    table { width: max-content; min-width: 100%; border-collapse: collapse; table-layout: auto; }
    .realtimeTable { min-width: 1240px; }
    .dailyTable { min-width: 1420px; }
    .reportTable { min-width: 1280px; }
    thead { background: #142044; }
    th, td { padding: 9px 10px; border-bottom: 1px solid #1b2b50; font-size: 12px; text-align: left; white-space: nowrap; }
    th { color: #a8bbe9; font-weight: 700; }
    td { color: #e8eeff; }
    tr:nth-child(even) td { background: #0d152b; }
    .ok { color: #74f0b5; }
    .warn { color: #ffd166; }
    .tiny { font-size: 11px; color: #9db0df; }
    @media (max-width: 720px) {
      .wrap { padding: 14px 10px 20px; }
      .head { align-items: flex-start; flex-direction: column; }
      .title { font-size: 18px; }
      th, td { font-size: 11px; padding: 8px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="head">
      <div>
        <div class="titleRow">
          <div class="title">RanChat Login Monitor <span class="pill">Realtime</span></div>
          <button type="button" class="ctrlBtn" id="dailyToggleBtn">Daily Unique List</button>
          <button type="button" class="ctrlBtn" id="reportToggleBtn">신고관리</button>
        </div>
        <div class="meta" id="meta">connecting...</div>
      </div>
      <div class="tiny">open this URL directly in browser</div>
    </div>

    <div class="card">
      <table class="realtimeTable">
        <thead>
          <tr>
            <th style="width: 165px;">Last Access</th>
            <th style="width: 220px;">Login Account</th>
            <th style="width: 180px;">auth.userId</th>
            <th style="width: 90px;">Country</th>
            <th style="width: 100px;">Sub</th>
            <th style="width: 100px;">PopTalk</th>
            <th style="width: 90px;">Kernel</th>
            <th style="width: 130px;">Total Paid(KRW)</th>
            <th>Provider/Device</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <div class="dailyPanel" id="dailyPanel" hidden>
      <div class="dailyControls">
        <span class="tiny" id="dailyDateLabel">Date (KST)</span>
        <input id="dailyDate" class="dateInput" type="date" />
        <button type="button" class="ctrlBtn subtle" id="dailyRefreshBtn">Refresh</button>
        <button type="button" class="ctrlBtn subtle" id="dailyReportToggleBtn">신고관리</button>
        <button type="button" class="ctrlBtn subtle" id="dailyCloseBtn">Close</button>
      </div>
      <div class="meta" id="dailyMeta">Waiting for daily stats...</div>
      <div class="card">
        <table class="dailyTable">
          <thead>
            <tr>
              <th style="width: 165px;">Last Access</th>
              <th style="width: 165px;">First Access</th>
              <th style="width: 220px;">Login Account</th>
              <th style="width: 180px;">auth.userId</th>
              <th style="width: 90px;">Country</th>
              <th style="width: 80px;">Sub</th>
              <th style="width: 80px;">Events</th>
              <th style="width: 100px;">PopTalk</th>
              <th style="width: 90px;">Kernel</th>
              <th style="width: 130px;">Total Paid(KRW)</th>
              <th>Provider/Device</th>
            </tr>
          </thead>
          <tbody id="dailyRows"></tbody>
        </table>
      </div>
    </div>

    <div class="dailyPanel" id="reportPanel" hidden>
      <div class="dailyControls">
        <span class="tiny" id="reportTitle">신고 관리</span>
        <button type="button" class="ctrlBtn subtle" id="reportRefreshBtn">조회</button>
        <button type="button" class="ctrlBtn subtle" id="reportCloseBtn">닫기</button>
      </div>
      <div class="meta" id="reportMeta">신고 목록 조회 대기중...</div>
      <div class="card">
        <table class="reportTable">
          <thead>
            <tr>
              <th style="width: 165px;">신고시간</th>
              <th style="width: 240px;">신고자 계정</th>
              <th style="width: 240px;">피신고자 계정</th>
              <th style="width: 220px;">신고사유</th>
              <th style="width: 320px;">상세</th>
              <th style="width: 90px;">누적신고</th>
            </tr>
          </thead>
          <tbody id="reportRows"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    var rowsEl = document.getElementById('rows');
    var metaEl = document.getElementById('meta');
    var dailyToggleBtnEl = document.getElementById('dailyToggleBtn');
    var reportToggleBtnEl = document.getElementById('reportToggleBtn');
    var dailyPanelEl = document.getElementById('dailyPanel');
    var dailyDateEl = document.getElementById('dailyDate');
    var dailyRefreshBtnEl = document.getElementById('dailyRefreshBtn');
    var dailyReportToggleBtnEl = document.getElementById('dailyReportToggleBtn');
    var dailyCloseBtnEl = document.getElementById('dailyCloseBtn');
    var dailyDateLabelEl = document.getElementById('dailyDateLabel');
    var dailyMetaEl = document.getElementById('dailyMeta');
    var dailyRowsEl = document.getElementById('dailyRows');
    var reportPanelEl = document.getElementById('reportPanel');
    var reportTitleEl = document.getElementById('reportTitle');
    var reportRefreshBtnEl = document.getElementById('reportRefreshBtn');
    var reportCloseBtnEl = document.getElementById('reportCloseBtn');
    var reportMetaEl = document.getElementById('reportMeta');
    var reportRowsEl = document.getElementById('reportRows');
    var reportHeadRowEl = reportPanelEl ? reportPanelEl.querySelector('thead tr') : null;
    var limit = 200;
    var dailyLimit = 2000;
    var reportLimit = 200;
    var activeWindowMs = 15 * 60 * 1000;
    var map = new Map();
    var dailyOpen = false;
    var dailyLoading = false;
    var reportOpen = false;
    var reportLoading = false;
    var sseConnected = false;
    var lastSseEventAt = 0;
    var metaState = {
      cls: 'warn',
      label: 'connecting',
      activeTotal: 0,
      totalEvents: 0,
      serverNowMs: 0,
    };
    var dailyI18n = {
      toggleBtn: "\uC77C\uC77C \uC811\uC18D \uB9AC\uC2A4\uD2B8(\uC911\uBCF5\uC5C6\uC74C)",
      dateLabel: "\uAE30\uC900\uC77C(KST)",
      refreshBtn: "\uC870\uD68C",
      closeBtn: "\uB2EB\uAE30",
      waiting: "\uC77C\uC77C \uD1B5\uACC4 \uC870\uD68C \uB300\uAE30\uC911...",
      loading: "\uC77C\uC77C \uD1B5\uACC4 \uC870\uD68C\uC911...",
      failed: "\uC77C\uC77C \uD1B5\uACC4 \uC870\uD68C \uC2E4\uD328",
      date: "\uAE30\uC900\uC77C",
      uniqueUsers: "\uACE0\uC720 \uC811\uC18D",
      events: "\uC774\uBCA4\uD2B8",
    };
    var reportI18n = {
      toggleBtn: "\uC2E0\uACE0\uAD00\uB9AC",
      title: "\uC2E0\uACE0 \uAD00\uB9AC",
      refreshBtn: "\uC870\uD68C",
      closeBtn: "\uB2EB\uAE30",
      waiting: "\uC2E0\uACE0 \uBAA9\uB85D \uC870\uD68C \uB300\uAE30\uC911...",
      loading: "\uC2E0\uACE0 \uBAA9\uB85D \uC870\uD68C\uC911...",
      failed: "\uC2E0\uACE0 \uBAA9\uB85D \uC870\uD68C \uC2E4\uD328",
      total: "\uCD1D \uC2E0\uACE0",
      visible: "\uD604\uC7AC \uD45C\uC2DC",
      lastChecked: "\uB9C8\uC9C0\uB9C9 \uC870\uD68C",
    };
    var reportHeaderHtml = [
      '<th style="width: 165px;">\uC2E0\uACE0\uC2DC\uAC04</th>',
      '<th style="width: 240px;">\uC2E0\uACE0\uC790 \uACC4\uC815</th>',
      '<th style="width: 240px;">\uD53C\uC2E0\uACE0\uC790 \uACC4\uC815</th>',
      '<th style="width: 220px;">\uC2E0\uACE0\uC0AC\uC720</th>',
      '<th style="width: 320px;">\uC0C1\uC138</th>',
      '<th style="width: 90px;">\uB204\uC801\uC2E0\uACE0</th>',
    ].join('');
    var reportReasonI18n = {
      SEXUAL_EXPLICIT: {
        label: "\uC74C\uB780\uBB3C/\uC131\uC801 \uB178\uCD9C",
        detail: "\uC2E0\uCCB4 \uB178\uCD9C, \uC131\uC801 \uD589\uC704 \uC720\uB3C4, \uC74C\uB780 \uBC1C\uC5B8",
      },
      MINOR_SAFETY_RISK: {
        label: "\uC544\uB3D9\u00B7\uCCAD\uC18C\uB144 \uC720\uD574\uD589\uC704",
        detail: "\uBBF8\uC131\uB144\uC790 \uB300\uC0C1 \uC720\uC778, \uC131\uC801 \uB300\uD654, \uCD2C\uC601 \uC694\uAD6C",
      },
      HARASSMENT_ABUSE: {
        label: "\uAD34\uB86D\uD798/\uC695\uC124/\uBAA8\uC695",
        detail: "\uBC18\uBCF5\uC801 \uBE44\uD558, \uC695\uC124, \uC778\uC2E0\uACF5\uACA9",
      },
      THREAT_OR_VIOLENCE: {
        label: "\uD611\uBC15/\uD3ED\uB825/\uC790\uD574 \uC720\uB3C4",
        detail: "\uC2E0\uCCB4\uC801 \uC704\uD611, \uBCF4\uBCF5 \uC554\uC2DC, \uC790\uD574\u00B7\uC790\uC0B4 \uC720\uB3C4",
      },
      HATE_SPEECH: {
        label: "\uD610\uC624/\uCC28\uBCC4 \uBC1C\uC5B8",
        detail: "\uC778\uC885\u00B7\uAD6D\uC801\u00B7\uC131\uBCC4\u00B7\uC7A5\uC560 \uB4F1 \uC9D1\uB2E8 \uBE44\uD558",
      },
      SCAM_OR_FRAUD: {
        label: "\uC0AC\uAE30/\uAE08\uC804 \uC694\uAD6C",
        detail: "\uC1A1\uAE08\u00B7\uD6C4\uC6D0 \uC720\uB3C4, \uD22C\uC790/\uB300\uCD9C \uC0AC\uAE30, \uACC4\uC815 \uD0C8\uCDE8 \uC2DC\uB3C4",
      },
      IMPERSONATION: {
        label: "\uC0AC\uCE6D",
        detail: "\uD0C0\uC778/\uACF5\uC778/\uC6B4\uC601\uC9C4 \uC0AC\uCE6D, \uC2E0\uBD84 \uC704\uC870",
      },
      SPAM_OR_AD: {
        label: "\uB3C4\uBC30/\uAD11\uACE0/\uC678\uBD80\uC720\uB3C4",
        detail: "\uBC18\uBCF5 \uBA54\uC2DC\uC9C0, \uD64D\uBCF4 \uB9C1\uD06C, \uC678\uBD80 \uD50C\uB7AB\uD3FC \uC774\uB3D9 \uAC15\uC694",
      },
      PRIVACY_VIOLATION: {
        label: "\uAC1C\uC778\uC815\uBCF4 \uCE68\uD574",
        detail: "\uAC1C\uC778\uC815\uBCF4 \uC694\uAD6C, \uC5F0\uB77D\uCC98 \uAC15\uC694, \uBB34\uB2E8 \uACF5\uAC1C",
      },
      OTHER_POLICY: {
        label: "\uAE30\uD0C0 \uC6B4\uC601\uC815\uCC45 \uC704\uBC18",
        detail: "\uC11C\uBE44\uC2A4 \uC815\uCC45\uC744 \uC911\uB300\uD558\uAC8C \uC704\uBC18\uD558\uB294 \uD589\uC704",
      },
    };
    var reportReasonAliases = {
      ABUSE: 'HARASSMENT_ABUSE',
      HATE_OR_DISCRIMINATION: 'HATE_SPEECH',
      OTHER: 'OTHER_POLICY',
      OTHER_POLICY_VIOLATION: 'OTHER_POLICY',
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

    function fmtDateKeyByTimeZone(ms, timeZone) {
      var n = Number(ms || 0);
      if (!Number.isFinite(n) || n <= 0) return '';
      var d = new Date(n);
      try {
        var parts = new Intl.DateTimeFormat('en-US', {
          timeZone: String(timeZone || 'Asia/Seoul'),
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).formatToParts(d);
        var yyyy = '';
        var MM = '';
        var dd = '';
        parts.forEach(function(part) {
          if (part.type === 'year') yyyy = part.value;
          if (part.type === 'month') MM = part.value;
          if (part.type === 'day') dd = part.value;
        });
        if (yyyy && MM && dd) return yyyy + '-' + MM + '-' + dd;
      } catch {}
      return d.toISOString().slice(0, 10);
    }

    function ensureDailyDateValue() {
      if (!dailyDateEl) return '';
      var raw = String(dailyDateEl.value || '').trim();
      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return raw;
      var today = fmtDateKeyByTimeZone(Date.now(), 'Asia/Seoul') || new Date().toISOString().slice(0, 10);
      dailyDateEl.value = today;
      return today;
    }

    function toCounterSummary(rows, maxItems) {
      var arr = Array.isArray(rows) ? rows : [];
      var cap = Number.isFinite(Number(maxItems)) ? Math.max(1, Math.trunc(Number(maxItems))) : 3;
      return arr.slice(0, cap).map(function(row) {
        var key = String(row && row.key || 'unknown');
        var count = Math.max(0, Math.trunc(Number(row && row.count || 0)));
        return key + ':' + count;
      }).join(', ');
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

    function markSseAlive(label) {
      sseConnected = true;
      lastSseEventAt = Date.now();
      if (label) updateMeta({ cls: 'ok', label: label });
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
          '<td>' + esc(e.country || '-') + '</td>' +
          '<td>' + esc(normalizeSub(e)) + '</td>' +
          '<td>' + esc(fmtNum(e.popTalkCount)) + '</td>' +
          '<td>' + esc(fmtNum(e.kernelCount)) + '</td>' +
          '<td>' + esc(fmtNum(e.totalPaymentKrw)) + '</td>' +
          '<td>' + esc(extra) + '</td>' +
        '</tr>';
      }).join('');

      updateMeta({ activeTotal: arr.length });
    }

    function renderDailyRows(rows) {
      if (!dailyRowsEl) return;
      var arr = Array.isArray(rows) ? rows : [];
      dailyRowsEl.innerHTML = arr.map(function(e) {
        var extra = [e.provider || '-', e.platform || '-', e.appVersion || '-'].join(' / ');
        return '<tr>' +
          '<td>' + esc(fmtTime(e && e.lastSeenAtMs)) + '</td>' +
          '<td>' + esc(fmtTime(e && e.firstSeenAtMs)) + '</td>' +
          '<td>' + esc(e && e.loginAccount || '-') + '</td>' +
          '<td>' + esc(e && e.userId || '-') + '</td>' +
          '<td>' + esc(e && e.country || '-') + '</td>' +
          '<td>' + esc(normalizeSub(e)) + '</td>' +
          '<td>' + esc(fmtNum(e && e.eventCount)) + '</td>' +
          '<td>' + esc(fmtNum(e && e.popTalkCount)) + '</td>' +
          '<td>' + esc(fmtNum(e && e.kernelCount)) + '</td>' +
          '<td>' + esc(fmtNum(e && e.totalPaymentKrw)) + '</td>' +
          '<td>' + esc(extra) + '</td>' +
        '</tr>';
      }).join('');
    }

    function updateDailyMeta(payload) {
      if (!dailyMetaEl) return;
      var p = payload && typeof payload === 'object' ? payload : {};
      var dateText = String(p.date || ensureDailyDateValue() || '-');
      var uniqueTotal = fmtNum(p.uniqueTotal || 0);
      var totalEvents = fmtNum(p.totalEvents || 0);
      var stats = p.stats && typeof p.stats === 'object' ? p.stats : {};
      var paid = fmtNum(stats.paid || 0);
      var free = fmtNum(stats.free || 0);
      var unknown = fmtNum(stats.unknown || 0);
      var providerText = toCounterSummary(stats.providers, 3) || '-';
      dailyMetaEl.innerHTML =
        esc(dailyI18n.date) + ' ' + esc(dateText) +
        ' | ' + esc(dailyI18n.uniqueUsers) + ' ' + esc(uniqueTotal) +
        ' | ' + esc(dailyI18n.events) + ' ' + esc(totalEvents) +
        ' | paid/free/unknown ' + esc(paid + '/' + free + '/' + unknown) +
        ' | provider top3 ' + esc(providerText);
    }

    function renderReportRows(rows) {
      if (!reportRowsEl) return;
      var arr = Array.isArray(rows) ? rows : [];
      reportRowsEl.innerHTML = arr.map(function(row) {
        var reasonCode = String(row && row.reasonCode || '').trim();
        var reasonKey = reportReasonAliases[reasonCode] || reasonCode;
        var reasonInfo = reportReasonI18n[reasonKey] || null;
        var reasonText = reasonInfo && reasonInfo.label
          ? String(reasonInfo.label)
          : String(row && row.reasonLabel || reasonCode || '-');
        var detailText = reasonInfo && reasonInfo.detail
          ? String(reasonInfo.detail)
          : (String(row && row.reasonDetail || '').trim() || '-');
        return '<tr>' +
          '<td>' + esc(fmtTime(row && row.createdAt)) + '</td>' +
          '<td>' + esc(row && row.reporterLoginAccount || '-') + '</td>' +
          '<td>' + esc(row && row.targetLoginAccount || '-') + '</td>' +
          '<td>' + esc(reasonText) + '</td>' +
          '<td>' + esc(detailText) + '</td>' +
          '<td>' + esc(fmtNum(row && row.targetReportedCount)) + '</td>' +
        '</tr>';
      }).join('');
    }

    function updateReportMeta(payload) {
      if (!reportMetaEl) return;
      var p = payload && typeof payload === 'object' ? payload : {};
      reportMetaEl.innerHTML =
        esc(reportI18n.total) + ' ' + esc(fmtNum(p.total || 0)) +
        ' | ' + esc(reportI18n.visible) + ' ' + esc(fmtNum(p.visible || 0)) +
        ' | ' + esc(reportI18n.lastChecked) + ' ' + esc(fmtTime(p.serverNowMs || Date.now()));
    }

    async function refreshDailyByHttp() {
      if (dailyLoading) return;
      if (!dailyPanelEl || !dailyRowsEl || !dailyMetaEl) return;
      dailyLoading = true;
      updateDailyMeta({ date: ensureDailyDateValue(), uniqueTotal: 0, totalEvents: 0, stats: {} });
      dailyMetaEl.innerHTML = dailyI18n.loading;
      try {
        var date = ensureDailyDateValue();
        var path = '/admin/login-events/daily?date=' + encodeURIComponent(date) + '&tz=Asia/Seoul&limit=' + dailyLimit;
        var res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error('daily_fetch_failed');
        var json = await res.json();
        renderDailyRows(json.rows || []);
        updateDailyMeta(json || {});
      } catch (e) {
        dailyMetaEl.innerHTML = dailyI18n.failed;
      } finally {
        dailyLoading = false;
      }
    }

    async function refreshReportsByHttp() {
      if (reportLoading) return;
      if (!reportRowsEl || !reportMetaEl) return;
      reportLoading = true;
      reportMetaEl.textContent = reportI18n.loading;
      try {
        var res = await fetch('/api/admin/call-reports?limit=' + encodeURIComponent(String(reportLimit)));
        if (!res.ok) throw new Error('HTTP_' + res.status);
        var data = await res.json();
        if (!data || data.ok === false) throw new Error((data && (data.errorCode || data.errorMessage)) || 'REPORT_FETCH_FAILED');
        renderReportRows(data.reports || []);
        updateReportMeta({
          total: data.total || 0,
          visible: Array.isArray(data.reports) ? data.reports.length : 0,
          serverNowMs: Date.now(),
        });
      } catch (e) {
        reportMetaEl.textContent = reportI18n.failed + ' (' + esc((e && e.message) || e || 'unknown') + ')';
      } finally {
        reportLoading = false;
      }
    }

    function setDailyPanelOpen(nextOpen) {
      if (!dailyPanelEl || !dailyToggleBtnEl) return;
      dailyOpen = Boolean(nextOpen);
      dailyPanelEl.hidden = !dailyOpen;
      if (dailyOpen) {
        dailyToggleBtnEl.classList.add('active');
        refreshDailyByHttp();
      } else {
        dailyToggleBtnEl.classList.remove('active');
      }
    }

    function setReportPanelOpen(nextOpen) {
      if (!reportPanelEl || !reportToggleBtnEl) return;
      reportOpen = Boolean(nextOpen);
      reportPanelEl.hidden = !reportOpen;
      if (reportOpen) {
        reportToggleBtnEl.classList.add('active');
        if (dailyReportToggleBtnEl) dailyReportToggleBtnEl.classList.add('active');
        refreshReportsByHttp();
      } else {
        reportToggleBtnEl.classList.remove('active');
        if (dailyReportToggleBtnEl) dailyReportToggleBtnEl.classList.remove('active');
      }
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
        var nextMeta = {
          activeTotal: activeTotal,
          totalEvents: totalEvents,
          serverNowMs: Number(json.serverNowMs || 0),
        };
        if (!sseConnected) {
          nextMeta.cls = 'ok';
          nextMeta.label = 'connected';
        }
        updateMeta(nextMeta);
      } catch (e) {
        if (!sseConnected) updateMeta({ cls: 'warn', label: 'reconnecting' });
      }
    }

    function startSse() {
      try {
        var es = new EventSource('/api/admin/login-events/stream?limit=' + limit);
        es.onopen = function() {
          markSseAlive('realtime connected');
        };
        es.addEventListener('hello', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            var nextWindow = Number(p.activeWindowMs || 0);
            if (Number.isFinite(nextWindow) && nextWindow > 0) activeWindowMs = nextWindow;
            markSseAlive('realtime connected');
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
            markSseAlive();
            if (Array.isArray(p.events)) upsertMany(p.events || []);
          } catch {}
        });
        es.addEventListener('login', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            markSseAlive();
            upsertMany([p]);
          } catch {}
        });
        es.addEventListener('presence_snapshot', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            var nextWindow = Number(p.activeWindowMs || 0);
            if (Number.isFinite(nextWindow) && nextWindow > 0) activeWindowMs = nextWindow;
            markSseAlive();
            replaceMany(p.sessions || []);
            updateMeta({ activeTotal: Number(p.activeTotal || map.size || 0) });
          } catch {}
        });
        es.addEventListener('presence_update', function(ev) {
          try {
            var p = JSON.parse(ev.data || '{}');
            markSseAlive();
            upsertMany([p]);
            updateMeta({ activeTotal: map.size });
          } catch {}
        });
        es.addEventListener('ping', function() {
          markSseAlive();
        });
        es.onerror = function() {
          sseConnected = false;
          updateMeta({ cls: 'warn', label: 'realtime reconnecting' });
        };
      } catch {
        sseConnected = false;
        updateMeta({ cls: 'warn', label: 'SSE unavailable' });
      }
    }

    if (dailyToggleBtnEl) dailyToggleBtnEl.textContent = dailyI18n.toggleBtn;
    if (reportToggleBtnEl) reportToggleBtnEl.textContent = reportI18n.toggleBtn;
    if (dailyDateLabelEl) dailyDateLabelEl.textContent = dailyI18n.dateLabel;
    if (dailyRefreshBtnEl) dailyRefreshBtnEl.textContent = dailyI18n.refreshBtn;
    if (dailyReportToggleBtnEl) dailyReportToggleBtnEl.textContent = reportI18n.toggleBtn;
    if (dailyCloseBtnEl) dailyCloseBtnEl.textContent = dailyI18n.closeBtn;
    if (dailyMetaEl) dailyMetaEl.textContent = dailyI18n.waiting;
    if (reportTitleEl) reportTitleEl.textContent = reportI18n.title;
    if (reportRefreshBtnEl) reportRefreshBtnEl.textContent = reportI18n.refreshBtn;
    if (reportCloseBtnEl) reportCloseBtnEl.textContent = reportI18n.closeBtn;
    if (reportMetaEl) reportMetaEl.textContent = reportI18n.waiting;
    if (reportHeadRowEl) reportHeadRowEl.innerHTML = reportHeaderHtml;

    ensureDailyDateValue();
    if (dailyToggleBtnEl) {
      dailyToggleBtnEl.addEventListener('click', function() {
        setDailyPanelOpen(!dailyOpen);
      });
    }
    if (reportToggleBtnEl) {
      reportToggleBtnEl.addEventListener('click', function() {
        setReportPanelOpen(!reportOpen);
      });
    }
    if (dailyRefreshBtnEl) {
      dailyRefreshBtnEl.addEventListener('click', function() {
        if (!dailyOpen) setDailyPanelOpen(true);
        else refreshDailyByHttp();
      });
    }
    if (dailyReportToggleBtnEl) {
      dailyReportToggleBtnEl.addEventListener('click', function() {
        if (!reportOpen) setReportPanelOpen(true);
        else refreshReportsByHttp();
      });
    }
    if (dailyDateEl) {
      dailyDateEl.addEventListener('change', function() {
        ensureDailyDateValue();
        if (dailyOpen) refreshDailyByHttp();
      });
    }
    if (dailyCloseBtnEl) {
      dailyCloseBtnEl.addEventListener('click', function() {
        setDailyPanelOpen(false);
      });
    }
    if (reportRefreshBtnEl) {
      reportRefreshBtnEl.addEventListener('click', function() {
        if (!reportOpen) setReportPanelOpen(true);
        else refreshReportsByHttp();
      });
    }
    if (reportCloseBtnEl) {
      reportCloseBtnEl.addEventListener('click', function() {
        setReportPanelOpen(false);
      });
    }

    updateMeta({ cls: 'warn', label: 'connecting', activeTotal: 0, totalEvents: 0, serverNowMs: Date.now() });
    refreshByHttp();
    startSse();
    setInterval(function() {
      if (!sseConnected) {
        refreshByHttp();
        return;
      }
      var staleForMs = Date.now() - Number(lastSseEventAt || 0);
      if (staleForMs > 25000) {
        sseConnected = false;
        updateMeta({ cls: 'warn', label: 'realtime stale; fallback polling' });
        refreshByHttp();
      }
    }, 5000);
    setInterval(refreshByHttp, 60000);
  </script>
</body>
</html>`;
  return res.status(200).type("html").send(html);
};

["/api/admin/login-events", "/admin/login-events"].forEach((p) => {
  app.post(p, __adminLoginEventIngestHandler);
  app.get(p, __adminLoginEventListHandler);
});

[ "/api/admin/login-events/daily", "/admin/login-events/daily" ].forEach((p) => {
  app.get(p, __adminLoginEventDailyHandler);
});

app.get("/api/admin/login-events/stream", __adminLoginEventStreamHandler);
app.get("/admin/login-monitor", __adminLoginMonitorPageHandler);

mountAiReplyRoutes(app);

async function resolveCallSafetyParticipants(req, body) {
  const b = body || {};
  const roomId = sanitizeText(b.roomId, 120);
  const actorSessionId = sanitizeText(b.sessionId || b.deviceKey || "", 256);
  const explicitPeerSessionId = sanitizeText(b.peerSessionId || "", 256);
  if (!actorSessionId) {
    return { ok: false, errorCode: "SESSION_ID_REQUIRED", errorMessage: "SESSION_ID_REQUIRED" };
  }

  if (roomId) {
    const room = rooms.get(roomId) || (isRtcClusterActive() ? await getRtcRoomRecord(roomId) : null);
    if (room && !room.ended) {
      if (room.aId === actorSessionId) {
        return { ok: true, roomId, actorSessionId, peerSessionId: room.bId };
      }
      if (room.bId === actorSessionId) {
        return { ok: true, roomId, actorSessionId, peerSessionId: room.aId };
      }
      return { ok: false, errorCode: "SESSION_NOT_IN_ROOM", errorMessage: "SESSION_NOT_IN_ROOM" };
    }
  }

  if (!explicitPeerSessionId) {
    return { ok: false, errorCode: "ROOM_OR_PEER_REQUIRED", errorMessage: "ROOM_OR_PEER_REQUIRED" };
  }
  if (explicitPeerSessionId === actorSessionId) {
    return { ok: false, errorCode: "INVALID_PEER_SESSION", errorMessage: "INVALID_PEER_SESSION" };
  }
  return {
    ok: true,
    roomId,
    actorSessionId,
    peerSessionId: explicitPeerSessionId,
  };
}

async function resolveCallSafetyParticipantsForSignal(ws, body) {
  const b = body || {};
  const actorSessionId = sanitizeText(getSessionId(ws), 256);
  const roomId = sanitizeText(b.roomId || (ws && ws._roomId) || "", 120);
  const explicitPeerSessionId = sanitizeText(b.peerSessionId || (ws && ws._peerSessionId) || "", 256);
  if (!actorSessionId) {
    return { ok: false, errorCode: "SESSION_ID_REQUIRED", errorMessage: "SESSION_ID_REQUIRED" };
  }

  if (roomId) {
    const room = rooms.get(roomId) || (isRtcClusterActive() ? await getRtcRoomRecord(roomId) : null);
    if (room && !room.ended) {
      if (room.aId === actorSessionId) {
        return { ok: true, roomId, actorSessionId, peerSessionId: room.bId };
      }
      if (room.bId === actorSessionId) {
        return { ok: true, roomId, actorSessionId, peerSessionId: room.aId };
      }
      return { ok: false, errorCode: "SESSION_NOT_IN_ROOM", errorMessage: "SESSION_NOT_IN_ROOM" };
    }
  }

  if (!explicitPeerSessionId) {
    return { ok: false, errorCode: "ROOM_OR_PEER_REQUIRED", errorMessage: "ROOM_OR_PEER_REQUIRED" };
  }
  if (explicitPeerSessionId === actorSessionId) {
    return { ok: false, errorCode: "INVALID_PEER_SESSION", errorMessage: "INVALID_PEER_SESSION" };
  }
  return {
    ok: true,
    roomId,
    actorSessionId,
    peerSessionId: explicitPeerSessionId,
  };
}

async function buildCallContactMutationPayload(body, pair) {
  const peerLive = await resolvePeerSessionForCallContact(pair.peerSessionId);
  const peerProfileId = sanitizeText((peerLive && peerLive.profileId) || body.peerProfileId || "", 180);
  const storedPeerProfile = resolveStoredProfileMatchData(peerProfileId);
  const storedPeerProfileRow = getStoredProfileUserRow(peerProfileId);
  const publicPeerProfile = buildPublicProfilePayload(peerProfileId, storedPeerProfileRow);
  const publicPeerNickname = sanitizeText(publicPeerProfile.nickname || "", PROFILE_NICKNAME_MAX_LEN);
  return {
    peerProfileId,
    peerSessionId: pair.peerSessionId,
    peerSessionKey: toSessionKey(pair.peerSessionId),
    peerUserId: sanitizeText(body.peerUserId || body.uid || (peerLive && peerLive.userId) || "", 128),
    peerNickname: pickPreferredProfileNickname(
      body.peerNickname,
      peerLive && peerLive.nickname,
      !isGeneratedProfileNickname(publicPeerNickname) ? publicPeerNickname : "",
      storedPeerProfileRow.nickname
    ),
    peerAvatarUrl:
      sanitizeStoredProfileAvatarDataUrl(body.peerAvatarUrl || "") ||
      resolveStoredProfileAvatarUrl({ avatarUrl: publicPeerProfile.avatarUrl, avatarDataUrl: publicPeerProfile.avatarUrl }) ||
      resolveStoredProfileAvatarUrl(storedPeerProfileRow),
    peerLoginAccount: resolveCallReportLoginAccount(
      peerProfileId,
      body.peerLoginAccount || body.peerEmail || (peerLive && peerLive.loginAccount) || ""
    ),
    peerCountry: normalizeMatchCountry(body.peerCountry || (peerLive && peerLive.country) || storedPeerProfile.country || ""),
    peerLanguage: normalizeMatchLanguage(body.peerLanguage || body.peerLang || (peerLive && peerLive.language) || storedPeerProfile.language || ""),
    peerGender: normalizeMatchGender(body.peerGender || (peerLive && peerLive.gender) || storedPeerProfile.gender || ""),
    peerFlag: sanitizeText(body.peerFlag || body.flag || "", 8),
    roomId: pair.roomId,
    lastCallAt: now(),
    updatedAt: now(),
  };
}

async function buildCallContactMutationContext(req, body, pair) {
  const actorLive = await resolvePeerSessionForCallContact(pair.actorSessionId);
  const reporterProfileId = sanitizeText((actorLive && actorLive.profileId) || computeProfileId(req, body), 180);
  return {
    reporterProfileId,
    payload: await buildCallContactMutationPayload(body, pair),
  };
}

async function buildCallContactMutationContextForSignal(body, pair) {
  const actorLive = await resolvePeerSessionForCallContact(pair.actorSessionId);
  return {
    reporterProfileId: sanitizeText((actorLive && actorLive.profileId) || "", 180),
    payload: await buildCallContactMutationPayload(body, pair),
  };
}

async function handleCallContactMutationBySignal(ws, msg, kind) {
  const body = msg && typeof msg === "object" ? msg : {};
  const requestId = sanitizeText(body.requestId || "", 64) || `call_contact_${now()}_${Math.random().toString(16).slice(2, 8)}`;
  const mutationKind = sanitizeText(kind || "", 24).toLowerCase() === "favorite" ? "favorite" : "friend";
  try {
    const pair = await resolveCallSafetyParticipantsForSignal(ws, body);
    if (!pair.ok) {
      safeSend(ws, {
        type: "call_contact_result",
        requestId,
        kind: mutationKind,
        ok: false,
        errorCode: pair.errorCode,
        errorMessage: pair.errorMessage,
      });
      return;
    }

    const enabledRaw = normalizeBooleanLike(body.enabled);
    const enabled = enabledRaw == null ? true : Boolean(enabledRaw);
    const ctx = await buildCallContactMutationContextForSignal(body, pair);
    const reporterProfileIds = await resolveActorProfileIdsForSignal(pair.actorSessionId);
    if (ctx.reporterProfileId) {
      reporterProfileIds.unshift(ctx.reporterProfileId);
    }
    const uniqueReporterProfileIds = Array.from(new Set(reporterProfileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean)));
    if (uniqueReporterProfileIds.length <= 0) {
      safeSend(ws, {
        type: "call_contact_result",
        requestId,
        kind: mutationKind,
        ok: false,
        errorCode: "PROFILE_ID_REQUIRED",
        errorMessage: "PROFILE_ID_REQUIRED",
      });
      return;
    }

    const out = applyCallContactMutation(uniqueReporterProfileIds, ctx.payload, { kind: mutationKind, enabled });
    console.warn(
      `[call-contact-mutation] via=signal kind=${mutationKind} enabled=${enabled ? 1 : 0} actor=${pair.actorSessionId} profiles=${uniqueReporterProfileIds.join(",")} peer=${sanitizeText(ctx.payload && ctx.payload.peerProfileId, 180) || sanitizeText(ctx.payload && ctx.payload.peerSessionId, 256) || "-"}`
    );
    safeSend(ws, {
      type: "call_contact_result",
      requestId,
      kind: mutationKind,
      ok: true,
      contact: out.row ? await enrichCallContactRow(out.row, uniqueReporterProfileIds) : null,
    });
  } catch (e) {
    safeSend(ws, {
      type: "call_contact_result",
      requestId,
      kind: mutationKind,
      ok: false,
      errorCode: mutationKind === "favorite" ? "CALL_FAVORITE_FAILED" : "CALL_FRIEND_FAILED",
      errorMessage:
        sanitizeText((e && e.message) || e, 220) ||
        (mutationKind === "favorite" ? "CALL_FAVORITE_FAILED" : "CALL_FRIEND_FAILED"),
    });
  }
}

const __callReportHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const pair = await resolveCallSafetyParticipants(req, body);
    if (!pair.ok) {
      return res.status(400).json({ ok: false, errorCode: pair.errorCode, errorMessage: pair.errorMessage });
    }

    const reasonCode = sanitizeReasonCode(body.reasonCode);
    const reasonLabel = sanitizeReasonLabel(body.reasonLabel);
    const reasonDetail = sanitizeReasonDetail(body.reasonDetail);
    if (!reasonCode || !reasonLabel) {
      return res.status(400).json({ ok: false, errorCode: "REPORT_REASON_REQUIRED", errorMessage: "REPORT_REASON_REQUIRED" });
    }

    const reporterProfileId = sanitizeText(computeProfileId(req, body), 180);
    const peerSession = sessions.get(pair.peerSessionId) || (isRtcClusterActive() ? await getRtcSessionRecord(pair.peerSessionId) : null);
    const targetProfileId = sanitizeText(peerSession && peerSession.profileId, 180);
    const reporterLoginAccount = resolveCallReportLoginAccount(reporterProfileId, body.loginAccount || body.email || body.account || "");
    const targetLoginAccount = resolveCallReportLoginAccount(targetProfileId, body.peerLoginAccount || body.peerEmail || "");

    const reportRow = appendCallReport({
      reportId: `r_${now()}_${Math.random().toString(16).slice(2, 10)}`,
      createdAt: now(),
      roomId: pair.roomId,
      reasonCode,
      reasonLabel,
      reasonDetail,
      reporterProfileId,
      reporterSessionKey: toSessionKey(pair.actorSessionId),
      reporterLoginAccount,
      targetProfileId,
      targetSessionKey: toSessionKey(pair.peerSessionId),
      targetLoginAccount,
      status: "new",
      emailStatus: "pending",
      source: sanitizeText(body.source || "call_screen", 80),
    });

    await persistProfileStoreNow();

    (async () => {
      try {
        const mailOut = await trySendCallReportMail(reportRow);
        updateCallReportMailResult(reportRow.reportId, Boolean(mailOut && mailOut.ok), sanitizeText(mailOut && mailOut.code, 220));
      } catch (e) {
        updateCallReportMailResult(reportRow.reportId, false, sanitizeText((e && e.message) || "EMAIL_SEND_FAILED", 220));
      }
    })().catch(() => undefined);

    return res.status(200).json({
      ok: true,
      reportId: reportRow.reportId,
      emailStatus: reportRow.emailStatus,
      actorSessionKey: reportRow.reporterSessionKey,
      peerSessionKey: reportRow.targetSessionKey,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_REPORT_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_REPORT_FAILED",
    });
  }
};

const __callBlockHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const pair = await resolveCallSafetyParticipants(req, body);
    if (!pair.ok) {
      return res.status(400).json({ ok: false, errorCode: pair.errorCode, errorMessage: pair.errorMessage });
    }

    const reporterProfileId = sanitizeText(computeProfileId(req, body), 180);
    const peerSession = sessions.get(pair.peerSessionId) || (isRtcClusterActive() ? await getRtcSessionRecord(pair.peerSessionId) : null);
    const reasonCode = sanitizeReasonCode(body.reasonCode || "USER_BLOCK");
    const reasonLabel = sanitizeReasonLabel(body.reasonLabel || "사용자 차단");
    const blockOut = putCallBlock(pair.actorSessionId, pair.peerSessionId, {
      createdAt: now(),
      blockedAt: now(),
      reasonCode,
      reasonLabel,
      roomId: pair.roomId,
      reporterProfileId,
      peerProfileId: sanitizeText(peerSession && peerSession.profileId, 180),
      peerUserId: sanitizeText(body.peerUserId || "", 128),
    });
    if (!blockOut) {
      return res.status(400).json({
        ok: false,
        errorCode: "CALL_BLOCK_INVALID_PAIR",
        errorMessage: "CALL_BLOCK_INVALID_PAIR",
      });
    }

    return res.status(200).json({
      ok: true,
      actorSessionKey: blockOut.actorSessionKey,
      peerSessionKey: blockOut.peerSessionKey,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_BLOCK_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_BLOCK_FAILED",
    });
  }
};

const __callBlockListHandler = (req, res) => {
  try {
    const body = req.body || {};
    const actor = resolveCallBlockActorContext(req, body);
    if (!actor.ok) {
      return res.status(400).json({ ok: false, errorCode: actor.errorCode, errorMessage: actor.errorMessage, items: [] });
    }

    const limitRaw = Number((body && body.limit) || (req.query && req.query.limit) || 200);
    const out = listCallBlocksForActor(actor.actorSessionId, actor.reporterProfileId, limitRaw);
    return res.status(200).json({
      ok: true,
      actorSessionKey: out.actorSessionKey,
      total: out.items.length,
      items: out.items,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_BLOCK_LIST_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_BLOCK_LIST_FAILED",
      items: [],
    });
  }
};

const __callBlockUnblockHandler = (req, res) => {
  try {
    const body = req.body || {};
    const actor = resolveCallBlockActorContext(req, body);
    if (!actor.ok) {
      return res.status(400).json({ ok: false, errorCode: actor.errorCode, errorMessage: actor.errorMessage, removedCount: 0 });
    }

    const peerSessionIds = Array.from(
      new Set(
        [
          ...(Array.isArray(body.peerSessionIds) ? body.peerSessionIds : []),
          body.peerSessionId,
        ]
          .map((value) => sanitizeText(value, 256))
          .filter(Boolean)
      )
    );
    if (peerSessionIds.length <= 0) {
      return res.status(400).json({
        ok: false,
        errorCode: "PEER_SESSION_ID_REQUIRED",
        errorMessage: "PEER_SESSION_ID_REQUIRED",
        removedCount: 0,
      });
    }

    const out = removeCallBlocksForActor(actor.actorSessionId, actor.reporterProfileId, peerSessionIds);
    return res.status(200).json({
      ok: true,
      actorSessionKey: out.actorSessionKey,
      removedCount: out.removedCount,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_BLOCK_UNBLOCK_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_BLOCK_UNBLOCK_FAILED",
      removedCount: 0,
    });
  }
};

const __callFriendHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const pair = await resolveCallSafetyParticipants(req, body);
    if (!pair.ok) {
      return res.status(400).json({ ok: false, errorCode: pair.errorCode, errorMessage: pair.errorMessage });
    }

    const enabledRaw = normalizeBooleanLike(body.enabled);
    const enabled = enabledRaw == null ? true : Boolean(enabledRaw);
    const ctx = await buildCallContactMutationContext(req, body, pair);
    const reporterProfileIds = await resolveActorProfileIds(req, body);
    if (ctx.reporterProfileId) {
      reporterProfileIds.unshift(ctx.reporterProfileId);
    }
    const uniqueReporterProfileIds = Array.from(new Set(reporterProfileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean)));
    if (uniqueReporterProfileIds.length <= 0) {
      return res.status(400).json({ ok: false, errorCode: "PROFILE_ID_REQUIRED", errorMessage: "PROFILE_ID_REQUIRED" });
    }

    const out = applyCallContactMutation(uniqueReporterProfileIds, ctx.payload, { kind: "friend", enabled });
    console.warn(
      `[call-contact-mutation] via=http kind=friend enabled=${enabled ? 1 : 0} actor=${sanitizeText(body.sessionId || body.deviceKey || "", 256) || "-"} profiles=${uniqueReporterProfileIds.join(",")} peer=${sanitizeText(ctx.payload && ctx.payload.peerProfileId, 180) || sanitizeText(ctx.payload && ctx.payload.peerSessionId, 256) || "-"}`
    );

    return res.status(200).json({
      ok: true,
      contact: out.row ? await enrichCallContactRow(out.row, uniqueReporterProfileIds) : null,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_FRIEND_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_FRIEND_FAILED",
    });
  }
};

const __callFavoriteHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const pair = await resolveCallSafetyParticipants(req, body);
    if (!pair.ok) {
      return res.status(400).json({ ok: false, errorCode: pair.errorCode, errorMessage: pair.errorMessage });
    }

    const enabledRaw = normalizeBooleanLike(body.enabled);
    const enabled = enabledRaw == null ? true : Boolean(enabledRaw);
    const ctx = await buildCallContactMutationContext(req, body, pair);
    const reporterProfileIds = await resolveActorProfileIds(req, body);
    if (ctx.reporterProfileId) {
      reporterProfileIds.unshift(ctx.reporterProfileId);
    }
    const uniqueReporterProfileIds = Array.from(new Set(reporterProfileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean)));
    if (uniqueReporterProfileIds.length <= 0) {
      return res.status(400).json({ ok: false, errorCode: "PROFILE_ID_REQUIRED", errorMessage: "PROFILE_ID_REQUIRED" });
    }

    const out = applyCallContactMutation(uniqueReporterProfileIds, ctx.payload, { kind: "favorite", enabled });
    console.warn(
      `[call-contact-mutation] via=http kind=favorite enabled=${enabled ? 1 : 0} actor=${sanitizeText(body.sessionId || body.deviceKey || "", 256) || "-"} profiles=${uniqueReporterProfileIds.join(",")} peer=${sanitizeText(ctx.payload && ctx.payload.peerProfileId, 180) || sanitizeText(ctx.payload && ctx.payload.peerSessionId, 256) || "-"}`
    );

    return res.status(200).json({
      ok: true,
      contact: out.row ? await enrichCallContactRow(out.row, uniqueReporterProfileIds) : null,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_FAVORITE_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_FAVORITE_FAILED",
    });
  }
};

const __callContactListHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const reporterProfileIds = await resolveActorProfileIds(req, body);
    const roomId = sanitizeText(body.roomId || "", 120);
    const peerSessionId = sanitizeText(body.peerSessionId || "", 256);
    const livePeer = peerSessionId ? await resolvePeerSessionForCallContact(peerSessionId) : null;
    const peerProfileId = sanitizeText(body.peerProfileId || (livePeer && livePeer.profileId) || "", 180);
    const peerUserId = sanitizeText(body.peerUserId || "", 128);
    if (reporterProfileIds.length <= 0) {
      return res.status(400).json({ ok: false, errorCode: "PROFILE_ID_REQUIRED", errorMessage: "PROFILE_ID_REQUIRED", contacts: [] });
    }

    const limitRaw = Number((body && body.limit) || (req.query && req.query.limit) || 200);
    const contacts = await listEnrichedCallContactsForProfiles(reporterProfileIds, limitRaw, {
      roomId,
      peerSessionId,
      peerProfileId,
      peerUserId,
    });
    return res.status(200).json({
      ok: true,
      total: contacts.length,
      contacts,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_CONTACT_LIST_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_CONTACT_LIST_FAILED",
      contacts: [],
    });
  }
};

const __callFollowerListHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const reporterProfileIds = await resolveActorProfileIds(req, body);
    const roomId = sanitizeText(body.roomId || "", 120);
    const peerSessionId = sanitizeText(body.peerSessionId || "", 256);
    const livePeer = peerSessionId ? await resolvePeerSessionForCallContact(peerSessionId) : null;
    const peerProfileId = sanitizeText(body.peerProfileId || (livePeer && livePeer.profileId) || "", 180);
    const peerUserId = sanitizeText(body.peerUserId || "", 128);
    if (reporterProfileIds.length <= 0) {
      return res.status(400).json({ ok: false, errorCode: "PROFILE_ID_REQUIRED", errorMessage: "PROFILE_ID_REQUIRED", contacts: [] });
    }

    const limitRaw = Number((body && body.limit) || (req.query && req.query.limit) || 200);
    const contacts = await listEnrichedFollowerCallContactsForProfiles(reporterProfileIds, limitRaw, {
      roomId,
      peerSessionId,
      peerProfileId,
      peerUserId,
    });
    return res.status(200).json({
      ok: true,
      total: contacts.length,
      contacts,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_FOLLOWER_LIST_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_FOLLOWER_LIST_FAILED",
      contacts: [],
    });
  }
};

const __callRecallHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const actorSessionId = sanitizeText(body.sessionId || body.deviceKey || "", 256);
    const actorProfileIds = await resolveActorProfileIds(req, body);
    if (!actorSessionId) {
      return res.status(400).json({ ok: false, errorCode: "SESSION_ID_REQUIRED", errorMessage: "SESSION_ID_REQUIRED" });
    }

    let peerSessionId = sanitizeText(body.peerSessionId || "", 256);
    const peerProfileId = sanitizeText(body.peerProfileId || "", 180);
    if (!peerSessionId && actorProfileIds.length > 0 && peerProfileId) {
      const mergedRows = mergeCallContactRows(actorProfileIds.flatMap((profileId) => listCallContacts(profileId, 500)));
      const matchedRow = mergedRows.find((row) => sanitizeText(row && row.peerProfileId, 180) === peerProfileId);
      peerSessionId = sanitizeText(matchedRow && matchedRow.peerSessionId, 256);
    }
    if (!peerSessionId && !peerProfileId) {
      return res.status(400).json({ ok: false, errorCode: "PEER_SESSION_ID_REQUIRED", errorMessage: "PEER_SESSION_ID_REQUIRED" });
    }

    const out = await tryRecallContactPair(actorSessionId, peerSessionId, peerProfileId);
    if (!out.ok) {
      const status = /_REQUIRED$|^INVALID_|^ACTOR_SESSION_OFFLINE$/.test(String(out.errorCode || "")) ? 400 : 409;
      return res.status(status).json({
        ok: false,
        errorCode: out.errorCode,
        errorMessage: out.errorMessage,
      });
    }

    return res.status(200).json({
      ok: true,
      actorSessionId: sanitizeText(out.actorSessionId || actorSessionId, 256) || undefined,
      peerSessionId: sanitizeText(out.peerSessionId || peerSessionId, 256) || undefined,
      invitePending: out.invitePending === true,
      inviteId: sanitizeText(out.inviteId || "", 128) || undefined,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_RECALL_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_RECALL_FAILED",
    });
  }
};

const __callRecallPendingHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const actorProfileIds = await resolveActorProfileIds(req, body);
    const actorSessionId = sanitizeText(body.sessionId || body.deviceKey || "", 256);
    const invites = listPendingCallRecallInvitesForPeer(actorProfileIds, actorSessionId);
    const invite = invites[0] ? await enrichPendingCallRecallInvite(invites[0], actorProfileIds) : null;
    return res.status(200).json({
      ok: true,
      invite,
      total: invites.length,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_RECALL_PENDING_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_RECALL_PENDING_FAILED",
      invite: null,
    });
  }
};

const __callRecallStatusHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const actorProfileIds = await resolveActorProfileIds(req, body);
    const actorSessionId = sanitizeText(body.sessionId || body.deviceKey || "", 256);
    const inviteId = sanitizeText(body.inviteId || body.recallInviteId || "", 128);
    if (!inviteId) {
      return res.status(400).json({ ok: false, errorCode: "INVITE_ID_REQUIRED", errorMessage: "INVITE_ID_REQUIRED" });
    }

    cleanupCallRecallInvites();
    const invite = callRecallInviteStore.get(inviteId);
    if (!invite) {
      return res.status(404).json({ ok: false, errorCode: "RECALL_INVITE_NOT_FOUND", errorMessage: "RECALL_INVITE_NOT_FOUND" });
    }

    const actorProfileSet = new Set(actorProfileIds.map((value) => sanitizeText(value || "", 180)).filter(Boolean));
    const inviteActorSessionId = sanitizeText(invite.actorSessionId || "", 256);
    const inviteActorProfileId = sanitizeText(invite.actorProfileId || "", 180);
    const authorized =
      (actorSessionId && inviteActorSessionId && actorSessionId === inviteActorSessionId) ||
      (inviteActorProfileId && actorProfileSet.has(inviteActorProfileId));
    if (!authorized) {
      return res.status(403).json({ ok: false, errorCode: "RECALL_INVITE_FORBIDDEN", errorMessage: "RECALL_INVITE_FORBIDDEN" });
    }

    const statusRow = serializeCallRecallInviteStatus(invite);
    if (sanitizeText(statusRow.status || "", 24).toLowerCase() === "blocked") {
      statusRow.status = "declined";
    }
    return res.status(200).json({
      ok: true,
      ...statusRow,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_RECALL_STATUS_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_RECALL_STATUS_FAILED",
    });
  }
};

const __callRecallRespondHandler = async (req, res) => {
  try {
    const body = req.body || {};
    const actorProfileIds = await resolveActorProfileIds(req, body);
    const actorSessionId = sanitizeText(body.sessionId || body.deviceKey || "", 256);
    const inviteId = sanitizeText(body.inviteId || body.recallInviteId || "", 128);
    const acceptRaw = String(body.accept ?? body.accepted ?? "0").trim().toLowerCase();
    const accept = acceptRaw === "1" || acceptRaw === "true" || acceptRaw === "yes" || acceptRaw === "y" || acceptRaw === "on";
    const blockFutureRaw = normalizeBooleanLike(body.blockFuture ?? body.block_future ?? body.rejectFuture ?? body.reject_future);
    const out = await respondToCallRecallInvite(inviteId, actorSessionId, actorProfileIds, accept, blockFutureRaw === true);
    if (!out.ok) {
      const status = /_REQUIRED$|^INVALID_|^RECALL_INVITE_/.test(String(out.errorCode || "")) ? 400 : 409;
      return res.status(status).json({
        ok: false,
        errorCode: out.errorCode,
        errorMessage: out.errorMessage,
      });
    }
    return res.status(200).json({
      ok: true,
      actorSessionId: sanitizeText(out.actorSessionId || "", 256) || undefined,
      peerSessionId: sanitizeText(out.peerSessionId || "", 256) || undefined,
      inviteId: sanitizeText(out.inviteId || "", 128) || undefined,
      blocked: out.blocked === true,
      declined: out.declined === true,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_RECALL_RESPOND_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_RECALL_RESPOND_FAILED",
    });
  }
};

const __adminCallReportListHandler = (req, res) => {
  try {
    normalizeCallSafetyStoreShape();
    const limitRaw = Number(req.query && req.query.limit);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.trunc(limitRaw))) : 200;
    const countByTargetKey = new Map();
    profileStore.callReports.forEach((row) => {
      const targetKey = sanitizeText((row && row.targetProfileId) || (row && row.targetSessionKey) || "", 180);
      if (!targetKey) return;
      countByTargetKey.set(targetKey, (countByTargetKey.get(targetKey) || 0) + 1);
    });
    const reports = profileStore.callReports
      .slice()
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, limit);
    const enrichedReports = reports.map((row) => {
      const reporterProfileId = sanitizeText(row && row.reporterProfileId, 180);
      const targetProfileId = sanitizeText(row && row.targetProfileId, 180);
      const targetCountKey = targetProfileId || sanitizeText(row && row.targetSessionKey, 128);
      return {
        ...row,
        reporterLoginAccount: resolveCallReportLoginAccount(reporterProfileId, row && row.reporterLoginAccount),
        targetLoginAccount: resolveCallReportLoginAccount(targetProfileId, row && row.targetLoginAccount),
        targetReportedCount: countByTargetKey.get(targetCountKey) || 0,
      };
    });
    return res.status(200).json({
      ok: true,
      total: profileStore.callReports.length,
      limit,
      reports: enrichedReports,
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      errorCode: "CALL_REPORT_LIST_FAILED",
      errorMessage: sanitizeText((e && e.message) || e, 220) || "CALL_REPORT_LIST_FAILED",
    });
  }
};

[
  "/api/call/report",
  "/call/report",
  "/api/call/safety/report",
  "/call/safety/report",
  "/api/report/call",
  "/report/call",
].forEach((p) => app.post(p, __callReportHandler));

[
  "/api/call/block",
  "/call/block",
  "/api/call/safety/block",
  "/call/safety/block",
  "/api/block/call",
  "/block/call",
].forEach((p) => app.post(p, __callBlockHandler));

[
  "/api/call/blocks",
  "/call/blocks",
  "/api/call/block/list",
  "/call/block/list",
  "/api/call/safety/blocks",
  "/call/safety/blocks",
].forEach((p) => app.post(p, __callBlockListHandler));

[
  "/api/call/block/unblock",
  "/call/block/unblock",
  "/api/call/blocks/unblock",
  "/call/blocks/unblock",
  "/api/call/safety/block/unblock",
  "/call/safety/block/unblock",
  "/api/call/safety/blocks/unblock",
  "/call/safety/blocks/unblock",
].forEach((p) => app.post(p, __callBlockUnblockHandler));

[
  "/api/call/friend",
  "/call/friend",
  "/api/call/contact/friend",
  "/call/contact/friend",
].forEach((p) => app.post(p, __callFriendHandler));

[
  "/api/call/favorite",
  "/call/favorite",
  "/api/call/contact/favorite",
  "/call/contact/favorite",
].forEach((p) => app.post(p, __callFavoriteHandler));

[
  "/api/call/contacts",
  "/call/contacts",
  "/api/call/contact/list",
  "/call/contact/list",
].forEach((p) => app.post(p, __callContactListHandler));

[
  "/api/call/followers",
  "/call/followers",
  "/api/call/contact/followers",
  "/call/contact/followers",
].forEach((p) => app.post(p, __callFollowerListHandler));

[
  "/api/call/recall",
  "/call/recall",
  "/api/call/contact/recall",
  "/call/contact/recall",
].forEach((p) => app.post(p, __callRecallHandler));

[
  "/api/call/recall/pending",
  "/call/recall/pending",
  "/api/call/contact/recall/pending",
  "/call/contact/recall/pending",
].forEach((p) => app.post(p, __callRecallPendingHandler));

[
  "/api/call/recall/status",
  "/call/recall/status",
  "/api/call/contact/recall/status",
  "/call/contact/recall/status",
].forEach((p) => app.post(p, __callRecallStatusHandler));

[
  "/api/call/recall/respond",
  "/call/recall/respond",
  "/api/call/contact/recall/respond",
  "/call/contact/recall/respond",
].forEach((p) => app.post(p, __callRecallRespondHandler));

app.get("/api/admin/call-reports", __adminCallReportListHandler);
app.get("/admin/call-reports", __adminCallReportListHandler);


app.get("/health", (_req, res) => res.status(200).send("ok"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const sessions = new Map();
const wsToSessionId = new Map();
const queue = new Map();
const rooms = new Map();
const rtcDisconnectGraceTimers = new Map();

function now() {
  return Date.now();
}

function cancelRtcDisconnectGrace(sessionId) {
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return;
  const timer = rtcDisconnectGraceTimers.get(sid);
  if (timer) {
    clearTimeout(timer);
    rtcDisconnectGraceTimers.delete(sid);
  }
}

function getLocalQueueSize() {
  return queue.size;
}

function hasLocalQueueMember(sessionId) {
  const sid = sanitizeText(sessionId || "", 256);
  return Boolean(sid && queue.has(sid));
}

function addLocalQueueMember(sessionId, enqueuedAt = now()) {
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid || queue.has(sid)) return false;
  queue.set(sid, normalizeRtcInt(enqueuedAt, now()));
  return true;
}

function removeLocalQueueMember(sessionId) {
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return false;
  return queue.delete(sid);
}

function listLocalQueueMembers() {
  return Array.from(queue.keys());
}

function refreshProfileStoreForClusterMatch(force = false) {
  if (!RTC_CLUSTER_ENABLED || profileStoreBackend !== "sqlite") return;
  const refreshWindowMs = Number.isFinite(Number(PROFILE_STORE_CLUSTER_REFRESH_MS))
    ? Math.max(500, Math.trunc(Number(PROFILE_STORE_CLUSTER_REFRESH_MS)))
    : 5000;
  const at = now();
  if (!force && at - lastClusterProfileStoreRefreshAt < refreshWindowMs) return;
  try {
    loadProfileStore();
  } catch {}
}

async function touchRtcLocalSession(sessionId) {
  if (!isRtcClusterActive()) return;
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return;
  const entry = sessions.get(sid);
  if (!entry || !isWsAlive(entry.ws)) {
    if (entry && rtcDisconnectGraceTimers.has(sid)) {
      await setRtcSessionRecord(sid, entry, {
        roomId: sanitizeText(entry.roomId || "", 128),
        peerSessionId: sanitizeText(entry.peerSessionId || "", 256),
        enqueuedAt: normalizeRtcInt(entry.enqueuedAt, 0),
        updatedAt: now(),
      });
      return;
    }
    await deleteRtcSessionRecord(sid);
    return;
  }
  await setRtcSessionRecord(sid, entry);
}

function resolveRtcMatchCandidate(record, snapshotAt = now()) {
  const row = record && typeof record === "object" ? record : null;
  if (!row) return { record: null, reason: "missing" };

  const sid = sanitizeText(row.sessionId || "", 256);
  if (!sid) return { record: null, reason: "missing_session" };
  if (!row.workerId) return { record: null, reason: "missing_worker" };
  if (sanitizeText(row.roomId || "", 128)) return { record: null, reason: "already_in_room" };

  const enqueuedAt = normalizeRtcInt(row.enqueuedAt, 0);
  if (enqueuedAt <= 0) return { record: null, reason: "not_enqueued" };

  const updatedAt = normalizeRtcInt(row.updatedAt, 0);
  if (updatedAt <= 0 || snapshotAt - updatedAt > RTC_MATCH_CANDIDATE_MAX_AGE_MS) {
    return { record: null, reason: "stale" };
  }

  if (String(row.workerId) === RTC_WORKER_ID) {
    const local = sessions.get(sid);
    if (!local || !isWsAlive(local.ws)) {
      return { record: null, reason: "local_socket_missing" };
    }
    const localRoomId = sanitizeText(((local.ws && local.ws._roomId) || local.roomId || ""), 128);
    if (localRoomId) {
      return { record: null, reason: "local_room_active" };
    }
    return {
      record: buildRtcSessionRecord(sid, local, {
        roomId: "",
        peerSessionId: "",
        enqueuedAt: normalizeRtcInt(local.enqueuedAt || enqueuedAt, 0),
        updatedAt: Math.max(updatedAt, snapshotAt),
      }),
      reason: "",
    };
  }

  return { record: row, reason: "" };
}

async function deliverRtcMessage(recordOrSessionId, message) {
  const sid = sanitizeText(typeof recordOrSessionId === "string" ? recordOrSessionId : recordOrSessionId && recordOrSessionId.sessionId, 256);
  if (!sid || !message || typeof message !== "object") return false;
  const localEntry = sessions.get(sid);
  if (localEntry && isWsAlive(localEntry.ws)) {
    return applyRtcMessageToLocalSession(Object.assign({}, message, { sessionId: sid }));
  }
  const record = typeof recordOrSessionId === "string" ? await getRtcSessionRecord(sid) : recordOrSessionId;
  if (!record || !record.workerId) return false;
  const payload = Object.assign({}, message, { sessionId: sid });
  if (String(record.workerId) === RTC_WORKER_ID) {
    return applyRtcMessageToLocalSession(payload);
  }
  return publishRtcWorkerMessage(record.workerId, payload);
}

async function bindClusterRoomState(recordOrSessionId, options) {
  const opts = options && typeof options === "object" ? options : {};
  const roomId = sanitizeText(opts.roomId || "", 128);
  const peerSessionId = sanitizeText(opts.peerSessionId || "", 256);
  if (!roomId) return false;
  return deliverRtcMessage(recordOrSessionId, {
    roomId,
    peerSessionId,
    enqueuedAt: 0,
  });
}

async function deliverMatchedState(recordOrSessionId, options) {
  const opts = options && typeof options === "object" ? options : {};
  const roomId = sanitizeText(opts.roomId || "", 128);
  const sessionId = sanitizeText(opts.sessionId || "", 256);
  const peerSessionId = sanitizeText(opts.peerSessionId || "", 256);
  if (!roomId || !sessionId) return false;

  const delivered = await deliverRtcMessage(recordOrSessionId, {
    roomId,
    peerSessionId,
    enqueuedAt: 0,
    payload: { type: "matched", roomId, initiator: Boolean(opts.initiator), sessionId, peerSessionId: peerSessionId || undefined },
  });
  if (!delivered) return false;

  const peerInfo = buildRtcPeerInfoSeed(opts.peerRecord, peerSessionId);
  if (peerInfo) {
    await deliverRtcMessage(recordOrSessionId, {
      roomId,
      peerSessionId,
      enqueuedAt: 0,
      payload: { type: "signal", roomId, fromSessionId: peerSessionId || undefined, data: peerInfo },
    });
  }

  return true;
}

async function clearRtcSessionRoomState(sessionId) {
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return;
  const local = sessions.get(sid);
  if (local) {
    local.roomId = "";
    local.peerSessionId = "";
    local.enqueuedAt = null;
    local.pendingSignals = [];
    if (local.ws) {
      clearRoomRefs(local.ws);
    }
    await setRtcSessionRecord(sid, local, { roomId: "", peerSessionId: "", enqueuedAt: 0, pendingSignals: [] });
    return;
  }
  const record = await getRtcSessionRecord(sid);
  if (!record) return;
  record.roomId = "";
  record.peerSessionId = "";
  record.enqueuedAt = 0;
  record.pendingSignals = [];
  await setRtcSessionRecord(sid, record, record);
}

async function createClusterRoom(aRecord, bRecord) {
  if (!isRtcClusterActive()) return false;
  const aId = sanitizeText(aRecord && aRecord.sessionId, 256);
  const bId = sanitizeText(bRecord && bRecord.sessionId, 256);
  if (!aId || !bId || aId === bId) return false;

  const roomId = genRoomId();
  const createdAt = now();
  const room = { roomId, aId, bId, ended: false, createdAt };
  const boundA = await bindClusterRoomState(aRecord, { roomId, peerSessionId: bId });
  const boundB = await bindClusterRoomState(bRecord, { roomId, peerSessionId: aId });

  if (!boundA || !boundB) {
    console.warn(`[rtc-room-bind-failed] room=${roomId} a=${aId} b=${bId} boundA=${boundA ? 1 : 0} boundB=${boundB ? 1 : 0}`);
    if (boundA) {
      await deliverRtcMessage(aRecord, { clearRoom: true });
    }
    if (boundB) {
      await deliverRtcMessage(bRecord, { clearRoom: true });
    }
    const staleIds = [];
    if (!boundA) staleIds.push(aId);
    if (!boundB) staleIds.push(bId);
    if (staleIds.length > 0) {
      await removeRtcQueueMembers(staleIds);
    }
    return false;
  }

  await removeRtcQueueMembers([aId, bId]);
  await setRtcRoomRecord(roomId, room);
  await setRtcSessionRecord(aId, aRecord, { roomId, peerSessionId: bId, enqueuedAt: 0, updatedAt: createdAt });
  await setRtcSessionRecord(bId, bRecord, { roomId, peerSessionId: aId, enqueuedAt: 0, updatedAt: createdAt });

  const sentA = await deliverMatchedState(aRecord, {
    roomId,
    initiator: true,
    sessionId: aId,
    peerSessionId: bId,
    peerRecord: bRecord,
  });
  const sentB = await deliverMatchedState(bRecord, {
    roomId,
    initiator: false,
    sessionId: bId,
    peerSessionId: aId,
    peerRecord: aRecord,
  });

  if (sentA && sentB) return true;

  console.warn(`[rtc-room-create-failed] room=${roomId} a=${aId} b=${bId} sentA=${sentA ? 1 : 0} sentB=${sentB ? 1 : 0}`);
  await deleteRtcRoomRecord(roomId);
  await clearRtcSessionRoomState(aId);
  await clearRtcSessionRoomState(bId);
  if (sentA) {
    await deliverRtcMessage(aRecord, {
      clearRoom: true,
      payload: { type: "end", roomId, reason: "peer_not_available" },
    });
  }
  if (sentB) {
    await deliverRtcMessage(bRecord, {
      clearRoom: true,
      payload: { type: "end", roomId, reason: "peer_not_available" },
    });
  }
  return false;
}

async function tryMatchCluster() {
  if (!isRtcClusterActive()) {
    tryMatch();
    return;
  }

  await withRtcMatchLock(async () => {
    refreshProfileStoreForClusterMatch();
    const queued = await listRtcQueueMembers(RTC_MATCH_SCAN_LIMIT);
    if (!Array.isArray(queued) || queued.length < 2) return;

    const sessionMap = await getRtcSessionRecordMap(queued);
    const candidates = [];
    const stale = [];
    const snapshotAt = now();

    queued.forEach((sid) => {
      const candidate = resolveRtcMatchCandidate(sessionMap.get(sid), snapshotAt);
      if (!candidate.record) {
        stale.push(sid);
        return;
      }
      candidates.push(candidate.record);
    });

    if (stale.length) {
      await removeRtcQueueMembers(stale);
    }
    if (candidates.length < 2) return;

    for (let i = candidates.length - 1; i >= 1; i--) {
      const a = candidates[i];
      const maxAttempts = Math.min(30, i);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const j = Math.floor(Math.random() * i);
        if (j < 0 || j >= i) continue;
        const b = candidates[j];
        if (!b || a.sessionId === b.sessionId) continue;

        const freshPair = await getRtcSessionRecordMap([a.sessionId, b.sessionId]);
        const liveA = resolveRtcMatchCandidate(freshPair.get(a.sessionId), now());
        const liveB = resolveRtcMatchCandidate(freshPair.get(b.sessionId), now());
        const stalePair = [];
        if (!liveA.record) stalePair.push(a.sessionId);
        if (!liveB.record) stalePair.push(b.sessionId);
        if (stalePair.length > 0) {
          await removeRtcQueueMembers(Array.from(new Set(stalePair)));
          continue;
        }

        if (hasBlockBetweenSessions(liveA.record.sessionId, liveB.record.sessionId)) continue;
        if (!isSessionPairMatchCompatible(liveA.record, liveB.record)) continue;
        if (await createClusterRoom(liveA.record, liveB.record)) return;
      }
    }
  });
}

async function endClusterRoomBySession(sessionId, roomId, reason) {
  if (!isRtcClusterActive()) return;
  const sid = sanitizeText(sessionId || "", 256);
  const rid = sanitizeText(roomId || "", 128);
  if (!sid || !rid) return;

  const room = await getRtcRoomRecord(rid);
  const peerSessionId = room
    ? room.aId === sid
      ? room.bId
      : room.bId === sid
        ? room.aId
      : ""
    : "";

  console.warn(`[rtc-room-end] mode=cluster room=${rid} actor=${sid} peer=${peerSessionId || "-"} reason=${sanitizeText(reason || "peer_left", 80)}`);

  await deleteRtcRoomRecord(rid);
  await clearRtcSessionRoomState(sid);

  if (peerSessionId) {
    await deliverRtcMessage(peerSessionId, {
      roomId: rid,
      peerSessionId: "",
      clearRoom: true,
      payload: { type: "end", roomId: rid, reason: reason || "peer_left" },
    });
  }
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
  removeLocalQueueMember(sessionId);
}

function cleanupSession(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;
  cancelRtcDisconnectGrace(sessionId);
  removeFromQueue(sessionId);
  sessions.delete(sessionId);
  if (isRtcClusterActive()) {
    deleteRtcSessionRecord(sessionId).catch(() => {});
  }
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
  const sessionId = getSessionId(ws);
  try {
    ws._roomId = null;
    ws._peerSessionId = null;
  } catch {}
  if (sessionId) {
    const entry = sessions.get(sessionId);
    if (entry) {
      entry.roomId = "";
      entry.peerSessionId = "";
      entry.pendingSignals = [];
    }
  }
}

function getPeerSessionIdFromRoom(room, sessionId, fallbackPeerSessionId) {
  if (room && sessionId) {
    if (room.aId === sessionId) return room.bId;
    if (room.bId === sessionId) return room.aId;
  }
  return fallbackPeerSessionId || null;
}

function endLocalRoomBySessionId(sessionId, roomId, reason) {
  const sid = sanitizeText(sessionId || "", 256);
  const rid = sanitizeText(roomId || "", 128);
  if (!sid || !rid) return;

  const room = rooms.get(rid);
  const selfEntry = sessions.get(sid);
  console.warn(`[rtc-room-end] mode=local room=${rid} actor=${sid} reason=${sanitizeText(reason || "peer_left", 80)}`);

  if (room && room.ended) {
    if (selfEntry) {
      selfEntry.roomId = "";
      selfEntry.peerSessionId = "";
    }
    rooms.delete(rid);
    return;
  }

  if (room) room.ended = true;
  const peerSessionId = getPeerSessionIdFromRoom(room, sid, selfEntry && selfEntry.peerSessionId);
  if (selfEntry) {
    selfEntry.roomId = "";
    selfEntry.peerSessionId = "";
  }

  if (peerSessionId) {
    const peerEntry = sessions.get(peerSessionId);
    if (peerEntry) {
      peerEntry.roomId = "";
      peerEntry.peerSessionId = "";
    }
    if (peerEntry && isWsAlive(peerEntry.ws) && peerEntry.ws._roomId === rid) {
      clearRoomRefs(peerEntry.ws);
      safeSend(peerEntry.ws, { type: "end", roomId: rid, reason: reason || "peer_left" });
    }
  }

  rooms.delete(rid);
}

function endRoomByWs(ws, reason) {
  const sessionId = getSessionId(ws);
  const roomId = ws?._roomId;
  if (!roomId) return;
  if (isRtcClusterActive()) {
    clearRoomRefs(ws);
    safeSend(ws, { type: "end", roomId, reason: reason || "peer_left" });
    endClusterRoomBySession(sessionId, roomId, reason || "peer_left").catch(() => {});
    return;
  }
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
    if (peer) {
      peer.roomId = "";
      peer.peerSessionId = "";
    }
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

function scheduleRtcDisconnectGrace(sessionId, reason) {
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid) return;

  cancelRtcDisconnectGrace(sid);
  const waitMs = Math.max(1500, normalizeRtcInt(RTC_WS_RECONNECT_GRACE_MS, 12000));
  const timer = setTimeout(() => {
    rtcDisconnectGraceTimers.delete(sid);
    (async () => {
      const entry = sessions.get(sid);
      if (!entry || isWsAlive(entry.ws)) return;

      if (isRtcClusterActive()) {
        const liveRecord = await getRtcSessionRecord(sid);
        if (liveRecord && String(liveRecord.workerId || "") !== RTC_WORKER_ID) {
          sessions.delete(sid);
          return;
        }
      }

      const roomId = sanitizeText(entry.roomId || "", 128);
      if (roomId) {
        console.warn(`[rtc-disconnect-grace-expired] session=${sid} room=${roomId} reason=${sanitizeText(reason || "disconnect", 80)}`);
        if (isRtcClusterActive()) {
          await endClusterRoomBySession(sid, roomId, reason || "disconnect");
        } else {
          endLocalRoomBySessionId(sid, roomId, reason || "disconnect");
        }
      }

      cleanupSession(sid);
    })().catch(() => {});
  }, waitMs);

  rtcDisconnectGraceTimers.set(sid, timer);
}

function handleUnexpectedSocketClose(ws, reason) {
  const sessionId = wsToSessionId.get(ws);
  if (!sessionId) {
    cleanupWs(ws);
    return;
  }

  const entry = sessions.get(sessionId);
  const roomId = sanitizeText((ws && ws._roomId) || (entry && entry.roomId) || "", 128);
  const peerSessionId = sanitizeText((ws && ws._peerSessionId) || (entry && entry.peerSessionId) || "", 256);

  wsToSessionId.delete(ws);

  if (entry) {
    entry.ws = null;
    entry.roomId = roomId;
    entry.peerSessionId = peerSessionId;
    entry.enqueuedAt = null;
  }
  removeFromQueue(sessionId);

  if (!roomId) {
    cleanupSession(sessionId);
    return;
  }

  if (isRtcClusterActive()) {
    setRtcSessionRecord(sessionId, entry, {
      roomId,
      peerSessionId,
      enqueuedAt: 0,
      updatedAt: now(),
    }).catch(() => {});
  }

  scheduleRtcDisconnectGrace(sessionId, reason || "disconnect");
}

function createRoom(aId, bId) {
  if (!aId || !bId || aId === bId) return false;

  const a = sessions.get(aId);
  const b = sessions.get(bId);
  if (!a || !b || !isWsAlive(a.ws) || !isWsAlive(b.ws)) return false;
  if (a.ws._roomId || b.ws._roomId) return false;

  const roomId = genRoomId();
  rooms.set(roomId, { aId, bId, ended: false, createdAt: now() });

  a.ws._roomId = roomId;
  b.ws._roomId = roomId;
  a.ws._peerSessionId = bId;
  b.ws._peerSessionId = aId;
  a.roomId = roomId;
  b.roomId = roomId;
  a.peerSessionId = bId;
  b.peerSessionId = aId;

  a.enqueuedAt = null;
  b.enqueuedAt = null;

  safeSend(a.ws, { type: "matched", roomId, initiator: true, sessionId: aId, peerSessionId: bId });
  safeSend(b.ws, { type: "matched", roomId, initiator: false, sessionId: bId, peerSessionId: aId });
  const peerInfoForA = buildRtcPeerInfoSeed(b, bId);
  const peerInfoForB = buildRtcPeerInfoSeed(a, aId);
  if (peerInfoForA) {
    safeSend(a.ws, { type: "signal", roomId, fromSessionId: bId, data: peerInfoForA });
  }
  if (peerInfoForB) {
    safeSend(b.ws, { type: "signal", roomId, fromSessionId: aId, data: peerInfoForB });
  }
  return true;
}

function tryMatch() {
  if (getLocalQueueSize() < 2) return;

  const initial = listLocalQueueMembers();
  for (let i = initial.length - 1; i >= 0; i--) {
    const sid = initial[i];
    const s = sessions.get(sid);
    if (!s || !isWsAlive(s.ws) || s.ws._roomId) removeLocalQueueMember(sid);
  }
  const candidates = listLocalQueueMembers();
  if (candidates.length < 2) return;

  for (let i = candidates.length - 1; i >= 1; i--) {
    const aId = candidates[i];
    const a = sessions.get(aId);
    if (!a || !isWsAlive(a.ws) || a.ws._roomId) {
      removeLocalQueueMember(aId);
      continue;
    }

    const maxAttempts = Math.min(30, i);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const j = Math.floor(Math.random() * i);
      if (j < 0 || j >= i) continue;

      const bId = candidates[j];
      if (!bId || bId === aId) continue;
      const b = sessions.get(bId);
      if (!b || !isWsAlive(b.ws) || b.ws._roomId) continue;
      if (hasBlockBetweenSessions(aId, bId)) continue;
      if (!isSessionPairMatchCompatible(a, b)) continue;

      removeLocalQueueMember(aId);
      removeLocalQueueMember(bId);

      if (!createRoom(aId, bId)) {
        if (sessions.has(aId)) addLocalQueueMember(aId, a.enqueuedAt || now());
        if (sessions.has(bId)) addLocalQueueMember(bId, b.enqueuedAt || now());
        continue;
      }

      return;
    }
  }
}

async function resumeRoomForRegisteredSession(ws, sessionId, entry, roomInfo) {
  const sid = sanitizeText(sessionId || "", 256);
  if (!sid || !entry || !ws) return;

  const desiredRoomId = sanitizeText((roomInfo && roomInfo.roomId) || entry.roomId || "", 128);
  if (!desiredRoomId) return;

  let room = roomInfo && roomInfo.roomId ? roomInfo : null;
  if (!room) {
    room = isRtcClusterActive() ? await getRtcRoomRecord(desiredRoomId) : rooms.get(desiredRoomId);
  }

  const activeRoomId = sanitizeText(room && room.roomId, 128);
  if (!activeRoomId) {
    entry.roomId = "";
    entry.peerSessionId = "";
    entry.pendingSignals = [];
    if (isRtcClusterActive()) {
      await setRtcSessionRecord(sid, entry, { roomId: "", peerSessionId: "", enqueuedAt: 0, pendingSignals: [] });
    }
    safeSend(ws, { type: "end", roomId: desiredRoomId, reason: "room_expired" });
    return;
  }

  const peerSessionId = sanitizeText(
    getPeerSessionIdFromRoom(room, sid, (roomInfo && roomInfo.peerSessionId) || entry.peerSessionId),
    256
  );
  const initiator = Boolean(room && room.aId === sid);

  ws._roomId = activeRoomId;
  ws._peerSessionId = peerSessionId || null;
  entry.roomId = activeRoomId;
  entry.peerSessionId = peerSessionId || "";

  if (isRtcClusterActive()) {
    await setRtcSessionRecord(sid, entry, {
      roomId: activeRoomId,
      peerSessionId: peerSessionId || "",
      enqueuedAt: 0,
      updatedAt: now(),
    });
  }

  safeSend(ws, { type: "matched", roomId: activeRoomId, initiator, sessionId: sid, peerSessionId: peerSessionId || undefined });
  let peerRecord = peerSessionId ? sessions.get(peerSessionId) : null;
  if (!peerRecord && isRtcClusterActive() && peerSessionId) {
    peerRecord = await getRtcSessionRecord(peerSessionId);
  }
  const peerInfo = buildRtcPeerInfoSeed(peerRecord, peerSessionId);
  if (peerInfo) {
    safeSend(ws, { type: "signal", roomId: activeRoomId, fromSessionId: peerSessionId || undefined, data: peerInfo });
  }
  flushRtcBufferedSignals(sid, entry, ws);
}

async function resolveValidResumeRoom(sessionId, roomId, peerSessionId) {
  const sid = sanitizeText(sessionId || "", 256);
  const rid = sanitizeText(roomId || "", 128);
  const peerSid = sanitizeText(peerSessionId || "", 256);
  if (!sid || !rid) {
    return { roomId: "", peerSessionId: "", room: null };
  }

  const room = isRtcClusterActive() ? await getRtcRoomRecord(rid) : rooms.get(rid);
  if (!room || room.aId !== sid && room.bId !== sid) {
    return { roomId: "", peerSessionId: "", room: null };
  }

  const resolvedPeerSessionId = sanitizeText(getPeerSessionIdFromRoom(room, sid, peerSid), 256);
  if (!resolvedPeerSessionId) {
    return { roomId: "", peerSessionId: "", room: null };
  }

  return {
    roomId: rid,
    peerSessionId: resolvedPeerSessionId,
    room,
  };
}

function handleRegister(ws, msg) {
  const token = String(msg.token || "").trim();
  const sessionId = String(msg.sessionId || "").trim();

  if (!token || !sessionId) {
    safeSend(ws, { type: "error", reason: "register_requires_token_and_sessionId" });
    return;
  }

  if (isRtcClusterActive()) {
    (async () => {
      refreshProfileStoreForClusterMatch(true);
      const userId = sanitizeText(msg.userId || "", 128);
      const profileId = profileIdFromSignalSession(sessionId, token, userId);
      const legacySignalProfileId = profileIdFromSignalSession(sessionId, token);
      const storedProfilePrimary = resolveStoredProfileMatchData(profileId);
      const storedProfileFallback =
        legacySignalProfileId && legacySignalProfileId !== profileId ? resolveStoredProfileMatchData(legacySignalProfileId) : null;
      const storedProfile =
        (storedProfilePrimary &&
        (storedProfilePrimary.country || storedProfilePrimary.language || storedProfilePrimary.gender || (storedProfilePrimary.interests || []).length > 0))
          ? storedProfilePrimary
          : storedProfileFallback || storedProfilePrimary;
      const storedFilter =
        readStoredMatchFilter(profileId) ||
        (legacySignalProfileId && legacySignalProfileId !== profileId ? readStoredMatchFilter(legacySignalProfileId) : null);
      const existing = sessions.get(sessionId);
      cancelRtcDisconnectGrace(sessionId);
      const existingRoomId = sanitizeText(
        ((existing && existing.ws && existing.ws._roomId) || (existing && existing.roomId) || ""),
        128
      );
      const existingPeerSessionId = sanitizeText(
        ((existing && existing.ws && existing.ws._peerSessionId) || (existing && existing.peerSessionId) || ""),
        256
      );
      if (existing && existing.ws && existing.ws !== ws) {
        try {
          safeSend(existing.ws, { type: "error", reason: "session_replaced" });
          existing.ws.close(4001, "session_replaced");
        } catch {}
        wsToSessionId.delete(existing.ws);
      }

      const remoteExisting = await getRtcSessionRecord(sessionId);
      if (remoteExisting && remoteExisting.workerId && String(remoteExisting.workerId) !== RTC_WORKER_ID) {
        await publishRtcWorkerMessage(remoteExisting.workerId, {
          type: "deliver",
          sessionId,
          payload: { type: "error", reason: "session_replaced" },
          close: true,
          code: 4001,
          reason: "session_replaced",
        });
      }
      const resumeState = await resolveValidResumeRoom(
        sessionId,
        existingRoomId || sanitizeText(remoteExisting && remoteExisting.roomId, 128),
        existingPeerSessionId || sanitizeText(remoteExisting && remoteExisting.peerSessionId, 256)
      );
      const resumeRoomId = resumeState.roomId;
      const resumePeerSessionId = resumeState.peerSessionId;

      sessions.set(sessionId, {
        ws,
        token,
        userId,
        enqueuedAt: null,
        roomId: resumeRoomId,
        peerSessionId: resumePeerSessionId,
        pendingSignals: normalizeRtcBufferedSignals(
          (existing && existing.pendingSignals) || (remoteExisting && remoteExisting.pendingSignals)
        ),
        sessionKey: toSessionKey(sessionId),
        profileId,
        country: storedProfile.country,
        language: storedProfile.language,
        gender: storedProfile.gender,
        interests: storedProfile.interests,
        matchFilter: storedFilter || buildDefaultMatchFilter(),
        matchFilterSource: storedFilter ? "stored" : "default",
      });
      wsToSessionId.set(ws, sessionId);
      if (resumeRoomId) {
        ws._roomId = resumeRoomId;
        ws._peerSessionId = resumePeerSessionId || null;
      }
      await setRtcSessionRecord(sessionId, sessions.get(sessionId));
      safeSend(ws, { type: "registered", sessionId });
      if (resumeRoomId) {
        await resumeRoomForRegisteredSession(ws, sessionId, sessions.get(sessionId), {
          roomId: resumeRoomId,
          peerSessionId: resumePeerSessionId,
        });
      }
    })().catch(() => {
      safeSend(ws, { type: "error", reason: "register_failed" });
    });
    return;
  }

  const userId = sanitizeText(msg.userId || "", 128);
  const profileId = profileIdFromSignalSession(sessionId, token, userId);
  const legacySignalProfileId = profileIdFromSignalSession(sessionId, token);
  const storedProfilePrimary = resolveStoredProfileMatchData(profileId);
  const storedProfileFallback =
    legacySignalProfileId && legacySignalProfileId !== profileId ? resolveStoredProfileMatchData(legacySignalProfileId) : null;
  const storedProfile =
    (storedProfilePrimary &&
    (storedProfilePrimary.country || storedProfilePrimary.language || storedProfilePrimary.gender || (storedProfilePrimary.interests || []).length > 0))
      ? storedProfilePrimary
      : storedProfileFallback || storedProfilePrimary;
  const storedFilter =
    readStoredMatchFilter(profileId) ||
    (legacySignalProfileId && legacySignalProfileId !== profileId ? readStoredMatchFilter(legacySignalProfileId) : null);
  const existing = sessions.get(sessionId);
  cancelRtcDisconnectGrace(sessionId);
  const existingRoomId = sanitizeText(
    ((existing && existing.ws && existing.ws._roomId) || (existing && existing.roomId) || ""),
    128
  );
  const existingPeerSessionId = sanitizeText(
    ((existing && existing.ws && existing.ws._peerSessionId) || (existing && existing.peerSessionId) || ""),
    256
  );
  if (existing && existing.ws && existing.ws !== ws) {
    try {
      safeSend(existing.ws, { type: "error", reason: "session_replaced" });
      existing.ws.close(4001, "session_replaced");
    } catch {}
    wsToSessionId.delete(existing.ws);
  }

  const resumeState = {
    roomId: "",
    peerSessionId: "",
  };
  const localResume = rooms.get(existingRoomId);
  if (existingRoomId && localResume && (localResume.aId === sessionId || localResume.bId === sessionId)) {
    resumeState.roomId = existingRoomId;
    resumeState.peerSessionId = sanitizeText(getPeerSessionIdFromRoom(localResume, sessionId, existingPeerSessionId), 256);
  }

  sessions.set(sessionId, {
    ws,
    token,
    userId,
    enqueuedAt: null,
    roomId: resumeState.roomId,
    peerSessionId: resumeState.peerSessionId,
    pendingSignals: normalizeRtcBufferedSignals(existing && existing.pendingSignals),
    sessionKey: toSessionKey(sessionId),
    profileId,
    country: storedProfile.country,
    language: storedProfile.language,
    gender: storedProfile.gender,
    interests: storedProfile.interests,
    matchFilter: storedFilter || buildDefaultMatchFilter(),
    matchFilterSource: storedFilter ? "stored" : "default",
  });
  wsToSessionId.set(ws, sessionId);
  if (resumeState.roomId) {
    ws._roomId = resumeState.roomId;
    ws._peerSessionId = resumeState.peerSessionId || null;
  }

  safeSend(ws, { type: "registered", sessionId });
  if (resumeState.roomId) {
    resumeRoomForRegisteredSession(ws, sessionId, sessions.get(sessionId), {
      roomId: resumeState.roomId,
      peerSessionId: resumeState.peerSessionId,
    }).catch(() => {});
  }
}

function handleEnqueue(ws, msg) {
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

  if (ws._roomId || sanitizeText(s.roomId || "", 128)) {
    safeSend(ws, { type: "error", reason: "already_in_room" });
    return;
  }

  const payload = msg && typeof msg === "object" ? msg : {};
  refreshProfileStoreForClusterMatch(true);
  const profile = buildSessionProfileFromEnqueue(payload);
  const storedProfile = resolveStoredProfileMatchData(s.profileId);
  const incomingFilter = payload.filter || payload.matchFilter ? normalizeMatchFilterPayload(payload.filter || payload.matchFilter) : null;
  const storedFilter = readStoredMatchFilter(s.profileId);

  s.country = profile.country || s.country || storedProfile.country || "";
  s.language = profile.language || s.language || storedProfile.language || "";
  s.gender = profile.gender || s.gender || storedProfile.gender || "";
  s.interests = (profile.interests && profile.interests.length > 0 ? profile.interests : s.interests) || storedProfile.interests || [];
  s.matchFilter = incomingFilter || storedFilter || buildDefaultMatchFilter();
  s.matchFilterSource = incomingFilter ? "incoming" : storedFilter ? "stored" : "default";
  s.roomId = "";
  s.peerSessionId = "";

  if (isRtcClusterActive()) {
    (async () => {
      const enqueuedAt = now();
      s.enqueuedAt = enqueuedAt;
      await addRtcQueueMember(sessionId, enqueuedAt);
      await setRtcSessionRecord(sessionId, s, { enqueuedAt, roomId: "", peerSessionId: "" });
      const queueSize = await getRtcQueueSize();
      safeSend(ws, { type: "enqueued", sessionId, queueSize });
      await tryMatchCluster();
    })().catch(() => {
      safeSend(ws, { type: "error", reason: "enqueue_failed" });
    });
    return;
  }

  if (addLocalQueueMember(sessionId, now())) {
    s.enqueuedAt = queue.get(sessionId) || now();
  }

  safeSend(ws, { type: "enqueued", sessionId, queueSize: getLocalQueueSize() });

  tryMatch();
}

function handleDequeue(ws) {
  const sessionId = getSessionId(ws);
  if (!sessionId) {
    safeSend(ws, { type: "error", reason: "not_registered" });
    return;
  }

  if (isRtcClusterActive()) {
    (async () => {
      await removeRtcQueueMembers([sessionId]);
      const s = sessions.get(sessionId);
      if (s) {
        s.enqueuedAt = null;
        await setRtcSessionRecord(sessionId, s, { enqueuedAt: 0 });
      }
      const queueSize = await getRtcQueueSize();
      safeSend(ws, { type: "dequeued", sessionId, queueSize });
    })().catch(() => {
      safeSend(ws, { type: "error", reason: "dequeue_failed" });
    });
    return;
  }

  removeFromQueue(sessionId);

  const s = sessions.get(sessionId);
  if (s) s.enqueuedAt = null;

  safeSend(ws, { type: "dequeued", sessionId, queueSize: getLocalQueueSize() });
}

function handleLeave(ws) {
  const sessionId = getSessionId(ws);
  if (!sessionId) {
    safeSend(ws, { type: "error", reason: "not_registered" });
    return;
  }

  if (isRtcClusterActive()) {
    (async () => {
      const roomId = ws._roomId;
      if (roomId) {
        await endClusterRoomBySession(sessionId, roomId, "peer_left");
      }
      clearRoomRefs(ws);
      await removeRtcQueueMembers([sessionId]);
      const s = sessions.get(sessionId);
      if (s) {
        s.enqueuedAt = null;
        await setRtcSessionRecord(sessionId, s, { roomId: "", peerSessionId: "", enqueuedAt: 0 });
      }
      safeSend(ws, { type: "left_ok", roomId: roomId || null, sessionId });
    })().catch(() => {
      safeSend(ws, { type: "error", reason: "leave_failed" });
    });
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

  if (isRtcClusterActive()) {
    (async () => {
      const room = await getRtcRoomRecord(roomId);
      const peerSessionId = room
        ? room.aId === sessionId
          ? room.bId
          : room.bId === sessionId
            ? room.aId
            : ""
        : sanitizeText(ws._peerSessionId || "", 256);
      if (!peerSessionId) {
        safeSend(ws, { type: "error", reason: "no_peer" });
        return;
      }

      const delivered = await deliverRtcMessage(peerSessionId, {
        payload: { type: "signal", roomId, fromSessionId: sessionId, data: msg.data ?? null },
      });
      if (!delivered) {
        console.warn(`[rtc-signal-deliver-failed] mode=cluster room=${roomId} actor=${sessionId} peer=${peerSessionId || "-"} type=signal`);
        safeSend(ws, { type: "error", reason: "peer_not_available" });
      }
    })().catch(() => {
      console.warn(`[rtc-signal-deliver-failed] mode=cluster room=${roomId} actor=${sessionId} peer=${sanitizeText(ws._peerSessionId || "", 256) || "-"} type=signal`);
      safeSend(ws, { type: "error", reason: "peer_not_available" });
    });
    return;
  }

  const peerSessionId = ws._peerSessionId;
  if (!peerSessionId) {
    safeSend(ws, { type: "error", reason: "no_peer" });
    return;
  }

  const peer = sessions.get(peerSessionId);
  if (!peer || !isWsAlive(peer.ws) || peer.ws._roomId !== roomId) {
    console.warn(`[rtc-signal-deliver-failed] mode=local room=${roomId} actor=${sessionId} peer=${peerSessionId || "-"} type=signal`);
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

  if (isRtcClusterActive()) {
    (async () => {
      const room = await getRtcRoomRecord(roomId);
      const peerSessionId = room
        ? room.aId === sessionId
          ? room.bId
          : room.bId === sessionId
            ? room.aId
            : ""
        : sanitizeText(ws._peerSessionId || "", 256);
      if (!peerSessionId) {
        safeSend(ws, { type: "error", reason: "no_peer" });
        return;
      }

      const enabled = msg.enabled === true ? true : msg.enabled === false ? false : false;
      const delivered = await deliverRtcMessage(peerSessionId, {
        payload: { type: "cam", roomId, fromSessionId: sessionId, enabled },
      });
      if (!delivered) {
        safeSend(ws, { type: "error", reason: "peer_not_available" });
      }
    })().catch(() => {
      safeSend(ws, { type: "error", reason: "peer_not_available" });
    });
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

const heartbeatTimer = setInterval(() => {
  try {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        ws._missedHeartbeats = normalizeRtcInt(ws._missedHeartbeats, 0) + 1;
        if (ws._missedHeartbeats >= WS_HEARTBEAT_MISS_LIMIT) {
          try { ws.terminate(); } catch {}
          return;
        }
      } else {
        ws._missedHeartbeats = 0;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    });
    if (isRtcClusterActive()) {
      sessions.forEach((_entry, sessionId) => {
        touchRtcLocalSession(sessionId).catch(() => {});
      });
    }
  } catch {}
}, Math.max(5000, WS_HEARTBEAT_MS));
wss.on("close", () => {
  try {
    clearInterval(heartbeatTimer);
  } catch {}
  try {
    closeAiReplyService();
  } catch {}
  try {
    if (rtcRedisSub) rtcRedisSub.quit().catch(() => {});
  } catch {}
  try {
    if (rtcRedis) rtcRedis.quit().catch(() => {});
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
  ws._missedHeartbeats = 0;
  ws.on("pong", () => {
    ws.isAlive = true;
    ws._missedHeartbeats = 0;
  });

  ws.on("message", (raw) => {
    ws.isAlive = true;
    ws._missedHeartbeats = 0;
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
        handleEnqueue(ws, msg);
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
      case "call_friend":
        handleCallContactMutationBySignal(ws, msg, "friend").catch(() => {
          safeSend(ws, {
            type: "call_contact_result",
            requestId: sanitizeText(msg && msg.requestId, 64) || undefined,
            kind: "friend",
            ok: false,
            errorCode: "CALL_FRIEND_FAILED",
            errorMessage: "CALL_FRIEND_FAILED",
          });
        });
        break;
      case "call_favorite":
        handleCallContactMutationBySignal(ws, msg, "favorite").catch(() => {
          safeSend(ws, {
            type: "call_contact_result",
            requestId: sanitizeText(msg && msg.requestId, 64) || undefined,
            kind: "favorite",
            ok: false,
            errorCode: "CALL_FAVORITE_FAILED",
            errorMessage: "CALL_FAVORITE_FAILED",
          });
        });
        break;
      case "ping":
        safeSend(ws, { type: "pong", at: normalizeRtcInt(msg && msg.at, now()) });
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
    handleUnexpectedSocketClose(ws, "disconnect");
  });

  ws.on("error", () => {
    detachWalletSubscriber(ws);
    handleUnexpectedSocketClose(ws, "error");
  });

  safeSend(ws, { type: "hello" });
});

async function startServer() {
  if (RTC_CLUSTER_ENABLED) {
    await initRtcClusterBridge();
  }
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[rtc-signal] listening on 0.0.0.0:${PORT}`);
  });
}

startServer().catch((e) => {
  console.error("[rtc-signal] startup failed:", e && e.message ? e.message : e);
  process.exit(1);
});

app.get("/api/active-users", async (_req, res) => {
  const wsClients = Number((wss && wss.clients && wss.clients.size) || 0);
  const registeredSessions = Number((sessions && sessions.size) || 0);
  const queuedUsers = await getRtcQueueSize();
  let loginPresenceActive = 0;
  try {
    loginPresenceActive = countActiveLoginPresence(LOGIN_ACTIVE_WINDOW_MS);
  } catch {
    loginPresenceActive = 0;
  }
  const eligibleActiveUsers = Math.max(wsClients, registeredSessions, queuedUsers, loginPresenceActive);

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.status(200).json({
    activeUsers: eligibleActiveUsers,
    eligibleActiveUsers,
    wsClients,
    registeredSessions,
    queuedUsers,
    loginPresenceActive,
  });
});
