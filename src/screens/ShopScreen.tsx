import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Image,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppText from "../components/AppText";
import { useAppStore } from "../store/useAppStore";
import { purchaseOneTimeByProductId } from "../services/purchases/PurchaseManager";
import { confirmShopPurchase } from "../services/shop/ShopPurchaseService";

type PopcornPack = {
  id: string;
  amount: number;
  priceKrw: number;
  image: ImageSourcePropType;
  sparkleLevel: number;
  overlayBadge?: string;
};

type KernelPack = {
  id: string;
  amount: number;
  priceKrw: number;
  image: ImageSourcePropType;
  sparkleLevel: number;
  imageScale?: number;
  vip?: boolean;
};

type Sparkle = { left: number; top: number; size: number; opacity: number };
const SHOP_IMG_1 = require("../../assets/1.png");
const SHOP_IMG_2 = require("../../assets/2.png");
const SHOP_IMG_3 = require("../../assets/3.png");
const SHOP_IMG_4 = require("../../assets/4.png");
const SHOP_IMG_5 = require("../../assets/5.png");
const SHOP_IMG_6 = require("../../assets/6.png");

const POP_IMG_1 = require("../../assets/1P.png");
const POP_IMG_2 = require("../../assets/2P.png");
const POP_IMG_3 = require("../../assets/3P.png");
const POP_IMG_4 = require("../../assets/4P.png");
const POP_IMG_5 = require("../../assets/5P.png");
const POP_IMG_6 = require("../../assets/6P.png");
const POP_IMG_7 = require("../../assets/7P.png");

const POPCORN_PACKS: PopcornPack[] = [
  { id: "once_2000", amount: 2000, priceKrw: 2400, image: POP_IMG_1, sparkleLevel: 3 },
  { id: "once_5000", amount: 5000, priceKrw: 5400, image: POP_IMG_2, sparkleLevel: 4 },
  { id: "once_10000", amount: 10000, priceKrw: 9600, image: POP_IMG_3, sparkleLevel: 5 },
  { id: "once_20000", amount: 20000, priceKrw: 14000, image: POP_IMG_4, sparkleLevel: 6, overlayBadge: "BEST" },
  { id: "once_30000", amount: 30000, priceKrw: 22000, image: POP_IMG_5, sparkleLevel: 6 },
  { id: "once_50000", amount: 50000, priceKrw: 32000, image: POP_IMG_6, sparkleLevel: 7 },
  { id: "once_100000", amount: 100000, priceKrw: 58000, image: POP_IMG_7, sparkleLevel: 8 },
];

const KERNEL_PACKS: KernelPack[] = [
  { id: "kernel_500", amount: 500, priceKrw: 1200, image: SHOP_IMG_1, sparkleLevel: 3, imageScale: 0.82 },
  { id: "kernel_2000", amount: 2000, priceKrw: 4000, image: SHOP_IMG_2, sparkleLevel: 4, imageScale: 0.88 },
  { id: "kernel_5000", amount: 5000, priceKrw: 9000, image: SHOP_IMG_3, sparkleLevel: 5, imageScale: 0.9 },
  { id: "kernel_10000", amount: 10000, priceKrw: 16000, image: SHOP_IMG_4, sparkleLevel: 6, imageScale: 0.96 },
  { id: "kernel_25000", amount: 25000, priceKrw: 36000, image: SHOP_IMG_5, sparkleLevel: 7, imageScale: 0.98 },
  { id: "kernel_50000", amount: 50000, priceKrw: 65000, image: SHOP_IMG_6, sparkleLevel: 8, imageScale: 1.02, vip: true },
];

const POPCORN_PRODUCT_IDS: Record<string, string> = {
  once_2000: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_2000_PRODUCT_ID || "").trim(),
  once_5000: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_5000_PRODUCT_ID || "").trim(),
  once_10000: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_10000_PRODUCT_ID || "").trim(),
  once_20000: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_20000_PRODUCT_ID || "").trim(),
  once_30000: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_30000_PRODUCT_ID || "").trim(),
  once_50000: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_50000_PRODUCT_ID || "").trim(),
  once_100000: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_100000_PRODUCT_ID || "").trim(),
};

const KERNEL_PRODUCT_IDS: Record<string, string> = {
  kernel_500: String(process.env.EXPO_PUBLIC_SHOP_KERNEL_500_PRODUCT_ID || "").trim(),
  kernel_2000: String(process.env.EXPO_PUBLIC_SHOP_KERNEL_2000_PRODUCT_ID || "").trim(),
  kernel_5000: String(process.env.EXPO_PUBLIC_SHOP_KERNEL_5000_PRODUCT_ID || "").trim(),
  kernel_10000: String(process.env.EXPO_PUBLIC_SHOP_KERNEL_10000_PRODUCT_ID || "").trim(),
  kernel_25000: String(process.env.EXPO_PUBLIC_SHOP_KERNEL_25000_PRODUCT_ID || "").trim(),
  kernel_50000: String(process.env.EXPO_PUBLIC_SHOP_KERNEL_50000_PRODUCT_ID || "").trim(),
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_GAP = 12;
const PAGE_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - PAGE_PADDING * 2 - CARD_GAP) / 2;
const POP_BASE_UNIT_PER_1000 = 1200;
const KERNEL_BASE_UNIT_PER_1000 = 2400;

const SPARKLES: Sparkle[] = [
  { left: 10, top: 10, size: 8, opacity: 0.8 },
  { left: 34, top: 8, size: 9, opacity: 0.66 },
  { left: 64, top: 12, size: 7, opacity: 0.72 },
  { left: 100, top: 16, size: 9, opacity: 0.62 },
  { left: 114, top: 52, size: 7, opacity: 0.58 },
  { left: 82, top: 72, size: 8, opacity: 0.64 },
  { left: 44, top: 76, size: 9, opacity: 0.67 },
  { left: 16, top: 62, size: 8, opacity: 0.6 },
];

function formatNumber(n: number): string {
  return Math.max(0, Math.trunc(Number(n) || 0)).toLocaleString("ko-KR");
}

function PopcornArt({
  image,
  sparkleLevel,
  showX2,
  overlayBadge,
}: {
  image: ImageSourcePropType;
  sparkleLevel: number;
  showX2: boolean;
  overlayBadge?: string;
}) {
  return (
    <LinearGradient
      colors={["rgba(171,224,255,0.82)", "rgba(136,152,255,0.36)", "rgba(157,110,255,0.28)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.artFrame}
    >
      <View style={styles.artHalo} />

      {SPARKLES.slice(0, Math.min(SPARKLES.length, sparkleLevel)).map((sp, idx) => (
        <Ionicons
          key={`sp_pop_${idx}`}
          name="sparkles"
          size={sp.size}
          color="#FFF7C7"
          style={[
            styles.sparkle,
            {
              left: sp.left,
              top: sp.top,
              opacity: sp.opacity,
            },
          ]}
        />
      ))}

      <Image source={image} resizeMode="cover" style={styles.artImageCover} />

      {overlayBadge ? (
        <View style={styles.bestBadge}>
          <AppText style={styles.bestBadgeText}>{overlayBadge}</AppText>
        </View>
      ) : null}

      {showX2 ? (
        <View style={styles.x2BadgeOverlay}>
          <AppText style={styles.x2BadgeText}>x2</AppText>
        </View>
      ) : null}
    </LinearGradient>
  );
}

function KernelArt({
  image,
  sparkleLevel,
  showX2,
  vip,
}: {
  image: ImageSourcePropType;
  sparkleLevel: number;
  showX2: boolean;
  vip?: boolean;
}) {
  return (
    <LinearGradient
      colors={["rgba(255,205,121,0.33)", "rgba(255,141,47,0.24)", "rgba(91,41,3,0.34)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.artFrame}
    >
      <LinearGradient colors={["rgba(255,187,76,0.22)", "transparent"]} style={styles.kernelHalo} />

      {SPARKLES.slice(0, Math.min(SPARKLES.length, sparkleLevel)).map((sp, idx) => (
        <Ionicons
          key={`sp_kernel_${idx}`}
          name="sparkles"
          size={sp.size}
          color="#FFE8A9"
          style={[
            styles.sparkle,
            {
              left: sp.left,
              top: sp.top,
              opacity: sp.opacity,
            },
          ]}
        />
      ))}

      <Image source={image} resizeMode="cover" style={styles.artImageCover} />

      {vip ? (
        <View style={styles.vipBadge}>
          <AppText style={styles.vipBadgeText}>VIP</AppText>
        </View>
      ) : null}

      {showX2 ? (
        <View style={styles.x2BadgeOverlay}>
          <AppText style={styles.x2BadgeText}>x2</AppText>
        </View>
      ) : null}
    </LinearGradient>
  );
}

export default function ShopScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<ScrollView | null>(null);

  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);
  const auth = useAppStore((s: any) => s.auth);
  const firstPurchaseClaimed = useAppStore((s: any) => s.shop?.firstPurchaseClaimed || {});
  const markFirstPurchaseClaimed = useAppStore((s: any) => s.markFirstPurchaseClaimed);
  const setAssets = useAppStore((s: any) => s.setAssets);

  const [activeTab, setActiveTab] = useState<0 | 1>(0);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);

  const popcornItems = useMemo(
    () =>
      POPCORN_PACKS.map((item) => {
        const basePrice = Math.round((item.amount / 1000) * POP_BASE_UNIT_PER_1000);
        const discountRate = Math.max(0, Math.round((1 - item.priceKrw / basePrice) * 100));
        return {
          ...item,
          basePrice,
          discountRate,
          bonusAmount: item.amount,
        };
      }),
    []
  );

  const kernelItems = useMemo(
    () =>
      KERNEL_PACKS.map((item) => {
        const basePrice = Math.round((item.amount / 1000) * KERNEL_BASE_UNIT_PER_1000);
        const discountRate = Math.max(0, Math.round((1 - item.priceKrw / basePrice) * 100));
        return {
          ...item,
          basePrice,
          discountRate,
          bonusAmount: item.amount,
        };
      }),
    []
  );

  const goTab = useCallback((tab: 0 | 1) => {
    setActiveTab(tab);
    pagerRef.current?.scrollTo({ x: tab * SCREEN_WIDTH, y: 0, animated: true });
  }, []);

  const onPagerEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = Number(e.nativeEvent.contentOffset?.x || 0);
    const next = Math.round(x / SCREEN_WIDTH) === 1 ? 1 : 0;
    setActiveTab(next);
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: "#2B0E2B" },
      headerTitleAlign: "left",
      headerTitleContainerStyle: { left: 58, right: 12 },
      headerLeft: () => (
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerBackBtn}>
          <AppText style={styles.headerBackText}>{"<"}</AppText>
        </Pressable>
      ),
      headerTitle: () => (
        <View style={styles.headerTabs}>
          <Pressable onPress={() => goTab(0)} style={[styles.headerTab, activeTab === 0 ? styles.headerTabActive : null]}>
            <AppText style={[styles.headerTabText, activeTab === 0 ? styles.headerTabTextActive : null]}>팝콘상점</AppText>
          </Pressable>
          <Pressable onPress={() => goTab(1)} style={[styles.headerTab, activeTab === 1 ? styles.headerTabActive : null]}>
            <AppText style={[styles.headerTabText, activeTab === 1 ? styles.headerTabTextActive : null]}>커널상점</AppText>
          </Pressable>
        </View>
      ),
    });
  }, [activeTab, goTab, navigation]);

  const onPressCard = useCallback(
    async (kind: "popcorn" | "kernel", id: string, amount: number, priceKrw: number, bonusAmount: number) => {
      if (buyingPackId) return;
      const productId = kind === "popcorn" ? POPCORN_PRODUCT_IDS[id] || "" : KERNEL_PRODUCT_IDS[id] || "";

      const unit = kind === "kernel" ? "커널" : "팝콘";
      const title = kind === "kernel" ? "커널 상점" : "팝콘 상점";
      if (!productId) {
        showGlobalModal(title, "해당 상품의 결제 상품 ID가 아직 설정되지 않았습니다.");
        return;
      }

      setBuyingPackId(id);
      try {
        const out = await purchaseOneTimeByProductId(productId);
        if (out.ok) {
          const confirmed = await confirmShopPurchase({
            token: auth?.token,
            userId: auth?.userId,
            deviceKey: auth?.deviceKey,
            kind,
            packId: id,
            productId: out.productId || productId,
            amount,
            bonusAmount,
            priceKrw,
            transactionId: out.transactionId,
            purchaseDate: out.purchaseDate,
            rcAppUserId: out.rcAppUserId,
            idempotencyKey: `shop_${id}_${out.transactionId}`,
          });

          if (!confirmed.ok) {
            showGlobalModal(title, `결제 확인에 실패했습니다.\n${confirmed.errorMessage || confirmed.errorCode || "CONFIRM_FAILED"}`);
            return;
          }

          markFirstPurchaseClaimed(id);
          setAssets({
            popcornCount: confirmed.walletPopcorn,
            kernelCount: confirmed.walletKernel,
            updatedAtMs: Date.now(),
          });

          const bonusApplied = Boolean(confirmed.firstPurchaseBonusApplied);
          const successMsg = !bonusApplied
            ? `${formatNumber(amount)} ${unit} 결제가 완료되었습니다.`
            : `${formatNumber(amount)} + ${formatNumber(bonusAmount)} ${unit} 결제가 완료되었습니다.`;
          showGlobalModal(title, successMsg);
          return;
        }

        if (out.cancelled) return;
        showGlobalModal(title, `결제에 실패했습니다.\n${out.errorMessage || out.errorCode || "PURCHASE_FAILED"}`);
      } finally {
        setBuyingPackId(null);
      }
    },
    [auth?.deviceKey, auth?.token, auth?.userId, buyingPackId, markFirstPurchaseClaimed, setAssets, showGlobalModal]
  );

  const renderPage = useCallback(
    (kind: "popcorn" | "kernel") => {
      const isPop = kind === "popcorn";
      const items = isPop ? popcornItems : kernelItems;
      const pageTitle = isPop ? "핫딜 팝콘 상점" : "핫딜 커널 상점";

      return (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: 8,
              paddingBottom: Math.max(24, insets.bottom + 12),
            },
          ]}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
        >
          <View style={styles.hero}>
            <View style={styles.heroRow}>
              <View style={styles.heroBadge}>
                <Ionicons name="flash" size={12} color="#FFE99E" />
                <AppText style={styles.heroBadgeText}>HOT DEAL</AppText>
              </View>
              <AppText style={styles.heroRowTitle}>{pageTitle}</AppText>
            </View>
          </View>

          <View style={styles.grid}>
            {items.map((item) => {
              const claimed = Boolean(firstPurchaseClaimed[item.id]);
              return (
                <Pressable
                  key={item.id}
                  disabled={Boolean(buyingPackId)}
                  onPress={() => onPressCard(kind, item.id, item.amount, item.priceKrw, item.bonusAmount)}
                  style={({ pressed }) => [styles.cardShell, (pressed || Boolean(buyingPackId)) ? styles.cardPressed : null]}
                >
                  <LinearGradient
                    colors={["rgba(255,255,255,0.16)", "rgba(196,154,255,0.11)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.card}
                  >
                    {isPop ? (
                      <PopcornArt
                        image={(item as any).image}
                        sparkleLevel={(item as any).sparkleLevel}
                        overlayBadge={(item as any).overlayBadge}
                        showX2={!claimed}
                      />
                    ) : (
                      <KernelArt
                        image={(item as any).image}
                        sparkleLevel={(item as any).sparkleLevel}
                        vip={Boolean((item as any).vip)}
                        showX2={!claimed}
                      />
                    )}

                    <View style={styles.amountBlock}>
                      <AppText style={styles.amountBase}>{formatNumber(item.amount)}</AppText>
                      {!claimed ? <AppText style={styles.amountPlus}> + </AppText> : null}
                      {!claimed ? <AppText style={styles.amountBonus}>{formatNumber(item.bonusAmount)}</AppText> : null}
                    </View>

                    <LinearGradient
                      colors={["rgba(255,232,159,0.95)", "rgba(255,205,99,0.96)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.priceBar}
                    >
                      <View style={styles.priceRow}>
                        <AppText style={styles.price}>{formatNumber(item.priceKrw)}원</AppText>
                        <View style={styles.rateBadge}>
                          <AppText style={styles.rateBadgeText}>{item.discountRate > 0 ? `${item.discountRate}%` : "기본가"}</AppText>
                        </View>
                      </View>
                    </LinearGradient>
                  </LinearGradient>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      );
    },
    [firstPurchaseClaimed, insets.bottom, kernelItems, onPressCard, popcornItems]
  );

  return (
    <View style={styles.root}>
      <LinearGradient colors={["#2A0B24", "#4A1140", "#6C1A53", "#2D0D2F"]} style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={["rgba(255,105,170,0.24)", "rgba(255,140,196,0.1)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerEnd}
        bounces={false}
        overScrollMode="never"
      >
        <View style={styles.page}>{renderPage("popcorn")}</View>
        <View style={styles.page}>{renderPage("kernel")}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#2A0B24",
  },
  page: {
    width: SCREEN_WIDTH,
  },
  headerBackBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  headerBackText: {
    fontSize: 24,
    fontWeight: "900",
    color: "#EFE6FF",
  },
  headerTabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  headerTab: {
    minWidth: 88,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTabActive: {
    backgroundColor: "rgba(255,154,212,0.3)",
    borderColor: "rgba(255,207,234,0.72)",
  },
  headerTabText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#E6DBFF",
  },
  headerTabTextActive: {
    color: "#FFE4F4",
  },
  content: {
    paddingHorizontal: PAGE_PADDING,
    gap: 12,
  },
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,210,236,0.26)",
    backgroundColor: "rgba(57,17,49,0.62)",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,206,74,0.25)",
    borderWidth: 1,
    borderColor: "rgba(255,236,157,0.6)",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  heroBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFE9A3",
  },
  heroRowTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#FFB7DE",
    textAlign: "right",
    flex: 1,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: CARD_GAP,
  },
  cardShell: {
    width: CARD_WIDTH,
  },
  cardPressed: {
    opacity: 0.8,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,211,236,0.28)",
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 10,
    backgroundColor: "rgba(255,174,224,0.16)",
  },
  artFrame: {
    height: 118,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  artHalo: {
    position: "absolute",
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: "rgba(255,228,171,0.24)",
  },
  kernelHalo: {
    position: "absolute",
    width: 118,
    height: 118,
    borderRadius: 59,
    top: 0,
    left: 10,
  },
  sparkle: {
    position: "absolute",
  },
  artImage: {
    width: "96%",
    height: "96%",
  },
  artImageCover: {
    width: "100%",
    height: "100%",
  },
  x2BadgeOverlay: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E6385D",
    borderWidth: 2,
    borderColor: "rgba(255,151,165,0.9)",
    alignItems: "center",
    justifyContent: "center",
  },
  x2BadgeText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFF4CE",
  },
  bestBadge: {
    position: "absolute",
    left: 6,
    top: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,245,191,0.8)",
    backgroundColor: "rgba(255,201,83,0.9)",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  bestBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#6A3900",
  },
  vipBadge: {
    position: "absolute",
    left: 6,
    top: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.86)",
    backgroundColor: "rgba(148,78,255,0.78)",
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  vipBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#FFF2FF",
  },
  amountBlock: {
    marginTop: 8,
    minHeight: 32,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  amountBase: {
    fontSize: 20,
    fontWeight: "900",
    color: "#F2F4FF",
    textAlign: "center",
  },
  amountPlus: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFD37F",
    marginHorizontal: 2,
  },
  amountBonus: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFD37F",
  },
  priceBar: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.56)",
    minHeight: 46,
    paddingHorizontal: 9,
    justifyContent: "center",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  price: {
    fontSize: 20,
    color: "#6F3500",
    fontWeight: "900",
  },
  rateBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(79,42,0,0.32)",
    backgroundColor: "rgba(255,255,255,0.4)",
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  rateBadgeText: {
    fontSize: 11,
    color: "#6B3F12",
    fontWeight: "800",
  },
});
