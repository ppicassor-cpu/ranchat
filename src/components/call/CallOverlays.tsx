import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AppModal from "../AppModal";
import PrimaryButton from "../PrimaryButton";
import AppText from "../AppText";
import FontSizeSlider from "../FontSizeSlider";
import { theme } from "../../config/theme";
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageName, normalizeLanguageCode } from "../../i18n/displayNames";
import { countryCodeToFlagEmoji } from "../../utils/countryUtils";
import { useAppStore } from "../../store/useAppStore";

type CallOverlaysProps = {
  styles: any;
  t: (key: string, params?: any) => string;
  insetsTop: number;
  onPressBack: () => void;
  onExitToHome: () => void;
  noMatchModal: boolean;
  isPremium: boolean;
  onDismissNoMatch: () => void;
  onRetry: () => void;
  onOpenMatchConditions: () => void;
  matchingActionsVisible: boolean;
  onPressMatchingBeauty: () => void;
  onPressMatchingFortune: () => void;
  onPressMatchingGame: () => void;
  onDismissMatchingActions: () => void;
  prefsModal: boolean;
  setPrefsModal: (v: boolean) => void;
  prefs: any;
  fontScale: number;
  setFontScale: (v: number) => void;
};

export default function CallOverlays({
  styles,
  t,
  insetsTop,
  onPressBack,
  onExitToHome,
  noMatchModal,
  isPremium,
  onDismissNoMatch,
  onRetry,
  onOpenMatchConditions,
  matchingActionsVisible,
  onPressMatchingBeauty,
  onPressMatchingFortune,
  onPressMatchingGame,
  onDismissMatchingActions,
  prefsModal,
  setPrefsModal,
  prefs,
  fontScale,
  setFontScale,
}: CallOverlaysProps) {
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const updatePref = useCallback((field: string, value: any) => {
    const st: any = useAppStore.getState?.() ?? {};
    const setPrefs = st.setPrefs;
    const setPref = st.setPref;
    const setPrefsField = st.setPrefsField;

    if (typeof setPrefs === "function") {
      setPrefs({ [field]: value });
    } else if (typeof setPref === "function") {
      setPref(field, value);
    } else if (typeof setPrefsField === "function") {
      setPrefsField(field, value);
    } else {
      showGlobalModal(t("common.settings"), t("setting.save_handler_missing", { field }));
    }
  }, [showGlobalModal, t]);

  const languageOptions = useMemo(
    () => LANGUAGE_CODES.map((code) => ({ key: code, label: getLanguageName(t, code) })),
    [t]
  );

  const countryOptions = useMemo(
    () => COUNTRY_CODES.map((code) => ({ key: code, name: getCountryName(t, code) })),
    [t]
  );

  const genderOptions = useMemo(
    () => [
      { key: "male", label: t("gender.male") },
      { key: "female", label: t("gender.female") },
    ],
    [t]
  );

  const currentLanguageLabel = useMemo(() => {
    const cur = normalizeLanguageCode(String((prefs as any)?.language || ""));
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur || t("common.not_set");
  }, [languageOptions, prefs, t]);

  const currentCountryDisplay = useMemo(() => {
    const cur = String((prefs as any)?.country || "").toUpperCase();
    const found = countryOptions.find((x) => x.key === cur);
    const nm = found ? found.name : cur || t("common.not_set");
    const cc = found ? found.key : cur;
    const flag = countryCodeToFlagEmoji(cc);
    if (!cc) return nm;
    return `${flag ? flag + " " : ""}${nm} (${cc})`;
  }, [countryOptions, prefs, t]);

  const currentGenderLabel = useMemo(() => {
    const cur = String((prefs as any)?.gender || "");
    const found = genderOptions.find((x) => x.key === cur);
    return found ? found.label : cur || t("common.not_set");
  }, [genderOptions, prefs, t]);

  const onPressChangeMatchConditions = useCallback(() => {
    onDismissNoMatch();
    onOpenMatchConditions();
  }, [onDismissNoMatch, onOpenMatchConditions]);

  return (
    <>
      <View pointerEvents="box-none" style={styles.topUiLayer}>
        <Pressable
          onPress={onPressBack}
          hitSlop={14}
          style={({ pressed }) => [
            styles.backBtn,
            { top: insetsTop + 8, left: 12 },
            pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <Ionicons name="chevron-back" size={30} color="#fff" />
        </Pressable>
      </View>

      <AppModal
        visible={noMatchModal}
        title={isPremium ? t("call.fast_matching") : t("call.delay_matching")}
        dismissible={true}
        onClose={onDismissNoMatch}
        footer={
          isPremium ? (
            <View style={{ gap: 10 }}>
              <PrimaryButton title={t("common.exit")} onPress={onExitToHome} variant="ghost" />
            </View>
          ) : (
            <View style={{ gap: 10 }}>
              <PrimaryButton
                title={t("common.retry")}
                onPress={onRetry}
                leftIcon={<Ionicons name="refresh" size={17} color="#C6CBD3" />}
              />
              <PrimaryButton
                title={t("call.match_filter.change_conditions")}
                onPress={onPressChangeMatchConditions}
                variant="ghost"
                leftIcon={<Ionicons name="funnel-outline" size={17} color="#AAB0BA" />}
              />
              <PrimaryButton title={t("common.exit")} onPress={onExitToHome} variant="ghost" />
            </View>
          )
        }
      >
        {isPremium ? (
          <AppText style={{ width: "100%", fontSize: 16, color: theme.colors.sub, lineHeight: 20, textAlign: "center" }}>
            {t("call.fast_matching_desc")}
          </AppText>
        ) : (
          <AppText style={{ width: "100%", fontSize: 16, color: theme.colors.sub, lineHeight: 20, textAlign: "center" }}>
            {t("call.delay_matching_desc")}
          </AppText>
        )}
      </AppModal>

      <AppModal
        visible={prefsModal}
        title={t("common.settings")}
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

        <AppText style={styles.sectionTitle}>{t("setting.country")}</AppText>

        <Pressable
          onPress={() => {
            setCountryOpen((v) => !v);
            setLangOpen(false);
            setGenderOpen(false);
          }}
          style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}
        >
          <AppText style={styles.dropdownBtnText}>{currentCountryDisplay}</AppText>
          <AppText style={styles.dropdownChevron}>{countryOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {countryOpen ? (
          <View style={styles.dropdownListWrap}>
            <ScrollView
              style={styles.dropdownScroll}
              contentContainerStyle={styles.dropdownScrollContent}
              showsVerticalScrollIndicator={true}
            >
              {countryOptions.map((opt) => {
                const active = String((prefs as any)?.country || "").toUpperCase() === opt.key;
                const flag = countryCodeToFlagEmoji(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      updatePref("country", opt.key);
                      setCountryOpen(false);
                    }}
                    style={({ pressed }) => [
                      styles.dropdownRow,
                      active ? styles.dropdownRowActive : null,
                      pressed ? { opacity: 0.75 } : null,
                    ]}
                  >
                    <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>
                      {flag ? `${flag} ` : ""}
                      {opt.name}
                    </AppText>

                    <View style={styles.countryRight}>
                      <AppText style={[styles.countryCode, active ? styles.countryCodeActive : null]}>({opt.key})</AppText>
                      {active ? <AppText style={styles.dropdownCheck}>✓</AppText> : null}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        <AppText style={styles.sectionTitle}>{t("setting.language")}</AppText>

        <Pressable
          onPress={() => {
            setLangOpen((v) => !v);
            setCountryOpen(false);
            setGenderOpen(false);
          }}
          style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}
        >
          <AppText style={styles.dropdownBtnText}>{currentLanguageLabel}</AppText>
          <AppText style={styles.dropdownChevron}>{langOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {langOpen ? (
          <View style={styles.dropdownList}>
            {languageOptions.map((opt) => {
              const active = normalizeLanguageCode(String((prefs as any)?.language || "")) === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    updatePref("language", opt.key);
                    setLangOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.dropdownRow,
                    active ? styles.dropdownRowActive : null,
                    pressed ? { opacity: 0.75 } : null,
                  ]}
                >
                  <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>{opt.label}</AppText>
                  {active ? <AppText style={styles.dropdownCheck}>✓</AppText> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <AppText style={styles.sectionTitle}>{t("setting.gender")}</AppText>

        <Pressable
          onPress={() => {
            setGenderOpen((v) => !v);
            setCountryOpen(false);
            setLangOpen(false);
          }}
          style={({ pressed }) => [styles.dropdownBtn, pressed ? { opacity: 0.8 } : null]}
        >
          <AppText style={styles.dropdownBtnText}>{currentGenderLabel}</AppText>
          <AppText style={styles.dropdownChevron}>{genderOpen ? "▲" : "▼"}</AppText>
        </Pressable>

        {genderOpen ? (
          <View style={styles.dropdownList}>
            {genderOptions.map((opt) => {
              const active = String((prefs as any)?.gender || "") === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    updatePref("gender", opt.key);
                    setGenderOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.dropdownRow,
                    active ? styles.dropdownRowActive : null,
                    pressed ? { opacity: 0.75 } : null,
                  ]}
                >
                  <AppText style={[styles.dropdownText, active ? styles.dropdownTextActive : null]}>{opt.label}</AppText>
                  {active ? <AppText style={styles.dropdownCheck}>✓</AppText> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}

        <AppText style={styles.sectionTitle}>{t("setting.font_size")}</AppText>
        <AppText style={styles.modalText}>{t("setting.font_size_desc", { percent: Math.round(fontScale * 100) })}</AppText>
        <FontSizeSlider value={fontScale} onChange={setFontScale} />
      </AppModal>
    </>
  );
}
