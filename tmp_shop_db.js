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
  return {
    ok: true,
    profileId: asText(input.profileId, 180),
    serverNowMs: toSafeInt(input.serverNowMs, 0),
    popTalk: normalizePopTalkSnapshot(input.popTalk),
    wallet: {
      popcornBalance: toSafeInt(input.wallet && input.wallet.popcornBalance, 0),
      kernelBalance: toSafeInt(input.wallet && input.wallet.kernelBalance, 0),
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
    const wallet = await ensureWallet(db, profileId, serverNowMs);
    const popTalkRaw = resolvePopTalkSnapshot ? resolvePopTalkSnapshot(req, body, profileId) : null;

    return buildUnifiedStatePayload({
      profileId,
      serverNowMs,
      wallet,
      popTalk: popTalkRaw,
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

    if (!packId || !productId || !transactionId || amount <= 0) {
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

        const firstPurchaseBonusApplied = !claimed && bonusAmount > 0;
        const grantedAmount = amount + (firstPurchaseBonusApplied ? bonusAmount : 0);

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
