import React, { useCallback, useLayoutEffect, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import AppText from "../components/AppText";
import { useAppStore } from "../store/useAppStore";
import { GIFT_CATALOG, type GiftItem } from "../constants/giftCatalog";
import type { MainStackParamList } from "../navigation/MainStack";

type Props = NativeStackScreenProps<MainStackParamList, "GiftBox">;

type GiftEntry = {
  gift: GiftItem;
  count: number;
};

function asCount(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function toDisplayCount(v: number): string {
  return asCount(v).toLocaleString("ko-KR");
}

function listFromMap(mapLike: unknown): GiftEntry[] {
  const src = mapLike && typeof mapLike === "object" ? (mapLike as Record<string, unknown>) : {};
  return GIFT_CATALOG.map((gift) => ({
    gift,
    count: asCount(src[gift.id]),
  })).filter((row) => row.count > 0);
}

function Card({
  row,
  canSend,
  onPressSend,
}: {
  row: GiftEntry;
  canSend: boolean;
  onPressSend: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.artWrap}>
          <AppText style={styles.artEmoji}>{row.gift.emoji}</AppText>
        </View>
        <View style={styles.countBadge}>
          <AppText style={styles.countBadgeText}>x {toDisplayCount(row.count)}</AppText>
        </View>
      </View>

      <AppText style={styles.giftName} numberOfLines={1}>
        {row.gift.name}
      </AppText>
      <AppText style={styles.giftMeta}>가격 {toDisplayCount(row.gift.costKernel)} 커널</AppText>

      {canSend ? (
        <Pressable onPress={onPressSend} style={({ pressed }) => [styles.sendBtn, pressed ? styles.sendBtnPressed : null]}>
          <AppText style={styles.sendBtnText}>보내기</AppText>
        </Pressable>
      ) : (
        <View style={styles.lockBadge}>
          <AppText style={styles.lockBadgeText}>받은 선물(보내기 불가)</AppText>
        </View>
      )}
    </View>
  );
}

export default function GiftBoxScreen({ navigation, route }: Props) {
  const mode = route.params?.mode === "send" ? "send" : "view";
  const ownedMap = useAppStore((s: any) => s.shop?.giftsOwned);
  const receivedMap = useAppStore((s: any) => s.shop?.giftsReceived);
  const consumeOwnedGift = useAppStore((s: any) => s.consumeOwnedGift);
  const requestGiftSend = useAppStore((s: any) => s.requestGiftSend);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "내 선물함" });
  }, [navigation]);

  const ownedList = useMemo(() => listFromMap(ownedMap), [ownedMap]);
  const receivedList = useMemo(() => listFromMap(receivedMap), [receivedMap]);

  const ownedTotal = useMemo(() => ownedList.reduce((sum, row) => sum + row.count, 0), [ownedList]);
  const receivedTotal = useMemo(() => receivedList.reduce((sum, row) => sum + row.count, 0), [receivedList]);

  const onSendGift = useCallback(
    (gift: GiftItem) => {
      const ok = typeof consumeOwnedGift === "function" ? consumeOwnedGift(gift.id, 1) : false;
      if (!ok) {
        showGlobalModal?.("내 선물함", "보낼 수 있는 선물이 없습니다.");
        return;
      }
      if (typeof requestGiftSend === "function") {
        requestGiftSend(gift.id);
      }
      showGlobalModal?.("내 선물함", `${gift.name} 선물을 보냈습니다.`);
      navigation.goBack();
    },
    [consumeOwnedGift, navigation, requestGiftSend, showGlobalModal]
  );

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <AppText style={styles.heroTitle}>{mode === "send" ? "통화 중 선물 보내기" : "내 선물함"}</AppText>
          <AppText style={styles.heroDesc}>
            {mode === "send"
              ? "구매한 선물만 전송할 수 있습니다."
              : "구매한 선물과 받은 선물을 카드로 확인할 수 있습니다."}
          </AppText>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText style={styles.sectionTitle}>구매한 선물</AppText>
            <AppText style={styles.sectionCount}>총 {toDisplayCount(ownedTotal)}개</AppText>
          </View>
          {ownedList.length === 0 ? (
            <View style={styles.emptyCard}>
              <AppText style={styles.emptyText}>구매한 선물이 없습니다.</AppText>
            </View>
          ) : (
            <View style={styles.grid}>
              {ownedList.map((row) => (
                <Card key={`owned_${row.gift.id}`} row={row} canSend={mode === "send"} onPressSend={() => onSendGift(row.gift)} />
              ))}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <AppText style={styles.sectionTitle}>받은 선물</AppText>
            <AppText style={styles.sectionCount}>총 {toDisplayCount(receivedTotal)}개</AppText>
          </View>
          {receivedList.length === 0 ? (
            <View style={styles.emptyCard}>
              <AppText style={styles.emptyText}>받은 선물이 없습니다.</AppText>
            </View>
          ) : (
            <View style={styles.grid}>
              {receivedList.map((row) => (
                <Card key={`received_${row.gift.id}`} row={row} canSend={false} onPressSend={() => {}} />
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
    backgroundColor: "#0F1629",
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 24,
    gap: 12,
  },
  heroCard: {
    borderWidth: 1,
    borderColor: "rgba(170, 196, 255, 0.35)",
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.04)",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  heroTitle: {
    color: "#ECF5FF",
    fontSize: 15,
    fontWeight: "700",
  },
  heroDesc: {
    color: "rgba(224, 236, 255, 0.82)",
    fontSize: 12,
    lineHeight: 18,
  },
  section: {
    borderWidth: 1,
    borderColor: "rgba(157, 188, 255, 0.28)",
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 10,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#EAF3FF",
    fontSize: 14,
    fontWeight: "700",
  },
  sectionCount: {
    color: "rgba(223, 236, 255, 0.86)",
    fontSize: 12,
    fontWeight: "600",
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(183, 206, 255, 0.24)",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  emptyText: {
    color: "rgba(221, 235, 255, 0.72)",
    fontSize: 13,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 10,
  },
  card: {
    width: "48.4%",
    minHeight: 170,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(183, 206, 255, 0.34)",
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 9,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  artWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.12)",
  },
  artEmoji: {
    fontSize: 24,
  },
  countBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: "rgba(148, 197, 255, 0.25)",
    borderWidth: 1,
    borderColor: "rgba(173, 212, 255, 0.65)",
  },
  countBadgeText: {
    color: "#EAF6FF",
    fontSize: 11,
    fontWeight: "700",
  },
  giftName: {
    color: "#EEF6FF",
    fontSize: 14,
    fontWeight: "700",
  },
  giftMeta: {
    color: "rgba(221, 236, 255, 0.78)",
    fontSize: 11,
    marginTop: 4,
    marginBottom: 10,
  },
  sendBtn: {
    marginTop: "auto",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255, 223, 152, 0.85)",
    backgroundColor: "rgba(255, 198, 73, 0.24)",
    paddingVertical: 7,
    alignItems: "center",
  },
  sendBtnPressed: {
    opacity: 0.75,
  },
  sendBtnText: {
    color: "#FFF2D4",
    fontSize: 12,
    fontWeight: "700",
  },
  lockBadge: {
    marginTop: "auto",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(173, 198, 240, 0.55)",
    backgroundColor: "rgba(173, 198, 240, 0.14)",
    paddingVertical: 7,
    alignItems: "center",
  },
  lockBadgeText: {
    color: "rgba(226, 238, 255, 0.85)",
    fontSize: 11,
    fontWeight: "600",
  },
});
