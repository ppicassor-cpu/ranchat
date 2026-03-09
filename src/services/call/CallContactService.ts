import { APP_CONFIG } from "../../config/app";

type CallContactBaseInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey: string | null | undefined;
};

export type CallContactItem = {
  contactKey: string;
  peerProfileId?: string;
  peerSessionId?: string;
  peerSessionKey?: string;
  peerUserId?: string;
  peerNickname?: string;
  peerAvatarUrl?: string;
  peerLoginAccount?: string;
  peerCountry?: string;
  peerLanguage?: string;
  peerGender?: string;
  peerFlag?: string;
  peerInterests?: string[];
  roomId?: string;
  isFriend: boolean;
  isMutualFriend: boolean;
  isFavorite: boolean;
  isOnline: boolean;
  canRecall: boolean;
  friendAtMs: number;
  favoriteAtMs: number;
  lastCallAtMs: number;
  updatedAtMs: number;
};

export type FetchCallContactsResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  contacts: CallContactItem[];
};

export type FetchCallContactsInput = CallContactBaseInput & {
  limit?: number | null;
  roomId?: string | null;
  peerSessionId?: string | null;
  peerProfileId?: string | null;
  peerUserId?: string | null;
};

export type MutateCallContactInput = CallContactBaseInput & {
  roomId?: string | null;
  peerSessionId?: string | null;
  peerProfileId?: string | null;
  peerUserId?: string | null;
  peerCountry?: string | null;
  peerLanguage?: string | null;
  peerGender?: string | null;
  peerFlag?: string | null;
  enabled?: boolean | null;
};

export type MutateCallContactResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  contact?: CallContactItem;
};

export type RecallCallContactInput = CallContactBaseInput & {
  peerSessionId?: string | null;
  peerProfileId?: string | null;
};

export type RecallCallContactResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  actorSessionId?: string;
  peerSessionId?: string;
  invitePending?: boolean;
  inviteId?: string;
};

export type PendingRecallInvite = {
  inviteId: string;
  actorSessionId?: string;
  actorProfileId?: string;
  actorNickname?: string;
  actorAvatarUrl?: string;
  actorCountry?: string;
  actorLanguage?: string;
  actorGender?: string;
  actorFlag?: string;
  actorLoginAccount?: string;
  createdAtMs: number;
  expiresAtMs: number;
};

export type FetchPendingRecallInviteResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  invite?: PendingRecallInvite | null;
};

export type RespondRecallInviteInput = CallContactBaseInput & {
  inviteId: string | null | undefined;
  accept: boolean;
  blockFuture?: boolean | null;
};

export type RespondRecallInviteResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  actorSessionId?: string;
  peerSessionId?: string;
  inviteId?: string;
  blocked?: boolean;
  declined?: boolean;
};

export type FetchRecallInviteStatusInput = CallContactBaseInput & {
  inviteId: string | null | undefined;
};

export type FetchRecallInviteStatusResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  inviteId?: string;
  status?: string;
  actorSessionId?: string;
  peerSessionId?: string;
  acceptedPeerSessionId?: string;
  updatedAtMs?: number;
  expiresAtMs?: number;
};

function asText(v: unknown, maxLen = 256): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function asBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "y" || s === "yes" || s === "on";
}

function asNumber(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function asStringArray(raw: unknown, maxItems = 3, maxLen = 32): string[] {
  const values = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const value of values) {
    const text = asText(value, maxLen).toLowerCase();
    if (!text || out.includes(text)) continue;
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
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
  const envBase = asText(process.env.EXPO_PUBLIC_CALL_CONTACT_HTTP_BASE_URL || "", 260);
  const envFriendBase = asText(process.env.EXPO_PUBLIC_CALL_FRIEND_HTTP_BASE_URL || "", 260);
  const envFavoriteBase = asText(process.env.EXPO_PUBLIC_CALL_FAVORITE_HTTP_BASE_URL || "", 260);
  const envRecallBase = asText(process.env.EXPO_PUBLIC_CALL_RECALL_HTTP_BASE_URL || "", 260);
  const envListBase = asText(process.env.EXPO_PUBLIC_CALL_CONTACT_LIST_HTTP_BASE_URL || "", 260);
  const cfgAuth = asText(APP_CONFIG.AUTH_HTTP_BASE_URL || "", 260);
  const cfgPopTalk = asText(APP_CONFIG.POPTALK?.httpBaseUrl || "", 260);
  const cfgSignal = asText(APP_CONFIG.SIGNALING_URL || "", 260);
  const raw = [envBase, envFriendBase, envFavoriteBase, envRecallBase, envListBase, cfgAuth, cfgPopTalk, httpsBaseFromWs(cfgSignal)]
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
            source: "call_screen",
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

function toCallContactItem(raw: any): CallContactItem | null {
  const contactKey = asText(raw?.contactKey || raw?.contact_key || "", 180);
  const peerSessionId = asText(raw?.peerSessionId || raw?.peer_session_id || "", 256);
  if (!contactKey && !peerSessionId) return null;
  return {
    contactKey: contactKey || peerSessionId,
    peerProfileId: asText(raw?.peerProfileId || raw?.peer_profile_id || "", 180) || undefined,
    peerSessionId: peerSessionId || undefined,
    peerSessionKey: asText(raw?.peerSessionKey || raw?.peer_session_key || "", 128) || undefined,
    peerUserId: asText(raw?.peerUserId || raw?.peer_user_id || "", 128) || undefined,
    peerNickname: asText(raw?.peerNickname || raw?.peer_nickname || raw?.nickname || "", 32) || undefined,
    peerAvatarUrl: asText(raw?.peerAvatarUrl || raw?.peer_avatar_url || raw?.avatarUrl || raw?.avatar_url || "", 420000) || undefined,
    peerLoginAccount: asText(raw?.peerLoginAccount || raw?.peer_login_account || "", 240) || undefined,
    peerCountry: asText(raw?.peerCountry || raw?.peer_country || "", 16) || undefined,
    peerLanguage: asText(raw?.peerLanguage || raw?.peer_language || raw?.peerLang || "", 16) || undefined,
    peerGender: asText(raw?.peerGender || raw?.peer_gender || "", 16) || undefined,
    peerFlag: asText(raw?.peerFlag || raw?.peer_flag || "", 8) || undefined,
    peerInterests: asStringArray(raw?.peerInterests ?? raw?.peer_interests ?? raw?.interests),
    roomId: asText(raw?.roomId || raw?.room_id || "", 120) || undefined,
    isFriend: asBool(raw?.isFriend ?? raw?.is_friend),
    isMutualFriend: asBool(raw?.isMutualFriend ?? raw?.is_mutual_friend ?? raw?.mutualFriend ?? raw?.mutual_friend),
    isFavorite: asBool(raw?.isFavorite ?? raw?.is_favorite),
    isOnline: asBool(raw?.isOnline ?? raw?.is_online),
    canRecall: asBool(raw?.canRecall ?? raw?.can_recall),
    friendAtMs: asNumber(raw?.friendAt ?? raw?.friend_at ?? raw?.friendAtMs),
    favoriteAtMs: asNumber(raw?.favoriteAt ?? raw?.favorite_at ?? raw?.favoriteAtMs),
    lastCallAtMs: asNumber(raw?.lastCallAt ?? raw?.last_call_at ?? raw?.lastCallAtMs),
    updatedAtMs: asNumber(raw?.updatedAt ?? raw?.updated_at ?? raw?.updatedAtMs),
  };
}

function toCallContactItems(raw: any): CallContactItem[] {
  const arr: any[] =
    (Array.isArray(raw?.contacts) && raw.contacts) ||
    (Array.isArray(raw?.items) && raw.items) ||
    (Array.isArray(raw?.rows) && raw.rows) ||
    [];
  return arr
    .map((it) => toCallContactItem(it))
    .filter((it: CallContactItem | null): it is CallContactItem => Boolean(it))
    .sort((a, b) => {
      const aRank = (a.isFavorite ? 2 : 0) + (a.isFriend ? 1 : 0);
      const bRank = (b.isFavorite ? 2 : 0) + (b.isFriend ? 1 : 0);
      if (bRank !== aRank) return bRank - aRank;
      if (b.lastCallAtMs !== a.lastCallAtMs) return b.lastCallAtMs - a.lastCallAtMs;
      return b.updatedAtMs - a.updatedAtMs;
    });
}

function toPendingRecallInvite(raw: any): PendingRecallInvite | null {
  const inviteId = asText(raw?.inviteId || raw?.invite_id || "", 128);
  if (!inviteId) return null;
  return {
    inviteId,
    actorSessionId: asText(raw?.actorSessionId || raw?.actor_session_id || "", 256) || undefined,
    actorProfileId: asText(raw?.actorProfileId || raw?.actor_profile_id || "", 180) || undefined,
    actorNickname: asText(raw?.actorNickname || raw?.actor_nickname || "", 32) || undefined,
    actorAvatarUrl: asText(raw?.actorAvatarUrl || raw?.actor_avatar_url || "", 420000) || undefined,
    actorCountry: asText(raw?.actorCountry || raw?.actor_country || "", 16) || undefined,
    actorLanguage: asText(raw?.actorLanguage || raw?.actor_language || "", 16) || undefined,
    actorGender: asText(raw?.actorGender || raw?.actor_gender || "", 16) || undefined,
    actorFlag: asText(raw?.actorFlag || raw?.actor_flag || "", 8) || undefined,
    actorLoginAccount: asText(raw?.actorLoginAccount || raw?.actor_login_account || "", 240) || undefined,
    createdAtMs: asNumber(raw?.createdAtMs ?? raw?.createdAt ?? raw?.created_at),
    expiresAtMs: asNumber(raw?.expiresAtMs ?? raw?.expiresAt ?? raw?.expires_at),
  };
}

export async function fetchCallContactsOnServer(input: FetchCallContactsInput): Promise<FetchCallContactsResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  if (!token || !userId || !deviceKey) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT", contacts: [] };
  }

  const limitRaw = Number(input.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, Math.trunc(limitRaw))) : 200;
  const customPath = asText(process.env.EXPO_PUBLIC_CALL_CONTACT_LIST_PATH || "", 240);
  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_CONTACT_LIST_ROUTE_NOT_FOUND",
    pathCandidates: [
      customPath || "",
      "/api/call/contacts",
      "/call/contacts",
      "/api/call/contact/list",
      "/call/contact/list",
    ].filter((v) => v.length > 0),
    body: {
      limit,
      roomId: asText(input.roomId || "", 120) || undefined,
      peerSessionId: asText(input.peerSessionId || "", 256) || undefined,
      peerProfileId: asText(input.peerProfileId || "", 180) || undefined,
      peerUserId: asText(input.peerUserId || "", 128) || undefined,
    },
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
      contacts: [],
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    contacts: toCallContactItems(out.json),
  };
}

export async function fetchCallFollowersOnServer(input: FetchCallContactsInput): Promise<FetchCallContactsResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  if (!token || !userId || !deviceKey) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT", contacts: [] };
  }

  const limitRaw = Number(input.limit);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(300, Math.trunc(limitRaw))) : 200;
  const customPath = asText(process.env.EXPO_PUBLIC_CALL_FOLLOWER_LIST_PATH || "", 240);
  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_FOLLOWER_LIST_ROUTE_NOT_FOUND",
    pathCandidates: [
      customPath || "",
      "/api/call/followers",
      "/call/followers",
      "/api/call/contact/followers",
      "/call/contact/followers",
    ].filter((v) => v.length > 0),
    body: {
      limit,
      roomId: asText(input.roomId || "", 120) || undefined,
      peerSessionId: asText(input.peerSessionId || "", 256) || undefined,
      peerProfileId: asText(input.peerProfileId || "", 180) || undefined,
      peerUserId: asText(input.peerUserId || "", 128) || undefined,
    },
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
      contacts: [],
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    contacts: toCallContactItems(out.json),
  };
}

async function mutateCallContact(
  input: MutateCallContactInput & {
    pathCandidates: string[];
    routeNotFoundCode: string;
  }
): Promise<MutateCallContactResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  const roomId = asText(input.roomId, 120);
  const peerSessionId = asText(input.peerSessionId || "", 256);
  const peerProfileId = asText(input.peerProfileId || "", 180);
  if (!token || !userId || !deviceKey || (!roomId && !peerSessionId && !peerProfileId)) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT" };
  }

  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: input.routeNotFoundCode,
    pathCandidates: input.pathCandidates,
    body: {
      roomId: roomId || undefined,
      peerSessionId: peerSessionId || undefined,
      peerProfileId: peerProfileId || undefined,
      peerUserId: asText(input.peerUserId || "", 128) || undefined,
      peerCountry: asText(input.peerCountry || "", 16) || undefined,
      peerLanguage: asText(input.peerLanguage || "", 16) || undefined,
      peerGender: asText(input.peerGender || "", 16) || undefined,
      peerFlag: asText(input.peerFlag || "", 8) || undefined,
      enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    },
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    contact: toCallContactItem(out.json?.contact) || undefined,
  };
}

export async function setCallFriendOnServer(input: MutateCallContactInput): Promise<MutateCallContactResult> {
  const customPath = asText(process.env.EXPO_PUBLIC_CALL_FRIEND_PATH || "", 240);
  return mutateCallContact({
    ...input,
    routeNotFoundCode: "CALL_FRIEND_ROUTE_NOT_FOUND",
    pathCandidates: [
      customPath || "",
      "/api/call/friend",
      "/call/friend",
      "/api/call/contact/friend",
      "/call/contact/friend",
    ].filter((v) => v.length > 0),
  });
}

export async function setCallFavoriteOnServer(input: MutateCallContactInput): Promise<MutateCallContactResult> {
  const customPath = asText(process.env.EXPO_PUBLIC_CALL_FAVORITE_PATH || "", 240);
  return mutateCallContact({
    ...input,
    routeNotFoundCode: "CALL_FAVORITE_ROUTE_NOT_FOUND",
    pathCandidates: [
      customPath || "",
      "/api/call/favorite",
      "/call/favorite",
      "/api/call/contact/favorite",
      "/call/contact/favorite",
    ].filter((v) => v.length > 0),
  });
}

export async function recallCallContactOnServer(input: RecallCallContactInput): Promise<RecallCallContactResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  const peerSessionId = asText(input.peerSessionId || "", 256);
  const peerProfileId = asText(input.peerProfileId || "", 180);
  if (!token || !userId || !deviceKey || (!peerSessionId && !peerProfileId)) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT" };
  }

  const customPath = asText(process.env.EXPO_PUBLIC_CALL_RECALL_PATH || "", 240);
  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_RECALL_ROUTE_NOT_FOUND",
    pathCandidates: [
      customPath || "",
      "/api/call/recall",
      "/call/recall",
      "/api/call/contact/recall",
      "/call/contact/recall",
    ].filter((v) => v.length > 0),
    body: {
      peerSessionId: peerSessionId || undefined,
      peerProfileId: peerProfileId || undefined,
    },
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    actorSessionId: asText(out.json?.actorSessionId || "", 256) || undefined,
    peerSessionId: asText(out.json?.peerSessionId || "", 256) || undefined,
    invitePending: out.json?.invitePending === true,
    inviteId: asText(out.json?.inviteId || "", 128) || undefined,
  };
}

export async function fetchPendingRecallInviteOnServer(input: CallContactBaseInput): Promise<FetchPendingRecallInviteResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  if (!token || !userId || !deviceKey) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT", invite: null };
  }

  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_RECALL_PENDING_ROUTE_NOT_FOUND",
    pathCandidates: [
      "/api/call/recall/pending",
      "/call/recall/pending",
      "/api/call/contact/recall/pending",
      "/call/contact/recall/pending",
    ],
    body: {},
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
      invite: null,
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    invite: toPendingRecallInvite(out.json?.invite) || null,
  };
}

export async function respondRecallInviteOnServer(input: RespondRecallInviteInput): Promise<RespondRecallInviteResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  const inviteId = asText(input.inviteId, 128);
  if (!token || !userId || !deviceKey || !inviteId) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT" };
  }

  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_RECALL_RESPOND_ROUTE_NOT_FOUND",
    pathCandidates: [
      "/api/call/recall/respond",
      "/call/recall/respond",
      "/api/call/contact/recall/respond",
      "/call/contact/recall/respond",
    ],
    body: {
      inviteId,
      accept: input.accept === true,
      blockFuture: input.blockFuture === true,
    },
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    actorSessionId: asText(out.json?.actorSessionId || "", 256) || undefined,
    peerSessionId: asText(out.json?.peerSessionId || "", 256) || undefined,
    inviteId: asText(out.json?.inviteId || "", 128) || undefined,
    blocked: out.json?.blocked === true,
    declined: out.json?.declined === true,
  };
}

export async function fetchRecallInviteStatusOnServer(input: FetchRecallInviteStatusInput): Promise<FetchRecallInviteStatusResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  const inviteId = asText(input.inviteId, 128);
  if (!token || !userId || !deviceKey || !inviteId) {
    return { ok: false, errorCode: "INVALID_INPUT", errorMessage: "INVALID_INPUT" };
  }

  const out = await postCandidates({
    token,
    userId,
    deviceKey,
    routeNotFoundCode: "CALL_RECALL_STATUS_ROUTE_NOT_FOUND",
    pathCandidates: [
      "/api/call/recall/status",
      "/call/recall/status",
      "/api/call/contact/recall/status",
      "/call/contact/recall/status",
    ],
    body: {
      inviteId,
    },
  });

  if (!out.ok) {
    return {
      ok: false,
      errorCode: out.errorCode,
      errorMessage: out.errorMessage,
    };
  }

  return {
    ok: true,
    errorCode: "",
    errorMessage: "",
    inviteId: asText(out.json?.inviteId || "", 128) || undefined,
    status: asText(out.json?.status || "", 24) || undefined,
    actorSessionId: asText(out.json?.actorSessionId || "", 256) || undefined,
    peerSessionId: asText(out.json?.peerSessionId || "", 256) || undefined,
    acceptedPeerSessionId: asText(out.json?.acceptedPeerSessionId || "", 256) || undefined,
    updatedAtMs: asNumber(out.json?.updatedAtMs ?? out.json?.updatedAt),
    expiresAtMs: asNumber(out.json?.expiresAtMs ?? out.json?.expiresAt),
  };
}
