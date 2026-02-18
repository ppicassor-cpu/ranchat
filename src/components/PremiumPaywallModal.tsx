// FILE: C:\ranchat\src\components\PremiumPaywallModal.tsx
import React from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { theme } from "../config/theme";
import AppText from "./AppText";
import PrimaryButton from "./PrimaryButton";
import { useTranslation } from "../i18n/LanguageProvider";

export default function PremiumPaywallModal({
  visible,
  onClose,
  title,
  price,
  discountText,
  benefitLines,
  busy,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  price: string;
  discountText?: string;
  benefitLines: string[];
  busy: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />

      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet}>
          <View style={styles.top}>
            <AppText style={styles.title}>{title}</AppText>
            <AppText onPress={onClose} style={styles.close}>
              {t("common.close")}
            </AppText>
          </View>

          <View style={{ height: 8 }} />

          <View style={styles.priceBox}>
            <AppText style={styles.price}>{price}</AppText>
            {discountText ? <AppText style={styles.discount}>{discountText}</AppText> : null}
          </View>

          <View style={{ height: 10 }} />

          <View style={styles.benefits}>
            {benefitLines.map((text, i) => (
              <View key={i} style={styles.bRow}>
                <View style={styles.dot} />
                <AppText style={styles.bTxt}>{text}</AppText>
              </View>
            ))}
          </View>

          <View style={{ height: 14 }} />

          <View style={{ gap: 10 }}>
            <PrimaryButton title={busy ? t("payment.processing") : t("payment.proceed")} onPress={onConfirm} disabled={busy} />
            <PrimaryButton title={t("common.cancel")} onPress={onClose} variant="ghost" />
          </View>

          <View style={{ height: 10 }} />

          <AppText style={styles.notice}>
            {t("payment.notice")}
          </AppText>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },

  sheetWrap: {
    flex: 1,
    justifyContent: "flex-end",
    padding: theme.spacing.lg,
  },
  sheet: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },

  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 17, fontWeight: "900", color: theme.colors.text },
  close: { fontSize: 13, fontWeight: "900", color: theme.colors.pinkDeep },

  priceBox: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
  },
  price: { fontSize: 18, fontWeight: "900", color: theme.colors.text, marginBottom: 6 },
  discount: { fontSize: 13, fontWeight: "900", color: theme.colors.pinkDeep },

  benefits: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingVertical: 8,
    paddingHorizontal: theme.spacing.lg,
  },
  bRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 99, backgroundColor: theme.colors.pinkDeep },
  bTxt: { fontSize: 13, fontWeight: "800", color: theme.colors.text },

  notice: { fontSize: 12, color: theme.colors.sub, lineHeight: 18 },
});