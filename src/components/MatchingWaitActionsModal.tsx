import React from "react";
import { Pressable, View } from "react-native";
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
  doNotShowLabel: string;
  doNotShowChecked: boolean;
  onToggleDoNotShow: () => void;
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
  doNotShowLabel,
  doNotShowChecked,
  onToggleDoNotShow,
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
        <View style={{ gap: 10 }}>
          <PrimaryButton title={beautyLabel} onPress={onPressBeauty} />
          <PrimaryButton title={fortuneLabel} onPress={onPressFortune} variant="ghost" />
          <PrimaryButton title={gameLabel} onPress={onPressGame} variant="ghost" />
          <PrimaryButton title={closeLabel} onPress={onClose} variant="ghost" />
        </View>
      }
    >
      <AppText style={{ fontSize: 15, color: theme.colors.sub, lineHeight: 20, textAlign: "center" }}>
        {description}
      </AppText>
      <Pressable
        onPress={onToggleDoNotShow}
        style={({ pressed }) => [
          {
            width: "100%",
            marginTop: 6,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: 8,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Ionicons name={doNotShowChecked ? "checkbox" : "square-outline"} size={20} color={theme.colors.sub} />
        <AppText style={{ fontSize: 13, color: theme.colors.sub }}>{doNotShowLabel}</AppText>
      </Pressable>
    </AppModal>
  );
}
