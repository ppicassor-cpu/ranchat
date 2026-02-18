import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { theme } from "../config/theme";
import AppText from "../components/AppText";
import PrimaryButton from "../components/PrimaryButton";
import PremiumPaywallModal from "../components/PremiumPaywallModal";
import { purchasePremiumByProductId, refreshSubscription, openManageSubscriptions } from "../services/purchases/PurchaseManager";
import { useAppStore } from "../store/useAppStore";
import { useTranslation } from "../i18n/LanguageProvider";

const PRODUCT_IDS = {
  weekly: "ranchat_premium:weekly_-plan",
  monthly: "ranchat_premium:monthly2_-plan",
  yearly: "ranchat_premium:yearly2_-plan",
} as const;

type PlanKey = keyof typeof PRODUCT_IDS;

const PRICES = {
  weekly: 4900,
  monthly: 14900,
  yearly: 89000,
} as const;

function formatWon(n: number) {
  return n.toLocaleString("ko-KR") + "원";
}

function calcDiscountPercent(base: number, target: number) {
  if (base <= 0) return 0;
  const p = Math.round(((base - target) / base) * 100);
  return p < 0 ? 0 : p;
}

export default function PremiumScreen() {
  const { t } = useTranslation();
  const sub = useAppStore((s) => s.sub);

  const [payModal, setPayModal] = useState(false);
  const [selected, setSelected] = useState<PlanKey>("monthly");
  const [busy, setBusy] = useState(false);

  const weeklyVsMonthlyDiscount = useMemo(() => {
    const base = PRICES.weekly * 4;
    return calcDiscountPercent(base, PRICES.monthly);
  }, []);

  const monthlyVsYearlyDiscount = useMemo(() => {
    const base = PRICES.monthly * 12;
    return calcDiscountPercent(base, PRICES.yearly);
  }, []);

  const onSelect = (k: PlanKey) => {
    setSelected(k);
    setPayModal(true);
  };

  const onPay = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const productId = PRODUCT_IDS[selected];
      await purchasePremiumByProductId(productId);
      await refreshSubscription();
      setPayModal(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.hero}>
        <AppText style={styles.heroTitle}>{t("premium.title")}</AppText>
        <AppText style={styles.heroDesc}>
          {t("premium.description")}
        </AppText>

        <View style={{ height: 14 }} />

        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <AppText style={styles.badgeTop}>{t("premium.benefit_ad")}</AppText>
            <AppText style={styles.badgeBottom}>{t("premium.benefit_ad_detail")}</AppText>
          </View>
          <View style={styles.badge}>
            <AppText style={styles.badgeTop}>{t("premium.benefit_ux")}</AppText>
            <AppText style={styles.badgeBottom}>{t("premium.benefit_ux_detail")}</AppText>
          </View>
        </View>

        <View style={{ height: 10 }} />

        {sub.isPremium ? (
          <View style={styles.premiumOn}>
            <AppText style={styles.premiumOnTxt}>{t("premium.current_premium")}</AppText>
          </View>
        ) : (
          <View style={styles.premiumOff}>
            <AppText style={styles.premiumOffTxt}>{t("premium.current_free")}</AppText>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <AppText style={styles.h1}>{t("premium.plan_select")}</AppText>

        <View style={{ height: 10 }} />

        <View style={styles.planBox}>
          <View style={styles.planTop}>
            <AppText style={styles.planName}>{t("premium.weekly")}</AppText>
            <View style={styles.pill}>
              <AppText style={styles.pillTxt}>{t("premium.light")}</AppText>
            </View>
          </View>
          <View style={styles.planMid}>
            <AppText style={styles.planPrice}>{formatWon(PRICES.weekly)}</AppText>
            <AppText style={styles.planUnit}>/ {t("premium.week")}</AppText>
          </View>
          <PrimaryButton title={t("premium.start_weekly")} onPress={() => onSelect("weekly")} />
        </View>

        <View style={{ height: 12 }} />

        <View style={[styles.planBox, styles.planHot]}>
          <View style={styles.planTop}>
            <AppText style={styles.planName}>{t("premium.monthly")}</AppText>
            <View style={[styles.pill, styles.pillHot]}>
              <AppText style={[styles.pillTxt, styles.pillTxtHot]}>{t("premium.recommended")}</AppText>
            </View>
            <View style={[styles.discountTag]}>
              <AppText style={styles.discountTxt}>{t("premium.discount_tag", { percent: weeklyVsMonthlyDiscount })}</AppText>
            </View>
          </View>
          <View style={styles.planMid}>
            <AppText style={styles.planPrice}>{formatWon(PRICES.monthly)}</AppText>
            <AppText style={styles.planUnit}>/ {t("premium.month")}</AppText>
          </View>
          <PrimaryButton title={t("premium.pay_monthly")} onPress={() => onSelect("monthly")} />
        </View>

        <View style={{ height: 12 }} />

        <View style={styles.planBox}>
          <View style={styles.planTop}>
            <AppText style={styles.planName}>{t("premium.yearly")}</AppText>
            <View style={[styles.discountTag]}>
              <AppText style={styles.discountTxt}>{t("premium.discount_tag", { percent: monthlyVsYearlyDiscount })}</AppText>
            </View>
          </View>
          <View style={styles.planMid}>
            <AppText style={styles.planPrice}>{formatWon(PRICES.yearly)}</AppText>
            <AppText style={styles.planUnit}>/ {t("premium.year")}</AppText>
          </View>
          <PrimaryButton title={t("premium.pay_yearly")} onPress={() => onSelect("yearly")} />
        </View>

        <View style={{ height: 14 }} />

        <PrimaryButton title={t("premium.manage_subscription")} onPress={openManageSubscriptions} variant="ghost" />
      </View>

      <View style={styles.card}>
        <AppText style={styles.h1}>{t("premium.ad_remove_benefit")}</AppText>
        <View style={{ height: 8 }} />
        <View style={styles.benefitRow}>
          <View style={styles.dot} />
          <AppText style={styles.benefitTxt}>{t("premium.benefit_ad_remove")}</AppText>
        </View>
        <View style={styles.benefitRow}>
          <View style={styles.dot} />
          <AppText style={styles.benefitTxt}>{t("premium.benefit_fullscreen")}</AppText>
        </View>
      </View>

      <PremiumPaywallModal
        visible={payModal}
        onClose={() => setPayModal(false)}
        title={selected === "weekly" ? t("premium.weekly_pay") : selected === "monthly" ? t("premium.monthly_pay") : t("premium.yearly_pay")}
        price={
          selected === "weekly"
            ? `${formatWon(PRICES.weekly)} / ${t("premium.week")}`
            : selected === "monthly"
              ? `${formatWon(PRICES.monthly)} / ${t("premium.month")}`
              : `${formatWon(PRICES.yearly)} / ${t("premium.year")}`
        }
        discountText={
          selected === "monthly"
            ? `${t("premium.weekly_compare")} ${weeklyVsMonthlyDiscount}% ${t("premium.discount")}`
            : selected === "yearly"
              ? `${t("premium.monthly_compare")} ${monthlyVsYearlyDiscount}% ${t("premium.discount")}`
              : undefined
        }
        benefitLines={[
          t("premium.benefit_ad_remove"),
          t("premium.benefit_fullscreen"),
          t("premium.benefit_manage_anytime"),
        ]}
        busy={busy}
        onConfirm={onPay}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },

  hero: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },
  heroTitle: { fontSize: 22, fontWeight: "900", color: theme.colors.text, marginBottom: 6 },
  heroDesc: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },

  badgeRow: { flexDirection: "row", gap: 10 },
  badge: {
    flex: 1,
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  badgeTop: { fontSize: 14, fontWeight: "900", color: theme.colors.text, marginBottom: 2 },
  badgeBottom: { fontSize: 12, fontWeight: "700", color: theme.colors.sub },

  premiumOn: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.pinkDeep,
    alignItems: "center",
  },
  premiumOnTxt: { fontSize: 13, fontWeight: "900", color: theme.colors.white },

  premiumOff: {
    marginTop: 12,
    borderRadius: 999,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.white,
    alignItems: "center",
  },
  premiumOffTxt: { fontSize: 13, fontWeight: "900", color: theme.colors.text },

  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },
  h1: { fontSize: 17, fontWeight: "900", color: theme.colors.text, marginBottom: 6 },

  planBox: {
    backgroundColor: theme.colors.white,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
  },
  planHot: {
    borderColor: theme.colors.pinkDeep,
  },
  planTop: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  planName: { fontSize: 16, fontWeight: "900", color: theme.colors.text },

  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.white,
  },
  pillHot: { borderColor: theme.colors.pinkDeep, backgroundColor: theme.colors.pinkDeep },
  pillTxt: { fontSize: 12, fontWeight: "900", color: theme.colors.text },
  pillTxtHot: { color: theme.colors.white },

  discountTag: {
    marginLeft: "auto",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.white,
  },
  discountTxt: { fontSize: 12, fontWeight: "900", color: theme.colors.pinkDeep },

  planMid: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginBottom: 12 },
  planPrice: { fontSize: 20, fontWeight: "900", color: theme.colors.text },
  planUnit: { fontSize: 13, fontWeight: "900", color: theme.colors.sub, paddingBottom: 2 },

  benefitRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  dot: { width: 8, height: 8, borderRadius: 99, backgroundColor: theme.colors.pinkDeep },
  benefitTxt: { fontSize: 14, fontWeight: "800", color: theme.colors.text },
});
