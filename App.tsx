// FILE: C:\ranchat\App.tsx
import React, { useEffect, useRef } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import RootNavigator from "./src/navigation/RootNavigator";

import { initAds } from "./src/services/ads/AdManager";
import { initPurchases } from "./src/services/purchases/PurchaseManager";

export default function App() {
  const didInitRef = useRef(false);

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

  return (
    <SafeAreaProvider>
      <RootNavigator />
    </SafeAreaProvider>
  );
}
