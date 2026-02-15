// FILE: C:\ranchat\src\screens\HomeScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { PermissionsAndroid, Platform, Pressable, StyleSheet, View } from "react-native";
import { theme } from "../config/theme";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { BannerBar, createInterstitial } from "../services/ads/AdManager";
import { useAppStore } from "../store/useAppStore";
import { AdEventType } from "react-native-google-mobile-ads";
import AppText from "../components/AppText";
import FontSizeSlider from "../components/FontSizeSlider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Location from "expo-location";

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

  const hasAndroidPermission = useCallback(async (perm: string) => {
    try {
      const r = await PermissionsAndroid.check(perm as any);
      return Boolean(r);
    } catch {
      return false;
    }
  }, []);

  const applyCountryFromGPS = useCallback(async () => {
    try {
      const enabled = await Location.hasServicesEnabledAsync();
      if (!enabled) return;

      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return;

      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const rev = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });

      const iso = String(rev?.[0]?.isoCountryCode || "").toUpperCase();
      if (!iso) return;

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
      }
    } catch {}
  }, []);

  const checkPermissions = useCallback(async () => {
    if (Platform.OS !== "android") {
      setPermModal(false);
      return;
    }

    const cam = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.CAMERA);
    const mic = await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    const loc =
      (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
      (await hasAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));

    const ok = cam && mic && loc;
    setPermModal(!ok);

    if (ok) {
      applyCountryFromGPS();
    }
  }, [applyCountryFromGPS, hasAndroidPermission]);

  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  const requestPermissions = useCallback(async () => {
    if (permBusy) return;
    setPermBusy(true);

    try {
      if (Platform.OS !== "android") {
        setPermModal(false);
        return;
      }

      const results: Record<string, string> = {};

      results.camera = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.CAMERA);
      results.mic = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      results.loc = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);

      const ok =
        results.camera === PermissionsAndroid.RESULTS.GRANTED &&
        results.mic === PermissionsAndroid.RESULTS.GRANTED &&
        results.loc === PermissionsAndroid.RESULTS.GRANTED;

      if (!ok) {
        showGlobalModal("권한", "카메라/마이크/위치(GPS) 권한이 필요합니다.");
        setPermModal(true);
      } else {
        setPermModal(false);
        applyCountryFromGPS();
      }
    } catch {
      showGlobalModal("권한", "권한 요청에 실패했습니다.");
      setPermModal(true);
    } finally {
      setPermBusy(false);
    }
  }, [applyCountryFromGPS, permBusy, showGlobalModal]);

  const goCall = useCallback(() => {
    navigation.navigate("Call");
  }, [navigation]);

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
  }, [canMatch, goCall, isPremium]);

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

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        <View style={styles.center}>
          <AppText style={styles.title}>랜덤 영상채팅</AppText>
          <AppText style={styles.sub}>지역/언어/성별을 설정한 뒤 매칭을 시작하세요.</AppText>

          {/* ✅ 버튼 박스 크게 */}
          <View style={styles.matchBtnWrap}>
            <PrimaryButton title="매칭하기" onPress={onPressMatch} />
          </View>

          {/* ✅ 설정 열기 → 권한 설정 */}
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
        title="권한이 필요합니다"
        dismissible={false}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={permBusy ? "요청 중..." : "권한 허용하기"} onPress={requestPermissions} disabled={permBusy} />
            <PrimaryButton title="닫기" onPress={() => setPermModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.modalText}>
          아래 권한을 허용해야 영상채팅을 시작할 수 있습니다.{"\n"}
          {"\n"}• 카메라{"\n"}• 마이크(소리){"\n"}• 위치(GPS: 나라 자동 설정)
        </AppText>

        <View style={{ height: 12 }} />

        <PrimaryButton title="GPS로 나라 자동 설정" onPress={applyCountryFromGPS} variant="ghost" />
      </AppModal>

      <AppModal
        visible={prefsModal}
        title="설정"
        dismissible={true}
        onClose={() => setPrefsModal(false)}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="닫기" onPress={() => setPrefsModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.modalText}>지역/성별은 프로필에서 변경합니다.</AppText>

        <View style={{ height: 12 }} />

        <AppText style={styles.sectionTitle}>언어 선택</AppText>
        <AppText style={styles.sectionSub}>매칭에 사용할 언어를 선택하세요. (현재: {String(prefs.language || "미설정")})</AppText>

        <View style={{ height: 10 }} />

        <View style={styles.langList}>
          {languageOptions.map((opt) => {
            const active = String(prefs.language || "") === opt.key;
            return (
              <Pressable
                key={opt.key}
                onPress={() => setLanguage(opt.key)}
                style={({ pressed }) => [
                  styles.langRow,
                  active ? styles.langRowActive : null,
                  pressed ? { opacity: 0.7 } : null,
                ]}
              >
                <AppText style={[styles.langText, active ? styles.langTextActive : null]}>{opt.label}</AppText>
                {active ? <AppText style={styles.langCheck}>✓</AppText> : null}
              </Pressable>
            );
          })}
        </View>

        <View style={{ height: 16 }} />

        <AppText style={styles.sectionTitle}>글자 크기</AppText>
        <AppText style={styles.sectionSub}>바를 좌우로 드래그해서 조절하세요. ({Math.round(fontScale * 100)}%)</AppText>
        <FontSizeSlider value={fontScale} onChange={setFontScale} />

        <View style={{ height: 14 }} />

        <PrimaryButton
          title="프로필로 이동"
          onPress={() => {
            setPrefsModal(false);
            navigation.navigate("Profile");
          }}
        />
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

  // ✅ 매칭 버튼 크게(가로 꽉)
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

  sectionTitle: { fontSize: 14, fontWeight: "700", color: theme.colors.text },
  sectionSub: { fontSize: 12, fontWeight: "700", color: theme.colors.sub, lineHeight: 18 },

  langList: { width: "100%", gap: 8, marginTop: 6 },
  langRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    backgroundColor: theme.colors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  langRowActive: {
    borderColor: theme.colors.pinkDeep,
    backgroundColor: theme.colors.cardSoft,
  },
  langText: { fontSize: 14, color: theme.colors.text, fontWeight: "700" },
  langTextActive: { color: theme.colors.pinkDeep },
  langCheck: { fontSize: 14, color: theme.colors.pinkDeep, fontWeight: "900" },
});
