"use strict";

const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

function asText(v, maxLen = 256) {
  return String(v || "").trim().slice(0, maxLen);
}

function toSafeInt(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  const i = Math.trunc(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
}

const SHOP_POP_UNLIMITED_1M_PACK_ID = "once_unlimited_1m";
const POP_UNLIMITED_1M_MS = 30 * 24 * 60 * 60 * 1000;

function runAsync(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, Array.isArray(params) ? params : [], function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function getAsync(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, Array.isArray(params) ? params : [], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function openDb(dbPath) {
  return new sqlite3.Database(dbPath);
}

function getTableColumns(db, tableName) {
  const table = asText(tableName, 80);
  if (!table) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${table})`, [], (err, rows) => {
      if (err) return reject(err);
      resolve(Array.isArray(rows) ? rows : []);
    });
  });
}

async function ensureSchema(db) {
  await runAsync(db, "PRAGMA journal_mode = WAL", []);
  await runAsync(db, "PRAGMA synchronous = NORMAL", []);

  await runAsync(
    db,
    `CREATE TABLE IF NOT EXISTS shop_wallets (
      profile_id TEXT PRIMARY KEY,
      popcorn_balance INTEGER NOT NULL DEFAULT 0,
      kernel_balance INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    )`,
    []
  );

  await runAsync(
    db,
    `CREATE TABLE IF NOT EXISTS shop_first_purchase_claims (
      profile_id TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      claimed_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, pack_id)
    )`,
    []
  );

  await runAsync(
    db,
    `CREATE TABLE IF NOT EXISTS shop_purchase_events (
      transaction_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL,
      pack_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      bonus_amount INTEGER NOT NULL,
      granted_amount INTEGER NOT NULL,
      first_purchase_bonus_applied INTEGER NOT NULL,
      price_krw INTEGER NOT NULL,
      platform TEXT NOT NULL DEFAULT '',
      purchase_date TEXT NOT NULL DEFAULT '',
      rc_app_user_id TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL DEFAULT '',
      device_hash TEXT NOT NULL DEFAULT '',
      idempotency_key TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    []
  );

  await runAsync(db, "CREATE INDEX IF NOT EXISTS idx_shop_purchase_profile_created ON shop_purchase_events (profile_id, created_at DESC)", []);
  await runAsync(db, "CREATE INDEX IF NOT EXISTS idx_shop_purchase_profile_idem ON shop_purchase_events (profile_id, idempotency_key)", []);

  // Backward-compatible wallet schema migration for legacy deployments.
  // Old DBs can have poptalk_balance / kernel_count columns instead.
  const walletCols = await getTableColumns(db, "shop_wallets");
  const walletColSet = new Set(walletCols.map((c) => asText(c && c.name, 80).toLowerCase()).filter((v) => !!v));

  if (!walletColSet.has("popcorn_balance")) {
    await runAsync(db, "ALTER TABLE shop_wallets ADD COLUMN popcorn_balance INTEGER NOT NULL DEFAULT 0", []);
    if (walletColSet.has("poptalk_balance")) {
      await runAsync(
        db,
        "UPDATE shop_wallets SET popcorn_balance = CASE WHEN COALESCE(popcorn_balance, 0) <= 0 THEN COALESCE(poptalk_balance, 0) ELSE popcorn_balance END",
        []
      );
    }
  }

  if (!walletColSet.has("kernel_balance")) {
    await runAsync(db, "ALTER TABLE shop_wallets ADD COLUMN kernel_balance INTEGER NOT NULL DEFAULT 0", []);
    if (walletColSet.has("kernel_count")) {
      await runAsync(
        db,
        "UPDATE shop_wallets SET kernel_balance = CASE WHEN COALESCE(kernel_balance, 0) <= 0 THEN COALESCE(kernel_count, 0) ELSE kernel_balance END",
        []
      );
    }
  }

  if (!walletColSet.has("updated_at")) {
    await runAsync(db, "ALTER TABLE shop_wallets ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0", []);
    await runAsync(db, "UPDATE shop_wallets SET updated_at = CASE WHEN COALESCE(updated_at, 0) <= 0 THEN ? ELSE updated_at END", [toSafeInt(Date.now(), 0)]);
  }

  await runAsync(
    db,
    `CREATE TABLE IF NOT EXISTS shop_kernel_convert_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      kernel_spent INTEGER NOT NULL,
      multiplier REAL NOT NULL,
      converted_poptalk INTEGER NOT NULL,
      poptalk_balance INTEGER NOT NULL,
      poptalk_cap INTEGER NOT NULL,
      poptalk_plan TEXT NOT NULL DEFAULT '',
      poptalk_server_now_ms INTEGER NOT NULL DEFAULT 0,
      wallet_kernel_balance INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (profile_id, idempotency_key)
    )`,
    []
  );
  await runAsync(db, "CREATE INDEX IF NOT EXISTS idx_kernel_convert_profile_created ON shop_kernel_convert_events (profile_id, created_at DESC)", []);

  await runAsync(
    db,
    `CREATE TABLE IF NOT EXISTS shop_gift_inventory (
      profile_id TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      owned_count INTEGER NOT NULL DEFAULT 0,
      received_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, gift_id)
    )`,
    []
  );
  await runAsync(db, "CREATE INDEX IF NOT EXISTS idx_shop_gift_inventory_profile ON shop_gift_inventory (profile_id)", []);

  await runAsync(
    db,
    `CREATE TABLE IF NOT EXISTS shop_gift_action_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_key TEXT NOT NULL,
      gift_id TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      peer_profile_id TEXT NOT NULL DEFAULT '',
      wallet_kernel_balance INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      UNIQUE (profile_id, action_type, action_key)
    )`,
    []
  );
  await runAsync(db, "CREATE INDEX IF NOT EXISTS idx_shop_gift_action_profile_created ON shop_gift_action_events (profile_id, created_at DESC)", []);
}

function mapWallet(row) {
  return {
    popcornBalance: toSafeInt(row && row.popcorn_balance, 0),
    kernelBalance: toSafeInt(row && row.kernel_balance, 0),
  };
}

async function ensureWallet(db, profileId, atMs) {
  const pid = asText(profileId, 180);
  if (!pid) {
    return { popcornBalance: 0, kernelBalance: 0 };
  }

  let row = await getAsync(db, "SELECT profile_id, popcorn_balance, kernel_balance FROM shop_wallets WHERE profile_id = ?", [pid]);
  if (!row) {
    const ts = toSafeInt(atMs, 0);
    await runAsync(
      db,
      "INSERT INTO shop_wallets (profile_id, popcorn_balance, kernel_balance, updated_at) VALUES (?, 0, 0, ?)",
      [pid, ts]
    );
    row = await getAsync(db, "SELECT profile_id, popcorn_balance, kernel_balance FROM shop_wallets WHERE profile_id = ?", [pid]);
  }

  return mapWallet(row);
}

function parseGiftCount(v, fallback = 1) {
  const raw = toSafeInt(v, 0, 1000000);
  if (raw > 0) return raw;
  return Math.max(1, toSafeInt(fallback, 1, 1000000));
}

function toGiftCountMap(rows, keyName) {
  const out = {};
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const giftId = asText(row && row.gift_id, 120);
    if (!giftId) return;
    const count = toSafeInt(row && row[keyName], 0);
    if (count <= 0) return;
    out[giftId] = count;
  });
  return out;
}

function allAsync(db, sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, Array.isArray(params) ? params : [], (err, rows) => {
      if (err) return reject(err);
      resolve(Array.isArray(rows) ? rows : []);
    });
  });
}

async function ensureGiftRow(db, profileId, giftId, atMs) {
  const pid = asText(profileId, 180);
  const gid = asText(giftId, 120);
  const ts = toSafeInt(atMs, 0);
  if (!pid || !gid) {
    return { profileId: pid, giftId: gid, ownedCount: 0, receivedCount: 0 };
  }

  await runAsync(
    db,
    "INSERT OR IGNORE INTO shop_gift_inventory (profile_id, gift_id, owned_count, received_count, updated_at) VALUES (?, ?, 0, 0, ?)",
    [pid, gid, ts]
  );
  const row = await getAsync(
    db,
    "SELECT profile_id, gift_id, owned_count, received_count FROM shop_gift_inventory WHERE profile_id = ? AND gift_id = ? LIMIT 1",
    [pid, gid]
  );
  return {
    profileId: pid,
    giftId: gid,
    ownedCount: toSafeInt(row && row.owned_count, 0),
    receivedCount: toSafeInt(row && row.received_count, 0),
  };
}

async function readGiftState(db, profileId, atMs) {
  const pid = asText(profileId, 180);
  const wallet = await ensureWallet(db, pid, toSafeInt(atMs, 0));
  if (!pid) {
    return {
      profileId: "",
      wallet,
      giftsOwned: {},
      giftsReceived: {},
    };
  }
  const rows = await allAsync(
    db,
    "SELECT gift_id, owned_count, received_count FROM shop_gift_inventory WHERE profile_id = ?",
    [pid]
  );
  return {
    profileId: pid,
    wallet,
    giftsOwned: toGiftCountMap(rows, "owned_count"),
    giftsReceived: toGiftCountMap(rows, "received_count"),
  };
}

function isUniqueTxError(err) {
  const msg = String((err && err.message) || "");
  return msg.includes("shop_purchase_events.transaction_id") || msg.includes("UNIQUE constraint failed");
}

function normalizePopTalkSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const balance = Math.max(0, toSafeInt(raw.balance, 0));
  const capRaw = toSafeInt(raw.cap, 0);
  const cap = Math.max(balance, capRaw);
  const plan = asText(raw.plan, 32) || null;
  const serverNowMsRaw = toSafeInt(raw.serverNowMs, 0);
  return {
    balance,
    cap,
    plan,
    serverNowMs: serverNowMsRaw > 0 ? serverNowMsRaw : null,
  };
}

function buildConfirmPayload(input) {
  return {
    ok: true,
    duplicate: Boolean(input.duplicate),
    firstPurchaseBonusApplied: Boolean(input.firstPurchaseBonusApplied),
    grantedAmount: toSafeInt(input.grantedAmount, 0),
    popTalk: normalizePopTalkSnapshot(input.popTalk),
    wallet: {
      popcornBalance: toSafeInt(input.wallet && input.wallet.popcornBalance, 0),
      kernelBalance: toSafeInt(input.wallet && input.wallet.kernelBalance, 0),
    },
  };
}

function buildUnifiedStatePayload(input) {
  const giftsOwned = input && input.giftState && typeof input.giftState === "object" ? input.giftState.giftsOwned || {} : {};
  const giftsReceived = input && input.giftState && typeof input.giftState === "object" ? input.giftState.giftsReceived || {} : {};
  return {
    ok: true,
    profileId: asText(input.profileId, 180),
    serverNowMs: toSafeInt(input.serverNowMs, 0),
    popTalk: normalizePopTalkSnapshot(input.popTalk),
    wallet: {
      popcornBalance: toSafeInt(input.wallet && input.wallet.popcornBalance, 0),
      kernelBalance: toSafeInt(input.wallet && input.wallet.kernelBalance, 0),
    },
    giftInventory: {
      owned: giftsOwned,
      received: giftsReceived,
    },
    giftsOwned,
    giftsReceived,
  };
}

function buildGiftStatePayload(input) {
  const giftsOwned = input && input.giftsOwned && typeof input.giftsOwned === "object" ? input.giftsOwned : {};
  const giftsReceived = input && input.giftsReceived && typeof input.giftsReceived === "object" ? input.giftsReceived : {};
  const walletKernel = toSafeInt(input && input.wallet && input.wallet.kernelBalance, 0);
  const walletPopcorn = toSafeInt(input && input.wallet && input.wallet.popcornBalance, 0);
  return {
    ok: true,
    profileId: asText(input && input.profileId, 180),
    giftInventory: {
      owned: giftsOwned,
      received: giftsReceived,
    },
    giftsOwned,
    giftsReceived,
    wallet: {
      popcornBalance: walletPopcorn,
      kernelBalance: walletKernel,
    },
    walletKernel,
    data: {
      giftInventory: {
        owned: giftsOwned,
        received: giftsReceived,
      },
      giftsOwned,
      giftsReceived,
      wallet: {
        popcornBalance: walletPopcorn,
        kernelBalance: walletKernel,
      },
      walletKernel,
    },
  };
}

function drawKernelConvertMultiplier() {
  const r = Math.random() * 100;
  if (r < 1) return 2.0;   // 1%
  if (r < 5) return 1.5;   // 4%
  if (r < 25) return 1.2;  // 20%
  return 1.0;              // 75%
}

function parseKernelConvertAmount(body) {
  const b = body && typeof body === "object" ? body : {};
  return toSafeInt(
    b.kernelAmount ?? b.amount ?? b.kernels ?? b.spendKernel,
    0,
    1000000000
  );
}

function buildKernelConvertPayload(input) {
  const popTalk = normalizePopTalkSnapshot(input.popTalk || null);
  const walletKernel = toSafeInt(input.walletKernelBalance, 0);
  const kernelSpent = toSafeInt(input.kernelSpent, 0);
  const multiplierRaw = Number(input.multiplier);
  const multiplier = Number.isFinite(multiplierRaw) && multiplierRaw > 0 ? Number(multiplierRaw) : 1;
  const convertedPopTalk = toSafeInt(input.convertedPopTalk, 0);
  return {
    ok: true,
    duplicate: Boolean(input.duplicate),
    kernelSpent,
    multiplier,
    convertedPopTalk,
    popTalk,
    wallet: {
      kernelBalance: walletKernel,
    },
    data: {
      popTalk,
      wallet: {
        kernelBalance: walletKernel,
      },
    },
  };
}

function mountShopPurchaseRoutes(app, deps) {
  const computeProfileId = deps && typeof deps.computeProfileId === "function" ? deps.computeProfileId : null;
  const parseBearer = deps && typeof deps.parseBearer === "function" ? deps.parseBearer : () => "";
  const sanitizeText = deps && typeof deps.sanitizeText === "function" ? deps.sanitizeText : asText;
  const anonymizeKey = deps && typeof deps.anonymizeKey === "function" ? deps.anonymizeKey : (v) => asText(v, 512);
  const now = deps && typeof deps.now === "function" ? deps.now : () => Date.now();
  const resolvePopTalkSnapshot = deps && typeof deps.resolvePopTalkSnapshot === "function" ? deps.resolvePopTalkSnapshot : null;
  const onWalletChanged = deps && typeof deps.onWalletChanged === "function" ? deps.onWalletChanged : null;
  const applyKernelToPopTalk = deps && typeof deps.applyKernelToPopTalk === "function" ? deps.applyKernelToPopTalk : null;

  if (!app || typeof app.post !== "function" || !computeProfileId) {
    throw new Error("mountShopPurchaseRoutes_invalid_deps");
  }

  const dataDir = asText(process.env.SHOP_DB_DIR || (deps && deps.dataDir) || path.join(__dirname, "data"), 1024) || path.join(__dirname, "data");
  const dbPath = asText(process.env.SHOP_DB_PATH || path.join(dataDir, "shop.db"), 1024) || path.join(dataDir, "shop.db");

  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  } catch (e) {
    console.error("[shop-db] failed to ensure db dir:", (e && e.message) || e);
  }

  const db = openDb(dbPath);
  const initPromise = ensureSchema(db)
    .then(() => {
      console.log("[shop-db] ready:", dbPath);
    })
    .catch((e) => {
      console.error("[shop-db] init failed:", (e && e.message) || e);
      throw e;
    });

  function emitWalletChanged(payload) {
    if (!onWalletChanged) return;
    Promise.resolve(onWalletChanged(payload)).catch(() => undefined);
  }

  async function getWalletByProfileId(profileId, atMs) {
    await initPromise;
    return ensureWallet(db, profileId, toSafeInt(atMs != null ? atMs : now(), 0));
  }

  async function resolveUnifiedStateByRequest(req, input) {
    const body = input && typeof input === "object" ? input : {};
    const profileId = asText(computeProfileId(req, body), 180);
    if (!profileId) {
      return { ok: false, error: "profile_id_required", message: "profile_id_required" };
    }

    await initPromise;
    const serverNowMs = toSafeInt(now(), 0);
    const giftState = await readGiftState(db, profileId, serverNowMs);
    const wallet = giftState.wallet;
    const popTalkRaw = resolvePopTalkSnapshot ? resolvePopTalkSnapshot(req, body, profileId) : null;

    return buildUnifiedStatePayload({
      profileId,
      serverNowMs,
      wallet,
      popTalk: popTalkRaw,
      giftState,
    });
  }

  async function resolveExistingByTransaction(transactionId, profileId, atMs) {
    const existing = await getAsync(
      db,
      "SELECT transaction_id, first_purchase_bonus_applied, granted_amount FROM shop_purchase_events WHERE transaction_id = ? LIMIT 1",
      [transactionId]
    );
    if (!existing) return null;

    const wallet = await ensureWallet(db, profileId, atMs);
    return buildConfirmPayload({
      duplicate: true,
      firstPurchaseBonusApplied: Number(existing.first_purchase_bonus_applied) === 1,
      grantedAmount: toSafeInt(existing.granted_amount, 0),
      wallet,
    });
  }

  async function resolveExistingKernelConvert(profileId, idempotencyKey) {
    const pid = asText(profileId, 180);
    const idem = sanitizeText(idempotencyKey, 200);
    if (!pid || !idem) return null;
    const existing = await getAsync(
      db,
      `SELECT
        kernel_spent,
        multiplier,
        converted_poptalk,
        poptalk_balance,
        poptalk_cap,
        poptalk_plan,
        poptalk_server_now_ms,
        wallet_kernel_balance
      FROM shop_kernel_convert_events
      WHERE profile_id = ? AND idempotency_key = ?
      LIMIT 1`,
      [pid, idem]
    );
    if (!existing) return null;
    return buildKernelConvertPayload({
      duplicate: true,
      kernelSpent: existing.kernel_spent,
      multiplier: Number(existing.multiplier),
      convertedPopTalk: existing.converted_poptalk,
      popTalk: {
        balance: existing.poptalk_balance,
        cap: existing.poptalk_cap,
        plan: existing.poptalk_plan,
        serverNowMs: existing.poptalk_server_now_ms,
      },
      walletKernelBalance: existing.wallet_kernel_balance,
    });
  }

  async function resolveExistingGiftAction(profileId, actionType, actionKey, atMs) {
    const pid = asText(profileId, 180);
    const type = asText(actionType, 24).toLowerCase();
    const key = sanitizeText(actionKey, 200);
    if (!pid || !type || !key) return null;
    const row = await getAsync(
      db,
      "SELECT id FROM shop_gift_action_events WHERE profile_id = ? AND action_type = ? AND action_key = ? LIMIT 1",
      [pid, type, key]
    );
    if (!row) return null;
    const state = await readGiftState(db, pid, atMs);
    return buildGiftStatePayload(state);
  }

  function parseGiftMutationBody(bodyRaw) {
    const body = bodyRaw && typeof bodyRaw === "object" ? bodyRaw : {};
    return {
      giftId: sanitizeText(body.giftId || body.id || "", 120),
      count: parseGiftCount(body.count ?? body.qty ?? body.quantity ?? body.amount, 1),
      costKernel: toSafeInt(body.costKernel ?? body.kernelCost ?? body.unitKernelCost ?? body.cost ?? 0, 0, 1000000000),
      idempotencyKey: sanitizeText(body.idempotencyKey || body.deliveryId || body.eventId || "", 200),
      deliveryId: sanitizeText(body.deliveryId || body.eventId || body.idempotencyKey || "", 200),
      receiverProfileId: sanitizeText(body.receiverProfileId || body.toProfileId || "", 180),
    };
  }

  function parseGiftExchangeItems(bodyRaw) {
    const body = bodyRaw && typeof bodyRaw === "object" ? bodyRaw : {};
    const rawItems = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body.exchangeItems)
        ? body.exchangeItems
        : null;

    const fallbackSingle = {
      giftId: sanitizeText(body.giftId || body.id || "", 120),
      count: parseGiftCount(body.count ?? body.qty ?? body.quantity ?? body.amount, 1),
      costKernel: toSafeInt(body.costKernel ?? body.kernelCost ?? body.unitKernelCost ?? body.cost ?? 0, 0, 1000000000),
    };

    const rows = rawItems && rawItems.length > 0 ? rawItems : [fallbackSingle];
    const out = [];
    for (const row of rows) {
      const item = row && typeof row === "object" ? row : {};
      const giftId = sanitizeText(item.giftId || item.id || "", 120);
      const count = parseGiftCount(item.count ?? item.qty ?? item.quantity ?? item.amount, 1);
      const costKernel = toSafeInt(item.costKernel ?? item.kernelCost ?? item.unitKernelCost ?? item.cost ?? 0, 0, 1000000000);
      if (!giftId || count <= 0 || costKernel <= 0) continue;
      out.push({ giftId, count, costKernel });
    }
    return out;
  }

  async function giftStateHandler(req, res) {
    const input = { ...(req.query || {}), ...(req.body || {}) };
    const profileId = asText(computeProfileId(req, input), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }
    try {
      await initPromise;
      const state = await readGiftState(db, profileId, toSafeInt(now(), 0));
      return res.status(200).json(buildGiftStatePayload(state));
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "gift_state_failed",
        message: String((e && e.message) || e || "gift_state_failed"),
      });
    }
  }

  async function giftPurchaseHandler(req, res) {
    const bodyRaw = req.body && typeof req.body === "object" ? req.body : {};
    const profileId = asText(computeProfileId(req, bodyRaw), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }

    const body = parseGiftMutationBody(bodyRaw);
    if (!body.giftId || body.costKernel <= 0 || body.count <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_input", message: "invalid_input" });
    }
    const nowMs = toSafeInt(now(), 0);
    const totalCost = toSafeInt(body.costKernel * body.count, 0, 2000000000);

    try {
      await initPromise;
      await runAsync(db, "BEGIN IMMEDIATE", []);
      try {
        if (body.idempotencyKey) {
          const existing = await resolveExistingGiftAction(profileId, "purchase", body.idempotencyKey, nowMs);
          if (existing) {
            await runAsync(db, "COMMIT", []);
            return res.status(200).json(existing);
          }
        }

        const wallet = await ensureWallet(db, profileId, nowMs);
        if (wallet.kernelBalance < totalCost) {
          const state = await readGiftState(db, profileId, nowMs);
          await runAsync(db, "ROLLBACK", []);
          return res.status(409).json({
            ...buildGiftStatePayload(state),
            ok: false,
            error: "INSUFFICIENT_KERNEL",
            code: "INSUFFICIENT_KERNEL",
            message: "INSUFFICIENT_KERNEL",
          });
        }

        const row = await ensureGiftRow(db, profileId, body.giftId, nowMs);
        const nextOwned = toSafeInt(row.ownedCount + body.count, 0, 1000000000);
        const nextKernel = toSafeInt(wallet.kernelBalance - totalCost, 0, 2000000000);

        await runAsync(
          db,
          "UPDATE shop_gift_inventory SET owned_count = ?, updated_at = ? WHERE profile_id = ? AND gift_id = ?",
          [nextOwned, nowMs, profileId, body.giftId]
        );
        await runAsync(
          db,
          "UPDATE shop_wallets SET kernel_balance = ?, updated_at = ? WHERE profile_id = ?",
          [nextKernel, nowMs, profileId]
        );
        if (body.idempotencyKey) {
          await runAsync(
            db,
            `INSERT INTO shop_gift_action_events (
              profile_id, action_type, action_key, gift_id, count, peer_profile_id, wallet_kernel_balance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [profileId, "purchase", body.idempotencyKey, body.giftId, body.count, "", nextKernel, nowMs]
          );
        }

        await runAsync(db, "COMMIT", []);
        const state = await readGiftState(db, profileId, nowMs);
        emitWalletChanged({
          profileId,
          req,
          body: bodyRaw,
          wallet: {
            kernelBalance: nextKernel,
          },
          reason: "gift_purchased",
        });
        return res.status(200).json(buildGiftStatePayload(state));
      } catch (innerErr) {
        try {
          await runAsync(db, "ROLLBACK", []);
        } catch {}
        if (body.idempotencyKey) {
          const existing = await resolveExistingGiftAction(profileId, "purchase", body.idempotencyKey, nowMs);
          if (existing) return res.status(200).json(existing);
        }
        throw innerErr;
      }
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "gift_purchase_failed",
        message: String((e && e.message) || e || "gift_purchase_failed"),
      });
    }
  }

  async function giftSendHandler(req, res) {
    const bodyRaw = req.body && typeof req.body === "object" ? req.body : {};
    const profileId = asText(computeProfileId(req, bodyRaw), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }
    const body = parseGiftMutationBody(bodyRaw);
    const actionKey = body.idempotencyKey || body.deliveryId;
    if (!body.giftId || body.count <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_input", message: "invalid_input" });
    }
    const nowMs = toSafeInt(now(), 0);

    try {
      await initPromise;
      await runAsync(db, "BEGIN IMMEDIATE", []);
      try {
        if (actionKey) {
          const existing = await resolveExistingGiftAction(profileId, "send", actionKey, nowMs);
          if (existing) {
            await runAsync(db, "COMMIT", []);
            return res.status(200).json(existing);
          }
        }

        const row = await ensureGiftRow(db, profileId, body.giftId, nowMs);
        if (row.ownedCount < body.count) {
          const state = await readGiftState(db, profileId, nowMs);
          await runAsync(db, "ROLLBACK", []);
          return res.status(409).json({
            ...buildGiftStatePayload(state),
            ok: false,
            error: "INSUFFICIENT_GIFT",
            code: "INSUFFICIENT_GIFT",
            message: "INSUFFICIENT_GIFT",
          });
        }

        const nextOwned = toSafeInt(row.ownedCount - body.count, 0, 1000000000);
        const wallet = await ensureWallet(db, profileId, nowMs);
        await runAsync(
          db,
          "UPDATE shop_gift_inventory SET owned_count = ?, updated_at = ? WHERE profile_id = ? AND gift_id = ?",
          [nextOwned, nowMs, profileId, body.giftId]
        );
        if (actionKey) {
          await runAsync(
            db,
            `INSERT INTO shop_gift_action_events (
              profile_id, action_type, action_key, gift_id, count, peer_profile_id, wallet_kernel_balance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [profileId, "send", actionKey, body.giftId, body.count, body.receiverProfileId || "", wallet.kernelBalance, nowMs]
          );
        }

        await runAsync(db, "COMMIT", []);
        const state = await readGiftState(db, profileId, nowMs);
        emitWalletChanged({
          profileId,
          req,
          body: bodyRaw,
          wallet: {
            kernelBalance: wallet.kernelBalance,
          },
          reason: "gift_sent",
        });
        return res.status(200).json(buildGiftStatePayload(state));
      } catch (innerErr) {
        try {
          await runAsync(db, "ROLLBACK", []);
        } catch {}
        if (actionKey) {
          const existing = await resolveExistingGiftAction(profileId, "send", actionKey, nowMs);
          if (existing) return res.status(200).json(existing);
        }
        throw innerErr;
      }
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "gift_send_failed",
        message: String((e && e.message) || e || "gift_send_failed"),
      });
    }
  }

  async function giftReceiveHandler(req, res) {
    const bodyRaw = req.body && typeof req.body === "object" ? req.body : {};
    const profileId = asText(computeProfileId(req, bodyRaw), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }
    const body = parseGiftMutationBody(bodyRaw);
    const actionKey = body.idempotencyKey || body.deliveryId;
    if (!body.giftId || body.count <= 0 || !actionKey) {
      return res.status(400).json({ ok: false, error: "invalid_input", message: "invalid_input" });
    }
    const nowMs = toSafeInt(now(), 0);

    try {
      await initPromise;
      await runAsync(db, "BEGIN IMMEDIATE", []);
      try {
        const existing = await resolveExistingGiftAction(profileId, "receive", actionKey, nowMs);
        if (existing) {
          await runAsync(db, "COMMIT", []);
          return res.status(200).json(existing);
        }

        const row = await ensureGiftRow(db, profileId, body.giftId, nowMs);
        const nextReceived = toSafeInt(row.receivedCount + body.count, 0, 1000000000);
        const wallet = await ensureWallet(db, profileId, nowMs);

        await runAsync(
          db,
          "UPDATE shop_gift_inventory SET received_count = ?, updated_at = ? WHERE profile_id = ? AND gift_id = ?",
          [nextReceived, nowMs, profileId, body.giftId]
        );
        await runAsync(
          db,
          `INSERT INTO shop_gift_action_events (
            profile_id, action_type, action_key, gift_id, count, peer_profile_id, wallet_kernel_balance, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [profileId, "receive", actionKey, body.giftId, body.count, "", wallet.kernelBalance, nowMs]
        );

        await runAsync(db, "COMMIT", []);
        const state = await readGiftState(db, profileId, nowMs);
        emitWalletChanged({
          profileId,
          req,
          body: bodyRaw,
          wallet: {
            kernelBalance: wallet.kernelBalance,
          },
          reason: "gift_received",
        });
        return res.status(200).json(buildGiftStatePayload(state));
      } catch (innerErr) {
        try {
          await runAsync(db, "ROLLBACK", []);
        } catch {}
        if (actionKey) {
          const existing = await resolveExistingGiftAction(profileId, "receive", actionKey, nowMs);
          if (existing) return res.status(200).json(existing);
        }
        throw innerErr;
      }
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "gift_receive_failed",
        message: String((e && e.message) || e || "gift_receive_failed"),
      });
    }
  }

  async function giftExchangeHandler(req, res) {
    const bodyRaw = req.body && typeof req.body === "object" ? req.body : {};
    const profileId = asText(computeProfileId(req, bodyRaw), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }

    const items = parseGiftExchangeItems(bodyRaw);
    const actionKey = sanitizeText(bodyRaw.idempotencyKey || bodyRaw.deliveryId || bodyRaw.eventId || "", 200);
    if (items.length <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_input", message: "invalid_input" });
    }
    const nowMs = toSafeInt(now(), 0);

    try {
      await initPromise;
      await runAsync(db, "BEGIN IMMEDIATE", []);
      try {
        if (actionKey) {
          const existing = await resolveExistingGiftAction(profileId, "exchange", actionKey, nowMs);
          if (existing) {
            await runAsync(db, "COMMIT", []);
            return res.status(200).json(existing);
          }
        }

        const wallet = await ensureWallet(db, profileId, nowMs);
        const rowsByGiftId = {};
        let totalKernelBack = 0;
        let totalCount = 0;

        for (const item of items) {
          const row = await ensureGiftRow(db, profileId, item.giftId, nowMs);
          if (row.receivedCount < item.count) {
            const state = await readGiftState(db, profileId, nowMs);
            await runAsync(db, "ROLLBACK", []);
            return res.status(409).json({
              ...buildGiftStatePayload(state),
              ok: false,
              error: "INSUFFICIENT_RECEIVED_GIFT",
              code: "INSUFFICIENT_RECEIVED_GIFT",
              message: "INSUFFICIENT_RECEIVED_GIFT",
            });
          }
          rowsByGiftId[item.giftId] = row;
          const unitRefund = toSafeInt(Math.floor(item.costKernel * 0.8), 0, 1000000000);
          const lineRefund = toSafeInt(unitRefund * item.count, 0, 2000000000);
          totalKernelBack = toSafeInt(totalKernelBack + lineRefund, 0, 2000000000);
          totalCount = toSafeInt(totalCount + item.count, 0, 1000000000);
        }

        for (const item of items) {
          const row = rowsByGiftId[item.giftId] || (await ensureGiftRow(db, profileId, item.giftId, nowMs));
          const nextReceived = toSafeInt(row.receivedCount - item.count, 0, 1000000000);
          await runAsync(
            db,
            "UPDATE shop_gift_inventory SET received_count = ?, updated_at = ? WHERE profile_id = ? AND gift_id = ?",
            [nextReceived, nowMs, profileId, item.giftId]
          );
        }

        const nextKernel = toSafeInt(wallet.kernelBalance + totalKernelBack, 0, 2000000000);
        await runAsync(
          db,
          "UPDATE shop_wallets SET kernel_balance = ?, updated_at = ? WHERE profile_id = ?",
          [nextKernel, nowMs, profileId]
        );

        if (actionKey) {
          await runAsync(
            db,
            `INSERT INTO shop_gift_action_events (
              profile_id, action_type, action_key, gift_id, count, peer_profile_id, wallet_kernel_balance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [profileId, "exchange", actionKey, "__multi__", totalCount, "", nextKernel, nowMs]
          );
        }

        await runAsync(db, "COMMIT", []);
        const state = await readGiftState(db, profileId, nowMs);
        emitWalletChanged({
          profileId,
          req,
          body: bodyRaw,
          wallet: {
            kernelBalance: nextKernel,
          },
          reason: "gift_exchanged",
        });

        return res.status(200).json({
          ...buildGiftStatePayload(state),
          exchangedKernel: totalKernelBack,
        });
      } catch (innerErr) {
        try {
          await runAsync(db, "ROLLBACK", []);
        } catch {}
        if (actionKey) {
          const existing = await resolveExistingGiftAction(profileId, "exchange", actionKey, nowMs);
          if (existing) return res.status(200).json(existing);
        }
        throw innerErr;
      }
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "gift_exchange_failed",
        message: String((e && e.message) || e || "gift_exchange_failed"),
      });
    }
  }

  async function confirmHandler(req, res) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const profileId = asText(computeProfileId(req, body), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }

    const kindRaw = asText(body.kind, 16).toLowerCase();
    const kind = kindRaw === "kernel" ? "kernel" : "popcorn";
    const packId = sanitizeText(body.packId, 80);
    const productId = sanitizeText(body.productId, 160);
    const transactionId = sanitizeText(body.transactionId, 200);
    const amount = toSafeInt(body.amount, 0, 1000000000);
    const bonusAmount = toSafeInt(body.bonusAmount, 0, 1000000000);
    const priceKrw = toSafeInt(body.priceKrw, 0, 1000000000);
    const purchaseDate = sanitizeText(body.purchaseDate, 80);
    const rcAppUserId = sanitizeText(body.rcAppUserId, 128);
    const platform = sanitizeText(body.platform, 24);
    const userId = sanitizeText(body.userId || req.headers["x-user-id"] || "", 128);
    const deviceKey = sanitizeText(body.deviceKey || req.headers["x-device-key"] || "", 256);
    const idempotencyKey = sanitizeText(body.idempotencyKey || req.headers["x-idempotency-key"] || "", 200);
    const isUnlimited1m = kind === "popcorn" && packId === SHOP_POP_UNLIMITED_1M_PACK_ID;

    if (!packId || !productId || !transactionId || (!isUnlimited1m && amount <= 0)) {
      return res.status(400).json({ ok: false, error: "invalid_input", message: "invalid_input" });
    }

    const token = asText(parseBearer(req), 4096);
    const tokenHash = token ? anonymizeKey(token) : "";
    const deviceHash = deviceKey ? anonymizeKey(deviceKey) : "";
    const nowMs = toSafeInt(now(), 0);

    try {
      await initPromise;
      await runAsync(db, "BEGIN IMMEDIATE", []);

      try {
        const existingPayload = await resolveExistingByTransaction(transactionId, profileId, nowMs);
        if (existingPayload) {
          await runAsync(db, "COMMIT", []);
          return res.status(200).json(existingPayload);
        }

        const claimed = await getAsync(
          db,
          "SELECT claimed_at FROM shop_first_purchase_claims WHERE profile_id = ? AND pack_id = ? LIMIT 1",
          [profileId, packId]
        );

        const firstPurchaseBonusApplied = kind === "popcorn" && !isUnlimited1m && !claimed && bonusAmount > 0;
        const grantedAmount = isUnlimited1m ? 0 : amount + (firstPurchaseBonusApplied ? bonusAmount : 0);

        const currentWallet = await ensureWallet(db, profileId, nowMs);
        const nextPopcorn = kind === "popcorn" ? currentWallet.popcornBalance + grantedAmount : currentWallet.popcornBalance;
        const nextKernel = kind === "kernel" ? currentWallet.kernelBalance + grantedAmount : currentWallet.kernelBalance;

        await runAsync(
          db,
          "UPDATE shop_wallets SET popcorn_balance = ?, kernel_balance = ?, updated_at = ? WHERE profile_id = ?",
          [nextPopcorn, nextKernel, nowMs, profileId]
        );

        if (firstPurchaseBonusApplied) {
          await runAsync(
            db,
            "INSERT OR IGNORE INTO shop_first_purchase_claims (profile_id, pack_id, claimed_at) VALUES (?, ?, ?)",
            [profileId, packId, nowMs]
          );
        }

        await runAsync(
          db,
          `INSERT INTO shop_purchase_events (
            transaction_id,
            profile_id,
            user_id,
            kind,
            pack_id,
            product_id,
            amount,
            bonus_amount,
            granted_amount,
            first_purchase_bonus_applied,
            price_krw,
            platform,
            purchase_date,
            rc_app_user_id,
            token_hash,
            device_hash,
            idempotency_key,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            transactionId,
            profileId,
            userId,
            kind,
            packId,
            productId,
            amount,
            bonusAmount,
            grantedAmount,
            firstPurchaseBonusApplied ? 1 : 0,
            priceKrw,
            platform,
            purchaseDate,
            rcAppUserId,
            tokenHash,
            deviceHash,
            idempotencyKey,
            nowMs,
          ]
        );

        await runAsync(db, "COMMIT", []);

        let popTalkSnapshot = null;
        if (kind === "popcorn" && typeof applyKernelToPopTalk === "function") {
          try {
            const applyOut = await Promise.resolve(
              applyKernelToPopTalk({
                req,
                body,
                profileId,
                convertedPopTalk: grantedAmount,
                popTalkPlanOverride: isUnlimited1m ? "monthly" : "",
                unlimitedUntilMs: isUnlimited1m ? nowMs + POP_UNLIMITED_1M_MS : 0,
                reason: "shop_purchase_popcorn",
                source: "shop_purchase",
                atMs: nowMs,
              })
            );
            popTalkSnapshot = normalizePopTalkSnapshot(
              (applyOut && (applyOut.popTalk || applyOut.snapshot || (applyOut.data && applyOut.data.popTalk))) || null
            );
          } catch {
            popTalkSnapshot = null;
          }
        }

        if (!popTalkSnapshot && typeof resolvePopTalkSnapshot === "function") {
          popTalkSnapshot = normalizePopTalkSnapshot(resolvePopTalkSnapshot(req, body, profileId));
        }

        const result = buildConfirmPayload({
          duplicate: false,
          firstPurchaseBonusApplied,
          grantedAmount,
          popTalk: popTalkSnapshot,
          wallet: {
            popcornBalance: nextPopcorn,
            kernelBalance: nextKernel,
          },
        });

        emitWalletChanged({
          profileId,
          req,
          body,
          wallet: result.wallet,
          reason: "shop_purchase_confirmed",
        });

        return res.status(200).json(result);
      } catch (innerErr) {
        try {
          await runAsync(db, "ROLLBACK", []);
        } catch {}

        if (isUniqueTxError(innerErr)) {
          const existingPayload = await resolveExistingByTransaction(transactionId, profileId, nowMs);
          if (existingPayload) {
            return res.status(200).json(existingPayload);
          }
        }

        throw innerErr;
      }
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "shop_confirm_failed",
        message: String((e && e.message) || e || "shop_confirm_failed"),
      });
    }
  }

  async function walletHandler(req, res) {
    const input = { ...(req.query || {}), ...(req.body || {}) };
    const profileId = asText(computeProfileId(req, input), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }

    try {
      await initPromise;
      const wallet = await ensureWallet(db, profileId, toSafeInt(now(), 0));
      return res.status(200).json({ ok: true, wallet });
    } catch (e) {
      return res.status(500).json({ ok: false, error: "shop_wallet_failed", message: String((e && e.message) || e) });
    }
  }

  async function unifiedStateHandler(req, res) {
    try {
      const input = { ...(req.query || {}), ...(req.body || {}) };
      const out = await resolveUnifiedStateByRequest(req, input);
      if (!out || !out.ok) {
        return res.status(400).json({ ok: false, error: out && out.error ? out.error : "profile_id_required", message: out && out.message ? out.message : "profile_id_required" });
      }
      return res.status(200).json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: "wallet_state_failed", message: String((e && e.message) || e) });
    }
  }

  async function kernelConvertHandler(req, res) {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const profileId = asText(computeProfileId(req, body), 180);
    if (!profileId) {
      return res.status(400).json({ ok: false, error: "profile_id_required", message: "profile_id_required" });
    }
    if (!applyKernelToPopTalk) {
      return res.status(500).json({ ok: false, error: "kernel_convert_not_configured", message: "kernel_convert_not_configured" });
    }

    const kernelAmount = parseKernelConvertAmount(body);
    if (kernelAmount <= 0) {
      return res.status(400).json({ ok: false, error: "invalid_kernel_amount", message: "invalid_kernel_amount" });
    }

    const idempotencyKey = sanitizeText(body.idempotencyKey || req.headers["x-idempotency-key"] || "", 200);
    const nowMs = toSafeInt(now(), 0);

    try {
      await initPromise;
      await runAsync(db, "BEGIN IMMEDIATE", []);
      try {
        if (idempotencyKey) {
          const existing = await resolveExistingKernelConvert(profileId, idempotencyKey);
          if (existing) {
            await runAsync(db, "COMMIT", []);
            return res.status(200).json(existing);
          }
        }

        const currentWallet = await ensureWallet(db, profileId, nowMs);
        if (currentWallet.kernelBalance < kernelAmount) {
          const popTalkRaw = resolvePopTalkSnapshot ? resolvePopTalkSnapshot(req, body, profileId) : null;
          await runAsync(db, "ROLLBACK", []);
          return res.status(409).json({
            ok: false,
            code: "INSUFFICIENT_KERNEL",
            message: "INSUFFICIENT_KERNEL",
            popTalk: normalizePopTalkSnapshot(popTalkRaw),
            wallet: {
              kernelBalance: toSafeInt(currentWallet.kernelBalance, 0),
            },
          });
        }

        const multiplier = drawKernelConvertMultiplier();
        const convertedPopTalk = toSafeInt(Math.floor(kernelAmount * multiplier), 0, 2000000000);
        const nextKernel = toSafeInt(currentWallet.kernelBalance - kernelAmount, 0);

        await runAsync(
          db,
          "UPDATE shop_wallets SET kernel_balance = ?, updated_at = ? WHERE profile_id = ?",
          [nextKernel, nowMs, profileId]
        );

        const applyOut = await Promise.resolve(
          applyKernelToPopTalk({
            req,
            body,
            profileId,
            kernelSpent: kernelAmount,
            convertedPopTalk,
            multiplier,
            idempotencyKey,
            atMs: nowMs,
          })
        );

        const popTalkSnapshot = normalizePopTalkSnapshot(
          (applyOut && (applyOut.popTalk || applyOut.snapshot || (applyOut.data && applyOut.data.popTalk))) || null
        );
        if (!popTalkSnapshot) {
          throw new Error("kernel_convert_poptalk_apply_failed");
        }

        if (idempotencyKey) {
          await runAsync(
            db,
            `INSERT INTO shop_kernel_convert_events (
              profile_id,
              idempotency_key,
              kernel_spent,
              multiplier,
              converted_poptalk,
              poptalk_balance,
              poptalk_cap,
              poptalk_plan,
              poptalk_server_now_ms,
              wallet_kernel_balance,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              profileId,
              idempotencyKey,
              kernelAmount,
              multiplier,
              convertedPopTalk,
              toSafeInt(popTalkSnapshot.balance, 0),
              toSafeInt(popTalkSnapshot.cap, 0),
              asText(popTalkSnapshot.plan, 32),
              toSafeInt(popTalkSnapshot.serverNowMs, 0),
              nextKernel,
              nowMs,
            ]
          );
        }

        await runAsync(db, "COMMIT", []);

        const payload = buildKernelConvertPayload({
          duplicate: false,
          kernelSpent: kernelAmount,
          multiplier,
          convertedPopTalk,
          popTalk: popTalkSnapshot,
          walletKernelBalance: nextKernel,
        });

        emitWalletChanged({
          profileId,
          req,
          body,
          wallet: {
            kernelBalance: nextKernel,
          },
          reason: "kernel_to_poptalk_converted",
        });

        return res.status(200).json(payload);
      } catch (innerErr) {
        try {
          await runAsync(db, "ROLLBACK", []);
        } catch {}

        if (idempotencyKey) {
          const existing = await resolveExistingKernelConvert(profileId, idempotencyKey);
          if (existing) return res.status(200).json(existing);
        }
        throw innerErr;
      }
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: "kernel_convert_failed",
        message: String((e && e.message) || e || "kernel_convert_failed"),
      });
    }
  }

  ["/api/shop/purchase/confirm", "/shop/purchase/confirm"].forEach((p) => {
    app.post(p, confirmHandler);
  });

  ["/api/shop/wallet", "/shop/wallet"].forEach((p) => {
    app.get(p, walletHandler);
    app.post(p, walletHandler);
  });

  [
    "/api/shop/gifts/state",
    "/shop/gifts/state",
    "/api/shop/gift/state",
    "/shop/gift/state",
    "/api/shop/gifts",
    "/shop/gifts",
    "/api/shop/gift",
    "/shop/gift",
  ].forEach((p) => {
    app.get(p, giftStateHandler);
    app.post(p, giftStateHandler);
  });

  [
    "/api/shop/gift/purchase",
    "/shop/gift/purchase",
    "/api/shop/gifts/purchase",
    "/shop/gifts/purchase",
    "/api/shop/gift/buy",
    "/shop/gift/buy",
    "/api/shop/gifts/buy",
    "/shop/gifts/buy",
    "/api/gift/purchase",
    "/gift/purchase",
    "/api/gifts/purchase",
    "/gifts/purchase",
  ].forEach((p) => {
    app.post(p, giftPurchaseHandler);
  });

  [
    "/api/shop/gift/send",
    "/shop/gift/send",
    "/api/shop/gifts/send",
    "/shop/gifts/send",
    "/api/gift/send",
    "/gift/send",
    "/api/gifts/send",
    "/gifts/send",
    "/api/shop/gift/send-call",
    "/shop/gift/send-call",
    "/api/shop/gift/transfer",
    "/shop/gift/transfer",
  ].forEach((p) => {
    app.post(p, giftSendHandler);
  });

  [
    "/api/shop/gift/receive",
    "/shop/gift/receive",
    "/api/shop/gifts/receive",
    "/shop/gifts/receive",
    "/api/gift/receive",
    "/gift/receive",
    "/api/gifts/receive",
    "/gifts/receive",
    "/api/shop/gift/receive-call",
    "/shop/gift/receive-call",
  ].forEach((p) => {
    app.post(p, giftReceiveHandler);
  });

  [
    "/api/shop/gift/exchange",
    "/shop/gift/exchange",
    "/api/shop/gifts/exchange",
    "/shop/gifts/exchange",
    "/api/gift/exchange",
    "/gift/exchange",
    "/api/gifts/exchange",
    "/gifts/exchange",
    "/api/shop/gift/redeem",
    "/shop/gift/redeem",
  ].forEach((p) => {
    app.post(p, giftExchangeHandler);
  });

  ["/api/wallet/state", "/wallet/state", "/api/state/wallet"].forEach((p) => {
    app.get(p, unifiedStateHandler);
    app.post(p, unifiedStateHandler);
  });

  [
    "/api/poptalk/kernel-convert",
    "/api/poptalk/convert-kernel",
    "/api/poptalk/kernel/convert",
    "/api/poptalk/convert",
    "/poptalk/kernel-convert",
    "/poptalk/convert-kernel",
    "/poptalk/convert",
    "/api/wallet/convert-kernel",
    "/wallet/convert-kernel",
    "/api/wallet/kernel-convert",
    "/wallet/kernel-convert",
    "/api/wallet/kernel-to-poptalk",
    "/wallet/kernel-to-poptalk",
    "/api/popm/convert",
    "/popm/convert",
  ].forEach((p) => {
    app.post(p, kernelConvertHandler);
  });

  return {
    getWalletByProfileId,
    resolveUnifiedStateByRequest,
  };
}

module.exports = {
  mountShopPurchaseRoutes,
};
