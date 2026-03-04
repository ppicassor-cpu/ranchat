import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  TextInput,
  UIManager,
  type ImageSourcePropType,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView } from "expo-video";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "../i18n/LanguageProvider";
import AppText from "../components/AppText";
import { useAppStore } from "../store/useAppStore";
import { formatPopTalkCount, isPopTalkUnlimited } from "../utils/poptalkDisplay";
import { purchaseOneTimeByProductId } from "../services/purchases/PurchaseManager";
import {
  confirmShopPurchase,
  convertKernelToPopTalk,
  exchangeReceivedGiftsOnServer,
  fetchShopFirstPurchaseClaims,
  fetchShopGiftInventory,
  fetchUnifiedWalletState,
  purchaseGiftWithKernelOnServer,
} from "../services/shop/ShopPurchaseService";
import { GIFT_CATALOG, getGiftDisplayName, type GiftItem } from "../constants/giftCatalog";

type PopcornPack = {
  id: string;
  amount: number;
  priceKrw: number;
  image: ImageSourcePropType;
  sparkleLevel: number;
  overlayBadge?: string;
  displayAmountLabel?: string;
  allowFirstPurchaseBonus?: boolean;
  planOverride?: "monthly";
  planDurationDays?: number;
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
const POP_IMG_8 = require("../../assets/8P.png");
const POPM_ICON = require("../../assets/popm.png");
const POPM_VIDEO = require("../../assets/POP_crop.mp4");
const KERNEL_BALANCE_ICON = require("../../assets/kernel.png");
const POPTALK_BALANCE_ICON = require("../../assets/poptalk_ICON.png");
const EMPTY_BOX_IMG = require("../../assets/box.png");
const GIFT_IMG_ARROW = require("../../assets/gift/arrow.png");
const GIFT_IMG_BANANA_MILK = require("../../assets/gift/bananamilk.png");
const GIFT_IMG_BOUQUET = require("../../assets/gift/bouquest.png");
const GIFT_IMG_CAKE = require("../../assets/gift/cake.png");
const GIFT_IMG_CANDY = require("../../assets/gift/candy.png");
const GIFT_IMG_COTTON_CANDY = require("../../assets/gift/cottoncandy.png");
const GIFT_IMG_CRYSTAL_ROSE = require("../../assets/gift/crystalrose.png");
const GIFT_IMG_HEART_BALLOON = require("../../assets/gift/heartballoom.png");
const GIFT_IMG_ICE_CREAM = require("../../assets/gift/icecream.png");
const GIFT_IMG_KISS = require("../../assets/gift/lips.png");
const GIFT_IMG_LOVE_HEART = require("../../assets/gift/loveheart.png");
const GIFT_IMG_MAGIC_WAND = require("../../assets/gift/magicstick.png");
const GIFT_IMG_SEAL_STAMP = require("../../assets/gift/personalseal.png");
const GIFT_IMG_RING = require("../../assets/gift/ring.png");
const GIFT_IMG_ROSE = require("../../assets/gift/rose.png");
const GIFT_IMG_SUPERCAR = require("../../assets/gift/supercar.png");
const GIFT_IMG_TEDDY_BEAR = require("../../assets/gift/teddybear.png");
const GIFT_IMG_TOY_HAMMER = require("../../assets/gift/toyhammer.png");

const GIFT_IMAGE_BY_ID: Record<string, ImageSourcePropType> = {
  candy: GIFT_IMG_CANDY,
  banana_milk: GIFT_IMG_BANANA_MILK,
  ice_cream: GIFT_IMG_ICE_CREAM,
  rose: GIFT_IMG_ROSE,
  love_heart: GIFT_IMG_LOVE_HEART,
  cotton_candy: GIFT_IMG_COTTON_CANDY,
  toy_hammer: GIFT_IMG_TOY_HAMMER,
  birthday_cake: GIFT_IMG_CAKE,
  heart_balloon: GIFT_IMG_HEART_BALLOON,
  kiss: GIFT_IMG_KISS,
  arrow: GIFT_IMG_ARROW,
  crystal_rose: GIFT_IMG_CRYSTAL_ROSE,
  magic_wand: GIFT_IMG_MAGIC_WAND,
  teddy_bear: GIFT_IMG_TEDDY_BEAR,
  bouquet: GIFT_IMG_BOUQUET,
  ring: GIFT_IMG_RING,
  supercar: GIFT_IMG_SUPERCAR,
  seal_stamp: GIFT_IMG_SEAL_STAMP,
};

const POPCORN_PACKS: PopcornPack[] = [
  { id: "once_2000", amount: 2000, priceKrw: 2400, image: POP_IMG_1, sparkleLevel: 3 },
  { id: "once_5000", amount: 5000, priceKrw: 5400, image: POP_IMG_2, sparkleLevel: 4 },
  { id: "once_10000", amount: 10000, priceKrw: 9600, image: POP_IMG_3, sparkleLevel: 5 },
  { id: "once_20000", amount: 20000, priceKrw: 14000, image: POP_IMG_4, sparkleLevel: 6, overlayBadge: "BEST" },
  { id: "once_30000", amount: 30000, priceKrw: 22000, image: POP_IMG_5, sparkleLevel: 6 },
  { id: "once_50000", amount: 50000, priceKrw: 32000, image: POP_IMG_6, sparkleLevel: 7 },
  { id: "once_100000", amount: 100000, priceKrw: 58000, image: POP_IMG_7, sparkleLevel: 8 },
  {
    id: "once_unlimited_1m",
    amount: 0,
    priceKrw: 88000,
    image: POP_IMG_8,
    sparkleLevel: 8,
    overlayBadge: "1 month",
    displayAmountLabel: "1 month unlimited",
    allowFirstPurchaseBonus: false,
    planOverride: "monthly",
    planDurationDays: 30,
  },
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
  once_unlimited_1m: String(process.env.EXPO_PUBLIC_SHOP_POPCORN_UNLIMITED_1M_PRODUCT_ID || "ranchat.popcorn.free").trim(),
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
const SCREEN_HEIGHT = Dimensions.get("window").height;
const CARD_GAP = 12;
const PAGE_PADDING = 16;
const CARD_WIDTH = (SCREEN_WIDTH - PAGE_PADDING * 2 - CARD_GAP) / 2;
const GIFT_SHOP_CARD_GAP = 8;
const GIFT_SHOP_CARD_WIDTH = Math.max(94, Math.floor((SCREEN_WIDTH - PAGE_PADDING * 2 - GIFT_SHOP_CARD_GAP * 2) / 3));
const GIFTBOX_CARD_GAP = 6;
const GIFTBOX_SECTION_PADDING_X = 8;
const GIFTBOX_GRID_EDGE_SAFE = 4;
const GIFTBOX_CARD_WIDTH = Math.max(
  56,
  Math.floor((SCREEN_WIDTH - PAGE_PADDING * 2 - GIFTBOX_SECTION_PADDING_X * 2 - GIFTBOX_CARD_GAP * 3 - GIFTBOX_GRID_EDGE_SAFE) / 4)
);
const GIFTBOX_RECEIVED_CARD_WIDTH = Math.max(
  72,
  Math.floor((SCREEN_WIDTH - PAGE_PADDING * 2 - GIFTBOX_SECTION_PADDING_X * 2 - GIFTBOX_CARD_GAP * 2 - GIFTBOX_GRID_EDGE_SAFE) / 3)
);
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
const FIRST_PURCHASE_OUTER_SPIKES = Array.from({ length: 18 }, (_, idx) => idx);
const FIRST_PURCHASE_INNER_SPIKES = Array.from({ length: 14 }, (_, idx) => idx);

function formatNumber(n: number): string {
  return Math.max(0, Math.trunc(Number(n) || 0)).toLocaleString("ko-KR");
}

function asCount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function calcExchangeKernel(costKernel: number, count: number): number {
  const unit = Math.max(0, Math.trunc(Number(costKernel) * 0.8));
  return unit * Math.max(0, Math.trunc(Number(count) || 0));
}

function randomDelayMs(kernelAmount: number): number {
  const amount = Math.max(0, Math.trunc(Number(kernelAmount) || 0));
  if (amount >= 3000) {
    return 7000 + Math.floor(Math.random() * 3001);
  }
  return 3000 + Math.floor(Math.random() * 2001);
}

function sampleMultiplier(): number {
  const r = Math.random() * 100;
  if (r < 1) return 2;
  if (r < 5) return 1.5;
  if (r < 25) return 1.2;
  return 1;
}

function FirstPurchaseBadge({ label }: { label: string }) {
  return (
    <View pointerEvents="none" style={styles.x2BadgeOverlay}>
      {FIRST_PURCHASE_OUTER_SPIKES.map((idx) => {
        const deg = (360 / FIRST_PURCHASE_OUTER_SPIKES.length) * idx;
        const rad = (deg * Math.PI) / 180;
        const dist = 21;
        const tx = Math.cos(rad) * dist;
        const ty = Math.sin(rad) * dist;
        return (
          <View
            key={`x2_outer_spike_${idx}`}
            style={[
              styles.x2BadgeOuterSpike,
              {
                transform: [{ translateX: tx }, { translateY: ty }, { rotate: `${deg + 90}deg` }],
              },
            ]}
          />
        );
      })}

      <View style={styles.x2BadgeCoreWrap}>
        {FIRST_PURCHASE_INNER_SPIKES.map((idx) => {
          const deg = (360 / FIRST_PURCHASE_INNER_SPIKES.length) * idx;
          const rad = (deg * Math.PI) / 180;
          const dist = 16;
          const tx = Math.cos(rad) * dist;
          const ty = Math.sin(rad) * dist;
          return (
            <View
              key={`x2_inner_spike_${idx}`}
              style={[
                styles.x2BadgeInnerSpike,
                {
                  transform: [{ translateX: tx }, { translateY: ty }, { rotate: `${deg + 90}deg` }],
                },
              ]}
            />
          );
        })}

        <View style={styles.x2BadgeCore}>
          <AppText style={styles.x2BadgeTopText}>{label}</AppText>
          <AppText style={styles.x2BadgeBottomText}>x2</AppText>
        </View>
      </View>
    </View>
  );
}

function PopcornArt({
  image,
  sparkleLevel,
  showX2,
  firstPurchaseLabel,
  overlayBadge,
}: {
  image: ImageSourcePropType;
  sparkleLevel: number;
  showX2: boolean;
  firstPurchaseLabel: string;
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

      {showX2 ? <FirstPurchaseBadge label={firstPurchaseLabel} /> : null}
    </LinearGradient>
  );
}

function KernelArt({
  image,
  sparkleLevel,
  showX2,
  firstPurchaseLabel,
  vip,
}: {
  image: ImageSourcePropType;
  sparkleLevel: number;
  showX2: boolean;
  firstPurchaseLabel: string;
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

      {showX2 ? <FirstPurchaseBadge label={firstPurchaseLabel} /> : null}
    </LinearGradient>
  );
}

export default function ShopScreen({ route }: { route?: { params?: { initialTab?: 0 | 1 | 2 | 3 | 4 } } }) {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const pagerRef = useRef<ScrollView | null>(null);
  const headerTabsScrollRef = useRef<ScrollView | null>(null);
  const headerTabsViewportWidthRef = useRef(0);
  const headerTabLayoutsRef = useRef<Record<number, { x: number; width: number }>>({});
  const activeTabRef = useRef<0 | 1 | 2 | 3 | 4>(0);
  const popmScrollRef = useRef<ScrollView | null>(null);
  const popmVideoEndedRef = useRef(false);
  const popmPendingModalRef = useRef<{ body: string } | null>(null);

  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);
  const auth = useAppStore((s: any) => s.auth);
  const popTalk = useAppStore((s: any) => s.popTalk);
  const kernelBalance = useAppStore((s: any) => Number(s.assets?.kernelCount ?? 0));
  const firstPurchaseClaimed = useAppStore((s: any) => s.shop?.firstPurchaseClaimed || {});
  const giftsOwnedMap = useAppStore((s: any) => s.shop?.giftsOwned || {});
  const giftsReceivedMap = useAppStore((s: any) => s.shop?.giftsReceived || {});
  const markFirstPurchaseClaimed = useAppStore((s: any) => s.markFirstPurchaseClaimed);
  const setAssets = useAppStore((s: any) => s.setAssets);
  const setPopTalk = useAppStore((s: any) => s.setPopTalk);
  const setShop = useAppStore((s: any) => s.setShop);

  const [activeTab, setActiveTab] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [pagerScrollX, setPagerScrollX] = useState(0);
  const [buyingPackId, setBuyingPackId] = useState<string | null>(null);
  const [purchaseConfirming, setPurchaseConfirming] = useState(false);
  const [popmKernelInput, setPopmKernelInput] = useState("");
  const [popmConverting, setPopmConverting] = useState(false);
  const [popmInputFocused, setPopmInputFocused] = useState(false);
  const [popmVideoExpanded, setPopmVideoExpanded] = useState(false);
  const [popmOverlayVisible, setPopmOverlayVisible] = useState(false);
  const [popmResultModalVisible, setPopmResultModalVisible] = useState(false);
  const [popmResultModalBody, setPopmResultModalBody] = useState("");
  const [giftBuyTarget, setGiftBuyTarget] = useState<GiftItem | null>(null);
  const [giftBuyCount, setGiftBuyCount] = useState(1);
  const [giftBuying, setGiftBuying] = useState(false);
  const [giftExchangeMode, setGiftExchangeMode] = useState(false);
  const [giftExchanging, setGiftExchanging] = useState(false);
  const [selectedReceivedGiftCountMap, setSelectedReceivedGiftCountMap] = useState<Record<string, number>>({});
  const [firstPurchaseSynced, setFirstPurchaseSynced] = useState(false);
  const routeInitialTab = route?.params?.initialTab;
  const popmExpandAnim = useRef(new Animated.Value(0)).current;
  const popmPlayer = useVideoPlayer(POPM_VIDEO, (player) => {
    player.loop = false;
    player.muted = true;
    player.volume = 0;
    player.pause();
    player.currentTime = 0;
  });
  const popmInputWrapYRef = useRef(0);
  const popmInputScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearPopmInputScrollTimer = useCallback(() => {
    if (!popmInputScrollTimerRef.current) return;
    clearTimeout(popmInputScrollTimerRef.current);
    popmInputScrollTimerRef.current = null;
  }, []);

  const ensurePopmInputVisible = useCallback((animated: boolean) => {
    const targetY = Math.max(0, popmInputWrapYRef.current - 120);
    popmScrollRef.current?.scrollTo({ x: 0, y: targetY, animated });
  }, []);

  const onPopmInputWrapLayout = useCallback((y: number) => {
    popmInputWrapYRef.current = Math.max(0, y);
  }, []);

  const onPopmInputFocus = useCallback(() => {
    setPopmInputFocused(true);
    ensurePopmInputVisible(true);
    clearPopmInputScrollTimer();
    popmInputScrollTimerRef.current = setTimeout(() => {
      ensurePopmInputVisible(true);
      popmInputScrollTimerRef.current = null;
    }, Platform.OS === "ios" ? 100 : 220);
  }, [clearPopmInputScrollTimer, ensurePopmInputVisible]);

  const onPopmInputBlur = useCallback(() => {
    setPopmInputFocused(false);
    clearPopmInputScrollTimer();
  }, [clearPopmInputScrollTimer]);

  useEffect(() => {
    if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  useEffect(() => {
    if (popmVideoExpanded) {
      setPopmOverlayVisible(true);
      popmExpandAnim.setValue(0);
      Animated.timing(popmExpandAnim, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    Animated.timing(popmExpandAnim, {
      toValue: 0,
      duration: 180,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setPopmOverlayVisible(false);
    });
  }, [popmExpandAnim, popmVideoExpanded]);

  const openPopmResultModal = useCallback((body: string) => {
    setPopmResultModalBody(body);
    setPopmResultModalVisible(true);
  }, []);

  const resetPopmMachine = useCallback(() => {
    popmPendingModalRef.current = null;
    popmVideoEndedRef.current = false;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPopmVideoExpanded(false);
    popmPlayer.pause();
    popmPlayer.currentTime = 0;
  }, [popmPlayer]);

  const closePopmResultModal = useCallback(() => {
    setPopmResultModalVisible(false);
    resetPopmMachine();
    setPopmConverting(false);
  }, [resetPopmMachine]);

  useEffect(() => {
    const sub = popmPlayer.addListener("playToEnd", () => {
      popmVideoEndedRef.current = true;
      popmPlayer.pause();
      const pending = popmPendingModalRef.current;
      if (pending) {
        popmPendingModalRef.current = null;
        openPopmResultModal(pending.body);
      }
    });
    return () => {
      sub.remove();
    };
  }, [openPopmResultModal, popmPlayer]);

  useEffect(() => {
    return () => {
      clearPopmInputScrollTimer();
    };
  }, [clearPopmInputScrollTimer]);

  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 3) {
      setPopmResultModalVisible(false);
      resetPopmMachine();
      setPopmConverting(false);
    }
  }, [activeTab, resetPopmMachine]);

  useEffect(() => {
    if (activeTab === 3) return;
    setGiftExchangeMode(false);
    setGiftExchanging(false);
    setSelectedReceivedGiftCountMap({});
  }, [activeTab]);

  const popcornItems = useMemo(
    () =>
      POPCORN_PACKS.map((item) => {
        const isUnlimitedPlan = Boolean(item.planOverride && item.planDurationDays);
        const basePrice = isUnlimitedPlan ? item.priceKrw : Math.round((item.amount / 1000) * POP_BASE_UNIT_PER_1000);
        const discountRate = basePrice > 0 ? Math.max(0, Math.round((1 - item.priceKrw / basePrice) * 100)) : 0;
        const canFirstPurchaseBonus = item.allowFirstPurchaseBonus !== false && !isUnlimitedPlan;
        const localizedOverlayBadge =
          item.id === "once_unlimited_1m" ? t("shop.pack.month_1") : item.overlayBadge;
        const localizedAmountLabel =
          item.id === "once_unlimited_1m" ? t("shop.pack.month_1_unlimited") : item.displayAmountLabel;
        return {
          ...item,
          overlayBadge: localizedOverlayBadge,
          displayAmountLabel: localizedAmountLabel,
          basePrice,
          discountRate,
          bonusAmount: canFirstPurchaseBonus ? item.amount : 0,
          isUnlimitedPlan,
        };
      }),
    [t]
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
          bonusAmount: 0,
        };
      }),
    []
  );

  const ownedGiftList = useMemo(
    () =>
      GIFT_CATALOG.map((gift) => ({
        gift,
        count: asCount((giftsOwnedMap as Record<string, unknown>)?.[gift.id]),
      })).filter((row) => row.count > 0),
    [giftsOwnedMap]
  );

  const receivedGiftList = useMemo(
    () =>
      GIFT_CATALOG.map((gift) => ({
        gift,
        count: asCount((giftsReceivedMap as Record<string, unknown>)?.[gift.id]),
      })).filter((row) => row.count > 0),
    [giftsReceivedMap]
  );

  const selectedReceivedGiftRows = useMemo(
    () =>
      receivedGiftList
        .map((row) => ({
          ...row,
          exchangeCount: Math.min(row.count, asCount(selectedReceivedGiftCountMap[row.gift.id])),
        }))
        .filter((row) => row.exchangeCount > 0),
    [receivedGiftList, selectedReceivedGiftCountMap]
  );

  const selectedExchangeKernel = useMemo(
    () => selectedReceivedGiftRows.reduce((sum, row) => sum + calcExchangeKernel(row.gift.costKernel, row.exchangeCount), 0),
    [selectedReceivedGiftRows]
  );

  const allReceivedSelected = useMemo(() => {
    if (receivedGiftList.length <= 0) return false;
    return receivedGiftList.every((row) => asCount(selectedReceivedGiftCountMap[row.gift.id]) >= row.count);
  }, [receivedGiftList, selectedReceivedGiftCountMap]);

  const allShopPackIds = useMemo(() => [...POPCORN_PACKS, ...KERNEL_PACKS].map((p) => p.id), []);
  const allClaimedFallback = useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const id of allShopPackIds) out[id] = true;
    return out;
  }, [allShopPackIds]);

  useEffect(() => {
    let closed = false;
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();

    if (!token || !userId) {
      setShop({
        firstPurchaseClaimed: allClaimedFallback,
      });
      setFirstPurchaseSynced(true);
      return () => {
        closed = true;
      };
    }

    setFirstPurchaseSynced(false);

    const syncClaims = async () => {
      const out = await fetchShopFirstPurchaseClaims({ token, userId, deviceKey });
      if (closed) return;

      if (out.ok) {
        const rawClaimed = out.claimed || {};
        const normalized: Record<string, boolean> = {};
        for (const id of allShopPackIds) {
          normalized[id] = rawClaimed[id] === true;
        }
        setShop({
          firstPurchaseClaimed: normalized,
        });
        setFirstPurchaseSynced(true);
        return;
      }

      setShop({
        firstPurchaseClaimed: allClaimedFallback,
      });
      setFirstPurchaseSynced(true);
    };

    syncClaims().catch(() => {
      if (closed) return;
      setShop({
        firstPurchaseClaimed: allClaimedFallback,
      });
      setFirstPurchaseSynced(true);
    });

    return () => {
      closed = true;
    };
  }, [allClaimedFallback, allShopPackIds, auth?.deviceKey, auth?.token, auth?.userId, setShop]);

  useEffect(() => {
    let closed = false;
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();

    if (!token || !userId) {
      setShop({
        giftsOwned: {},
        giftsReceived: {},
      });
      return () => {
        closed = true;
      };
    }

    const syncGiftState = async () => {
      const giftOut = await fetchShopGiftInventory({ token, userId, deviceKey });
      if (closed) return;
      if (giftOut.ok && giftOut.giftStateFound) {
        setShop({
          giftsOwned: giftOut.giftsOwned,
          giftsReceived: giftOut.giftsReceived,
        });
        setAssets({
          kernelCount: giftOut.walletKernel,
          updatedAtMs: Date.now(),
        });
        return;
      }

      const walletOut = await fetchUnifiedWalletState({ token, userId, deviceKey });
      if (closed) return;
      if (walletOut.ok && walletOut.giftStateFound) {
        setShop({
          giftsOwned: walletOut.giftsOwned || {},
          giftsReceived: walletOut.giftsReceived || {},
        });
      }
      if (walletOut.ok) {
        setAssets({
          kernelCount: walletOut.walletKernel,
          updatedAtMs: Date.now(),
        });
      }
    };

    syncGiftState().catch(() => undefined);

    return () => {
      closed = true;
    };
  }, [auth?.deviceKey, auth?.token, auth?.userId, setAssets, setShop]);

  const goTab = useCallback((tab: 0 | 1 | 2 | 3 | 4) => {
    activeTabRef.current = tab;
    setActiveTab(tab);
    pagerRef.current?.scrollTo({ x: tab * SCREEN_WIDTH, y: 0, animated: true });
  }, []);

  const scrollHeaderToTab = useCallback((tab: 0 | 1 | 2 | 3 | 4, animated = true) => {
    const scroller = headerTabsScrollRef.current;
    if (!scroller) return;

    const layout = headerTabLayoutsRef.current[tab];
    const viewport = Math.max(0, Number(headerTabsViewportWidthRef.current || 0));
    if (!layout || viewport <= 0) return;

    const contentWidth = Object.values(headerTabLayoutsRef.current).reduce((max, item) => {
      const right = Number(item?.x || 0) + Number(item?.width || 0);
      return right > max ? right : max;
    }, 0);
    const maxScrollX = Math.max(0, contentWidth - viewport);
    const desiredCenter = Number(layout.x || 0) + Number(layout.width || 0) / 2 - viewport / 2;
    const nextX = Math.max(0, Math.min(maxScrollX, desiredCenter));

    try {
      scroller.scrollTo({ x: nextX, y: 0, animated });
    } catch {}
  }, []);

  const onHeaderTabLayout = useCallback((tab: 0 | 1 | 2 | 3 | 4, e: LayoutChangeEvent) => {
    const x = Number(e.nativeEvent.layout?.x || 0);
    const width = Number(e.nativeEvent.layout?.width || 0);
    headerTabLayoutsRef.current[tab] = { x, width };
    if (activeTabRef.current === tab) {
      scrollHeaderToTab(tab, false);
    }
  }, [scrollHeaderToTab]);

  useEffect(() => {
    if (routeInitialTab == null) return;
    const raw = Number(routeInitialTab);
    if (!Number.isFinite(raw)) return;
    const next = Math.max(0, Math.min(4, Math.trunc(raw))) as 0 | 1 | 2 | 3 | 4;
    if (activeTabRef.current === next) return;
    goTab(next);
  }, [goTab, routeInitialTab]);

  const onPagerEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = Number(e.nativeEvent.contentOffset?.x || 0);
    setPagerScrollX(x);
    const page = Math.round(x / SCREEN_WIDTH);
    const next = Math.max(0, Math.min(4, page)) as 0 | 1 | 2 | 3 | 4;
    if (activeTabRef.current !== next) {
      activeTabRef.current = next;
      setActiveTab(next);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      scrollHeaderToTab(activeTab, true);
    }, 0);
    return () => clearTimeout(timer);
  }, [activeTab, scrollHeaderToTab]);

  const onPagerScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = Number(e.nativeEvent.contentOffset?.x || 0);
    setPagerScrollX(x);
    const page = Math.round(x / SCREEN_WIDTH);
    const next = Math.max(0, Math.min(4, page)) as 0 | 1 | 2 | 3 | 4;
    if (activeTabRef.current !== next) {
      activeTabRef.current = next;
      setActiveTab(next);
    }
  }, []);

  // Keep gift-box page in the same tone as gift-shop (tab 2),
  // and transition to POPM tone only on the last page (tab 4).
  const popmToneProgress = Math.max(0, Math.min(1, (pagerScrollX - SCREEN_WIDTH * 3) / SCREEN_WIDTH));
  const headerR = Math.round(43 + (74 - 43) * popmToneProgress);
  const headerG = Math.round(14 + (50 - 14) * popmToneProgress);
  const headerB = Math.round(43 + (0 - 43) * popmToneProgress);
  const headerBgColor = `rgb(${headerR}, ${headerG}, ${headerB})`;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerBackVisible: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: headerBgColor },
      headerTitleAlign: "left",
      headerTitleContainerStyle: { left: 70, right: 8 },
      headerLeft: () => (
        <Pressable disabled={purchaseConfirming} onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerBackBtn}>
          <AppText ignoreUiScale style={styles.headerBackText}>
            {"<"}
          </AppText>
        </Pressable>
      ),
      headerTitle: () => (
        <ScrollView
          ref={(node) => {
            headerTabsScrollRef.current = node;
          }}
          horizontal
          bounces={false}
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          style={styles.headerTabsScroll}
          contentContainerStyle={[styles.headerTabs, styles.headerTabsLead]}
          onLayout={(e) => {
            headerTabsViewportWidthRef.current = Number(e.nativeEvent.layout?.width || 0);
            scrollHeaderToTab(activeTabRef.current, false);
          }}
        >
          <Pressable
            onLayout={(e) => onHeaderTabLayout(0, e)}
            disabled={purchaseConfirming}
            onPress={() => goTab(0)}
            style={[styles.headerTab, activeTab === 0 ? styles.headerTabActive : null, purchaseConfirming ? styles.headerTabDisabled : null]}
          >
            <View style={styles.headerTabInner}>
              <Image source={POPTALK_BALANCE_ICON} resizeMode="contain" style={styles.headerTabIcon} />
              <AppText ignoreUiScale style={[styles.headerTabText, activeTab === 0 ? styles.headerTabTextActive : null]}>
                {t("shop.tabs.pop")}
              </AppText>
            </View>
          </Pressable>
          <Pressable
            onLayout={(e) => onHeaderTabLayout(1, e)}
            disabled={purchaseConfirming}
            onPress={() => goTab(1)}
            style={[styles.headerTab, activeTab === 1 ? styles.headerTabActive : null, purchaseConfirming ? styles.headerTabDisabled : null]}
          >
            <View style={styles.headerTabInner}>
              <Image source={KERNEL_BALANCE_ICON} resizeMode="contain" style={styles.headerTabIcon} />
              <AppText ignoreUiScale style={[styles.headerTabText, activeTab === 1 ? styles.headerTabTextActive : null]}>
                {t("shop.tabs.kernel")}
              </AppText>
            </View>
          </Pressable>
          <Pressable
            onLayout={(e) => onHeaderTabLayout(2, e)}
            disabled={purchaseConfirming}
            onPress={() => goTab(2)}
            style={[styles.headerTab, activeTab === 2 ? styles.headerTabActive : null, purchaseConfirming ? styles.headerTabDisabled : null]}
          >
            <View style={styles.headerTabInner}>
              <Ionicons name="gift-outline" size={12} color={activeTab === 2 ? "#FFE4F4" : "#E6DBFF"} />
              <AppText ignoreUiScale style={[styles.headerTabText, activeTab === 2 ? styles.headerTabTextActive : null]}>
                {t("shop.tabs.gift")}
              </AppText>
            </View>
          </Pressable>
          <Pressable
            onLayout={(e) => onHeaderTabLayout(3, e)}
            disabled={purchaseConfirming}
            onPress={() => goTab(3)}
            style={[styles.headerTab, activeTab === 3 ? styles.headerTabActive : null, purchaseConfirming ? styles.headerTabDisabled : null]}
          >
            <View style={styles.headerTabInner}>
              <Ionicons name="cube-outline" size={14} color={activeTab === 3 ? "#FFE4F4" : "#E6DBFF"} />
              <AppText ignoreUiScale style={[styles.headerTabText, activeTab === 3 ? styles.headerTabTextActive : null]}>
                {t("shop.tabs.giftbox")}
              </AppText>
            </View>
          </Pressable>
          <Pressable
            onLayout={(e) => onHeaderTabLayout(4, e)}
            disabled={purchaseConfirming}
            onPress={() => goTab(4)}
            style={[
              styles.headerPopmBtn,
              styles.headerPopmBtnTight,
              activeTab === 4 ? styles.headerPopmBtnActive : null,
              purchaseConfirming ? styles.headerTabDisabled : null,
            ]}
          >
            <View style={styles.headerPopmIconWrap}>
              <Image source={POPM_ICON} resizeMode="contain" style={styles.headerPopmIcon} />
              {activeTab === 4 ? (
                <>
                  <View pointerEvents="none" style={styles.headerPopmInnerLightMask} />
                  <View pointerEvents="none" style={styles.headerPopmInnerGlowCore} />
                </>
              ) : null}
            </View>
          </Pressable>
        </ScrollView>
      ),
    });
  }, [activeTab, goTab, navigation, headerBgColor, onHeaderTabLayout, purchaseConfirming, scrollHeaderToTab, t]);

  const onPressCard = useCallback(
    async (
      kind: "popcorn" | "kernel",
      id: string,
      amount: number,
      priceKrw: number,
      bonusAmount: number,
      opts?: { planOverride?: "monthly"; planDurationDays?: number; isUnlimitedPlan?: boolean }
    ) => {
      if (buyingPackId || purchaseConfirming) return;
      const productId = kind === "popcorn" ? POPCORN_PRODUCT_IDS[id] || "" : KERNEL_PRODUCT_IDS[id] || "";

      const unit = kind === "kernel" ? t("shop.unit.kernel") : t("shop.unit.pop");
      const title = kind === "kernel" ? t("shop.title_kernel") : t("shop.title_pop");
      if (!productId) {
        showGlobalModal(title, t("shop.error.product_id_missing"));
        return;
      }

      setBuyingPackId(id);
      try {
        const out = await purchaseOneTimeByProductId(productId);
        if (out.ok) {
          setPurchaseConfirming(true);
          let confirmed;
          try {
            confirmed = await confirmShopPurchase({
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
              planOverride: opts?.planOverride,
              planDurationDays: opts?.planDurationDays,
            });
          } finally {
            setPurchaseConfirming(false);
          }

          if (!confirmed.ok) {
            showGlobalModal(
              title,
              t("shop.error.confirm_failed", {
                reason: confirmed.errorMessage || confirmed.errorCode || "CONFIRM_FAILED",
              })
            );
            return;
          }

          if (kind === "popcorn" && bonusAmount > 0 && !opts?.isUnlimitedPlan) {
            markFirstPurchaseClaimed(id);
          }
          const currentBalance = Number((useAppStore.getState() as any)?.popTalk?.balance ?? popTalk?.balance ?? 0);
          const currentCap = Number((useAppStore.getState() as any)?.popTalk?.cap ?? popTalk?.cap ?? 0);
          const hasServerPopTalk = Number.isFinite(Number(confirmed.popTalkBalance));
          const grantedAmount = Math.max(0, Math.trunc(Number(confirmed.grantedAmount ?? 0)));
          const localGrantedDelta = kind === "popcorn" ? grantedAmount : 0;
          const nextPopTalkBalance = hasServerPopTalk
            ? Number(confirmed.popTalkBalance ?? 0)
            : Math.max(0, currentBalance + localGrantedDelta);
          const nextPopTalkCap = Math.max(
            currentCap,
            Number(hasServerPopTalk ? confirmed.popTalkCap ?? 0 : nextPopTalkBalance),
            nextPopTalkBalance
          );
          setPopTalk({
            balance: nextPopTalkBalance,
            cap: nextPopTalkCap,
            plan: hasServerPopTalk ? confirmed.popTalkPlan || null : popTalk?.plan ?? null,
            serverNowMs: hasServerPopTalk ? confirmed.popTalkServerNowMs ?? null : popTalk?.serverNowMs ?? null,
            syncedAtMs: Date.now(),
          });
          setAssets({
            kernelCount: confirmed.walletKernel,
            updatedAtMs: Date.now(),
          });

          const bonusApplied = Boolean(confirmed.firstPurchaseBonusApplied);
          const successMsg = opts?.isUnlimitedPlan
            ? t("shop.purchase.done_unlimited_1m")
            : !bonusApplied
              ? t("shop.purchase.done_single", { amount: formatNumber(amount), unit })
              : t("shop.purchase.done_bonus", { amount: formatNumber(amount), bonus: formatNumber(bonusAmount), unit });
          showGlobalModal(title, successMsg);
          return;
        }

        if (out.cancelled) return;
        showGlobalModal(
          title,
          t("shop.error.purchase_failed", {
            reason: out.errorMessage || out.errorCode || "PURCHASE_FAILED",
          })
        );
      } finally {
        setPurchaseConfirming(false);
        setBuyingPackId(null);
      }
    },
    [
      auth?.deviceKey,
      auth?.token,
      auth?.userId,
      buyingPackId,
      markFirstPurchaseClaimed,
      popTalk?.balance,
      popTalk?.cap,
      popTalk?.plan,
      popTalk?.serverNowMs,
      purchaseConfirming,
      setAssets,
      setPopTalk,
      showGlobalModal,
      t,
    ]
  );

  const onPressPopmConvert = useCallback(async () => {
    if (popmConverting) return;

    const kernelAmount = Math.max(0, Math.trunc(Number(popmKernelInput.replace(/[^\d]/g, "")) || 0));
    if (kernelAmount <= 0) {
      showGlobalModal(t("shop.popm.title"), t("shop.popm.error.kernel_required"));
      return;
    }

    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId) {
      showGlobalModal(t("shop.popm.title"), t("common.auth_expired"));
      return;
    }

    setPopmConverting(true);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPopmVideoExpanded(true);
    popmPendingModalRef.current = null;
    popmVideoEndedRef.current = false;
    popmPlayer.pause();
    popmPlayer.currentTime = 0;
    popmPlayer.loop = false;
    popmPlayer.play();
    try {
      const localBalance = Math.max(0, Math.trunc(Number(popTalk?.balance ?? 0)));
      const localCap = Math.max(0, Math.trunc(Number(popTalk?.cap ?? 0)));
      const walletState = await fetchUnifiedWalletState({
        token,
        userId,
        deviceKey,
      });

      const liveKernel = walletState.ok ? Number(walletState.walletKernel ?? 0) : Number(kernelBalance || 0);
      if (walletState.ok) {
        const fetchedBalance = Math.max(0, Math.trunc(Number(walletState.popTalkBalance ?? 0)));
        // Do not down-sync balance at the conversion button click moment.
        if (fetchedBalance >= localBalance) {
          const capNow = Math.max(localCap, Number(walletState.popTalkCap ?? 0), fetchedBalance);
          setPopTalk({
            balance: fetchedBalance,
            cap: capNow,
            plan: walletState.popTalkPlan || null,
            serverNowMs: walletState.popTalkServerNowMs ?? null,
            syncedAtMs: Date.now(),
          });
        }
        setAssets({
          kernelCount: liveKernel,
          updatedAtMs: Date.now(),
        });
      }

      if (kernelAmount > liveKernel) {
        resetPopmMachine();
        setPopmConverting(false);
        showGlobalModal(t("shop.popm.title"), t("shop.error.kernel_insufficient_have", { have: formatNumber(liveKernel) }));
        return;
      }

      const idempotencyKey = `popm_${Date.now()}_${kernelAmount}`;

      await new Promise((resolve) => setTimeout(resolve, randomDelayMs(kernelAmount)));
      const result = await convertKernelToPopTalk({
        token,
        userId,
        deviceKey,
        kernelAmount,
        idempotencyKey,
      });

      if (!result.ok) {
        resetPopmMachine();
        setPopmConverting(false);
        if (String(result.errorCode || "").toUpperCase() === "CONVERT_ROUTE_NOT_FOUND") {
          showGlobalModal(t("shop.popm.title"), t("shop.popm.error.route_missing"));
          return;
        }
        showGlobalModal(t("shop.popm.title"), result.errorMessage || result.errorCode || t("shop.popm.error.convert_failed"));
        return;
      }

      const kernelSpent = Number(result.kernelSpent ?? kernelAmount);
      const serverMultiplier = Number(result.multiplier);
      const fallbackRatio = kernelSpent > 0 ? Number(result.convertedPopTalk ?? 0) / kernelSpent : sampleMultiplier();
      const multiplier = Number.isFinite(serverMultiplier) && serverMultiplier > 0 ? serverMultiplier : fallbackRatio;
      const converted = Number(result.convertedPopTalk ?? Math.trunc(kernelSpent * multiplier));
      const serverBalance = Math.max(0, Math.trunc(Number(result.popTalkBalance ?? 0)));
      const nextBalance = serverBalance >= localBalance ? serverBalance : Math.max(0, localBalance + converted);
      const capNow = Math.max(localCap, Number(result.popTalkCap ?? 0), nextBalance);

      setPopTalk({
        balance: nextBalance,
        cap: capNow,
        plan: result.popTalkPlan || popTalk?.plan || null,
        serverNowMs: result.popTalkServerNowMs ?? popTalk?.serverNowMs ?? null,
        syncedAtMs: Date.now(),
      });
      setAssets({
        kernelCount: Number(result.walletKernel ?? Math.max(0, liveKernel - kernelSpent)),
        updatedAtMs: Date.now(),
      });

      const isJackpot200 = kernelSpent > 0 && converted >= kernelSpent * 2;
      const isLuckyOver100 = kernelSpent > 0 && converted > kernelSpent;
      const prefixMessage = isJackpot200
        ? t("shop.popm.prefix.jackpot")
        : isLuckyOver100
          ? t("shop.popm.prefix.lucky")
          : "";
      const modalBody = prefixMessage
        ? `${prefixMessage}\n${t("shop.popm.result_line", { kernel: formatNumber(kernelSpent), pop: formatNumber(converted) })}`
        : t("shop.popm.result_line", { kernel: formatNumber(kernelSpent), pop: formatNumber(converted) });

      if (popmVideoEndedRef.current) {
        openPopmResultModal(modalBody);
      } else {
        popmPendingModalRef.current = { body: modalBody };
      }
    } catch (err: any) {
      resetPopmMachine();
      setPopmConverting(false);
      showGlobalModal(t("shop.popm.title"), String(err?.message || t("shop.popm.error.convert_failed")));
    }
  }, [auth?.deviceKey, auth?.token, auth?.userId, kernelBalance, openPopmResultModal, popTalk?.balance, popTalk?.cap, popTalk?.plan, popTalk?.serverNowMs, popmConverting, popmKernelInput, popmPlayer, resetPopmMachine, setAssets, setPopTalk, showGlobalModal, t]);

  const closeGiftBuyModal = useCallback(() => {
    if (giftBuying) return;
    setGiftBuyTarget(null);
    setGiftBuyCount(1);
  }, [giftBuying]);

  const onPressGiftCard = useCallback(
    (gift: GiftItem) => {
      if (giftBuying) return;
      setGiftBuyTarget(gift);
      setGiftBuyCount(1);
    },
    [giftBuying]
  );

  const onDecreaseGiftBuyCount = useCallback(() => {
    if (giftBuying) return;
    setGiftBuyCount((prev) => Math.max(1, Math.trunc(Number(prev) || 1) - 1));
  }, [giftBuying]);

  const onIncreaseGiftBuyCount = useCallback(() => {
    if (giftBuying) return;
    setGiftBuyCount((prev) => Math.max(1, Math.trunc(Number(prev) || 1) + 1));
  }, [giftBuying]);

  const onConfirmGiftBuy = useCallback(async () => {
    if (!giftBuyTarget || giftBuying) return;
    const buyCount = Math.max(1, Math.trunc(Number(giftBuyCount) || 1));
    const totalKernelCost = Math.max(0, Math.trunc(Number(giftBuyTarget.costKernel || 0)) * buyCount);
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId) {
      showGlobalModal(t("giftshop.title"), t("common.auth_expired"));
      return;
    }
    if (totalKernelCost > Math.max(0, Math.trunc(Number(kernelBalance || 0)))) {
      showGlobalModal(
        t("giftshop.title"),
        t("shop.error.kernel_insufficient_need_have", { need: formatNumber(totalKernelCost), have: formatNumber(kernelBalance) })
      );
      return;
    }

    setGiftBuying(true);
    try {
      const purchaseOut = await purchaseGiftWithKernelOnServer({
        token,
        userId,
        deviceKey,
        giftId: giftBuyTarget.id,
        costKernel: giftBuyTarget.costKernel,
        count: buyCount,
        idempotencyKey: `gift_${giftBuyTarget.id}_${buyCount}_${Date.now()}`,
      });

      if (!purchaseOut.ok) {
        const errCode = String(purchaseOut.errorCode || "").toUpperCase();
        if (errCode === "INSUFFICIENT_KERNEL") {
          showGlobalModal(t("giftshop.title"), t("shop.error.kernel_insufficient_have", { have: formatNumber(kernelBalance) }));
        } else if (errCode === "GIFT_PURCHASE_ROUTE_NOT_FOUND") {
          showGlobalModal(t("giftshop.title"), t("shop.gift.error.purchase_route_missing"));
        } else {
          showGlobalModal(t("giftshop.title"), purchaseOut.errorMessage || purchaseOut.errorCode || t("shop.gift.error.purchase_failed"));
        }
        return;
      }

      showGlobalModal(
        t("giftshop.title"),
        buyCount > 1
          ? t("shop.gift.purchase_done_many", { name: getGiftDisplayName(t, giftBuyTarget), count: formatNumber(buyCount) })
          : t("shop.gift.purchase_done_one", { name: getGiftDisplayName(t, giftBuyTarget) })
      );
      setGiftBuyTarget(null);
      setGiftBuyCount(1);

      const inventoryOut = await fetchShopGiftInventory({ token, userId, deviceKey });
      if (inventoryOut.ok && inventoryOut.giftStateFound) {
        setShop({
          giftsOwned: inventoryOut.giftsOwned,
          giftsReceived: inventoryOut.giftsReceived,
        });
        setAssets({
          kernelCount: inventoryOut.walletKernel,
          updatedAtMs: Date.now(),
        });
      } else if (purchaseOut.giftStateFound) {
        setShop({
          giftsOwned: purchaseOut.giftsOwned,
          giftsReceived: purchaseOut.giftsReceived,
        });
        setAssets({
          kernelCount: purchaseOut.walletKernel,
          updatedAtMs: Date.now(),
        });
      } else {
        const walletOut = await fetchUnifiedWalletState({ token, userId, deviceKey });
        if (walletOut.ok) {
          setAssets({
            kernelCount: walletOut.walletKernel,
            updatedAtMs: Date.now(),
          });
        }
        if (walletOut.ok && walletOut.giftStateFound) {
          setShop({
            giftsOwned: walletOut.giftsOwned || {},
            giftsReceived: walletOut.giftsReceived || {},
          });
        }
      }
    } finally {
      setGiftBuying(false);
    }
  }, [auth?.deviceKey, auth?.token, auth?.userId, giftBuyCount, giftBuyTarget, giftBuying, kernelBalance, setAssets, setShop, showGlobalModal, t]);

  const onToggleGiftExchangeMode = useCallback(() => {
    if (giftExchanging) return;
    if (giftExchangeMode) {
      setGiftExchangeMode(false);
      setSelectedReceivedGiftCountMap({});
      return;
    }
    setGiftExchangeMode(true);
  }, [giftExchangeMode, giftExchanging]);

  const onToggleReceivedGiftSelect = useCallback((giftId: string) => {
    if (giftExchanging) return;
    const key = String(giftId || "").trim();
    if (!key) return;
    const maxCount = Math.max(0, Math.trunc(Number(receivedGiftList.find((row) => row.gift.id === key)?.count ?? 0)));
    if (maxCount <= 0) return;
    setSelectedReceivedGiftCountMap((prev) => {
      const current = asCount(prev[key]);
      return {
        ...prev,
        [key]: current > 0 ? 0 : maxCount,
      };
    });
  }, [giftExchanging, receivedGiftList]);

  const onAdjustReceivedGiftQty = useCallback((giftId: string, delta: number) => {
    if (giftExchanging) return;
    const key = String(giftId || "").trim();
    const d = Math.trunc(Number(delta) || 0);
    if (!key || !d) return;
    const maxCount = Math.max(0, Math.trunc(Number(receivedGiftList.find((row) => row.gift.id === key)?.count ?? 0)));
    if (maxCount <= 0) return;
    setSelectedReceivedGiftCountMap((prev) => {
      const current = asCount(prev[key]);
      const next = Math.max(0, Math.min(maxCount, current + d));
      return {
        ...prev,
        [key]: next,
      };
    });
  }, [giftExchanging, receivedGiftList]);

  const onToggleSelectAllReceivedGifts = useCallback(() => {
    if (giftExchanging || receivedGiftList.length <= 0) return;
    if (allReceivedSelected) {
      setSelectedReceivedGiftCountMap({});
      return;
    }
    const next: Record<string, number> = {};
    for (const row of receivedGiftList) {
      next[row.gift.id] = row.count;
    }
    setSelectedReceivedGiftCountMap(next);
  }, [allReceivedSelected, giftExchanging, receivedGiftList]);

  const onConfirmGiftExchange = useCallback(async () => {
    if (giftExchanging) return;
    if (selectedReceivedGiftRows.length <= 0) {
      showGlobalModal(t("giftbox.header_box"), t("giftbox.select_for_exchange"));
      return;
    }
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId) {
      showGlobalModal(t("giftbox.header_box"), t("common.auth_expired"));
      return;
    }

    setGiftExchanging(true);
    try {
      const out = await exchangeReceivedGiftsOnServer({
        token,
        userId,
        deviceKey,
        items: selectedReceivedGiftRows.map((row) => ({
          giftId: row.gift.id,
          count: row.exchangeCount,
          costKernel: row.gift.costKernel,
        })),
        idempotencyKey: `shop_gift_exchange_${Date.now()}_${selectedReceivedGiftRows.length}`,
      });

      if (!out.ok) {
        const code = String(out.errorCode || "").toUpperCase();
        if (code === "GIFT_EXCHANGE_ROUTE_NOT_FOUND") {
          showGlobalModal(t("giftbox.header_box"), t("giftbox.error.exchange_route_missing"));
        } else if (code === "INSUFFICIENT_RECEIVED_GIFT") {
          showGlobalModal(t("giftbox.header_box"), t("giftbox.error.insufficient_received"));
        } else {
          showGlobalModal(t("giftbox.header_box"), out.errorMessage || out.errorCode || t("giftbox.error.exchange_failed"));
        }
        return;
      }

      if (out.giftStateFound) {
        setShop({
          giftsOwned: out.giftsOwned,
          giftsReceived: out.giftsReceived,
        });
        setAssets({
          kernelCount: out.walletKernel,
          updatedAtMs: Date.now(),
        });
      } else {
        const invOut = await fetchShopGiftInventory({ token, userId, deviceKey });
        if (invOut.ok && invOut.giftStateFound) {
          setShop({
            giftsOwned: invOut.giftsOwned,
            giftsReceived: invOut.giftsReceived,
          });
          setAssets({
            kernelCount: invOut.walletKernel,
            updatedAtMs: Date.now(),
          });
        }
      }

      const exchangedKernel = Math.max(0, Math.trunc(Number(out.exchangedKernel || selectedExchangeKernel)));
      setSelectedReceivedGiftCountMap({});
      setGiftExchangeMode(false);
      showGlobalModal(t("giftbox.header_box"), t("giftbox.exchange_done", { kernel: formatNumber(exchangedKernel) }));
    } finally {
      setGiftExchanging(false);
    }
  }, [auth?.deviceKey, auth?.token, auth?.userId, giftExchanging, selectedExchangeKernel, selectedReceivedGiftRows, setAssets, setShop, showGlobalModal, t]);

  const renderPage = useCallback(
    (kind: "popcorn" | "kernel") => {
      const isPop = kind === "popcorn";
      const items = isPop ? popcornItems : kernelItems;
      const balanceIcon = isPop ? POPTALK_BALANCE_ICON : KERNEL_BALANCE_ICON;
      const balanceLabel = isPop ? t("shop.balance_pop") : t("shop.balance_kernel");
      const popTalkUnlimited = isPopTalkUnlimited(popTalk);
      const balanceText = isPop
        ? popTalkUnlimited
          ? t("poptalk.unlimited_short")
          : formatPopTalkCount(popTalk?.balance ?? 0)
        : formatNumber(Number(kernelBalance ?? 0));

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
                <Ionicons name="flash" size={16} color="#FFE99E" />
                <AppText style={styles.heroBadgeText}>{t("shop.hero.hot_deal")}</AppText>
              </View>
              <View style={styles.heroWalletRow}>
                <Image source={balanceIcon} resizeMode="contain" style={styles.heroWalletIcon} />
                <AppText style={styles.heroWalletLabel}>{balanceLabel}</AppText>
                <AppText style={styles.heroWalletValue}>{balanceText}</AppText>
              </View>
            </View>
          </View>

          <View style={styles.grid}>
            {items.map((item) => {
              const canFirstPurchaseBonus = isPop && (item as any).allowFirstPurchaseBonus !== false && !(item as any).isUnlimitedPlan;
              const claimed = canFirstPurchaseBonus ? Boolean(firstPurchaseClaimed[item.id]) : true;
              const useTightAmountSpacing = isPop && !claimed && item.amount >= 100000;
              const useCompactAmount = isPop && !claimed && item.amount >= 100000;
              return (
                <Pressable
                  key={item.id}
                  disabled={Boolean(buyingPackId)}
                  onPress={() =>
                    onPressCard(kind, item.id, item.amount, item.priceKrw, item.bonusAmount, {
                      planOverride: isPop ? (item as any).planOverride : undefined,
                      planDurationDays: isPop ? (item as any).planDurationDays : undefined,
                      isUnlimitedPlan: Boolean((item as any).isUnlimitedPlan),
                    })
                  }
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
                        firstPurchaseLabel={t("shop.first_purchase")}
                        showX2={!claimed && firstPurchaseSynced}
                      />
                    ) : (
                      <KernelArt
                        image={(item as any).image}
                        sparkleLevel={(item as any).sparkleLevel}
                        vip={Boolean((item as any).vip)}
                        firstPurchaseLabel={t("shop.first_purchase")}
                        showX2={!claimed && firstPurchaseSynced}
                      />
                    )}

                    <View style={styles.amountBlock}>
                      {(item as any).displayAmountLabel ? (
                        <AppText ignoreUiScale style={styles.amountPlanLabel}>
                          {String((item as any).displayAmountLabel)}
                        </AppText>
                      ) : (
                        <>
                          <AppText
                            ignoreUiScale
                            numberOfLines={1}
                            style={[
                              styles.amountBase,
                              useCompactAmount ? styles.amountCompact : null,
                              useTightAmountSpacing ? styles.amountTextTight : null,
                            ]}
                          >
                            {formatNumber(item.amount)}
                          </AppText>
                          {!claimed ? (
                            <AppText
                              ignoreUiScale
                              numberOfLines={1}
                              style={[
                                styles.amountPlus,
                                useCompactAmount ? styles.amountPlusCompact : null,
                                useTightAmountSpacing ? styles.amountTextTight : null,
                              ]}
                            >
                              {" + "}
                            </AppText>
                          ) : null}
                          {!claimed ? (
                            <AppText
                              ignoreUiScale
                              numberOfLines={1}
                              style={[
                                styles.amountBonus,
                                useCompactAmount ? styles.amountCompact : null,
                                useTightAmountSpacing ? styles.amountTextTight : null,
                              ]}
                            >
                              {formatNumber(item.bonusAmount)}
                            </AppText>
                          ) : null}
                        </>
                      )}
                    </View>

                    <LinearGradient
                      colors={["rgba(255,232,159,0.95)", "rgba(255,205,99,0.96)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={styles.priceBar}
                    >
                      <View style={styles.priceRow}>
                        <AppText style={styles.price}>{`${formatNumber(item.priceKrw)}${t("currency.krw_suffix")}`}</AppText>
                        <View style={styles.rateBadge}>
                          <AppText style={styles.rateBadgeText}>
                            {item.discountRate > 0 ? `${item.discountRate}%` : t("shop.price.base")}
                          </AppText>
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
    [firstPurchaseClaimed, firstPurchaseSynced, insets.bottom, kernelBalance, kernelItems, onPressCard, popTalk?.balance, popTalk?.cap, popTalk?.plan, popcornItems, t]
  );

  const renderPopmPage = useCallback(() => {
    const popmPreviewHeight = Math.min(498, Math.max(402, Math.floor(SCREEN_HEIGHT * 0.425) + 50));
    return (
      <KeyboardAvoidingView
        style={styles.popmPageWrap}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? insets.top + 92 : 0}
      >
        <ScrollView
          ref={popmScrollRef}
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: 6,
              paddingBottom: Math.max(132, insets.bottom + 108),
              gap: 10,
            },
          ]}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.hero, styles.popmHero]}>
            <View style={styles.heroRow}>
              <View style={[styles.heroBadge, styles.popmHeroBadge]}>
                <Image source={POPM_ICON} resizeMode="contain" style={{ width: 16, height: 16 }} />
                <AppText style={[styles.heroBadgeText, styles.popmHeroBadgeText]}>{t("shop.popm.title")}</AppText>
              </View>
              <View style={styles.popmBalanceCol}>
                <View style={styles.popmBalanceRow}>
                  <AppText style={styles.popmBalanceLabel}>{t("shop.balance_kernel")}</AppText>
                  <AppText style={styles.popmBalanceValue}>{formatNumber(kernelBalance)}</AppText>
                </View>
                <View style={styles.popmBalanceRow}>
                  <AppText style={styles.popmBalanceLabel}>{t("shop.balance_pop")}</AppText>
                  <AppText style={styles.popmBalanceValue}>
                    {isPopTalkUnlimited(popTalk) ? t("poptalk.unlimited_short") : formatPopTalkCount(popTalk?.balance ?? 0)}
                  </AppText>
                </View>
              </View>
            </View>
          </View>

          <LinearGradient
            colors={["rgba(255,255,255,0.22)", "rgba(255,226,148,0.14)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.popmCard}
          >
            <View style={[styles.popmAnimWrap, { height: popmPreviewHeight }]}>
              {!popmOverlayVisible ? (
                <VideoView
                  player={popmPlayer}
                  style={styles.popmAnimImage}
                  contentFit="cover"
                  surfaceType="textureView"
                  useExoShutter={false}
                  nativeControls={false}
                  allowsFullscreen={false}
                  allowsPictureInPicture={false}
                />
              ) : (
                <View style={styles.popmAnimPlaceholder} />
              )}
              {popmConverting ? (
                <View pointerEvents="none" style={styles.popmVideoBusyOverlay}>
                  <View style={styles.popmVideoBusyBadge}>
                    <AppText style={styles.popmVideoBusyText}>{t("shop.popm.converting")}</AppText>
                  </View>
                </View>
              ) : null}
            </View>

            <View
              style={styles.popmInputWrap}
              onLayout={(e) => onPopmInputWrapLayout(e.nativeEvent.layout.y)}
            >
              <AppText style={styles.popmInputLabel}>{t("shop.popm.input_label")}</AppText>
              <View style={styles.popmInputFieldWrap}>
                {!popmKernelInput && !popmInputFocused ? (
                  <View pointerEvents="none" style={styles.popmInputPlaceholderWrap}>
                    <AppText style={styles.popmInputPlaceholder}>{t("shop.popm.input_placeholder")}</AppText>
                  </View>
                ) : null}
                <TextInput
                  value={popmKernelInput}
                  onChangeText={(txt) => setPopmKernelInput(txt.replace(/[^\d]/g, ""))}
                  editable={!popmConverting}
                  keyboardType="number-pad"
                  placeholder=""
                  onFocus={onPopmInputFocus}
                  onBlur={onPopmInputBlur}
                  style={styles.popmInput}
                />
              </View>
              <AppText style={styles.popmHint}>{t("shop.popm.hint")}</AppText>
            </View>

            <Pressable
              onPress={onPressPopmConvert}
              disabled={popmConverting}
              style={({ pressed }) => [
                styles.popmConvertBtn,
                { marginBottom: Math.max(18, insets.bottom + 12) },
                popmConverting ? styles.popmConvertBtnDisabled : null,
                pressed ? styles.cardPressed : null,
              ]}
            >
              <AppText style={styles.popmConvertBtnText}>{popmConverting ? t("shop.popm.converting") : t("shop.popm.button")}</AppText>
            </Pressable>
          </LinearGradient>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }, [insets.bottom, insets.top, kernelBalance, onPopmInputBlur, onPopmInputFocus, onPopmInputWrapLayout, onPressPopmConvert, popTalk?.balance, popTalk?.cap, popTalk?.plan, popmConverting, popmInputFocused, popmKernelInput, popmOverlayVisible, popmPlayer, t]);

  const renderGiftPage = useCallback(() => {
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
              <Ionicons name="gift-outline" size={16} color="#FFE99E" />
              <AppText style={styles.heroBadgeText}>{t("giftshop.title")}</AppText>
            </View>
            <View style={styles.heroWalletRow}>
              <Image source={KERNEL_BALANCE_ICON} resizeMode="contain" style={styles.heroWalletIcon} />
              <AppText style={styles.heroWalletLabel}>{t("shop.balance_kernel")}</AppText>
              <AppText style={styles.heroWalletValue}>{formatNumber(kernelBalance)}</AppText>
            </View>
          </View>
        </View>

        <View style={styles.giftShopGrid}>
          {GIFT_CATALOG.map((gift) => (
            <Pressable
              key={gift.id}
              disabled={giftBuying}
              onPress={() => onPressGiftCard(gift)}
              style={({ pressed }) => [styles.giftShopCardShell, (pressed || giftBuying) ? styles.cardPressed : null]}
            >
              <LinearGradient
                colors={["rgba(255,255,255,0.16)", "rgba(196,154,255,0.11)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.card}
              >
                <LinearGradient
                  colors={["rgba(255,242,249,0.96)", "rgba(255,226,242,0.95)", "rgba(248,199,229,0.9)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.giftArtWrap}
                >
                  <View style={styles.giftArtGlow} />
                  <Image
                    source={GIFT_IMAGE_BY_ID[gift.id] || GIFT_IMG_CANDY}
                    resizeMode="contain"
                    style={styles.giftArtImage}
                  />
                </LinearGradient>

                <AppText style={styles.giftCardName} numberOfLines={1}>
                  {getGiftDisplayName(t, gift)}
                </AppText>

                <LinearGradient
                  colors={["rgba(255,232,159,0.95)", "rgba(255,205,99,0.96)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.giftCostBar}
                >
                  <View style={styles.giftPriceRowCentered}>
                    <AppText style={styles.giftPriceCentered}>{t("giftshop.price_kernel", { cost: formatNumber(gift.costKernel) })}</AppText>
                  </View>
                </LinearGradient>
              </LinearGradient>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }, [giftBuying, insets.bottom, kernelBalance, onPressGiftCard, t]);

  const renderGiftBoxEmpty = useCallback(
    (message: string) => {
      const overlayText = t("giftbox.empty_overlay");
      return (
        <View style={styles.giftBoxEmpty}>
          <View style={styles.giftBoxEmptyVisualWrap}>
            <Image source={EMPTY_BOX_IMG} resizeMode="contain" style={styles.giftBoxEmptyImage} />
            <View style={styles.giftBoxEmptyOverlayWrap}>
              <AppText style={styles.giftBoxEmptyOverlayText}>{overlayText}</AppText>
            </View>
          </View>
          <AppText style={styles.giftBoxEmptyText}>{message}</AppText>
        </View>
      );
    },
    [t]
  );

  const renderGiftBoxPage = useCallback(() => {
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
      >
        <View style={styles.hero}>
          <View style={[styles.heroRow, styles.giftBoxHeroRow]}>
            <View style={styles.heroBadge}>
              <Ionicons name="cube-outline" size={16} color="#FFE99E" />
              <AppText style={styles.heroBadgeText}>{t("giftbox.header_box")}</AppText>
            </View>
            <AppText numberOfLines={2} style={[styles.heroWalletLabel, styles.giftBoxHeroWalletLabel]}>
              {t("giftbox.hero_desc")}
            </AppText>
          </View>
        </View>

        <View style={styles.giftBoxSection}>
          <View style={styles.giftBoxSectionHeader}>
            <AppText style={styles.giftBoxSectionTitle}>{t("giftbox.section_owned")}</AppText>
            <Pressable onPress={() => goTab(2)} style={({ pressed }) => [styles.giftBoxSectionGoShopBtn, pressed ? styles.cardPressed : null]}>
              <AppText style={styles.giftBoxSectionGoShopBtnText}>{t("giftbox.go_shop")}</AppText>
            </Pressable>
          </View>
          {ownedGiftList.length === 0 ? (
            renderGiftBoxEmpty(t("giftbox.empty_owned"))
          ) : (
            <View style={styles.giftBoxGrid}>
              {ownedGiftList.map((row) => (
                <LinearGradient
                  key={`owned_box_${row.gift.id}`}
                  colors={["rgba(255,255,255,0.16)", "rgba(196,154,255,0.11)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.giftBoxCard}
                >
                  <LinearGradient
                    colors={["rgba(255,242,249,0.96)", "rgba(255,226,242,0.95)", "rgba(248,199,229,0.9)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.giftBoxImageWrap}
                  >
                    <Image
                      source={GIFT_IMAGE_BY_ID[row.gift.id] || GIFT_IMG_CANDY}
                      resizeMode="contain"
                      style={styles.giftBoxImage}
                    />
                  </LinearGradient>
                  <AppText numberOfLines={1} style={styles.giftBoxCardName}>
                    {getGiftDisplayName(t, row.gift)}
                  </AppText>
                  <View style={styles.giftBoxCountPill}>
                    <AppText style={styles.giftBoxCountText}>{t("giftbox.qty_count", { count: formatNumber(row.count) })}</AppText>
                  </View>
                </LinearGradient>
              ))}
            </View>
          )}
        </View>

        <View style={styles.giftBoxSection}>
          <View style={styles.giftBoxSectionHeader}>
            <AppText style={styles.giftBoxSectionTitle}>{t("giftbox.section_received")}</AppText>
            <Pressable
              disabled={giftExchanging}
              onPress={onToggleGiftExchangeMode}
              style={({ pressed }) => [styles.giftBoxSectionGoShopBtn, pressed || giftExchanging ? styles.cardPressed : null]}
            >
              <AppText style={styles.giftBoxSectionGoShopBtnText}>{t("giftbox.exchange_toggle")}</AppText>
            </Pressable>
          </View>
          {giftExchangeMode ? (
            <View style={styles.exchangeSummaryRow}>
              <AppText style={styles.exchangeSummaryText}>
                {t("giftbox.exchange_summary", { kernel: formatNumber(selectedExchangeKernel) })}
              </AppText>
              <View style={styles.exchangeActionRow}>
                <Pressable
                  disabled={giftExchanging || receivedGiftList.length <= 0}
                  onPress={onToggleSelectAllReceivedGifts}
                  style={({ pressed }) => [
                    styles.exchangeSelectAllBtn,
                    giftExchanging || receivedGiftList.length <= 0 ? styles.exchangeConfirmBtnDisabled : null,
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  <AppText style={styles.exchangeConfirmBtnText}>{allReceivedSelected ? t("giftbox.clear_all") : t("giftbox.select_all")}</AppText>
                </Pressable>
                <Pressable
                  disabled={giftExchanging || selectedReceivedGiftRows.length <= 0}
                  onPress={onConfirmGiftExchange}
                  style={({ pressed }) => [
                    styles.exchangeConfirmBtn,
                    giftExchanging || selectedReceivedGiftRows.length <= 0 ? styles.exchangeConfirmBtnDisabled : null,
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  {giftExchanging ? <ActivityIndicator size="small" color="#FFF5DE" style={styles.exchangeSpinner} /> : null}
                  <AppText style={styles.exchangeConfirmBtnText}>{t("common.confirm")}</AppText>
                </Pressable>
              </View>
            </View>
          ) : null}
          {receivedGiftList.length === 0 ? (
            renderGiftBoxEmpty(t("giftbox.empty_received"))
          ) : (
            <View style={styles.giftBoxGrid}>
              {receivedGiftList.map((row) => (
                <Pressable
                  key={`received_box_${row.gift.id}`}
                  disabled={!giftExchangeMode}
                  onPress={() => onToggleReceivedGiftSelect(row.gift.id)}
                  style={({ pressed }) => [pressed ? styles.cardPressed : null]}
                >
                  <LinearGradient
                    colors={["rgba(255,255,255,0.16)", "rgba(196,154,255,0.11)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.giftBoxCard, styles.giftBoxCardReceived]}
                  >
                    {giftExchangeMode ? (
                      <View
                        style={[
                          styles.exchangeCheckbox,
                          asCount(selectedReceivedGiftCountMap[row.gift.id]) > 0 ? styles.exchangeCheckboxSelected : null,
                        ]}
                      >
                        <Ionicons
                          name={asCount(selectedReceivedGiftCountMap[row.gift.id]) > 0 ? "checkmark" : "add"}
                          size={12}
                          color={asCount(selectedReceivedGiftCountMap[row.gift.id]) > 0 ? "#4E2700" : "#FFEAD2"}
                        />
                      </View>
                    ) : null}
                    <LinearGradient
                      colors={["rgba(255,242,249,0.96)", "rgba(255,226,242,0.95)", "rgba(248,199,229,0.9)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={styles.giftBoxImageWrap}
                    >
                      <Image
                        source={GIFT_IMAGE_BY_ID[row.gift.id] || GIFT_IMG_CANDY}
                        resizeMode="contain"
                        style={styles.giftBoxImage}
                      />
                    </LinearGradient>
                    <AppText numberOfLines={1} style={styles.giftBoxCardName}>
                      {getGiftDisplayName(t, row.gift)}
                    </AppText>
                    {giftExchangeMode ? (
                      <View style={styles.exchangeQtyRow}>
                        <Pressable
                          disabled={asCount(selectedReceivedGiftCountMap[row.gift.id]) <= 0}
                          onPress={(e: any) => {
                            e?.stopPropagation?.();
                            onAdjustReceivedGiftQty(row.gift.id, -1);
                          }}
                          style={({ pressed }) => [
                            styles.exchangeQtyBtn,
                            asCount(selectedReceivedGiftCountMap[row.gift.id]) <= 0 ? styles.exchangeQtyBtnDisabled : null,
                            pressed ? styles.cardPressed : null,
                          ]}
                        >
                          <AppText style={styles.exchangeQtyBtnText}>-</AppText>
                        </Pressable>
                        <View style={styles.exchangeQtyValuePill}>
                          <AppText style={styles.giftBoxCountText}>
                            {asCount(selectedReceivedGiftCountMap[row.gift.id]) >= row.count && row.count > 0
                              ? t("giftbox.max_qty")
                              : t("giftbox.qty_count", { count: formatNumber(asCount(selectedReceivedGiftCountMap[row.gift.id])) })}
                          </AppText>
                        </View>
                        <Pressable
                          disabled={asCount(selectedReceivedGiftCountMap[row.gift.id]) >= row.count}
                          onPress={(e: any) => {
                            e?.stopPropagation?.();
                            onAdjustReceivedGiftQty(row.gift.id, 1);
                          }}
                          style={({ pressed }) => [
                            styles.exchangeQtyBtn,
                            asCount(selectedReceivedGiftCountMap[row.gift.id]) >= row.count ? styles.exchangeQtyBtnDisabled : null,
                            pressed ? styles.cardPressed : null,
                          ]}
                        >
                          <AppText style={styles.exchangeQtyBtnText}>+</AppText>
                        </Pressable>
                      </View>
                    ) : (
                      <View style={styles.giftBoxCountPillReceived}>
                        <AppText style={styles.giftBoxCountText}>{t("giftbox.qty_count", { count: formatNumber(row.count) })}</AppText>
                      </View>
                    )}
                  </LinearGradient>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    );
  }, [allReceivedSelected, giftExchangeMode, giftExchanging, goTab, insets.bottom, onAdjustReceivedGiftQty, onConfirmGiftExchange, onToggleGiftExchangeMode, onToggleReceivedGiftSelect, onToggleSelectAllReceivedGifts, ownedGiftList, receivedGiftList, renderGiftBoxEmpty, selectedExchangeKernel, selectedReceivedGiftCountMap, selectedReceivedGiftRows.length, t]);

  const popmOverlayScale = popmExpandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.01],
  });

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#2A0B24", "#4A1140", "#6C1A53", "#2D0D2F"]}
        style={[StyleSheet.absoluteFill, { opacity: 1 - popmToneProgress }]}
      />
      <LinearGradient
        colors={["#332100", "#5B3A00", "#8B5A00", "#3C2600"]}
        style={[StyleSheet.absoluteFill, { opacity: popmToneProgress }]}
      />
      <LinearGradient
        colors={["rgba(255,105,170,0.24)", "rgba(255,140,196,0.1)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { opacity: 1 - popmToneProgress }]}
      />
      <LinearGradient
        colors={["rgba(255,223,128,0.24)", "rgba(255,203,76,0.12)", "transparent"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[StyleSheet.absoluteFill, { opacity: popmToneProgress }]}
      />

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        scrollEnabled={!purchaseConfirming}
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onPagerEnd}
        onScroll={onPagerScroll}
        scrollEventThrottle={16}
        decelerationRate="normal"
        disableIntervalMomentum
        bounces={false}
        overScrollMode="never"
        snapToInterval={SCREEN_WIDTH}
        snapToAlignment="start"
      >
        <View style={styles.page}>{renderPage("popcorn")}</View>
        <View style={styles.page}>{renderPage("kernel")}</View>
        <View style={styles.page}>{renderGiftPage()}</View>
        <View style={styles.page}>{renderGiftBoxPage()}</View>
        <View style={styles.page}>{renderPopmPage()}</View>
      </ScrollView>

      {purchaseConfirming ? (
        <View style={styles.purchaseConfirmOverlay}>
          <View style={styles.purchaseConfirmBadge}>
            <ActivityIndicator size="small" color="#FFE6A8" />
            <AppText style={styles.purchaseConfirmText}>{t("shop.purchase.confirming")}</AppText>
          </View>
        </View>
      ) : null}

      {popmOverlayVisible ? (
        <Animated.View style={[styles.popmPlayOverlay, { opacity: popmExpandAnim }]}>
          <Animated.View style={[styles.popmPlayFrame, { transform: [{ scale: popmOverlayScale }] }]}>
            <VideoView
              player={popmPlayer}
              style={[styles.popmAnimImage, styles.popmAnimImageExpanded]}
              contentFit="cover"
              surfaceType="textureView"
              useExoShutter={false}
              nativeControls={false}
              allowsFullscreen={false}
              allowsPictureInPicture={false}
            />
            {popmConverting ? (
              <View pointerEvents="none" style={styles.popmVideoBusyOverlay}>
                <View style={styles.popmVideoBusyBadge}>
                  <AppText style={styles.popmVideoBusyText}>{t("shop.popm.converting")}</AppText>
                </View>
              </View>
            ) : null}
          </Animated.View>
        </Animated.View>
      ) : null}

      <Modal
        transparent
        visible={Boolean(giftBuyTarget)}
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeGiftBuyModal}
      >
        <View style={styles.giftBuyBackdrop}>
          <LinearGradient
            colors={["#FFF6FB", "#FFEAF5", "#FFD3E8"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.giftBuyModalCard}
          >
            <View style={styles.giftBuyModalBodyRow}>
              <Image
                source={GIFT_IMAGE_BY_ID[giftBuyTarget?.id || ""] || GIFT_IMG_CANDY}
                resizeMode="contain"
                style={styles.giftBuyModalImage}
              />
              <View style={styles.giftBuyModalInfoCol}>
                <AppText numberOfLines={1} style={styles.giftBuyModalNameLeft}>
                  {getGiftDisplayName(t, giftBuyTarget)}
                </AppText>
                <AppText style={styles.giftBuyModalPriceLeft}>{t("shop.gift.buy_count", { count: formatNumber(giftBuyCount) })}</AppText>
                <AppText style={styles.giftBuyModalPriceLeft}>
                  {t("shop.gift.buy_kernel_total", { amount: formatNumber((giftBuyTarget?.costKernel || 0) * giftBuyCount) })}
                </AppText>
              </View>
              <View style={styles.giftBuyModalQtyCol}>
                <Pressable
                  disabled={giftBuying || giftBuyCount <= 1}
                  onPress={onDecreaseGiftBuyCount}
                  style={({ pressed }) => [
                    styles.giftBuyQtyBtn,
                    giftBuying || giftBuyCount <= 1 ? styles.giftBuyQtyBtnDisabled : null,
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  <AppText style={styles.giftBuyQtyBtnText}>-</AppText>
                </Pressable>
                <Pressable
                  disabled={giftBuying}
                  onPress={onIncreaseGiftBuyCount}
                  style={({ pressed }) => [
                    styles.giftBuyQtyBtn,
                    styles.giftBuyQtyBtnPlus,
                    giftBuying ? styles.giftBuyQtyBtnDisabled : null,
                    pressed ? styles.cardPressed : null,
                  ]}
                >
                  <AppText style={styles.giftBuyQtyBtnText}>+</AppText>
                </Pressable>
              </View>
            </View>

            <View style={styles.giftBuyModalBtnRow}>
              <Pressable
                disabled={giftBuying}
                onPress={closeGiftBuyModal}
                style={({ pressed }) => [
                  styles.giftBuyModalBtn,
                  styles.giftBuyModalBtnGhost,
                  (pressed || giftBuying) ? styles.cardPressed : null,
                ]}
              >
                <AppText style={styles.giftBuyModalBtnGhostText}>{t("common.cancel")}</AppText>
              </Pressable>
              <Pressable
                disabled={giftBuying}
                onPress={onConfirmGiftBuy}
                style={({ pressed }) => [
                  styles.giftBuyModalBtn,
                  styles.giftBuyModalBtnConfirm,
                  (pressed || giftBuying) ? styles.cardPressed : null,
                ]}
              >
                <AppText style={styles.giftBuyModalBtnConfirmText}>{giftBuying ? t("shop.gift.buying") : t("shop.gift.buy")}</AppText>
              </Pressable>
            </View>
          </LinearGradient>
        </View>
      </Modal>

      <Modal
        transparent
        visible={popmResultModalVisible}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={closePopmResultModal}
      >
        <View style={styles.popmResultBackdrop}>
          <View style={styles.popmResultCard}>
            <AppText style={styles.popmResultText}>
              <AppText style={styles.popmResultTextMuted}>{String(popmResultModalBody || "")}</AppText>
            </AppText>
            <Pressable onPress={closePopmResultModal} style={({ pressed }) => [styles.popmResultConfirmBtn, pressed ? styles.cardPressed : null]}>
              <AppText style={styles.popmResultConfirmBtnText}>{t("common.confirm")}</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  popmPageWrap: {
    flex: 1,
  },
  headerBackBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  headerBackText: {
    fontSize: 24,
    fontWeight: "900",
    color: "#EFE6FF",
  },
  headerTabsScroll: {
    width: "100%",
  },
  headerTabs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 2,
  },
  headerTabsLead: {
    paddingLeft: 8,
    paddingRight: 8,
  },
  headerTab: {
    flexShrink: 0,
    borderRadius: 999,
    borderWidth: 1.3,
    borderColor: "rgba(255,255,255,0.25)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 8,
    paddingVertical: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTabInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 0,
    gap: 4,
  },
  headerTabIcon: {
    width: 14,
    height: 14,
  },
  headerTabActive: {
    backgroundColor: "rgba(255,154,212,0.3)",
    borderColor: "rgba(255,207,234,0.72)",
  },
  headerTabDisabled: {
    opacity: 0.45,
  },
  headerTabText: {
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 17,
    color: "#E6DBFF",
    letterSpacing: -0.2,
    textAlign: "center",
    includeFontPadding: false,
  },
  headerTabTextActive: {
    color: "#FFE4F4",
  },
  headerPopmBtn: {
    flex: 0,
    width: 40,
    height: 44,
    borderRadius: 0,
    borderWidth: 0,
    borderColor: "transparent",
    backgroundColor: "transparent",
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  headerPopmBtnActive: {
    opacity: 1,
  },
  headerPopmBtnTight: {
    marginLeft: -3,
  },
  headerPopmIconWrap: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  headerPopmInnerLightMask: {
    position: "absolute",
    top: 5,
    width: 18,
    height: 16,
    borderRadius: 9999,
    backgroundColor: "rgba(255, 215, 84, 0.52)",
    borderWidth: 0.8,
    borderColor: "rgba(255, 244, 176, 0.84)",
    shadowColor: "#FFD54A",
    shadowOpacity: 0.95,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 9,
  },
  headerPopmInnerGlowCore: {
    position: "absolute",
    top: 9,
    width: 9,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255, 247, 188, 0.97)",
  },
  headerPopmIcon: {
    width: 28,
    height: 28,
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
  popmHero: {
    borderColor: "rgba(255,228,163,0.42)",
    backgroundColor: "rgba(82,51,7,0.62)",
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
    gap: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,206,74,0.25)",
    borderWidth: 1,
    borderColor: "rgba(255,236,157,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  popmHeroBadge: {
    backgroundColor: "rgba(255,206,74,0.3)",
    borderColor: "rgba(255,238,177,0.72)",
  },
  heroBadgeText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFE9A3",
  },
  heroWalletRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,221,120,0.48)",
    backgroundColor: "rgba(255,191,69,0.22)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  heroWalletIcon: {
    width: 16,
    height: 16,
  },
  heroWalletLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFE8C0",
  },
  heroWalletValue: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFF4D8",
    minWidth: 56,
    textAlign: "right",
  },
  popmHeroBadgeText: {
    color: "#FFF3C8",
  },
  heroRowTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#FFB7DE",
    textAlign: "right",
    flex: 1,
  },
  giftBalanceRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  giftBalanceText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFE8C0",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: CARD_GAP,
  },
  giftShopGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: GIFT_SHOP_CARD_GAP,
    rowGap: GIFT_SHOP_CARD_GAP,
  },
  cardShell: {
    width: CARD_WIDTH,
  },
  giftShopCardShell: {
    width: GIFT_SHOP_CARD_WIDTH,
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
  giftArtWrap: {
    height: 102,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,216,239,0.9)",
    backgroundColor: "rgba(255,238,247,0.95)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  giftArtGlow: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: "rgba(255,226,241,0.62)",
  },
  giftArtImage: {
    width: "66%",
    height: "66%",
  },
  giftEmojiBubble: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  giftEmoji: {
    fontSize: 42,
  },
  x2BadgeOverlay: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  x2BadgeOuterSpike: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -2,
    marginTop: -7,
    width: 0,
    height: 0,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderBottomWidth: 7,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#FF8FAE",
  },
  x2BadgeCoreWrap: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  x2BadgeInnerSpike: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -1.5,
    marginTop: -5,
    width: 0,
    height: 0,
    borderLeftWidth: 1.5,
    borderRightWidth: 1.5,
    borderBottomWidth: 5,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#FF5E89",
  },
  x2BadgeCore: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#E6385D",
    borderWidth: 1.5,
    borderColor: "rgba(255,171,188,0.95)",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 3,
    paddingBottom: 2,
  },
  x2BadgeTopText: {
    fontSize: 8,
    fontWeight: "900",
    color: "#FFF4CE",
    lineHeight: 9,
    textAlign: "center",
  },
  x2BadgeBottomText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFF4CE",
    lineHeight: 14,
    textAlign: "center",
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
    width: "100%",
    paddingHorizontal: 2,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
  },
  giftCardName: {
    marginTop: 8,
    minHeight: 22,
    fontSize: 14,
    fontWeight: "900",
    color: "#F2F4FF",
    textAlign: "center",
  },
  amountBase: {
    fontSize: 20,
    fontWeight: "900",
    color: "#F2F4FF",
    textAlign: "center",
  },
  amountPlanLabel: {
    fontSize: 17,
    fontWeight: "900",
    color: "#F2F4FF",
    textAlign: "center",
    letterSpacing: -0.2,
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
  amountTextTight: {
    letterSpacing: -0.7,
  },
  amountCompact: {
    fontSize: 18,
  },
  amountPlusCompact: {
    fontSize: 16,
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
  giftCostBar: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.56)",
    minHeight: 36,
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  giftPrice: {
    fontSize: 15,
    color: "#6F3500",
    fontWeight: "900",
  },
  giftPriceRowCentered: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  giftPriceCentered: {
    fontSize: 15,
    color: "#6F3500",
    fontWeight: "900",
    textAlign: "center",
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
  giftBuyBtn: {
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.6)",
    backgroundColor: "rgba(255,173,69,0.35)",
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  giftBuyBtnText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFF6D6",
  },
  giftBuyBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
  },
  giftBuyModalCard: {
    width: "100%",
    maxWidth: 304,
    minHeight: 184,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,166,210,0.9)",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  giftBuyModalBodyRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "center",
    gap: 9,
    minHeight: 90,
    width: "100%",
    alignSelf: "center",
  },
  giftBuyModalImage: {
    width: 82,
    height: 82,
    marginLeft: 6,
  },
  giftBuyModalInfoCol: {
    width: 128,
    justifyContent: "center",
    gap: 4,
    marginTop: 10,
    marginLeft: 5,
  },
  giftBuyModalNameLeft: {
    fontSize: 16,
    fontWeight: "900",
    color: "#6E204A",
    textAlign: "left",
  },
  giftBuyModalPriceLeft: {
    fontSize: 13,
    fontWeight: "800",
    color: "#8A3A64",
    textAlign: "left",
  },
  giftBuyModalQtyCol: {
    marginTop: 12,
    gap: 8,
    alignItems: "center",
    justifyContent: "flex-start",
    marginRight: 2,
  },
  giftBuyQtyBtn: {
    width: 30,
    height: 26,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(174,97,138,0.58)",
    backgroundColor: "rgba(255,255,255,0.62)",
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  giftBuyQtyBtnDisabled: {
    opacity: 0.45,
  },
  giftBuyQtyBtnPlus: {
    marginTop: 10,
  },
  giftBuyQtyBtnText: {
    fontSize: 15,
    fontWeight: "900",
    color: "#7A3A59",
    lineHeight: 16,
    textAlign: "center",
    includeFontPadding: false,
  },
  giftBuyModalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: "#8A2157",
    textAlign: "center",
  },
  giftBuyModalName: {
    fontSize: 16,
    fontWeight: "900",
    color: "#6E204A",
    textAlign: "center",
  },
  giftBuyModalDesc: {
    fontSize: 13,
    fontWeight: "700",
    color: "#8A3A64",
    textAlign: "center",
    lineHeight: 19,
  },
  giftBuyModalBalance: {
    fontSize: 13,
    fontWeight: "800",
    color: "#7A3A59",
    textAlign: "center",
  },
  giftBuyModalBtnRow: {
    marginTop: 2,
    flexDirection: "row",
    gap: 8,
  },
  giftBuyModalBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  giftBuyModalBtnGhost: {
    borderColor: "rgba(164,88,128,0.5)",
    backgroundColor: "rgba(255,255,255,0.56)",
  },
  giftBuyModalBtnGhostText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#74405C",
  },
  giftBuyModalBtnConfirm: {
    borderColor: "rgba(255,176,217,0.95)",
    backgroundColor: "rgba(229,78,152,0.95)",
  },
  giftBuyModalBtnConfirmText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFF4FB",
  },
  giftBoxSection: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,204,235,0.3)",
    backgroundColor: "rgba(0,0,0,0.22)",
    paddingHorizontal: GIFTBOX_SECTION_PADDING_X,
    paddingVertical: 10,
    gap: 8,
  },
  giftBoxSectionTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFE8F6",
    paddingHorizontal: 2,
  },
  giftBoxSectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  giftBoxSectionGoShopBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.72)",
    backgroundColor: "rgba(255,173,69,0.3)",
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  giftBoxSectionGoShopBtnText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFF4D0",
  },
  giftBoxHeroRow: {
    alignItems: "center",
    justifyContent: "flex-start",
    flexWrap: "wrap",
  },
  giftBoxHeroWalletLabel: {
    flex: 1,
    minWidth: 120,
    textAlign: "right",
    textAlignVertical: "center",
    lineHeight: 19,
  },
  giftBoxEmpty: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,214,236,0.26)",
    backgroundColor: "rgba(255,255,255,0.04)",
    paddingHorizontal: 10,
    paddingVertical: 10,
    paddingTop: 14,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    minHeight: 188,
  },
  giftBoxEmptyVisualWrap: {
    width: 148,
    height: 98,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  giftBoxEmptyImage: {
    width: "92%",
    height: "92%",
  },
  giftBoxEmptyOverlayWrap: {
    position: "absolute",
    top: -24,
    right: 40,
    transform: [{ rotate: "-12deg" }],
  },
  giftBoxEmptyOverlayTextStroke: {
    position: "absolute",
    fontSize: 18,
    fontWeight: "900",
    color: "#1A1118",
    includeFontPadding: false,
  },
  giftBoxEmptyOverlayStrokeTop: {
    top: -1,
    left: 0,
  },
  giftBoxEmptyOverlayStrokeLeft: {
    top: 0,
    left: -1,
  },
  giftBoxEmptyOverlayStrokeRight: {
    top: 0,
    left: 1,
  },
  giftBoxEmptyOverlayText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFE3F4",
    includeFontPadding: false,
  },
  giftBoxEmptyText: {
    fontSize: 12,
    fontWeight: "700",
    color: "rgba(255,223,241,0.8)",
    textAlign: "center",
    marginTop: 2,
  },
  giftBoxGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    columnGap: GIFTBOX_CARD_GAP,
    rowGap: GIFTBOX_CARD_GAP,
  },
  giftBoxCard: {
    width: GIFTBOX_CARD_WIDTH,
    minHeight: 118,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,208,235,0.34)",
    backgroundColor: "rgba(255,174,224,0.14)",
    paddingHorizontal: 6,
    paddingVertical: 7,
    alignItems: "center",
    gap: 4,
  },
  giftBoxCardReceived: {
    width: GIFTBOX_RECEIVED_CARD_WIDTH,
  },
  giftBoxImageWrap: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,216,239,0.9)",
    backgroundColor: "rgba(255,238,247,0.95)",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  giftBoxImage: {
    width: "66%",
    height: "66%",
  },
  giftBoxCardName: {
    width: "100%",
    fontSize: 10,
    fontWeight: "900",
    color: "#FFF2FB",
    textAlign: "center",
  },
  giftBoxCountPill: {
    marginTop: "auto",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,244,214,0.66)",
    backgroundColor: "rgba(255,196,86,0.26)",
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  giftBoxCountPillReceived: {
    marginTop: "auto",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,244,214,0.66)",
    backgroundColor: "rgba(255,196,86,0.26)",
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  giftBoxCountText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#FFF5DA",
  },
  exchangeSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,217,185,0.24)",
    backgroundColor: "rgba(255,206,139,0.08)",
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  exchangeSummaryText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "800",
    color: "#FFE9C8",
  },
  exchangeActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  exchangeSelectAllBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.72)",
    backgroundColor: "rgba(255,173,69,0.24)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  exchangeConfirmBtn: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.72)",
    backgroundColor: "rgba(255,173,69,0.32)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 54,
  },
  exchangeConfirmBtnDisabled: {
    opacity: 0.55,
  },
  exchangeConfirmBtnText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFF4D0",
  },
  exchangeSpinner: {
    marginRight: 6,
  },
  exchangeCheckbox: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: "rgba(255,244,214,0.76)",
    backgroundColor: "rgba(88,50,12,0.48)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },
  exchangeCheckboxSelected: {
    backgroundColor: "rgba(255,208,124,0.92)",
    borderColor: "rgba(255,249,224,0.92)",
  },
  exchangeQtyRow: {
    marginTop: "auto",
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
  },
  exchangeQtyBtn: {
    minWidth: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.72)",
    backgroundColor: "rgba(255,173,69,0.28)",
    paddingHorizontal: 6,
    paddingVertical: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  exchangeQtyBtnDisabled: {
    opacity: 0.45,
  },
  exchangeQtyBtnText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFF4D0",
    lineHeight: 13,
  },
  exchangeQtyValuePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,244,214,0.66)",
    backgroundColor: "rgba(255,196,86,0.26)",
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  popmCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,227,159,0.36)",
    overflow: "hidden",
    padding: 10,
    paddingBottom: 16,
    gap: 8,
    backgroundColor: "rgba(255,205,96,0.16)",
  },
  popmAnimWrap: {
    height: 420,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255,240,198,0.74)",
    backgroundColor: "#F4F5F3",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  popmAnimPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "#F4F5F3",
  },
  popmAnimImage: {
    width: "100%",
    height: "100%",
    backgroundColor: "transparent",
    transform: [{ translateX: -8 }, { translateY: 36 }, { scaleX: 1.11 }, { scaleY: 1.11 }],
  },
  popmAnimImageExpanded: {
    transform: [{ translateX: -12 }, { translateY: 28 }, { scaleX: 1.28 }, { scaleY: 1.28 }],
  },
  popmInputWrap: {
    gap: 4,
  },
  popmInputFieldWrap: {
    position: "relative",
    justifyContent: "center",
  },
  popmInputPlaceholderWrap: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  popmInputPlaceholder: {
    fontSize: 20,
    fontWeight: "700",
    color: "rgba(255,245,220,0.62)",
  },
  popmInputLabel: {
    fontSize: 15,
    fontWeight: "900",
    color: "#FFECC2",
  },
  popmInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,231,193,0.64)",
    backgroundColor: "rgba(80,49,7,0.58)",
    color: "#FFF8E8",
    fontSize: 16,
    fontWeight: "800",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  popmHint: {
    fontSize: 13,
    color: "rgba(255,242,208,0.94)",
    fontWeight: "700",
    lineHeight: 19,
  },
  popmBalanceCol: {
    alignItems: "stretch",
    minWidth: 162,
    marginLeft: 18,
    gap: 3,
  },
  popmBalanceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 6,
  },
  popmBalanceLabel: {
    width: 68,
    fontSize: 13,
    fontWeight: "800",
    color: "#FFEECB",
    textAlign: "right",
  },
  popmBalanceValue: {
    minWidth: 78,
    fontSize: 13,
    fontWeight: "900",
    color: "#FFF6D6",
    textAlign: "right",
    fontVariant: ["tabular-nums"],
  },
  popmConvertBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.76)",
    backgroundColor: "rgba(238,160,32,0.55)",
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  popmConvertBtnDisabled: {
    opacity: 0.6,
  },
  popmConvertBtnText: {
    fontSize: 18,
    fontWeight: "900",
    color: "#FFF6D6",
    letterSpacing: 0.2,
  },
  popmResultText: {
    width: "100%",
    fontSize: 16,
    fontWeight: "600",
    color: "#8A9099",
    lineHeight: 24,
    textAlign: "center",
  },
  popmResultTextMuted: {
    color: "#8A9099",
    fontSize: 16,
    fontWeight: "600",
  },
  popmResultTextEmphasis: {
    color: "#5B3500",
    fontSize: 19,
    fontWeight: "700",
  },
  popmResultBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.58)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  popmResultCard: {
    width: "92%",
    maxWidth: 300,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 10,
    shadowColor: "#B77A18",
    shadowOpacity: 0.34,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  popmResultTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#503000",
    textAlign: "center",
  },
  popmResultConfirmBtn: {
    width: "100%",
    alignSelf: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(93,59,0,0.72)",
    backgroundColor: "#8A5D00",
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  popmResultConfirmBtnText: {
    fontSize: 16,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  popmPlayOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: "transparent",
    alignItems: "stretch",
    justifyContent: "flex-start",
    paddingHorizontal: 0,
  },
  popmPlayFrame: {
    width: "100%",
    height: "100%",
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1.2,
    borderColor: "rgba(255,240,198,0.88)",
    backgroundColor: "#F4F5F3",
  },
  purchaseConfirmOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    backgroundColor: "rgba(0,0,0,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  purchaseConfirmBadge: {
    minWidth: 150,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,236,173,0.76)",
    backgroundColor: "rgba(48,31,0,0.9)",
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  purchaseConfirmText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFF0C8",
  },
  popmVideoBusyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 8,
  },
  popmVideoBusyBadge: {
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "rgba(255,236,173,0.78)",
    backgroundColor: "rgba(56,35,0,0.66)",
  },
  popmVideoBusyText: {
    fontSize: 24,
    fontWeight: "900",
    color: "#FFF4CC",
    letterSpacing: 0.2,
  },
});
