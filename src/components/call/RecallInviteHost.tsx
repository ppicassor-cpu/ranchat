import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { Animated, Easing, Image, Pressable, StyleSheet, View } from "react-native";
import AppModal from "../AppModal";
import PrimaryButton from "../PrimaryButton";
import AppText from "../AppText";
import { useAppStore } from "../../store/useAppStore";
import { useTranslation } from "../../i18n/LanguageProvider";
import {
  fetchCallContactsOnServer,
  fetchPendingRecallInviteOnServer,
  respondRecallInviteOnServer,
  type CallContactItem,
  type PendingRecallInvite,
} from "../../services/call/CallContactService";
import { resolveDisplayName } from "../../utils/displayName";
import { getCountryName, getLanguageName, normalizeLanguageCode } from "../../i18n/displayNames";

type Props = {
  navigationRef: any;
  enabled: boolean;
};

export default function RecallInviteHost({ navigationRef, enabled }: Props) {
  const { t } = useTranslation();
  const auth = useAppStore((s: any) => s.auth);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  const [savedContacts, setSavedContacts] = useState<CallContactItem[]>([]);
  const [incomingRecallInvite, setIncomingRecallInvite] = useState<PendingRecallInvite | null>(null);
  const [incomingRecallBusy, setIncomingRecallBusy] = useState<"" | "accept" | "decline" | "block">("");
  const incomingRecallHeartScale = useRef(new Animated.Value(1)).current;
  const incomingRecallHeartGlow = useRef(new Animated.Value(0)).current;

  const findSavedContactForIncomingRecall = useCallback(
    (invite: PendingRecallInvite | null) => {
      if (!invite) return null;
      const actorProfileId = String(invite.actorProfileId || "").trim();
      const actorSessionId = String(invite.actorSessionId || "").trim();
      const actorLoginAccount = String(invite.actorLoginAccount || "").trim().toLowerCase();
      return (
        savedContacts.find((item) => {
          const peerProfileId = String(item.peerProfileId || "").trim();
          const peerSessionId = String(item.peerSessionId || "").trim();
          const peerLoginAccount = String(item.peerLoginAccount || "").trim().toLowerCase();
          if (actorProfileId && peerProfileId && actorProfileId === peerProfileId) return true;
          if (actorSessionId && peerSessionId && actorSessionId === peerSessionId) return true;
          if (actorLoginAccount && peerLoginAccount && actorLoginAccount === peerLoginAccount) return true;
          return false;
        }) || null
      );
    },
    [savedContacts]
  );

  const incomingRecallContact = useMemo(
    () => findSavedContactForIncomingRecall(incomingRecallInvite),
    [findSavedContactForIncomingRecall, incomingRecallInvite]
  );

  const incomingRecallName = useMemo(() => {
    return resolveDisplayName({
      nickname: incomingRecallContact?.peerNickname || incomingRecallInvite?.actorNickname,
      loginAccount: incomingRecallContact?.peerLoginAccount || incomingRecallInvite?.actorLoginAccount,
      userId: incomingRecallContact?.peerUserId,
      profileId: incomingRecallContact?.peerProfileId || incomingRecallInvite?.actorProfileId,
      contactKey: incomingRecallContact?.contactKey,
      fallback: t("call.contact.unknown_peer"),
    });
  }, [incomingRecallContact, incomingRecallInvite?.actorLoginAccount, incomingRecallInvite?.actorNickname, incomingRecallInvite?.actorProfileId, t]);

  const incomingRecallAvatarUrl = useMemo(() => {
    const avatarUrl = String(incomingRecallContact?.peerAvatarUrl || incomingRecallInvite?.actorAvatarUrl || "").trim();
    return avatarUrl || null;
  }, [incomingRecallContact?.peerAvatarUrl, incomingRecallInvite?.actorAvatarUrl]);

  const incomingRecallMeta = useMemo(() => {
    const flag = String(incomingRecallContact?.peerFlag || incomingRecallInvite?.actorFlag || "").trim();
    const parts: string[] = [];
    const countryCode = String(incomingRecallContact?.peerCountry || incomingRecallInvite?.actorCountry || "").trim().toUpperCase();
    const languageCode = normalizeLanguageCode(String(incomingRecallContact?.peerLanguage || incomingRecallInvite?.actorLanguage || "").trim());
    const genderCode = String(incomingRecallContact?.peerGender || incomingRecallInvite?.actorGender || "").trim().toLowerCase();
    if (countryCode) parts.push(getCountryName(t, countryCode));
    if (languageCode) parts.push(getLanguageName(t, languageCode));
    if (genderCode === "male") parts.push(t("gender.male"));
    if (genderCode === "female") parts.push(t("gender.female"));
    const base = parts.filter(Boolean).join(" / ");
    return `${flag ? `${flag} ` : ""}${base}`.trim();
  }, [incomingRecallContact?.peerCountry, incomingRecallContact?.peerFlag, incomingRecallContact?.peerGender, incomingRecallContact?.peerLanguage, incomingRecallInvite?.actorCountry, incomingRecallInvite?.actorFlag, incomingRecallInvite?.actorGender, incomingRecallInvite?.actorLanguage, t]);

  const getSavedContactInterestLabels = useCallback(
    (item: CallContactItem) => {
      return (Array.isArray(item.peerInterests) ? item.peerInterests : [])
        .map((value) => String(value || "").trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 3)
        .map((id) => t(`interest.${id}`))
        .filter((label) => Boolean(label) && !String(label).startsWith("interest."));
    },
    [t]
  );

  const incomingRecallInterestLabels = useMemo(() => {
    if (!incomingRecallContact) return [];
    return getSavedContactInterestLabels(incomingRecallContact);
  }, [getSavedContactInterestLabels, incomingRecallContact]);

  const refreshSavedContactsSilently = useCallback(async () => {
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      setSavedContacts([]);
      return;
    }

    const out = await fetchCallContactsOnServer({
      token,
      userId,
      deviceKey,
      limit: 200,
    }).catch(() => null);
    if (!out?.ok) return;
    setSavedContacts(out.contacts.filter((item) => item.isFriend));
  }, [auth?.deviceKey, auth?.token, auth?.userId]);

  const activeRouteName = String(navigationRef.current?.getCurrentRoute?.()?.name || "").trim();

  useEffect(() => {
    incomingRecallHeartScale.setValue(1);
    incomingRecallHeartGlow.setValue(0);
  }, [incomingRecallHeartGlow, incomingRecallHeartScale, incomingRecallInvite?.inviteId]);

  useEffect(() => {
    if (!enabled) {
      setSavedContacts([]);
      return;
    }
    void refreshSavedContactsSilently();
  }, [enabled, refreshSavedContactsSilently]);

  useEffect(() => {
    if (!incomingRecallInvite || incomingRecallContact) return;
    void refreshSavedContactsSilently();
  }, [incomingRecallContact, incomingRecallInvite, refreshSavedContactsSilently]);

  const onDeclineIncomingRecall = useCallback(
    async (blockFuture = false) => {
      if (incomingRecallBusy || !incomingRecallInvite) return;
      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();
      if (!token || !userId || !deviceKey) {
        showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
        return;
      }

      setIncomingRecallBusy(blockFuture ? "block" : "decline");
      try {
        const out = await respondRecallInviteOnServer({
          token,
          userId,
          deviceKey,
          inviteId: incomingRecallInvite.inviteId,
          accept: false,
          blockFuture,
        });
        if (!out.ok) {
          const errCode = String(out.errorCode || "").toUpperCase();
          if (["RECALL_INVITE_NOT_FOUND", "RECALL_INVITE_EXPIRED"].includes(errCode)) {
            showGlobalModal(t("call.contact.title"), t("call.contact.incoming_expired"));
            setIncomingRecallInvite(null);
            return;
          }
          showGlobalModal(t("call.contact.title"), out.errorMessage || out.errorCode || t("call.contact.recall_failed"));
          return;
        }
        setIncomingRecallInvite(null);
        if (blockFuture) {
          showGlobalModal(t("call.contact.title"), t("call.contact.incoming_block_done"));
        }
      } finally {
        setIncomingRecallBusy("");
      }
    },
    [auth?.deviceKey, auth?.token, auth?.userId, incomingRecallBusy, incomingRecallInvite, showGlobalModal, t]
  );

  const onAcceptIncomingRecall = useCallback(() => {
    if (incomingRecallBusy || !incomingRecallInvite) return;
    const inviteId = String(incomingRecallInvite.inviteId || "").trim();
    if (!inviteId) return;

    setIncomingRecallBusy("accept");
    Animated.parallel([
      Animated.timing(incomingRecallHeartGlow, {
        toValue: 1,
        duration: 180,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.timing(incomingRecallHeartScale, {
          toValue: 1.16,
          duration: 140,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(incomingRecallHeartScale, {
          toValue: 1.85,
          duration: 300,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start(() => {
      setIncomingRecallBusy("");
      setIncomingRecallInvite(null);
      navigationRef.current?.navigate?.("Call", {
        entryMode: "contactRecallAccept",
        recallInviteId: inviteId,
      });
    });
  }, [incomingRecallBusy, incomingRecallHeartGlow, incomingRecallHeartScale, incomingRecallInvite, navigationRef]);

  useEffect(() => {
    let closed = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!enabled || !token || !userId || !deviceKey) {
      setIncomingRecallInvite(null);
      return () => undefined;
    }

    const pollInvite = async () => {
      const routeName = String(navigationRef.current?.getCurrentRoute?.()?.name || "").trim();
      if (routeName === "Home" || routeName === "Call") {
        if (!closed) setIncomingRecallInvite(null);
        return;
      }
      if (closed || incomingRecallBusy === "accept") return;
      const out = await fetchPendingRecallInviteOnServer({ token, userId, deviceKey }).catch(() => null);
      if (closed || !out?.ok) return;
      setIncomingRecallInvite((prev) => {
        const nextInvite = out.invite || null;
        if (!nextInvite) return incomingRecallBusy ? prev : null;
        if (incomingRecallBusy && prev?.inviteId === nextInvite.inviteId) return prev;
        return nextInvite;
      });
    };

    void pollInvite();
    pollTimer = setInterval(() => {
      void pollInvite();
    }, 2500);

    return () => {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [auth?.deviceKey, auth?.token, auth?.userId, enabled, incomingRecallBusy, navigationRef]);

  if (!enabled || activeRouteName === "Home" || activeRouteName === "Call") return null;

  return (
    <AppModal
      visible={Boolean(incomingRecallInvite)}
      title={t("call.contact.incoming_title")}
      dismissible={false}
      footer={
        <View style={styles.incomingRecallFooter}>
          <PrimaryButton
            title={t("call.contact.incoming_block")}
            variant="ghost"
            disabled={Boolean(incomingRecallBusy)}
            style={styles.incomingRecallDeclineBtn}
            textStyle={styles.incomingRecallDeclineText}
            onPress={() => {
              void onDeclineIncomingRecall(true);
            }}
          />
          <PrimaryButton
            title={t("call.contact.incoming_decline")}
            variant="ghost"
            disabled={Boolean(incomingRecallBusy)}
            style={styles.incomingRecallDeclineBtn}
            textStyle={styles.incomingRecallDeclineText}
            onPress={() => {
              void onDeclineIncomingRecall(false);
            }}
          />
          <Animated.View
            style={[
              styles.incomingRecallAcceptWrap,
              {
                transform: [{ scale: incomingRecallHeartScale }],
                opacity: incomingRecallBusy === "decline" || incomingRecallBusy === "block" ? 0.55 : 1,
              },
            ]}
          >
            <Animated.View
              pointerEvents="none"
              style={[
                styles.incomingRecallAcceptGlow,
                {
                  opacity: incomingRecallHeartGlow,
                  transform: [
                    {
                      scale: incomingRecallHeartGlow.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.86, 1.34],
                      }),
                    },
                  ],
                },
              ]}
            />
            <Pressable
              disabled={Boolean(incomingRecallBusy)}
              onPress={onAcceptIncomingRecall}
              style={({ pressed }) => [
                styles.incomingRecallAcceptBtn,
                pressed && !incomingRecallBusy ? { opacity: 0.92 } : null,
              ]}
            >
              <AppText style={incomingRecallBusy === "accept" ? styles.incomingRecallHeartText : styles.incomingRecallAcceptText}>
                {incomingRecallBusy === "accept" ? "♥" : t("call.contact.incoming_accept")}
              </AppText>
            </Pressable>
          </Animated.View>
        </View>
      }
    >
      <View style={styles.incomingRecallBody}>
        <View style={styles.incomingRecallBodyRow}>
          <View style={styles.incomingRecallAvatarWrap}>
            {incomingRecallAvatarUrl ? (
              <Image source={{ uri: incomingRecallAvatarUrl }} style={styles.incomingRecallAvatarImage} />
            ) : (
              <View style={styles.incomingRecallAvatarFallback}>
                <Ionicons name="person" size={30} color="#B25278" />
              </View>
            )}
          </View>
          <View style={styles.incomingRecallTextWrap}>
            <View style={styles.incomingRecallTitleRow}>
              <AppText style={styles.incomingRecallCaller} numberOfLines={1}>
                {incomingRecallName}
              </AppText>
              {incomingRecallContact?.isMutualFriend ? (
                <View style={styles.incomingRecallMutualBadge}>
                  <Ionicons name="swap-horizontal" size={12} color="#5B4AA2" />
                </View>
              ) : null}
            </View>
            {incomingRecallMeta ? (
              <AppText style={styles.incomingRecallMeta} numberOfLines={2}>
                {incomingRecallMeta}
              </AppText>
            ) : null}
            {incomingRecallInterestLabels.length > 0 ? (
              <View style={styles.incomingRecallInterestRow}>
                {incomingRecallInterestLabels.map((label) => (
                  <View key={`incoming_${label}`} style={styles.incomingRecallInterestChip}>
                    <AppText style={styles.incomingRecallInterestText} numberOfLines={2} ellipsizeMode="tail">
                      {label}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </View>
    </AppModal>
  );
}

const styles = StyleSheet.create({
  incomingRecallBody: {
    width: "100%",
    alignItems: "stretch",
    paddingVertical: 6,
  },
  incomingRecallBodyRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  incomingRecallAvatarWrap: {
    width: 72,
    height: 72,
    borderRadius: 24,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(209,114,153,0.18)",
    backgroundColor: "rgba(255,220,232,0.98)",
    flexShrink: 0,
  },
  incomingRecallAvatarImage: {
    width: "100%",
    height: "100%",
  },
  incomingRecallAvatarFallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,220,232,0.98)",
  },
  incomingRecallTextWrap: {
    flex: 1,
    alignItems: "flex-start",
    gap: 6,
    minHeight: 72,
    justifyContent: "center",
  },
  incomingRecallTitleRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  incomingRecallCaller: {
    flex: 1,
    fontSize: 19,
    fontWeight: "900",
    color: "#55263A",
    textAlign: "left",
  },
  incomingRecallMutualBadge: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(86, 58, 156, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(86, 58, 156, 0.18)",
  },
  incomingRecallMeta: {
    fontSize: 13,
    lineHeight: 18,
    color: "#7F5B69",
    textAlign: "left",
  },
  incomingRecallInterestRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 6,
    rowGap: 4,
    flexWrap: "wrap",
  },
  incomingRecallInterestChip: {
    maxWidth: "100%",
    minHeight: 22,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(91,74,162,0.09)",
    borderWidth: 1,
    borderColor: "rgba(91,74,162,0.14)",
  },
  incomingRecallInterestText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "700",
    color: "#5B4AA2",
    textAlign: "center",
  },
  incomingRecallFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  incomingRecallDeclineBtn: {
    flex: 1,
    height: 42,
    borderRadius: 16,
  },
  incomingRecallDeclineText: {
    fontSize: 14,
    fontWeight: "700",
  },
  incomingRecallAcceptWrap: {
    flex: 1,
    alignItems: "stretch",
    justifyContent: "center",
  },
  incomingRecallAcceptGlow: {
    position: "absolute",
    inset: -4,
    borderRadius: 22,
    backgroundColor: "rgba(255,120,170,0.22)",
  },
  incomingRecallAcceptBtn: {
    height: 42,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FF6CA3",
    shadowColor: "#FF6CA3",
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 16,
    elevation: 6,
  },
  incomingRecallAcceptText: {
    fontSize: 14,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
  },
  incomingRecallHeartText: {
    fontSize: 20,
    lineHeight: 22,
    fontWeight: "900",
    color: "#FFFFFF",
    textAlign: "center",
  },
});
