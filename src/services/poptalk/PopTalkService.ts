import { APP_CONFIG } from "../../config/app";

export type PopTalkSnapshot = {
  balance: number;
  cap: number;
  plan: string | null;
  serverNowMs: number | null;
};

type PopTalkRequestInput = {
  token: string | null | undefined;
  userId?: string | null;
  deviceKey?: string | null;
  planId?: string | null;
  storeProductId?: string | null;
  isPremium?: boolean | null;
  premiumExpiresAtMs?: number | null;
};

type PopTalkMutationInput = PopTalkRequestInput & {
  amount: number;
  reason: string;
  idempotencyKey?: string | null;
};

export type PopTalkMutationResult = {
  ok: boolean;
  insufficient: boolean;
  status: number;
  snapshot: PopTalkSnapshot | null;
  errorCode: string;
  errorMessage: string;
};

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

function normalizePath(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  return s.startsWith("/") ? s : `/${s}`;
}

function resolveBases(): string[] {
  const cfg = (APP_CONFIG as any)?.POPTALK ?? {};
  const raw = [
    String(cfg?.httpBaseUrl || "").trim(),
    String(APP_CONFIG.AUTH_HTTP_BASE_URL || "").trim(),
    httpsBaseFromWs(String(APP_CONFIG.SIGNALING_URL || "").trim()),
  ]
    .map((v) => normalizeHttpsBase(v))
    .filter((v) => v.length > 0);
  return Array.from(new Set(raw));
}

function resolveStatePaths(): string[] {
  const cfg = (APP_CONFIG as any)?.POPTALK ?? {};
  const custom = normalizePath(String(cfg?.statePath || "").trim());
  const base = ["/api/poptalk/state", "/api/poptalk", "/poptalk/state", "/poptalk"];
  return Array.from(new Set([custom, ...base].filter((v) => v.length > 0)));
}

function resolveConsumePaths(): string[] {
  const cfg = (APP_CONFIG as any)?.POPTALK ?? {};
  const custom = normalizePath(String(cfg?.consumePath || "").trim());
  const base = ["/api/poptalk/consume", "/api/poptalk/spend", "/poptalk/consume", "/poptalk/spend"];
  return Array.from(new Set([custom, ...base].filter((v) => v.length > 0)));
}

function resolveRewardPaths(): string[] {
  const cfg = (APP_CONFIG as any)?.POPTALK ?? {};
  const custom = normalizePath(String(cfg?.rewardPath || "").trim());
  const base = ["/api/poptalk/reward", "/api/poptalk/rewarded", "/poptalk/reward", "/poptalk/rewarded"];
  return Array.from(new Set([custom, ...base].filter((v) => v.length > 0)));
}

function asNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function pickFirst(raw: any, keys: string[]): any {
  for (const key of keys) {
    if (raw == null) continue;
    if (Object.prototype.hasOwnProperty.call(raw, key)) return (raw as any)[key];
  }
  return undefined;
}

function normalizeSnapshot(raw: any): PopTalkSnapshot | null {
  if (!raw || typeof raw !== "object") return null;

  const root: any = raw?.data ?? raw?.wallet ?? raw?.poptalk ?? raw?.popTalk ?? raw;

  const balanceRaw = pickFirst(root, [
    "balance",
    "remaining",
    "remain",
    "popTalk",
    "poptalk",
    "credit",
    "credits",
    "amount",
  ]);
  const capRaw = pickFirst(root, [
    "cap",
    "max",
    "maxBalance",
    "maxPopTalk",
    "dailyCap",
    "dailyMax",
    "baseCap",
  ]);
  const planRaw = pickFirst(root, ["plan", "tier", "planId", "subscriptionPlan", "subscription"]);
  const serverNowRaw = pickFirst(raw, ["serverNowMs", "serverNow", "serverTimeMs", "nowMs", "timestamp"]);
  const serverNowInnerRaw = pickFirst(root, ["serverNowMs", "serverNow", "serverTimeMs", "nowMs", "timestamp"]);

  let balance = Math.max(0, Math.trunc(asNumber(balanceRaw, NaN)));
  let cap = Math.max(0, Math.trunc(asNumber(capRaw, NaN)));

  if (!Number.isFinite(balance)) return null;
  if (!Number.isFinite(cap) || cap <= 0) {
    cap = Math.max(0, balance);
  }
  balance = Math.min(balance, cap);

  const serverNowMsRaw = Number.isFinite(asNumber(serverNowRaw, NaN)) ? serverNowRaw : serverNowInnerRaw;
  const serverNowMsNum = asNumber(serverNowMsRaw, NaN);
  const serverNowMs = Number.isFinite(serverNowMsNum) && serverNowMsNum > 0 ? Math.trunc(serverNowMsNum) : null;

  const plan = String(planRaw ?? "").trim() || null;

  return {
    balance,
    cap,
    plan,
    serverNowMs,
  };
}

function buildHeaders(input: PopTalkRequestInput): Record<string, string> {
  const premiumExpiresRaw = Number(input.premiumExpiresAtMs);
  const premiumExpiresAtMs = Number.isFinite(premiumExpiresRaw) && premiumExpiresRaw > 0 ? Math.trunc(premiumExpiresRaw) : 0;
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    Authorization: `Bearer ${String(input.token || "").trim()}`,
    "X-User-Id": String(input.userId || ""),
    "X-Device-Key": String(input.deviceKey || ""),
    "X-Plan-Id": String(input.planId || ""),
    "X-Store-Product-Id": String(input.storeProductId || ""),
    "X-Is-Premium": input.isPremium == null ? "" : input.isPremium ? "1" : "0",
    "X-Premium-Expires-At-Ms": premiumExpiresAtMs > 0 ? String(premiumExpiresAtMs) : "",
  };
}

function normalizeMutationResult(res: Response, json: any): PopTalkMutationResult {
  const snapshot = normalizeSnapshot(json);
  const status = Number(res?.status || 0);
  const msg = String(json?.message ?? json?.error ?? json?.code ?? "").trim();
  const code = String(json?.code ?? json?.errorCode ?? "").trim().toUpperCase();

  const insufficientByCode = /(INSUFFICIENT|NOT_ENOUGH|BALANCE_LOW|NO_BALANCE)/i.test(code || msg);
  const insufficientByStatus = status === 402 || status === 409 || status === 422;
  const insufficient = Boolean(insufficientByCode || insufficientByStatus);

  return {
    ok: Boolean(res.ok),
    insufficient,
    status,
    snapshot,
    errorCode: code,
    errorMessage: msg,
  };
}

async function tryFetchSnapshot(input: PopTalkRequestInput, path: string, base: string): Promise<PopTalkSnapshot | null> {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "GET",
    headers: buildHeaders(input),
  });

  if (!res.ok) return null;
  const json = await res.json().catch(() => null);
  return normalizeSnapshot(json);
}

async function tryMutation(
  input: PopTalkMutationInput,
  path: string,
  base: string,
  body: Record<string, any>
): Promise<PopTalkMutationResult | null> {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildHeaders(input),
    body: JSON.stringify(body),
  });

  if (!res.ok && (res.status === 404 || res.status === 405)) return null;
  const json = await res.json().catch(() => null);
  return normalizeMutationResult(res, json);
}

export async function fetchPopTalkSnapshot(input: PopTalkRequestInput): Promise<PopTalkSnapshot | null> {
  const token = String(input.token || "").trim();
  if (!token) return null;

  const bases = resolveBases();
  if (!bases.length) return null;

  const paths = resolveStatePaths();
  for (const base of bases) {
    for (const path of paths) {
      try {
        const snap = await tryFetchSnapshot(input, path, base);
        if (snap) return snap;
      } catch {
        // Try next candidate.
      }
    }
  }
  return null;
}

export async function consumePopTalk(input: PopTalkMutationInput): Promise<PopTalkMutationResult> {
  const token = String(input.token || "").trim();
  const amount = Math.max(0, Math.trunc(asNumber(input.amount, 0)));
  if (!token || amount <= 0) {
    return {
      ok: false,
      insufficient: false,
      status: 0,
      snapshot: null,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  const paths = resolveConsumePaths();
  if (!bases.length || !paths.length) {
    return {
      ok: false,
      insufficient: false,
      status: 0,
      snapshot: null,
      errorCode: "POPTALK_BASE_MISSING",
      errorMessage: "POPTALK_BASE_MISSING",
    };
  }

  const body = {
    amount,
    reason: String(input.reason || "").trim() || "consume",
    idempotencyKey: String(input.idempotencyKey || "").trim() || null,
  };

  let lastErr: PopTalkMutationResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await tryMutation(input, path, base, body);
        if (!res) continue;
        if (res.ok || res.insufficient) return res;
        lastErr = res;
      } catch (e) {
        lastErr = {
          ok: false,
          insufficient: false,
          status: 0,
          snapshot: null,
          errorCode: "REQUEST_FAILED",
          errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
        };
      }
    }
  }

  return (
    lastErr ?? {
      ok: false,
      insufficient: false,
      status: 0,
      snapshot: null,
      errorCode: "POPTALK_CONSUME_FAILED",
      errorMessage: "POPTALK_CONSUME_FAILED",
    }
  );
}

export async function rewardPopTalk(input: PopTalkMutationInput): Promise<PopTalkMutationResult> {
  const token = String(input.token || "").trim();
  const amount = Math.max(0, Math.trunc(asNumber(input.amount, 0)));
  if (!token || amount <= 0) {
    return {
      ok: false,
      insufficient: false,
      status: 0,
      snapshot: null,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  const paths = resolveRewardPaths();
  if (!bases.length || !paths.length) {
    return {
      ok: false,
      insufficient: false,
      status: 0,
      snapshot: null,
      errorCode: "POPTALK_BASE_MISSING",
      errorMessage: "POPTALK_BASE_MISSING",
    };
  }

  const body = {
    amount,
    reason: String(input.reason || "").trim() || "rewarded_ad",
    idempotencyKey: String(input.idempotencyKey || "").trim() || null,
  };

  let lastErr: PopTalkMutationResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await tryMutation(input, path, base, body);
        if (!res) continue;
        if (res.ok) return res;
        lastErr = res;
      } catch (e) {
        lastErr = {
          ok: false,
          insufficient: false,
          status: 0,
          snapshot: null,
          errorCode: "REQUEST_FAILED",
          errorMessage: e instanceof Error ? e.message : "REQUEST_FAILED",
        };
      }
    }
  }

  return (
    lastErr ?? {
      ok: false,
      insufficient: false,
      status: 0,
      snapshot: null,
      errorCode: "POPTALK_REWARD_FAILED",
      errorMessage: "POPTALK_REWARD_FAILED",
    }
  );
}
