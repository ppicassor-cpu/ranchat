import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, Dimensions, Image, Pressable, ScrollView, StyleSheet, View, type ImageSourcePropType } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import AppText from "../components/AppText";
import { useAppStore } from "../store/useAppStore";
import { GIFT_CATALOG, getGiftDisplayName, type GiftItem } from "../constants/giftCatalog";
import type { MainStackParamList } from "../navigation/MainStack";
import { exchangeReceivedGiftsOnServer, fetchShopGiftInventory } from "../services/shop/ShopPurchaseService";
import { useTranslation } from "../i18n/LanguageProvider";

type Props = NativeStackScreenProps<MainStackParamList, "GiftBox">;

type GiftEntry = {
  gift: GiftItem;
  count: number;
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const PAGE_PADDING = 16;
const GIFTBOX_CARD_GAP = 6;
const GIFTBOX_SECTION_PADDING_X = 8;
const GIFTBOX_GRID_EDGE_SAFE = 4;
const GIFTBOX_CARD_WIDTH = Math.max(
  52,
  Math.floor((SCREEN_WIDTH - PAGE_PADDING * 2 - GIFTBOX_SECTION_PADDING_X * 2 - GIFTBOX_CARD_GAP * 3 - GIFTBOX_GRID_EDGE_SAFE) / 4)
);
const GIFTBOX_RECEIVED_CARD_WIDTH = Math.max(
  72,
  Math.floor((SCREEN_WIDTH - PAGE_PADDING * 2 - GIFTBOX_SECTION_PADDING_X * 2 - GIFTBOX_CARD_GAP * 2 - GIFTBOX_GRID_EDGE_SAFE) / 3)
);

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
const EMPTY_BOX_IMG = require("../../assets/box.png");

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

function asCount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function toDisplayCount(v: number): string {
  return asCount(v).toLocaleString("ko-KR");
}

function calcExchangeKernel(costKernel: number, count: number): number {
  const unit = Math.max(0, Math.trunc(Number(costKernel) * 0.8));
  return unit * Math.max(0, Math.trunc(Number(count) || 0));
}

function listFromMap(mapLike: unknown): GiftEntry[] {
  const src = mapLike && typeof mapLike === "object" ? (mapLike as Record<string, unknown>) : {};
  return GIFT_CATALOG.map((gift) => ({
    gift,
    count: asCount(src[gift.id]),
  })).filter((row) => row.count > 0);
}

function GiftCard({
  row,
  mode,
  type,
  onPressSend,
  exchangeMode,
  selectedQty,
  onToggleSelect,
  onAdjustQty,
}: {
  row: GiftEntry;
  mode: "view" | "send";
  type: "owned" | "received";
  onPressSend: () => void;
  exchangeMode?: boolean;
  selectedQty?: number;
  onToggleSelect?: () => void;
  onAdjustQty?: (delta: number) => void;
}) {
  const { t } = useTranslation();
  const canSend = mode === "send" && type === "owned";
  const canSelectExchange = type === "received" && Boolean(exchangeMode);
  const qty = Math.min(row.count, asCount(selectedQty));
  const selected = qty > 0;
  const cardContent = (
    <LinearGradient
      colors={["rgba(255,255,255,0.16)", "rgba(196,154,255,0.11)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.giftBoxCard, type === "received" ? styles.giftBoxCardReceived : null]}
    >
      {canSelectExchange ? (
        <View style={[styles.exchangeCheckbox, selected ? styles.exchangeCheckboxSelected : null]}>
          <Ionicons name={selected ? "checkmark" : "add"} size={12} color={selected ? "#4E2700" : "#FFEAD2"} />
        </View>
      ) : null}
      <LinearGradient
        colors={["rgba(255,242,249,0.96)", "rgba(255,226,242,0.95)", "rgba(248,199,229,0.9)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.giftBoxImageWrap}
      >
        <Image source={GIFT_IMAGE_BY_ID[row.gift.id] || GIFT_IMG_CANDY} resizeMode="contain" style={styles.giftBoxImage} />
      </LinearGradient>
      <AppText numberOfLines={1} style={styles.giftBoxCardName}>
        {getGiftDisplayName(t, row.gift)}
      </AppText>
      {canSend ? (
        <Pressable onPress={onPressSend} style={({ pressed }) => [styles.sendBtn, pressed ? styles.sendBtnPressed : null]}>
          <AppText style={styles.sendBtnText}>{t("giftbox.send_button_count", { count: toDisplayCount(row.count) })}</AppText>
        </Pressable>
      ) : canSelectExchange ? (
        <View style={styles.exchangeQtyRow}>
          <Pressable
            disabled={qty <= 0}
            onPress={(e: any) => {
              e?.stopPropagation?.();
              onAdjustQty?.(-1);
            }}
            style={({ pressed }) => [
              styles.exchangeQtyBtn,
              qty <= 0 ? styles.exchangeQtyBtnDisabled : null,
              pressed ? styles.giftCardPressed : null,
            ]}
          >
            <AppText style={styles.exchangeQtyBtnText}>-</AppText>
          </Pressable>
          <View style={styles.exchangeQtyValuePill}>
            <AppText style={styles.giftBoxCountText}>
              {qty >= row.count && row.count > 0 ? t("giftbox.max_qty") : t("giftbox.qty_count", { count: toDisplayCount(qty) })}
            </AppText>
          </View>
          <Pressable
            disabled={qty >= row.count}
            onPress={(e: any) => {
              e?.stopPropagation?.();
              onAdjustQty?.(1);
            }}
            style={({ pressed }) => [
              styles.exchangeQtyBtn,
              qty >= row.count ? styles.exchangeQtyBtnDisabled : null,
              pressed ? styles.giftCardPressed : null,
            ]}
          >
            <AppText style={styles.exchangeQtyBtnText}>+</AppText>
          </Pressable>
        </View>
      ) : (
        <View style={type === "received" ? styles.giftBoxCountPillReceived : styles.giftBoxCountPill}>
          <AppText style={styles.giftBoxCountText}>{t("giftbox.qty_count", { count: toDisplayCount(row.count) })}</AppText>
        </View>
      )}
    </LinearGradient>
  );
  if (canSelectExchange) {
    return (
      <Pressable onPress={onToggleSelect} style={({ pressed }) => [pressed ? styles.giftCardPressed : null]}>
        {cardContent}
      </Pressable>
    );
  }
  return cardContent;
}

export default function GiftBoxScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const mode = route.params?.mode === "send" ? "send" : "view";
  const auth = useAppStore((s: any) => s.auth);
  const ownedMap = useAppStore((s: any) => s.shop?.giftsOwned);
  const receivedMap = useAppStore((s: any) => s.shop?.giftsReceived);
  const setShop = useAppStore((s: any) => s.setShop);
  const setAssets = useAppStore((s: any) => s.setAssets);
  const requestGiftSend = useAppStore((s: any) => s.requestGiftSend);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: mode === "send" ? t("giftbox.header_send") : t("giftbox.header_box"),
      headerStyle: { backgroundColor: "#2A0B24" },
      headerTitleStyle: { fontSize: 16, fontWeight: "700" },
      headerTintColor: "#FFE4F4",
      headerShadowVisible: false,
      headerBackVisible: false,
      headerLeft: () => (
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.headerBackBtn}>
          <AppText style={styles.headerBackText}>{"<"}</AppText>
        </Pressable>
      ),
    });
  }, [mode, navigation, t]);

  const ownedList = useMemo(() => listFromMap(ownedMap), [ownedMap]);
  const receivedList = useMemo(() => listFromMap(receivedMap), [receivedMap]);
  const [exchangeMode, setExchangeMode] = useState(false);
  const [selectedReceivedMap, setSelectedReceivedMap] = useState<Record<string, number>>({});
  const [exchanging, setExchanging] = useState(false);

  const selectedReceivedList = useMemo(() => {
    return receivedList
      .map((row) => {
        const selectedCount = Math.min(row.count, asCount(selectedReceivedMap[row.gift.id]));
        return {
          ...row,
          exchangeCount: selectedCount,
        };
      })
      .filter((row) => row.exchangeCount > 0);
  }, [receivedList, selectedReceivedMap]);

  const selectedExchangeKernel = useMemo(
    () => selectedReceivedList.reduce((sum, row) => sum + calcExchangeKernel(row.gift.costKernel, row.exchangeCount), 0),
    [selectedReceivedList]
  );
  const allReceivedSelected = useMemo(() => {
    if (receivedList.length <= 0) return false;
    return receivedList.every((row) => asCount(selectedReceivedMap[row.gift.id]) >= row.count);
  }, [receivedList, selectedReceivedMap]);

  useEffect(() => {
    let closed = false;
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId) return () => {
      closed = true;
    };

    const sync = async () => {
      const out = await fetchShopGiftInventory({ token, userId, deviceKey });
      if (closed || !out.ok || !out.giftStateFound) return;
      setShop({
        giftsOwned: out.giftsOwned,
        giftsReceived: out.giftsReceived,
      });
      setAssets({
        kernelCount: out.walletKernel,
        updatedAtMs: Date.now(),
      });
    };

    sync().catch(() => undefined);
    return () => {
      closed = true;
    };
  }, [auth?.deviceKey, auth?.token, auth?.userId, setAssets, setShop]);

  const onSendGift = useCallback(
    (gift: GiftItem) => {
      const ownedNow = asCount((ownedMap as Record<string, unknown> | undefined)?.[gift.id]);
      if (ownedNow <= 0) {
        showGlobalModal?.(t("giftbox.title"), t("giftbox.no_sendable"));
        return;
      }
      if (typeof requestGiftSend === "function") {
        requestGiftSend(gift.id);
      }
      navigation.goBack();
    },
    [navigation, ownedMap, requestGiftSend, showGlobalModal, t]
  );

  const onPressGoGiftShop = useCallback(() => {
    navigation.navigate("Shop", { initialTab: 2 });
  }, [navigation]);

  const onToggleExchangeMode = useCallback(() => {
    if (exchanging) return;
    if (exchangeMode) {
      setExchangeMode(false);
      setSelectedReceivedMap({});
      return;
    }
    setExchangeMode(true);
  }, [exchangeMode, exchanging]);

  const onToggleReceivedSelect = useCallback((giftId: string) => {
    const key = String(giftId || "").trim();
    if (!key || exchanging) return;
    const maxCount = Math.max(0, Math.trunc(Number(receivedList.find((row) => row.gift.id === key)?.count ?? 0)));
    if (maxCount <= 0) return;
    setSelectedReceivedMap((prev: Record<string, number>) => {
      const current = asCount(prev[key]);
      return {
        ...prev,
        [key]: current > 0 ? 0 : maxCount,
      };
    });
  }, [exchanging, receivedList]);

  const onAdjustReceivedQty = useCallback((giftId: string, delta: number) => {
    const key = String(giftId || "").trim();
    const d = Math.trunc(Number(delta) || 0);
    if (!key || !d || exchanging) return;
    const maxCount = Math.max(0, Math.trunc(Number(receivedList.find((row) => row.gift.id === key)?.count ?? 0)));
    if (maxCount <= 0) return;
    setSelectedReceivedMap((prev: Record<string, number>) => {
      const current = asCount(prev[key]);
      const next = Math.max(0, Math.min(maxCount, current + d));
      return {
        ...prev,
        [key]: next,
      };
    });
  }, [exchanging, receivedList]);

  const onToggleSelectAllReceived = useCallback(() => {
    if (exchanging || receivedList.length <= 0) return;
    if (allReceivedSelected) {
      setSelectedReceivedMap({});
      return;
    }
    const next: Record<string, number> = {};
    for (const row of receivedList) {
      next[row.gift.id] = row.count;
    }
    setSelectedReceivedMap(next);
  }, [allReceivedSelected, exchanging, receivedList]);

  const onConfirmExchange = useCallback(async () => {
    if (exchanging) return;
    if (selectedReceivedList.length <= 0) {
      showGlobalModal(t("giftbox.title"), t("giftbox.select_for_exchange"));
      return;
    }

    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId) {
      showGlobalModal(t("giftbox.title"), t("common.auth_expired"));
      return;
    }

    setExchanging(true);
    try {
      const out = await exchangeReceivedGiftsOnServer({
        token,
        userId,
        deviceKey,
        items: selectedReceivedList.map((row) => ({
          giftId: row.gift.id,
          count: row.exchangeCount,
          costKernel: row.gift.costKernel,
        })),
        idempotencyKey: `gift_exchange_${Date.now()}_${selectedReceivedList.length}`,
      });

      if (!out.ok) {
        const code = String(out.errorCode || "").toUpperCase();
        if (code === "GIFT_EXCHANGE_ROUTE_NOT_FOUND") {
          showGlobalModal(t("giftbox.title"), t("giftbox.error.exchange_route_missing"));
        } else if (code === "INSUFFICIENT_RECEIVED_GIFT") {
          showGlobalModal(t("giftbox.title"), t("giftbox.error.insufficient_received"));
        } else {
          showGlobalModal(t("giftbox.title"), out.errorMessage || out.errorCode || t("giftbox.error.exchange_failed"));
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
      setSelectedReceivedMap({});
      setExchangeMode(false);
      showGlobalModal(t("giftbox.title"), t("giftbox.exchange_done", { kernel: toDisplayCount(exchangedKernel) }));
    } finally {
      setExchanging(false);
    }
  }, [auth?.deviceKey, auth?.token, auth?.userId, exchanging, selectedExchangeKernel, selectedReceivedList, setAssets, setShop, showGlobalModal, t]);

  const renderEmptyState = useCallback(
    (message: string) => {
      const overlayText = t("giftbox.empty_overlay");
      return (
        <View style={styles.giftBoxEmpty}>
          <View style={styles.emptyBoxVisualWrap}>
            <Image source={EMPTY_BOX_IMG} resizeMode="contain" style={styles.emptyBoxImage} />
            <View style={styles.emptyBoxOverlayWrap}>
              <AppText style={styles.emptyBoxOverlayText}>{overlayText}</AppText>
            </View>
          </View>
          <AppText style={styles.giftBoxEmptyText}>{message}</AppText>
        </View>
      );
    },
    [t]
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
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(24, insets.bottom + 14) }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroRow}>
            <View style={styles.heroBadge}>
              <Ionicons name={mode === "send" ? "gift-outline" : "cube-outline"} size={16} color="#FFE99E" />
              <AppText numberOfLines={1} style={styles.heroBadgeText}>
                {t("giftbox.title")}
              </AppText>
            </View>
            <AppText numberOfLines={2} style={styles.heroWalletLabel}>
              {t("giftbox.hero_desc")}
            </AppText>
          </View>
        </View>

        <View style={styles.giftBoxSection}>
          <View style={styles.giftBoxSectionHeader}>
            <AppText style={styles.giftBoxSectionTitle}>{t("giftbox.section_owned")}</AppText>
            <Pressable onPress={onPressGoGiftShop} style={({ pressed }) => [styles.giftBoxSectionGoShopBtn, pressed ? styles.giftBoxSectionGoShopBtnPressed : null]}>
              <AppText style={styles.giftBoxSectionGoShopBtnText}>{t("giftbox.go_shop")}</AppText>
            </Pressable>
          </View>
          {ownedList.length === 0 ? (
            renderEmptyState(t("giftbox.empty_owned"))
          ) : (
            <View style={styles.giftBoxGrid}>
              {ownedList.map((row) => (
                <GiftCard
                  key={`owned_${row.gift.id}`}
                  row={row}
                  mode={mode}
                  type="owned"
                  onPressSend={() => onSendGift(row.gift)}
                  exchangeMode={false}
                  selectedQty={0}
                  onToggleSelect={() => undefined}
                  onAdjustQty={() => undefined}
                />
              ))}
            </View>
          )}
        </View>

        <View style={styles.giftBoxSection}>
          <View style={styles.giftBoxSectionHeader}>
            <AppText style={styles.giftBoxSectionTitle}>{t("giftbox.section_received")}</AppText>
            <Pressable
              disabled={exchanging}
              onPress={onToggleExchangeMode}
              style={({ pressed }) => [styles.giftBoxSectionGoShopBtn, pressed || exchanging ? styles.giftBoxSectionGoShopBtnPressed : null]}
            >
              <AppText style={styles.giftBoxSectionGoShopBtnText}>{t("giftbox.exchange_toggle")}</AppText>
            </Pressable>
          </View>
          {exchangeMode ? (
            <View style={styles.exchangeSummaryRow}>
              <AppText style={styles.exchangeSummaryText}>
                {t("giftbox.exchange_summary", { kernel: toDisplayCount(selectedExchangeKernel) })}
              </AppText>
              <View style={styles.exchangeActionRow}>
                <Pressable
                  disabled={exchanging || receivedList.length <= 0}
                  onPress={onToggleSelectAllReceived}
                  style={({ pressed }) => [
                    styles.exchangeSelectAllBtn,
                    exchanging || receivedList.length <= 0 ? styles.exchangeConfirmBtnDisabled : null,
                    pressed ? styles.giftCardPressed : null,
                  ]}
                >
                  <AppText style={styles.exchangeConfirmBtnText}>
                    {allReceivedSelected ? t("giftbox.clear_all") : t("giftbox.select_all")}
                  </AppText>
                </Pressable>
                <Pressable
                  disabled={exchanging || selectedReceivedList.length <= 0}
                  onPress={onConfirmExchange}
                  style={({ pressed }) => [
                    styles.exchangeConfirmBtn,
                    exchanging || selectedReceivedList.length <= 0 ? styles.exchangeConfirmBtnDisabled : null,
                    pressed ? styles.giftCardPressed : null,
                  ]}
                >
                  {exchanging ? <ActivityIndicator size="small" color="#FFF5DE" style={styles.exchangeSpinner} /> : null}
                  <AppText style={styles.exchangeConfirmBtnText}>{t("common.confirm")}</AppText>
                </Pressable>
              </View>
            </View>
          ) : null}
          {receivedList.length === 0 ? (
            renderEmptyState(t("giftbox.empty_received"))
          ) : (
            <View style={styles.giftBoxGrid}>
              {receivedList.map((row) => (
                <GiftCard
                  key={`received_${row.gift.id}`}
                  row={row}
                  mode={mode}
                  type="received"
                  onPressSend={() => undefined}
                  exchangeMode={exchangeMode}
                  selectedQty={asCount(selectedReceivedMap[row.gift.id])}
                  onToggleSelect={() => onToggleReceivedSelect(row.gift.id)}
                  onAdjustQty={(delta) => onAdjustReceivedQty(row.gift.id, delta)}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#2A0B24",
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
  content: {
    paddingHorizontal: PAGE_PADDING,
    paddingTop: 8,
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
    justifyContent: "flex-start",
    gap: 8,
    flexWrap: "wrap",
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
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
  },
  heroBadgeText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFE9A3",
    flexShrink: 1,
  },
  heroWalletLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFE8C0",
    flex: 1,
    minWidth: 120,
    textAlign: "right",
    textAlignVertical: "center",
    lineHeight: 19,
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
  giftBoxSectionGoShopBtnPressed: {
    opacity: 0.8,
  },
  giftBoxSectionGoShopBtnText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FFF4D0",
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
  emptyBoxVisualWrap: {
    width: 148,
    height: 98,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
  },
  emptyBoxImage: {
    width: "92%",
    height: "92%",
  },
  emptyBoxOverlayWrap: {
    position: "absolute",
    top: -24,
    right: 40,
    transform: [{ rotate: "-12deg" }],
  },
  emptyBoxOverlayTextStroke: {
    position: "absolute",
    fontSize: 18,
    fontWeight: "900",
    color: "#1A1118",
    includeFontPadding: false,
  },
  emptyBoxOverlayStrokeTop: {
    top: -1,
    left: 0,
  },
  emptyBoxOverlayStrokeLeft: {
    top: 0,
    left: -1,
  },
  emptyBoxOverlayStrokeRight: {
    top: 0,
    left: 1,
  },
  emptyBoxOverlayText: {
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
    minHeight: 114,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,208,235,0.34)",
    backgroundColor: "rgba(255,174,224,0.14)",
    paddingHorizontal: 6,
    paddingVertical: 6,
    alignItems: "center",
    gap: 3,
  },
  giftBoxCardReceived: {
    width: GIFTBOX_RECEIVED_CARD_WIDTH,
  },
  giftCardPressed: {
    opacity: 0.82,
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
    marginTop: -1,
  },
  giftBoxCountPill: {
    marginTop: "auto",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,244,214,0.66)",
    backgroundColor: "rgba(255,196,86,0.26)",
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  giftBoxCountPillReceived: {
    marginTop: "auto",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,244,214,0.66)",
    backgroundColor: "rgba(255,196,86,0.26)",
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  giftBoxCountText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#FFF5DA",
  },
  sendBtn: {
    marginTop: "auto",
    width: "100%",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,236,185,0.72)",
    backgroundColor: "rgba(255,173,69,0.35)",
    paddingVertical: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  sendBtnPressed: {
    opacity: 0.78,
  },
  sendBtnText: {
    fontSize: 10,
    fontWeight: "900",
    color: "#FFF6D6",
  },
});
