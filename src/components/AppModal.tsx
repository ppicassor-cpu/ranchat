//C:\ranchat\src\components\AppModal.tsx
import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { theme } from "../config/theme";
import AppText from "./AppText";

type Props = {
  visible: boolean;
  title?: string;
  children?: React.ReactNode;
  onClose?: () => void;
  footer?: React.ReactNode;
  dismissible?: boolean;
};

export default function AppModal({ visible, title, children, onClose, footer, dismissible = true }: Props) {
  return (
    <Modal transparent visible={visible} animationType="fade" statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.backdropPress}
          onPress={() => {
            if (dismissible) onClose?.();
          }}
        />
        <View style={styles.card}>
          {title ? <AppText style={styles.title}>{title}</AppText> : null}
          <View style={styles.body}>{children}</View>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
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
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  body: {
    gap: theme.spacing.sm,
  },
  footer: {
    marginTop: theme.spacing.md,
  },
});
