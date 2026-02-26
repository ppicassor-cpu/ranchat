import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import AppText from "../components/AppText";
import { theme } from "../config/theme";
import { useAppStore } from "../store/useAppStore";
import { useTranslation } from "../i18n/LanguageProvider";

type PickerKind = "year" | "month" | "day" | "hour";

type FortuneResult = {
  dateText: string;
  overall: number;
  love: number;
  money: number;
  work: number;
  matching: number;
  overallText: string;
  loveText: string;
  moneyText: string;
  workText: string;
  matchingText: string;
};

type FortuneTextSets = {
  overall: string[];
  love: string[];
  money: string[];
  work: string[];
  matching: string[];
};

const WHEEL_ITEM_HEIGHT = 52;
const WHEEL_VISIBLE_COUNT = 5;
const WHEEL_HEIGHT = WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_COUNT;
const WHEEL_CENTER_TOP = (WHEEL_HEIGHT - WHEEL_ITEM_HEIGHT) / 2;
const MAGIC_BALL_IMAGE = require("../../assets/magic-ball-realistic.png");

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function pad2(value: number) {
  return `${value}`.padStart(2, "0");
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function hashSeed(input: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(seedText: string) {
  let x = hashSeed(seedText) >>> 0;
  return () => {
    x = (Math.imul(1664525, x) + 1013904223) >>> 0;
    return x / 4294967296;
  };
}

function pickText(rand: () => number, texts: string[]) {
  const idx = Math.floor(rand() * texts.length);
  return texts[clamp(idx, 0, texts.length - 1)];
}

function buildFortune(
  name: string,
  birthDate: string,
  birthHour: string,
  locale: string,
  texts: FortuneTextSets
): FortuneResult {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const todayKey = `${yyyy}-${mm}-${dd}`;

  const seed = `${name.trim()}|${birthDate}|${birthHour}|${todayKey}`;
  const rand = makeRng(seed);
  const pick = (min: number, max: number) => Math.round(min + rand() * (max - min));

  const love = clamp(pick(45, 98), 0, 100);
  const money = clamp(pick(40, 96), 0, 100);
  const work = clamp(pick(42, 97), 0, 100);
  const matching = clamp(pick(70, 99), 70, 100);
  const baseOverall = Math.round(love * 0.24 + money * 0.22 + work * 0.24 + matching * 0.3);
  const overall = clamp(baseOverall + Math.round((rand() - 0.5) * 6), 0, 100);

  return {
    dateText: now.toLocaleDateString(locale, {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
    }),
    overall,
    love,
    money,
    work,
    matching,
    overallText: pickText(rand, texts.overall),
    loveText: pickText(rand, texts.love),
    moneyText: pickText(rand, texts.money),
    workText: pickText(rand, texts.work),
    matchingText: pickText(rand, texts.matching),
  };
}

function ScoreRow({
  icon,
  label,
  score,
  scoreText,
  color,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  score: number;
  scoreText: string;
  color: string;
  text: string;
}) {
  return (
    <View style={styles.scoreCard}>
      <View style={styles.scoreHead}>
        <View style={styles.scoreLeft}>
          <Ionicons name={icon} size={18} color={color} />
          <AppText style={styles.scoreLabel}>{label}</AppText>
        </View>
        <AppText style={[styles.scoreValue, { color }]}>{scoreText}</AppText>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${score}%`, backgroundColor: color }]} />
      </View>
      <AppText style={styles.scoreDesc}>{text}</AppText>
    </View>
  );
}

function ScoreTile({
  icon,
  label,
  score,
  scoreText,
  color,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  score: number;
  scoreText: string;
  color: string;
  text: string;
}) {
  return (
    <View style={styles.scoreTile}>
      <View style={styles.scoreTileHead}>
        <View style={styles.scoreTileLabelWrap}>
          <Ionicons name={icon} size={14} color={color} />
          <AppText style={styles.scoreTileLabel}>{label}</AppText>
        </View>
        <AppText style={[styles.scoreTileValue, { color }]}>{scoreText}</AppText>
      </View>
      <View style={styles.scoreTileTrack}>
        <View style={[styles.scoreTileFill, { width: `${score}%`, backgroundColor: color }]} />
      </View>
      <AppText numberOfLines={3} style={styles.scoreTileDesc}>
        {text}
      </AppText>
    </View>
  );
}

function DropdownWheel({
  kind,
  openKind,
  valueText,
  values,
  selectedValue,
  suffix,
  onToggle,
  onChange,
  onClose,
}: {
  kind: PickerKind;
  openKind: PickerKind | null;
  valueText: string;
  values: number[];
  selectedValue: number;
  suffix: string;
  onToggle: (kind: PickerKind) => void;
  onChange: (kind: PickerKind, value: number) => void;
  onClose: () => void;
}) {
  const listRef = useRef<FlatList<number> | null>(null);
  const open = openKind === kind;
  const selectedIndex = Math.max(0, values.indexOf(selectedValue));

  useEffect(() => {
    if (!open) return;
    const initialIndex = Math.max(0, values.indexOf(selectedValue));
    const t = setTimeout(() => {
      listRef.current?.scrollToOffset({
        offset: initialIndex * WHEEL_ITEM_HEIGHT,
        animated: false,
      });
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const updateByOffset = (offsetY: number) => {
    const idx = clamp(Math.round(offsetY / WHEEL_ITEM_HEIGHT), 0, Math.max(0, values.length - 1));
    const next = values[idx];
    if (next != null) onChange(kind, next);
  };

  return (
    <View style={[styles.dropdownWrap, open ? styles.dropdownWrapOpen : null]}>
      <Pressable
        onPress={() => onToggle(kind)}
        style={({ pressed }) => [styles.pickerButton, open ? styles.pickerButtonOpen : null, pressed ? { opacity: 0.86 } : null]}
      >
        <View style={styles.pickerButtonValueRow}>
          <AppText style={styles.pickerButtonValue}>{valueText}</AppText>
          <Ionicons name={open ? "chevron-up" : "chevron-down"} size={16} color="#875d70" />
        </View>
      </Pressable>

      {open ? (
        <View style={styles.inlineWheelCard}>
          <FlatList
            ref={listRef}
            data={values}
            nestedScrollEnabled
            scrollEnabled
            keyboardShouldPersistTaps="always"
            extraData={selectedValue}
            keyExtractor={(item) => `${item}`}
            showsVerticalScrollIndicator
            snapToInterval={WHEEL_ITEM_HEIGHT}
            decelerationRate="fast"
            bounces={false}
            scrollEventThrottle={16}
            contentContainerStyle={{ paddingVertical: WHEEL_CENTER_TOP }}
            getItemLayout={(_, index) => ({
              length: WHEEL_ITEM_HEIGHT,
              offset: WHEEL_ITEM_HEIGHT * index,
              index,
            })}
            onMomentumScrollEnd={(e) => updateByOffset(e.nativeEvent.contentOffset.y)}
            onScrollEndDrag={(e) => updateByOffset(e.nativeEvent.contentOffset.y)}
            renderItem={({ item, index }) => {
              const distance = index - selectedIndex;
              const absDistance = Math.abs(distance);
              const rotateX = clamp(distance * -18, -62, 62);
              const scale = clamp(1 - absDistance * 0.16, 0.56, 1);
              const opacity = clamp(1 - absDistance * 0.25, 0.2, 1);
              const active = index === selectedIndex;

              return (
                <Pressable
                  onPress={() => {
                    onChange(kind, item);
                    listRef.current?.scrollToOffset({ offset: index * WHEEL_ITEM_HEIGHT, animated: true });
                    onClose();
                  }}
                  style={styles.wheelItem}
                >
                  <View
                    style={[
                      styles.wheelItemCore,
                      active ? styles.wheelItemCoreActive : styles.wheelItemCorePassive,
                      {
                        opacity,
                        transform: [{ perspective: 960 }, { rotateX: `${rotateX}deg` }, { scale }],
                      },
                    ]}
                  >
                    <LinearGradient
                      colors={
                        active
                          ? ["rgba(254,242,250,0.98)", "rgba(249,206,231,0.98)", "rgba(241,160,201,0.95)"]
                          : ["rgba(255,255,255,0.95)", "rgba(252,238,246,0.9)", "rgba(255,255,255,0.95)"]
                      }
                      style={StyleSheet.absoluteFill}
                    />
                    <LinearGradient
                      pointerEvents="none"
                      colors={["rgba(255,255,255,0.5)", "rgba(255,255,255,0)", "rgba(255,255,255,0.28)"]}
                      start={{ x: 0.5, y: 0 }}
                      end={{ x: 0.5, y: 1 }}
                      style={StyleSheet.absoluteFill}
                    />
                    <AppText style={[styles.wheelItemText, active ? styles.wheelItemTextActive : null]}>
                      {item}
                      {suffix}
                    </AppText>
                  </View>
                </Pressable>
              );
            }}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.97)", "rgba(255,255,255,0.06)"]}
            style={styles.wheelTopFade}
          />
          <LinearGradient
            pointerEvents="none"
            colors={["rgba(255,255,255,0.06)", "rgba(255,255,255,0.97)"]}
            style={styles.wheelBottomFade}
          />
        </View>
      ) : null}
    </View>
  );
}

export default function FortuneScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t, currentLang } = useTranslation();
  const callMatchedSignal = useAppStore((s: any) => Number(s.ui?.callMatchedSignal ?? 0));
  const now = useMemo(() => new Date(), []);
  const thisYear = now.getFullYear();
  const localeTag = useMemo(() => {
    const lang = String(currentLang || "en").toLowerCase();
    if (lang === "ko") return "ko-KR";
    if (lang === "ja") return "ja-JP";
    if (lang === "zh") return "zh-CN";
    if (lang === "es") return "es-ES";
    if (lang === "de") return "de-DE";
    if (lang === "fr") return "fr-FR";
    if (lang === "it") return "it-IT";
    if (lang === "ru") return "ru-RU";
    return "en-US";
  }, [currentLang]);
  const fortuneTexts = useMemo<FortuneTextSets>(
    () => ({
      overall: Array.from({ length: 10 }, (_, i) => t(`fortune.text.overall.${i + 1}`)),
      love: Array.from({ length: 10 }, (_, i) => t(`fortune.text.love.${i + 1}`)),
      money: Array.from({ length: 10 }, (_, i) => t(`fortune.text.money.${i + 1}`)),
      work: Array.from({ length: 10 }, (_, i) => t(`fortune.text.work.${i + 1}`)),
      matching: Array.from({ length: 10 }, (_, i) => t(`fortune.text.matching.${i + 1}`)),
    }),
    [currentLang, t]
  );

  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = thisYear; y >= 1950; y -= 1) arr.push(y);
    return arr;
  }, [thisYear]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => i + 1), []);
  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);

  const [name, setName] = useState("");
  const [year, setYear] = useState(2000);
  const [month, setMonth] = useState(1);
  const [day, setDay] = useState(1);
  const [birthHour, setBirthHour] = useState(12);
  const [error, setError] = useState("");
  const [openPicker, setOpenPicker] = useState<PickerKind | null>(null);

  const [result, setResult] = useState<FortuneResult | null>(null);
  const [resultName, setResultName] = useState("");
  const [resultVisible, setResultVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [matchedModalVisible, setMatchedModalVisible] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSignalRef = useRef(callMatchedSignal);
  const handledSignalRef = useRef(callMatchedSignal);
  const spinValue = useRef(new Animated.Value(0)).current;
  const pulseValue = useRef(new Animated.Value(0)).current;
  const spinRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseRef = useRef<Animated.CompositeAnimation | null>(null);

  const dayMax = useMemo(() => daysInMonth(year, month), [year, month]);
  const days = useMemo(() => Array.from({ length: dayMax }, (_, i) => i + 1), [dayMax]);

  useEffect(() => {
    if (day > dayMax) setDay(dayMax);
  }, [day, dayMax]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (matchedTimerRef.current) {
        clearTimeout(matchedTimerRef.current);
        matchedTimerRef.current = null;
      }
      spinRef.current?.stop();
      pulseRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!callMatchedSignal) return;
    if (callMatchedSignal === initialSignalRef.current) return;
    if (callMatchedSignal === handledSignalRef.current) return;
    if (matchedModalVisible) return;
    if (matchedTimerRef.current) return;
    handledSignalRef.current = callMatchedSignal;

    setMatchedModalVisible(true);
    matchedTimerRef.current = setTimeout(() => {
      matchedTimerRef.current = null;
      setMatchedModalVisible(false);
      if (navigation.canGoBack()) navigation.goBack();
    }, 1400);
  }, [callMatchedSignal, matchedModalVisible, navigation]);

  useEffect(() => {
    if (!isLoading) {
      spinRef.current?.stop();
      pulseRef.current?.stop();
      return;
    }

    spinValue.setValue(0);
    pulseValue.setValue(0);

    const spinLoop = Animated.loop(
      Animated.timing(spinValue, {
        toValue: 1,
        duration: 2200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseValue, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseValue, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    spinRef.current = spinLoop;
    pulseRef.current = pulseLoop;
    spinLoop.start();
    pulseLoop.start();
  }, [isLoading, pulseValue, spinValue]);

  const canCreate = name.trim().length > 0 && !isLoading;
  const selectedDateText = `${year}-${pad2(month)}-${pad2(day)}`;

  const spin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const reverseSpin = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-360deg"],
  });
  const pulse = pulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1.06],
  });
  const twinkle = pulseValue.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });

  const onChangePicker = (kind: PickerKind, value: number) => {
    if (kind === "year") setYear(value);
    if (kind === "month") setMonth(value);
    if (kind === "day") setDay(value);
    if (kind === "hour") setBirthHour(value);
  };

  const onPressCreate = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("fortune.error_name_required"));
      return;
    }

    setError("");
    setOpenPicker(null);
    const nextResult = buildFortune(trimmed, selectedDateText, pad2(birthHour), localeTag, fortuneTexts);
    setResultName(trimmed);
    setIsLoading(true);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setIsLoading(false);
      setResult(nextResult);
      setResultVisible(true);
    }, 5000);
  };

  return (
    <ScrollView
      style={styles.root}
      scrollEnabled={!openPicker}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 12, paddingBottom: Math.max(insets.bottom, 20) + 20 },
      ]}
    >
      <View style={styles.headerCard}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="sparkles" size={20} color="#d66a96" />
          <AppText style={styles.headerTitle}>{t("fortune.title")}</AppText>
        </View>
        <AppText style={styles.headerSub}>
          {t("fortune.subtitle")}
        </AppText>
      </View>

      <View style={styles.formCard}>
        <AppText style={styles.label}>{t("fortune.name_label")}</AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder={t("fortune.name_placeholder")}
          placeholderTextColor="#b78da1"
          style={styles.input}
        />

        <AppText style={styles.label}>{t("fortune.birthdate_label")}</AppText>
        <View style={[styles.pickerRow, openPicker && openPicker !== "hour" ? styles.pickerRowOpen : null]}>
          <View style={styles.pickerCell}>
            <DropdownWheel
              kind="year"
              openKind={openPicker}
              valueText={`${year}`}
              values={years}
              selectedValue={year}
              suffix=""
              onToggle={(kind) => setOpenPicker((prev) => (prev === kind ? null : kind))}
              onChange={onChangePicker}
              onClose={() => setOpenPicker(null)}
            />
          </View>
          <View style={styles.pickerCell}>
            <DropdownWheel
              kind="month"
              openKind={openPicker}
              valueText={pad2(month)}
              values={months}
              selectedValue={month}
              suffix=""
              onToggle={(kind) => setOpenPicker((prev) => (prev === kind ? null : kind))}
              onChange={onChangePicker}
              onClose={() => setOpenPicker(null)}
            />
          </View>
          <View style={styles.pickerCell}>
            <DropdownWheel
              kind="day"
              openKind={openPicker}
              valueText={pad2(day)}
              values={days}
              selectedValue={day}
              suffix=""
              onToggle={(kind) => setOpenPicker((prev) => (prev === kind ? null : kind))}
              onChange={onChangePicker}
              onClose={() => setOpenPicker(null)}
            />
          </View>
        </View>

        <AppText style={styles.label}>{t("fortune.birthhour_label")}</AppText>
        <View style={[styles.hourPickerHost, openPicker && openPicker !== "hour" ? styles.hourPickerHostUnder : null]}>
          <DropdownWheel
            kind="hour"
            openKind={openPicker}
            valueText={pad2(birthHour)}
            values={hours}
            selectedValue={birthHour}
            suffix=""
            onToggle={(kind) => setOpenPicker((prev) => (prev === kind ? null : kind))}
            onChange={onChangePicker}
            onClose={() => setOpenPicker(null)}
          />
        </View>

        {error ? <AppText style={styles.errorText}>{error}</AppText> : null}

        <Pressable
          onPress={onPressCreate}
          disabled={!canCreate}
          style={({ pressed }) => [styles.runBtn, !canCreate ? styles.runBtnDisabled : null, pressed ? { opacity: 0.82 } : null]}
        >
          <Ionicons name="sparkles-outline" size={18} color="#fff" />
          <AppText style={styles.runBtnText}>{t("fortune.view_button")}</AppText>
        </Pressable>
      </View>

      <Modal visible={isLoading} transparent animationType="fade">
        <View style={styles.loadingBackdrop}>
          <View style={styles.loadingCard}>
            <LinearGradient
              pointerEvents="none"
              colors={["rgba(130,90,255,0.15)", "rgba(110,180,255,0.04)", "rgba(255,120,190,0.12)"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.loadingMist}
            />
            <View style={styles.orbStage}>
              <Animated.View style={[styles.magicAura, { transform: [{ rotate: spin }, { scale: pulse }] }]}>
                <LinearGradient
                  colors={["rgba(93,140,255,0.1)", "rgba(189,120,255,0.55)", "rgba(255,110,176,0.25)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.magicAuraRing}
                />
              </Animated.View>
              <Animated.View style={[styles.magicAuraOuter, { transform: [{ rotate: reverseSpin }] }]}>
                <LinearGradient
                  colors={["rgba(255,255,255,0.05)", "rgba(186,144,255,0.3)", "rgba(255,140,215,0.08)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.magicAuraOuterRing}
                />
              </Animated.View>

              <Animated.View style={[styles.ballWrap, { transform: [{ scale: pulse }] }]}>
                <View style={styles.magicBallPhotoFrame}>
                  <Image source={MAGIC_BALL_IMAGE} style={styles.magicBallPhoto} resizeMode="cover" />
                  <LinearGradient
                    pointerEvents="none"
                    colors={["rgba(255,255,255,0.42)", "rgba(255,255,255,0.06)", "rgba(255,255,255,0.01)"]}
                    start={{ x: 0.14, y: 0.06 }}
                    end={{ x: 0.8, y: 0.86 }}
                    style={styles.magicBallGloss}
                  />
                </View>
              </Animated.View>
              <Animated.View style={[styles.twinkleCluster, { opacity: twinkle }]}>
                <View style={[styles.twinkleDot, { top: 4, left: 10 }]} />
                <View style={[styles.twinkleDotSmall, { top: 18, right: 14 }]} />
                <View style={[styles.twinkleDotSmall, { bottom: 8, left: 34 }]} />
              </Animated.View>
            </View>

            <AppText style={styles.loadingTitle}>{t("fortune.loading_title")}</AppText>
            <AppText style={styles.loadingSub}>{t("fortune.loading_sub")}</AppText>
          </View>
        </View>
      </Modal>

      <Modal visible={matchedModalVisible} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.matchedBackdrop}>
          <View style={styles.matchedCard}>
            <Ionicons name="checkmark-circle" size={26} color="#53b27f" />
            <AppText style={styles.matchedTitle}>{t("fortune.matched_title")}</AppText>
            <AppText style={styles.matchedDesc}>{t("fortune.matched_desc")}</AppText>
          </View>
        </View>
      </Modal>

      <Modal visible={resultVisible && !!result} transparent animationType="slide" onRequestClose={() => setResultVisible(false)}>
        <View style={styles.resultBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setResultVisible(false)} />
          <View style={[styles.resultSheet, { paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
            <View style={styles.sheetHandle} />
            <AppText style={styles.resultTitle}>{t("fortune.result_title")}</AppText>
            <AppText style={styles.resultHello}>{t("fortune.result_hello", { name: resultName || t("fortune.default_name") })}</AppText>

            {result ? (
              <ScrollView style={styles.resultScroll} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
                <View style={styles.dateCard}>
                  <Ionicons name="calendar-outline" size={18} color="#a35a7b" />
                  <AppText style={styles.dateText}>{result.dateText}</AppText>
                </View>

                <View style={styles.scoreGrid}>
                  <ScoreTile
                    icon="star"
                    label={t("fortune.label.overall")}
                    score={result.overall}
                    scoreText={t("fortune.score_value", { score: result.overall })}
                    color="#d66a96"
                    text={result.overallText}
                  />
                  <ScoreTile
                    icon="heart"
                    label={t("fortune.label.love")}
                    score={result.love}
                    scoreText={t("fortune.score_value", { score: result.love })}
                    color="#e45a78"
                    text={result.loveText}
                  />
                  <ScoreTile
                    icon="cash"
                    label={t("fortune.label.money")}
                    score={result.money}
                    scoreText={t("fortune.score_value", { score: result.money })}
                    color="#2e9b7e"
                    text={result.moneyText}
                  />
                  <ScoreTile
                    icon="briefcase"
                    label={t("fortune.label.work")}
                    score={result.work}
                    scoreText={t("fortune.score_value", { score: result.work })}
                    color="#4a7bdc"
                    text={result.workText}
                  />
                </View>

                <ScoreRow
                  icon="people"
                  label={t("fortune.label.matching")}
                  score={result.matching}
                  scoreText={t("fortune.score_value", { score: result.matching })}
                  color="#a95ed5"
                  text={result.matchingText}
                />

                <AppText style={styles.disclaimer}>
                  {t("fortune.disclaimer")}
                </AppText>
              </ScrollView>
            ) : null}

            <Pressable
              onPress={() => setResultVisible(false)}
              style={({ pressed }) => [styles.resultCloseBtn, pressed ? { opacity: 0.82 } : null]}
            >
              <AppText style={styles.resultCloseBtnText}>{t("common.close")}</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  content: {
    paddingHorizontal: 16,
    gap: 12,
  },
  headerCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 18,
    padding: 14,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: theme.colors.text,
  },
  headerSub: {
    color: theme.colors.sub,
    fontSize: 13,
    lineHeight: 19,
  },
  formCard: {
    position: "relative",
    overflow: "visible",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 18,
    padding: 14,
    gap: 8,
  },
  label: {
    marginTop: 2,
    fontSize: 13,
    color: theme.colors.sub,
    fontWeight: "700",
    zIndex: 6,
  },
  input: {
    zIndex: 6,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.colors.line,
    paddingHorizontal: 12,
    backgroundColor: "#fff7fb",
    color: theme.colors.text,
    fontSize: 15,
  },
  pickerRow: {
    zIndex: 8,
    flexDirection: "row",
    gap: 8,
    overflow: "visible",
  },
  pickerRowOpen: {
    zIndex: 320,
    elevation: 60,
  },
  pickerCell: {
    flex: 1,
    zIndex: 8,
    overflow: "visible",
  },
  hourPickerHost: {
    zIndex: 8,
    overflow: "visible",
  },
  hourPickerHostUnder: {
    zIndex: 2,
    elevation: 0,
  },
  dropdownWrap: {
    position: "relative",
    zIndex: 8,
    overflow: "visible",
  },
  dropdownWrapOpen: {
    zIndex: 360,
    elevation: 80,
  },
  pickerButton: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: "#f1cadb",
    borderRadius: 12,
    backgroundColor: "#fff7fb",
    paddingHorizontal: 10,
    paddingVertical: 10,
    justifyContent: "center",
  },
  pickerButtonOpen: {
    borderColor: "#dd82b1",
    backgroundColor: "#ffeef6",
  },
  pickerButtonValueRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pickerButtonValue: {
    fontSize: 15,
    color: theme.colors.text,
    fontWeight: "800",
  },
  inlineWheelCard: {
    position: "relative",
    width: "100%",
    marginTop: 8,
    height: WHEEL_HEIGHT,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#e5b1ca",
    backgroundColor: "#fff9fc",
    shadowColor: "#4a1740",
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 260,
  },
  wheelItem: {
    height: WHEEL_ITEM_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
  wheelItemCore: {
    width: "90%",
    height: 42,
    borderRadius: 999,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  wheelItemCoreActive: {
    borderColor: "rgba(200,93,150,0.75)",
    shadowColor: "#d264a4",
    shadowOpacity: 0.36,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  wheelItemCorePassive: {
    borderColor: "rgba(232,198,216,0.65)",
  },
  wheelItemText: {
    fontSize: 19,
    color: "#936b7e",
    fontWeight: "700",
  },
  wheelItemTextActive: {
    color: "#6f1f46",
    fontWeight: "900",
  },
  wheelTopFade: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: WHEEL_ITEM_HEIGHT * 1.35,
    zIndex: 4,
  },
  wheelBottomFade: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: WHEEL_ITEM_HEIGHT * 1.35,
    zIndex: 4,
  },
  errorText: {
    marginTop: 4,
    fontSize: 12,
    color: theme.colors.danger,
    fontWeight: "700",
    zIndex: 6,
  },
  runBtn: {
    zIndex: 6,
    marginTop: 10,
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.colors.pinkDeep,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  runBtnDisabled: {
    opacity: 0.55,
  },
  runBtnText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
  loadingBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 330,
    borderRadius: 24,
    paddingVertical: 26,
    paddingHorizontal: 18,
    alignItems: "center",
    backgroundColor: "#0f0f23",
    borderWidth: 1,
    borderColor: "rgba(193,144,255,0.4)",
    overflow: "hidden",
  },
  loadingMist: {
    ...StyleSheet.absoluteFillObject,
  },
  orbStage: {
    width: 230,
    height: 230,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  magicAura: {
    position: "absolute",
    width: 180,
    height: 180,
    left: 25,
    top: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  magicAuraOuter: {
    position: "absolute",
    width: 230,
    height: 230,
    left: 0,
    top: 0,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.7,
  },
  magicAuraOuterRing: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },
  magicAuraRing: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },
  ballWrap: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 0,
  },
  magicBallPhotoFrame: {
    width: 120,
    height: 120,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    shadowColor: "#a95eff",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  magicBallPhoto: {
    width: "100%",
    height: "100%",
  },
  magicBall: {
    width: 120,
    height: 120,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.35)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "#a95eff",
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  magicBallGloss: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },
  ballIcon: {
    opacity: 0.9,
  },
  twinkleCluster: {
    position: "absolute",
    width: 90,
    height: 56,
    top: 26,
    right: 24,
  },
  twinkleDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.95)",
  },
  twinkleDotSmall: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,230,255,0.85)",
  },
  starDot: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: "rgba(250,240,255,0.9)",
  },
  starDotSmall: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,236,248,0.8)",
  },
  loadingTitle: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
  },
  loadingSub: {
    marginTop: 6,
    fontSize: 12,
    color: "rgba(255,255,255,0.76)",
    fontWeight: "600",
  },
  resultBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  matchedBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 26,
  },
  matchedCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e8d8e2",
    backgroundColor: "#fff",
    paddingHorizontal: 18,
    paddingVertical: 18,
    alignItems: "center",
    gap: 7,
  },
  matchedTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: theme.colors.text,
  },
  matchedDesc: {
    fontSize: 13,
    color: theme.colors.sub,
    lineHeight: 18,
    textAlign: "center",
  },
  resultSheet: {
    maxHeight: "88%",
    backgroundColor: "#fff",
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "#e3d3da",
    alignSelf: "center",
    marginBottom: 10,
  },
  resultTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: theme.colors.text,
    textAlign: "center",
    marginBottom: 10,
  },
  resultHello: {
    marginBottom: 10,
    textAlign: "center",
    fontSize: 14,
    color: "#6e4a5c",
    fontWeight: "700",
  },
  resultScroll: {
    maxHeight: "82%",
  },
  dateCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#ffe6f1",
    borderWidth: 1,
    borderColor: "#f4bfd7",
  },
  dateText: {
    color: "#7a4a62",
    fontSize: 13,
    fontWeight: "700",
  },
  scoreCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 14,
    padding: 12,
    gap: 8,
  },
  scoreGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  scoreTile: {
    width: "48%",
    minHeight: 132,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: theme.colors.line,
    borderRadius: 14,
    padding: 10,
    gap: 7,
  },
  scoreTileHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  scoreTileLabelWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  scoreTileLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.colors.text,
  },
  scoreTileValue: {
    fontSize: 12,
    fontWeight: "900",
  },
  scoreTileTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#f5e3ec",
    overflow: "hidden",
  },
  scoreTileFill: {
    height: "100%",
    borderRadius: 999,
  },
  scoreTileDesc: {
    fontSize: 11,
    lineHeight: 15,
    color: theme.colors.sub,
  },
  scoreHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  scoreLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  scoreLabel: {
    fontSize: 14,
    color: theme.colors.text,
    fontWeight: "800",
  },
  scoreValue: {
    fontSize: 14,
    fontWeight: "900",
  },
  barTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#f5e3ec",
    overflow: "hidden",
  },
  barFill: {
    height: "100%",
    borderRadius: 999,
  },
  scoreDesc: {
    fontSize: 12,
    color: theme.colors.sub,
    lineHeight: 17,
  },
  disclaimer: {
    marginTop: 6,
    fontSize: 11,
    color: "#9a8a93",
    lineHeight: 15,
    textAlign: "center",
  },
  resultCloseBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: 12,
    backgroundColor: theme.colors.pinkDeep,
    alignItems: "center",
    justifyContent: "center",
  },
  resultCloseBtnText: {
    fontSize: 15,
    color: "#fff",
    fontWeight: "800",
  },
});
