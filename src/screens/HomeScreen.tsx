// FILE: C:\ranchat\src\screens\HomeScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PermissionsAndroid, Platform, Pressable, StyleSheet, View, ScrollView } from "react-native";
import { theme } from "../config/theme";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { BannerBar, createInterstitial } from "../services/ads/AdManager";
import { useAppStore } from "../store/useAppStore";
import { AdEventType } from "react-native-google-mobile-ads";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function HomeScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();

  const prefs = useAppStore((s: any) => s.prefs);
  const isPremium = useAppStore((s: any) => s.sub.isPremium);
  const showGlobalModal = useAppStore((s: any) => s.showGlobalModal);

  const fontScale = useAppStore((s: any) => s.ui.fontScale);
  const setFontScale = useAppStore((s: any) => s.setFontScale);

  const [permModal, setPermModal] = useState(false);
  const [permBusy, setPermBusy] = useState(false);

  const [prefsModal, setPrefsModal] = useState(false);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);

  const [permState, setPermState] = useState({ cam: false, mic: false, loc: false });

  const interstitialRef = useRef<any>(null);

  const canMatch = useMemo(() => {
    const countryOk = String(prefs.country || "").length > 0;
    const genderOk = String(prefs.gender || "").length > 0;
    const langOk = String(prefs.language || "").length > 0;
    return countryOk && genderOk && langOk;
  }, [prefs.country, prefs.gender, prefs.language]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => (
        <Pressable
          onPress={() => navigation.navigate("Profile")}
          style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
        >
          <AppText style={styles.headerBtnText}>≡</AppText>
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
  }, [navigation]);

  const isoToFlag = useCallback((iso: string) => {
    const cc = String(iso || "").toUpperCase();
    if (cc.length !== 2) return "";
    const A = 0x1f1e6;
    const c1 = cc.charCodeAt(0);
    const c2 = cc.charCodeAt(1);
    if (c1 < 65 || c1 > 90 || c2 < 65 || c2 > 90) return "";
    return String.fromCodePoint(A + (c1 - 65), A + (c2 - 65));
  }, []);

  const hasAndroidPermission = useCallback(async (perm: string) => {
    try {
      const r = await PermissionsAndroid.check(perm as any);
      return Boolean(r);
    } catch {
      return false;
    }
  }, []);

  const checkPermissions = useCallback(async () => {
    if (Platform.OS !== "android") {
      setPermModal(false);
      setPermState({ cam: true, mic: true, loc: true });
      return;
    }

    const cam = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
    const mic = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    const loc =
      (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
      (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));

    setPermState({ cam, mic, loc });

    const ok = cam && mic && loc;
    setPermModal(!ok);
  }, [hasAndroidPermission]);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  const requestPermissions = useCallback(async () => {
    if (permBusy) return;
    setPermBusy(true);

    try {
      if (Platform.OS !== "android") {
        setPermModal(false);
        setPermState({ cam: true, mic: true, loc: true });
        return;
      }

      const camBefore = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
      const micBefore = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      const locBefore =
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));

      const needs: string[] = [];
      if (!camBefore) needs.push(PermissionsAndroid.PERMISSIONS.CAMERA);
      if (!micBefore) needs.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      if (!locBefore) needs.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);

      const results: Record<string, string> = {};

      if (needs.length > 0) {
        const multi = await PermissionsAndroid.requestMultiple(needs as any);
        results.camera = multi[PermissionsAndroid.PERMISSIONS.CAMERA];
        results.mic = multi[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO];
        results.loc = multi[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      }

      const cam =
        camBefore ||
        results.camera === PermissionsAndroid.RESULTS.GRANTED ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA));

      const mic =
        micBefore ||
        results.mic === PermissionsAndroid.RESULTS.GRANTED ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO));

      const loc =
        locBefore ||
        results.loc === PermissionsAndroid.RESULTS.GRANTED ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
        (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));

      setPermState({ cam, mic, loc });

      const ok = cam && mic && loc;

      if (!ok) {
        showGlobalModal("권한허용이 필요합니다", "카메라/마이크/위치(GPS)권한을 설정에서 직접 켜야 합니다.");
        setPermModal(true);
      } else {
        setPermModal(false);
      }
    } catch {
      showGlobalModal("권한", "권한 요청에 실패했습니다.");
      setPermModal(true);
    } finally {
      setPermBusy(false);
    }
  }, [hasAndroidPermission, permBusy, showGlobalModal]);

  const goCall = useCallback(() => {
    navigation.navigate("Call");
  }, [navigation]);

  const setLanguage = useCallback(
    (lang: string) => {
      const st: any = useAppStore.getState?.() ?? {};
      const setPrefs = st.setPrefs;
      const setPref = st.setPref;
      const setPrefsField = st.setPrefsField;

      if (typeof setPrefs === "function") {
        setPrefs({ language: lang });
      } else if (typeof setPref === "function") {
        setPref("language", lang);
      } else if (typeof setPrefsField === "function") {
        setPrefsField("language", lang);
      } else {
        showGlobalModal("설정", "언어 저장 함수가 스토어에 없습니다. (setPrefs/setPref/setPrefsField)");
      }
    },
    [showGlobalModal]
  );

  const setCountry = useCallback(
    (iso: string) => {
      const st: any = useAppStore.getState?.() ?? {};
      const setPrefs = st.setPrefs;
      const setPref = st.setPref;
      const setPrefsField = st.setPrefsField;

      if (typeof setPrefs === "function") {
        setPrefs({ country: iso });
      } else if (typeof setPref === "function") {
        setPref("country", iso);
      } else if (typeof setPrefsField === "function") {
        setPrefsField("country", iso);
      } else {
        showGlobalModal("설정", "나라 저장 함수가 스토어에 없습니다. (setPrefs/setPref/setPrefsField)");
      }
    },
    [showGlobalModal]
  );

  const setGender = useCallback(
    (gender: string) => {
      const st: any = useAppStore.getState?.() ?? {};
      const setPrefs = st.setPrefs;
      const setPref = st.setPref;
      const setPrefsField = st.setPrefsField;

      if (typeof setPrefs === "function") {
        setPrefs({ gender });
      } else if (typeof setPref === "function") {
        setPref("gender", gender);
      } else if (typeof setPrefsField === "function") {
        setPrefsField("gender", gender);
      } else {
        showGlobalModal("설정", "성별 저장 함수가 스토어에 없습니다. (setPrefs/setPref/setPrefsField)");
      }
    },
    [showGlobalModal]
  );

  const languageOptions = useMemo(
    () => [
      { key: "ko", label: "한국어" },
      { key: "en", label: "English" },
      { key: "ja", label: "日本語" },
      { key: "zh", label: "中文" },
      { key: "es", label: "Español" },
    ],
    []
  );

  const countryOptions = useMemo(
    () => [
      { key: "KR", name: "Korea" },
      { key: "US", name: "United States" },
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
      { key: "AU", name: "Australia" },
      { key: "CA", name: "Canada" },
      { key: "GB", name: "United Kingdom" },
      { key: "DE", name: "Germany" },
      { key: "FR", name: "France" },
      { key: "ES", name: "Spain" },
      { key: "IT", name: "Italy" },
      { key: "BR", name: "Brazil" },
      { key: "MX", name: "Mexico" },
    ],
    []
  );

  const genderOptions = useMemo(
    () => [
      { key: "male", label: "남성" },
      { key: "female", label: "여성" },
    ],
    []
  );

  const currentLanguageLabel = useMemo(() => {
    const cur = String(prefs.language || "");
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur || "미설정";
  }, [languageOptions, prefs.language]);

  const currentCountryDisplay = useMemo(() => {
    const cur = String(prefs.country || "").toUpperCase();
    const found = countryOptions.find((x) => x.key === cur);
    const nm = found ? found.name : cur || "미설정";
    const cc = found ? found.key : cur;
    const flag = isoToFlag(cc);
    if (!cc) return nm;
    return `${flag ? flag + " " : ""}${nm} (${cc})`;
  }, [countryOptions, isoToFlag, prefs.country]);

  const currentGenderLabel = useMemo(() => {
    const cur = String(prefs.gender || "");
    const found = genderOptions.find((x) => x.key === cur);
    return found ? found.label : cur || "미설정";
  }, [genderOptions, prefs.gender]);

  const permOk = Boolean(permState.cam && permState.mic && permState.loc);

  const onPressMatch = useCallback(() => {
    if (Platform.OS === "android" && !permOk) {
      setPermModal(true);
      requestPermissions();
      return;
    }

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
      try {
        unsubClosed?.();
      } catch {}
      try {
        unsubLoaded?.();
      } catch {}
      try {
        unsubError?.();
      } catch {}
      unsubClosed = null;
      unsubLoaded = null;
      unsubError = null;
    };

    unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      cleanup();
      runOnce();
    });

    unsubLoaded = ad.addAdEventListener(AdEventType.LOADED, () => {
      try {
        ad.show();
      } catch {
        cleanup();
        runOnce();
      }
    });

    unsubError = ad.addAdEventListener(AdEventType.ERROR, () => {
      cleanup();
      runOnce();
    });

    try {
      ad.load();
    } catch {
      cleanup();
      runOnce();
      return;
    }

    setTimeout(() => {
      cleanup();
      runOnce();
    }, 1500);
  }, [canMatch, goCall, isPremium, permOk, requestPermissions]);

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <View style={styles.center}>
          <AppText style={styles.title}>랜덤 영상채팅</AppText>
          <AppText style={styles.sub}>지역/언어/성별을 설정한 뒤 매칭을 시작하세요.</AppText>

          <View style={styles.matchBtnWrap}>
            <PrimaryButton title="매칭하기" onPress={onPressMatch} />
          </View>

          <Pressable
            onPress={() => setPermModal(true)}
            style={({ pressed }) => [styles.smallLink, pressed ? { opacity: 0.6 } : null]}
          >
            <AppText style={styles.smallLinkText}>권한 설정</AppText>
          </Pressable>
        </View>
      </View>

      {!isPremium ? (
        <View style={[styles.banner, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          <BannerBar />
        </View>
      ) : null}

      <AppModal
        visible={permModal}
        title=""
        dismissible={false}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton
              title={permBusy ? "요청 중..." : permOk ? "모든 권한 허용됨" : "권한 허용하기"}
              onPress={requestPermissions}
              disabled={permBusy || permOk}
            />
            <PrimaryButton title="닫기" onPress={() => setPermModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.permTitle}>권한이 필요합니다</AppText>
        <AppText style={styles.modalText}>아래 권한을 허용해야 영상채팅을 시작할 수 있습니다.</AppText>

        <View style={{ height: 12 }} />

        <View style={styles.permList}>
          <View style={styles.permRow}>
            <AppText style={[styles.permLeft, !permState.cam ? styles.permLeftNeed : null]}>• 카메라</AppText>
            {!permState.cam ? <AppText style={styles.permNeed}>(권한허용필요)</AppText> : null}
          </View>

          <View style={styles.permRow}>
            <AppText style={[styles.permLeft, !permState.mic ? styles.permLeftNeed : null]}>• 마이크(소리)</AppText>
            {!permState.mic ? <AppText style={styles.permNeed}>(권한허용필요)</AppText> : null}
          </View>

          <View style={styles.permRow}>
            <AppText style={[styles.permLeft, !permState.loc ? styles.permLeftNeed : null]}>• 위치(GPS)</AppText>
            {!permState.loc ? <AppText style={styles.permNeed}>(권한허용필요)</AppText> : null}
          </View>
        </View>
      </AppModal>

      <AppModal
        visible={prefsModal}
        title="설정"
        dismissible={true}
        onClose={() => {
          setPrefsModal(false);
          setLangOpen(false);
          setCountryOpen(false);
          setGenderOpen(false);
        }}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="닫기" onPress={() => setPrefsModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.modalText}>나라/언어/성별을 설정하세요.</AppText>

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>나라(지역)</AppText>

        <View style={{ height: 0 }} />

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
                const active = String(prefs.country || "").toUpperCase() === opt.key;
                const flag = isoToFlag(opt.key);
                return (
                  <Pressable
                    key={opt.key}
                    onPress={() => {
                      setCountry(opt.key);
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

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>언어</AppText>

        <View style={{ height: 0 }} />

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
              const active = String(prefs.language || "") === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setLanguage(opt.key);
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

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>성별</AppText>

        <View style={{ height: 0 }} />

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
              const active = String(prefs.gender || "") === opt.key;
              return (
                <Pressable
                  key={opt.key}
                  onPress={() => {
                    setGender(opt.key);
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

        <View style={{ height: 0 }} />

        <AppText style={styles.sectionTitle}>글자 크기</AppText>
        <AppText style={styles.modalText}>바를 좌우로 드래그해서 조절하세요. ({Math.round(fontScale * 100)}%)</AppText>
        <FontSizeSlider value={fontScale} onChange={setFontScale} />
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  body: { flex: 1, padding: theme.spacing.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12 },
  title: { fontSize: 26, fontWeight: "700", color: theme.colors.text },
  sub: { fontSize: 14, color: theme.colors.sub, textAlign: "center", lineHeight: 20 },
  matchBtnWrap: { width: "100%", maxWidth: 420 },

  banner: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.line,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
  },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  headerBtnText: { fontSize: 22, color: theme.colors.text, fontWeight: "700" },

  smallLink: { paddingVertical: 8, paddingHorizontal: 8 },
  smallLinkText: { color: theme.colors.sub, textDecorationLine: "underline" },

  modalText: { fontSize: 14, color: theme.colors.sub, lineHeight: 20 },

  permTitle: { fontSize: 18, fontWeight: "900", color: theme.colors.text, marginBottom: 6 },
  permList: { width: "100%", gap: 8 },
  permRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  permLeft: { fontSize: 14, color: theme.colors.text, fontWeight: "800" },
  permLeftNeed: { color: "#ff4d4f" },
  permNeed: { fontSize: 12, color: "#ff4d4f", fontWeight: "900" },

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

  dropdownList: {
    width: "100%",
    marginTop: 8,
    gap: 8,
  },

  dropdownListWrap: {
    width: "100%",
    marginTop: 8,
    borderRadius: 12,
    overflow: "hidden",
  },
  dropdownScroll: {
    maxHeight: 210,
  },
  dropdownScrollContent: {
    gap: 8,
  },

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
  dropdownRowActive: {
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.cardSoft,
  },
  dropdownText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  dropdownTextActive: { color: theme.colors.pinkDeep },
  dropdownCheck: { fontSize: 14, color: theme.colors.pinkDeep, fontWeight: "900" },

  countryRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  countryCode: { fontSize: 12, color: theme.colors.sub, fontWeight: "800" },
  countryCodeActive: { color: theme.colors.pinkDeep },
});
