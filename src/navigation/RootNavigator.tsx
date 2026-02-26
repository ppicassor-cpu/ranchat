import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import MainStack from "./MainStack";
import AuthStack from "./AuthStack";
import { useAppStore } from "../store/useAppStore";
import { syncProfileToServer } from "../services/profile/ProfileSync";
import GlobalModalHost from "../screens/_GlobalModalHost";
import { LanguageProvider } from "../i18n/LanguageProvider";

function RootNavigatorInner() {
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const auth = useAppStore((s) => s.auth);
  const prefs = useAppStore((s) => s.prefs);

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

  const token = String(auth?.token || "").trim();
  const isAuthed = Boolean(hasHydrated && auth?.verified && token);

  return (
    <NavigationContainer>
      {isAuthed ? <MainStack /> : <AuthStack />}
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
