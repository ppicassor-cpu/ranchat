// C:\ranchat\src\navigation\RootNavigator.tsx
import React, { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { StyleSheet, Text, View } from "react-native";

import MainStack from "./MainStack";
import { theme } from "../config/theme";
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

  const [booting, setBooting] = useState(true);

  useEffect(() => {
    initAds();
    initPurchases();
  }, []);

  useEffect(() => {
    if (!hasHydrated) return;

    let alive = true;

    (async () => {
      try {
        await bootstrapDeviceBinding();
      } catch (e) {
        setAuth({ verified: true, token: null, userId: null });
        showGlobalModal("인증", toErrMsg(e));
      } finally {
        if (alive) setBooting(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [hasHydrated, authNonce, setAuth, showGlobalModal]);

  if (!hasHydrated || booting) {
    return (
      <>
        <View style={styles.boot}>
          <Text style={styles.bootTitle}>연결 중</Text>
          <Text style={styles.bootSub}>잠시만 기다려 주세요.</Text>
        </View>
        <GlobalModalHost />
      </>
    );
  }

  return (
    <NavigationContainer>
      <MainStack />
      <GlobalModalHost />
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  bootTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  bootSub: {
    fontSize: 14,
    color: theme.colors.sub,
  },
});
