// FILE: C:\ranchat\src\screens\HomeScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Easing, Pressable, StyleSheet, View, ScrollView, FlatList, ImageBackground, Image, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import Constants from "expo-constants";
import { theme } from "../config/theme";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { BannerBar, createInterstitial, isInterstitialCooldownPassed, recordInterstitialShown } from "../services/ads/AdManager";
import { useAppStore } from "../store/useAppStore";
import { AdEventType } from "react-native-google-mobile-ads";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "../i18n/LanguageProvider";
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageName, normalizeLanguageCode } from "../i18n/displayNames";
import * as Updates from "expo-updates";
import { APP_CONFIG } from "../config/app";
import usePopTalk from "../hooks/usePopTalk";
import { INTERSTITIAL_COOLDOWN_MS } from "../constants/callConfig";
import { POPTALK_MATCH_BLOCK_THRESHOLD, POPTALK_REWARDED_AMOUNT } from "../constants/popTalkConfig";
import { fetchUnifiedWalletState } from "../services/shop/ShopPurchaseService";
import { refreshSubscription } from "../services/purchases/PurchaseManager";
import {
  fetchCallContactsOnServer,
  fetchPendingRecallInviteOnServer,
  respondRecallInviteOnServer,
  setCallFriendOnServer,
  type CallContactItem,
  type PendingRecallInvite,
} from "../services/call/CallContactService";
import { resolveDisplayName } from "../utils/displayName";
import { formatPopTalkCount, isPopTalkUnlimited } from "../utils/poptalkDisplay";

const POPTALK_BALANCE_ICON = require("../../assets/poptalk_ICON.png");
const KERNEL_BALANCE_ICON = require("../../assets/kernel.png");
const HOME_LOGO = require("../../assets/ranchat_logo.png");
const HOME_EMPTY_SAD = require("../../assets/sad.png");
const HOME_WALLET_POLL_INTERVAL_MS = 60000;
const SAVED_CONTACT_CARD_WIDTH = Math.min(320, Math.max(252, Math.round((Dimensions.get("window").width || 360) - 116)));
export default function HomeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const prefs = useAppStore((s: any) => s.prefs);
  const sub = useAppStore((s: any) => s.sub);
  const isPremium = Boolean(sub?.isPremium);
  const auth = useAppStore((s: any) => s.auth);
  const popTalk = useAppStore((s: any) => s.popTalk);
  const assets = useAppStore((s: any) => s.assets);
  const setPopTalk = useAppStore((s: any) => s.setPopTalk);
  const setAssets = useAppStore((s: any) => s.setAssets);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);
  const { refreshPopTalk, watchRewardedAdAndReward } = usePopTalk();

  const [prefsModal, setPrefsModal] = useState(false);
  const [, setActiveUsers] = useState(0);
  const [bannerReady, setBannerReady] = useState(false);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchBlockedModal, setMatchBlockedModal] = useState(false);
  const [rewardAdFailModal, setRewardAdFailModal] = useState(false);
  const [rewardAdFailCount, setRewardAdFailCount] = useState(0);
  const [updateModal, setUpdateModal] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [savedContactsVisible, setSavedContactsVisible] = useState(false);
  const [savedContactsLoading, setSavedContactsLoading] = useState(false);
  const [savedContactsLaunching, setSavedContactsLaunching] = useState(false);
  const [savedContactsDeletingKey, setSavedContactsDeletingKey] = useState("");
  const [savedContacts, setSavedContacts] = useState<CallContactItem[]>([]);
  const [incomingRecallInvite, setIncomingRecallInvite] = useState<PendingRecallInvite | null>(null);
  const [incomingRecallBusy, setIncomingRecallBusy] = useState<"" | "accept" | "decline" | "block">("");

  const interstitialRef = useRef<any>(null);
  const updateCheckedRef = useRef(false);
  const updateCheckInFlightRef = useRef(false);
  const lastUpdateCheckAtRef = useRef(0);
  const updateAutoTriggeredRef = useRef(false);
  const incomingRecallHeartScale = useRef(new Animated.Value(1)).current;
  const incomingRecallHeartGlow = useRef(new Animated.Value(0)).current;

  const onBannerLoaded = useCallback(() => {
    setBannerReady(true);
  }, []);

  const onBannerFailed = useCallback(() => {
    setBannerReady(false);
  }, []);

  const canMatch = useMemo(() => {
    const countryRaw = String(prefs.country || "").trim().toUpperCase();
    const genderRaw = String(prefs.gender || "").trim().toLowerCase();
    const langRaw = normalizeLanguageCode(String(prefs.language || "").trim());
    const countryOk = COUNTRY_CODES.some((code) => code === countryRaw);
    const genderOk = genderRaw === "male" || genderRaw === "female";
    const langOk = LANGUAGE_CODES.some((code) => code === langRaw);
    return countryOk && genderOk && langOk;
  }, [prefs.country, prefs.gender, prefs.language]);

  const goProfile = useCallback(() => {
    navigation.navigate("Profile");
  }, [navigation]);

  const openPrefs = useCallback(() => {
    setPrefsModal(true);
  }, []);

  const goShop = useCallback(() => {
    navigation.navigate("Shop");
  }, [navigation]);

  const goPopTalkShop = useCallback(() => {
    navigation.navigate("Shop", { initialTab: 0 });
  }, [navigation]);

  const goKernelShop = useCallback(() => {
    navigation.navigate("Shop", { initialTab: 1 });
  }, [navigation]);

  const myPopTalkBalanceText = useMemo(() => {
    if (isPopTalkUnlimited(popTalk)) return t("poptalk.unlimited_short");
    return formatPopTalkCount(popTalk?.balance ?? 0);
  }, [popTalk?.balance, popTalk?.cap, popTalk?.plan, t]);

  const popTalkBalanceLine = useMemo(() => {
    if (isPopTalkUnlimited(popTalk)) return t("poptalk.balance_unlimited_label");
    return t("poptalk.balance_label", {
      balance: Number(popTalk?.balance ?? 0),
      cap: Number(popTalk?.cap ?? 0),
    });
  }, [popTalk?.balance, popTalk?.cap, popTalk?.plan, t]);

  const kernelBalance = useMemo(() => {
    return Math.max(0, Math.trunc(Number(assets?.kernelCount ?? 0)));
  }, [assets?.kernelCount]);

  const runtimeLabel = useMemo(() => {
    const expoConfig: any = Constants.expoConfig ?? {};
    const versionCodeRaw =
      Platform.OS === "ios"
        ? expoConfig?.ios?.buildNumber ?? expoConfig?.android?.versionCode ?? expoConfig?.version
        : expoConfig?.android?.versionCode ?? expoConfig?.ios?.buildNumber ?? expoConfig?.version;
    const versionCode = String(versionCodeRaw ?? "").trim() || "0";
    const runtimeRaw = String(Updates.runtimeVersion ?? expoConfig?.version ?? "").trim();
    const runtimeMajor = runtimeRaw
      .split(".")
      .map((part) => part.trim())
      .find((part) => /^\d+$/.test(part)) || "0";
    return `${versionCode}.${runtimeMajor}.0`;
  }, []);

  const formatSavedContactTime = useCallback((value: number) => {
    const ms = Number(value || 0);
    if (!Number.isFinite(ms) || ms <= 0) return "";
    try {
      const d = new Date(ms);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
    } catch {
      return "";
    }
  }, []);

  const getSavedContactName = useCallback(
    (item: CallContactItem) => {
      return resolveDisplayName({
        nickname: item.peerNickname,
        loginAccount: item.peerLoginAccount,
        userId: item.peerUserId,
        profileId: item.peerProfileId,
        contactKey: item.contactKey,
        fallback: t("call.contact.unknown_peer"),
      });
    },
    [t]
  );

  const getSavedContactMeta = useCallback(
    (item: CallContactItem) => {
      const flag = String(item.peerFlag || "").trim();
      const parts: string[] = [];
      const countryCode = String(item.peerCountry || "").trim().toUpperCase();
      const languageCode = normalizeLanguageCode(String(item.peerLanguage || "").trim());
      const genderCode = String(item.peerGender || "").trim().toLowerCase();
      if (countryCode) parts.push(getCountryName(t, countryCode));
      if (languageCode) parts.push(getLanguageName(t, languageCode));
      if (genderCode === "male") parts.push(t("gender.male"));
      if (genderCode === "female") parts.push(t("gender.female"));
      const base = parts.filter(Boolean).join(" / ");
      const info = `${flag ? `${flag} ` : ""}${base}`.trim();
      return info || t("call.contact.unknown_peer");
    },
    [t]
  );

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
    const info = `${flag ? `${flag} ` : ""}${base}`.trim();
    return info || t("call.contact.unknown_peer");
  }, [incomingRecallContact?.peerCountry, incomingRecallContact?.peerFlag, incomingRecallContact?.peerGender, incomingRecallContact?.peerLanguage, incomingRecallInvite?.actorCountry, incomingRecallInvite?.actorFlag, incomingRecallInvite?.actorGender, incomingRecallInvite?.actorLanguage, t]);

  const incomingRecallInterestLabels = useMemo(() => {
    if (!incomingRecallContact) return [];
    return getSavedContactInterestLabels(incomingRecallContact);
  }, [getSavedContactInterestLabels, incomingRecallContact]);

  const getSavedContactStatusText = useCallback(
    (item: CallContactItem) => {
      if (item.isOnline) return t("call.contact.status_online");
      return t("call.contact.status_offline");
    },
    [t]
  );

  const loadSavedContacts = useCallback(
    async (showSpinner = true) => {
      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();
      if (!token || !userId || !deviceKey) {
        setSavedContacts([]);
        showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
        return false;
      }

      if (showSpinner) setSavedContactsLoading(true);
      try {
        const out = await fetchCallContactsOnServer({
          token,
          userId,
          deviceKey,
          limit: 200,
        });
        if (!out.ok) {
          const errCode = String(out.errorCode || "").toUpperCase();
          if (errCode === "CALL_CONTACT_LIST_ROUTE_NOT_FOUND") {
            showGlobalModal(t("call.contact.title"), t("call.contact.route_missing"));
          } else {
            showGlobalModal(t("call.contact.title"), out.errorMessage || out.errorCode || t("common.error_occurred"));
          }
          return false;
        }
        setSavedContacts(out.contacts.filter((item) => item.isFriend));
        return true;
      } finally {
        if (showSpinner) setSavedContactsLoading(false);
      }
    },
    [auth?.deviceKey, auth?.token, auth?.userId, showGlobalModal, t]
  );

  const refreshSavedContactsSilently = useCallback(async () => {
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) return;

    const out = await fetchCallContactsOnServer({
      token,
      userId,
      deviceKey,
      limit: 200,
    }).catch(() => null);
    if (!out?.ok) return;
    setSavedContacts(out.contacts.filter((item) => item.isFriend));
  }, [auth?.deviceKey, auth?.token, auth?.userId]);

  const openSavedContacts = useCallback(() => {
    setSavedContactsVisible(true);
    void loadSavedContacts(true);
  }, [loadSavedContacts]);

  useEffect(() => {
    void refreshSavedContactsSilently();
  }, [refreshSavedContactsSilently]);

  useEffect(() => {
    if (!incomingRecallInvite || incomingRecallContact) return;
    void refreshSavedContactsSilently();
  }, [incomingRecallContact, incomingRecallInvite, refreshSavedContactsSilently]);

  useEffect(() => {
    incomingRecallHeartScale.setValue(1);
    incomingRecallHeartGlow.setValue(0);
  }, [incomingRecallHeartGlow, incomingRecallHeartScale, incomingRecallInvite?.inviteId]);

  const onPressSavedContactRecall = useCallback(
    (item: CallContactItem) => {
      if (savedContactsLaunching || savedContactsDeletingKey) return;
      const recallEnabled = Boolean(item.canRecall || item.isOnline);
      if (!recallEnabled) {
        showGlobalModal(t("call.contact.title"), t("call.contact.recall_unavailable"));
        return;
      }
      const peerSessionId = String(item.peerSessionId || "").trim();
      const peerProfileId = String(item.peerProfileId || "").trim();
      if (!peerSessionId && !peerProfileId) {
        showGlobalModal(t("call.contact.title"), t("call.contact.recall_unavailable"));
        return;
      }
      setSavedContactsLaunching(true);
      setSavedContactsVisible(false);
      navigation.navigate("Call", {
        entryMode: "contactRecall",
        recallPeerSessionId: peerSessionId || undefined,
        recallPeerProfileId: peerProfileId || undefined,
      });
      requestAnimationFrame(() => {
        setSavedContactsLaunching(false);
      });
    },
    [navigation, savedContactsDeletingKey, savedContactsLaunching, showGlobalModal, t]
  );

  const onPressDeleteSavedContact = useCallback(
    async (item: CallContactItem) => {
      if (savedContactsLaunching) return;
      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();
      const targetKey = String(item.contactKey || item.peerSessionId || item.peerProfileId || "").trim();
      const peerSessionId = String(item.peerSessionId || "").trim();
      const peerProfileId = String(item.peerProfileId || "").trim();
      if (!token || !userId || !deviceKey) {
        showGlobalModal(t("call.contact.title"), t("common.auth_expired"));
        return;
      }
      if (!targetKey || (!peerSessionId && !peerProfileId)) {
        showGlobalModal(t("call.contact.title"), t("call.contact.remove_failed"));
        return;
      }

      setSavedContactsDeletingKey(targetKey);
      try {
        const out = await setCallFriendOnServer({
          token,
          userId,
          deviceKey,
          roomId: undefined,
          peerSessionId: peerSessionId || undefined,
          peerProfileId: peerProfileId || undefined,
          peerUserId: String(item.peerUserId || "").trim() || undefined,
          enabled: false,
        });
        if (!out.ok) {
          showGlobalModal(t("call.contact.title"), out.errorMessage || out.errorCode || t("call.contact.remove_failed"));
          return;
        }
        setSavedContacts((prev) =>
          prev.filter((row) => {
            const rowKey = String(row.contactKey || row.peerSessionId || row.peerProfileId || "").trim();
            return rowKey !== targetKey;
          })
        );
      } finally {
        setSavedContactsDeletingKey("");
      }
    },
    [auth?.deviceKey, auth?.token, auth?.userId, savedContactsLaunching, showGlobalModal, t]
  );

  const onDeclineIncomingRecall = useCallback(async (blockFuture = false) => {
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
  }, [auth?.deviceKey, auth?.token, auth?.userId, incomingRecallBusy, incomingRecallInvite, showGlobalModal, t]);

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
      setSavedContactsVisible(false);
      navigation.navigate("Call", {
        entryMode: "contactRecallAccept",
        recallInviteId: inviteId,
      });
    });
  }, [incomingRecallBusy, incomingRecallHeartGlow, incomingRecallHeartScale, incomingRecallInvite, navigation]);

  useFocusEffect(
    useCallback(() => {
      let closed = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;

      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();
      if (!token || !userId || !deviceKey) {
        setIncomingRecallInvite(null);
        return () => undefined;
      }

      const pollInvite = async () => {
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
    }, [auth?.deviceKey, auth?.token, auth?.userId, incomingRecallBusy])
  );

  const headerLeft = useCallback(() => (
  <Pressable
    hitSlop={12}
    onPressIn={goProfile}
    style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
  >
    <AppText style={styles.headerBtnText}>≡</AppText>
  </Pressable>
), [goProfile]);

const headerRight = useCallback(() => (
  <View style={styles.headerRightGroup}>
    <View style={styles.walletGroup}>
      <View style={styles.walletChip}>
        <Image source={POPTALK_BALANCE_ICON} style={styles.walletIcon} resizeMode="contain" />
        <Pressable
          hitSlop={10}
          onPressIn={goPopTalkShop}
          style={({ pressed }) => [styles.walletValuePressable, pressed ? { opacity: 0.65 } : null]}
        >
          <AppText style={[styles.walletValue, styles.walletValueLink]}>{myPopTalkBalanceText}</AppText>
        </Pressable>
      </View>
      <View style={styles.walletChip}>
        <Image source={KERNEL_BALANCE_ICON} style={styles.walletIcon} resizeMode="contain" />
        <Pressable
          hitSlop={10}
          onPressIn={goKernelShop}
          style={({ pressed }) => [styles.walletValuePressable, pressed ? { opacity: 0.65 } : null]}
        >
          <AppText style={[styles.walletValue, styles.walletValueLink]}>{kernelBalance.toLocaleString("ko-KR")}</AppText>
        </Pressable>
      </View>
    </View>
    <Pressable
      hitSlop={12}
      onPressIn={goShop}
      style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
    >
      <Ionicons name="cart-outline" size={22} color={theme.colors.text} />
    </Pressable>
    <Pressable
      hitSlop={12}
      onPressIn={openSavedContacts}
      style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
    >
      <Ionicons name="people-outline" size={22} color={theme.colors.text} />
    </Pressable>
    <Pressable
      hitSlop={12}
      onPressIn={openPrefs}
      style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
    >
      <Ionicons name="settings-outline" size={22} color={theme.colors.text} />
    </Pressable>
  </View>
), [goKernelShop, goPopTalkShop, goShop, kernelBalance, myPopTalkBalanceText, openPrefs, openSavedContacts]);

useLayoutEffect(() => {
  navigation.setOptions({
    headerTitle: "",
    headerTransparent: true,
    headerStyle: { backgroundColor: "transparent" },
    headerShadowVisible: false,
    headerLeft,
    headerRight,
  });
}, [navigation, headerLeft, headerRight]);

  const checkUpdateAvailability = useCallback(
    async (opts?: { force?: boolean }) => {
      if (__DEV__) return false;
      if (!Updates.isEnabled) return false;
      if (updateCheckInFlightRef.current) return false;

      const force = opts?.force === true;
      const nowMs = Date.now();
      if (!force && nowMs - Number(lastUpdateCheckAtRef.current || 0) < 15000) {
        return false;
      }

      updateCheckInFlightRef.current = true;
      lastUpdateCheckAtRef.current = nowMs;
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable) setUpdateModal(true);
        return Boolean(r.isAvailable);
      } catch {
        return false;
      } finally {
        updateCheckInFlightRef.current = false;
      }
    },
    []
  );

  useEffect(() => {
    if (updateCheckedRef.current) return;
    updateCheckedRef.current = true;
    checkUpdateAvailability({ force: true }).catch(() => undefined);
  }, [checkUpdateAvailability]);

  useFocusEffect(
    useCallback(() => {
      checkUpdateAvailability({ force: false }).catch(() => undefined);
      return () => undefined;
    }, [checkUpdateAvailability])
  );

useEffect(() => {
  const fetchActiveUsers = async () => {
    try {
      const base = String(APP_CONFIG.AUTH_HTTP_BASE_URL || "").replace(/\/+$/, "");
      const path = String((APP_CONFIG as any)?.ACTIVE_USERS_PATH || "/api/active-users");
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const separator = normalizedPath.includes("?") ? "&" : "?";
      const res = await fetch(`${base}${normalizedPath}${separator}ts=${Date.now()}`, {
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      const data = await res.json();
      const candidates = [
        data?.eligibleActiveUsers,
        data?.activeUsers,
        data?.wsClients,
        data?.registeredSessions,
        data?.queuedUsers,
        data?.loginPresenceActive,
        data?.connectedTotal,
        data?.activeTotal,
      ]
        .map((v) => Number(v))
        .filter((v) => Number.isFinite(v) && v >= 0);
      const activeCount = candidates.length ? Math.trunc(Math.max(...candidates)) : 0;
      setActiveUsers(activeCount);
    } catch (error) {
      setActiveUsers(0);
    }
  };

  fetchActiveUsers();
  const interval = setInterval(fetchActiveUsers, 4000);
  return () => clearInterval(interval);
}, []);

  const applyUnifiedState = useCallback(
    (out: {
      popTalkBalance: number;
      popTalkCap: number;
      popTalkPlan: string | null;
      popTalkServerNowMs: number | null;
      walletKernel: number;
    }) => {
      const balance = Math.max(0, Math.trunc(Number(out.popTalkBalance ?? 0)));
      const cap = Math.max(balance, Math.max(0, Math.trunc(Number(out.popTalkCap ?? 0))));
      setPopTalk({
        balance,
        cap,
        plan: out.popTalkPlan || null,
        serverNowMs: out.popTalkServerNowMs ?? null,
        syncedAtMs: Date.now(),
      });
      setAssets({
        kernelCount: Number(out.walletKernel ?? 0),
        updatedAtMs: Date.now(),
      });
    },
    [setAssets, setPopTalk]
  );

  useFocusEffect(
    useCallback(() => {
      let closed = false;
      let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let ws: WebSocket | null = null;
      let reconnectAttempt = 0;

      const token = String(auth?.token || "").trim();
      const userId = String(auth?.userId || "").trim();
      const deviceKey = String(auth?.deviceKey || "").trim();

      const readSubscriptionState = () => {
        const subState = (useAppStore.getState() as any)?.sub || {};
        const premiumExpiresRaw = Number(subState.premiumExpiresAtMs);
        return {
          planId: String(subState.planId || "").trim(),
          storeProductId: String(subState.storeProductId || "").trim(),
          isPremium: Boolean(subState.isPremium),
          premiumExpiresAtMs: Number.isFinite(premiumExpiresRaw) && premiumExpiresRaw > 0 ? Math.trunc(premiumExpiresRaw) : null,
        };
      };

      const syncNow = async () => {
        if (!token || !userId || closed) return;
        await refreshSubscription().catch(() => undefined);
        if (closed) return;
        const subscriptionState = readSubscriptionState();
        const out = await fetchUnifiedWalletState({
          token,
          userId,
          deviceKey,
          planId: subscriptionState.planId,
          storeProductId: subscriptionState.storeProductId,
          isPremium: subscriptionState.isPremium,
          premiumExpiresAtMs: subscriptionState.premiumExpiresAtMs,
        });
        if (!closed && out.ok) {
          applyUnifiedState(out);
        }
      };

      const closeSocket = () => {
        if (ws) {
          try {
            ws.close();
          } catch {}
          ws = null;
        }
      };

      const scheduleReconnect = () => {
        if (closed || reconnectTimer) return;
        const waitMs = Math.min(15000, 1000 * Math.max(1, reconnectAttempt + 1));
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (closed) return;
          reconnectAttempt += 1;
          openSocket();
        }, waitMs);
      };

      const openSocket = () => {
        if (closed || !token || !userId) return;
        closeSocket();
        try {
          ws = new WebSocket(String(APP_CONFIG.SIGNALING_URL || ""));
        } catch {
          scheduleReconnect();
          return;
        }

        ws.onopen = () => {
          if (!ws || closed) return;
          reconnectAttempt = 0;
          const subscriptionState = readSubscriptionState();
          try {
            ws.send(
              JSON.stringify({
                type: "wallet_subscribe",
                token,
                userId,
                deviceKey,
                planId: subscriptionState.planId,
                storeProductId: subscriptionState.storeProductId,
                isPremium: subscriptionState.isPremium,
                premiumExpiresAtMs: subscriptionState.premiumExpiresAtMs,
              })
            );
          } catch {}
        };

        ws.onmessage = (ev: any) => {
          if (closed) return;
          try {
            const msg = JSON.parse(String(ev?.data || "{}"));
            const type = String(msg?.type || "").trim();
            if (type !== "wallet_state") return;
            const data = msg?.data || {};
            const wallet = data?.wallet || {};
            const popTalkPush =
              (data?.popTalk && typeof data?.popTalk === "object" ? data.popTalk : null) ||
              (data?.poptalk && typeof data?.poptalk === "object" ? data.poptalk : null);
            const popTalkBalanceRaw = popTalkPush?.balance ?? data?.popTalkBalance ?? data?.poptalkBalance;
            const hasPopTalkPush = popTalkPush != null || popTalkBalanceRaw != null;
            if (hasPopTalkPush) {
              const bal = Number(popTalkBalanceRaw ?? 0);
              const cap = Number(popTalkPush?.cap ?? data?.popTalkCap ?? data?.poptalkCap ?? bal);
              const serverNowRaw = popTalkPush?.serverNowMs ?? popTalkPush?.serverNow ?? data?.popTalkServerNowMs;
              applyUnifiedState({
                popTalkBalance: bal,
                popTalkCap: cap,
                popTalkPlan: String(popTalkPush?.plan ?? data?.popTalkPlan ?? "") || null,
                popTalkServerNowMs: Number.isFinite(Number(serverNowRaw)) ? Number(serverNowRaw) : null,
                walletKernel: Number(wallet?.kernelBalance ?? 0),
              });
            } else {
              // Do not treat shop wallet values as call-consumable poptalk.
              setAssets({
                kernelCount: Number(wallet?.kernelBalance ?? 0),
                updatedAtMs: Date.now(),
              });
            }
          } catch {}
        };

        ws.onerror = () => {
          scheduleReconnect();
        };

        ws.onclose = () => {
          scheduleReconnect();
        };
      };

      // 홈 진입(뒤로가기 포함) 즉시 1회 동기화
      syncNow().catch(() => undefined);
      // 폴링은 60초
      pollTimer = setInterval(() => {
        syncNow().catch(() => undefined);
      }, HOME_WALLET_POLL_INTERVAL_MS);
      // 실시간 푸시
      openSocket();

      return () => {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        closeSocket();
      };
    }, [applyUnifiedState, auth?.deviceKey, auth?.token, auth?.userId, setAssets, sub?.isPremium, sub?.planId, sub?.premiumExpiresAtMs, sub?.storeProductId])
  );

  const isoToFlag = useCallback((iso: string) => {
    const cc = String(iso || "").toUpperCase();
    if (cc.length !== 2) return "";
    const A = 0x1f1e6;
    const c1 = cc.charCodeAt(0);
    const c2 = cc.charCodeAt(1);
    if (c1 < 65 || c1 > 90 || c2 < 65 || c2 > 90) return "";
    return String.fromCodePoint(A + (c1 - 65), A + (c2 - 65));
  }, []);

  const goCall = useCallback(() => {
    navigation.navigate("Call");
  }, [navigation]);

  const setLanguage = useCallback((lang: string) => {
    const st: any = useAppStore.getState?.() ?? {};
    const setPrefs = st.setPrefs;
    const setPref = st.setPref;
    const setPrefsField = st.setPrefsField;

    if (typeof setPrefs === "function") setPrefs({ language: lang });
    else if (typeof setPref === "function") setPref("language", lang);
    else if (typeof setPrefsField === "function") setPrefsField("language", lang);
    else showGlobalModal(t("setting.title"), t("setting.language_save_error"));
  }, [showGlobalModal, t]);

  const setCountry = useCallback((iso: string) => {
    const st: any = useAppStore.getState?.() ?? {};
    const setPrefs = st.setPrefs;
    const setPref = st.setPref;
    const setPrefsField = st.setPrefsField;

    if (typeof setPrefs === "function") setPrefs({ country: iso });
    else if (typeof setPref === "function") setPref("country", iso);
    else if (typeof setPrefsField === "function") setPrefsField("country", iso);
    else showGlobalModal(t("setting.title"), t("setting.country_save_error"));
  }, [showGlobalModal, t]);

  const setGender = useCallback((gender: string) => {
    const st: any = useAppStore.getState?.() ?? {};
    const setPrefs = st.setPrefs;
    const setPref = st.setPref;
    const setPrefsField = st.setPrefsField;

    if (typeof setPrefs === "function") setPrefs({ gender });
    else if (typeof setPref === "function") setPref("gender", gender);
    else if (typeof setPrefsField === "function") setPrefsField("gender", gender);
    else showGlobalModal(t("setting.title"), t("setting.gender_save_error"));
  }, [showGlobalModal, t]);

  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ key: code, label: getLanguageName(t, code) })),
    [t]
  );

  const countryOptions = useMemo(
    () => COUNTRY_CODES.map((code) => ({ key: code, name: getCountryName(t, code) })),
    [t]
  );

  const genderOptions = useMemo(() => [
    { key: "male", label: t("gender.male") },
    { key: "female", label: t("gender.female") },
  ], [t]);

  const normalizedCountry = useMemo(() => String(prefs.country || "").trim().toUpperCase(), [prefs.country]);
  const normalizedLanguage = useMemo(() => normalizeLanguageCode(String(prefs.language || "").trim()), [prefs.language]);
  const normalizedGender = useMemo(() => String(prefs.gender || "").trim().toLowerCase(), [prefs.gender]);

  const currentLanguageLabel = useMemo(() => {
    const found = languageOptions.find((x) => x.key === normalizedLanguage);
    return found ? found.label : t("common.not_set");
  }, [languageOptions, normalizedLanguage, t]);

  const currentCountryDisplay = useMemo(() => {
    const found = countryOptions.find((x) => x.key === normalizedCountry);
    if (!found) return t("common.not_set");
    const flag = isoToFlag(found.key);
    return `${flag ? flag + " " : ""}${found.name} (${found.key})`;
  }, [countryOptions, isoToFlag, normalizedCountry, t]);

  const currentGenderLabel = useMemo(() => {
    const found = genderOptions.find((x) => x.key === normalizedGender);
    return found ? found.label : t("common.not_set");
  }, [genderOptions, normalizedGender, t]);
  const isCountryUnset = useMemo(
    () => !countryOptions.some((x) => x.key === normalizedCountry),
    [countryOptions, normalizedCountry]
  );
  const isLanguageUnset = useMemo(
    () => !languageOptions.some((x) => x.key === normalizedLanguage),
    [languageOptions, normalizedLanguage]
  );
  const isGenderUnset = useMemo(
    () => !genderOptions.some((x) => x.key === normalizedGender),
    [genderOptions, normalizedGender]
  );

  const onPressRewardAd = useCallback(async () => {
    const out = await watchRewardedAdAndReward(POPTALK_REWARDED_AMOUNT, "match_block_rewarded");
    if (out.ok) {
      setRewardAdFailModal(false);
      setRewardAdFailCount(0);
      setMatchBlockedModal(false);
      return;
    }

    setRewardAdFailCount((prev) => {
      const next = prev + 1;
      setRewardAdFailModal(true);
      return next;
    });
  }, [watchRewardedAdAndReward]);

  const doApplyUpdate = useCallback(async () => {
    if (updateBusy) return;
    setUpdateBusy(true);

    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        setUpdateModal(false);
        showGlobalModal(t("modal.update.title"), t("profile.update.already_latest"));
        return;
      }

      const fetched = await Updates.fetchUpdateAsync();
      if (!Boolean((fetched as any)?.isNew)) {
        setUpdateModal(false);
        showGlobalModal(t("modal.update.title"), t("profile.update.already_latest"));
        return;
      }

      await Updates.reloadAsync();
    } catch (e: unknown) {
      const msg =
        typeof e === "string"
          ? e
          : e && typeof e === "object" && "message" in e
          ? String((e as any).message || "UNKNOWN_ERROR")
          : "UNKNOWN_ERROR";
      const lower = msg.toLowerCase();
      if (lower.includes("cannot relaunch without a launched update")) {
        setUpdateModal(false);
        showGlobalModal(t("modal.update.title"), t("profile.update.restart_required"));
        return;
      }
      showGlobalModal(t("modal.update.title"), msg);
    } finally {
      setUpdateBusy(false);
    }
  }, [showGlobalModal, t, updateBusy]);

  useEffect(() => {
    if (!updateModal) {
      updateAutoTriggeredRef.current = false;
      return;
    }
    if (!updateAutoTriggeredRef.current) {
      updateAutoTriggeredRef.current = true;
      doApplyUpdate().catch(() => undefined);
    }
    const timer = setTimeout(() => {
      setUpdateModal(false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [doApplyUpdate, updateModal]);

  const onPressMatch = useCallback(async () => {
    if (matchBusy) return;
    setMatchBusy(true);

    if (!canMatch) {
      setPrefsModal(true);
      setMatchBusy(false);
      return;
    }

    try {
      await refreshPopTalk();
    } catch {}

    const balanceNow = Number((useAppStore.getState() as any)?.popTalk?.balance ?? 0);
    if (balanceNow <= POPTALK_MATCH_BLOCK_THRESHOLD) {
      setRewardAdFailCount(0);
      setRewardAdFailModal(false);
      setMatchBlockedModal(true);
      setMatchBusy(false);
      return;
    }

    if (isPremium) {
      goCall();
      setMatchBusy(false);
      return;
    }

    if (!isInterstitialCooldownPassed(INTERSTITIAL_COOLDOWN_MS, Date.now())) {
      goCall();
      setMatchBusy(false);
      return;
    }

    const ad = createInterstitial();
    interstitialRef.current = ad;

    let done = false;
    const runOnce = () => {
      if (done) return;
      done = true;
      setMatchBusy(false);
      goCall();
    };

    let unsubClosed: any = null;
    let unsubLoaded: any = null;
    let unsubError: any = null;

    const cleanup = () => {
      try { unsubClosed?.(); } catch {}
      try { unsubLoaded?.(); } catch {}
      try { unsubError?.(); } catch {}
      unsubClosed = unsubLoaded = unsubError = null;
    };

    unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => { cleanup(); runOnce(); });
    unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
      try {
        ad.show();
        recordInterstitialShown(Date.now());
      } catch {
        cleanup();
        runOnce();
      }
    });
    unsubError = ad.addAdEventListener(AdEventType.ERROR, () => { cleanup(); runOnce(); });

    try { ad.load(); } catch { cleanup(); runOnce(); return; }

    setTimeout(() => { cleanup(); runOnce(); }, 1500);
  }, [canMatch, goCall, isPremium, matchBusy, refreshPopTalk]);

  const bannerBottomPadding = Math.max(insets.bottom, 8);
  const bannerSlotHeight = 56 + bannerBottomPadding;
  const backgroundShiftY = !isPremium && bannerReady ? bannerSlotHeight : 0;
  const bodyTopPadding = Math.max(insets.top + 64, 88);
  const bodyBottomPadding = !isPremium ? bannerSlotHeight + 12 : Math.max(insets.bottom + 16, 24);
  const centerLiftY = Math.max(26, Math.min(42, insets.top + 24));

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <ImageBackground
          source={require("../../assets/back.png")}
          style={[StyleSheet.absoluteFillObject, { transform: [{ translateY: -backgroundShiftY }] }]}
          resizeMode="cover"
        />
      </View>

      <View style={[styles.body, { paddingTop: bodyTopPadding, paddingBottom: bodyBottomPadding }]}>
        <View style={[styles.center, { transform: [{ translateY: -centerLiftY }] }]}>
          <Image source={HOME_LOGO} resizeMode="contain" style={styles.homeLogo} />
          <AppText style={styles.title}>{t("home.title")}</AppText>
          <AppText style={styles.sub}>{t("home.subtitle")}</AppText>

          <View style={styles.matchBtnWrap}>
            <PrimaryButton title={t("home.match_button")} onPress={onPressMatch} disabled={matchBusy} />
          </View>
          <AppText style={styles.runtime}>{`Runtime ${runtimeLabel}`}</AppText>
        </View>
      </View>

      {!isPremium ? (
        <View
          style={[
            styles.banner,
            {
              minHeight: bannerSlotHeight,
              paddingBottom: bannerBottomPadding,
              opacity: bannerReady ? 1 : 0,
            },
          ]}
        >
          <BannerBar onAdLoaded={onBannerLoaded} onAdFailedToLoad={onBannerFailed} />
        </View>
      ) : null}

      {updateModal ? (
        <View pointerEvents="none" style={styles.updateToastLayer}>
          <View style={styles.updateToastBox}>
            <AppText style={styles.updateToastTitle}>New UPDATE</AppText>
            <AppText style={styles.updateToastBody}>자동으로 업데이트 됩니다</AppText>
          </View>
        </View>
      ) : null}

      {/* 설정 모달 */}
      <AppModal
        visible={prefsModal}
        title={t("setting.title")}
        dismissible={true}
        onClose={() => {
          setPrefsModal(false);
          setLangOpen(false);
          setCountryOpen(false);
          setGenderOpen(false);
        }}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("common.close")} onPress={() => setPrefsModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("setting.description")}</AppText>

        {/* 나라 선택 */}
        <View style={styles.sectionTitleRow}>
          <AppText style={[styles.sectionTitle, isCountryUnset ? styles.sectionTitleWarn : null]}>{t("setting.country")}</AppText>
          {isCountryUnset ? (
            <View style={styles.requiredBadge}>
              <AppText style={styles.requiredBadgeText}>{t("common.not_set")}</AppText>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={() => { setCountryOpen((v) => !v); setLangOpen(false); setGenderOpen(false); }}
          style={({ pressed }) => [
            styles.dropdownBtn,
            isCountryUnset ? styles.dropdownBtnWarn : null,
            pressed ? { opacity: 0.8 } : null,
          ]}
        >
          <AppText style={[styles.dropdownBtnText, isCountryUnset ? styles.dropdownBtnTextWarn : null]}>{currentCountryDisplay}</AppText>
          <AppText style={[styles.dropdownChevron, isCountryUnset ? styles.dropdownChevronWarn : null]}>{countryOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {countryOpen && (
          <View style={styles.dropdownListWrap}>
            <ScrollView style={styles.dropdownScroll} contentContainerStyle={styles.dropdownScrollContent} showsVerticalScrollIndicator>
              {countryOptions.map((opt) => {
                const active = String(prefs.country || "").toUpperCase() === opt.key;
                const flag = isoToFlag(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => { setCountry(opt.key); setCountryOpen(false); }}
                    style={({ pressed }) => [styles.dropdownRow, active ? styles.dropdownRowActive : null, pressed ? { opacity: 0.75 } : null]}
                  >
                    <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>
                      {flag ? `${flag} ` : ""}{opt.name}
                    </AppText>
                    <View style={styles.countryRight}>
                      <AppText style={[styles.countryCode, active ? styles.countryCodeActive : null]}>({opt.key})</AppText>
                      {active && <AppText style={styles.dropdownCheck}>✓</AppText>}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* 언어 선택 - 스크롤 리스트로 변경 */}
        <View style={styles.sectionTitleRow}>
          <AppText style={[styles.sectionTitle, isLanguageUnset ? styles.sectionTitleWarn : null]}>{t("setting.language")}</AppText>
          {isLanguageUnset ? (
            <View style={styles.requiredBadge}>
              <AppText style={styles.requiredBadgeText}>{t("common.not_set")}</AppText>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={() => { setLangOpen((v) => !v); setCountryOpen(false); setGenderOpen(false); }}
          style={({ pressed }) => [
            styles.dropdownBtn,
            isLanguageUnset ? styles.dropdownBtnWarn : null,
            pressed ? { opacity: 0.8 } : null,
          ]}
        >
          <AppText style={[styles.dropdownBtnText, isLanguageUnset ? styles.dropdownBtnTextWarn : null]}>{currentLanguageLabel}</AppText>
          <AppText style={[styles.dropdownChevron, isLanguageUnset ? styles.dropdownChevronWarn : null]}>{langOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {langOpen && (
          <View style={styles.dropdownListWrap}>
            <ScrollView style={styles.dropdownScroll} contentContainerStyle={styles.dropdownScrollContent} showsVerticalScrollIndicator>
              {languageOptions.map((opt) => {
                const activeRaw = String(prefs.language || "").trim().toLowerCase();
                const activeLang = activeRaw === "kr" ? "ko" : activeRaw;
                const active = activeLang === opt.key;
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => { setLanguage(opt.key); setLangOpen(false); }}
                    style={({ pressed }) => [styles.dropdownRow, active ? styles.dropdownRowActive : null, pressed ? { opacity: 0.75 } : null]}
                  >
                    <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>{opt.label}</AppText>
                    {active && <AppText style={styles.dropdownCheck}>✓</AppText>}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* 성별 선택 */}
        <View style={styles.sectionTitleRow}>
          <AppText style={[styles.sectionTitle, isGenderUnset ? styles.sectionTitleWarn : null]}>{t("setting.gender")}</AppText>
          {isGenderUnset ? (
            <View style={styles.requiredBadge}>
              <AppText style={styles.requiredBadgeText}>{t("common.not_set")}</AppText>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={() => { setGenderOpen((v) => !v); setCountryOpen(false); setLangOpen(false); }}
          style={({ pressed }) => [
            styles.dropdownBtn,
            isGenderUnset ? styles.dropdownBtnWarn : null,
            pressed ? { opacity: 0.8 } : null,
          ]}
        >
          <AppText style={[styles.dropdownBtnText, isGenderUnset ? styles.dropdownBtnTextWarn : null]}>{currentGenderLabel}</AppText>
          <AppText style={[styles.dropdownChevron, isGenderUnset ? styles.dropdownChevronWarn : null]}>{genderOpen ? "▲" : "▼"}</AppText>
        </Pressable>
        {isGenderUnset ? <AppText style={styles.genderUnsetHint}>{t("home.gender_required_hint")}</AppText> : null}

        {genderOpen && (
          <View style={styles.dropdownList}>
            {genderOptions.map((opt) => {
              const active = String(prefs.gender || "") === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => { setGender(opt.key); setGenderOpen(false); }}
                  style={({ pressed }) => [styles.dropdownRow, active ? styles.dropdownRowActive : null, pressed ? { opacity: 0.75 } : null]}
                >
                  <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>{opt.label}</AppText>
                  {active && <AppText style={styles.dropdownCheck}>✓</AppText>}
                </Pressable>
              );
            })}
          </View>
        )}

        <AppText style={styles.sectionTitle}>{t("setting.font_size")}</AppText>
        <AppText style={styles.modalText}>{t("setting.font_size_desc", { percent: Math.round(fontScale * 100) })}</AppText>
        <FontSizeSlider value={fontScale} onChange={setFontScale} />
      </AppModal>

      <AppModal
        visible={matchBlockedModal}
        title={t("poptalk.match_block_title")}
        dismissible={false}
        onClose={() => setMatchBlockedModal(false)}
        footer={
          <View style={{ gap: 10 }}>
              <PrimaryButton title={t("poptalk.charge")} onPress={() => {
                setMatchBlockedModal(false);
                navigation.navigate("Shop");
              }} />
            <PrimaryButton title={t("poptalk.watch_ad")} onPress={onPressRewardAd} />
            <PrimaryButton title={t("poptalk.wait_recharge")} variant="ghost" onPress={() => setMatchBlockedModal(false)} />
          </View>
        }
      >
        <AppText style={styles.modalText}>
          {t("poptalk.match_block_desc", { min: POPTALK_MATCH_BLOCK_THRESHOLD })}
          {"\n"}
          {popTalkBalanceLine}
        </AppText>
      </AppModal>

      <AppModal
        visible={rewardAdFailModal}
        title={rewardAdFailCount >= 3 ? t("poptalk.ad_fail_title") : t("poptalk.ad_loading_title")}
        dismissible={false}
        onClose={() => setRewardAdFailModal(false)}
        footer={
          rewardAdFailCount >= 3 ? (
            <View style={{ gap: 10 }}>
              <PrimaryButton title={t("poptalk.charge")} onPress={() => {
                setRewardAdFailModal(false);
                setMatchBlockedModal(false);
                navigation.navigate("Shop");
              }} />
              <PrimaryButton title={t("common.close")} variant="ghost" onPress={() => setRewardAdFailModal(false)} />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <PrimaryButton title={t("poptalk.retry_ad")} onPress={onPressRewardAd} />
              <PrimaryButton title={t("common.close")} variant="ghost" onPress={() => setRewardAdFailModal(false)} />
            </View>
          )
        }
      >
        <AppText style={styles.modalText}>
          {rewardAdFailCount >= 3 ? t("poptalk.ad_fail_desc") : t("poptalk.ad_loading_desc")}
        </AppText>
      </AppModal>

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
              <View style={styles.savedContactInterestRow}>
                {incomingRecallInterestLabels.map((label) => (
                  <View key={`incoming_${label}`} style={styles.savedContactInterestChip}>
                    <AppText style={styles.savedContactInterestText} numberOfLines={2} ellipsizeMode="tail">
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

      <AppModal
        visible={savedContactsVisible}
        dismissible={!savedContactsLaunching}
        onClose={() => {
          if (savedContactsLaunching) return;
          setSavedContactsVisible(false);
        }}
      >
        <View style={styles.savedContactsHeader}>
          <Pressable
            hitSlop={10}
            disabled={savedContactsLaunching}
            onPress={() => setSavedContactsVisible(false)}
            style={({ pressed }) => [
              styles.savedContactsCloseBadge,
              savedContactsLaunching ? { opacity: 0.45 } : null,
              pressed ? { opacity: 0.74 } : null,
            ]}
          >
            <Ionicons name="close" size={13} color="#7F3552" />
            <AppText style={styles.savedContactsCloseBadgeText}>{t("common.close")}</AppText>
          </Pressable>
          <AppText style={styles.savedContactsHeaderTitle}>친구 목록</AppText>
          <View style={styles.savedContactsHeaderSpacer} />
        </View>
        {savedContactsLoading ? <AppText style={styles.modalText}>{t("common.loading")}</AppText> : null}
        {!savedContactsLoading && savedContacts.length <= 0 ? (
          <View style={styles.savedContactsEmptyWrap}>
            <Image source={HOME_EMPTY_SAD} style={styles.savedContactsEmptyImage} resizeMode="contain" />
            <AppText style={styles.savedContactsEmptyTitle}>친구가 한명도 없어요~</AppText>
            <AppText style={styles.savedContactsEmptyText}>친구를 추가해보세요</AppText>
          </View>
        ) : null}
        {savedContacts.length > 0 ? (
          <FlatList
            data={savedContacts}
            keyExtractor={(item) => String(item.contactKey || item.peerSessionId || item.peerProfileId || item.peerUserId || "contact")}
            horizontal
            style={styles.savedContactsScroll}
            contentContainerStyle={[styles.savedContactsList, savedContacts.length === 1 ? styles.savedContactsListSingle : null]}
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled={false}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={16}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum
            snapToInterval={SAVED_CONTACT_CARD_WIDTH + 14}
            ItemSeparatorComponent={() => <View style={styles.savedContactSpacer} />}
            renderItem={({ item }) => {
              const displayName = getSavedContactName(item);
              const avatarUrl = String(item.peerAvatarUrl || "").trim();
              const lastCallLabel = formatSavedContactTime(item.lastCallAtMs);
              const interestLabels = getSavedContactInterestLabels(item);
              const isOnline = Boolean(item.isOnline);
              const statusText = getSavedContactStatusText(item);
              const statusStyle = isOnline ? styles.savedContactStatusOnline : styles.savedContactStatusOffline;
              const recallEnabled = Boolean(item.canRecall || item.isOnline);
              return (
                <View key={item.contactKey || item.peerSessionId || item.peerProfileId} style={styles.savedContactCard}>
                  <View style={styles.savedContactHeroRow}>
                    <View style={styles.savedContactAvatarFallback}>
                      {avatarUrl ? (
                        <Image source={{ uri: avatarUrl }} style={styles.savedContactAvatarImage} />
                      ) : (
                        <Ionicons name="person" size={28} color="#B25278" />
                      )}
                    </View>
                    <View style={styles.savedContactTextWrap}>
                      <View style={styles.savedContactTitleRow}>
                        <AppText style={styles.savedContactTitle} numberOfLines={1}>
                          {displayName}
                        </AppText>
                        {item.isMutualFriend ? (
                          <View style={styles.savedContactMutualBadge}>
                            <Ionicons name="swap-horizontal" size={12} color="#5B4AA2" />
                          </View>
                        ) : null}
                        <View
                          style={[
                            styles.savedContactStatusChip,
                            isOnline ? styles.savedContactStatusChipOnline : null,
                          ]}
                        >
                          <AppText style={[styles.savedContactStatusChipText, statusStyle]}>{statusText}</AppText>
                        </View>
                      </View>
                      <AppText style={styles.savedContactMeta} numberOfLines={1}>
                        {getSavedContactMeta(item)}
                      </AppText>
                      {interestLabels.length > 0 ? (
                        <View style={styles.savedContactInterestRow}>
                          {interestLabels.map((label) => (
                            <View key={`${item.contactKey}_${label}`} style={styles.savedContactInterestChip}>
                              <AppText style={styles.savedContactInterestText} numberOfLines={2} ellipsizeMode="tail">
                                {label}
                              </AppText>
                            </View>
                          ))}
                        </View>
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.savedContactInfoPanel}>
                    <View style={styles.savedContactInfoTextWrap}>
                      <AppText style={styles.savedContactInfoLabel} numberOfLines={1}>
                        {lastCallLabel ? t("call.contact.last_call_at", { time: lastCallLabel }) : "최근 통화 기록이 아직 없어요"}
                      </AppText>
                    </View>
                    <Pressable
                      hitSlop={10}
                      disabled={Boolean(savedContactsDeletingKey)}
                      onPress={() => {
                        void onPressDeleteSavedContact(item);
                      }}
                      style={({ pressed }) => [
                        styles.savedContactDeleteBtn,
                        savedContactsDeletingKey && savedContactsDeletingKey === String(item.contactKey || item.peerSessionId || item.peerProfileId || "").trim()
                          ? { opacity: 0.45 }
                          : null,
                        pressed ? { opacity: 0.72 } : null,
                      ]}
                    >
                      <Ionicons name="trash-outline" size={16} color="#C24164" />
                    </Pressable>
                  </View>

                  <View style={styles.savedContactActionWrap}>
                    <PrimaryButton
                      title={recallEnabled ? t("call.contact.recall") : t("call.contact.recall_unavailable")}
                      variant={recallEnabled ? "primary" : "ghost"}
                      style={styles.savedContactActionBtn}
                      textStyle={styles.savedContactActionBtnText}
                      disabled={!recallEnabled || savedContactsLaunching || Boolean(savedContactsDeletingKey)}
                      onPress={() => onPressSavedContactRecall(item)}
                    />
                  </View>
                </View>
              );
            }}
          />
        ) : null}
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  body: { flex: 1, paddingHorizontal: theme.spacing.lg },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    width: "100%",
  },
  homeLogo: {
    width: 80,
    height: 80,
    marginTop: -8,
    marginBottom: 10,
    transform: [{ translateY: -14 }],
  },
  title: { fontSize: 26, fontWeight: "700", color: theme.colors.text, textAlign: "center" },
  sub: { fontSize: 14, color: theme.colors.sub, textAlign: "center", lineHeight: 20, maxWidth: 460 },
  runtime: { fontSize: 12, color: theme.colors.sub, textAlign: "center", lineHeight: 18, opacity: 0.6, marginTop: 4 },
  matchBtnWrap: { width: "100%", maxWidth: 420 },
  updateToastLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  updateToastBox: {
    minWidth: 220,
    maxWidth: 320,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 16,
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(74, 26, 92, 0.78)",
    borderWidth: 1,
    borderColor: "rgba(255, 164, 214, 0.22)",
  },
  updateToastTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.3,
    textAlign: "center",
  },
  updateToastBody: {
    fontSize: 13,
    fontWeight: "500",
    color: "rgba(255,255,255,0.9)",
    textAlign: "center",
    lineHeight: 18,
  },

  banner: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    alignItems: "center",
  },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  headerBtnText: { fontSize: 22, color: theme.colors.text, fontWeight: "700" },
  headerRightGroup: { flexDirection: "row", alignItems: "center", marginRight: 2 },
  walletGroup: { flexDirection: "row", alignItems: "center", gap: 6, marginRight: 2 },
  walletChip: {
    height: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: "rgba(14,22,38,0.5)",
    borderRadius: 999,
    paddingHorizontal: 8,
  },
  walletIcon: {
    width: 14,
    height: 14,
  },
  walletValue: {
    fontSize: 11,
    fontWeight: "900",
    color: "#FDF2D6",
    minWidth: 24,
  },
  walletValuePressable: {
    minWidth: 24,
    paddingVertical: 1,
  },
  walletValueLink: {
    color: "#FFF2B3",
  },
  savedContactsScroll: {
    maxHeight: 420,
    width: "100%",
    alignSelf: "stretch",
  },
  savedContactsList: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  savedContactsListSingle: {
    flexGrow: 1,
    justifyContent: "center",
  },
  savedContactsHeader: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 10,
  },
  savedContactsCloseBadge: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,228,238,0.96)",
    borderWidth: 1,
    borderColor: "rgba(194,65,100,0.18)",
  },
  savedContactsCloseBadgeText: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "800",
    color: "#7F3552",
    textAlign: "center",
  },
  savedContactsHeaderTitle: {
    flex: 1,
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "900",
    color: "#55263A",
    textAlign: "center",
  },
  savedContactsHeaderSpacer: {
    width: 56,
  },
  savedContactsEmptyWrap: {
    width: "100%",
    minHeight: 240,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(255,244,248,0.96)",
    borderWidth: 1,
    borderColor: "rgba(225,162,190,0.34)",
    paddingHorizontal: 22,
    paddingVertical: 30,
  },
  savedContactsEmptyImage: {
    width: 92,
    height: 92,
    marginBottom: 4,
  },
  savedContactsEmptyTitle: {
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
    color: "#7D415B",
    textAlign: "center",
  },
  savedContactsEmptyText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "700",
    color: "#9A6A7C",
    textAlign: "center",
  },
  savedContactSpacer: {
    width: 14,
  },
  savedContactCard: {
    width: SAVED_CONTACT_CARD_WIDTH,
    alignItems: "stretch",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderRadius: 24,
    backgroundColor: "rgba(255,245,248,0.98)",
    borderWidth: 1,
    borderColor: "rgba(225,162,190,0.44)",
    shadowColor: "#AA4A73",
    shadowOpacity: 0.12,
    shadowOffset: { width: 0, height: 10 },
    shadowRadius: 18,
    elevation: 4,
  },
  savedContactStatusChip: {
    minHeight: 24,
    paddingHorizontal: 10,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(180,64,128,0.10)",
  },
  savedContactStatusChipWaiting: {
    backgroundColor: "rgba(184,50,128,0.12)",
  },
  savedContactStatusChipOnline: {
    backgroundColor: "rgba(176,225,246,0.42)",
  },
  savedContactStatusChipText: {
    fontSize: 11,
    fontWeight: "800",
    lineHeight: 14,
    textAlign: "center",
  },
  savedContactHeroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  savedContactAvatarFallback: {
    width: 68,
    height: 68,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,220,232,0.98)",
    borderWidth: 1,
    borderColor: "rgba(209,114,153,0.18)",
    flexShrink: 0,
  },
  savedContactAvatarImage: {
    width: "100%",
    height: "100%",
  },
  savedContactTextWrap: {
    flex: 1,
    gap: 6,
    minHeight: 72,
    justifyContent: "center",
  },
  savedContactTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    width: "100%",
  },
  savedContactTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "900",
    color: "#55263A",
  },
  savedContactMutualBadge: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(86, 58, 156, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(86, 58, 156, 0.18)",
  },
  savedContactMeta: {
    fontSize: 12,
    color: "#7F5B69",
    lineHeight: 18,
  },
  savedContactInterestRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    columnGap: 6,
    rowGap: 4,
    flexWrap: "wrap",
  },
  savedContactInterestChip: {
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
  savedContactInterestText: {
    fontSize: 11,
    lineHeight: 13,
    fontWeight: "700",
    color: "#5B4AA2",
    textAlign: "center",
  },
  savedContactInfoPanel: {
    minHeight: 44,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.68)",
    borderWidth: 1,
    borderColor: "rgba(225,162,190,0.18)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  savedContactInfoTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  savedContactInfoLabel: {
    fontSize: 12,
    lineHeight: 18,
    color: "#8A6170",
    textAlign: "left",
  },
  savedContactStatusWaiting: {
    color: "#B83280",
  },
  savedContactStatusOnline: {
    color: "#4C8FB3",
  },
  savedContactStatusOffline: {
    color: "#8A6B78",
  },
  savedContactActionWrap: {
    width: "100%",
    alignItems: "stretch",
    justifyContent: "flex-end",
  },
  savedContactActionBtn: {
    width: "100%",
    height: 38,
  },
  savedContactActionBtnText: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: "800",
    textAlign: "center",
  },
  savedContactDeleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(194,65,100,0.08)",
  },
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
    backgroundColor: theme.colors.pinkDeep,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  incomingRecallAcceptText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#FFFFFF",
  },
  incomingRecallHeartText: {
    fontSize: 20,
    fontWeight: "900",
    color: "#FFFFFF",
    lineHeight: 22,
  },

  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },

  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitleWarn: {
    color: theme.colors.pinkDeep,
  },
  requiredBadge: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(233,131,173,0.85)",
    backgroundColor: "rgba(233,131,173,0.18)",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  requiredBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: theme.colors.pinkDeep,
  },

  dropdownBtn: {
    width: "100%",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownBtnWarn: {
    borderColor: "rgba(233,131,173,0.9)",
    backgroundColor: "rgba(233,131,173,0.1)",
  },
  dropdownBtnText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownBtnTextWarn: { color: theme.colors.pinkDeep },
  dropdownChevron: { fontSize: 12, color: theme.colors.sub, fontWeight: "900" },
  dropdownChevronWarn: { color: theme.colors.pinkDeep },
  genderUnsetHint: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
    color: theme.colors.pinkDeep,
  },

  dropdownList: { width: "100%", marginTop: 8, gap: 8 },
  dropdownListWrap: { width: "100%", marginTop: 8, borderRadius: 12, overflow: "hidden" },
  dropdownScroll: { maxHeight: 210 },
  dropdownScrollContent: { gap: 8 },

  dropdownRow: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  dropdownRowActive: { borderColor: theme.colors.pinkDeep, backgroundColor: theme.colors.cardSoft },
  dropdownText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownTextActive: { color: theme.colors.pinkDeep },
  dropdownCheck: { fontSize: 14, color: theme.colors.pinkDeep, fontWeight: "900" },

  countryRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  countryCode: { fontSize: 12, color: theme.colors.sub, fontWeight: "800" },
  countryCodeActive: { color: theme.colors.pinkDeep },
});
