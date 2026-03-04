import { Platform } from "react-native";
import { APP_CONFIG } from "../../config/app";

export type ConfirmShopPurchaseInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  kind: "popcorn" | "kernel";
  packId: string;
  productId: string;
  amount: number;
  bonusAmount: number;
  priceKrw: number;
  transactionId: string;
  purchaseDate?: string | null;
  rcAppUserId?: string | null;
  idempotencyKey?: string | null;
  planOverride?: "monthly" | null;
  planDurationDays?: number | null;
};

export type ConfirmShopPurchaseResult = {
  ok: boolean;
  firstPurchaseBonusApplied: boolean;
  grantedAmount: number;
  duplicate: boolean;
  popTalkBalance?: number;
  popTalkCap?: number;
  popTalkPlan?: string | null;
  popTalkServerNowMs?: number | null;
  walletKernel: number;
  errorCode: string;
  errorMessage: string;
};

export type ShopWalletFetchInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
};

export type ShopWalletFetchResult = {
  ok: boolean;
  popTalkBalance: number;
  walletKernel: number;
  errorCode: string;
  errorMessage: string;
};

export type UnifiedWalletStateResult = {
  ok: boolean;
  popTalkBalance: number;
  popTalkCap: number;
  popTalkPlan: string | null;
  popTalkServerNowMs: number | null;
  walletKernel: number;
  giftStateFound?: boolean;
  giftsOwned?: Record<string, number>;
  giftsReceived?: Record<string, number>;
  errorCode: string;
  errorMessage: string;
};

export type UnifiedWalletStateInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  planId?: string | null;
  storeProductId?: string | null;
  isPremium?: boolean | null;
};

export type ConvertKernelToPopTalkInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  kernelAmount: number;
  idempotencyKey?: string | null;
};

export type ConvertKernelToPopTalkResult = {
  ok: boolean;
  kernelSpent: number;
  multiplier: number;
  convertedPopTalk: number;
  popTalkBalance: number;
  popTalkCap: number;
  popTalkPlan: string | null;
  popTalkServerNowMs: number | null;
  walletKernel: number;
  errorCode: string;
  errorMessage: string;
};

export type ShopFirstPurchaseClaimsInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
};

export type ShopFirstPurchaseClaimsResult = {
  ok: boolean;
  claimed: Record<string, boolean>;
  errorCode: string;
  errorMessage: string;
};

export type ShopGiftInventoryInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
};

export type ShopGiftInventoryResult = {
  ok: boolean;
  giftStateFound: boolean;
  giftsOwned: Record<string, number>;
  giftsReceived: Record<string, number>;
  walletKernel: number;
  errorCode: string;
  errorMessage: string;
};

export type PurchaseGiftWithKernelInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  giftId: string;
  costKernel: number;
  count?: number;
  idempotencyKey?: string | null;
};

export type PurchaseGiftWithKernelResult = {
  ok: boolean;
  giftStateFound: boolean;
  giftsOwned: Record<string, number>;
  giftsReceived: Record<string, number>;
  walletKernel: number;
  errorCode: string;
  errorMessage: string;
};

export type SendGiftOnServerInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  giftId: string;
  count?: number;
  deliveryId?: string | null;
  idempotencyKey?: string | null;
};

export type ReceiveGiftOnServerInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  giftId: string;
  count?: number;
  deliveryId?: string | null;
  idempotencyKey?: string | null;
};

export type GiftTransferResult = {
  ok: boolean;
  giftStateFound: boolean;
  giftsOwned: Record<string, number>;
  giftsReceived: Record<string, number>;
  walletKernel: number;
  errorCode: string;
  errorMessage: string;
};

export type ExchangeReceivedGiftItemInput = {
  giftId: string;
  count?: number;
  costKernel: number;
};

export type ExchangeReceivedGiftsInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  items: ExchangeReceivedGiftItemInput[];
  idempotencyKey?: string | null;
};

export type ExchangeReceivedGiftsResult = {
  ok: boolean;
  exchangedKernel: number;
  giftStateFound: boolean;
  giftsOwned: Record<string, number>;
  giftsReceived: Record<string, number>;
  walletKernel: number;
  errorCode: string;
  errorMessage: string;
};

function asText(v: unknown, maxLen = 256): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function asInt(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function normalizeHttpsBase(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s.replace(/\/+$/, "");
  if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
  if (/^wss:\/\//i.test(s)) return s.replace(/^wss:\/\//i, "https://").replace(/\/+$/, "");
  if (/^ws:\/\//i.test(s)) return s.replace(/^ws:\/\//i, "https://").replace(/\/+$/, "");
  return `https://${s.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function httpsBaseFromWs(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    return `https://${u.host}`;
  } catch {
    return "";
  }
}

function resolveBases(): string[] {
  const out = [
    String((APP_CONFIG as any)?.POPTALK?.httpBaseUrl || ""),
    String(APP_CONFIG.AUTH_HTTP_BASE_URL || ""),
    httpsBaseFromWs(String(APP_CONFIG.SIGNALING_URL || "")),
  ]
    .map((v) => normalizeHttpsBase(v))
    .filter((v) => v.length > 0);
  return Array.from(new Set(out));
}

function normalizePath(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

function parseConfirmResult(raw: any): ConfirmShopPurchaseResult {
  const root = raw?.data ?? raw ?? {};
  const wallet = root?.wallet ?? raw?.wallet ?? {};
  const popTalkObj =
    (root?.popTalk && typeof root?.popTalk === "object" ? root.popTalk : null) ||
    (raw?.popTalk && typeof raw?.popTalk === "object" ? raw.popTalk : null) ||
    (root?.poptalk && typeof root?.poptalk === "object" ? root.poptalk : null) ||
    (raw?.poptalk && typeof raw?.poptalk === "object" ? raw.poptalk : null);
  const popBalance = asInt(
    popTalkObj?.balance ??
      popTalkObj?.remaining ??
      popTalkObj?.remain ??
      root?.popTalkBalance ??
      raw?.popTalkBalance ??
      root?.poptalkBalance ??
      raw?.poptalkBalance
  );
  const popCapRaw = asInt(
    popTalkObj?.cap ??
      popTalkObj?.max ??
      popTalkObj?.maxBalance ??
      root?.popTalkCap ??
      raw?.popTalkCap ??
      root?.poptalkCap ??
      raw?.poptalkCap ??
      popBalance
  );
  const popCap = Math.max(popBalance, popCapRaw);
  const popPlan = asText(popTalkObj?.plan ?? root?.popTalkPlan ?? raw?.popTalkPlan, 32) || null;
  const popServerNowMs = asInt(
    popTalkObj?.serverNowMs ??
      popTalkObj?.serverNow ??
      root?.popTalkServerNowMs ??
      raw?.popTalkServerNowMs ??
      root?.serverNowMs ??
      raw?.serverNowMs
  );
  return {
    ok: Boolean(raw?.ok),
    firstPurchaseBonusApplied: Boolean(raw?.firstPurchaseBonusApplied),
    grantedAmount: asInt(raw?.grantedAmount),
    duplicate: Boolean(raw?.duplicate),
    popTalkBalance: popBalance,
    popTalkCap: popCap,
    popTalkPlan: popPlan,
    popTalkServerNowMs: popServerNowMs > 0 ? popServerNowMs : null,
    walletKernel: asInt(wallet?.kernelBalance),
    errorCode: asText(raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(raw?.message || raw?.detail || raw?.error || "", 200),
  };
}

function parseWalletFetchResult(raw: any): ShopWalletFetchResult {
  const root = raw?.data ?? raw ?? {};
  const popTalkObj =
    (root?.popTalk && typeof root?.popTalk === "object" ? root.popTalk : null) ||
    (raw?.popTalk && typeof raw?.popTalk === "object" ? raw.popTalk : null) ||
    (root?.poptalk && typeof root?.poptalk === "object" ? root.poptalk : null) ||
    (raw?.poptalk && typeof raw?.poptalk === "object" ? raw.poptalk : null);
  return {
    ok: Boolean(raw?.ok),
    popTalkBalance: asInt(
      popTalkObj?.balance ??
        root?.popTalkBalance ??
        raw?.popTalkBalance ??
        root?.poptalkBalance ??
        raw?.poptalkBalance
    ),
    walletKernel: asInt(root?.wallet?.kernelBalance ?? raw?.wallet?.kernelBalance),
    errorCode: asText(raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(raw?.message || raw?.detail || raw?.error || "", 200),
  };
}

function parseUnifiedWalletState(raw: any): UnifiedWalletStateResult {
  const root = raw?.data ?? raw ?? {};
  const wallet = root?.wallet ?? raw?.wallet ?? {};
  const gift = extractGiftState(raw);
  const popTalkObj =
    (root?.popTalk && typeof root?.popTalk === "object" ? root.popTalk : null) ||
    (raw?.popTalk && typeof raw?.popTalk === "object" ? raw.popTalk : null) ||
    (root?.poptalk && typeof root?.poptalk === "object" ? root.poptalk : null) ||
    (raw?.poptalk && typeof raw?.poptalk === "object" ? raw.poptalk : null);
  const hasWalletShape = Boolean(
    wallet &&
    typeof wallet === "object" &&
    wallet?.kernelBalance != null
  );

  const popBalanceRaw =
    popTalkObj?.balance ??
    popTalkObj?.remaining ??
    popTalkObj?.remain ??
    root?.popTalkBalance ??
    raw?.popTalkBalance ??
    root?.poptalkBalance ??
    raw?.poptalkBalance;
  const hasExplicitPopTalk =
    popTalkObj != null ||
    popBalanceRaw != null ||
    root?.popTalkBalance != null ||
    raw?.popTalkBalance != null ||
    root?.poptalkBalance != null ||
    raw?.poptalkBalance != null;
  const popBalance = asInt(popBalanceRaw);
  const popCapRaw =
    popTalkObj?.cap ??
    popTalkObj?.max ??
    popTalkObj?.maxBalance ??
    root?.popTalkCap ??
    raw?.popTalkCap ??
    root?.poptalkCap ??
    raw?.poptalkCap ??
    popBalance;
  const popCap = Math.max(popBalance, popCapRaw);
  const popPlanRaw = asText(
    popTalkObj?.plan ??
      popTalkObj?.tier ??
      root?.popTalkPlan ??
      raw?.popTalkPlan,
    32
  );
  const popServerNow = asInt(
    popTalkObj?.serverNowMs ??
      popTalkObj?.serverNow ??
      root?.popTalkServerNowMs ??
      raw?.popTalkServerNowMs ??
      root?.serverNowMs ??
      raw?.serverNowMs
  );
  const explicitOkRaw = root?.ok ?? raw?.ok;
  const explicitOk = explicitOkRaw === true ? true : explicitOkRaw === false ? false : null;
  const inferredOk = hasWalletShape || hasExplicitPopTalk;
  const ok = explicitOk === false ? false : explicitOk === true || inferredOk;
  return {
    ok,
    popTalkBalance: popBalance,
    popTalkCap: popCap,
    popTalkPlan: popPlanRaw || null,
    popTalkServerNowMs: popServerNow > 0 ? popServerNow : null,
    walletKernel: asInt(wallet?.kernelBalance),
    giftStateFound: gift.found,
    giftsOwned: gift.giftsOwned,
    giftsReceived: gift.giftsReceived,
    errorCode: asText(root?.error || root?.code || raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(root?.message || root?.detail || root?.error || raw?.message || raw?.detail || raw?.error || "", 200),
  };
}

function parseConvertKernelResult(raw: any): ConvertKernelToPopTalkResult {
  const state = parseUnifiedWalletState(raw);
  const kernelSpent = asInt(raw?.kernelSpent ?? raw?.spentKernel ?? raw?.spent ?? raw?.request?.kernelAmount);
  const converted = asInt(raw?.convertedPopTalk ?? raw?.grantedPopTalk ?? raw?.rewardedPopTalk ?? raw?.resultAmount);
  const multRaw = Number(raw?.multiplier ?? raw?.rate ?? raw?.ratio ?? 0);
  const multiplier = Number.isFinite(multRaw) && multRaw > 0 ? Number(multRaw) : 1;
  const walletKernel = asInt(raw?.wallet?.kernelBalance ?? raw?.walletKernel ?? state.walletKernel);

  return {
    ok: Boolean(raw?.ok),
    kernelSpent,
    multiplier,
    convertedPopTalk: converted,
    popTalkBalance: state.popTalkBalance,
    popTalkCap: state.popTalkCap,
    popTalkPlan: state.popTalkPlan,
    popTalkServerNowMs: state.popTalkServerNowMs,
    walletKernel,
    errorCode: asText(raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(raw?.message || raw?.detail || raw?.error || "", 200),
  };
}

function coerceClaimFlag(v: unknown): boolean {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === "number") return v >= 1;
  const s = asText(v, 24).toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "claimed" || s === "done";
}

function normalizeClaimMap(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  for (const [rawKey, rawVal] of Object.entries(src)) {
    const key = asText(rawKey, 120);
    if (!key) continue;
    const nested =
      rawVal && typeof rawVal === "object"
        ? (rawVal as any)?.claimed ?? (rawVal as any)?.isClaimed ?? (rawVal as any)?.done ?? rawVal
        : rawVal;
    out[key] = coerceClaimFlag(nested);
  }
  return out;
}

function normalizeClaimArray(v: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!Array.isArray(v)) return out;
  for (const item of v) {
    const key = asText(item, 120);
    if (!key) continue;
    out[key] = true;
  }
  return out;
}

function normalizeGiftCountMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (Array.isArray(v)) {
    for (const item of v) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const key = asText(row.giftId ?? row.id ?? row.key ?? row.name ?? "", 120);
      if (!key) continue;
      const count = asInt(row.count ?? row.qty ?? row.quantity ?? row.amount ?? row.value);
      if (count <= 0) continue;
      out[key] = count;
    }
    return out;
  }

  const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  for (const [rawKey, rawVal] of Object.entries(src)) {
    const key = asText(rawKey, 120);
    if (!key) continue;
    const nested =
      rawVal && typeof rawVal === "object"
        ? (rawVal as any)?.count ?? (rawVal as any)?.qty ?? (rawVal as any)?.quantity ?? (rawVal as any)?.amount ?? (rawVal as any)?.value ?? rawVal
        : rawVal;
    const count = asInt(nested);
    if (count <= 0) continue;
    out[key] = count;
  }
  return out;
}

function extractGiftState(raw: any): {
  found: boolean;
  giftsOwned: Record<string, number>;
  giftsReceived: Record<string, number>;
  walletKernel: number;
} {
  const root = raw?.data ?? raw ?? {};
  const wallet = root?.wallet ?? raw?.wallet ?? {};

  const containerCandidates: unknown[] = [
    root?.giftInventory,
    raw?.giftInventory,
    root?.gifts,
    raw?.gifts,
    root?.inventory?.gifts,
    raw?.inventory?.gifts,
    root?.shop?.giftInventory,
    raw?.shop?.giftInventory,
    root?.data?.shop?.giftInventory,
    wallet?.giftInventory,
    wallet?.gifts,
  ];

  for (const c of containerCandidates) {
    if (!c || typeof c !== "object") continue;
    const obj = c as Record<string, unknown>;
    const hasOwnedField =
      Object.prototype.hasOwnProperty.call(obj, "owned") ||
      Object.prototype.hasOwnProperty.call(obj, "giftsOwned") ||
      Object.prototype.hasOwnProperty.call(obj, "ownedGifts") ||
      Object.prototype.hasOwnProperty.call(obj, "purchased");
    const hasReceivedField =
      Object.prototype.hasOwnProperty.call(obj, "received") ||
      Object.prototype.hasOwnProperty.call(obj, "giftsReceived") ||
      Object.prototype.hasOwnProperty.call(obj, "receivedGifts") ||
      Object.prototype.hasOwnProperty.call(obj, "inbox");

    if (!hasOwnedField && !hasReceivedField) continue;

    const giftsOwned = normalizeGiftCountMap(obj.owned ?? obj.giftsOwned ?? obj.ownedGifts ?? obj.purchased);
    const giftsReceived = normalizeGiftCountMap(obj.received ?? obj.giftsReceived ?? obj.receivedGifts ?? obj.inbox);
    return {
      found: true,
      giftsOwned,
      giftsReceived,
      walletKernel: asInt(root?.walletKernel ?? wallet?.kernelBalance ?? raw?.walletKernel ?? raw?.kernelBalance),
    };
  }

  const ownedCandidates: unknown[] = [
    root?.giftsOwned,
    raw?.giftsOwned,
    root?.shop?.giftsOwned,
    raw?.shop?.giftsOwned,
    wallet?.giftsOwned,
    root?.ownedGifts,
    raw?.ownedGifts,
  ];
  const receivedCandidates: unknown[] = [
    root?.giftsReceived,
    raw?.giftsReceived,
    root?.shop?.giftsReceived,
    raw?.shop?.giftsReceived,
    wallet?.giftsReceived,
    root?.receivedGifts,
    raw?.receivedGifts,
  ];

  let hasOwned = false;
  let hasReceived = false;
  let giftsOwned: Record<string, number> = {};
  let giftsReceived: Record<string, number> = {};

  for (const c of ownedCandidates) {
    if (c === undefined) continue;
    hasOwned = true;
    giftsOwned = normalizeGiftCountMap(c);
    if (Object.keys(giftsOwned).length > 0) break;
  }
  for (const c of receivedCandidates) {
    if (c === undefined) continue;
    hasReceived = true;
    giftsReceived = normalizeGiftCountMap(c);
    if (Object.keys(giftsReceived).length > 0) break;
  }

  return {
    found: hasOwned || hasReceived,
    giftsOwned,
    giftsReceived,
    walletKernel: asInt(root?.walletKernel ?? wallet?.kernelBalance ?? raw?.walletKernel ?? raw?.kernelBalance),
  };
}

function extractFirstPurchaseClaims(raw: any): { found: boolean; claimed: Record<string, boolean> } {
  const mapCandidates: unknown[] = [
    raw?.firstPurchaseClaimed,
    raw?.data?.firstPurchaseClaimed,
    raw?.shop?.firstPurchaseClaimed,
    raw?.data?.shop?.firstPurchaseClaimed,
    raw?.firstPurchase?.claimed,
    raw?.data?.firstPurchase?.claimed,
    raw?.claims,
    raw?.data?.claims,
  ];
  for (const c of mapCandidates) {
    if (!c || typeof c !== "object" || Array.isArray(c)) continue;
    return { found: true, claimed: normalizeClaimMap(c) };
  }

  const arrCandidates: unknown[] = [
    raw?.claimedPackIds,
    raw?.data?.claimedPackIds,
    raw?.shop?.claimedPackIds,
    raw?.data?.shop?.claimedPackIds,
    raw?.firstPurchaseClaimedPackIds,
    raw?.data?.firstPurchaseClaimedPackIds,
  ];
  for (const c of arrCandidates) {
    if (!Array.isArray(c)) continue;
    return { found: true, claimed: normalizeClaimArray(c) };
  }

  return { found: false, claimed: {} };
}

export async function confirmShopPurchase(input: ConfirmShopPurchaseInput): Promise<ConfirmShopPurchaseResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);
  const productId = asText(input.productId, 160);
  const packId = asText(input.packId, 80);
  const transactionId = asText(input.transactionId, 200);
  const kind = asText(input.kind, 16) === "kernel" ? "kernel" : "popcorn";

  if (!token || !userId || !productId || !packId || !transactionId) {
    return {
      ok: false,
      firstPurchaseBonusApplied: false,
      grantedAmount: 0,
      duplicate: false,
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      firstPurchaseBonusApplied: false,
      grantedAmount: 0,
      duplicate: false,
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const paths = [normalizePath("/api/shop/purchase/confirm"), normalizePath("/shop/purchase/confirm")];
  const body = {
    kind,
    packId,
    productId,
    amount: asInt(input.amount),
    bonusAmount: asInt(input.bonusAmount),
    priceKrw: asInt(input.priceKrw),
    transactionId,
    purchaseDate: asText(input.purchaseDate, 80),
    rcAppUserId: asText(input.rcAppUserId, 128),
    platform: Platform.OS,
    idempotencyKey: asText(input.idempotencyKey, 200),
    planOverride: asText(input.planOverride, 32),
    planDurationDays: asInt(input.planDurationDays),
  };

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
  };

  let last: ConfirmShopPurchaseResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        });
        const json = await res.json().catch(() => null);
        const parsed = parseConfirmResult(json);
        if (res.ok && parsed.ok) return parsed;
        last = {
          ...parsed,
          ok: false,
          errorCode: parsed.errorCode || `HTTP_${res.status}`,
          errorMessage: parsed.errorMessage || `HTTP_${res.status}`,
        };
      } catch (e) {
        last = {
          ok: false,
          firstPurchaseBonusApplied: false,
          grantedAmount: 0,
          duplicate: false,
          walletKernel: 0,
          errorCode: "REQUEST_FAILED",
          errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
        };
      }
    }
  }

  return (
    last ?? {
      ok: false,
      firstPurchaseBonusApplied: false,
      grantedAmount: 0,
      duplicate: false,
      walletKernel: 0,
      errorCode: "CONFIRM_FAILED",
      errorMessage: "CONFIRM_FAILED",
    }
  );
}

export async function fetchShopWallet(input: ShopWalletFetchInput): Promise<ShopWalletFetchResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);

  if (!token || !userId) {
    return {
      ok: false,
      popTalkBalance: 0,
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      popTalkBalance: 0,
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const paths = [normalizePath("/api/shop/wallet"), normalizePath("/shop/wallet")];
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
  };

  let last: ShopWalletFetchResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "GET",
          headers,
        });
        const json = await res.json().catch(() => null);
        const parsed = parseWalletFetchResult(json);
        if (res.ok && parsed.ok) return parsed;
        last = {
          ...parsed,
          ok: false,
          errorCode: parsed.errorCode || `HTTP_${res.status}`,
          errorMessage: parsed.errorMessage || `HTTP_${res.status}`,
        };
      } catch (e) {
        last = {
          ok: false,
          popTalkBalance: 0,
          walletKernel: 0,
          errorCode: "REQUEST_FAILED",
          errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
        };
      }
    }
  }

  return (
    last ?? {
      ok: false,
      popTalkBalance: 0,
      walletKernel: 0,
      errorCode: "WALLET_FETCH_FAILED",
      errorMessage: "WALLET_FETCH_FAILED",
    }
  );
}

export async function fetchUnifiedWalletState(input: UnifiedWalletStateInput): Promise<UnifiedWalletStateResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);
  const planId = asText(input.planId, 64);
  const storeProductId = asText(input.storeProductId, 120);
  const isPremium = input.isPremium == null ? "" : input.isPremium ? "1" : "0";

  if (!token || !userId) {
    return {
      ok: false,
      popTalkBalance: 0,
      popTalkCap: 0,
      popTalkPlan: null,
      popTalkServerNowMs: null,
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      popTalkBalance: 0,
      popTalkCap: 0,
      popTalkPlan: null,
      popTalkServerNowMs: null,
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const paths = [normalizePath("/api/wallet/state"), normalizePath("/wallet/state"), normalizePath("/api/state/wallet")];
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
    "X-Plan-Id": planId,
    "X-Store-Product-Id": storeProductId,
    "X-Is-Premium": isPremium,
  };

  let last: UnifiedWalletStateResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "GET",
          headers,
        });
        const json = await res.json().catch(() => null);
        const parsed = parseUnifiedWalletState(json);
        if (res.ok && parsed.ok) return parsed;
        last = {
          ...parsed,
          ok: false,
          errorCode: parsed.errorCode || `HTTP_${res.status}`,
          errorMessage: parsed.errorMessage || `HTTP_${res.status}`,
        };
      } catch (e) {
        last = {
          ok: false,
          popTalkBalance: 0,
          popTalkCap: 0,
          popTalkPlan: null,
          popTalkServerNowMs: null,
          walletKernel: 0,
          errorCode: "REQUEST_FAILED",
          errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
        };
      }
    }
  }

  return (
    last ?? {
      ok: false,
      popTalkBalance: 0,
      popTalkCap: 0,
      popTalkPlan: null,
      popTalkServerNowMs: null,
      walletKernel: 0,
      errorCode: "STATE_FETCH_FAILED",
      errorMessage: "STATE_FETCH_FAILED",
    }
  );
}

export async function convertKernelToPopTalk(input: ConvertKernelToPopTalkInput): Promise<ConvertKernelToPopTalkResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);
  const kernelAmount = asInt(input.kernelAmount);
  const idempotencyKey = asText(input.idempotencyKey, 200);

  if (!token || !userId || kernelAmount <= 0) {
    return {
      ok: false,
      kernelSpent: 0,
      multiplier: 1,
      convertedPopTalk: 0,
      popTalkBalance: 0,
      popTalkCap: 0,
      popTalkPlan: null,
      popTalkServerNowMs: null,
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      kernelSpent: 0,
      multiplier: 1,
      convertedPopTalk: 0,
      popTalkBalance: 0,
      popTalkCap: 0,
      popTalkPlan: null,
      popTalkServerNowMs: null,
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const customPath = normalizePath(String((APP_CONFIG as any)?.POPTALK?.kernelConvertPath || ""));
  const paths = Array.from(new Set([
    customPath,
    normalizePath("/api/poptalk/kernel-convert"),
    normalizePath("/api/poptalk/convert-kernel"),
    normalizePath("/api/poptalk/kernel/convert"),
    normalizePath("/api/poptalk/convert/kernel"),
    normalizePath("/api/poptalk/convert"),
    normalizePath("/poptalk/kernel-convert"),
    normalizePath("/poptalk/convert-kernel"),
    normalizePath("/poptalk/convert"),
    normalizePath("/api/wallet/convert-kernel"),
    normalizePath("/wallet/convert-kernel"),
    normalizePath("/api/wallet/kernel-convert"),
    normalizePath("/wallet/kernel-convert"),
    normalizePath("/api/wallet/kernel-to-poptalk"),
    normalizePath("/wallet/kernel-to-poptalk"),
    normalizePath("/api/popm/convert"),
    normalizePath("/popm/convert"),
  ].filter((v) => v.length > 0)));

  const body = {
    kernelAmount,
    amount: kernelAmount,
    kernels: kernelAmount,
    spendKernel: kernelAmount,
    reason: "kernel_to_poptalk",
    source: "popm",
    convertType: "kernel_to_poptalk",
    idempotencyKey: idempotencyKey || null,
  };

  const bodyVariants = [
    body,
    {
      amount: kernelAmount,
      reason: "kernel_to_poptalk",
      idempotencyKey: idempotencyKey || null,
    },
    {
      kernelAmount,
      source: "popm",
      idempotencyKey: idempotencyKey || null,
    },
  ];

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
    "X-Idempotency-Key": idempotencyKey,
  };

  let last: ConvertKernelToPopTalkResult | null = null;
  let onlyNotFound = true;
  for (const base of bases) {
    for (const path of paths) {
      for (const candidateBody of bodyVariants) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(candidateBody),
          });

          if (res.status === 404 || res.status === 405) {
            continue;
          }
          onlyNotFound = false;

          const json = await res.json().catch(() => null);
          const parsed = parseConvertKernelResult(json);
          if (res.ok && parsed.ok) return parsed;
          last = {
            ...parsed,
            ok: false,
            errorCode: parsed.errorCode || `HTTP_${res.status}`,
            errorMessage: parsed.errorMessage || `HTTP_${res.status}`,
          };
        } catch (e) {
          onlyNotFound = false;
          last = {
            ok: false,
            kernelSpent: 0,
            multiplier: 1,
            convertedPopTalk: 0,
            popTalkBalance: 0,
            popTalkCap: 0,
            popTalkPlan: null,
            popTalkServerNowMs: null,
            walletKernel: 0,
            errorCode: "REQUEST_FAILED",
            errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
          };
        }
      }
    }
  }

  if (onlyNotFound) {
    return {
      ok: false,
      kernelSpent: 0,
      multiplier: 1,
      convertedPopTalk: 0,
      popTalkBalance: 0,
      popTalkCap: 0,
      popTalkPlan: null,
      popTalkServerNowMs: null,
      walletKernel: 0,
      errorCode: "CONVERT_ROUTE_NOT_FOUND",
      errorMessage: "HTTP_404",
    };
  }

  return (
    last ?? {
      ok: false,
      kernelSpent: 0,
      multiplier: 1,
      convertedPopTalk: 0,
      popTalkBalance: 0,
      popTalkCap: 0,
      popTalkPlan: null,
      popTalkServerNowMs: null,
      walletKernel: 0,
      errorCode: "CONVERT_FAILED",
      errorMessage: "CONVERT_FAILED",
    }
  );
}

export async function fetchShopFirstPurchaseClaims(input: ShopFirstPurchaseClaimsInput): Promise<ShopFirstPurchaseClaimsResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);

  if (!token || !userId) {
    return {
      ok: false,
      claimed: {},
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      claimed: {},
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const paths = [
    normalizePath("/api/shop/first-purchase/claims"),
    normalizePath("/shop/first-purchase/claims"),
    normalizePath("/api/shop/first-purchase/status"),
    normalizePath("/shop/first-purchase/status"),
    normalizePath("/api/shop/state"),
    normalizePath("/shop/state"),
    normalizePath("/api/wallet/state"),
    normalizePath("/wallet/state"),
    normalizePath("/api/state/wallet"),
  ];

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
  };

  let lastError: ShopFirstPurchaseClaimsResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "GET",
          headers,
        });
        const json = await res.json().catch(() => null);
        const extracted = extractFirstPurchaseClaims(json);
        if (res.ok && extracted.found) {
          return {
            ok: true,
            claimed: extracted.claimed,
            errorCode: "",
            errorMessage: "",
          };
        }
        if (!res.ok) {
          lastError = {
            ok: false,
            claimed: {},
            errorCode: asText(json?.error || json?.code || `HTTP_${res.status}`, 80).toUpperCase(),
            errorMessage: asText(json?.message || json?.detail || json?.error || `HTTP_${res.status}`, 200),
          };
        }
      } catch (e) {
        lastError = {
          ok: false,
          claimed: {},
          errorCode: "REQUEST_FAILED",
          errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
        };
      }
    }
  }

  return (
    lastError ?? {
      ok: false,
      claimed: {},
      errorCode: "CLAIMS_FETCH_FAILED",
      errorMessage: "CLAIMS_FETCH_FAILED",
    }
  );
}

function parseGiftPurchaseResult(raw: any): PurchaseGiftWithKernelResult {
  const state = parseUnifiedWalletState(raw);
  const gift = extractGiftState(raw);
  const root = raw?.data ?? raw ?? {};
  const explicitOkRaw = root?.ok ?? root?.success ?? raw?.ok ?? raw?.success;
  const explicitOk = explicitOkRaw === true ? true : explicitOkRaw === false ? false : null;
  const ok = explicitOk === false ? false : explicitOk === true || gift.found;

  return {
    ok,
    giftStateFound: gift.found,
    giftsOwned: gift.giftsOwned,
    giftsReceived: gift.giftsReceived,
    walletKernel: asInt(root?.walletKernel ?? root?.wallet?.kernelBalance ?? raw?.walletKernel ?? raw?.wallet?.kernelBalance ?? state.walletKernel),
    errorCode: asText(root?.error || root?.code || raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(root?.message || root?.detail || root?.error || raw?.message || raw?.detail || raw?.error || "", 200),
  };
}

function parseGiftExchangeResult(raw: any): ExchangeReceivedGiftsResult {
  const parsed = parseGiftPurchaseResult(raw);
  const root = raw?.data ?? raw ?? {};
  return {
    ok: parsed.ok,
    exchangedKernel: asInt(
      root?.exchangedKernel ??
      root?.exchangeKernel ??
      raw?.exchangedKernel ??
      raw?.exchangeKernel
    ),
    giftStateFound: parsed.giftStateFound,
    giftsOwned: parsed.giftsOwned,
    giftsReceived: parsed.giftsReceived,
    walletKernel: parsed.walletKernel,
    errorCode: parsed.errorCode,
    errorMessage: parsed.errorMessage,
  };
}

export async function fetchShopGiftInventory(input: ShopGiftInventoryInput): Promise<ShopGiftInventoryResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);

  if (!token || !userId) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const paths = [
    normalizePath("/api/shop/gifts/state"),
    normalizePath("/shop/gifts/state"),
    normalizePath("/api/shop/gift/state"),
    normalizePath("/shop/gift/state"),
    normalizePath("/api/shop/gifts"),
    normalizePath("/shop/gifts"),
    normalizePath("/api/shop/gift"),
    normalizePath("/shop/gift"),
    normalizePath("/api/shop/state"),
    normalizePath("/shop/state"),
    normalizePath("/api/wallet/state"),
    normalizePath("/wallet/state"),
    normalizePath("/api/state/wallet"),
  ];

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
  };

  let last: ShopGiftInventoryResult | null = null;
  let onlyNotFound = true;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "GET",
          headers,
        });
        const json = await res.json().catch(() => null);
        const gift = extractGiftState(json);
        const state = parseUnifiedWalletState(json);
        if (res.status !== 404) onlyNotFound = false;
        if (res.ok && gift.found) {
          return {
            ok: true,
            giftStateFound: true,
            giftsOwned: gift.giftsOwned,
            giftsReceived: gift.giftsReceived,
            walletKernel: asInt(gift.walletKernel || state.walletKernel),
            errorCode: "",
            errorMessage: "",
          };
        }

        if (!res.ok) {
          last = {
            ok: false,
            giftStateFound: false,
            giftsOwned: {},
            giftsReceived: {},
            walletKernel: 0,
            errorCode: asText(json?.error || json?.code || `HTTP_${res.status}`, 80).toUpperCase(),
            errorMessage: asText(json?.message || json?.detail || json?.error || `HTTP_${res.status}`, 200),
          };
        }
      } catch (e) {
        last = {
          ok: false,
          giftStateFound: false,
          giftsOwned: {},
          giftsReceived: {},
          walletKernel: 0,
          errorCode: "REQUEST_FAILED",
          errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
        };
      }
    }
  }

  if (onlyNotFound) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "GIFT_STATE_ROUTE_NOT_FOUND",
      errorMessage: "HTTP_404",
    };
  }

  return (
    last ?? {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "GIFT_STATE_FETCH_FAILED",
      errorMessage: "GIFT_STATE_FETCH_FAILED",
    }
  );
}

export async function purchaseGiftWithKernelOnServer(input: PurchaseGiftWithKernelInput): Promise<PurchaseGiftWithKernelResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);
  const giftId = asText(input.giftId, 120);
  const costKernel = asInt(input.costKernel);
  const count = Math.max(1, asInt(input.count ?? 1));
  const totalCost = Math.max(0, costKernel * count);
  const idempotencyKey = asText(input.idempotencyKey, 200);

  if (!token || !userId || !giftId || costKernel <= 0 || count <= 0) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const paths = Array.from(
    new Set([
      normalizePath("/api/shop/gift/purchase"),
      normalizePath("/shop/gift/purchase"),
      normalizePath("/api/shop/gifts/purchase"),
      normalizePath("/shop/gifts/purchase"),
      normalizePath("/api/shop/gift/buy"),
      normalizePath("/shop/gift/buy"),
      normalizePath("/api/shop/gifts/buy"),
      normalizePath("/shop/gifts/buy"),
      normalizePath("/api/gift/purchase"),
      normalizePath("/gift/purchase"),
      normalizePath("/api/gifts/purchase"),
      normalizePath("/gifts/purchase"),
    ].filter((v) => v.length > 0))
  );

  const bodyVariants = [
    {
      giftId,
      count,
      qty: count,
      quantity: count,
      costKernel,
      kernelCost: costKernel,
      totalKernelCost: totalCost,
      amount: totalCost,
      currency: "kernel",
      source: "gift_shop",
      idempotencyKey: idempotencyKey || null,
    },
    {
      giftId,
      count,
      kernelCost: costKernel,
      idempotencyKey: idempotencyKey || null,
    },
    {
      giftId,
      qty: count,
      costKernel,
      idempotencyKey: idempotencyKey || null,
    },
  ];

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
    "X-Idempotency-Key": idempotencyKey,
  };

  let last: PurchaseGiftWithKernelResult | null = null;
  let onlyNotFound = true;
  for (const base of bases) {
    for (const path of paths) {
      for (const body of bodyVariants) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => null);
          const parsed = parseGiftPurchaseResult(json);
          if (res.status !== 404) onlyNotFound = false;

          if (res.ok && parsed.ok) {
            return {
              ...parsed,
              ok: true,
              errorCode: "",
              errorMessage: "",
            };
          }

          const rawCode = asText(parsed.errorCode || json?.error || json?.code || "", 80).toUpperCase();
          const rawMsg = asText(parsed.errorMessage || json?.message || json?.detail || json?.error || "", 200);
          const msgLower = rawMsg.toLowerCase();
          const code =
            rawCode.includes("INSUFFICIENT") ||
            rawCode.includes("NOT_ENOUGH") ||
            msgLower.includes("insufficient") ||
            msgLower.includes("not enough") ||
            msgLower.includes("부족")
              ? "INSUFFICIENT_KERNEL"
              : rawCode || `HTTP_${res.status}`;
          last = {
            ...parsed,
            ok: false,
            errorCode: code,
            errorMessage: rawMsg || `HTTP_${res.status}`,
          };
        } catch (e) {
          last = {
            ok: false,
            giftStateFound: false,
            giftsOwned: {},
            giftsReceived: {},
            walletKernel: 0,
            errorCode: "REQUEST_FAILED",
            errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
          };
        }
      }
    }
  }

  if (onlyNotFound) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "GIFT_PURCHASE_ROUTE_NOT_FOUND",
      errorMessage: "HTTP_404",
    };
  }

  return (
    last ?? {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "GIFT_PURCHASE_FAILED",
      errorMessage: "GIFT_PURCHASE_FAILED",
    }
  );
}

export async function exchangeReceivedGiftsOnServer(input: ExchangeReceivedGiftsInput): Promise<ExchangeReceivedGiftsResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);
  const idempotencyKey = asText(input.idempotencyKey, 200);
  const items = Array.isArray(input.items)
    ? input.items
      .map((row) => ({
        giftId: asText(row?.giftId, 120),
        count: Math.max(1, asInt(row?.count ?? 1)),
        costKernel: asInt(row?.costKernel),
      }))
      .filter((row) => row.giftId.length > 0 && row.count > 0 && row.costKernel > 0)
    : [];

  if (!token || !userId || items.length <= 0) {
    return {
      ok: false,
      exchangedKernel: 0,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      exchangedKernel: 0,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const paths = [
    normalizePath("/api/shop/gift/exchange"),
    normalizePath("/shop/gift/exchange"),
    normalizePath("/api/shop/gifts/exchange"),
    normalizePath("/shop/gifts/exchange"),
    normalizePath("/api/gift/exchange"),
    normalizePath("/gift/exchange"),
    normalizePath("/api/gifts/exchange"),
    normalizePath("/gifts/exchange"),
    normalizePath("/api/shop/gift/redeem"),
    normalizePath("/shop/gift/redeem"),
  ];

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
    "X-Idempotency-Key": idempotencyKey,
  };

  const totalCount = items.reduce((acc, row) => acc + Math.max(1, asInt(row.count)), 0);
  const first = items[0];
  const bodyVariants = [
    {
      items: items.map((row) => ({
        giftId: row.giftId,
        count: row.count,
        costKernel: row.costKernel,
      })),
      idempotencyKey: idempotencyKey || null,
      source: "gift_box_exchange",
    },
    {
      exchangeItems: items.map((row) => ({
        giftId: row.giftId,
        count: row.count,
        kernelCost: row.costKernel,
      })),
      idempotencyKey: idempotencyKey || null,
      source: "gift_box_exchange",
    },
    {
      giftId: first?.giftId || "",
      count: first?.count || 0,
      costKernel: first?.costKernel || 0,
      batchCount: totalCount,
      idempotencyKey: idempotencyKey || null,
      source: "gift_box_exchange",
    },
  ];

  let last: ExchangeReceivedGiftsResult | null = null;
  let onlyNotFound = true;
  for (const base of bases) {
    for (const path of paths) {
      for (const body of bodyVariants) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          if (res.status !== 404) onlyNotFound = false;
          const json = await res.json().catch(() => null);
          const parsed = parseGiftExchangeResult(json);
          if (res.ok && parsed.ok) {
            return {
              ...parsed,
              ok: true,
              errorCode: "",
              errorMessage: "",
            };
          }
          last = {
            ...parsed,
            ok: false,
            errorCode: asText(parsed.errorCode || json?.error || json?.code || `HTTP_${res.status}`, 80).toUpperCase(),
            errorMessage: asText(parsed.errorMessage || json?.message || json?.detail || json?.error || `HTTP_${res.status}`, 200),
          };
        } catch (e) {
          last = {
            ok: false,
            exchangedKernel: 0,
            giftStateFound: false,
            giftsOwned: {},
            giftsReceived: {},
            walletKernel: 0,
            errorCode: "REQUEST_FAILED",
            errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
          };
        }
      }
    }
  }

  if (onlyNotFound) {
    return {
      ok: false,
      exchangedKernel: 0,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "GIFT_EXCHANGE_ROUTE_NOT_FOUND",
      errorMessage: "HTTP_404",
    };
  }

  return (
    last ?? {
      ok: false,
      exchangedKernel: 0,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "GIFT_EXCHANGE_FAILED",
      errorMessage: "GIFT_EXCHANGE_FAILED",
    }
  );
}

async function mutateGiftTransferOnServer(input: {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  giftId: string;
  count?: number;
  deliveryId?: string | null;
  idempotencyKey?: string | null;
  action: "send" | "receive";
}): Promise<GiftTransferResult> {
  const token = asText(input.token, 4096);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 256);
  const giftId = asText(input.giftId, 120);
  const count = Math.max(1, asInt(input.count ?? 1));
  const deliveryId = asText(input.deliveryId, 200);
  const idempotencyKey = asText(input.idempotencyKey || deliveryId, 200);
  const action = input.action === "receive" ? "receive" : "send";
  const routeNotFoundCode = action === "receive" ? "GIFT_RECEIVE_ROUTE_NOT_FOUND" : "GIFT_SEND_ROUTE_NOT_FOUND";
  const genericFailCode = action === "receive" ? "GIFT_RECEIVE_FAILED" : "GIFT_SEND_FAILED";

  if (!token || !userId || !giftId || count <= 0) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: "BASE_URL_MISSING",
      errorMessage: "BASE_URL_MISSING",
    };
  }

  const actionSuffix = action === "receive" ? "receive" : "send";
  const paths = Array.from(
    new Set([
      normalizePath(`/api/shop/gift/${actionSuffix}`),
      normalizePath(`/shop/gift/${actionSuffix}`),
      normalizePath(`/api/shop/gifts/${actionSuffix}`),
      normalizePath(`/shop/gifts/${actionSuffix}`),
      normalizePath(`/api/gift/${actionSuffix}`),
      normalizePath(`/gift/${actionSuffix}`),
      normalizePath(`/api/gifts/${actionSuffix}`),
      normalizePath(`/gifts/${actionSuffix}`),
      normalizePath(`/api/shop/gift/${actionSuffix}-call`),
      normalizePath(`/shop/gift/${actionSuffix}-call`),
      normalizePath("/api/shop/gift/transfer"),
      normalizePath("/shop/gift/transfer"),
    ].filter((v) => v.length > 0))
  );

  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    "X-User-Id": userId,
    "X-Device-Key": deviceKey,
    "X-Idempotency-Key": idempotencyKey,
  };

  const bodyVariants = [
    {
      action,
      giftId,
      count,
      qty: count,
      quantity: count,
      deliveryId: deliveryId || null,
      eventId: deliveryId || null,
      idempotencyKey: idempotencyKey || null,
      source: "call_gift",
    },
    {
      mode: action,
      giftId,
      count,
      deliveryId: deliveryId || null,
      idempotencyKey: idempotencyKey || null,
    },
    {
      giftId,
      count,
      deliveryId: deliveryId || null,
      idempotencyKey: idempotencyKey || null,
    },
  ];

  let last: GiftTransferResult | null = null;
  let onlyNotFound = true;
  for (const base of bases) {
    for (const path of paths) {
      for (const body of bodyVariants) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
          const json = await res.json().catch(() => null);
          const parsed = parseGiftPurchaseResult(json);
          if (res.status !== 404) onlyNotFound = false;

          if (res.ok && parsed.ok) {
            return {
              ...parsed,
              ok: true,
              errorCode: "",
              errorMessage: "",
            };
          }

          const rawCode = asText(parsed.errorCode || json?.error || json?.code || "", 80).toUpperCase();
          const rawMsg = asText(parsed.errorMessage || json?.message || json?.detail || json?.error || "", 200);
          const msgLower = rawMsg.toLowerCase();
          const insufficientGift =
            rawCode.includes("INSUFFICIENT_GIFT") ||
            rawCode.includes("NOT_ENOUGH_GIFT") ||
            msgLower.includes("insufficient gift") ||
            msgLower.includes("gift insufficient") ||
            msgLower.includes("선물 부족") ||
            msgLower.includes("보유 선물");
          const code =
            insufficientGift
              ? "INSUFFICIENT_GIFT"
              : rawCode || `HTTP_${res.status}`;
          last = {
            ...parsed,
            ok: false,
            errorCode: code,
            errorMessage: rawMsg || `HTTP_${res.status}`,
          };
        } catch (e) {
          last = {
            ok: false,
            giftStateFound: false,
            giftsOwned: {},
            giftsReceived: {},
            walletKernel: 0,
            errorCode: "REQUEST_FAILED",
            errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
          };
        }
      }
    }
  }

  if (onlyNotFound) {
    return {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: routeNotFoundCode,
      errorMessage: "HTTP_404",
    };
  }

  return (
    last ?? {
      ok: false,
      giftStateFound: false,
      giftsOwned: {},
      giftsReceived: {},
      walletKernel: 0,
      errorCode: genericFailCode,
      errorMessage: genericFailCode,
    }
  );
}

export async function sendGiftOnServer(input: SendGiftOnServerInput): Promise<GiftTransferResult> {
  return mutateGiftTransferOnServer({ ...input, action: "send" });
}

export async function receiveGiftOnServer(input: ReceiveGiftOnServerInput): Promise<GiftTransferResult> {
  return mutateGiftTransferOnServer({ ...input, action: "receive" });
}
