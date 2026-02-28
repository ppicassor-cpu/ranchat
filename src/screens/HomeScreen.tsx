// FILE: C:\ranchat\src\screens\HomeScreen.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View, ScrollView, ImageBackground, Image } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
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
import { COUNTRY_CODES, LANGUAGE_CODES, getCountryName, getLanguageName, normalizeLanguageCode } from "../i18n/displayNames";
import * as Updates from "expo-updates";
import { APP_CONFIG } from "../config/app";
import usePopTalk from "../hooks/usePopTalk";
import { POPTALK_MATCH_BLOCK_THRESHOLD, POPTALK_REWARDED_AMOUNT } from "../constants/popTalkConfig";
import { fetchUnifiedWalletState } from "../services/shop/ShopPurchaseService";

const POPTALK_BALANCE_ICON = require("../../assets/poptalk_ICON.png");
const KERNEL_BALANCE_ICON = require("../../assets/kernel.png");
const HOME_WALLET_POLL_INTERVAL_MS = 60000;
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
  const [activeUsers, setActiveUsers] = useState(0);
  const [bannerH, setBannerH] = useState(0);
  const [bannerReady, setBannerReady] = useState(false);

  const [langOpen, setLangOpen] = useState(false);
  const [countryOpen, setCountryOpen] = useState(false);
  const [genderOpen, setGenderOpen] = useState(false);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchBlockedModal, setMatchBlockedModal] = useState(false);
  const [rewardAdFailModal, setRewardAdFailModal] = useState(false);
  const [rewardAdFailCount, setRewardAdFailCount] = useState(0);

  const interstitialRef = useRef<any>(null);

  const onBannerLoaded = useCallback(() => {
    setBannerReady(true);
  }, []);

  const onBannerFailed = useCallback(() => {
    setBannerReady(false);
    setBannerH(0);
  }, []);

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

  const goShop = useCallback(() => {
    navigation.navigate("Shop");
  }, [navigation]);

  const myPopTalkBalance = useMemo(() => {
    const live = Number(popTalk?.balance ?? 0);
    const charged = Number(assets?.popcornCount ?? 0);
    return Math.max(0, Math.trunc(live + charged));
  }, [assets?.popcornCount, popTalk?.balance]);

  const kernelBalance = useMemo(() => {
    return Math.max(0, Math.trunc(Number(assets?.kernelCount ?? 0)));
  }, [assets?.kernelCount]);

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
        <AppText style={styles.walletValue}>{myPopTalkBalance.toLocaleString("ko-KR")}</AppText>
      </View>
      <View style={styles.walletChip}>
        <Image source={KERNEL_BALANCE_ICON} style={styles.walletIcon} resizeMode="contain" />
        <AppText style={styles.walletValue}>{kernelBalance.toLocaleString("ko-KR")}</AppText>
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
      onPressIn={openPrefs}
      style={({ pressed }) => [styles.headerBtn, pressed ? { opacity: 0.6 } : null]}
    >
      <Ionicons name="settings-outline" size={22} color={theme.colors.text} />
    </Pressable>
  </View>
), [goShop, kernelBalance, myPopTalkBalance, openPrefs]);

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

useEffect(() => {
  const fetchActiveUsers = async () => {
    try {
      const base = String(APP_CONFIG.AUTH_HTTP_BASE_URL || "").replace(/\/+$/, "");
      const path = String((APP_CONFIG as any)?.ACTIVE_USERS_PATH || "/api/active-users");
      const normalizedPath = path.startsWith("/") ? path : `/${path}`;
      const res = await fetch(`${base}${normalizedPath}`);
      const data = await res.json();
      const activeCount = Number(data.activeUsers) || 0;
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
      walletPopcorn: number;
      walletKernel: number;
    }) => {
      setPopTalk({
        balance: Number(out.popTalkBalance ?? 0),
        cap: Number(out.popTalkCap ?? 0),
        plan: out.popTalkPlan || null,
        serverNowMs: out.popTalkServerNowMs ?? null,
        syncedAtMs: Date.now(),
      });
      setAssets({
        popcornCount: Number(out.walletPopcorn ?? 0),
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
      const planId = String(sub?.planId || "").trim();
      const storeProductId = String(sub?.storeProductId || "").trim();
      const isPremiumNow = Boolean(sub?.isPremium);

      const syncNow = async () => {
        if (!token || !userId || closed) return;
        const out = await fetchUnifiedWalletState({
          token,
          userId,
          deviceKey,
          planId,
          storeProductId,
          isPremium: isPremiumNow,
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
          try {
            ws.send(
              JSON.stringify({
                type: "wallet_subscribe",
                token,
                userId,
                deviceKey,
                planId,
                storeProductId,
                isPremium: isPremiumNow,
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
            applyUnifiedState({
              popTalkBalance: Number(data?.popTalk?.balance ?? 0),
              popTalkCap: Number(data?.popTalk?.cap ?? 0),
              popTalkPlan: String(data?.popTalk?.plan || "") || null,
              popTalkServerNowMs: Number.isFinite(Number(data?.popTalk?.serverNowMs)) ? Number(data?.popTalk?.serverNowMs) : null,
              walletPopcorn: Number(data?.wallet?.popcornBalance ?? 0),
              walletKernel: Number(data?.wallet?.kernelBalance ?? 0),
            });
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
    }, [applyUnifiedState, auth?.deviceKey, auth?.token, auth?.userId, sub?.isPremium, sub?.planId, sub?.storeProductId])
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

  const currentLanguageLabel = useMemo(() => {
    const cur = normalizeLanguageCode(String(prefs.language || ""));
    const found = languageOptions.find((x) => x.key === cur);
    return found ? found.label : cur ? getLanguageName(t, cur) : t("common.not_set");
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
      try { ad.show(); } catch { cleanup(); runOnce(); }
    });
    unsubError = ad.addAdEventListener(AdEventType.ERROR, () => { cleanup(); runOnce(); });

    try { ad.load(); } catch { cleanup(); runOnce(); return; }

    setTimeout(() => { cleanup(); runOnce(); }, 1500);
  }, [canMatch, goCall, isPremium, matchBusy, refreshPopTalk]);

  return (
    <View style={styles.root}>
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <ImageBackground
          source={require("../../assets/back.png")}
          style={[
            StyleSheet.absoluteFillObject,
            !isPremium && bannerReady && bannerH > 0 ? { transform: [{ translateY: -bannerH }] } : null,
          ]}
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
            {t("home.runtime_info", {
              runtime: Updates.runtimeVersion ?? "-",
              update: Updates.updateId ? Updates.updateId.slice(-4) : "-",
              users: String(activeUsers).padStart(6, "0"),
            })}
          </AppText>        
        </View>
      </View>

      {!isPremium ? (
        <View
          onLayout={(e) => {
            if (!bannerReady) return;
            setBannerH(e.nativeEvent.layout.height);
          }}
          style={[
            styles.banner,
            bannerReady ? { paddingBottom: Math.max(insets.bottom, 8) } : styles.bannerHidden,
          ]}
        >
          <BannerBar onAdLoaded={onBannerLoaded} onAdFailedToLoad={onBannerFailed} />
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
          {t("poptalk.balance_label", {
            balance: Number(popTalk?.balance ?? 0),
            cap: Number(popTalk?.cap ?? 0),
          })}
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
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "transparent",
    alignItems: "center",
  },
  bannerHidden: {
    height: 0,
    paddingBottom: 0,
    overflow: "hidden",
    opacity: 0,
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
