import React, { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { theme } from "../config/theme";
import AppText from "../components/AppText";
import PrimaryButton from "../components/PrimaryButton";
import PremiumPaywallModal from "../components/PremiumPaywallModal";
import { purchasePremiumByProductId, refreshSubscription, openManageSubscriptions } from "../services/purchases/PurchaseManager";
import { useAppStore } from "../store/useAppStore";

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
        <AppText style={styles.heroTitle}>프리미엄</AppText>
        <AppText style={styles.heroDesc}>
          광고 없이 깔끔하게, 더 빠르고 쾌적한 랜덤 영상채팅 경험을 제공합니다.
        </AppText>

        <View style={{ height: 14 }} />

        <View style={styles.badgeRow}>
          <View style={styles.badge}>
            <AppText style={styles.badgeTop}>광고 제거</AppText>
            <AppText style={styles.badgeBottom}>배너/전면 광고 OFF</AppText>
          </View>
          <View style={styles.badge}>
            <AppText style={styles.badgeTop}>가벼운 UX</AppText>
            <AppText style={styles.badgeBottom}>집중도  피로도 </AppText>
          </View>
        </View>

        <View style={{ height: 10 }} />

        {sub.isPremium ? (
          <View style={styles.premiumOn}>
            <AppText style={styles.premiumOnTxt}>현재 프리미엄 이용 중</AppText>
          </View>
        ) : (
          <View style={styles.premiumOff}>
            <AppText style={styles.premiumOffTxt}>현재 무료 이용 중</AppText>
          </View>
        )}
      </View>

      <View style={styles.card}>
        <AppText style={styles.h1}>플랜 선택</AppText>

        <View style={{ height: 10 }} />

        <View style={styles.planBox}>
          <View style={styles.planTop}>
            <AppText style={styles.planName}>주간</AppText>
            <View style={styles.pill}>
              <AppText style={styles.pillTxt}>라이트</AppText>
            </View>
          </View>
          <View style={styles.planMid}>
            <AppText style={styles.planPrice}>{formatWon(PRICES.weekly)}</AppText>
            <AppText style={styles.planUnit}>/ 주</AppText>
          </View>
          <PrimaryButton title="주간으로 시작" onPress={() => onSelect("weekly")} />
        </View>

        <View style={{ height: 12 }} />

        <View style={[styles.planBox, styles.planHot]}>
          <View style={styles.planTop}>
            <AppText style={styles.planName}>월간</AppText>
            <View style={[styles.pill, styles.pillHot]}>
              <AppText style={[styles.pillTxt, styles.pillTxtHot]}>추천</AppText>
            </View>
            <View style={[styles.discountTag]}>
              <AppText style={styles.discountTxt}>약 {weeklyVsMonthlyDiscount}% 할인</AppText>
            </View>
          </View>
          <View style={styles.planMid}>
            <AppText style={styles.planPrice}>{formatWon(PRICES.monthly)}</AppText>
            <AppText style={styles.planUnit}>/ 월</AppText>
          </View>
          <PrimaryButton title="월간으로 결제" onPress={() => onSelect("monthly")} />
        </View>

        <View style={{ height: 12 }} />

        <View style={styles.planBox}>
          <View style={styles.planTop}>
            <AppText style={styles.planName}>연간</AppText>
            <View style={[styles.discountTag]}>
              <AppText style={styles.discountTxt}>약 {monthlyVsYearlyDiscount}% 할인</AppText>
            </View>
          </View>
          <View style={styles.planMid}>
            <AppText style={styles.planPrice}>{formatWon(PRICES.yearly)}</AppText>
            <AppText style={styles.planUnit}>/ 년</AppText>
          </View>
          <PrimaryButton title="연간으로 결제" onPress={() => onSelect("yearly")} />
        </View>

        <View style={{ height: 14 }} />

        <PrimaryButton title="구독 관리" onPress={openManageSubscriptions} variant="ghost" />
      </View>

      <View style={styles.card}>
        <AppText style={styles.h1}>광고 제거 혜택</AppText>
        <View style={{ height: 8 }} />
        <View style={styles.benefitRow}>
          <View style={styles.dot} />
          <AppText style={styles.benefitTxt}>배너 광고 제거</AppText>
        </View>
        <View style={styles.benefitRow}>
          <View style={styles.dot} />
          <AppText style={styles.benefitTxt}>전면 광고 제거</AppText>
        </View>
        <View style={styles.benefitRow}>
          <View style={styles.dot} />
          <AppText style={styles.benefitTxt}>몰입감 있는 풀스크린 경험</AppText>
        </View>
      </View>

      <PremiumPaywallModal
        visible={payModal}
        onClose={() => setPayModal(false)}
        title={selected === "weekly" ? "주간 결제" : selected === "monthly" ? "월간 결제" : "연간 결제"}
        price={
          selected === "weekly"
            ? `${formatWon(PRICES.weekly)} / 주`
            : selected === "monthly"
              ? `${formatWon(PRICES.monthly)} / 월`
              : `${formatWon(PRICES.yearly)} / 년`
        }
        discountText={
          selected === "monthly"
            ? `주간 대비 약 ${weeklyVsMonthlyDiscount}% 할인`
            : selected === "yearly"
              ? `월간 대비 약 ${monthlyVsYearlyDiscount}% 할인`
              : undefined
        }
        benefitLines={[
          "광고 제거로 더 깔끔하게",
          "더 몰입감 있는 사용 경험",
          "언제든지 구독 관리에서 변경/해지 가능",
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
