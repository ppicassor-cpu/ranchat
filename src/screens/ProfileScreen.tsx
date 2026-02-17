// C:\ranchat\src\screens\ProfileScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import AppModal from "../components/AppModal";
import PrimaryButton from "../components/PrimaryButton";
import { theme } from "../config/theme";
import { useAppStore } from "../store/useAppStore";
import { refreshSubscription, openManageSubscriptions } from "../services/purchases/PurchaseManager";
import { APP_CONFIG, COUNTRY_OPTIONS } from "../config/app";
import AppText from "../components/AppText";
import { useNavigation } from "@react-navigation/native";
import * as Updates from "expo-updates";

function toErrMsg(e: unknown) {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) return String((e as any).message || "UNKNOWN_ERROR");
  return "UNKNOWN_ERROR";
}

export default function ProfileScreen() {
  const navigation = useNavigation<any>();

  const prefs = useAppStore((s) => s.prefs);
  const sub = useAppStore((s) => s.sub);
  const logoutAndWipe = useAppStore((s) => s.logoutAndWipe);

  const setPrefs = useAppStore((s) => s.setPrefs);
  const showGlobalModal = useAppStore((s) => s.showGlobalModal);

  const [prefsModal, setPrefsModal] = useState(false);
  const [withdrawModal, setWithdrawModal] = useState(false);

  const [updateModal, setUpdateModal] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const updateCheckedRef = useRef(false);

  const countryLabel = useMemo(() => {
    const c = COUNTRY_OPTIONS.find((x) => x.code === prefs.country);
    return c?.label ?? "-";
  }, [prefs.country]);

  useEffect(() => {
    if (__DEV__) return;
    if (!Updates.isEnabled) return;
    if (updateCheckedRef.current) return;
    updateCheckedRef.current = true;

    (async () => {
      try {
        const r = await Updates.checkForUpdateAsync();
        if (r.isAvailable) setUpdateModal(true);
      } catch {
        // 조용히 무시 (필요 시 글로벌 모달로 바꿔도 됨)
      }
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
      showGlobalModal("업데이트", toErrMsg(e));
    }
  };

  const openPrivacy = async () => {
    const url = APP_CONFIG.POLICY.privacyUrl;
    if (!url) {
      useAppStore.getState().showGlobalModal("정책", "개인정보처리방침 URL이 설정되지 않았습니다.");
      return;
    }
    await Linking.openURL(url);
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
        <AppText style={styles.h1}>구독 상태</AppText>
        <AppText style={styles.p}>{sub.isPremium ? "프리미엄 이용 중" : "무료 이용 중"}</AppText>

        <View style={{ height: 10 }} />

        {!sub.isPremium ? <PrimaryButton title="프리미엄 신청" onPress={goPremium} /> : null}
        <View style={{ height: 10 }} />
        <PrimaryButton title="구독 관리" onPress={openManageSubscriptions} variant="ghost" />
      </View>

      <View style={styles.card}>
        <AppText style={styles.h1}>개인정보</AppText>

        <View style={styles.row}>
          <AppText style={styles.k}>언어</AppText>
          <AppText style={styles.v}>{prefs.language === "ko" ? "한국어" : prefs.language === "en" ? "English" : "-"}</AppText>
        </View>
        <View style={styles.row}>
          <AppText style={styles.k}>나라</AppText>
          <AppText style={styles.v}>{countryLabel}</AppText>
        </View>
        <View style={styles.row}>
          <AppText style={styles.k}>성별</AppText>
          <AppText style={styles.v}>{prefs.gender === "male" ? "남성" : prefs.gender === "female" ? "여성" : "-"}</AppText>
        </View>

        <View style={{ height: 14 }} />

        <PrimaryButton title="개인정보 변경" onPress={() => setPrefsModal(true)} variant="ghost" />
      </View>

      <View style={styles.card}>
        <PrimaryButton title="개인정보 처리방침" onPress={openPrivacy} variant="ghost" />
        <View style={{ height: 10 }} />
        <PrimaryButton title="탈퇴하기" onPress={() => setWithdrawModal(true)} variant="danger" />
      </View>

      <PrefsModal visible={prefsModal} onClose={() => setPrefsModal(false)} prefs={prefs} setPrefs={setPrefs} />

      <AppModal
        visible={updateModal}
        title="업데이트"
        onClose={() => {
          if (updateBusy) return;
          setUpdateModal(false);
        }}
        dismissible={!updateBusy}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title={updateBusy ? "업데이트 적용 중..." : "업데이트 적용"} onPress={doApplyUpdate} disabled={updateBusy} />
            <PrimaryButton
              title="나중에"
              onPress={() => setUpdateModal(false)}
              variant="ghost"
              disabled={updateBusy}
            />
          </View>
        }
      >
        <AppText style={styles.p}>새 버전이 준비되었습니다. 업데이트를 적용하면 앱이 재시작됩니다.</AppText>
      </AppModal>

      <AppModal
        visible={withdrawModal}
        title="탈퇴하기"
        onClose={() => setWithdrawModal(false)}
        dismissible={true}
        footer={
          <View style={{ gap: 10 }}>
            <PrimaryButton title="탈퇴" onPress={doWithdraw} variant="danger" />
            <PrimaryButton title="취소" onPress={() => setWithdrawModal(false)} variant="ghost" />
          </View>
        }
      >
        <AppText style={styles.p}>탈퇴 시 로컬 데이터가 삭제되고 다시 인증이 필요합니다.</AppText>
      </AppModal>
    </ScrollView>
  );
}

function PrefsModal({
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
  const [language, setLanguage] = useState(prefs.language);
  const [country, setCountry] = useState(prefs.country);
  const [gender, setGender] = useState(prefs.gender);

  const save = () => {
    if (!language || !country || !gender) return;
    setPrefs({ language, country, gender });
    onClose();
  };

  return (
    <AppModal
      visible={visible}
      title="개인정보 변경"
      onClose={onClose}
      dismissible={true}
      footer={
        <View style={{ gap: 10 }}>
          <PrimaryButton title="저장" onPress={save} disabled={!language || !country || !gender} />
        </View>
      }
    >
      <AppText style={styles.p}>언어/나라/성별을 변경할 수 있습니다.</AppText>

      <View style={styles.pickerGroup}>
        <AppText style={styles.pickerTitle}>언어</AppText>
        <View style={styles.pickerRow}>
          <PickChip active={language === "ko"} label="한국어" onPress={() => setLanguage("ko")} />
          <PickChip active={language === "en"} label="English" onPress={() => setLanguage("en")} />
        </View>
      </View>

      <View style={styles.pickerGroup}>
        <AppText style={styles.pickerTitle}>나라</AppText>
        <View style={styles.countryWrap}>
          {COUNTRY_OPTIONS.map((c) => (
            <PickChip key={c.code} active={country === c.code} label={c.label} onPress={() => setCountry(c.code)} />
          ))}
        </View>
      </View>

      <View style={styles.pickerGroup}>
        <AppText style={styles.pickerTitle}>성별</AppText>
        <View style={styles.pickerRow}>
          <PickChip active={gender === "male"} label="남성" onPress={() => setGender("male")} />
          <PickChip active={gender === "female"} label="여성" onPress={() => setGender("female")} />
        </View>
      </View>
    </AppModal>
  );
}

function PickChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <AppText onPress={onPress} style={[styles.chip, active ? styles.chipOn : styles.chipOff, styles.chipTxt]}>
      {label}
    </AppText>
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

  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 8 },
  k: { fontSize: 13, color: theme.colors.sub, fontWeight: "700" },
  v: { fontSize: 13, color: theme.colors.text, fontWeight: "700" },

  pickerGroup: { marginTop: 10 },
  pickerTitle: { fontSize: 13, fontWeight: "700", color: theme.colors.text, marginBottom: 8 },
  pickerRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  countryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 10 },

  chip: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  chipOn: { backgroundColor: theme.colors.pinkDeep, borderColor: theme.colors.pinkDeep, color: theme.colors.white },
  chipOff: { backgroundColor: theme.colors.white, borderColor: theme.colors.line, color: theme.colors.text },
  chipTxt: { fontSize: 13, fontWeight: "700" },
});
