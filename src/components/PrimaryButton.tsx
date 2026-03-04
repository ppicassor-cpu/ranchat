//C:\ranchat\src\components\PrimaryButton.tsx
import React from "react";
import { Pressable, StyleProp, StyleSheet, TextStyle, View, ViewStyle } from "react-native";
import { theme } from "../config/theme";
import AppText from "./AppText";

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  leftIcon?: React.ReactNode;
};

export default function PrimaryButton({ title, onPress, disabled, variant = "primary", style, textStyle, leftIcon }: Props) {
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
      <View style={styles.content}>
        {leftIcon ? <View style={styles.leftIconWrap}>{leftIcon}</View> : null}
        <AppText style={[styles.txt, { color: text }, textStyle]}>{title}</AppText>
      </View>
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
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  leftIconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  txt: {
    fontSize: 16,
    fontWeight: "700",
  },
});
