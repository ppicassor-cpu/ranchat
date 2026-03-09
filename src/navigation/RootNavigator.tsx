import React, { useEffect } from "react";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import MainStack from "./MainStack";
import AuthStack from "./AuthStack";
import { useAppStore } from "../store/useAppStore";
import { mergeProfileSyncResult, syncProfileToServer } from "../services/profile/ProfileSync";
import GlobalModalHost from "../screens/_GlobalModalHost";
import { LanguageProvider } from "../i18n/LanguageProvider";
import RecallInviteHost from "../components/call/RecallInviteHost";

function RootNavigatorInner() {
  const navigationRef = useNavigationContainerRef();
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const auth = useAppStore((s) => s.auth);
  const prefs = useAppStore((s) => s.prefs);
  const setProfile = useAppStore((s: any) => s.setProfile);

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
      })
        .then((out) => {
          if (!out) return;
          const currentProfile = (useAppStore.getState() as any)?.profile;
          setProfile(mergeProfileSyncResult(currentProfile, out));
        })
        .catch(() => undefined);
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
    setProfile,
  ]);

  const token = String(auth?.token || "").trim();
  const isAuthed = Boolean(hasHydrated && auth?.verified && token);

  return (
    <NavigationContainer ref={navigationRef}>
      {isAuthed ? <MainStack /> : <AuthStack />}
      <RecallInviteHost navigationRef={navigationRef} enabled={isAuthed} />
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
