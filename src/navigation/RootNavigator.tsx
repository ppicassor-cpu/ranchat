import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";
import MainStack from "./MainStack";
import { useAppStore } from "../store/useAppStore";

import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
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
