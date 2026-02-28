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
  popTalkBalance?: number;
  popTalkCap?: number;
  popTalkPlan?: string | null;
  popTalkServerNowMs?: number | null;
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
  const pop = raw?.popTalk ?? raw?.poptalk ?? raw?.data?.popTalk ?? raw?.data?.poptalk ?? {};
  const popBalance = asInt(pop?.balance);
  const popCapRaw = asInt(pop?.cap);
  const popCap = Math.max(popBalance, popCapRaw);
  const popPlan = asText(pop?.plan, 32) || null;
  const popServerNowMs = asInt(pop?.serverNowMs);
  return {
    ok: Boolean(raw?.ok),
    firstPurchaseBonusApplied: Boolean(raw?.firstPurchaseBonusApplied),
    grantedAmount: asInt(raw?.grantedAmount),
    duplicate: Boolean(raw?.duplicate),
    popTalkBalance: popBalance,
    popTalkCap: popCap,
    popTalkPlan: popPlan,
    popTalkServerNowMs: popServerNowMs > 0 ? popServerNowMs : null,
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
  const root = raw?.data ?? raw ?? {};
  const pop = root?.popTalk ?? root?.poptalk ?? raw?.popTalk ?? raw?.poptalk ?? {};
  const wallet = root?.wallet ?? raw?.wallet ?? {};
  const popBalance = asInt(pop?.balance ?? root?.balance ?? raw?.balance);
  const popCapRaw = asInt(pop?.cap ?? root?.cap ?? raw?.cap);
  const popCap = Math.max(popBalance, popCapRaw);
  const popPlanRaw = asText(pop?.plan ?? root?.plan ?? raw?.plan, 32);
  const popServerNow = asInt(pop?.serverNowMs ?? root?.serverNowMs ?? raw?.serverNowMs);
  return {
    ok: Boolean(root?.ok ?? raw?.ok),
    popTalkBalance: popBalance,
    popTalkCap: popCap,
    popTalkPlan: popPlanRaw || null,
    popTalkServerNowMs: popServerNow > 0 ? popServerNow : null,
    walletPopcorn: asInt(wallet?.popcornBalance),
    walletKernel: asInt(wallet?.kernelBalance),
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
    popTalkBalance: asInt(raw?.popTalk?.balance ?? raw?.poptalk?.balance ?? state.popTalkBalance),
    popTalkCap: asInt(raw?.popTalk?.cap ?? raw?.poptalk?.cap ?? state.popTalkCap),
    popTalkPlan: asText(raw?.popTalk?.plan ?? raw?.poptalk?.plan ?? state.popTalkPlan, 32) || null,
    popTalkServerNowMs: asInt(raw?.popTalk?.serverNowMs ?? raw?.poptalk?.serverNowMs ?? state.popTalkServerNowMs) || null,
    walletKernel,
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
