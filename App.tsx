// FILE: C:\ranchat\App.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, PermissionsAndroid, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import * as Location from "expo-location";
import RootNavigator from "./src/navigation/RootNavigator";

import { initAds } from "./src/services/ads/AdManager";
import { initPurchases, refreshSubscription, syncPurchasesAppUser } from "./src/services/purchases/PurchaseManager";

import AppModal from "./src/components/AppModal";
import PrimaryButton from "./src/components/PrimaryButton";
import { theme } from "./src/config/theme";
import { useAppStore } from "./src/store/useAppStore";
import { reportLoginEvent } from "./src/services/admin/LoginEventReporter";
import { translations } from "./src/i18n/translations";

type SupportedLang = "ko" | "en" | "ja" | "zh" | "es" | "de" | "fr" | "it" | "ru";

function countryToLang(cc: string): SupportedLang {
  const c = String(cc || "").trim().toUpperCase();

  if (c === "KR") return "ko";
  if (c === "JP") return "ja";
  if (c === "RU") return "ru";
  if (c === "DE") return "de";
  if (c === "FR") return "fr";
  if (c === "IT") return "it";
  if (c === "ES" || c === "MX") return "es";
  if (c === "CN" || c === "TW" || c === "HK") return "zh";

  // 그 외 대부분은 영어로
  return "en";
}

async function resolveIsoCountryCode(): Promise<string | null> {
  try {
    if (Platform.OS !== "android") {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return null;
    }

    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });

    const geo = await Location.reverseGeocodeAsync({
      latitude: pos.coords.latitude,
      longitude: pos.coords.longitude,
    });

    const cc = String(geo?.[0]?.isoCountryCode || "").trim().toUpperCase();
    return cc && cc.length === 2 ? cc : null;
  } catch {
    return null;
  }
}

export default function App() {
  const didInitRef = useRef(false);
  const lastActiveReportRef = useRef(0);
  const forcedLogoutRef = useRef(false);

  const hasHydrated = useAppStore((s: any) => s.hasHydrated);
  const prefs = useAppStore((s: any) => s.prefs);
  const auth = useAppStore((s: any) => s.auth);
  const sub = useAppStore((s: any) => s.sub);
  const popTalk = useAppStore((s: any) => s.popTalk);
  const assets = useAppStore((s: any) => s.assets);
  const billing = useAppStore((s: any) => (s as any).billing);
  const setPrefs = useAppStore((s: any) => s.setPrefs);
  const logoutAndWipe = useAppStore((s: any) => s.logoutAndWipe);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  const [permChecked, setPermChecked] = useState(false);
  const [permBusy, setPermBusy] = useState(false);
  const [permState, setPermState] = useState({ cam: false, mic: false, loc: false });

  const [setupBusy, setSetupBusy] = useState(false);
  const [setupDone, setSetupDone] = useState(false);

  const permOk = useMemo(() => Boolean(permState.cam && permState.mic && permState.loc), [permState]);
  const staticLang = useMemo(() => {
    const raw = String(prefs?.language || "").trim().toLowerCase();
    return translations[raw as keyof typeof translations] ? (raw as keyof typeof translations) : "ko";
  }, [prefs?.language]);
  const staticT = useCallback((key: string, params?: Record<string, any>) => {
    const dict = translations[staticLang] || translations.ko;
    const enDict = translations.en || {};
    const koDict = translations.ko || {};
    let text = String((dict as any)[key] || (enDict as any)[key] || (koDict as any)[key] || key);
    if (params) {
      Object.keys(params).forEach((k) => {
        text = text.replace(`{${k}}`, String(params[k]));
      });
    }
    return text;
  }, [staticLang]);
  const isAuthed = useMemo(() => {
    const verified = Boolean(auth?.verified);
    const token = String(auth?.token || "").trim();
    return Boolean(verified && token);
  }, [auth?.token, auth?.verified]);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;

    // ✅ 앱 부팅 시 광고/결제 SDK 초기화 1회 보장
    try {
      initAds();
    } catch {}
    try {
      initPurchases();
    } catch {}
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthed) return;
    const uid = String(auth?.userId || "").trim();
    if (!uid) return;

    syncPurchasesAppUser(uid).catch(() => undefined);
  }, [auth?.userId, hasHydrated, isAuthed]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthed) return;

    let closed = false;
    let appState = AppState.currentState;

    const emitPresence = async (provider: "app_active" | "app_heartbeat") => {
      if (closed) return;
      if (forcedLogoutRef.current) return;
      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      if (!token || !userId) return;

      const nowMs = Date.now();
      if (provider === "app_active") {
        if (nowMs - Number(lastActiveReportRef.current || 0) < 10000) return;
        lastActiveReportRef.current = nowMs;
      }

      const premium = Boolean(sub?.isPremium);
      const totalPopTalk = Math.max(0, Math.trunc(Number(popTalk?.balance ?? 0)));
      const kernelCount = Math.max(0, Math.trunc(Number(assets?.kernelCount ?? 0)));
      const totalPaymentKrw = Math.max(
        0,
        Math.trunc(Number((billing as any)?.totalPaidKrw ?? (billing as any)?.totalPaymentKrw ?? 0))
      );

      const out = await reportLoginEvent({
        token,
        userId,
        deviceKey: auth?.deviceKey,
        provider,
        subscriptionStatus: premium ? "paid" : "free",
        isPremium: premium,
        planId: String(sub?.planId || ""),
        storeProductId: String(sub?.storeProductId || ""),
        popTalkCount: totalPopTalk,
        kernelCount,
        totalPaymentKrw,
      });

      if (out.forceLogout && !forcedLogoutRef.current) {
        forcedLogoutRef.current = true;
        showGlobalModal(staticT("auth.title"), staticT("auth.logout_other_device"));
        logoutAndWipe();
      }
    };

    emitPresence("app_active").catch(() => undefined);
    const hb = setInterval(() => {
      emitPresence("app_heartbeat").catch(() => undefined);
    }, 60000);

    const subAppState = AppState.addEventListener("change", (nextState) => {
      const prev = appState;
      appState = nextState;
      const enteredForeground =
        (prev === "background" || prev === "inactive") && nextState === "active";
      if (enteredForeground) {
        emitPresence("app_active").catch(() => undefined);
      }
    });

    return () => {
      closed = true;
      clearInterval(hb);
      try {
        subAppState.remove();
      } catch {}
    };
  }, [
    assets?.kernelCount,
    auth?.deviceKey,
    auth?.token,
    auth?.userId,
    billing,
    hasHydrated,
    isAuthed,
    popTalk?.balance,
    sub?.isPremium,
    sub?.planId,
    sub?.storeProductId,
    logoutAndWipe,
    showGlobalModal,
    staticT,
  ]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthed) return;

    let closed = false;
    let appState = AppState.currentState;

    const syncSubscription = async () => {
      if (closed) return;
      await refreshSubscription();
    };

    syncSubscription().catch(() => undefined);
    const subAppState = AppState.addEventListener("change", (nextState) => {
      const prev = appState;
      appState = nextState;
      const enteredForeground =
        (prev === "background" || prev === "inactive") && nextState === "active";
      if (enteredForeground) {
        syncSubscription().catch(() => undefined);
      }
    });

    return () => {
      closed = true;
      try {
        subAppState.remove();
      } catch {}
    };
  }, [hasHydrated, isAuthed]);

  const hasAndroidPermission = useCallback(async (perm: string) => {
    try {
      const r = await PermissionsAndroid.check(perm as any);
      return Boolean(r);
    } catch {
      return false;
    }
  }, []);

  const checkPermissions = useCallback(async () => {
    if (Platform.OS !== "android") {
      setPermState({ cam: true, mic: true, loc: true });
      setPermChecked(true);
      return;
    }

    const cam = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
    const mic = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    const loc =
      (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
      (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));

    setPermState({ cam, mic, loc });
    setPermChecked(true);
  }, [hasAndroidPermission]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthed) return;
    checkPermissions();
  }, [checkPermissions, hasHydrated, isAuthed]);

  const requestPermissions = useCallback(async () => {
    if (permBusy) return;
    setPermBusy(true);

    try {
      if (Platform.OS !== "android") {
        setPermState({ cam: true, mic: true, loc: true });
        return;
      }

      const camBefore = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
      const micBefore = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      const locBefore =
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));
      const btConnectPerm =
        Number(Platform.Version) >= 31 ? (PermissionsAndroid as any)?.PERMISSIONS?.BLUETOOTH_CONNECT : undefined;
      const btBefore =
        typeof btConnectPerm === "string" ? await hasAndroidPermission(btConnectPerm) : true;

      const needs: string[] = [];
      if (!camBefore) needs.push(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (!micBefore) needs.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (!locBefore) needs.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      if (typeof btConnectPerm === "string" && !btBefore) needs.push(btConnectPerm);

      const results: Record<string, string> = {};

      if (needs.length > 0) {
        const multi = await PermissionsAndroid.requestMultiple(needs as any);
        results.camera = multi[PermissionsAndroid.PERMISSIONS.CAMERA];
        results.mic = multi[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        results.loc = multi[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      }

      const cam =
        camBefore ||
        results.camera === PermissionsAndroid.RESULTS.GRANTED ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA));
      const mic =
        micBefore ||
        results.mic === PermissionsAndroid.RESULTS.GRANTED ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO));
      const loc =
        locBefore ||
        results.loc === PermissionsAndroid.RESULTS.GRANTED ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));

      setPermState({ cam, mic, loc });
    } catch {
      // 실패 시에도 모달은 계속 떠있고, 다시 시도 가능
    } finally {
      setPermBusy(false);
    }
  }, [hasAndroidPermission, permBusy]);

  useEffect(() => {
    if (!isAuthed) return;
    if (!permChecked) return;
    if (!permOk) return;
    if (!hasHydrated) return;
    if (setupBusy || setupDone) return;

    (async () => {
      setSetupBusy(true);
      try {
        const st: any = useAppStore.getState?.() ?? {};
        const curPrefs = st.prefs ?? prefs ?? {};
        const curCountry = String(curPrefs.country || "").trim().toUpperCase();

        const rawLang = String(curPrefs.language || "").trim().toLowerCase();
        const curLang = rawLang === "kr" ? "ko" : rawLang;

        const hasCountry = curCountry.length === 2;
        const hasLang =
          curLang === "ko" ||
          curLang === "en" ||
          curLang === "ja" ||
          curLang === "zh" ||
          curLang === "es" ||
          curLang === "de" ||
          curLang === "fr" ||
          curLang === "it" ||
          curLang === "ru";

        // 이미 사용자가 설정해둔 값이 있으면 덮어쓰지 않음
        if (hasCountry && hasLang) return;

        const cc = await resolveIsoCountryCode();

        if (cc) {
          const lang = countryToLang(cc);
          if (!hasCountry) setPrefs({ country: cc });
          if (!hasLang) setPrefs({ language: lang });
        } else {
          // 위치를 못 얻은 경우: 언어가 비어있으면 최소 영어로
          if (!hasLang) setPrefs({ language: "en" });
        }
      } finally {
        setSetupBusy(false);
        setSetupDone(true);
      }
    })();
  }, [hasHydrated, isAuthed, permChecked, permOk, prefs, setPrefs, setupBusy, setupDone]);

  if (!hasHydrated) {
    return (
      <SafeAreaProvider>
        <View style={styles.bootRoot}>
          <ActivityIndicator />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!isAuthed) {
    return (
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
  }

  if (permChecked && permOk && hasHydrated && setupDone) {
    return (
      <SafeAreaProvider>
        <RootNavigator />
      </SafeAreaProvider>
    );
  }

  const showSetup = permChecked && permOk && (!hasHydrated || !setupDone);

  return (
    <SafeAreaProvider>
      <View style={styles.gateRoot}>
        {/* 권한 모달 (KO+EN 고정) */}
        <AppModal
          visible={!showSetup && (permChecked ? !permOk : true)}
          title={staticT("app.permission.title")}
          titleUseSystemFont
          dismissible={false}
          footer={
            <View style={{ gap: 10 }}>
              <PrimaryButton
                title={permBusy ? staticT("app.permission.loading") : staticT("app.permission.allow")}
                onPress={requestPermissions}
                disabled={permBusy || permOk}
                useSystemFont
              />
            </View>
          }
        >
          <Text style={styles.modalTextCenter}>{staticT("app.permission.message")}</Text>

          <View style={{ height: 12 }} />

          <View style={styles.permList}>
            <View style={styles.permRow}>
              <Text style={[styles.permLeft, !permState.cam ? styles.permLeftNeed : null]}>{staticT("app.permission.camera")}</Text>
            </View>

            <View style={styles.permRow}>
              <Text style={[styles.permLeft, !permState.mic ? styles.permLeftNeed : null]}>{staticT("app.permission.microphone")}</Text>
            </View>

            <View style={styles.permRow}>
              <Text style={[styles.permLeft, !permState.loc ? styles.permLeftNeed : null]}>{staticT("app.permission.location")}</Text>
            </View>

            {Platform.OS === "android" && Number(Platform.Version) >= 31 ? (
              <View style={styles.permRow}>
                <Text style={styles.permLeft}>{staticT("app.permission.nearby_devices")}</Text>
              </View>
            ) : null}
          </View>
        </AppModal>

        {/* 위치/언어 저장 스피너 */}
        <AppModal
          visible={showSetup}
          title={staticT("app.setup.title")}
          titleUseSystemFont
          dismissible={false}
          footer={<View />}
        >
          <View style={styles.setupBox}>
            <ActivityIndicator />
            <View style={{ height: 12 }} />
            <Text style={styles.modalTextCenter}>{staticT("app.setup.message")}</Text>
          </View>
        </AppModal>
      </View>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bootRoot: { flex: 1, backgroundColor: theme.colors.bg, alignItems: "center", justifyContent: "center" },
  gateRoot: { flex: 1, backgroundColor: theme.colors.bg, justifyContent: "center" },

  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },
  modalTextCenter: { fontSize: 14, color: theme.colors.sub, lineHeight: 20, textAlign: "center" },

  permList: { width: "100%", gap: 8, alignItems: "center" },
  permRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center" },
  permLeft: { fontSize: 14, color: theme.colors.text, fontWeight: "800", textAlign: "center" },
  permLeftNeed: { color: "#ff4d4f" },

  setupBox: { alignItems: "center", justifyContent: "center" },
});
