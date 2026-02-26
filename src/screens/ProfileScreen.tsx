// FILE: C:\ranchat\src\screens\ProfileScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { theme } from "../config/theme";
import { useAppStore } from "../store/useAppStore";
import { refreshSubscription } from "../services/purchases/PurchaseManager";
import { APP_CONFIG } from "../config/app";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useNavigation } from "@react-navigation/native";
import * as Updates from "expo-updates";
import { useTranslation } from "../i18n/LanguageProvider";
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageName, normalizeLanguageCode } from "../i18n/displayNames";


function toErrMsg(e: unknown) {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message || "UNKNOWN_ERROR");
  return "UNKNOWN_ERROR";
}

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const prefs = useAppStore((s) => s.prefs);
  const sub = useAppStore((s) => s.sub);
  const logoutAndWipe = useAppStore((s) => s.logoutAndWipe);

  const setPrefs = useAppStore((s) => s.setPrefs);
  const showGlobalModal = useAppStore((s) => s.showGlobalModal);

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);

  const [prefsModal, setPrefsModal] = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);
  const [policyModal, setPolicyModal] = useState(false);
  const [langModal, setLangModal] = useState(false);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const [updateModal, setUpdateModal] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const updateCheckedRef = useRef(false);

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

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <AppText style={styles.headerTitle}>{t("profile.title")}</AppText>,
      headerTitleAlign: "center",
      animation: "slide_from_left",
      headerLeftContainerStyle: styles.headerLeftContainer,
      headerRightContainerStyle: styles.headerRightContainer,
      headerLeft: () => (
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.headerBackBtn}>
          <AppText style={styles.headerBackTxt}>{"<"}</AppText>
        </Pressable>
      ),
      headerRight: () => (
        <Pressable
          onPress={() => setPrefsModal(true)}
          style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
        >
          <AppText style={styles.headerBtnText}>⚙</AppText>
        </Pressable>
      ),
    });
  }, [navigation, t]);

  useEffect(() => {
    if (__DEV__) return;
    if (!Updates.isEnabled) return;
    if (updateCheckedRef.current) return;
    updateCheckedRef.current = true;

    (async () => {
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable) setUpdateModal(true);
      } catch {}
    })();
  }, []);

  const doApplyUpdate = async () => {
    if (updateBusy) return;
    setUpdateBusy(true);

    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e) {
      setUpdateBusy(false);
      showGlobalModal(t("modal.update.title"), toErrMsg(e));
    }
  };

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

  const onPressLogout = useCallback(async () => {
    await logoutAndWipe();
  }, [logoutAndWipe]);

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

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.card}>
        <View style={styles.subHeaderRow}>
          <View style={styles.subHeaderLeft}>
            <AppText style={styles.sectionStatusLine} numberOfLines={1} ellipsizeMode="tail">
              {`${t("profile.subscription_status")} - ${sub.isPremium ? t("profile.premium_active") : t("profile.free_active")}`}
            </AppText>
          </View>

          {sub.isPremium && currentPlanLabel ? (
            <View style={styles.planPill}>
              <AppText style={styles.planPillText}>{currentPlanLabel}</AppText>
            </View>
          ) : null}
        </View>

        <View style={{ height: 10 }} />

        {!sub.isPremium ? <PrimaryButton title={t("profile.apply_premium")} onPress={goPremium} /> : null}
        <View style={{ height: 10 }} />
        <PrimaryButton title={t("profile.manage_subscription")} onPress={onPressManageSubscriptions} variant="ghost" />
        <View style={{ height: 10 }} />
        <PrimaryButton
          title={restoreBusy ? t("profile.restore_subscription_loading") : t("profile.restore_subscription")}
          onPress={onPressRestoreSubscription}
          variant="ghost"
          disabled={restoreBusy}
        />
      </View>

      <View style={styles.card}>
        <AppText style={styles.sectionStatusLine} numberOfLines={1} ellipsizeMode="tail">
          {`${t("profile.language_section")} - ${t("profile.current_language", { language: languageLabel })}`}
        </AppText>

        <View style={{ height: 14 }} />

        <PrimaryButton title={t("profile.change_language")} onPress={() => setLangModal(true)} variant="ghost" />
      </View>

      <View style={styles.card}>
        <PrimaryButton title={t("profile.terms_and_policies")} onPress={() => setPolicyModal(true)} variant="ghost" />
        <View style={{ height: 10 }} />
        <PrimaryButton title={t("profile.logout")} onPress={onPressLogout} variant="ghost" />
        <View style={{ height: 10 }} />
        <OutlineDangerButton title={t("profile.withdraw")} onPress={() => setWithdrawModal(true)} />
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
        visible={updateModal}
        title={t("modal.update.title")}
        onClose={() => {
          if (updateBusy) return;
          setUpdateModal(false);
        }}
        dismissible={!updateBusy}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton
              title={updateBusy ? t("modal.update.applying") : t("modal.update.apply")}
              onPress={doApplyUpdate}
              disabled={updateBusy}
            />
            <PrimaryButton title={t("modal.update.later")} onPress={() => setUpdateModal(false)} variant="ghost" disabled={updateBusy} />
          </View>
        }
      >
        <AppText style={styles.p}>{t("modal.update.body")}</AppText>
      </AppModal>

      <AppModal
        visible={withdrawModal}
        title={t("modal.withdraw.title")}
        onClose={() => setWithdrawModal(false)}
        dismissible={true}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={t("modal.withdraw.confirm")} onPress={doWithdraw} variant="danger" />
            <PrimaryButton title={t("modal.withdraw.cancel")} onPress={() => setWithdrawModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.p}>{t("modal.withdraw.body")}</AppText>
      </AppModal>

      <View style={{ width: "100%", alignItems: "center", paddingTop: 8, paddingBottom: 2 }}>
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
          <PrimaryButton title={t("common.close")} onPress={onClose} variant="ghost" />
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

  const languageOptions = LANGUAGE_CODES.map((code) => ({ key: code, label: getLanguageName(t, code) }));

  return (
    <AppModal
      visible={visible}
      title={t("modal.lang.title")}
      onClose={onClose}
      dismissible={true}
      footer={
        <View style={{ gap: 10 }}>
          <PrimaryButton title={t("common.save")} onPress={save} disabled={!language} />
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
          <PrimaryButton title={t("common.close")} onPress={onClose} variant="ghost" />
        </View>
      }
    >
      <View style={{ gap: 10, width: "100%" }}>
        <View style={{ width: "100%" }}>
          <PrimaryButton title={t("modal.policy.terms")} onPress={onPressTerms} variant="ghost" />
        </View>
        <View style={{ width: "100%" }}>
          <PrimaryButton title={t("modal.policy.privacy")} onPress={onPressPrivacy} variant="ghost" />
        </View>
        <View style={{ width: "100%" }}>
          <PrimaryButton title={t("modal.policy.operation")} onPress={onPressOperation} variant="ghost" />
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

function OutlineDangerButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.dangerOutlineBtn, pressed ? styles.dangerOutlineBtnPressed : null]}>
      <AppText style={styles.dangerOutlineTxt}>{title}</AppText>
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
  subStatusText: { fontSize: 13, color: theme.colors.sub, lineHeight: 18 },
  singleLineInfoText: { fontSize: 13, color: theme.colors.sub, lineHeight: 18 },

  subHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
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

  headerTitle: { fontSize: 20, fontWeight: "800", color: theme.colors.text },
  headerTitleContainer: { marginLeft: -10 },
  headerLeftContainer: { paddingLeft: 6 },
  headerRightContainer: { paddingRight: 6 },

  headerBackBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  headerBackTxt: { fontSize: 20, fontWeight: "800", color: theme.colors.text, lineHeight: 20 },

  headerBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  headerBtnText: { fontSize: 22, color: theme.colors.text, fontWeight: "700" },

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

  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },

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
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: theme.radius.lg ?? 14,
    borderWidth: 1,
    borderColor: "#ff3b30",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  dangerOutlineBtnPressed: { opacity: 0.75 },
  dangerOutlineTxt: { fontSize: 15, fontWeight: "800", color: "#ff3b30" },
});
