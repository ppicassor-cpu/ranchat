// FILE: C:\ranchat\src\services\auth\DeviceBind.ts
import { Platform } from "react-native";
import { APP_CONFIG } from "../../config/app";

type BindResponse = {
  token: string;
  userId: string;
};

async function postBind(url: string, deviceKey: string): Promise<BindResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceKey,
      platform: Platform.OS,
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    const err: any = new Error(`BIND_HTTP_${res.status}:${txt}`);
    err.status = res.status;
    err.body = txt;
    throw err;
  }

  const data: any = await res.json();
  const token = String(data?.token ?? "");
  const userId = String(data?.userId ?? "");
  if (!token || !userId) throw new Error("BIND_RESPONSE_INVALID");
  return { token, userId };
}

function httpsBaseFromWs(wsUrl: string): string {
  try {
    const u = new URL(wsUrl);
    return `https://${u.host}`;
  } catch {
    return "";
  }
}

function normalizeHttpsBase(v: string): string {
  const s = String(v || "").trim();
  if (!s) return "";
  if (/^https:\/\//i.test(s)) return s;
  if (/^http:\/\//i.test(s)) return s.replace(/^http:\/\//i, "https://");
  if (/^wss:\/\//i.test(s)) return s.replace(/^wss:\/\//i, "https://");
  if (/^ws:\/\//i.test(s)) return s.replace(/^ws:\/\//i, "https://");
  return `https://${s.replace(/^\/+/, "")}`;
}

export async function bindDeviceHttp(deviceKey: string): Promise<BindResponse> {
  const envBase = String(process.env.EXPO_PUBLIC_AUTH_HTTP_BASE_URL ?? "").trim();
  const cfgBase = String(APP_CONFIG.AUTH_HTTP_BASE_URL ?? "").trim();
  const derivedBase = httpsBaseFromWs(String(APP_CONFIG.SIGNALING_URL ?? "").trim());

  const candidates = [envBase || cfgBase, derivedBase]
    .map((v) => normalizeHttpsBase(v))
    .filter((v) => v.length > 0)
    .map((v) => v.replace(/\/$/, ""));

  const bases = Array.from(new Set(candidates));
  if (!bases.length) throw new Error("AUTH_BASE_URL_MISSING");

  let last404 = "";
  let lastErr: any = null;

  for (const base0 of bases) {
    const base = base0.replace(/\/$/, "");
    const baseHasApi = /\/api$/i.test(base);

    const paths = baseHasApi
      ? ["/device/bind", "/bind"]
      : ["/device/bind", "/bind", "/api/device/bind", "/api/bind"];

    for (const p of paths) {
      const url = `${base}${p}`;

      try {
        return await postBind(url, deviceKey);
      } catch (e: any) {
        lastErr = e;

        const status = Number(e?.status);
        if (Number.isFinite(status)) {
          if (status === 404) {
            last404 = String(e?.body ?? "");
            continue;
          }
          throw e;
        }

        continue;
      }
    }
  }

  if (last404) throw new Error(`BIND_HTTP_404:${last404}`);
  throw lastErr ?? new Error("BIND_FAILED");
}
