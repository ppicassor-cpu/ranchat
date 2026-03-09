import React, { useMemo } from "react";
import { View } from "react-native";
import AppModal from "../components/AppModal";
import AppText from "../components/AppText";
import PrimaryButton from "../components/PrimaryButton";
import { useAppStore } from "../store/useAppStore";
import { theme } from "../config/theme";
import { translations } from "../i18n/translations";

export default function GlobalModalHost() {
  const m = useAppStore((s) => s.globalModal);
  const hide = useAppStore((s) => s.hideGlobalModal);

  const prefsLang = useAppStore((s: any) => s.prefs?.language);

  const currentLang = useMemo(() => {
    const key = String(prefsLang || "ko") as keyof typeof translations;
    return (translations as any)[key] ? key : ("ko" as keyof typeof translations);
  }, [prefsLang]);

  const t = useMemo(() => {
    return (key: string, params?: Record<string, any>): string => {
      const dict = (translations as any)[currentLang] || (translations as any).ko || {};
      const fallbackDict = (translations as any).ko || {};
      let text = String(dict[key] ?? fallbackDict[key] ?? key);

      if (params) {
        Object.keys(params).forEach((k) => {
          text = text.replace(`{${k}}`, String(params[k]));
        });
      }
      return text;
    };
  }, [currentLang]);

  return (
    <AppModal
      visible={m.visible}
      title={m.title}
      dismissible={true}
      size="compact"
      animationType="none"
      onClose={hide}
      footer={
        <View style={{ gap: 10 }}>
          <PrimaryButton title={t("common.confirm")} onPress={hide} />
        </View>
      }
    >
      <AppText
        style={{ width: "100%", fontSize: 13, fontWeight: "400", color: theme.colors.sub, lineHeight: 18, textAlign: "center" }}
      >
        {m.message}
      </AppText>
    </AppModal>
  );
}
