import React, { useMemo } from "react";
import { Text, View } from "react-native";
import AppModal from "../components/AppModal";
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
      let text = String(dict[key] ?? key);

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
      onClose={hide}
      footer={
        <View style={{ gap: 10 }}>
          <PrimaryButton title={t("common.confirm")} onPress={hide} />
        </View>
      }
    >
      <Text style={{ fontSize: 14, color: theme.colors.sub, lineHeight: 20 }}>{m.message}</Text>
    </AppModal>
  );
}
