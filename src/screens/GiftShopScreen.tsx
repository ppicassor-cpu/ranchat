import React, { useCallback, useLayoutEffect } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import AppText from "../components/AppText";
import { useAppStore } from "../store/useAppStore";
import { GIFT_CATALOG, type GiftItem } from "../constants/giftCatalog";

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
  const kernelCount = useAppStore((s: any) => Number(s.assets?.kernelCount ?? 0));
  const purchaseGiftWithKernel = useAppStore((s: any) => s.purchaseGiftWithKernel);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: "선물 상점",
    });
  }, [navigation]);

  const onPressBuy = useCallback(
    (gift: GiftItem) => {
      const out = purchaseGiftWithKernel(gift.id, gift.costKernel, 1);
      if (!out?.ok) {
        showGlobalModal("선물 상점", "커널이 부족합니다.");
        return;
      }
      showGlobalModal("선물 상점", `${gift.name} 선물을 구매했습니다.`);
    },
    [purchaseGiftWithKernel, showGlobalModal]
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
            <AppText style={styles.balanceTitle}>보유 커널</AppText>
            <AppText style={styles.balanceValue}>{formatNumber(kernelCount)}</AppText>
          </View>
          <AppText style={styles.balanceDesc}>구매한 선물은 통화 중 선물함에서 전송할 수 있습니다.</AppText>
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
                <AppText style={styles.nameText}>{gift.name}</AppText>
                <AppText style={styles.priceText}>{formatNumber(gift.costKernel)} 커널</AppText>
                <Pressable onPress={() => onPressBuy(gift)} style={({ pressed }) => [styles.buyBtn, pressed ? styles.buyBtnPressed : null]}>
                  <AppText style={styles.buyBtnText}>구매</AppText>
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

