// FILE: C:\ranchat\src\services\device\DeviceKey.ts
import "react-native-get-random-values";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { v4 as uuidv4 } from "uuid";

const KEY = "ranchat_device_key_v1";

async function getFromFallback(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v ? String(v) : null;
  } catch {
    return null;
  }
}

async function setToFallback(v: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, String(v));
  } catch {}
}

export async function getOrCreateDeviceKey(): Promise<string> {
  // 1) SecureStore 우선
  try {
    const existing = await SecureStore.getItemAsync(KEY);
    if (existing && String(existing).trim().length > 0) return String(existing).trim();
  } catch {
    // 무시하고 fallback
  }

  // 2) AsyncStorage fallback
  const fb = await getFromFallback();
  if (fb && fb.trim().length > 0) return fb.trim();

  // 3) 생성 후 저장
  const next = uuidv4();

  try {
    await SecureStore.setItemAsync(KEY, next);
  } catch {
    // SecureStore 실패 시 fallback
    await setToFallback(next);
  }

  return next;
}
