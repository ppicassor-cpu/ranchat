import { APP_CONFIG } from "../../config/app";
import { normalizeMatchInterests } from "../call/MatchFilterService";

const PROFILE_NICKNAME_MAX_LEN = 12;
const PROFILE_INTEREST_MAX_COUNT = 3;

export type SyncProfilePayload = {
  token: string | null | undefined;
  userId?: string | null;
  deviceKey?: string | null;
  country?: string | null;
  language?: string | null;
  gender?: string | null;
  dinoBestScore?: number | null;
  dinoBestComment?: string | null;
  nickname?: string | null;
  interests?: string[] | null;
  avatarDataUrl?: string | null;
  avatarUrl?: string | null;
};

type Candidate = {
  method: "POST" | "PUT" | "PATCH";
  path: string;
};

type LeaderboardSubmitCandidate = {
  method: "POST" | "PUT";
  path: string;
};

export type DinoLeaderboardEntry = {
  rank: number;
  score: number;
  flag: string;
  comment: string;
};

export type ProfileSyncResult = {
  ok: boolean;
  dinoBestScore: number;
  dinoBestComment: string | null;
  country: string | null;
  language: string | null;
  gender: string | null;
  flag: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  interests: string[] | null;
  avatarUpdatedAt: number | null;
  updatedAt: number | null;
  hasNickname?: boolean;
  hasAvatarUrl?: boolean;
  hasInterests?: boolean;
  hasAvatarUpdatedAt?: boolean;
  hasUpdatedAt?: boolean;
};

export type ProfileStateSnapshot = {
  nickname: string | null;
  avatarUrl: string | null;
  interests: string[] | null;
  avatarUpdatedAt: number | null;
  updatedAt: number | null;
};

export type SubmitDinoRankPayload = {
  token: string | null | undefined;
  userId?: string | null;
  deviceKey?: string | null;
  country?: string | null;
  score: number;
  comment?: string | null;
  obtainedAt?: number | null;
  clientEntryId?: string | null;
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

function countryCodeToFlagEmoji(code: string): string {
  const cc = String(code || "").trim().toUpperCase();
  if (cc.length !== 2) return "";
  const a = 0x1f1e6;
  const c1 = cc.charCodeAt(0) - 65;
  const c2 = cc.charCodeAt(1) - 65;
  if (c1 < 0 || c1 > 25 || c2 < 0 || c2 > 25) return "";
  return String.fromCodePoint(a + c1, a + c2);
}

function resolveBases(): string[] {
  const envBase = String(process.env.EXPO_PUBLIC_PROFILE_HTTP_BASE_URL ?? "").trim();
  const cfgAuth = String(APP_CONFIG.AUTH_HTTP_BASE_URL ?? "").trim();
  const cfgSignal = String(APP_CONFIG.SIGNALING_URL ?? "").trim();

  const raw = [envBase, cfgAuth, httpsBaseFromWs(cfgSignal)].map((v) => normalizeHttpsBase(v)).filter((v) => v.length > 0);
  return Array.from(new Set(raw));
}

function resolveCandidates(): Candidate[] {
  const customPath = String(process.env.EXPO_PUBLIC_PROFILE_SYNC_PATH ?? "").trim();
  const custom = customPath ? [{ method: "POST" as const, path: customPath.startsWith("/") ? customPath : `/${customPath}` }] : [];

  return [
    ...custom,
    { method: "POST", path: "/api/profile/sync" },
    { method: "POST", path: "/profile/sync" },
    { method: "PATCH", path: "/api/profile" },
    { method: "PUT", path: "/api/profile" },
    { method: "POST", path: "/api/profile" },
    { method: "PATCH", path: "/profile" },
    { method: "PUT", path: "/profile" },
    { method: "POST", path: "/profile" },
    { method: "PATCH", path: "/api/user/profile" },
    { method: "POST", path: "/api/user/profile" },
    { method: "PATCH", path: "/api/users/me/profile" },
    { method: "POST", path: "/api/users/me/profile" },
    { method: "PATCH", path: "/api/me/profile" },
    { method: "POST", path: "/api/me/profile" },
    { method: "POST", path: "/api/user-meta" },
    { method: "POST", path: "/api/user/meta" },
  ];
}

function resolveLeaderboardPaths(): string[] {
  const customPath = String(process.env.EXPO_PUBLIC_DINO_LEADERBOARD_PATH ?? "").trim();
  const normalizedCustom = customPath ? (customPath.startsWith("/") ? customPath : `/${customPath}`) : "";

  const base = [
    "/api/dino/leaderboard",
    "/api/leaderboard/dino",
    "/api/leaderboards/dino",
    "/api/leaderboard?game=dino",
    "/leaderboard/dino",
  ];

  return normalizedCustom ? [normalizedCustom, ...base] : base;
}

function resolveLeaderboardSubmitCandidates(): LeaderboardSubmitCandidate[] {
  const customPath = String(process.env.EXPO_PUBLIC_DINO_LEADERBOARD_SUBMIT_PATH ?? "").trim();
  const normalizedCustom = customPath ? (customPath.startsWith("/") ? customPath : `/${customPath}`) : "";

  const postPaths = [
    "/api/dino/leaderboard/submit",
    "/api/dino/leaderboard/entry",
    "/api/dino/leaderboard",
    "/api/leaderboard/dino/submit",
    "/api/leaderboard/dino/entry",
    "/api/leaderboard/dino",
    "/leaderboard/dino/submit",
    "/leaderboard/dino/entry",
    "/leaderboard/dino",
  ];
  const putPaths = ["/api/dino/leaderboard", "/api/leaderboard/dino", "/leaderboard/dino"];

  const postCandidates = postPaths.map((path) => ({ method: "POST" as const, path }));
  const putCandidates = putPaths.map((path) => ({ method: "PUT" as const, path }));
  const customCandidates = normalizedCustom
    ? [
        { method: "POST" as const, path: normalizedCustom },
        { method: "PUT" as const, path: normalizedCustom },
      ]
    : [];

  return [...customCandidates, ...postCandidates, ...putCandidates];
}

function normalizeLeaderboardPayload(json: any): DinoLeaderboardEntry[] {
  const listLike =
    (Array.isArray(json) && json) ||
    (Array.isArray(json?.items) && json.items) ||
    (Array.isArray(json?.rows) && json.rows) ||
    (Array.isArray(json?.list) && json.list) ||
    (Array.isArray(json?.data) && json.data) ||
    (Array.isArray(json?.rankings) && json.rankings) ||
    [];

  const mapped = listLike
    .map((it: any, idx: number) => {
      const scoreRaw = Number(it?.score ?? it?.bestScore ?? it?.dinoBestScore ?? it?.record ?? it?.value ?? 0);
      const score = Number.isFinite(scoreRaw) ? Math.max(0, Math.trunc(scoreRaw)) : 0;
      const country = String(it?.country ?? it?.countryCode ?? "").trim();
      const flag = String(it?.flag ?? "").trim() || countryCodeToFlagEmoji(country);
      const comment = String(it?.dinoBestComment ?? it?.comment ?? it?.oneLineComment ?? it?.text ?? "").trim();
      const rankRaw = Number(it?.rank ?? it?.position ?? idx + 1);
      const rank = Number.isFinite(rankRaw) ? Math.max(1, Math.trunc(rankRaw)) : idx + 1;

      return { rank, score, flag, comment };
    })
    .filter((it: DinoLeaderboardEntry) => Number.isFinite(it.score) && it.score > 0);

  const sorted = [...mapped].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.rank - b.rank;
  });

  return sorted.slice(0, 10).map((it, idx) => ({ ...it, rank: idx + 1 }));
}

function toNullableText(value: unknown, maxLen = 240): string | null {
  const text = String(value || "").trim().slice(0, maxLen);
  return text || null;
}

function toNullableNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.trunc(numeric)) : null;
}

function hasOwnField(value: unknown, key: string): boolean {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeProfileStateSnapshot(value: Partial<ProfileStateSnapshot> | null | undefined): ProfileStateSnapshot {
  const interests = normalizeMatchInterests(value?.interests, { allowAll: false, fallbackToAll: false }).slice(0, PROFILE_INTEREST_MAX_COUNT);
  return {
    nickname: toNullableText(value?.nickname, PROFILE_NICKNAME_MAX_LEN),
    avatarUrl: toNullableText(value?.avatarUrl, 420000),
    interests: interests.length > 0 ? interests : [],
    avatarUpdatedAt: toNullableNumber(value?.avatarUpdatedAt),
    updatedAt: toNullableNumber(value?.updatedAt),
  };
}

function normalizeProfileSyncResult(json: any): ProfileSyncResult {
  const profile = json && typeof json === "object" && json.profile && typeof json.profile === "object" ? json.profile : {};
  const hasNickname = hasOwnField(json, "nickname") || hasOwnField(profile, "nickname");
  const hasAvatarUrl =
    hasOwnField(json, "avatarUrl") ||
    hasOwnField(json, "avatarDataUrl") ||
    hasOwnField(profile, "avatarUrl") ||
    hasOwnField(profile, "avatarDataUrl");
  const hasInterests = hasOwnField(json, "interests") || hasOwnField(profile, "interests");
  const hasAvatarUpdatedAt = hasOwnField(json, "avatarUpdatedAt") || hasOwnField(profile, "avatarUpdatedAt");
  const hasUpdatedAt = hasOwnField(json, "updatedAt") || hasOwnField(profile, "updatedAt");
  const nickname =
    toNullableText(json?.nickname, PROFILE_NICKNAME_MAX_LEN) ??
    toNullableText(profile?.nickname, PROFILE_NICKNAME_MAX_LEN);
  const avatarUrl =
    toNullableText(json?.avatarUrl, 420000) ??
    toNullableText(json?.avatarDataUrl, 420000) ??
    toNullableText(profile?.avatarUrl, 420000) ??
    toNullableText(profile?.avatarDataUrl, 420000);
  const interests = normalizeMatchInterests(
    json?.interests ??
    profile?.interests,
    { allowAll: false, fallbackToAll: false }
  ).slice(0, PROFILE_INTEREST_MAX_COUNT);

  return {
    ok: Boolean(json?.ok ?? true),
    dinoBestScore: Math.max(0, Math.trunc(Number(json?.dinoBestScore ?? profile?.dinoBestScore ?? 0) || 0)),
    dinoBestComment: toNullableText(json?.dinoBestComment ?? profile?.dinoBestComment, 120),
    country: toNullableText(json?.country ?? profile?.country, 16),
    language: toNullableText(json?.language ?? profile?.language, 32),
    gender: toNullableText(json?.gender ?? profile?.gender, 32),
    flag: toNullableText(json?.flag ?? profile?.flag, 12),
    nickname,
    avatarUrl,
    interests: interests.length > 0 ? interests : null,
    avatarUpdatedAt: toNullableNumber(json?.avatarUpdatedAt ?? profile?.avatarUpdatedAt),
    updatedAt: toNullableNumber(json?.updatedAt ?? profile?.updatedAt),
    hasNickname,
    hasAvatarUrl,
    hasInterests,
    hasAvatarUpdatedAt,
    hasUpdatedAt,
  };
}

export function mergeProfileSyncResult(
  current: Partial<ProfileStateSnapshot> | null | undefined,
  incoming: ProfileSyncResult | null | undefined,
  fallback?: Partial<ProfileStateSnapshot> | null,
): ProfileStateSnapshot {
  const currentProfile = normalizeProfileStateSnapshot(current);
  if (!incoming || typeof incoming !== "object") {
    return normalizeProfileStateSnapshot({ ...currentProfile, ...(fallback || {}) });
  }

  const fallbackProfile = normalizeProfileStateSnapshot(fallback);
  const hasFallbackNickname = hasOwnField(fallback, "nickname");
  const hasFallbackAvatarUrl = hasOwnField(fallback, "avatarUrl");
  const hasFallbackInterests = hasOwnField(fallback, "interests");
  const hasFallbackAvatarUpdatedAt = hasOwnField(fallback, "avatarUpdatedAt");
  const hasFallbackUpdatedAt = hasOwnField(fallback, "updatedAt");

  const incomingUpdatedAt = incoming.hasUpdatedAt ? toNullableNumber(incoming.updatedAt) : null;
  const currentUpdatedAt = currentProfile.updatedAt;
  const isStaleIncoming =
    incoming.hasUpdatedAt &&
    incomingUpdatedAt != null &&
    currentUpdatedAt != null &&
    incomingUpdatedAt < currentUpdatedAt &&
    !hasFallbackNickname &&
    !hasFallbackAvatarUrl &&
    !hasFallbackInterests &&
    !hasFallbackAvatarUpdatedAt &&
    !hasFallbackUpdatedAt;

  if (isStaleIncoming) {
    return currentProfile;
  }

  const nextNickname = incoming.hasNickname
    ? toNullableText(incoming.nickname, PROFILE_NICKNAME_MAX_LEN)
    : hasFallbackNickname
    ? fallbackProfile.nickname
    : currentProfile.nickname;

  const nextAvatarUrl = incoming.hasAvatarUrl
    ? toNullableText(incoming.avatarUrl, 420000)
    : hasFallbackAvatarUrl
    ? fallbackProfile.avatarUrl
    : currentProfile.avatarUrl;

  const nextInterests = incoming.hasInterests
    ? normalizeMatchInterests(incoming.interests, { allowAll: false, fallbackToAll: false }).slice(0, PROFILE_INTEREST_MAX_COUNT)
    : hasFallbackInterests
    ? normalizeMatchInterests(fallbackProfile.interests, { allowAll: false, fallbackToAll: false }).slice(0, PROFILE_INTEREST_MAX_COUNT)
    : normalizeMatchInterests(currentProfile.interests, { allowAll: false, fallbackToAll: false }).slice(0, PROFILE_INTEREST_MAX_COUNT);

  const nextUpdatedAt =
    incomingUpdatedAt ??
    (hasFallbackUpdatedAt ? fallbackProfile.updatedAt : null) ??
    currentProfile.updatedAt;

  let nextAvatarUpdatedAt = currentProfile.avatarUpdatedAt;
  if (incoming.hasAvatarUpdatedAt) {
    nextAvatarUpdatedAt = toNullableNumber(incoming.avatarUpdatedAt);
  } else if (hasFallbackAvatarUpdatedAt) {
    nextAvatarUpdatedAt = fallbackProfile.avatarUpdatedAt;
  } else if ((incoming.hasAvatarUrl || hasFallbackAvatarUrl) && nextAvatarUrl !== currentProfile.avatarUrl) {
    nextAvatarUpdatedAt = nextUpdatedAt ?? Date.now();
  }

  return {
    nickname: nextNickname,
    avatarUrl: nextAvatarUrl,
    interests: nextInterests.length > 0 ? nextInterests : [],
    avatarUpdatedAt: nextAvatarUpdatedAt,
    updatedAt: nextUpdatedAt,
  };
}

function buildProfileSyncError(status: number, body: any, rawText: string): Error {
  const detail =
    toNullableText(body?.detail, 240) ??
    toNullableText(body?.message, 240) ??
    toNullableText(rawText, 240);
  const error = new Error(
    detail ??
      toNullableText(body?.error, 120) ??
      toNullableText(rawText, 240) ??
      `HTTP_${status}`
  ) as Error & { code?: string; status?: number; detail?: string | null };
  error.code = String(body?.error || body?.code || "").trim() || `HTTP_${status}`;
  error.status = status;
  error.detail = detail;
  return error;
}

export async function syncProfileToServer(input: SyncProfilePayload): Promise<ProfileSyncResult | null> {
  const token = String(input.token || "").trim();
  if (!token) return null;

  const country = String(input.country || "").trim().toUpperCase();
  const dinoBestComment = String(input.dinoBestComment || "").trim().slice(0, 60);
  const dinoBestScore = Math.max(0, Math.trunc(Number(input.dinoBestScore || 0)));
  const flag = countryCodeToFlagEmoji(country);
  const includeDinoFields = input.dinoBestComment != null || input.dinoBestScore != null;
  const includeNickname = Object.prototype.hasOwnProperty.call(input, "nickname");
  const includeInterests = Object.prototype.hasOwnProperty.call(input, "interests");
  const includeAvatar =
    Object.prototype.hasOwnProperty.call(input, "avatarDataUrl") ||
    Object.prototype.hasOwnProperty.call(input, "avatarUrl");
  const nickname = String(input.nickname || "").trim().slice(0, PROFILE_NICKNAME_MAX_LEN);
  const avatarDataUrl = String(input.avatarDataUrl ?? input.avatarUrl ?? "").trim();
  const interests = normalizeMatchInterests(input.interests, { allowAll: false, fallbackToAll: false }).slice(0, PROFILE_INTEREST_MAX_COUNT);

  const body = {
    userId: input.userId ?? null,
    deviceKey: input.deviceKey ?? null,
    country: country || null,
    language: input.language ?? null,
    gender: input.gender ?? null,
    flag: flag || null,
    ...(includeDinoFields
      ? {
          dinoBestScore,
          dinoBestComment: dinoBestComment || null,
          comment: dinoBestComment || null,
          oneLineComment: dinoBestComment || null,
        }
      : {}),
    ...(includeNickname ? { nickname: nickname || null } : {}),
    ...(includeInterests ? { interests: interests.length > 0 ? interests : [] } : {}),
    ...(includeAvatar ? { avatarDataUrl: avatarDataUrl || null, avatarUrl: avatarDataUrl || null } : {}),
    profile: {
      country: country || null,
      language: input.language ?? null,
      gender: input.gender ?? null,
      flag: flag || null,
      ...(includeNickname ? { nickname: nickname || null } : {}),
      ...(includeInterests ? { interests: interests.length > 0 ? interests : [] } : {}),
      ...(includeAvatar ? { avatarDataUrl: avatarDataUrl || null, avatarUrl: avatarDataUrl || null } : {}),
      ...(includeDinoFields
        ? {
            comment: dinoBestComment || null,
            oneLineComment: dinoBestComment || null,
          }
        : {}),
    },
    ...(includeDinoFields
      ? {
          stats: {
            dinoBestScore,
            dinoBestComment: dinoBestComment || null,
          },
        }
      : {}),
  };

  const bases = resolveBases();
  if (!bases.length) return null;

  const candidates = resolveCandidates();
  let lastError: Error | null = null;

  for (const base of bases) {
    for (const c of candidates) {
      const url = `${base}${c.path}`;

      try {
        const res = await fetch(url, {
          method: c.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-User-Id": String(input.userId || ""),
            "X-Device-Key": String(input.deviceKey || ""),
          },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          const json = await res.json().catch(() => null);
          return normalizeProfileSyncResult(json);
        }

        if (res.status === 404 || res.status === 405) continue;

        const txt = await res.text().catch(() => "");
        let json: any = null;
        try {
          json = txt ? JSON.parse(txt) : null;
        } catch {
          json = null;
        }
        lastError = buildProfileSyncError(res.status, json, txt);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error("REQUEST_FAILED");
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

export async function fetchDinoLeaderboard(token?: string | null): Promise<DinoLeaderboardEntry[]> {
  const bases = resolveBases();
  if (!bases.length) return [];

  const paths = resolveLeaderboardPaths();
  const auth = String(token || "").trim();

  for (const base of bases) {
    for (const path of paths) {
      const url = `${base}${path}`;
      try {
        const res = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          },
        });

        if (!res.ok) {
          if (res.status === 404 || res.status === 405) continue;
          continue;
        }

        const json = await res.json().catch(() => null);
        const rows = normalizeLeaderboardPayload(json);
        if (rows.length > 0) return rows;
      } catch {
        // Try the next endpoint candidate.
      }
    }
  }

  return [];
}

export async function submitDinoRankEntry(input: SubmitDinoRankPayload): Promise<boolean> {
  const token = String(input.token || "").trim();
  if (!token) return false;

  const country = String(input.country || "").trim().toUpperCase();
  const flag = countryCodeToFlagEmoji(country);
  const score = Math.max(0, Math.trunc(Number(input.score || 0)));
  if (score <= 0) return false;
  const comment = String(input.comment || "").trim().slice(0, 60);
  const obtainedAt = Math.max(0, Math.trunc(Number(input.obtainedAt || Date.now())));
  const clientEntryId = String(input.clientEntryId || "").trim();

  const bases = resolveBases();
  if (!bases.length) return false;

  const candidates = resolveLeaderboardSubmitCandidates();
  let lastErrText = "";

  const body = {
    userId: input.userId ?? null,
    deviceKey: input.deviceKey ?? null,
    country: country || null,
    flag: flag || null,
    score,
    dinoBestScore: score,
    comment: comment || null,
    dinoBestComment: comment || null,
    oneLineComment: comment || null,
    obtainedAt,
    achievedAt: obtainedAt,
    clientEntryId: clientEntryId || null,
    entry: {
      score,
      flag: flag || null,
      country: country || null,
      comment: comment || null,
      obtainedAt,
      clientEntryId: clientEntryId || null,
    },
  };

  for (const base of bases) {
    for (const c of candidates) {
      const url = `${base}${c.path}`;
      try {
        const res = await fetch(url, {
          method: c.method,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-User-Id": String(input.userId || ""),
            "X-Device-Key": String(input.deviceKey || ""),
          },
          body: JSON.stringify(body),
        });

        if (res.ok) return true;

        if (res.status === 404 || res.status === 405) continue;
        const txt = await res.text().catch(() => "");
        lastErrText = `HTTP_${res.status}:${txt}`;
      } catch (e) {
        lastErrText = e instanceof Error ? e.message : "REQUEST_FAILED";
      }
    }
  }

  if (lastErrText) {
    throw new Error(`DINO_RANK_SUBMIT_FAILED:${lastErrText}`);
  }
  return false;
}
