// FILE: C:\ranchat\src\services\auth\AuthBootstrap.ts
import { getOrCreateDeviceKey } from "../device/DeviceKey";
import { bindDeviceHttp } from "./DeviceBind";
import { useAppStore } from "../../store/useAppStore";

export async function bootstrapDeviceBinding(): Promise<void> {
  const deviceKey = await getOrCreateDeviceKey();
  useAppStore.getState().setDeviceKey(deviceKey);

  const { token, userId } = await bindDeviceHttp(deviceKey);
  useAppStore.getState().setAuth({ token, userId, verified: true });
}
