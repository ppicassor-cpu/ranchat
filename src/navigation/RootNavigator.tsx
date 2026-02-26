import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import MainStack from "./MainStack";
import { useAppStore } from "../store/useAppStore";

import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import { syncProfileToServer } from "../services/profile/ProfileSync";
import GlobalModalHost from "../screens/_GlobalModalHost";
import { LanguageProvider, useTranslation } from "../i18n/LanguageProvider";

function toErrMsg(e: unknown) {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message || "UNKNOWN_ERROR");
  return "UNKNOWN_ERROR";
}

function RootNavigatorInner() {
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const authNonce = useAppStore((s) => s.authNonce);
  const auth = useAppStore((s) => s.auth);
  const prefs = useAppStore((s) => s.prefs);

  const setAuth = useAppStore((s) => s.setAuth);
  const showGlobalModal = useAppStore((s) => s.showGlobalModal);
  const { t } = useTranslation();

  useEffect(() => {
    if (!hasHydrated) return;

    (async () => {
      try {
        await bootstrapDeviceBinding();
      } catch (e) {
        setAuth({ verified: true, token: null, userId: null });
        showGlobalModal(t("auth.title"), toErrMsg(e));
      }
    })();
  }, [hasHydrated, authNonce, setAuth, showGlobalModal, t]);

  useEffect(() => {
    if (!hasHydrated) return;
    const token = String(auth?.token || "").trim();
    if (!token) return;

    const timer = setTimeout(() => {
      syncProfileToServer({
        token,
        userId: auth?.userId,
        deviceKey: auth?.deviceKey,
        country: prefs?.country,
        language: prefs?.language,
        gender: prefs?.gender,
      }).catch(() => undefined);
    }, 220);

    return () => clearTimeout(timer);
  }, [
    auth?.token,
    auth?.userId,
    auth?.deviceKey,
    prefs?.country,
    prefs?.language,
    prefs?.gender,
    hasHydrated,
  ]);

  return (
    <NavigationContainer>
      <MainStack />
      <GlobalModalHost />
    </NavigationContainer>
  );
}

export default function RootNavigator() {
  return (
    <LanguageProvider>
      <RootNavigatorInner />
    </LanguageProvider>
  );
}
