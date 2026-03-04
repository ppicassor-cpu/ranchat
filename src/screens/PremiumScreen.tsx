import React, { useMemo, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../config/theme";
import AppText from "../components/AppText";
import PrimaryButton from "../components/PrimaryButton";
import PremiumPaywallModal from "../components/PremiumPaywallModal";
import { purchasePremiumByProductId, refreshSubscription } from "../services/purchases/PurchaseManager";
import { useAppStore } from "../store/useAppStore";
import { useTranslation } from "../i18n/LanguageProvider";

const PRODUCT_IDS = {
  weekly: "ranchat_premium:weekly-plan",
  monthly: "ranchat_premium:monthly2-plan",
  yearly: "ranchat_premium:yearly2-plan",
} as const;
const PREMIUM_DIA_IMAGE = require("../../assets/dia.png");

type PlanKey = keyof typeof PRODUCT_IDS;
type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const PRICES = {
  weekly: 4900,
  monthly: 14900,
  yearly: 89000,
} as const;

function localeFromLang(lang: string) {
  const lower = String(lang || "").toLowerCase();
  if (lower === "ko") return "ko-KR";
  if (lower === "ja") return "ja-JP";
  if (lower === "zh") return "zh-CN";
  if (lower === "es") return "es-ES";
  if (lower === "de") return "de-DE";
  if (lower === "fr") return "fr-FR";
  if (lower === "it") return "it-IT";
  if (lower === "ru") return "ru-RU";
  return "en-US";
}

function formatKrw(n: number, locale: string, suffix: string) {
  return n.toLocaleString(locale) + suffix;
}

function calcDiscountPercent(base: number, target: number) {
  if (base <= 0) return 0;
  const p = Math.round(((base - target) / base) * 100);
  return p < 0 ? 0 : p;
}

type CompareRow = {
  icon: IoniconName;
  label: string;
  freeValue: string;
  premiumValue: string;
};

export default function PremiumScreen() {
  const { t, currentLang } = useTranslation();
  const sub = useAppStore((s) => s.sub);
  const insets = useSafeAreaInsets();
  const priceLocale = useMemo(() => localeFromLang(currentLang), [currentLang]);
  const krwSuffix = t("currency.krw_suffix");
  const contentTopPadding = useMemo(() => Math.max(insets.top + 34, 74), [insets.top]);

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

  const compareRows = useMemo<CompareRow[]>(
    () => [
      {
        icon: "megaphone-outline",
        label: t("premium.compare.item_ad"),
        freeValue: t("premium.compare.item_ad_free"),
        premiumValue: t("premium.compare.item_ad_premium"),
      },
      {
        icon: "chatbox-ellipses-outline",
        label: t("premium.compare.item_translate"),
        freeValue: t("premium.compare.item_translate_free"),
        premiumValue: t("premium.compare.item_translate_premium"),
      },
      {
        icon: "funnel-outline",
        label: t("premium.compare.item_filter"),
        freeValue: t("premium.compare.item_filter_free"),
        premiumValue: t("premium.compare.item_filter_premium"),
      },
      {
        icon: "play-forward-outline",
        label: t("premium.compare.item_entry"),
        freeValue: t("premium.compare.item_entry_free"),
        premiumValue: t("premium.compare.item_entry_premium"),
      },
    ],
    [t]
  );

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
    <View style={styles.root}>
      <LinearGradient
        colors={["#220B20", "#31102C", "#431739"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.wrap, { paddingTop: contentTopPadding }]}
      >
        <LinearGradient
          colors={["#4E1843", "#6B2257", "#8A2D69"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View pointerEvents="none" style={styles.heroShine} />

          <View style={styles.heroBodyRow}>
            <View style={styles.heroTextWrap}>
              <View style={styles.heroStatusWrap}>
                <View style={sub.isPremium ? styles.premiumOn : styles.premiumOff}>
                  <AppText style={sub.isPremium ? styles.premiumOnTxt : styles.premiumOffTxt}>
                    {sub.isPremium ? t("premium.current_premium") : t("premium.current_free")}
                  </AppText>
                </View>
              </View>
              <View style={styles.heroTitleRow}>
                <Ionicons name="diamond" size={16} color="#FFD67D" />
                <AppText style={styles.heroTitle}>{t("premium.apply_title")}</AppText>
              </View>
              <AppText style={styles.heroDesc}>{t("premium.description")}</AppText>
            </View>

            <View style={styles.heroRightCluster}>
              <View style={styles.heroDiamondImageWrap}>
                <Image source={PREMIUM_DIA_IMAGE} resizeMode="contain" style={styles.heroDiamondImage} />
              </View>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.compareCard}>
          <AppText style={styles.h1}>{t("premium.compare_title")}</AppText>
          <AppText style={styles.compareDesc}>{t("premium.compare_desc")}</AppText>

          <View style={styles.compareHeadRow}>
            <AppText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
              ellipsizeMode="clip"
              style={[styles.compareHeadCell, styles.compareFeatureCol]}
            >
              {t("premium.compare_col_feature")}
            </AppText>
            <AppText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
              ellipsizeMode="clip"
              style={[styles.compareHeadCell, styles.compareFreeCol]}
            >
              {t("premium.compare_col_free")}
            </AppText>
            <AppText
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.55}
              ellipsizeMode="clip"
              style={[styles.compareHeadCell, styles.comparePremiumCol]}
            >
              {t("premium.compare_col_premium")}
            </AppText>
          </View>

          {compareRows.map((row, idx) => (
            <View key={`premium_compare_${idx}`} style={styles.compareRow}>
              <View style={[styles.compareCell, styles.compareFeatureCol]}>
                <View style={styles.compareFeatureInner}>
                  <Ionicons name={row.icon} size={15} color="#F3BFE0" />
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.55}
                    ellipsizeMode="clip"
                    style={styles.compareLabel}
                  >
                    {row.label}
                  </AppText>
                </View>
              </View>

              <View style={[styles.compareCell, styles.compareFreeCol]}>
                <View style={styles.compareFreeChip}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.5}
                    ellipsizeMode="clip"
                    style={styles.compareValueFree}
                  >
                    {row.freeValue}
                  </AppText>
                </View>
              </View>

              <View style={[styles.compareCell, styles.comparePremiumCol]}>
                <View style={styles.comparePremiumChip}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.5}
                    ellipsizeMode="clip"
                    style={styles.compareValuePremium}
                  >
                    {row.premiumValue}
                  </AppText>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.card}>
          <AppText style={styles.h1}>{t("premium.plan_select")}</AppText>
          <AppText style={styles.planHint}>{t("premium.plan_select_hint")}</AppText>

          <View style={styles.planGap} />

          <View style={styles.planGrid}>
            <Pressable
              style={styles.planGridItem}
              onPress={() => onSelect("weekly")}
              accessibilityRole="button"
              accessibilityLabel={t("premium.weekly_pay")}
            >
              <View style={[styles.planBox, styles.planBoxCompact]}>
                <View style={styles.planTopCompact}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.55}
                    ellipsizeMode="clip"
                    style={styles.planNameCompact}
                  >
                    {`${t("premium.weekly")} ${t("premium.subscribe_suffix")}`}
                  </AppText>
                </View>
                <View style={styles.planMidCompact}>
                  <AppText style={styles.planPriceCompact}>{formatKrw(PRICES.weekly, priceLocale, krwSuffix)}</AppText>
                </View>
                <PrimaryButton
                  title={t("premium.subscribe_action")}
                  onPress={() => onSelect("weekly")}
                  style={styles.planBuyBtn}
                  textStyle={styles.planBuyBtnText}
                />
              </View>
            </Pressable>

            <Pressable
              style={styles.planGridItem}
              onPress={() => onSelect("monthly")}
              accessibilityRole="button"
              accessibilityLabel={t("premium.monthly_pay")}
            >
              <LinearGradient
                colors={["rgba(233,131,173,0.25)", "rgba(98,36,79,0.88)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.planBox, styles.planBoxCompact, styles.planHot]}
              >
                <View style={styles.planCornerBadge}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.45}
                    ellipsizeMode="clip"
                    style={styles.planCornerBadgeText}
                  >
                    {t("premium.recommended")}
                  </AppText>
                </View>
                <View style={styles.planTopCompact}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.55}
                    ellipsizeMode="clip"
                    style={styles.planNameCompact}
                  >
                    {`${t("premium.monthly")} ${t("premium.subscribe_suffix")}`}
                  </AppText>
                </View>
                <View style={[styles.discountTag, styles.discountTagCompact]}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.55}
                    ellipsizeMode="clip"
                    style={styles.discountTxt}
                  >
                    {t("premium.discount_tag", { percent: weeklyVsMonthlyDiscount })}
                  </AppText>
                </View>
                <View style={styles.planMidCompact}>
                  <AppText style={styles.planPriceCompact}>{formatKrw(PRICES.monthly, priceLocale, krwSuffix)}</AppText>
                </View>
                <PrimaryButton
                  title={t("premium.subscribe_action")}
                  onPress={() => onSelect("monthly")}
                  style={styles.planBuyBtn}
                  textStyle={styles.planBuyBtnText}
                />
              </LinearGradient>
            </Pressable>

            <Pressable
              style={styles.planGridItem}
              onPress={() => onSelect("yearly")}
              accessibilityRole="button"
              accessibilityLabel={t("premium.yearly_pay")}
            >
              <View style={[styles.planBox, styles.planBoxCompact]}>
                <View style={styles.planTopCompact}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.55}
                    ellipsizeMode="clip"
                    style={styles.planNameCompact}
                  >
                    {`${t("premium.yearly")} ${t("premium.subscribe_suffix")}`}
                  </AppText>
                </View>
                <View style={[styles.discountTag, styles.discountTagCompact]}>
                  <AppText
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.55}
                    ellipsizeMode="clip"
                    style={styles.discountTxt}
                  >
                    {t("premium.discount_tag", { percent: monthlyVsYearlyDiscount })}
                  </AppText>
                </View>
                <View style={styles.planMidCompact}>
                  <AppText style={styles.planPriceCompact}>{formatKrw(PRICES.yearly, priceLocale, krwSuffix)}</AppText>
                </View>
                <PrimaryButton
                  title={t("premium.subscribe_action")}
                  onPress={() => onSelect("yearly")}
                  style={styles.planBuyBtn}
                  textStyle={styles.planBuyBtnText}
                />
              </View>
            </Pressable>
          </View>

          <View style={styles.planGapLarge} />
          <AppText style={styles.cancelNote}>{t("premium.cancel_note")}</AppText>
        </View>
      </ScrollView>

      <PremiumPaywallModal
        visible={payModal}
        onClose={() => setPayModal(false)}
        title={selected === "weekly" ? t("premium.weekly_pay") : selected === "monthly" ? t("premium.monthly_pay") : t("premium.yearly_pay")}
        price={
          selected === "weekly"
            ? `${formatKrw(PRICES.weekly, priceLocale, krwSuffix)} / ${t("premium.week")}`
            : selected === "monthly"
              ? `${formatKrw(PRICES.monthly, priceLocale, krwSuffix)} / ${t("premium.month")}`
              : `${formatKrw(PRICES.yearly, priceLocale, krwSuffix)} / ${t("premium.year")}`
        }
        discountText={
          selected === "monthly"
            ? `${t("premium.weekly_compare")} ${weeklyVsMonthlyDiscount}% ${t("premium.discount")}`
            : selected === "yearly"
              ? `${t("premium.monthly_compare")} ${monthlyVsYearlyDiscount}% ${t("premium.discount")}`
              : undefined
        }
        benefitLines={[
          t("premium.compare.item_ad_premium"),
          t("premium.compare.item_translate_premium"),
          t("premium.compare.item_filter_premium"),
          t("premium.compare.item_entry_premium"),
        ]}
        busy={busy}
        onConfirm={onPay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#220B20",
  },
  wrap: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    paddingBottom: 60,
  },

  hero: {
    position: "relative",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,199,233,0.28)",
    padding: theme.spacing.lg,
    marginTop: 30,
    overflow: "hidden",
    ...theme.shadow.card,
  },
  heroShine: {
    position: "absolute",
    right: -70,
    top: -70,
    width: 200,
    height: 200,
    borderRadius: 140,
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  heroBodyRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  heroTextWrap: {
    flex: 1,
    paddingRight: 10,
  },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  heroStatusWrap: {
    alignSelf: "flex-start",
    marginBottom: 7,
  },
  heroTitle: {
    fontSize: 25,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  heroDesc: {
    fontSize: 14,
    lineHeight: 20,
    color: "rgba(255,239,248,0.95)",
  },
  heroRightCluster: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  heroDiamondImageWrap: {
    width: 96,
    height: 96,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,227,162,0.58)",
    backgroundColor: "rgba(255,228,160,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroDiamondImage: {
    width: 88,
    height: 88,
  },

  premiumOn: {
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.36)",
    backgroundColor: "rgba(233,131,173,0.86)",
    alignItems: "center",
  },
  premiumOnTxt: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  premiumOff: {
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
  },
  premiumOffTxt: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFEFF8",
  },

  compareCard: {
    backgroundColor: "rgba(64,23,56,0.95)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,194,230,0.2)",
    padding: theme.spacing.lg,
  },
  h1: {
    width: "100%",
    fontSize: 17,
    fontWeight: "900",
    color: "#FFFFFF",
    marginBottom: 6,
    textAlign: "center",
  },
  compareDesc: {
    width: "100%",
    marginTop: 2,
    marginBottom: 12,
    fontSize: 13,
    lineHeight: 19,
    color: "rgba(255,225,242,0.9)",
    textAlign: "center",
  },
  compareHeadRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    height: 28,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,195,229,0.24)",
    paddingBottom: 0,
    marginBottom: 6,
  },
  compareHeadCell: {
    fontSize: 11,
    fontWeight: "900",
    color: "#F6C2E0",
    textAlign: "center",
    letterSpacing: 0.2,
  },
  compareFeatureCol: {
    flex: 1.1,
  },
  compareFreeCol: {
    flex: 0.95,
    paddingHorizontal: 4,
  },
  comparePremiumCol: {
    flex: 0.95,
    paddingHorizontal: 4,
  },
  compareRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "stretch",
    height: 56,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,195,229,0.14)",
    paddingVertical: 0,
  },
  compareCell: {
    justifyContent: "center",
    alignItems: "center",
  },
  compareFeatureInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    gap: 8,
    paddingHorizontal: 4,
    transform: [{ translateX: -8 }],
  },
  compareLabel: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
    color: "#FFEAF7",
    textAlign: "center",
  },
  compareFreeChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.06)",
    width: "100%",
    alignSelf: "stretch",
    paddingHorizontal: 8,
    paddingVertical: 6,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  comparePremiumChip: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,183,224,0.55)",
    backgroundColor: "rgba(233,131,173,0.2)",
    width: "100%",
    alignSelf: "stretch",
    paddingHorizontal: 8,
    paddingVertical: 6,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  compareValueFree: {
    fontSize: 11,
    lineHeight: 15,
    color: "rgba(239,226,236,0.95)",
    fontWeight: "700",
    textAlign: "center",
  },
  compareValuePremium: {
    fontSize: 11,
    lineHeight: 15,
    color: "#FFD8EF",
    fontWeight: "900",
    textAlign: "center",
  },

  card: {
    backgroundColor: "rgba(64,23,56,0.95)",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,194,230,0.2)",
    padding: theme.spacing.lg,
  },
  planHint: {
    width: "100%",
    marginTop: -2,
    marginBottom: 2,
    fontSize: 13,
    color: "rgba(255,225,242,0.9)",
    lineHeight: 19,
    textAlign: "center",
  },
  planGap: { height: 12 },
  planGapLarge: { height: 14 },
  planGrid: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "stretch",
  },
  planGridItem: {
    width: "31.8%",
  },

  planBox: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,194,230,0.24)",
    padding: theme.spacing.lg,
  },
  planHot: {
    borderColor: "rgba(255,183,224,0.6)",
  },
  planBoxCompact: {
    paddingHorizontal: 7,
    paddingTop: 20,
    paddingBottom: 3,
    height: 136,
    position: "relative",
    overflow: "visible",
    justifyContent: "flex-start",
  },
  planTopCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 1,
    gap: 4,
  },
  planTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  planName: {
    fontSize: 17,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  planNameCompact: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  pillHot: {
    borderColor: "#FFD5EC",
    backgroundColor: "rgba(233,131,173,0.85)",
  },
  pillTxt: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FCEFFC",
  },
  pillTxtHot: {
    color: "#FFFFFF",
  },
  discountTag: {
    marginLeft: "auto",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,183,224,0.9)",
    backgroundColor: "rgba(255,187,229,0.14)",
  },
  discountTxt: {
    fontSize: 10,
    fontWeight: "900",
    color: "#FFD5ED",
    textAlign: "center",
  },
  discountTagCompact: {
    marginLeft: 0,
    alignSelf: "center",
    marginBottom: 0,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  planMid: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    marginBottom: 12,
  },
  planPrice: {
    fontSize: 22,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  planUnit: {
    fontSize: 13,
    fontWeight: "900",
    color: "rgba(255,225,242,0.9)",
    paddingBottom: 3,
  },
  planMidCompact: {
    marginTop: "auto",
    marginBottom: 9,
    gap: 0,
    alignItems: "center",
  },
  planPriceCompact: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  planCornerBadge: {
    position: "absolute",
    top: -7,
    right: -7,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(255,230,230,0.9)",
    backgroundColor: "#B80E1D",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },
  planCornerBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.1,
    textAlign: "center",
  },
  planBuyBtn: {
    height: 30,
    borderRadius: 12,
  },
  planBuyBtnText: {
    fontSize: 13,
    fontWeight: "900",
  },
  cancelNote: {
    marginTop: 10,
    fontSize: 12,
    lineHeight: 17,
    color: "rgba(255,225,242,0.65)",
    fontWeight: "500",
    textAlign: "left",
  },
});
