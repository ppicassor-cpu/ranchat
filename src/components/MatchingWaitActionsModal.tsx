import React from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import AppModal from "./AppModal";
import PrimaryButton from "./PrimaryButton";
import AppText from "./AppText";
import { theme } from "../config/theme";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  visible: boolean;
  title: string;
  description: string;
  beautyLabel: string;
  fortuneLabel: string;
  gameLabel: string;
  closeLabel: string;
  onPressBeauty: () => void;
  onPressFortune: () => void;
  onPressGame: () => void;
  onClose: () => void;
};

export default function MatchingWaitActionsModal({
  visible,
  title,
  description,
  beautyLabel,
  fortuneLabel,
  gameLabel,
  closeLabel,
  onPressBeauty,
  onPressFortune,
  onPressGame,
  onClose,
}: Props) {
  return (
    <AppModal
      visible={visible}
      title={title}
      dismissible={true}
      onClose={onClose}
      footer={
        <PrimaryButton title={closeLabel} onPress={onClose} variant="ghost" />
      }
    >
      <AppText style={styles.descText}>
        {description}
      </AppText>
      <View style={styles.actionRow}>
        <Pressable onPress={onPressBeauty} style={({ pressed }) => [styles.actionBtn, pressed ? styles.actionBtnPressed : null]}>
          <View style={styles.iconWrap}>
            <Ionicons name="sparkles" size={22} color={theme.colors.pinkDeep} />
          </View>
          <AppText style={styles.actionLabel}>{beautyLabel}</AppText>
        </Pressable>

        <Pressable onPress={onPressFortune} style={({ pressed }) => [styles.actionBtn, pressed ? styles.actionBtnPressed : null]}>
          <View style={styles.iconWrap}>
            <Ionicons name="planet" size={22} color={theme.colors.pinkDeep} />
          </View>
          <AppText style={styles.actionLabel}>{fortuneLabel}</AppText>
        </Pressable>

        <Pressable onPress={onPressGame} style={({ pressed }) => [styles.actionBtn, pressed ? styles.actionBtnPressed : null]}>
          <View style={styles.iconWrap}>
            <Ionicons name="game-controller" size={22} color={theme.colors.pinkDeep} />
          </View>
          <AppText style={styles.actionLabel}>{gameLabel}</AppText>
        </Pressable>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  descText: {
    fontSize: 15,
    color: theme.colors.sub,
    lineHeight: 20,
    textAlign: "center",
  },
  actionRow: {
    width: "100%",
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.card,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionBtnPressed: {
    opacity: 0.72,
  },
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "rgba(241, 200, 222, 0.24)",
    alignItems: "center",
    justifyContent: "center",
  },
  actionLabel: {
    marginTop: 7,
    fontSize: 12,
    color: theme.colors.text,
    fontWeight: "700",
    ...(Platform.OS === "android" ? { fontFamily: "sans-serif-bold" } : null),
    textAlign: "center",
  },
});
