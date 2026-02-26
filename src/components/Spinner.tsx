// FILE: C:\ranchat\src\components\Spinner.tsx
import React from "react";
import { StyleSheet, View } from "react-native";
import { theme } from "../config/theme";
import AppText from "./AppText";
import { useTranslation } from "../i18n/LanguageProvider";
import HeartbeatSpinner from "./HeartbeatSpinner";

export default function Spinner() {
  const { t } = useTranslation();

  return (
    <View style={styles.wrap}>
      <AppText style={styles.text}>{t("call.connecting")}</AppText>
      <HeartbeatSpinner />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    transform: [{ translateY: 80 }],
  },
  text: {
    color: "rgba(112, 112, 112, 0.85)",
    fontSize: 18,
    fontWeight: "400",
    textAlign: "center",
  },
});
