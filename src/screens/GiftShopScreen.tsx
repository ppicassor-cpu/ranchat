import React, { useCallback, useLayoutEffect } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AppText from "../components/AppText";
import { useAppStore } from "../store/useAppStore";
import { GIFT_CATALOG, getGiftDisplayName, type GiftItem } from "../constants/giftCatalog";
import { fetchShopGiftInventory, purchaseGiftWithKernelOnServer } from "../services/shop/ShopPurchaseService";
import { useTranslation } from "../i18n/LanguageProvider";

function formatNumber(n: number): string {
  return Math.max(0, Math.trunc(Number(n) || 0)).toLocaleString("ko-KR");
}

function GiftArt({ gift }: { gift: GiftItem }) {
  return (
    <LinearGradient
      colors={["rgba(255,255,255,0.16)", `${gift.accent}90`, "rgba(0,0,0,0.15)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.artFrame}
    >
      <View style={[styles.artDot, { backgroundColor: gift.accent }]} />
      <AppText style={styles.artEmoji}>{gift.emoji}</AppText>
    </LinearGradient>
  );
}

export default function GiftShopScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const auth = useAppStore((s: any) => s.auth);
  const kernelCount = useAppStore((s: any) => Number(s.assets?.kernelCount ?? 0));
  const setAssets = useAppStore((s: any) => s.setAssets);
  const setShop = useAppStore((s: any) => s.setShop);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: t("giftshop.title"),
    });
  }, [navigation, t]);

  const onPressBuy = useCallback(
    async (gift: GiftItem) => {
      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();
      if (!token || !userId) {
        showGlobalModal(t("giftshop.title"), t("common.auth_expired"));
        return;
      }

      const out = await purchaseGiftWithKernelOnServer({
        token,
        userId,
        deviceKey,
        giftId: gift.id,
        costKernel: gift.costKernel,
        count: 1,
        idempotencyKey: `gift_${gift.id}_${Date.now()}`,
      });
      if (!out.ok) {
        const errCode = String(out.errorCode || "").toUpperCase();
        if (errCode === "INSUFFICIENT_KERNEL") {
          showGlobalModal(t("giftshop.title"), t("giftshop.error.insufficient_kernel", { balance: formatNumber(kernelCount) }));
          return;
        }
        showGlobalModal(t("giftshop.title"), out.errorMessage || out.errorCode || t("giftshop.error.buy_failed"));
        return;
      }

      const inventory = await fetchShopGiftInventory({ token, userId, deviceKey });
      if (inventory.ok && inventory.giftStateFound) {
        setShop({
          giftsOwned: inventory.giftsOwned,
          giftsReceived: inventory.giftsReceived,
        });
        setAssets({
          kernelCount: inventory.walletKernel,
          updatedAtMs: Date.now(),
        });
      }
      showGlobalModal(t("giftshop.title"), t("giftshop.buy_done", { name: getGiftDisplayName(t, gift) }));
    },
    [auth?.deviceKey, auth?.token, auth?.userId, kernelCount, setAssets, setShop, showGlobalModal, t]
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#2A0B24", "#4A1140", "#6C1A53", "#2D0D2F"]} style={StyleSheet.absoluteFill} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 20, 28) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.balanceCard}>
          <View style={styles.balanceRow}>
            <Ionicons name="diamond-outline" size={18} color="#FFE3A4" />
            <AppText style={styles.balanceTitle}>{t("giftshop.balance_kernel")}</AppText>
            <AppText style={styles.balanceValue}>{formatNumber(kernelCount)}</AppText>
          </View>
          <AppText style={styles.balanceDesc}>{t("giftshop.balance_desc")}</AppText>
        </View>

        <View style={styles.grid}>
          {GIFT_CATALOG.map((gift) => (
            <View style={styles.cardWrap} key={gift.id}>
              <LinearGradient
                colors={["rgba(255,255,255,0.16)", "rgba(255,173,226,0.10)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <GiftArt gift={gift} />
                <AppText style={styles.nameText}>{getGiftDisplayName(t, gift)}</AppText>
                <AppText style={styles.priceText}>{t("giftshop.price_kernel", { cost: formatNumber(gift.costKernel) })}</AppText>
                <Pressable onPress={() => onPressBuy(gift)} style={({ pressed }) => [styles.buyBtn, pressed ? styles.buyBtnPressed : null]}>
                  <AppText style={styles.buyBtnText}>{t("giftshop.buy")}</AppText>
                </Pressable>
              </LinearGradient>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#2A0B24" },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 12,
  },
  balanceCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,233,186,0.35)",
    backgroundColor: "rgba(0,0,0,0.28)",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  balanceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  balanceTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFEBC7",
    flex: 1,
  },
  balanceValue: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFF3CE",
  },
  balanceDesc: {
    color: "rgba(255,225,240,0.82)",
    fontSize: 12,
    lineHeight: 16,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  cardWrap: {
    width: "48.5%",
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,212,246,0.35)",
    padding: 8,
    gap: 6,
    minHeight: 194,
  },
  artFrame: {
    height: 95,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  artDot: {
    position: "absolute",
    width: 76,
    height: 76,
    borderRadius: 38,
    opacity: 0.34,
  },
  artEmoji: {
    fontSize: 40,
  },
  nameText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFF3FB",
  },
  priceText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFE2AE",
  },
  buyBtn: {
    marginTop: "auto",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.6)",
    backgroundColor: "rgba(255,173,69,0.35)",
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  buyBtnPressed: {
    opacity: 0.75,
  },
  buyBtnText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFF6D6",
  },
});
