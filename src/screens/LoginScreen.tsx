import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from "react-native";
import { AntDesign } from "@expo/vector-icons";
import AppText from "../components/AppText";
import { theme } from "../config/theme";
import { useTranslation } from "../i18n/LanguageProvider";
import { useAppStore } from "../store/useAppStore";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import * as Updates from "expo-updates";
import { getOrCreateDeviceKey } from "../services/device/DeviceKey";
import {
  NativeProvider,
  exchangeAppleNativeIdentity,
  exchangeGoogleNativeIdentity,
  getAppleNativeIdentity,
  getGoogleNativeIdentity,
} from "../services/auth/NativeSocialLogin";
import { reportLoginEvent } from "../services/admin/LoginEventReporter";

function toErrMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message || "UNKNOWN_ERROR");
  return "UNKNOWN_ERROR";
}

function isCancelError(msg: string): boolean {
  const m = String(msg || "").toLowerCase();
  return m.includes("cancel");
}

function normalizeGoogleError(msg: string): string {
  const raw = String(msg || "");
  const lower = raw.toLowerCase();
  if (!lower.includes("developer_error")) return raw;
  return [
    "Google OAuth 설정 불일치(DEVELOPER_ERROR)입니다.",
    "Google Cloud Console에서 아래를 정확히 일치시켜야 합니다.",
    "- package: com.ranchat",
    "- SHA-1: 79:62:E5:1C:88:A1:EF:2E:D3:DD:AF:93:E3:B3:EF:65:63:8B:18:8D",
    "- SHA-256: EF:D6:74:08:F9:62:76:E3:CB:A2:7D:1D:58:36:38:34:29:2A:1D:AE:94:39:44:8B:72:84:EF:26:36:45:F3:E4",
    "- Web Client ID(.apps.googleusercontent.com)도 앱/서버에 설정 필요",
  ].join("\n");
}

function AuthProviderButton({
  provider,
  label,
  disabled,
  onPress,
}: {
  provider: NativeProvider;
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const isGoogle = provider === "google";

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.providerBtn,
        isGoogle ? styles.googleBtn : styles.appleBtn,
        disabled ? styles.providerDisabled : null,
        pressed ? styles.providerPressed : null,
      ]}
    >
      <View style={styles.providerIconWrap}>
        {isGoogle ? (
          <View style={styles.googleMark}>
            <View style={styles.googleMarkRing} />
            <View style={styles.googleMarkGap} />
            <View style={styles.googleMarkBar} />
          </View>
        ) : (
          <AntDesign name="apple" size={18} color="#FFFFFF" />
        )}
      </View>
      <AppText style={[styles.providerLabel, isGoogle ? styles.googleBtnText : styles.appleBtnText]}>{label}</AppText>
    </Pressable>
  );
}

export default function LoginScreen() {
  const { t } = useTranslation();
  const setAuth = useAppStore((s) => s.setAuth);
  const setDeviceKey = useAppStore((s) => s.setDeviceKey);
  const showGlobalModal = useAppStore((s) => s.showGlobalModal);

  const [busyProvider, setBusyProvider] = useState<NativeProvider | null>(null);
  const [updateModal, setUpdateModal] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const updateCheckedRef = useRef(false);

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

  const commitAuth = useCallback(
    (token: string, userId: string, deviceKey: string) => {
      setDeviceKey(deviceKey);
      setAuth({ token, userId, deviceKey, verified: true });
    },
    [setAuth, setDeviceKey]
  );

  const readLoginMonitorMeta = useCallback(() => {
    const st: any = useAppStore.getState?.() ?? {};
    const sub = st?.sub ?? {};
    const popTalk = st?.popTalk ?? {};
    const assets = st?.assets ?? {};
    const billing = st?.billing ?? {};
    const isPremium = Boolean(sub?.isPremium);

    return {
      subscriptionStatus: isPremium ? "paid" : "free",
      isPremium,
      planId: String(sub?.planId || ""),
      storeProductId: String(sub?.storeProductId || ""),
      popcornCount: Number(assets?.popcornCount ?? popTalk?.balance ?? 0),
      kernelCount: Number(assets?.kernelCount ?? assets?.kernels ?? 0),
      totalPaymentKrw: Number(billing?.totalPaidKrw ?? billing?.totalPaymentKrw ?? 0),
    };
  }, []);

  const onPressGoogle = useCallback(async () => {
    if (busyProvider) return;
    setBusyProvider("google");
    try {
      const deviceKey = await getOrCreateDeviceKey();
      const identity = await getGoogleNativeIdentity();
      const auth = await exchangeGoogleNativeIdentity({ ...identity, deviceKey });
      commitAuth(auth.token, auth.userId, deviceKey);
      reportLoginEvent({
        token: auth.token,
        userId: auth.userId,
        deviceKey,
        provider: "google_native",
        loginAccount: identity.email,
        ...readLoginMonitorMeta(),
      }).catch(() => undefined);
    } catch (e) {
      const msg = normalizeGoogleError(toErrMsg(e));
      if (!isCancelError(msg)) {
        showGlobalModal(t("auth.title"), msg);
      }
    } finally {
      setBusyProvider(null);
    }
  }, [busyProvider, commitAuth, readLoginMonitorMeta, showGlobalModal, t]);

  const onPressApple = useCallback(async () => {
    if (busyProvider) return;
    if (Platform.OS !== "ios") {
      showGlobalModal(t("auth.title"), t("login.apple_ios_only"));
      return;
    }

    setBusyProvider("apple");
    try {
      const deviceKey = await getOrCreateDeviceKey();
      const identity = await getAppleNativeIdentity();
      const auth = await exchangeAppleNativeIdentity({ ...identity, deviceKey });
      commitAuth(auth.token, auth.userId, deviceKey);
      reportLoginEvent({
        token: auth.token,
        userId: auth.userId,
        deviceKey,
        provider: "apple_native",
        loginAccount: identity.email,
        ...readLoginMonitorMeta(),
      }).catch(() => undefined);
    } catch (e) {
      const msg = toErrMsg(e);
      if (!isCancelError(msg)) {
        showGlobalModal(t("auth.title"), msg);
      }
    } finally {
      setBusyProvider(null);
    }
  }, [busyProvider, commitAuth, readLoginMonitorMeta, showGlobalModal, t]);

  const isLocked = Boolean(busyProvider);
  const statusText = useMemo(() => {
    if (busyProvider === "google") return t("login.wait_google_native");
    if (busyProvider === "apple") return t("login.wait_apple_native");
    return "";
  }, [busyProvider, t]);

  const doApplyUpdate = useCallback(async () => {
    if (updateBusy) return;
    setUpdateBusy(true);

    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e) {
      setUpdateBusy(false);
      showGlobalModal(t("modal.update.title"), toErrMsg(e));
    }
  }, [showGlobalModal, t, updateBusy]);

  return (
    <View style={styles.root}>
      <View style={styles.cardWrap}>
        <View style={styles.logoWrap}>
          <Image source={require("../../assets/ranchat_logo.png")} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={styles.card}>
          <AppText style={styles.title}>{t("login.title")}</AppText>
          <AppText style={styles.subtitle}>{t("login.subtitle_native")}</AppText>

          <View style={styles.buttonGroup}>
            <AuthProviderButton provider="google" label={t("login.google")} onPress={onPressGoogle} disabled={isLocked} />
            <AuthProviderButton provider="apple" label={t("login.apple")} onPress={onPressApple} disabled={isLocked} />
          </View>

          {isLocked ? (
            <View style={styles.waitingRow}>
              <ActivityIndicator size="small" color={theme.colors.pinkDeep} />
              <AppText style={styles.waitingText}>{statusText || t("common.loading")}</AppText>
            </View>
          ) : (
            <AppText style={styles.hint}>{t("login.hint_native")}</AppText>
          )}
        </View>
      </View>

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
        <AppText style={styles.updateBody}>{t("modal.update.body")}</AppText>
      </AppModal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
  },
  cardWrap: {
    width: "100%",
    maxWidth: 460,
    alignItems: "center",
    marginTop: 56,
  },
  card: {
    width: "100%",
    marginTop: 0,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 20,
    paddingVertical: 24,
    gap: 12,
    ...theme.shadow.card,
  },
  logo: {
    width: 104,
    height: 104,
    borderRadius: 24,
  },
  logoWrap: {
    width: "100%",
    alignItems: "center",
    marginBottom: 46,
    transform: [{ translateY: -30 }],
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    color: theme.colors.text,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: theme.colors.sub,
    textAlign: "center",
  },
  buttonGroup: {
    gap: 10,
    marginTop: 6,
  },
  providerBtn: {
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  providerPressed: {
    opacity: 0.85,
  },
  providerDisabled: {
    opacity: 0.6,
  },
  providerIconWrap: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  googleMark: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  googleMarkRing: {
    position: "absolute",
    width: 17,
    height: 17,
    borderRadius: 8.5,
    borderWidth: 2.4,
    borderTopColor: "#4285F4",
    borderRightColor: "#EA4335",
    borderBottomColor: "#34A853",
    borderLeftColor: "#FBBC05",
  },
  googleMarkGap: {
    position: "absolute",
    right: -1,
    top: 6,
    width: 6,
    height: 6,
    backgroundColor: "#FFFFFF",
  },
  googleMarkBar: {
    position: "absolute",
    right: 1,
    top: 8,
    width: 6,
    height: 2.4,
    borderRadius: 1.2,
    backgroundColor: "#4285F4",
  },
  providerLabel: {
    fontSize: 15,
    fontWeight: "800",
  },
  googleBtn: {
    borderColor: "#D9DCE1",
    backgroundColor: "#FFFFFF",
  },
  googleBtnText: {
    color: "#202124",
  },
  appleBtn: {
    borderColor: "#111111",
    backgroundColor: "#111111",
  },
  appleBtnText: {
    color: "#FFFFFF",
  },
  waitingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  waitingText: {
    fontSize: 13,
    color: theme.colors.sub,
    fontWeight: "700",
  },
  hint: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.sub,
    textAlign: "center",
  },
  updateBody: {
    fontSize: 14,
    color: theme.colors.sub,
    lineHeight: 20,
  },
});
