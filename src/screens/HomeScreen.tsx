// FILE: C:\ranchat\src\screens\HomeScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, ScrollView, ImageBackground } from "react-native";
import { theme } from "../config/theme";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { BannerBar, createInterstitial } from "../services/ads/AdManager";
import { useAppStore } from "../store/useAppStore";
import { AdEventType } from "react-native-google-mobile-ads";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "../i18n/LanguageProvider";
import * as Updates from "expo-updates";
export default function HomeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { t, currentLang } = useTranslation();

  const prefs = useAppStore((s: any) => s.prefs);
  const isPremium = useAppStore((s: any) => s.sub.isPremium);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);

  const [prefsModal, setPrefsModal] = useState(false);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const interstitialRef = useRef<any>(null);

  const canMatch = useMemo(() => {
    const countryOk = String(prefs.country || "").length > 0;
    const genderOk = String(prefs.gender || "").length > 0;
    const langOk = String(prefs.language || "").length > 0;
    return countryOk && genderOk && langOk;
  }, [prefs.country, prefs.gender, prefs.language]);

  const goProfile = useCallback(() => {
    navigation.navigate("Profile");
  }, [navigation]);

  const openPrefs = useCallback(() => {
    setPrefsModal(true);
  }, []);

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
  <Pressable
    hitSlop={12}
    onPressIn={openPrefs}
    style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
  >
    <AppText style={styles.headerBtnText}>⚙</AppText>
  </Pressable>
), [openPrefs]);

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

  const getLangLabel = useCallback((lang: string) => {
    const codeRaw = String(lang || "").trim().toLowerCase();
    const code = codeRaw === "kr" ? "ko" : codeRaw;
    const ui = String(currentLang || "ko").trim().toLowerCase();

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
    return map[code] || code || t("common.not_set");
  }, [currentLang, t]);

  const languageOptions = useMemo(() => [
    { key: "ko", label: getLangLabel("ko") },
    { key: "en", label: getLangLabel("en") },
    { key: "ja", label: getLangLabel("ja") },
    { key: "zh", label: getLangLabel("zh") },
    { key: "es", label: getLangLabel("es") },
    { key: "de", label: getLangLabel("de") },
    { key: "fr", label: getLangLabel("fr") },
    { key: "it", label: getLangLabel("it") },
    { key: "ru", label: getLangLabel("ru") },
  ], [getLangLabel]);

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
    const raw = String(prefs.language || "").trim().toLowerCase();
    const cur = raw === "kr" ? "ko" : raw;
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur ? getLangLabel(cur) : t("common.not_set");
  }, [getLangLabel, languageOptions, prefs.language, t]);

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

  const onPressMatch = useCallback(() => {
    if (!canMatch) {
      setPrefsModal(true);
      return;
    }

    if (isPremium) {
      goCall();
      return;
    }

    const ad = createInterstitial();
    interstitialRef.current = ad;

    let done = false;
    const runOnce = () => {
      if (done) return;
      done = true;
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
      try { ad.show(); } catch { cleanup(); runOnce(); }
    });
    unsubError = ad.addAdEventListener(AdEventType.ERROR, () => { cleanup(); runOnce(); });

    try { ad.load(); } catch { cleanup(); runOnce(); return; }

    setTimeout(() => { cleanup(); runOnce(); }, 1500);
  }, [canMatch, goCall, isPremium]);

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <ImageBackground
          source={require("../../assets/back.png")}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
        />
      </View>

      <View style={styles.body}>
        <View style={styles.center}>
          <AppText style={styles.title}>{t("home.title")}</AppText>
          <AppText style={styles.sub}>{t("home.subtitle")}</AppText>

          <View style={styles.matchBtnWrap}>
            <PrimaryButton title={t("home.match_button")} onPress={onPressMatch} />
          </View>
          <View style={{ height: 0 }} />
          <AppText style={[styles.sub, { fontSize: 12, opacity: 0.6, marginTop: -8 }]}>
            {`Runtime ${Updates.runtimeVersion ?? "-"} · Update ${Updates.updateId ? Updates.updateId.slice(-4) : "-"}`}
          </AppText>        
        </View>
      </View>

      {!isPremium ? (
        <View style={[styles.banner, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <BannerBar />
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

        {/* 언어 선택 - 스크롤 리스트로 변경 */}
        <AppText style={styles.sectionTitle}>{t("setting.language")}</AppText>
        <Pressable onPress={() => { setLangOpen((v) => !v); setCountryOpen(false); setGenderOpen(false); }} style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}>
          <AppText style={styles.dropdownBtnText}>{currentLanguageLabel}</AppText>
          <AppText style={styles.dropdownChevron}>{langOpen ? "▲" : "▼"}</AppText>
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  body: { flex: 1, padding: theme.spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, transform: [{ translateY: -40 }] },
  title: { fontSize: 26, fontWeight: "700", color: theme.colors.text },
  sub: { fontSize: 14, color: theme.colors.sub, textAlign: "center", lineHeight: 20 },
  matchBtnWrap: { width: "100%", maxWidth: 420 },

  banner: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    backgroundColor: "transparent",
    alignItems: "center",
  },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  headerBtnText: { fontSize: 22, color: theme.colors.text, fontWeight: "700" },

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
});
