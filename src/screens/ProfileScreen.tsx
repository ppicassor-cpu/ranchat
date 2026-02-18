// FILE: C:\ranchat\src\screens\ProfileScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { theme } from "../config/theme";
import { useAppStore } from "../store/useAppStore";
import { refreshSubscription, openManageSubscriptions } from "../services/purchases/PurchaseManager";
import { APP_CONFIG, COUNTRY_OPTIONS } from "../config/app";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useNavigation } from "@react-navigation/native";
import * as Updates from "expo-updates";
import { useTranslation } from "../i18n/LanguageProvider";


function toErrMsg(e: unknown) {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message || "UNKNOWN_ERROR");
  return "UNKNOWN_ERROR";
}

function safeT(t: (key: string, params?: Record<string, any>) => string, key: string, fallback: string, params?: Record<string, any>) {
  const v = t(key, params);
  if (!v || v === key) {
    let text = fallback;
    if (params) {
      Object.keys(params).forEach((k) => {
        text = text.replace(`{${k}}`, String(params[k]));
      });
    }
    return text;
  }
  return v;
}

function getLangDisplayLabel(lang: string, uiLang: string) {
  const code = String(lang || "").trim().toLowerCase();
  const ui = String(uiLang || "").trim().toLowerCase();

  const labelsKo: Record<string, string> = {
    ko: "한국어",
    en: "영어",
    ja: "일본어",
    zh: "중국어",
    es: "스페인어",
    de: "독일어",
    fr: "프랑스어",
    it: "이탈리아어",
    ru: "러시아어",
  };

  const labelsEn: Record<string, string> = {
    ko: "Korean",
    en: "English",
    ja: "Japanese",
    zh: "Chinese",
    es: "Spanish",
    de: "German",
    fr: "French",
    it: "Italian",
    ru: "Russian",
  };

  const map = ui === "ko" ? labelsKo : labelsEn;
  return map[code] || code || "-";
}

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const { t, currentLang } = useTranslation();

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
  const updateCheckedRef = useRef(false);

  const countryLabel = useMemo(() => {
    const c = COUNTRY_OPTIONS.find((x) => x.code === prefs.country);
    return c?.label ?? safeT(t, "common.hyphen", "-", undefined);
  }, [prefs.country, t]);

  const genderLabel = useMemo(() => {
    const hy = safeT(t, "common.hyphen", "-", undefined);
    if (prefs.gender === "male") return safeT(t, "gender.male", "남성", undefined);
    if (prefs.gender === "female") return safeT(t, "gender.female", "여성", undefined);
    return hy;
  }, [prefs.gender, t]);

  const languageLabel = useMemo(() => {
    const hy = safeT(t, "common.hyphen", "-", undefined);
    const ui = String(currentLang || "ko");
    const code = String(prefs.language || "").trim().toLowerCase();
    if (!code) return hy;
    return getLangDisplayLabel(code, ui);
  }, [prefs.language, t, currentLang]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => <AppText style={styles.headerTitle}>{safeT(t, "profile.title", "프로필", undefined)}</AppText>,
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
      showGlobalModal(safeT(t, "modal.update.title", "업데이트", undefined), toErrMsg(e));
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
      showGlobalModal(safeT(t, "policy.title", "정책", undefined), safeT(t, "policy.url_missing", "URL이 없습니다.", undefined));
      return;
    }

    try {
      await Linking.openURL(url);
    } catch (e) {
      showGlobalModal(safeT(t, "policy.title", "정책", undefined), toErrMsg(e));
    }
  };

  const goPremium = async () => {
    await refreshSubscription();
    navigation.navigate("Premium");
  };

  const doWithdraw = async () => {
    await logoutAndWipe();
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.card}>
        <AppText style={styles.h1}>{safeT(t, "profile.subscription_status", "구독 상태", undefined)}</AppText>
        <AppText style={styles.p}>{sub.isPremium ? safeT(t, "profile.premium_active", "프리미엄 이용 중", undefined) : safeT(t, "profile.free_active", "무료 이용 중", undefined)}</AppText>

        <View style={{ height: 10 }} />

        {!sub.isPremium ? <PrimaryButton title={safeT(t, "profile.apply_premium", "프리미엄 적용", undefined)} onPress={goPremium} /> : null}
        <View style={{ height: 10 }} />
        <PrimaryButton title={safeT(t, "profile.manage_subscription", "구독 관리", undefined)} onPress={openManageSubscriptions} variant="ghost" />
      </View>

      <View style={styles.card}>
        <AppText style={styles.h1}>{safeT(t, "profile.language_section", "언어", undefined)}</AppText>
        <AppText style={styles.p}>{safeT(t, "profile.current_language", "현재 언어: {language}", { language: languageLabel })}</AppText>

        <View style={{ height: 14 }} />

        <PrimaryButton title={safeT(t, "profile.change_language", "언어 변경", undefined)} onPress={() => setLangModal(true)} variant="ghost" />
      </View>

      <View style={styles.card}>
        <PrimaryButton title={safeT(t, "profile.terms_and_policies", "약관 및 정책", undefined)} onPress={() => setPolicyModal(true)} variant="ghost" />
        <View style={{ height: 10 }} />
        <OutlineDangerButton title={safeT(t, "profile.withdraw", "회원탈퇴", undefined)} onPress={() => setWithdrawModal(true)} />
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
        title={safeT(t, "modal.update.title", "업데이트", undefined)}
        onClose={() => {
          if (updateBusy) return;
          setUpdateModal(false);
        }}
        dismissible={!updateBusy}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton
              title={updateBusy ? safeT(t, "modal.update.applying", "적용 중...", undefined) : safeT(t, "modal.update.apply", "지금 적용", undefined)}
              onPress={doApplyUpdate}
              disabled={updateBusy}
            />
            <PrimaryButton title={safeT(t, "modal.update.later", "나중에", undefined)} onPress={() => setUpdateModal(false)} variant="ghost" disabled={updateBusy} />
          </View>
        }
      >
        <AppText style={styles.p}>{safeT(t, "modal.update.body", "업데이트가 있습니다.", undefined)}</AppText>
      </AppModal>

      <AppModal
        visible={withdrawModal}
        title={safeT(t, "modal.withdraw.title", "회원탈퇴", undefined)}
        onClose={() => setWithdrawModal(false)}
        dismissible={true}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={safeT(t, "modal.withdraw.confirm", "탈퇴하기", undefined)} onPress={doWithdraw} variant="danger" />
            <PrimaryButton title={safeT(t, "modal.withdraw.cancel", "취소", undefined)} onPress={() => setWithdrawModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.p}>{safeT(t, "modal.withdraw.body", "정말 탈퇴하시겠습니까?", undefined)}</AppText>
      </AppModal>
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
  const { t, currentLang } = useTranslation();
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

  const normalizeLang = useCallback((v: string) => {
    const code = String(v || "").trim().toLowerCase();
    if (code === "kr") return "ko";
    return code;
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

  const languageOptions = useMemo(() => {
    const ui = String(currentLang || "ko");
    return [
      { key: "ko", label: getLangDisplayLabel("ko", ui) },
      { key: "en", label: getLangDisplayLabel("en", ui) },
      { key: "ja", label: getLangDisplayLabel("ja", ui) },
      { key: "zh", label: getLangDisplayLabel("zh", ui) },
      { key: "es", label: getLangDisplayLabel("es", ui) },
      { key: "de", label: getLangDisplayLabel("de", ui) },
      { key: "fr", label: getLangDisplayLabel("fr", ui) },
      { key: "it", label: getLangDisplayLabel("it", ui) },
      { key: "ru", label: getLangDisplayLabel("ru", ui) },
    ];
  }, [currentLang]);

  const countryOptions = useMemo(() => [
    { key: "KR", name: "Korea" },
    { key: "JP", name: "Japan" },
    { key: "CN", name: "China" },
    { key: "TW", name: "Taiwan" },
    { key: "HK", name: "Hong Kong" },
    { key: "SG", name: "Singapore" },
    { key: "TH", name: "Thailand" },
    { key: "VN", name: "Vietnam" },
    { key: "PH", name: "Philippines" },
    { key: "ID", name: "Indonesia" },
    { key: "MY", name: "Malaysia" },
    { key: "IN", name: "India" },
    { key: "US", name: "United States" },
    { key: "CA", name: "Canada" },
    { key: "GB", name: "United Kingdom" },
    { key: "AU", name: "Australia" },
    { key: "DE", name: "Germany" },
    { key: "FR", name: "France" },
    { key: "RU", name: "Russia" },
    { key: "ES", name: "Spain" },
    { key: "IT", name: "Italy" },
    { key: "BR", name: "Brazil" },
    { key: "MX", name: "Mexico" },
  ], []);

  const genderOptions = useMemo(() => [
    { key: "male", label: t("gender.male") },
    { key: "female", label: t("gender.female") },
  ], [t]);

  const currentLanguageLabel = useMemo(() => {
    const cur = normalizeLang(String(prefs.language || ""));
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur || t("common.not_set");
  }, [languageOptions, normalizeLang, prefs.language, t]);

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

  const activeLang = normalizeLang(String(prefs.language || ""));

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
  const { t, currentLang } = useTranslation();
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

  const ui = String(currentLang || "ko");
  const languageOptions = [
    { key: "ko", label: getLangDisplayLabel("ko", ui) },
    { key: "en", label: getLangDisplayLabel("en", ui) },
    { key: "ja", label: getLangDisplayLabel("ja", ui) },
    { key: "zh", label: getLangDisplayLabel("zh", ui) },
    { key: "es", label: getLangDisplayLabel("es", ui) },
    { key: "de", label: getLangDisplayLabel("de", ui) },
    { key: "fr", label: getLangDisplayLabel("fr", ui) },
    { key: "it", label: getLangDisplayLabel("it", ui) },
    { key: "ru", label: getLangDisplayLabel("ru", ui) },
  ];

  return (
    <AppModal
      visible={visible}
      title={safeT(t, "modal.lang.title", "언어 변경", undefined)}
      onClose={onClose}
      dismissible={true}
      footer={
        <View style={{ gap: 10 }}>
          <PrimaryButton title={safeT(t, "common.save", "저장", undefined)} onPress={save} disabled={!language} />
        </View>
      }
    >
      <AppText style={styles.p}>{safeT(t, "modal.lang.body", "표시 언어를 선택하세요.", undefined)}</AppText>

      <View style={styles.pickerGroup}>
        <AppText style={styles.pickerTitle}>{safeT(t, "prefs.language_title", "언어", undefined)}</AppText>
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
      title={safeT(t, "modal.policy.title", "약관/정책", undefined)}
      onClose={onClose}
      dismissible={true}
      footer={
        <View style={{ gap: 10 }}>
          <PrimaryButton title={safeT(t, "common.close", "닫기", undefined)} onPress={onClose} variant="ghost" />
        </View>
      }
    >
      <View style={{ gap: 10 }}>
        <PrimaryButton title={safeT(t, "modal.policy.terms", "이용약관", undefined)} onPress={onPressTerms} variant="ghost" />
        <PrimaryButton title={safeT(t, "modal.policy.privacy", "개인정보처리방침", undefined)} onPress={onPressPrivacy} variant="ghost" />
        <PrimaryButton title={safeT(t, "modal.policy.operation", "운영정책", undefined)} onPress={onPressOperation} variant="ghost" />
      </View>
    </AppModal>
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
