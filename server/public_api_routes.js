"use strict";

const { mountSocialAuth } = require("../social_auth");
const { mountRealtimeTranslateRoutes } = require("../translate_routes");

function mountMethods(app, methods, paths, handler) {
  methods.forEach((method) => {
    const fn = app && app[method];
    if (typeof fn !== "function") return;
    paths.forEach((routePath) => fn.call(app, routePath, handler));
  });
}

function readPositiveAmount(rawValue) {
  const numeric = Number(rawValue);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : 0;
}

function readIdempotencyKey(req, body, sanitizeText) {
  return sanitizeText((body && body.idempotencyKey) || (req && req.headers && req.headers["x-idempotency-key"]) || "", 128);
}

function buildInvalidAmountResponse() {
  return {
    ok: false,
    code: "INVALID_AMOUNT",
    message: "INVALID_AMOUNT",
  };
}

function pushUniqueProfileId(out, rawValue, sanitizeText) {
  const profileId = sanitizeText(rawValue || "", 180);
  if (!profileId || out.includes(profileId)) return;
  out.push(profileId);
}

function resolveMatchFilterProfileIds(req, input, deps) {
  const d = deps && typeof deps === "object" ? deps : {};
  const sanitizeText =
    typeof d.sanitizeText === "function"
      ? d.sanitizeText
      : (value, maxLen = 320) => String(value || "").trim().slice(0, maxLen);
  const body = input && typeof input === "object" ? input : {};
  const profileIds = [];
  const deviceKey = sanitizeText(
    body.deviceKey || body.sessionId || (req && req.headers && (req.headers["x-device-key"] || req.headers["x-session-id"])) || "",
    256
  );

  if (deviceKey && typeof d.profileIdFromSignalSession === "function") {
    pushUniqueProfileId(profileIds, d.profileIdFromSignalSession(deviceKey, ""), sanitizeText);
  }
  if (typeof d.computeProfileId === "function") {
    pushUniqueProfileId(profileIds, d.computeProfileId(req, body), sanitizeText);
  }

  return profileIds;
}

function resolvePopTalkMutationContext(req, body, kind, deps) {
  const d = deps && typeof deps === "object" ? deps : {};
  const sanitizeText = typeof d.sanitizeText === "function" ? d.sanitizeText : (value) => String(value || "").trim();
  const amount = readPositiveAmount(body && body.amount);
  if (amount <= 0) {
    return {
      ok: false,
      status: 400,
      response: buildInvalidAmountResponse(),
    };
  }

  const ensured = d.ensurePopTalkWallet(req, body || {});
  if (!ensured.wallet) {
    return {
      ok: false,
      status: 400,
      response: {
        ok: false,
        code: ensured.errorCode || "profile_id_required",
      },
    };
  }

  const wallet = ensured.wallet;
  const idempotencyKey = readIdempotencyKey(req, body, sanitizeText);
  const idemHit = d.getPopTalkIdempotencyRecord(wallet, idempotencyKey, kind);
  if (idemHit) {
    return {
      ok: false,
      status: idemHit.status,
      response: idemHit.response,
    };
  }

  return {
    ok: true,
    amount,
    ensured,
    wallet,
    idempotencyKey,
  };
}

function mountPublicApiRoutes(app, deps) {
  const d = deps && typeof deps === "object" ? deps : {};
  const computePopTalkCap = (wallet, atMs) => {
    const tsRaw = Number(atMs);
    const ts =
      Number.isFinite(tsRaw) && tsRaw > 0
        ? Math.trunc(tsRaw)
        : typeof d.now === "function"
          ? Number(d.now()) || Date.now()
          : Date.now();
    const unlimitedUntilRaw = Number(wallet && wallet.unlimitedUntilMs);
    const unlimitedUntilMs = Number.isFinite(unlimitedUntilRaw) ? Math.max(0, Math.trunc(unlimitedUntilRaw)) : 0;
    const unlimitedActive = unlimitedUntilMs > ts;
    if (typeof d.computePopTalkDisplayCap === "function") {
      return d.computePopTalkDisplayCap(wallet && wallet.plan, wallet && wallet.balance, { unlimitedActive });
    }
    const planCap = d.getPopTalkPlanConfig(wallet && wallet.plan).cap;
    const balance = Number.isFinite(Number(wallet && wallet.balance)) ? Math.max(0, Math.trunc(Number(wallet.balance))) : 0;
    return Math.max(planCap, balance);
  };

  const __deviceBindHandler = (req, res) => {
    const body = req.body || {};
    const deviceKey = String(body.deviceKey || "").trim();
    const platform = String(body.platform || "").trim();

    if (!deviceKey) return res.status(400).json({ error: "deviceKey_required" });

    const h = d.deriveBindHash(deviceKey);
    const userId = `u_${h.slice(0, 24)}`;
    const token = `t_${h}`;

    return res.status(200).json({ token, userId, platform });
  };

  mountMethods(app, ["post"], ["/api/bind", "/bind", "/api/device/bind", "/device/bind"], __deviceBindHandler);

  mountSocialAuth(app, { deriveBindHash: d.deriveBindHash });
  mountRealtimeTranslateRoutes(app, { sanitizeText: d.sanitizeAiReplyText });

  const __profileSyncHandler = (req, res) => {
    try {
      const saved = d.upsertProfile(req, req.body || {});
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
        nickname: saved.nickname || null,
        avatarUrl: saved.avatarUrl || null,
        interests: Array.isArray(saved.interests) ? saved.interests : [],
        avatarUpdatedAt: Number.isFinite(Number(saved.avatarUpdatedAt)) ? Math.max(0, Math.trunc(Number(saved.avatarUpdatedAt))) : null,
        updatedAt: saved.updatedAt,
      });
    } catch (e) {
      const status = Number.isFinite(Number(e && e.statusCode)) ? Math.max(400, Math.trunc(Number(e.statusCode))) : 500;
      return res.status(status).json({
        ok: false,
        error: String((e && e.errorCode) || "profile_sync_failed"),
        detail: String((e && (e.exposeMessage || e.message)) || e),
      });
    }
  };

  mountMethods(
    app,
    ["post", "put", "patch"],
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
    ],
    __profileSyncHandler
  );

  const __matchFilterGetHandler = (req, res) => {
    try {
      const input = { ...(req.query || {}), ...(req.body || {}) };
      const profileIds = resolveMatchFilterProfileIds(req, input, d);
      const profileId = profileIds[0] || "";
      if (!profileId) {
        return res.status(400).json({ ok: false, error: "profile_id_required" });
      }

      let stored = null;
      let normalized = typeof d.resolveStoredMatchFilter === "function" ? d.resolveStoredMatchFilter(profileId) : null;
      if (typeof d.readStoredMatchFilter === "function") {
        for (const candidateProfileId of profileIds) {
          const candidate = d.readStoredMatchFilter(candidateProfileId);
          if (!candidate) continue;
          stored = candidate;
          normalized =
            typeof d.resolveStoredMatchFilter === "function" ? d.resolveStoredMatchFilter(candidateProfileId) : candidate;
          break;
        }
      }

      return res.status(200).json({
        ok: true,
        filterFound: Boolean(stored),
        data: normalized,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "match_filter_get_failed", detail: String((e && e.message) || e) });
    }
  };

  const __matchFilterSaveHandler = async (req, res) => {
    try {
      const body = req.body || {};
      const profileIds = resolveMatchFilterProfileIds(req, body, d);
      const profileId = profileIds[0] || "";
      if (!profileId) {
        return res.status(400).json({ ok: false, error: "profile_id_required" });
      }

      const normalized =
        typeof d.saveMatchFilter === "function"
          ? d.saveMatchFilter(profileId, body.filter || body)
          : (body.filter || body);

      if (typeof d.saveMatchFilter === "function" && profileIds.length > 1) {
        profileIds.slice(1).forEach((candidateProfileId) => {
          try {
            d.saveMatchFilter(candidateProfileId, normalized);
          } catch {}
        });
      }

      if (typeof d.persistProfileStoreNow === "function") {
        await d.persistProfileStoreNow();
      }

      return res.status(200).json({ ok: true, data: normalized });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "match_filter_save_failed", detail: String((e && e.message) || e) });
    }
  };

  mountMethods(
    app,
    ["get"],
    [
      "/api/match/filter",
      "/match/filter",
      "/api/matching/filter",
      "/matching/filter",
      "/api/call/match-filter",
      "/call/match-filter",
    ],
    __matchFilterGetHandler
  );

  mountMethods(
    app,
    ["post"],
    [
      "/api/match/filter",
      "/match/filter",
      "/api/matching/filter",
      "/matching/filter",
      "/api/call/match-filter",
      "/call/match-filter",
    ],
    __matchFilterSaveHandler
  );

  const __dinoLeaderboardSubmitHandler = (req, res) => {
    try {
      const saved = d.appendDinoRankEntry(req, req.body || {});
      if (!saved) {
        return res.status(400).json({ ok: false, error: "rank_entry_required" });
      }
      return res.status(200).json({ ok: true, entryId: saved.entryId, score: saved.score });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "rank_submit_failed", detail: String((e && e.message) || e) });
    }
  };

  mountMethods(
    app,
    ["post", "put"],
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
    ],
    __dinoLeaderboardSubmitHandler
  );

  const __dinoLeaderboardHandler = (_req, res) => {
    const items = d.buildLeaderboard(10);
    return res.status(200).json({ items });
  };

  mountMethods(
    app,
    ["get"],
    ["/api/dino/leaderboard", "/api/leaderboard/dino", "/api/leaderboards/dino", "/leaderboard/dino"],
    __dinoLeaderboardHandler
  );

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
      const ensured = d.ensurePopTalkWallet(req, input);
      if (!ensured.wallet) {
        return res.status(400).json({ ok: false, code: ensured.errorCode || "profile_id_required" });
      }

      return res.status(200).json({
        ok: true,
        data: d.buildPopTalkSnapshot(ensured.wallet),
      });
    } catch (e) {
      return res.status(500).json({ ok: false, code: "POPTALK_STATE_FAILED", detail: String((e && e.message) || e) });
    }
  };

  const __popTalkConsumeHandler = (req, res) => {
    try {
      const body = req.body || {};
      const mutation = resolvePopTalkMutationContext(req, body, "consume", d);
      if (!mutation.ok) {
        return res.status(mutation.status).json(mutation.response);
      }

      const ts = d.now();
      const unlimitedUntilMs = Number.isFinite(Number(mutation.wallet.unlimitedUntilMs))
        ? Math.max(0, Math.trunc(Number(mutation.wallet.unlimitedUntilMs)))
        : 0;
      const unlimitedActive = unlimitedUntilMs > ts;

      if (!unlimitedActive && mutation.wallet.balance < mutation.amount) {
        const response = {
          ok: false,
          code: "INSUFFICIENT_BALANCE",
          message: "INSUFFICIENT_BALANCE",
          data: d.buildPopTalkSnapshot(mutation.wallet),
        };
        d.savePopTalkIdempotencyRecord(mutation.wallet, mutation.idempotencyKey, "consume", 409, response);
        return res.status(409).json(response);
      }

      const consumed = unlimitedActive ? 0 : mutation.amount;
      if (!unlimitedActive) {
        mutation.wallet.balance = Math.max(0, mutation.wallet.balance - mutation.amount);
      }
      mutation.wallet.cap = computePopTalkCap(mutation.wallet, ts);
      mutation.wallet.updatedAt = ts;
      d.schedulePersistProfileStore({ type: "wallet", profileId: mutation.ensured.profileId });

      const response = {
        ok: true,
        consumed,
        reason: d.sanitizeText(body.reason || "consume", 64),
        data: d.buildPopTalkSnapshot(mutation.wallet),
      };
      d.savePopTalkIdempotencyRecord(mutation.wallet, mutation.idempotencyKey, "consume", 200, response);
      d.broadcastUnifiedStateByProfile(mutation.ensured.profileId, req, body).catch(() => undefined);
      return res.status(200).json(response);
    } catch (e) {
      return res.status(500).json({ ok: false, code: "POPTALK_CONSUME_FAILED", detail: String((e && e.message) || e) });
    }
  };

  const __popTalkRewardHandler = (req, res) => {
    try {
      const body = req.body || {};
      const mutation = resolvePopTalkMutationContext(req, body, "reward", d);
      if (!mutation.ok) {
        return res.status(mutation.status).json(mutation.response);
      }

      const before = mutation.wallet.balance;
      const ts = d.now();
      const rewardCap = d.getPopTalkPlanConfig(mutation.wallet.plan).cap;
      const nextBalance = before >= rewardCap ? before : Math.min(rewardCap, before + mutation.amount);
      mutation.wallet.balance = Math.max(0, nextBalance);
      mutation.wallet.cap = computePopTalkCap(mutation.wallet, ts);
      mutation.wallet.updatedAt = ts;
      d.schedulePersistProfileStore({ type: "wallet", profileId: mutation.ensured.profileId });

      const response = {
        ok: true,
        rewarded: mutation.amount,
        granted: Math.max(0, mutation.wallet.balance - before),
        reason: d.sanitizeText(body.reason || "reward", 64),
        data: d.buildPopTalkSnapshot(mutation.wallet),
      };
      d.savePopTalkIdempotencyRecord(mutation.wallet, mutation.idempotencyKey, "reward", 200, response);
      d.broadcastUnifiedStateByProfile(mutation.ensured.profileId, req, body).catch(() => undefined);
      return res.status(200).json(response);
    } catch (e) {
      return res.status(500).json({ ok: false, code: "POPTALK_REWARD_FAILED", detail: String((e && e.message) || e) });
    }
  };

  mountMethods(app, ["get", "post"], ["/api/poptalk/state", "/api/poptalk", "/poptalk/state", "/poptalk"], __popTalkStateHandler);
  mountMethods(app, ["post"], ["/api/poptalk/consume", "/api/poptalk/spend", "/poptalk/consume", "/poptalk/spend"], __popTalkConsumeHandler);
  mountMethods(app, ["post"], ["/api/poptalk/reward", "/api/poptalk/rewarded", "/poptalk/reward", "/poptalk/rewarded"], __popTalkRewardHandler);
}

module.exports = {
  mountPublicApiRoutes,
};
