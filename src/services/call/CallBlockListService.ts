import { APP_CONFIG } from "../../config/app";

type CallBlockBaseInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey: string | null | undefined;
};

export type CallBlockListItem = {
  peerSessionKey: string;
  peerProfileId?: string;
  peerUserId?: string;
  roomId?: string;
  reasonCode: string;
  reasonLabel: string;
  blockedAtMs: number;
  createdAtMs: number;
};

export type FetchCallBlockListResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  actorSessionKey?: string;
  items: CallBlockListItem[];
};

export type UnblockCallPeersInput = CallBlockBaseInput & {
  peerSessionIds: string[];
};

export type UnblockCallPeersResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  removedCount: number;
};

function asText(v: unknown, maxLen = 256): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function normalizeHttpsBase(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s.replace(/\/+$/, "");
  if (/^http:\/\//i.test(s)) return s.replace(/\/+$/, "");
  if (/^wss:\/\//i.test(s)) return s.replace(/^wss:\/\//i, "https://").replace(/\/+$/, "");
  if (/^ws:\/\//i.test(s)) return s.replace(/^ws:\/\//i, "http://").replace(/\/+$/, "");
  return `https://${s.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function httpsBaseFromWs(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    const protocol = u.protocol === "ws:" ? "http" : "https";
    return `${protocol}://${u.host}`;
  } catch {
    return "";
  }
}

function resolveBases(): string[] {
  const envBase = asText(process.env.EXPO_PUBLIC_CALL_SAFETY_HTTP_BASE_URL || "", 260);
  const envBlockBase = asText(process.env.EXPO_PUBLIC_CALL_BLOCK_HTTP_BASE_URL || "", 260);
  const envListBase = asText(process.env.EXPO_PUBLIC_CALL_BLOCK_LIST_HTTP_BASE_URL || "", 260);
  const cfgAuth = asText(APP_CONFIG.AUTH_HTTP_BASE_URL || "", 260);
  const cfgPopTalk = asText(APP_CONFIG.POPTALK?.httpBaseUrl || "", 260);
  const cfgSignal = asText(APP_CONFIG.SIGNALING_URL || "", 260);
  const raw = [envBase, envBlockBase, envListBase, cfgAuth, cfgPopTalk, httpsBaseFromWs(cfgSignal)]
    .map((v) => normalizeHttpsBase(v))
    .filter((v) => v.length > 0);
  return Array.from(new Set(raw));
}

function normalizePath(pathLike: string): string {
  const p = asText(pathLike, 320);
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

async function postCandidates(input: {
  token: string;
  userId: string;
  deviceKey: string;
  body: Record<string, unknown>;
  pathCandidates: string[];
  routeNotFoundCode: string;
}): Promise<{
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  json: any;
}> {
  const bases = resolveBases();
  if (bases.length <= 0) {
    return {
      ok: false,
      errorCode: "HTTP_BASE_URL_MISSING",
      errorMessage: "HTTP_BASE_URL_MISSING",
      json: {},
    };
  }

  let lastFail: { errorCode: string; errorMessage: string; json: any } | null = null;
  for (const base of bases) {
    for (const path of input.pathCandidates.map((p) => normalizePath(p))) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${input.token}`,
            "x-user-id": input.userId,
            "x-device-key": input.deviceKey,
          },
          body: JSON.stringify({
            ...(input.body || {}),
            userId: input.userId,
            deviceKey: input.deviceKey,
            sessionId: input.deviceKey,
            source: "profile_screen",
          }),
        });
        const text = await res.text().catch(() => "");
        let json: any = {};
        try {
          json = text ? JSON.parse(text) : {};
        } catch {
          json = { raw: text };
        }

        if (res.status === 404) continue;
        if (res.ok && json?.ok !== false) {
          return { ok: true, errorCode: "", errorMessage: "", json };
        }
        lastFail = {
          errorCode: asText(json?.errorCode || json?.error || `HTTP_${res.status}`, 80),
          errorMessage: asText(json?.errorMessage || json?.message || json?.error || `HTTP_${res.status}`, 220),
          json,
        };
      } catch {
        lastFail = {
          errorCode: "NETWORK_ERROR",
          errorMessage: "NETWORK_ERROR",
          json: {},
        };
      }
    }
  }

  if (lastFail) {
    return {
      ok: false,
      errorCode: lastFail.errorCode,
      errorMessage: lastFail.errorMessage,
      json: lastFail.json,
    };
  }

  return {
    ok: false,
    errorCode: input.routeNotFoundCode,
    errorMessage: input.routeNotFoundCode,
    json: {},
  };
}

function toBlockListItems(raw: any): CallBlockListItem[] {
  const arr: any[] =
    (Array.isArray(raw?.blocks) && raw.blocks) ||
    (Array.isArray(raw?.items) && raw.items) ||
    (Array.isArray(raw?.rows) && raw.rows) ||
    [];
  return arr
    .map((it: any) => {
      const peerSessionKey = asText(it?.peerSessionKey || it?.peer_session_key || it?.peerSessionId || "", 256);
      if (!peerSessionKey) return null;
      const createdAtRaw = Number(it?.createdAtMs ?? it?.createdAt ?? it?.created_at ?? 0);
      const updatedAtRaw = Number(it?.blockedAtMs ?? it?.blockedAt ?? it?.updatedAt ?? it?.updated_at ?? 0);
      const createdAtMs = Number.isFinite(createdAtRaw) ? Math.max(0, Math.trunc(createdAtRaw)) : 0;
      const blockedAtMs = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? Math.trunc(updatedAtRaw) : createdAtMs;
      return {
        peerSessionKey,
        peerProfileId: asText(it?.peerProfileId || it?.peer_profile_id || "", 180) || undefined,
        peerUserId: asText(it?.peerUserId || it?.peer_user_id || "", 128) || undefined,
        roomId: asText(it?.roomId || it?.room_id || "", 120) || undefined,
        reasonCode: asText(it?.reasonCode || it?.reason_code || "", 80),
        reasonLabel: asText(it?.reasonLabel || it?.reason_label || "", 120),
        blockedAtMs,
        createdAtMs,
      } as CallBlockListItem;
    })
    .filter((v: CallBlockListItem | null): v is CallBlockListItem => Boolean(v))
    .sort((a: CallBlockListItem, b: CallBlockListItem) => b.blockedAtMs - a.blockedAtMs);
}

export async function fetchCallBlockListOnServer(input: CallBlockBaseInput): Promise<FetchCallBlockListResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  if (!token || !userId || !deviceKey) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT", items: [] };
  }

  const customPath = asText(process.env.EXPO_PUBLIC_CALL_BLOCK_LIST_PATH || "", 240);
  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_BLOCK_LIST_ROUTE_NOT_FOUND",
    pathCandidates: [
      customPath || "",
      "/api/call/blocks",
      "/call/blocks",
      "/api/call/block/list",
      "/call/block/list",
      "/api/call/safety/blocks",
      "/call/safety/blocks",
    ].filter((v) => v.length > 0),
    body: {},
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
      items: [],
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    actorSessionKey: asText(out.json?.actorSessionKey || out.json?.sessionId || "", 256) || undefined,
    items: toBlockListItems(out.json),
  };
}

export async function unblockCallPeersOnServer(input: UnblockCallPeersInput): Promise<UnblockCallPeersResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  const peerSessionIds = Array.from(
    new Set(
      (Array.isArray(input.peerSessionIds) ? input.peerSessionIds : [])
        .map((v) => asText(v, 256))
        .filter((v) => v.length > 0)
    )
  );

  if (!token || !userId || !deviceKey || peerSessionIds.length <= 0) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT", removedCount: 0 };
  }

  const customPath = asText(process.env.EXPO_PUBLIC_CALL_UNBLOCK_PATH || "", 240);
  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_UNBLOCK_ROUTE_NOT_FOUND",
    pathCandidates: [
      customPath || "",
      "/api/call/block/unblock",
      "/call/block/unblock",
      "/api/call/blocks/unblock",
      "/call/blocks/unblock",
      "/api/call/safety/block/unblock",
      "/call/safety/block/unblock",
      "/api/call/safety/blocks/unblock",
      "/call/safety/blocks/unblock",
    ].filter((v) => v.length > 0),
    body: {
      peerSessionIds,
      peerSessionId: peerSessionIds[0],
    },
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
      removedCount: 0,
    };
  }

  const removedRaw = Number(out.json?.removedCount ?? out.json?.count ?? 0);
  const removedCount = Number.isFinite(removedRaw) ? Math.max(0, Math.trunc(removedRaw)) : 0;
  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    removedCount,
  };
}
