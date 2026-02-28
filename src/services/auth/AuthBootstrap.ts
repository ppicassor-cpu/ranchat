// FILE: C:\ranchat\src\services\auth\AuthBootstrap.ts
import { getOrCreateDeviceKey } from "../device/DeviceKey";
import { bindDeviceHttp } from "./DeviceBind";
import { useAppStore } from "../../store/useAppStore";
import { reportLoginEvent } from "../admin/LoginEventReporter";

export async function bootstrapDeviceBinding(): Promise<void> {
  const deviceKey = await getOrCreateDeviceKey();
  useAppStore.getState().setDeviceKey(deviceKey);

  const { token, userId } = await bindDeviceHttp(deviceKey);
  useAppStore.getState().setAuth({ token, userId, verified: true });
  const st: any = useAppStore.getState?.() ?? {};
  const sub = st?.sub ?? {};
  const popTalk = st?.popTalk ?? {};
  const assets = st?.assets ?? {};
  const billing = st?.billing ?? {};
  const isPremium = Boolean(sub?.isPremium);

  reportLoginEvent({
    token,
    userId,
    deviceKey,
    provider: "device_bind",
    subscriptionStatus: isPremium ? "paid" : "free",
    isPremium,
    planId: String(sub?.planId || ""),
    storeProductId: String(sub?.storeProductId || ""),
    popcornCount: Number(assets?.popcornCount ?? popTalk?.balance ?? 0),
    kernelCount: Number(assets?.kernelCount ?? assets?.kernels ?? 0),
    totalPaymentKrw: Number(billing?.totalPaidKrw ?? billing?.totalPaymentKrw ?? 0),
  }).catch(() => undefined);
}
