import { APP_CONFIG } from "../../config/app";

export type CallSafetyBaseInput = {
  token: string | null | undefined;
  userId: string | null | undefined;
  deviceKey?: string | null;
  roomId: string;
  peerSessionId?: string | null;
  peerUserId?: string | null;
};

export type ReportCallPeerInput = CallSafetyBaseInput & {
  reasonCode: string;
  reasonLabel: string;
  reasonDetail?: string | null;
};

export type BlockCallPeerInput = CallSafetyBaseInput & {
  reasonCode?: string | null;
  reasonLabel?: string | null;
};

export type CallSafetyActionResult = {
  ok: boolean;
  errorCode: string;
  errorMessage: string;
  reportId?: string;
  actorSessionKey?: string;
  peerSessionKey?: string;
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
  const envReportBase = asText(process.env.EXPO_PUBLIC_CALL_REPORT_HTTP_BASE_URL || "", 260);
  const envBlockBase = asText(process.env.EXPO_PUBLIC_CALL_BLOCK_HTTP_BASE_URL || "", 260);
  const cfgAuth = asText(APP_CONFIG.AUTH_HTTP_BASE_URL || "", 260);
  const cfgPopTalk = asText(APP_CONFIG.POPTALK?.httpBaseUrl || "", 260);
  const cfgSignal = asText(APP_CONFIG.SIGNALING_URL || "", 260);
  const raw = [envBase, envReportBase, envBlockBase, cfgAuth, cfgPopTalk, httpsBaseFromWs(cfgSignal)]
    .map((v) => normalizeHttpsBase(v))
    .filter((v) => v.length > 0);
  return Array.from(new Set(raw));
}

function normalizePath(pathLike: string): string {
  const p = asText(pathLike, 300);
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function parseResult(json: any, res: Response): CallSafetyActionResult {
  const statusText = asText(json?.status || "", 32).toLowerCase();
  const hasExplicitOk = Boolean(json && (json.ok === true || json.success === true || statusText === "ok"));
  const hasExpectedPayload = Boolean(
    asText(json?.reportId || json?.actorSessionKey || json?.peerSessionKey || "", 120)
  );
  const ok = Boolean(res.ok && (hasExplicitOk || hasExpectedPayload));
  const errorCode = asText(
    json?.errorCode ||
      json?.error ||
      (ok ? "" : `HTTP_${res.status}`),
    80
  );
  const errorMessage = asText(
    json?.errorMessage || json?.message || errorCode,
    220
  );
  return {
    ok,
    errorCode,
    errorMessage,
    reportId: asText(json?.reportId || "", 120) || undefined,
    actorSessionKey: asText(json?.actorSessionKey || "", 120) || undefined,
    peerSessionKey: asText(json?.peerSessionKey || "", 120) || undefined,
  };
}

async function postCallSafety(
  input: CallSafetyBaseInput & {
    pathCandidates: string[];
    routeNotFoundCode: string;
    body: Record<string, unknown>;
  }
): Promise<CallSafetyActionResult> {
  const token = asText(input.token, 400);
  const userId = asText(input.userId, 128);
  const deviceKey = asText(input.deviceKey, 240);
  const roomId = asText(input.roomId, 120);
  if (!token || !userId || !deviceKey || !roomId) {
    return {
      ok: false,
      errorCode: "INVALID_INPUT",
      errorMessage: "INVALID_INPUT",
    };
  }

  const bases = resolveBases();
  if (bases.length <= 0) {
    return {
      ok: false,
      errorCode: "HTTP_BASE_URL_MISSING",
      errorMessage: "HTTP_BASE_URL_MISSING",
    };
  }

  let lastFail: CallSafetyActionResult | null = null;
  for (const base of bases) {
    for (const path of input.pathCandidates.map((p) => normalizePath(p))) {
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
            ...(input.body || {}),
            userId,
            deviceKey,
            sessionId: deviceKey,
            roomId,
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
        const parsed = parseResult(json, res);
        if (parsed.ok) return parsed;
        lastFail = parsed;
      } catch {
        lastFail = {
          ok: false,
          errorCode: "NETWORK_ERROR",
          errorMessage: "NETWORK_ERROR",
        };
      }
    }
  }

  if (lastFail) return lastFail;
  return {
    ok: false,
    errorCode: input.routeNotFoundCode,
    errorMessage: input.routeNotFoundCode,
  };
}

export async function reportCallPeerOnServer(input: ReportCallPeerInput): Promise<CallSafetyActionResult> {
  const reasonCode = asText(input.reasonCode, 80);
  const reasonLabel = asText(input.reasonLabel, 120);
  const reasonDetail = asText(input.reasonDetail || "", 1200);
  if (!reasonCode || !reasonLabel) {
    return {
      ok: false,
      errorCode: "REPORT_REASON_REQUIRED",
      errorMessage: "REPORT_REASON_REQUIRED",
    };
  }

  const customPath = asText(process.env.EXPO_PUBLIC_CALL_REPORT_PATH || "", 240);
  const pathCandidates = [
    customPath || "",
    "/api/call/report",
    "/call/report",
    "/api/call/reports",
    "/call/reports",
    "/api/call/safety/report",
    "/call/safety/report",
    "/api/call/safety/reports",
    "/call/safety/reports",
    "/api/report/call",
    "/report/call",
  ].filter((p) => p.length > 0);

  return postCallSafety({
    ...input,
    pathCandidates,
    routeNotFoundCode: "CALL_REPORT_ROUTE_NOT_FOUND",
    body: {
      reasonCode,
      reasonLabel,
      reasonDetail,
      peerSessionId: asText(input.peerSessionId || "", 240) || undefined,
      peerUserId: asText(input.peerUserId || "", 128) || undefined,
    },
  });
}

export async function blockCallPeerOnServer(input: BlockCallPeerInput): Promise<CallSafetyActionResult> {
  const reasonCode = asText(input.reasonCode || "USER_BLOCK", 80);
  const reasonLabel = asText(input.reasonLabel || "User block", 120);

  const customPath = asText(process.env.EXPO_PUBLIC_CALL_BLOCK_PATH || "", 240);
  const pathCandidates = [
    customPath || "",
    "/api/call/block",
    "/call/block",
    "/api/call/peer/block",
    "/call/peer/block",
    "/api/call/safety/block",
    "/call/safety/block",
    "/api/call/safety/peer/block",
    "/call/safety/peer/block",
    "/api/call/ban",
    "/call/ban",
    "/api/block/call",
    "/block/call",
  ].filter((p) => p.length > 0);

  return postCallSafety({
    ...input,
    pathCandidates,
    routeNotFoundCode: "CALL_BLOCK_ROUTE_NOT_FOUND",
    body: {
      reasonCode,
      reasonLabel,
      peerSessionId: asText(input.peerSessionId || "", 240) || undefined,
      peerUserId: asText(input.peerUserId || "", 128) || undefined,
    },
  });
}
