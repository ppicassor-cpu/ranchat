//C:\ranchat\src\components\PrimaryButton.tsx
import React from "react";
import { Pressable, StyleSheet, ViewStyle } from "react-native";
import { theme } from "../config/theme";
import AppText from "./AppText";

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  style?: ViewStyle;
};

export default function PrimaryButton({ title, onPress, disabled, variant = "primary", style }: Props) {
  const bg =
    variant === "primary" ? theme.colors.pinkDeep : variant === "danger" ? theme.colors.danger : "transparent";
  const border = variant === "ghost" ? theme.colors.line : "transparent";
  const text = variant === "ghost" ? theme.colors.text : theme.colors.white;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.btn,
        { backgroundColor: bg, borderColor: border, opacity: disabled ? 0.5 : 1 },
        style,
      ]}
    >
      <AppText style={[styles.txt, { color: text }]}>{title}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 50,
    borderRadius: theme.radius.lg,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  txt: {
    fontSize: 16,
    fontWeight: "700",
  },
});
