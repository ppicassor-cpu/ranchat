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
};

export type ConfirmShopPurchaseResult = {
  ok: boolean;
  firstPurchaseBonusApplied: boolean;
  grantedAmount: number;
  duplicate: boolean;
  walletPopcorn: number;
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
  walletPopcorn: number;
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
  walletPopcorn: number;
  walletKernel: number;
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
  return {
    ok: Boolean(raw?.ok),
    firstPurchaseBonusApplied: Boolean(raw?.firstPurchaseBonusApplied),
    grantedAmount: asInt(raw?.grantedAmount),
    duplicate: Boolean(raw?.duplicate),
    walletPopcorn: asInt(raw?.wallet?.popcornBalance),
    walletKernel: asInt(raw?.wallet?.kernelBalance),
    errorCode: asText(raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(raw?.message || raw?.detail || raw?.error || "", 200),
  };
}

function parseWalletFetchResult(raw: any): ShopWalletFetchResult {
  return {
    ok: Boolean(raw?.ok),
    walletPopcorn: asInt(raw?.wallet?.popcornBalance),
    walletKernel: asInt(raw?.wallet?.kernelBalance),
    errorCode: asText(raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(raw?.message || raw?.detail || raw?.error || "", 200),
  };
}

function parseUnifiedWalletState(raw: any): UnifiedWalletStateResult {
  const pop = raw?.popTalk ?? raw?.poptalk ?? raw?.data?.popTalk ?? raw?.data?.poptalk ?? {};
  const popBalance = asInt(pop?.balance ?? raw?.balance);
  const popCapRaw = asInt(pop?.cap ?? raw?.cap);
  const popCap = Math.max(popBalance, popCapRaw);
  const popPlanRaw = asText(pop?.plan ?? raw?.plan, 32);
  const popServerNow = asInt(pop?.serverNowMs ?? raw?.serverNowMs);
  return {
    ok: Boolean(raw?.ok),
    popTalkBalance: popBalance,
    popTalkCap: popCap,
    popTalkPlan: popPlanRaw || null,
    popTalkServerNowMs: popServerNow > 0 ? popServerNow : null,
    walletPopcorn: asInt(raw?.wallet?.popcornBalance),
    walletKernel: asInt(raw?.wallet?.kernelBalance),
    errorCode: asText(raw?.error || raw?.code || "", 80).toUpperCase(),
    errorMessage: asText(raw?.message || raw?.detail || raw?.error || "", 200),
  };
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
      walletPopcorn: 0,
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
      walletPopcorn: 0,
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
          walletPopcorn: 0,
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
      walletPopcorn: 0,
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
      walletPopcorn: 0,
      walletKernel: 0,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (!bases.length) {
    return {
      ok: false,
      walletPopcorn: 0,
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
          walletPopcorn: 0,
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
      walletPopcorn: 0,
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
      walletPopcorn: 0,
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
      walletPopcorn: 0,
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
          walletPopcorn: 0,
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
      walletPopcorn: 0,
      walletKernel: 0,
      errorCode: "STATE_FETCH_FAILED",
      errorMessage: "STATE_FETCH_FAILED",
    }
  );
}
