import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { theme } from "../config/theme";
import AppText from "./AppText";

export default function Spinner() {
  return (
    <View style={styles.wrap}>
      <AppText style={styles.text}>매칭 연결중</AppText>
      <ActivityIndicator size={48} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    transform: [{ translateY: 50 }],
  },
  text: {
    color: "rgba(112, 112, 112, 0.85)",
    fontSize: 18,
    fontWeight: "400",
    textAlign: "center",
  },
});
