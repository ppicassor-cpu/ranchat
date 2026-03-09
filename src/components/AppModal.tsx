import React from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View, type ModalProps } from "react-native";
import { theme } from "../config/theme";
import AppText from "./AppText";

type Props = {
  visible: boolean;
  title?: string;
  titleUseSystemFont?: boolean;
  children?: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
  dismissible?: boolean;
  size?: "default" | "compact";
  animationType?: ModalProps["animationType"];
};

export default function AppModal({
  visible,
  title,
  titleUseSystemFont = false,
  children,
  onClose,
  footer,
  dismissible = true,
  size = "default",
  animationType = "fade",
}: Props) {
  return (
    <Modal
      transparent
      visible={visible}
      animationType={animationType}
      statusBarTranslucent
      onRequestClose={() => {
        if (!dismissible && !onClose) return;
        onClose?.();
      }}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 24 : 0}
      >
        <Pressable
          style={styles.backdropPress}
          onPress={() => {
            if (dismissible) onClose?.();
          }}
        />
        <View style={[styles.card, size === "compact" ? styles.cardCompact : null]}>
          {title ? (
            titleUseSystemFont ? (
              <Text style={styles.title}>{title}</Text>
            ) : (
              <AppText style={styles.title}>{title}</AppText>
            )
          ) : null}
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: theme.colors.dim,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  backdropPress: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },
  cardCompact: {
    maxWidth: 340,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  title: {
    width: "100%",
    textAlign: "center",
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  body: {
    width: "100%",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  footer: {
    width: "100%",
    marginTop: theme.spacing.md,
  },
});
