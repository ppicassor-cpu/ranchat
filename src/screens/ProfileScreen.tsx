// FILE: C:\ranchat\src\screens\ProfileScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { theme } from "../config/theme";
import { useAppStore } from "../store/useAppStore";
import { refreshSubscription } from "../services/purchases/PurchaseManager";
import { APP_CONFIG } from "../config/app";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useTranslation } from "../i18n/LanguageProvider";
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageAutonym, getLanguageName, normalizeLanguageCode } from "../i18n/displayNames";
import { Ionicons } from "@expo/vector-icons";
import { fetchCallBlockListOnServer, type CallBlockListItem, unblockCallPeersOnServer } from "../services/call/CallBlockListService";
import {
  MATCH_FILTER_ALL,
  createDefaultMatchFilter,
  fetchMatchFilterOnServer,
  normalizeMatchFilter,
  saveMatchFilterOnServer,
  type MatchFilter,
  type MatchFilterGender,
} from "../services/call/MatchFilterService";
import { countryCodeToFlagEmoji } from "../utils/countryUtils";


function toErrMsg(e: unknown) {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message || "UNKNOWN_ERROR");
  return "UNKNOWN_ERROR";
}

function formatBlockedAt(tsMs: number): string {
  const n = Number(tsMs);
  if (!Number.isFinite(n) || n <= 0) return "-";
  const d = new Date(n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function shortSessionId(v: string): string {
  const raw = String(v || "").trim();
  if (!raw) return "-";
  if (raw.length <= 18) return raw;
  return `${raw.slice(0, 9)}...${raw.slice(-6)}`;
}

const SECTION_ICON_COLOR = "#8F97A3";
const SECTION_ICON_SIZE = 18;
const ACTION_ICON_SIZE = 19;

type ProfilePrimaryButtonProps = React.ComponentProps<typeof PrimaryButton>;

function ProfilePrimaryButton({ style, textStyle, ...rest }: ProfilePrimaryButtonProps) {
  return (
    <PrimaryButton
      {...rest}
      style={[styles.profilePrimaryButton, style]}
      textStyle={[styles.profilePrimaryButtonText, textStyle]}
    />
  );
}

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const isScreenFocused = useIsFocused();
  const { t } = useTranslation();

  const prefs = useAppStore((s) => s.prefs);
  const sub = useAppStore((s) => s.sub);
  const auth = useAppStore((s) => s.auth);
  const logoutAndWipe = useAppStore((s) => s.logoutAndWipe);

  const setPrefs = useAppStore((s) => s.setPrefs);
  const showGlobalModal = useAppStore((s) => s.showGlobalModal);

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);

  const [prefsModal, setPrefsModal] = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [logoutModal, setLogoutModal] = useState(false);
  const [policyModal, setPolicyModal] = useState(false);
  const [langModal, setLangModal] = useState(false);
  const [callBlockModal, setCallBlockModal] = useState(false);
  const [callBlockListBusy, setCallBlockListBusy] = useState(false);
  const [callBlockUnblockBusy, setCallBlockUnblockBusy] = useState(false);
  const [callBlockItems, setCallBlockItems] = useState<CallBlockListItem[]>([]);
  const [callBlockSelected, setCallBlockSelected] = useState<string[]>([]);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const [restoreBusy, setRestoreBusy] = useState(false);
  const [matchFilterModalVisible, setMatchFilterModalVisible] = useState(false);
  const [matchFilterUpsellModalVisible, setMatchFilterUpsellModalVisible] = useState(false);
  const [matchFilterLoading, setMatchFilterLoading] = useState(false);
  const [matchFilterSaving, setMatchFilterSaving] = useState(false);
  const [matchFilter, setMatchFilter] = useState<MatchFilter>(createDefaultMatchFilter());
  const [matchFilterDraft, setMatchFilterDraft] = useState<MatchFilter>(createDefaultMatchFilter());

  const countryLabel = useMemo(() => {
    const code = String(prefs.country || "").toUpperCase();
    if (!code) return t("common.hyphen");
    return getCountryName(t, code);
  }, [prefs.country, t]);

  const genderLabel = useMemo(() => {
    const hy = t("common.hyphen");
    if (prefs.gender === "male") return t("gender.male");
    if (prefs.gender === "female") return t("gender.female");
    return hy;
  }, [prefs.gender, t]);

  const languageLabel = useMemo(() => {
    const hy = t("common.hyphen");
    const code = normalizeLanguageCode(String(prefs.language || ""));
    if (!code) return hy;
    return getLanguageName(t, code);
  }, [prefs.language, t]);

  const currentPlanLabel = useMemo(() => {
    if (!sub?.isPremium) return "";

    const pid = String(
      (sub as any)?.productId ??
      (sub as any)?.activeProductId ??
      (sub as any)?.storeProductId ??
      (sub as any)?.sku ??
      (sub as any)?.planId ??
      (sub as any)?.packageId ??
      ""
    ).toLowerCase();

    const key =
      pid.includes("year") ? "yearly" :
      pid.includes("month") ? "monthly" :
      pid.includes("week") ? "weekly" :
      "";

    if (key === "weekly") return t("profile.plan.weekly");
    if (key === "monthly") return t("profile.plan.monthly");
    if (key === "yearly") return t("profile.plan.yearly");

    return t("profile.plan.premium");
  }, [sub, t]);

  const matchFilterCountryOptions = useMemo(
    () => COUNTRY_CODES.map((code) => ({ code, label: `${countryCodeToFlagEmoji(code) || ""} ${getCountryName(t, code)}`.trim() })),
    [t]
  );
  const matchFilterLanguageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ code, label: getLanguageName(t, code) })),
    [t]
  );
  const normalizedMatchFilterDraft = useMemo(() => normalizeMatchFilter(matchFilterDraft), [matchFilterDraft]);

  const applyMatchFilterState = useCallback((next: MatchFilter) => {
    const normalized = normalizeMatchFilter(next);
    setMatchFilter(normalized);
    setMatchFilterDraft(normalized);
  }, []);

  const toggleMatchFilterCountries = useCallback((value: string) => {
    setMatchFilterDraft((prev) => {
      const normalized = normalizeMatchFilter(prev);
      const key = String(value || "").trim().toUpperCase();
      if (!key) return normalized;
      let nextCountries = [...normalized.countries];
      if (key === MATCH_FILTER_ALL) {
        nextCountries = [MATCH_FILTER_ALL];
      } else {
        const withoutAll = nextCountries.filter((v) => v !== MATCH_FILTER_ALL);
        if (withoutAll.includes(key)) {
          const after = withoutAll.filter((v) => v !== key);
          nextCountries = after.length > 0 ? after : [MATCH_FILTER_ALL];
        } else {
          nextCountries = [...withoutAll, key];
        }
      }
      return normalizeMatchFilter({ ...normalized, countries: nextCountries });
    });
  }, []);

  const toggleMatchFilterLanguages = useCallback((value: string) => {
    setMatchFilterDraft((prev) => {
      const normalized = normalizeMatchFilter(prev);
      const key = String(value || "").trim();
      const normalizedCode = key.toUpperCase() === MATCH_FILTER_ALL ? MATCH_FILTER_ALL : normalizeLanguageCode(key);
      if (!normalizedCode) return normalized;
      let nextLanguages = [...normalized.languages];
      if (normalizedCode === MATCH_FILTER_ALL) {
        nextLanguages = [MATCH_FILTER_ALL];
      } else {
        const withoutAll = nextLanguages.filter((v) => v !== MATCH_FILTER_ALL);
        if (withoutAll.includes(normalizedCode)) {
          const after = withoutAll.filter((v) => v !== normalizedCode);
          nextLanguages = after.length > 0 ? after : [MATCH_FILTER_ALL];
        } else {
          nextLanguages = [...withoutAll, normalizedCode];
        }
      }
      return normalizeMatchFilter({ ...normalized, languages: nextLanguages });
    });
  }, []);

  const setMatchFilterGender = useCallback((gender: MatchFilterGender) => {
    setMatchFilterDraft((prev) => normalizeMatchFilter({ ...prev, gender }));
  }, []);

  const formatCountryMatchSummary = useCallback((countriesRaw: string[]) => {
    const anyLabel = String(t("call.match_filter.any_option") || "").replace(/\s*\(ALL\)\s*/gi, "").trim();
    const countries = normalizeMatchFilter({ countries: countriesRaw }).countries;
    if (countries.includes(MATCH_FILTER_ALL)) return anyLabel || t("call.match_filter.any_option");
    const first = getCountryName(t, countries[0]);
    if (countries.length <= 1) return first;
    return t("profile.match_summary_country_more", { first, count: countries.length - 1 });
  }, [t]);

  const formatLanguageMatchSummary = useCallback((languagesRaw: string[]) => {
    const anyLabel = String(t("call.match_filter.any_option") || "").replace(/\s*\(ALL\)\s*/gi, "").trim();
    const languages = normalizeMatchFilter({ languages: languagesRaw }).languages;
    if (languages.includes(MATCH_FILTER_ALL)) return anyLabel || t("call.match_filter.any_option");
    const first = getLanguageName(t, languages[0]);
    if (languages.length <= 1) return first;
    return t("profile.match_summary_language_more", { first, count: languages.length - 1 });
  }, [t]);

  const matchSettingsSummary = useMemo(() => {
    const normalized = normalizeMatchFilter(matchFilter);
    const countrySummary = formatCountryMatchSummary(normalized.countries);
    const languageSummary = formatLanguageMatchSummary(normalized.languages);
    const genderSummary =
      normalized.gender === "male"
        ? t("gender.male")
        : normalized.gender === "female"
        ? t("gender.female")
        : t("call.match_filter.gender_all");
    return `${countrySummary} / ${languageSummary} / ${genderSummary}`;
  }, [formatCountryMatchSummary, formatLanguageMatchSummary, matchFilter, t]);

  const loadMatchFilter = useCallback(async () => {
    if (!sub?.isPremium) {
      applyMatchFilterState(createDefaultMatchFilter());
      return;
    }
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) return;
    setMatchFilterLoading(true);
    try {
      const out = await fetchMatchFilterOnServer({ token, userId, deviceKey });
      if (out.ok) {
        applyMatchFilterState(out.filter);
      }
    } finally {
      setMatchFilterLoading(false);
    }
  }, [applyMatchFilterState, auth?.deviceKey, auth?.token, auth?.userId, sub?.isPremium]);

  useEffect(() => {
    if (!isScreenFocused) return;
    loadMatchFilter().catch(() => undefined);
  }, [isScreenFocused, loadMatchFilter]);

  const closeMatchFilterUpsellModal = useCallback(() => {
    setMatchFilterUpsellModalVisible(false);
  }, []);

  const onPressGoPremiumForMatchFilter = useCallback(() => {
    setMatchFilterUpsellModalVisible(false);
    navigation.navigate("Premium");
  }, [navigation]);

  const openMatchFilterModal = useCallback(() => {
    if (!sub?.isPremium) {
      setMatchFilterUpsellModalVisible(true);
      return;
    }
    setMatchFilterDraft(normalizeMatchFilter(matchFilter));
    setMatchFilterModalVisible(true);
  }, [matchFilter, sub?.isPremium]);

  const closeMatchFilterModal = useCallback(() => {
    if (matchFilterSaving) return;
    setMatchFilterModalVisible(false);
  }, [matchFilterSaving]);

  const onPressSaveMatchFilter = useCallback(async () => {
    if (matchFilterSaving) return;
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("call.match_filter.title"), t("common.auth_expired"));
      return;
    }
    const normalized = normalizeMatchFilter(matchFilterDraft);
    setMatchFilterSaving(true);
    try {
      const out = await saveMatchFilterOnServer({
        token,
        userId,
        deviceKey,
        filter: normalized,
      });
      if (!out.ok) {
        const code = String(out.errorCode || "").toUpperCase();
        if (code === "MATCH_FILTER_ROUTE_NOT_FOUND") {
          showGlobalModal(t("call.match_filter.title"), t("call.match_filter.route_missing"));
        } else {
          showGlobalModal(t("call.match_filter.title"), out.errorMessage || out.errorCode || t("common.error_occurred"));
        }
        return;
      }
      applyMatchFilterState(out.filter);
      setMatchFilterModalVisible(false);
    } finally {
      setMatchFilterSaving(false);
    }
  }, [applyMatchFilterState, auth?.deviceKey, auth?.token, auth?.userId, matchFilterDraft, matchFilterSaving, showGlobalModal, t]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <AppText style={styles.headerTitle}>{t("profile.title")}</AppText>,
      headerTitleAlign: "center",
      animation: "slide_from_left",
      headerLeftContainerStyle: styles.headerLeftContainer,
      headerRightContainerStyle: styles.headerRightContainer,
      headerLeft: () => (
        <Pressable onPressIn={() => navigation.goBack()} hitSlop={12} style={styles.headerBackBtn}>
          <Text style={styles.headerBackTxt}>
            {"<"}
          </Text>
        </Pressable>
      ),
      headerRight: () => (
        <View style={styles.headerRightRow}>
          <Pressable onPress={() => navigation.navigate("GiftBox", { mode: "view" })} style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}>
            <Ionicons name="gift-outline" size={22} color={theme.colors.text} />
          </Pressable>
          <Pressable
            onPress={() => setPrefsModal(true)}
            style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
          >
            <AppText style={styles.headerBtnText}>⚙</AppText>
          </Pressable>
        </View>
      ),
    });
  }, [navigation, t]);

  const POLICY_BASE_URL =
    ((APP_CONFIG as any)?.POLICY?.baseUrl as string | undefined)?.trim() || "https://ppicassor-cpu.github.io";

  const POLICY_URLS = useMemo(() => {
    const termsUrl =
      ((APP_CONFIG as any)?.POLICY?.termsUrl as string | undefined)?.trim() || `${POLICY_BASE_URL}/terms.html`;
    const privacyUrl =
      ((APP_CONFIG as any)?.POLICY?.privacyUrl as string | undefined)?.trim() || `${POLICY_BASE_URL}/privacy.html`;
    const operationUrl =
      ((APP_CONFIG as any)?.POLICY?.operationUrl as string | undefined)?.trim() || `${POLICY_BASE_URL}/operation.html`;

    return { termsUrl, privacyUrl, operationUrl };
  }, [POLICY_BASE_URL]);

  const openPolicy = async (kind: "terms" | "privacy" | "operation") => {
    const url =
      kind === "terms"
        ? POLICY_URLS.termsUrl
        : kind === "privacy"
        ? POLICY_URLS.privacyUrl
        : POLICY_URLS.operationUrl;

    if (!url) {
      showGlobalModal(t("policy.title"), t("policy.url_missing"));
      return;
    }

    try {
      await Linking.openURL(url);
    } catch (e) {
      showGlobalModal(t("policy.title"), toErrMsg(e));
    }
  };

  const goPremium = async () => {
    await refreshSubscription();
    navigation.navigate("Premium");
  };

  const doWithdraw = async () => {
    await logoutAndWipe();
  };

  const doLogout = useCallback(async () => {
    setLogoutModal(false);
    await logoutAndWipe();
  }, [logoutAndWipe]);

  const onPressLogout = useCallback(() => {
    setLogoutModal(true);
  }, []);

  const onPressManageSubscriptions = useCallback(async () => {
    try {
      const url =
        Platform.OS === "ios"
          ? "https://apps.apple.com/account/subscriptions"
          : "https://play.google.com/store/account/subscriptions";

      await Linking.openURL(url);
    } catch (e) {
      showGlobalModal(t("profile.manage_subscription"), toErrMsg(e));
    }
  }, [showGlobalModal, t]);

  const onPressRestoreSubscription = useCallback(async () => {
    if (restoreBusy) return;
    setRestoreBusy(true);

    try {
      await refreshSubscription();
      showGlobalModal(t("profile.restore_subscription"), t("profile.restore_subscription_done"));
    } catch (e) {
      showGlobalModal(t("profile.restore_subscription"), toErrMsg(e));
    } finally {
      setRestoreBusy(false);
    }
  }, [restoreBusy, showGlobalModal, t]);

  const selectedCallBlockSet = useMemo(() => new Set(callBlockSelected), [callBlockSelected]);
  const allCallBlocksSelected = useMemo(
    () => callBlockItems.length > 0 && callBlockItems.every((it) => selectedCallBlockSet.has(it.peerSessionKey)),
    [callBlockItems, selectedCallBlockSet]
  );

  const loadCallBlockList = useCallback(async () => {
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("profile.block_manage"), t("profile.block_auth_required"));
      return;
    }
    setCallBlockListBusy(true);
    try {
      const out = await fetchCallBlockListOnServer({ token, userId, deviceKey });
      if (!out.ok) {
        showGlobalModal(t("profile.block_manage"), out.errorMessage || out.errorCode || t("common.error_occurred"));
        return;
      }
      setCallBlockItems(out.items);
      setCallBlockSelected((prev) => prev.filter((id) => out.items.some((row) => row.peerSessionKey === id)));
    } finally {
      setCallBlockListBusy(false);
    }
  }, [auth?.deviceKey, auth?.token, auth?.userId, showGlobalModal, t]);

  const openCallBlockModal = useCallback(() => {
    setCallBlockModal(true);
    loadCallBlockList().catch(() => undefined);
  }, [loadCallBlockList]);

  const toggleCallBlockSelected = useCallback((peerSessionKey: string) => {
    const key = String(peerSessionKey || "").trim();
    if (!key) return;
    setCallBlockSelected((prev) => {
      if (prev.includes(key)) return prev.filter((v) => v !== key);
      return [...prev, key];
    });
  }, []);

  const onPressToggleAllCallBlocks = useCallback(() => {
    if (!callBlockItems.length) {
      setCallBlockSelected([]);
      return;
    }
    if (allCallBlocksSelected) {
      setCallBlockSelected([]);
      return;
    }
    setCallBlockSelected(callBlockItems.map((it) => it.peerSessionKey));
  }, [allCallBlocksSelected, callBlockItems]);

  const onPressUnblockSelectedCallBlocks = useCallback(async () => {
    if (callBlockUnblockBusy) return;
    if (!callBlockSelected.length) {
      showGlobalModal(t("profile.block_manage"), t("profile.block_select_required"));
      return;
    }
    const token = String(auth?.token || "").trim();
    const userId = String(auth?.userId || "").trim();
    const deviceKey = String(auth?.deviceKey || "").trim();
    if (!token || !userId || !deviceKey) {
      showGlobalModal(t("profile.block_manage"), t("profile.block_auth_required"));
      return;
    }

    setCallBlockUnblockBusy(true);
    try {
      const out = await unblockCallPeersOnServer({
        token,
        userId,
        deviceKey,
        peerSessionIds: callBlockSelected,
      });
      if (!out.ok) {
        showGlobalModal(t("profile.block_manage"), out.errorMessage || out.errorCode || t("common.error_occurred"));
        return;
      }
      showGlobalModal(
        t("profile.block_manage"),
        t("profile.block_unblock_done", { count: Math.max(1, out.removedCount || callBlockSelected.length) })
      );
      await loadCallBlockList();
      setCallBlockSelected([]);
    } finally {
      setCallBlockUnblockBusy(false);
    }
  }, [
    auth?.deviceKey,
    auth?.token,
    auth?.userId,
    callBlockSelected,
    callBlockUnblockBusy,
    loadCallBlockList,
    showGlobalModal,
    t,
  ]);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.subBadgeOnlyRow}>
          <View style={styles.sectionLabelWithIconRow}>
            <Ionicons name="ribbon-outline" size={SECTION_ICON_SIZE} color={SECTION_ICON_COLOR} />
            <AppText style={styles.sectionStatusLine}>{t("profile.current_grade")}</AppText>
          </View>
          <View style={styles.planPill}>
            <AppText style={styles.planPillText}>{sub.isPremium ? currentPlanLabel || t("profile.plan.premium") : "FREE"}</AppText>
          </View>
        </View>

        <View style={{ height: 10 }} />

        {!sub.isPremium ? <ProfilePrimaryButton title={t("profile.apply_premium")} onPress={goPremium} /> : null}
        <View style={{ height: 10 }} />
        <ProfilePrimaryButton title={t("profile.manage_subscription")} onPress={onPressManageSubscriptions} variant="ghost" />
        <View style={{ height: 10 }} />
        <ProfilePrimaryButton
          title={restoreBusy ? t("profile.restore_subscription_loading") : t("profile.restore_subscription")}
          onPress={onPressRestoreSubscription}
          variant="ghost"
          disabled={restoreBusy}
        />
      </View>

      <View style={styles.card}>
        <View style={styles.sectionSplitRow}>
          <View style={styles.sectionLabelWithIconRow}>
            <Ionicons name="language-outline" size={SECTION_ICON_SIZE} color={SECTION_ICON_COLOR} />
            <AppText style={styles.sectionStatusLine} numberOfLines={1} ellipsizeMode="tail">
              {t("profile.language_section")}
            </AppText>
          </View>
          <AppText style={styles.sectionInfoRight} numberOfLines={1} ellipsizeMode="tail">
            {t("profile.current_language", { language: languageLabel })}
          </AppText>
        </View>

        <View style={{ height: 14 }} />

        <ProfilePrimaryButton title={t("profile.change_language")} onPress={() => setLangModal(true)} variant="ghost" />
      </View>

      <View style={styles.card}>
        <View style={styles.sectionLabelWithIconRow}>
          <Ionicons name="funnel-outline" size={SECTION_ICON_SIZE} color={SECTION_ICON_COLOR} />
          <AppText style={styles.sectionStatusLine} numberOfLines={1} ellipsizeMode="tail">
            {t("profile.match_settings_section")}
          </AppText>
        </View>
        <AppText style={styles.matchSettingsSummary} numberOfLines={1} ellipsizeMode="tail">
          {t("profile.current_match_settings", { summary: matchSettingsSummary })}
        </AppText>

        <View style={{ height: 14 }} />

        <ProfilePrimaryButton title={t("profile.change_match_conditions")} onPress={openMatchFilterModal} variant="ghost" />
      </View>

      <View style={styles.card}>
        <ProfilePrimaryButton
          title={t("profile.terms_and_policies")}
          onPress={() => setPolicyModal(true)}
          variant="ghost"
          leftIcon={<Ionicons name="document-text-outline" size={ACTION_ICON_SIZE} color={SECTION_ICON_COLOR} />}
        />
        <View style={{ height: 10 }} />
        <ProfilePrimaryButton
          title={t("profile.block_manage")}
          onPress={openCallBlockModal}
          variant="ghost"
          leftIcon={<Ionicons name="ban-outline" size={ACTION_ICON_SIZE} color={SECTION_ICON_COLOR} />}
        />
        <View style={{ height: 10 }} />
        <ProfilePrimaryButton
          title={t("profile.logout")}
          onPress={onPressLogout}
          variant="ghost"
          leftIcon={<Ionicons name="log-out-outline" size={ACTION_ICON_SIZE} color={SECTION_ICON_COLOR} />}
        />
        <View style={{ height: 10 }} />
        <OutlineDangerButton
          title={t("profile.withdraw")}
          onPress={() => setWithdrawModal(true)}
          leftIcon={<Ionicons name="person-remove-outline" size={ACTION_ICON_SIZE} color={SECTION_ICON_COLOR} />}
        />
      </View>

      <PrefsModal
        visible={prefsModal}
        onClose={() => setPrefsModal(false)}
        prefs={prefs}
        setPrefs={setPrefs}
        countryLabel={countryLabel}
        genderLabel={genderLabel}
      />

      <LanguageModal visible={langModal} onClose={() => setLangModal(false)} prefs={prefs} setPrefs={setPrefs} />

      <PolicyModal
        visible={policyModal}
        onClose={() => setPolicyModal(false)}
        onPressTerms={() => openPolicy("terms")}
        onPressPrivacy={() => openPolicy("privacy")}
        onPressOperation={() => openPolicy("operation")}
      />

      <AppModal
        visible={callBlockModal}
        title={t("profile.block_manage")}
        onClose={() => {
          if (callBlockUnblockBusy) return;
          setCallBlockModal(false);
        }}
        dismissible={!callBlockUnblockBusy}
        footer={
          <View style={{ gap: 10 }}>
            <ProfilePrimaryButton title={t("common.close")} onPress={() => setCallBlockModal(false)} variant="ghost" disabled={callBlockUnblockBusy} />
          </View>
        }
      >
        <View style={styles.blockModalActionRow}>
          <ProfilePrimaryButton
            title={allCallBlocksSelected ? t("profile.block_select_clear_all") : t("profile.block_select_all")}
            onPress={onPressToggleAllCallBlocks}
            variant="ghost"
            disabled={callBlockListBusy || callBlockUnblockBusy || callBlockItems.length <= 0}
            style={styles.blockModalActionBtn}
          />
          <ProfilePrimaryButton
            title={callBlockUnblockBusy ? t("profile.block_unblock_loading") : t("profile.block_unblock_selected", { count: callBlockSelected.length })}
            onPress={onPressUnblockSelectedCallBlocks}
            variant={callBlockSelected.length > 0 ? "danger" : "ghost"}
            disabled={callBlockListBusy || callBlockUnblockBusy || callBlockSelected.length <= 0}
            style={styles.blockModalActionBtn}
          />
        </View>

        <View style={styles.blockMetaRow}>
          <AppText style={styles.blockMetaText}>{t("profile.block_count", { count: callBlockItems.length })}</AppText>
          <Pressable onPress={() => loadCallBlockList().catch(() => undefined)} style={({ pressed }) => [styles.blockRefreshBtn, pressed ? { opacity: 0.65 } : null]}>
            <AppText style={styles.blockRefreshBtnText}>{t("profile.block_refresh")}</AppText>
          </Pressable>
        </View>

        {callBlockListBusy ? (
          <AppText style={styles.modalText}>{t("profile.block_list_loading")}</AppText>
        ) : callBlockItems.length <= 0 ? (
          <AppText style={styles.modalText}>{t("profile.block_empty")}</AppText>
        ) : (
          <ScrollView
            style={styles.blockListScroll}
            contentContainerStyle={styles.blockListScrollContent}
            showsVerticalScrollIndicator
            nestedScrollEnabled
          >
            {callBlockItems.map((row) => {
              const selected = selectedCallBlockSet.has(row.peerSessionKey);
              const uid = String(row.peerUserId || row.peerProfileId || "").trim() || "-";
              return (
                <Pressable
                  key={row.peerSessionKey}
                  onPress={() => toggleCallBlockSelected(row.peerSessionKey)}
                  style={({ pressed }) => [styles.blockRow, selected ? styles.blockRowSelected : null, pressed ? { opacity: 0.8 } : null]}
                >
                  <View style={[styles.blockCheck, selected ? styles.blockCheckSelected : null]}>
                    {selected ? <Ionicons name="checkmark" size={16} color={theme.colors.white} /> : null}
                  </View>
                  <View style={styles.blockRowBody}>
                    <AppText style={styles.blockRowTitle}>{`UID: ${uid}`}</AppText>
                    <AppText style={styles.blockRowTime}>
                      {`${t("profile.blocked_at")}: ${formatBlockedAt(row.blockedAtMs || row.createdAtMs)}`}
                    </AppText>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </AppModal>

      <AppModal
        visible={matchFilterUpsellModalVisible}
        title={t("call.match_filter.premium_title")}
        dismissible={true}
        onClose={closeMatchFilterUpsellModal}
        footer={
          <View style={{ gap: 10 }}>
            <ProfilePrimaryButton title={t("call.match_filter.premium_action")} onPress={onPressGoPremiumForMatchFilter} />
            <ProfilePrimaryButton title={t("common.close")} variant="ghost" onPress={closeMatchFilterUpsellModal} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.match_filter.premium_desc")}</AppText>
      </AppModal>

      <AppModal
        visible={matchFilterModalVisible}
        title={t("call.match_filter.title")}
        dismissible={!matchFilterSaving}
        onClose={closeMatchFilterModal}
        footer={
          <View style={{ gap: 10 }}>
            <ProfilePrimaryButton
              title={matchFilterSaving ? t("common.loading") : t("common.save")}
              disabled={matchFilterSaving}
              onPress={onPressSaveMatchFilter}
            />
            <ProfilePrimaryButton title={t("common.close")} variant="ghost" disabled={matchFilterSaving} onPress={closeMatchFilterModal} />
          </View>
        }
      >
        <AppText style={styles.modalText}>{t("call.match_filter.desc")}</AppText>
        {matchFilterLoading ? <AppText style={styles.modalText}>{t("common.loading")}</AppText> : null}
        <ScrollView style={styles.matchFilterScroll} contentContainerStyle={styles.matchFilterScrollContent} showsVerticalScrollIndicator={false}>
          <AppText style={styles.sectionTitle}>{t("call.match_filter.country_title")}</AppText>
          <View style={styles.matchFilterCountryOptionWrap}>
            <Pressable
              onPress={() => toggleMatchFilterCountries(MATCH_FILTER_ALL)}
              style={({ pressed }) => [
                styles.matchFilterOption,
                styles.matchFilterCountryOption,
                normalizedMatchFilterDraft.countries.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionActive : null,
                pressed ? styles.matchFilterOptionPressed : null,
              ]}
            >
              <AppText
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.matchFilterOptionText,
                  styles.matchFilterCountryOptionText,
                  normalizedMatchFilterDraft.countries.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionTextActive : null,
                ]}
              >
                {t("call.match_filter.any_option")}
              </AppText>
            </Pressable>
            {matchFilterCountryOptions.map((opt) => {
              const active = normalizedMatchFilterDraft.countries.includes(opt.code);
              return (
                <Pressable
                  key={`profile_match_filter_country_${opt.code}`}
                  onPress={() => toggleMatchFilterCountries(opt.code)}
                  style={({ pressed }) => [
                    styles.matchFilterOption,
                    styles.matchFilterCountryOption,
                    active ? styles.matchFilterOptionActive : null,
                    pressed ? styles.matchFilterOptionPressed : null,
                  ]}
                >
                  <AppText
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.matchFilterOptionText, styles.matchFilterCountryOptionText, active ? styles.matchFilterOptionTextActive : null]}
                  >
                    {opt.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText style={styles.sectionTitle}>{t("call.match_filter.language_title")}</AppText>
          <View style={styles.matchFilterLanguageOptionWrap}>
            <Pressable
              onPress={() => toggleMatchFilterLanguages(MATCH_FILTER_ALL)}
              style={({ pressed }) => [
                styles.matchFilterOption,
                styles.matchFilterLanguageOption,
                normalizedMatchFilterDraft.languages.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionActive : null,
                pressed ? styles.matchFilterOptionPressed : null,
              ]}
            >
              <AppText
                numberOfLines={1}
                ellipsizeMode="tail"
                style={[
                  styles.matchFilterOptionText,
                  styles.matchFilterLanguageOptionText,
                  normalizedMatchFilterDraft.languages.includes(MATCH_FILTER_ALL) ? styles.matchFilterOptionTextActive : null,
                ]}
              >
                {t("call.match_filter.any_option")}
              </AppText>
            </Pressable>
            {matchFilterLanguageOptions.map((opt) => {
              const active = normalizedMatchFilterDraft.languages.includes(opt.code);
              return (
                <Pressable
                  key={`profile_match_filter_lang_${opt.code}`}
                  onPress={() => toggleMatchFilterLanguages(opt.code)}
                  style={({ pressed }) => [
                    styles.matchFilterOption,
                    styles.matchFilterLanguageOption,
                    active ? styles.matchFilterOptionActive : null,
                    pressed ? styles.matchFilterOptionPressed : null,
                  ]}
                >
                  <AppText
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={[styles.matchFilterOptionText, styles.matchFilterLanguageOptionText, active ? styles.matchFilterOptionTextActive : null]}
                  >
                    {opt.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          <AppText style={styles.sectionTitle}>{t("call.match_filter.gender_title")}</AppText>
          <View style={styles.matchFilterOptionWrap}>
            {(["male", "female", "all"] as MatchFilterGender[]).map((opt) => {
              const key = opt === "male" ? "gender.male" : opt === "female" ? "gender.female" : "call.match_filter.gender_all";
              const active = normalizedMatchFilterDraft.gender === opt;
              return (
                <Pressable
                  key={`profile_match_filter_gender_${opt}`}
                  onPress={() => setMatchFilterGender(opt)}
                  style={({ pressed }) => [
                    styles.matchFilterOption,
                    active ? styles.matchFilterOptionActive : null,
                    pressed ? styles.matchFilterOptionPressed : null,
                  ]}
                >
                  <AppText style={[styles.matchFilterOptionText, active ? styles.matchFilterOptionTextActive : null]}>{t(key)}</AppText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </AppModal>

      <AppModal
        visible={withdrawModal}
        title={t("modal.withdraw.title")}
        onClose={() => setWithdrawModal(false)}
        dismissible={true}
        footer={
          <View style={{ gap: 10 }}>
            <ProfilePrimaryButton title={t("modal.withdraw.confirm")} onPress={doWithdraw} variant="danger" />
            <ProfilePrimaryButton title={t("modal.withdraw.cancel")} onPress={() => setWithdrawModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.p}>{t("modal.withdraw.body")}</AppText>
      </AppModal>

      <AppModal
        visible={logoutModal}
        title={t("profile.logout")}
        onClose={() => setLogoutModal(false)}
        dismissible={true}
        footer={
          <View style={{ gap: 10 }}>
            <ProfilePrimaryButton title={t("profile.logout")} onPress={doLogout} variant="danger" />
            <ProfilePrimaryButton title={t("modal.withdraw.cancel")} onPress={() => setLogoutModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.p}>{t("profile.logout_confirm")}</AppText>
      </AppModal>

      <View style={{ width: "100%", alignItems: "center", paddingTop: 0, paddingBottom: 32 }}>
        <AppText style={{ fontSize: 11, color: "#999", textAlign: "center" }}>
          {t("profile.footer_copyright")}
        </AppText>
      </View>
    </ScrollView>
  );
}

function PrefsModal({
  visible,
  onClose,
  prefs,
  setPrefs,
  countryLabel,
  genderLabel,
}: {
  visible: boolean;
  onClose: () => void;
  prefs: any;
  setPrefs: (p: any) => void;
  countryLabel: string;
  genderLabel: string;
}) {
  const { t } = useTranslation();
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLangOpen(false);
    setCountryOpen(false);
    setGenderOpen(false);
  }, [visible]);

  const isoToFlag = useCallback((iso: string) => {
    const cc = String(iso || "").toUpperCase();
    if (cc.length !== 2) return "";
    const A = 0x1f1e6;
    const c1 = cc.charCodeAt(0);
    const c2 = cc.charCodeAt(1);
    if (c1 < 65 || c1 > 90 || c2 < 65 || c2 > 90) return "";
    return String.fromCodePoint(A + (c1 - 65), A + (c2 - 65));
  }, []);

  const setLanguage = useCallback((lang: string) => {
    if (typeof setPrefs === "function") setPrefs({ language: lang });
    else showGlobalModal(t("setting.title"), t("setting.language_save_error"));
  }, [setPrefs, showGlobalModal, t]);

  const setCountry = useCallback((iso: string) => {
    if (typeof setPrefs === "function") setPrefs({ country: iso });
    else showGlobalModal(t("setting.title"), t("setting.country_save_error"));
  }, [setPrefs, showGlobalModal, t]);

  const setGender = useCallback((gender: string) => {
    if (typeof setPrefs === "function") setPrefs({ gender });
    else showGlobalModal(t("setting.title"), t("setting.gender_save_error"));
  }, [setPrefs, showGlobalModal, t]);

  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ key: code, label: getLanguageAutonym(code) })),
    []
  );

  const countryOptions = useMemo(
    () => COUNTRY_CODES.map((code) => ({ key: code, name: getCountryName(t, code) })),
    [t]
  );

  const genderOptions = useMemo(() => [
    { key: "male", label: t("gender.male") },
    { key: "female", label: t("gender.female") },
  ], [t]);

  const currentLanguageLabel = useMemo(() => {
    const cur = normalizeLanguageCode(String(prefs.language || ""));
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur || t("common.not_set");
  }, [languageOptions, prefs.language, t]);

  const currentCountryDisplay = useMemo(() => {
    const cur = String(prefs.country || "").toUpperCase();
    const found = countryOptions.find((x) => x.key === cur);
    const nm = found ? found.name : cur || t("common.not_set");
    const cc = found ? found.key : cur;
    const flag = isoToFlag(cc);
    if (!cc) return nm;
    return `${flag ? flag + " " : ""}${nm} (${cc})`;
  }, [countryOptions, isoToFlag, prefs.country, t]);

  const currentGenderLabel = useMemo(() => {
    const cur = String(prefs.gender || "");
    const found = genderOptions.find((x) => x.key === cur);
    return found ? found.label : cur || t("common.not_set");
  }, [genderOptions, prefs.gender, t]);

  const activeLang = normalizeLanguageCode(String(prefs.language || ""));

  return (
    <AppModal
      visible={visible}
      title={t("setting.title")}
      dismissible={true}
      onClose={() => {
        onClose();
        setLangOpen(false);
        setCountryOpen(false);
        setGenderOpen(false);
      }}
      footer={
        <View style={{ gap: 10 }}>
          <ProfilePrimaryButton title={t("common.close")} onPress={onClose} variant="ghost" />
        </View>
      }
    >
      <AppText style={styles.modalText}>{t("setting.description")}</AppText>

      <AppText style={styles.sectionTitle}>{t("setting.country")}</AppText>
      <Pressable onPress={() => { setCountryOpen((v) => !v); setLangOpen(false); setGenderOpen(false); }} style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}>
        <AppText style={styles.dropdownBtnText}>{currentCountryDisplay}</AppText>
        <AppText style={styles.dropdownChevron}>{countryOpen ? "▲" : "▼"}</AppText>
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

      <AppText style={styles.sectionTitle}>{t("setting.language")}</AppText>
      <Pressable onPress={() => { setLangOpen((v) => !v); setCountryOpen(false); setGenderOpen(false); }} style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}>
        <AppText style={styles.dropdownBtnText}>{currentLanguageLabel}</AppText>
        <AppText style={styles.dropdownChevron}>{langOpen ? "▲" : "▼"}</AppText>
      </Pressable>

      {langOpen && (
        <View style={styles.dropdownListWrap}>
          <ScrollView style={styles.dropdownScroll} contentContainerStyle={styles.dropdownScrollContent} showsVerticalScrollIndicator>
            {languageOptions.map((opt) => {
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

      <AppText style={styles.sectionTitle}>{t("setting.gender")}</AppText>
      <Pressable onPress={() => { setGenderOpen((v) => !v); setCountryOpen(false); setLangOpen(false); }} style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}>
        <AppText style={styles.dropdownBtnText}>{currentGenderLabel}</AppText>
        <AppText style={styles.dropdownChevron}>{genderOpen ? "▲" : "▼"}</AppText>
      </Pressable>

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
  );
}


function LanguageModal({
  visible,
  onClose,
  prefs,
  setPrefs,
}: {
  visible: boolean;
  onClose: () => void;
  prefs: any;
  setPrefs: (p: any) => void;
}) {
  const { t } = useTranslation();
  const [language, setLanguage] = useState(prefs.language);

  useEffect(() => {
    if (!visible) return;
    setLanguage(prefs.language);
  }, [visible, prefs.language]);

  const save = () => {
    if (!language) return;
    setPrefs({ language });
    onClose();
  };

  const languageOptions = LANGUAGE_CODES.map((code) => ({ key: code, label: getLanguageAutonym(code) }));

  return (
    <AppModal
      visible={visible}
      title={t("modal.lang.title")}
      onClose={onClose}
      dismissible={true}
      footer={
        <View style={{ gap: 10 }}>
          <ProfilePrimaryButton title={t("common.save")} onPress={save} disabled={!language} />
        </View>
      }
    >
      <AppText style={styles.p}>{t("modal.lang.body")}</AppText>

      <View style={styles.pickerGroup}>
        <AppText style={styles.pickerTitle}>{t("prefs.language_title")}</AppText>
        <View style={styles.langGrid}>
          {languageOptions.map((opt) => {
            const active = language === opt.key;
            return (
              <LangChip
                key={opt.key}
                active={active}
                label={opt.label}
                onPress={() => setLanguage(opt.key)}
              />
            );
          })}
        </View>
      </View>
    </AppModal>
  );
}

function PolicyModal({
  visible,
  onClose,
  onPressTerms,
  onPressPrivacy,
  onPressOperation,
}: {
  visible: boolean;
  onClose: () => void;
  onPressTerms: () => void;
  onPressPrivacy: () => void;
  onPressOperation: () => void;
}) {
  const { t } = useTranslation();

  return (
    <AppModal
      visible={visible}
      title={t("modal.policy.title")}
      onClose={onClose}
      dismissible={true}
      footer={
        <View style={{ gap: 10 }}>
          <ProfilePrimaryButton title={t("common.close")} onPress={onClose} variant="ghost" />
        </View>
      }
    >
      <View style={{ gap: 10, width: "100%" }}>
        <View style={{ width: "100%" }}>
          <ProfilePrimaryButton title={t("modal.policy.terms")} onPress={onPressTerms} variant="ghost" />
        </View>
        <View style={{ width: "100%" }}>
          <ProfilePrimaryButton title={t("modal.policy.privacy")} onPress={onPressPrivacy} variant="ghost" />
        </View>
        <View style={{ width: "100%" }}>
          <ProfilePrimaryButton title={t("modal.policy.operation")} onPress={onPressOperation} variant="ghost" />
        </View>
      </View>
    </AppModal>
  );
}

function WidePolicyButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.policyWideBtn, pressed ? { opacity: 0.75 } : null]}>
      <AppText style={styles.policyWideTxt}>{title}</AppText>
    </Pressable>
  );
}

function PickChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.chipBtn, active ? styles.chipOn : styles.chipOff, pressed ? { opacity: 0.8 } : null]}>
      <AppText style={[styles.chipTxt, active ? styles.chipTxtOn : styles.chipTxtOff]}>{label}</AppText>
    </Pressable>
  );
}

function LangChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.langChipBtn,
        active ? styles.chipOn : styles.chipOff,
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <AppText style={[styles.langChipTxt, active ? styles.chipTxtOn : styles.chipTxtOff]} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

function OutlineDangerButton({ title, onPress, leftIcon }: { title: string; onPress: () => void; leftIcon?: React.ReactNode }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.dangerOutlineBtn, pressed ? styles.dangerOutlineBtnPressed : null]}>
      <View style={styles.dangerOutlineContent}>
        {leftIcon ? <View style={styles.dangerOutlineIconWrap}>{leftIcon}</View> : null}
        <AppText style={styles.dangerOutlineTxt}>{title}</AppText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    padding: theme.spacing.lg,
    ...theme.shadow.card,
  },
  h1: { fontSize: 17, fontWeight: "700", color: theme.colors.text, marginBottom: 6 },
  p: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },
  sectionStatusLine: { fontSize: 15, color: theme.colors.text, fontWeight: "700", lineHeight: 20 },
  sectionInfoRight: { flex: 1, fontSize: 14, color: theme.colors.sub, textAlign: "right", lineHeight: 20 },
  sectionLabelWithIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  matchSettingsSummary: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.sub,
    fontWeight: "400",
  },
  subStatusText: { fontSize: 13, color: theme.colors.sub, lineHeight: 18 },
  singleLineInfoText: { fontSize: 13, color: theme.colors.sub, lineHeight: 18 },
  sectionSplitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  subHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  subBadgeOnlyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
  },
  subHeaderLeft: {
    flex: 1,
  },
  planPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  planPillText: {
    fontSize: 12,
    fontWeight: "900",
    color: theme.colors.pinkDeep,
  },
  profilePrimaryButton: {
    height: 48,
  },
  profilePrimaryButtonText: {
    fontWeight: "600",
  },

  headerTitle: { fontSize: 20, fontWeight: "800", color: theme.colors.text },
  headerTitleContainer: { marginLeft: -10 },
  headerLeftContainer: { paddingLeft: 6 },
  headerRightContainer: { paddingRight: 6 },

  headerBackBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBackTxt: { fontSize: 20, fontWeight: "800", color: theme.colors.text, lineHeight: 20 },

  headerBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  headerBtnText: { fontSize: 22, color: theme.colors.text, fontWeight: "700" },
  headerRightRow: { flexDirection: "row", alignItems: "center", gap: 2 },

  headerGearBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.card,
    alignItems: "center",
    justifyContent: "center",
    ...theme.shadow.card,
  },

  blockModalActionRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  blockModalActionBtn: {
    flex: 1,
  },
  blockMetaRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  blockMetaText: {
    fontSize: 13,
    color: theme.colors.sub,
    fontWeight: "700",
  },
  blockRefreshBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  blockRefreshBtnText: {
    fontSize: 13,
    color: theme.colors.pinkDeep,
    fontWeight: "800",
  },
  blockListScroll: {
    width: "100%",
    maxHeight: 380,
    minHeight: 180,
    marginTop: 6,
    alignSelf: "stretch",
  },
  blockListScrollContent: {
    gap: 8,
    paddingBottom: 4,
  },
  blockRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 12,
    backgroundColor: theme.colors.white,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  blockRowSelected: {
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.cardSoft,
  },
  blockCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.white,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  blockCheckSelected: {
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.pinkDeep,
  },
  blockRowBody: {
    flex: 1,
    gap: 2,
  },
  blockRowTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.colors.text,
  },
  blockRowSub: {
    fontSize: 12,
    color: theme.colors.sub,
    fontWeight: "600",
  },
  blockRowTime: {
    fontSize: 12,
    color: theme.colors.sub,
    fontWeight: "600",
  },

  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  matchFilterScroll: {
    width: "100%",
    maxHeight: 360,
    marginTop: 6,
  },
  matchFilterScrollContent: {
    gap: 10,
    paddingBottom: 4,
  },
  matchFilterOptionWrap: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  matchFilterCountryOptionWrap: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  matchFilterLanguageOptionWrap: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 8,
  },
  matchFilterOption: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(191,194,208,0.72)",
    backgroundColor: "rgba(249,250,255,0.92)",
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  matchFilterCountryOption: {
    width: "31.7%",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  matchFilterLanguageOption: {
    width: "48.6%",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  matchFilterOptionActive: {
    borderColor: "rgba(176,30,86,0.88)",
    backgroundColor: "rgba(255,240,247,0.96)",
  },
  matchFilterOptionPressed: {
    opacity: 0.78,
  },
  matchFilterOptionText: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "700",
    color: "#394055",
  },
  matchFilterCountryOptionText: {
    fontSize: 12,
    lineHeight: 15,
    textAlign: "center",
  },
  matchFilterLanguageOptionText: {
    textAlign: "center",
  },
  matchFilterOptionTextActive: {
    color: "#9D174D",
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
  dropdownBtnText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownChevron: { fontSize: 12, color: theme.colors.sub, fontWeight: "900" },

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

  infoBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.line,
  },
  infoK: { fontSize: 13, color: theme.colors.sub, fontWeight: "700" },
  infoV: { fontSize: 13, color: theme.colors.text, fontWeight: "700" },

  pickerGroup: { marginTop: 10 },
  pickerTitle: { fontSize: 13, fontWeight: "700", color: theme.colors.text, marginBottom: 8 },
  pickerRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  countryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  chipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },

  chipOn: { backgroundColor: theme.colors.pinkDeep, borderColor: theme.colors.pinkDeep },
  chipOff: { backgroundColor: theme.colors.white, borderColor: theme.colors.line },

  chipTxt: { fontSize: 13, fontWeight: "700" },
  chipTxtOn: { color: theme.colors.white },
  chipTxtOff: { color: theme.colors.text },

  langGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  langChipBtn: {
    flexBasis: "48%",
    minHeight: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  langChipTxt: {
    fontSize: 13,
    fontWeight: "800",
  },

  policyWideBtn: {
    width: "100%",
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  policyWideTxt: {
    fontSize: 15,
    fontWeight: "900",
    color: theme.colors.text,
  },

  dangerOutlineBtn: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: theme.radius.lg ?? 14,
    borderWidth: 1,
    borderColor: "#ff3b30",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerOutlineBtnPressed: { opacity: 0.75 },
  dangerOutlineContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  dangerOutlineIconWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  dangerOutlineTxt: { fontSize: 15, fontWeight: "700", color: "#ff3b30" },
});
