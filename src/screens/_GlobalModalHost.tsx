//C:\ranchat\src\screens\_GlobalModalHost.tsx
import React from "react";
import { View } from "react-native";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { useAppStore } from "../store/useAppStore";
import { theme } from "../config/theme";
import AppText from "../components/AppText";

export default function GlobalModalHost() {
  const m = useAppStore((s) => s.globalModal);
  const hide = useAppStore((s) => s.hideGlobalModal);

  return (
    <AppModal
      visible={m.visible}
      title={m.title}
      dismissible={true}
      onClose={hide}
      footer={
        <View style={{ gap: 10 }}>
          <PrimaryButton title="확인" onPress={hide} />
        </View>
      }
    >
      <AppText style={{ fontSize: 14, color: theme.colors.sub, lineHeight: 20 }}>{m.message}</AppText>
    </AppModal>
  );
}
