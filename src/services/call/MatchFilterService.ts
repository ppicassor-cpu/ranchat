import { APP_CONFIG } from "../../config/app";
import { COUNTRY_CODES, LANGUAGE_CODES, normalizeLanguageCode } from "../../i18n/displayNames";

export const MATCH_FILTER_ALL = "ALL" as const;
export type MatchFilterGender = "male" | "female" | "all";

export type MatchFilter = {
  countries: string[];
  languages: string[];
  gender: MatchFilterGender;
  updatedAt?: number | null;
};

export type MatchFilterBaseInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey: string | null | undefined;
};

export type FetchMatchFilterResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  filter: MatchFilter;
  filterFound: boolean;
};

export type SaveMatchFilterInput = MatchFilterBaseInput & {
  filter: Partial<MatchFilter> | MatchFilter;
};

export type SaveMatchFilterResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  filter: MatchFilter;
};

const COUNTRY_CODE_SET = new Set(COUNTRY_CODES.map((v) => String(v || "").trim().toUpperCase()));
const LANGUAGE_CODE_SET = new Set(LANGUAGE_CODES.map((v) => String(v || "").trim().toLowerCase()));

function asText(v: unknown, maxLen = 320): string {
  return String(v ?? "").trim().slice(0, maxLen);
}

function normalizeHttpsBase(v: string): string {
  const s = asText(v, 512);
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

function normalizePath(pathLike: string): string {
  const p = asText(pathLike, 280);
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function resolveBases(): string[] {
  const envBase = asText(process.env.EXPO_PUBLIC_MATCH_FILTER_HTTP_BASE_URL || "", 512);
  const cfgAuth = asText(APP_CONFIG.AUTH_HTTP_BASE_URL || "", 512);
  const cfgPopTalk = asText(APP_CONFIG.POPTALK?.httpBaseUrl || "", 512);
  const cfgSignal = asText(APP_CONFIG.SIGNALING_URL || "", 512);

  const raw = [envBase, cfgAuth, cfgPopTalk, httpsBaseFromWs(cfgSignal)]
    .map((v) => normalizeHttpsBase(v))
    .filter((v) => v.length > 0);

  return Array.from(new Set(raw));
}

function resolvePaths(): string[] {
  const customPath = asText(process.env.EXPO_PUBLIC_MATCH_FILTER_PATH || process.env.EXPO_PUBLIC_MATCHING_FILTER_PATH || "", 280);
  const raw = [
    customPath,
    "/api/match/filter",
    "/match/filter",
    "/api/matching/filter",
    "/matching/filter",
    "/api/call/match-filter",
    "/call/match-filter",
  ].filter((v) => v.length > 0);
  return Array.from(new Set(raw.map((p) => normalizePath(p))));
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter((x) => x.length > 0);
  const one = String(v ?? "").trim();
  return one ? [one] : [];
}

function normalizeCountries(raw: unknown): string[] {
  const arr = toArray(raw);
  const out: string[] = [];
  for (const value of arr) {
    const up = String(value || "").trim().toUpperCase();
    if (!up) continue;
    if (up === MATCH_FILTER_ALL) return [MATCH_FILTER_ALL];
    if (!COUNTRY_CODE_SET.has(up)) continue;
    if (!out.includes(up)) out.push(up);
  }
  return out.length > 0 ? out : [MATCH_FILTER_ALL];
}

function normalizeLanguages(raw: unknown): string[] {
  const arr = toArray(raw);
  const out: string[] = [];
  for (const value of arr) {
    const base = String(value || "").trim();
    if (!base) continue;
    const upper = base.toUpperCase();
    if (upper === MATCH_FILTER_ALL) return [MATCH_FILTER_ALL];
    const code = normalizeLanguageCode(base);
    if (!code || !LANGUAGE_CODE_SET.has(code)) continue;
    if (!out.includes(code)) out.push(code);
  }
  return out.length > 0 ? out : [MATCH_FILTER_ALL];
}

function normalizeGender(raw: unknown): MatchFilterGender {
  const g = String(raw || "").trim().toLowerCase();
  if (g === "male" || g === "female" || g === "all") return g;
  return "all";
}

export function createDefaultMatchFilter(): MatchFilter {
  return {
    countries: [MATCH_FILTER_ALL],
    languages: [MATCH_FILTER_ALL],
    gender: "all",
    updatedAt: null,
  };
}

export function normalizeMatchFilter(raw: Partial<MatchFilter> | MatchFilter | null | undefined): MatchFilter {
  const base = raw || {};
  return {
    countries: normalizeCountries((base as any).countries),
    languages: normalizeLanguages((base as any).languages),
    gender: normalizeGender((base as any).gender),
    updatedAt: Number.isFinite(Number((base as any).updatedAt)) ? Math.trunc(Number((base as any).updatedAt)) : null,
  };
}

function parseMatchFilterFromJson(json: any): { filter: MatchFilter; filterFound: boolean } {
  const payload =
    json?.filter ||
    json?.data?.filter ||
    json?.data ||
    json ||
    {};
  const filter = normalizeMatchFilter({
    countries:
      payload?.countries ??
      payload?.countryCodes ??
      payload?.countryFilter ??
      payload?.country ??
      undefined,
    languages:
      payload?.languages ??
      payload?.languageCodes ??
      payload?.languageFilter ??
      payload?.language ??
      undefined,
    gender:
      payload?.gender ??
      payload?.genderFilter ??
      undefined,
    updatedAt: payload?.updatedAt ?? payload?.savedAt ?? undefined,
  });
  const filterFound =
    Array.isArray(payload?.countries) ||
    Array.isArray(payload?.countryCodes) ||
    Array.isArray(payload?.languages) ||
    Array.isArray(payload?.languageCodes) ||
    typeof payload?.gender === "string" ||
    typeof payload?.genderFilter === "string";

  return { filter, filterFound };
}

export async function fetchMatchFilterOnServer(input: MatchFilterBaseInput): Promise<FetchMatchFilterResult> {
  const token = asText(input.token, 1000);
  const userId = asText(input.userId, 180);
  const deviceKey = asText(input.deviceKey, 280);
  if (!token || !userId || !deviceKey) {
    return {
      ok: false,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
      filter: createDefaultMatchFilter(),
      filterFound: false,
    };
  }

  const bases = resolveBases();
  if (bases.length <= 0) {
    return {
      ok: false,
      errorCode: "HTTP_BASE_URL_MISSING",
      errorMessage: "HTTP_BASE_URL_MISSING",
      filter: createDefaultMatchFilter(),
      filterFound: false,
    };
  }

  const paths = resolvePaths();
  let lastFail: FetchMatchFilterResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "x-user-id": userId,
            "x-device-key": deviceKey,
          },
        });
        const bodyText = await res.text().catch(() => "");
        let json: any = {};
        try {
          json = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          json = {};
        }
        if (res.status === 404) continue;
        if (res.ok) {
          const parsed = parseMatchFilterFromJson(json);
          return {
            ok: true,
            errorCode: "",
            errorMessage: "",
            filter: parsed.filter,
            filterFound: parsed.filterFound,
          };
        }
        lastFail = {
          ok: false,
          errorCode: asText(json?.errorCode || json?.error || `HTTP_${res.status}`, 120) || `HTTP_${res.status}`,
          errorMessage: asText(json?.errorMessage || json?.message || json?.error || `HTTP_${res.status}`, 240) || `HTTP_${res.status}`,
          filter: createDefaultMatchFilter(),
          filterFound: false,
        };
      } catch {
        lastFail = {
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: "NETWORK_ERROR",
          filter: createDefaultMatchFilter(),
          filterFound: false,
        };
      }
    }
  }

  if (lastFail) return lastFail;
  return {
    ok: false,
    errorCode: "MATCH_FILTER_GET_ROUTE_NOT_FOUND",
    errorMessage: "MATCH_FILTER_GET_ROUTE_NOT_FOUND",
    filter: createDefaultMatchFilter(),
    filterFound: false,
  };
}

export async function saveMatchFilterOnServer(input: SaveMatchFilterInput): Promise<SaveMatchFilterResult> {
  const token = asText(input.token, 1000);
  const userId = asText(input.userId, 180);
  const deviceKey = asText(input.deviceKey, 280);
  const normalized = normalizeMatchFilter(input.filter || null);
  if (!token || !userId || !deviceKey) {
    return {
      ok: false,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
      filter: normalized,
    };
  }

  const bases = resolveBases();
  if (bases.length <= 0) {
    return {
      ok: false,
      errorCode: "HTTP_BASE_URL_MISSING",
      errorMessage: "HTTP_BASE_URL_MISSING",
      filter: normalized,
    };
  }

  const paths = resolvePaths();
  let lastFail: SaveMatchFilterResult | null = null;
  for (const base of bases) {
    for (const path of paths) {
      try {
        const res = await fetch(`${base}${path}`, {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "x-user-id": userId,
            "x-device-key": deviceKey,
          },
          body: JSON.stringify({
            countries: normalized.countries,
            languages: normalized.languages,
            gender: normalized.gender,
            userId,
            deviceKey,
            sessionId: deviceKey,
            source: "call_screen",
          }),
        });
        const bodyText = await res.text().catch(() => "");
        let json: any = {};
        try {
          json = bodyText ? JSON.parse(bodyText) : {};
        } catch {
          json = {};
        }
        if (res.status === 404) continue;
        if (res.ok && json?.ok !== false) {
          const parsed = parseMatchFilterFromJson(json);
          return {
            ok: true,
            errorCode: "",
            errorMessage: "",
            filter: parsed.filter,
          };
        }
        lastFail = {
          ok: false,
          errorCode: asText(json?.errorCode || json?.error || `HTTP_${res.status}`, 120) || `HTTP_${res.status}`,
          errorMessage: asText(json?.errorMessage || json?.message || json?.error || `HTTP_${res.status}`, 240) || `HTTP_${res.status}`,
          filter: normalized,
        };
      } catch {
        lastFail = {
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: "NETWORK_ERROR",
          filter: normalized,
        };
      }
    }
  }

  if (lastFail) return lastFail;
  return {
    ok: false,
    errorCode: "MATCH_FILTER_ROUTE_NOT_FOUND",
    errorMessage: "MATCH_FILTER_ROUTE_NOT_FOUND",
    filter: normalized,
  };
}
