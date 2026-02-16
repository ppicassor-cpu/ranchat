// C:\ranchat\src\navigation\RootNavigator.tsx
import React, { useEffect } from "react";
import { NavigationContainer } from "@react-navigation/native";

import MainStack from "./MainStack";
import { useAppStore } from "../store/useAppStore";

import { initAds } from "../services/ads/AdManager";
import { initPurchases } from "../services/purchases/PurchaseManager";
import { bootstrapDeviceBinding } from "../services/auth/AuthBootstrap";
import GlobalModalHost from "../screens/_GlobalModalHost";

function toErrMsg(e: unknown) {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message || "UNKNOWN_ERROR");
  return "UNKNOWN_ERROR";
}

export default function RootNavigator() {
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const authNonce = useAppStore((s) => s.authNonce);

  const setAuth = useAppStore((s) => s.setAuth);
  const showGlobalModal = useAppStore((s) => s.showGlobalModal);

  useEffect(() => {
    initAds();
    initPurchases();
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    (async () => {
      try {
        await bootstrapDeviceBinding();
      } catch (e) {
        setAuth({ verified: true, token: null, userId: null });
        showGlobalModal("인증", toErrMsg(e));
      }
    })();
  }, [hasHydrated, authNonce, setAuth, showGlobalModal]);

  return (
    <NavigationContainer>
      <MainStack />
      <GlobalModalHost />
    </NavigationContainer>
  );
}
