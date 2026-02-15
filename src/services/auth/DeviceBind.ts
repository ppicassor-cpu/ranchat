// C:\ranchat\src\services\auth\DeviceBind.ts
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

export async function bindDeviceHttp(deviceKey: string): Promise<BindResponse> {
  const baseRaw = String(APP_CONFIG.AUTH_HTTP_BASE_URL ?? "").trim();
  if (!baseRaw) throw new Error("AUTH_BASE_URL_MISSING");

  const base = baseRaw.replace(/\/$/, "");
  const baseHasApi = /\/api$/i.test(base);

  const paths = ["/device/bind", "/bind"];
  if (!baseHasApi) {
    paths.push("/api/device/bind", "/api/bind");
  }

  let last404: string = "";
  for (const p of paths) {
    const url = `${base}${p}`;
    try {
      return await postBind(url, deviceKey);
    } catch (e: any) {
      const status = Number(e?.status);
      if (status === 404) {
        last404 = String(e?.body ?? "");
        continue;
      }
      throw e;
    }
  }

  throw new Error(`BIND_HTTP_404:${last404}`);
}
