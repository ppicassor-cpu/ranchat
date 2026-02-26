import { APP_CONFIG } from "../../config/app";

export type SyncProfilePayload = {
  token: string | null | undefined;
  userId?: string | null;
  deviceKey?: string | null;
  country?: string | null;
  language?: string | null;
  gender?: string | null;
  dinoBestScore?: number | null;
  dinoBestComment?: string | null;
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

export async function syncProfileToServer(input: SyncProfilePayload): Promise<boolean> {
  const token = String(input.token || "").trim();
  if (!token) return false;

  const country = String(input.country || "").trim().toUpperCase();
  const dinoBestComment = String(input.dinoBestComment || "").trim().slice(0, 60);
  const dinoBestScore = Math.max(0, Math.trunc(Number(input.dinoBestScore || 0)));
  const flag = countryCodeToFlagEmoji(country);
  const includeDinoFields = input.dinoBestComment != null || input.dinoBestScore != null;

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
    profile: {
      country: country || null,
      language: input.language ?? null,
      gender: input.gender ?? null,
      flag: flag || null,
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
  if (!bases.length) return false;

  const candidates = resolveCandidates();
  let lastErrText = "";

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
    throw new Error(`PROFILE_SYNC_FAILED:${lastErrText}`);
  }
  return false;
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
