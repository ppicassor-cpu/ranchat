import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Pressable, StyleSheet, Switch, View, Text } from "react-native";
import Slider from "@react-native-community/slider";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type BeautyPreset = "none" | "warm" | "cool" | "mono";

export type BeautyConfig = {
  enabled: boolean;
  preset: BeautyPreset;
  brightness: number;
  saturation: number;
  contrast: number;
  bgFocus: boolean;
  bgFocusStrength: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;

  config?: BeautyConfig;
  defaultConfig?: Partial<BeautyConfig>;
  onConfigChange?: (config: BeautyConfig) => void;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const clamp11 = (v: number) => Math.max(-1, Math.min(1, v));

const DEFAULT_CONFIG: BeautyConfig = {
  enabled: false,
  preset: "none",
  brightness: 0.5,
  saturation: 0.5,
  contrast: 0.5,
  bgFocus: false,
  bgFocusStrength: 0,
};

type ControlKey = "brightness" | "saturation" | "contrast" | "focus";

export default function CallBeautySheet({ visible, onClose, config, defaultConfig, onConfigChange }: Props) {
  const insets = useSafeAreaInsets();

  const sheetH = useMemo(() => {
    const h = Dimensions.get("window").height;
    const prefer = Math.round(h * 0.18);
    return Math.max(190, prefer);
  }, []);

  const translateY = useRef(new Animated.Value(sheetH)).current;
  const sliderAnim = useRef(new Animated.Value(0)).current;

  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState<ControlKey | null>(null);

  const [inner, setInner] = useState<BeautyConfig>(() => {
    const d = { ...DEFAULT_CONFIG, ...(defaultConfig ?? {}) } as BeautyConfig;
    return {
      enabled: Boolean(d.enabled),
      preset: (d.preset ?? "none") as BeautyPreset,
      brightness: clamp01(Number(d.brightness ?? DEFAULT_CONFIG.brightness)),
      saturation: clamp01(Number(d.saturation ?? DEFAULT_CONFIG.saturation)),
      contrast: clamp01(Number(d.contrast ?? DEFAULT_CONFIG.contrast)),
      bgFocus: Boolean(d.bgFocus ?? DEFAULT_CONFIG.bgFocus),
      bgFocusStrength: clamp01(Number(d.bgFocusStrength ?? DEFAULT_CONFIG.bgFocusStrength)),
    };
  });

  const current = config ?? inner;
  const controlled = config != null;

  const commit = (next: BeautyConfig) => {
    const fixed: BeautyConfig = {
      enabled: Boolean(next.enabled),
      preset: (next.preset ?? "none") as BeautyPreset,
      brightness: clamp01(Number(next.brightness ?? 0.5)),
      saturation: clamp01(Number(next.saturation ?? 0.5)),
      contrast: clamp01(Number(next.contrast ?? 0.5)),
      bgFocus: Boolean(next.bgFocus),
      bgFocusStrength: clamp01(Number(next.bgFocusStrength ?? 0)),
    };

    if (!controlled) setInner(fixed);
    onConfigChange?.(fixed);
  };

  const update = (patch: Partial<BeautyConfig>) => {
    const next: BeautyConfig = {
      ...current,
      ...patch,
      enabled: Boolean(patch.enabled ?? current.enabled),
      preset: (patch.preset ?? current.preset ?? "none") as BeautyPreset,
      brightness: clamp01(Number(patch.brightness ?? current.brightness ?? 0.5)),
      saturation: clamp01(Number(patch.saturation ?? current.saturation ?? 0.5)),
      contrast: clamp01(Number(patch.contrast ?? current.contrast ?? 0.5)),
      bgFocus: Boolean(patch.bgFocus ?? current.bgFocus),
      bgFocusStrength: clamp01(Number(patch.bgFocusStrength ?? current.bgFocusStrength ?? 0)),
    };

    commit(next);
  };

  const showSlider = (k: ControlKey | null) => {
    setActive(k);
    Animated.timing(sliderAnim, {
      toValue: k ? 1 : 0,
      duration: 140,
      useNativeDriver: true,
    }).start();
  };

  const toggleFocus = () => {
    const nextOn = !Boolean(current.bgFocus);
    if (nextOn) {
      const s = Number(current.bgFocusStrength ?? 0);
      update({ bgFocus: true, bgFocusStrength: s > 0.001 ? s : 0.55 });
      showSlider("focus");
    } else {
      update({ bgFocus: false });
      showSlider(null);
    }
  };

  const togglePreset = (p: BeautyPreset) => {
    const now = (current.preset ?? "none") as BeautyPreset;
    update({ preset: now === p ? "none" : p });
  };

  useEffect(() => {
    if (visible) setMounted(true);

    Animated.timing(translateY, {
      toValue: visible ? 0 : sheetH,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      if (!visible) {
        showSlider(null);
        setMounted(false);
      }
    });
  }, [visible, sheetH, translateY]);

  if (!mounted) return null;

  const sBrightnessUi = clamp11((clamp01(Number(current.brightness ?? 0.5)) - 0.5) * 2);
  const sSaturationUi = clamp11((clamp01(Number(current.saturation ?? 0.5)) - 0.5) * 2);
  const sContrastUi = clamp11((clamp01(Number(current.contrast ?? 0.5)) - 0.5) * 2);
  const sFocus = clamp01(Number(current.bgFocusStrength ?? 0));

  const sliderValue =
    active === "brightness"
      ? sBrightnessUi
      : active === "saturation"
      ? sSaturationUi
      : active === "contrast"
      ? sContrastUi
      : active === "focus"
      ? sFocus
      : 0;

  const sliderMin = active === "focus" ? 0 : -1;
  const sliderMax = 1;

  const onSlider = (v: number) => {
    const x = clamp11(v);

    if (active === "brightness") update({ brightness: clamp01(0.5 + x * 0.5) });
    else if (active === "saturation") update({ saturation: clamp01(0.5 + x * 0.5) });
    else if (active === "contrast") update({ contrast: clamp01(0.5 + x * 0.5) });
    else if (active === "focus") update({ bgFocusStrength: clamp01(Math.max(0, x)) });
  };

  const iconBtn = (k: ControlKey | null, icon: any, onPress: () => void, highlighted?: boolean, isOn?: boolean) => {
    const isActive = k ? active === k : false;
    const onState = typeof isOn === "boolean" ? isOn : true;
    const hi = typeof highlighted === "boolean" ? highlighted : isActive;

    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.iconBtn,
          hi ? styles.iconBtnActive : null,
          !onState ? styles.iconBtnOff : null,
          pressed ? { opacity: 0.75 } : null,
        ]}
      >
        <Ionicons name={icon} size={22} color={hi ? "#a0738a" : "#a0738a"} />
      </Pressable>
    );
  };

  const preset = (current.preset ?? "none") as BeautyPreset;
  const padBottom = Math.max(insets.bottom, 0) + 0;

  return (
    <View style={styles.root} pointerEvents={visible ? "auto" : "none"}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <Animated.View style={[styles.sheet, { height: sheetH, paddingBottom: padBottom, transform: [{ translateY }] }]}>
        <View style={styles.handle} />

        <View style={styles.topRow}>
          <View style={styles.topSliderWrap} pointerEvents={active ? "auto" : "none"}>
            <Animated.View
              style={[
                styles.topSliderAnim,
                {
                  opacity: sliderAnim,
                  transform: [{ translateY: sliderAnim.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
                },
              ]}
            >
              <View style={styles.topSliderFrame}>
                <View style={styles.sliderTrackWrap}>
                  <View style={styles.zeroBar} />
                  <Slider
                    value={sliderValue}
                    minimumValue={sliderMin}
                    maximumValue={sliderMax}
                    step={0.01}
                    onValueChange={onSlider}
                    style={styles.sliderInner}
                    minimumTrackTintColor={"rgba(255,255,255,0.85)"}
                    maximumTrackTintColor={"rgba(104, 103, 103, 0.53)"}
                    thumbTintColor={"#ffffff"}
                  />
                </View>
              </View>
            </Animated.View>
          </View>

          <View style={styles.toggleWrap}>
            <Text style={styles.toggleLabel}>{current.enabled ? "ON" : "OFF"}</Text>
            <Switch
              value={Boolean(current.enabled)}
              onValueChange={(v) => update({ enabled: v })}
              trackColor={{ false: "rgba(255,255,255,0.35)", true: "rgba(255,255,255,0.72)" }}
              thumbColor={"#ffffff"}
            />
          </View>
        </View>

        <View style={styles.iconRow}>
          {iconBtn(null, "flame-outline", () => togglePreset("warm"), preset === "warm")}
          {iconBtn(null, "snow-outline", () => togglePreset("cool"), preset === "cool")}
          {iconBtn(null, "contrast-outline", () => togglePreset("mono"), preset === "mono")}

          {iconBtn("brightness", "flash-outline", () => showSlider(active === "brightness" ? null : "brightness"))}
          {iconBtn("saturation", "color-palette-outline", () => showSlider(active === "saturation" ? null : "saturation"))}
          {iconBtn("contrast", "options-outline", () => showSlider(active === "contrast" ? null : "contrast"))}
          {iconBtn("focus", "scan-outline", toggleFocus, Boolean(current.bgFocus))}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.12)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#ffd0f5",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 10,
    paddingHorizontal: 14,
    overflow: "hidden",
  },
  handle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.64)",
    marginBottom: 8,
  },
  topRow: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
    marginBottom: 10,
  },
  topSliderWrap: {
    flex: 1,
    marginRight: 6,
    height: 44,
    justifyContent: "center",
    overflow: "hidden",
  },
  topSliderAnim: {
    width: 280,
  },
  topSliderFrame: {
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "rgba(177, 163, 171, 0.32)",
    overflow: "hidden",
  },
  sliderTrackWrap: {
    position: "relative",
    marginHorizontal: 6,
  },
  sliderInner: {
    marginHorizontal: 0,
  },
  zeroBar: {
    position: "absolute",
    left: "50%",
    top: 8,
    bottom: 8,
    width: 2,
    borderRadius: 1,
    transform: [{ translateX: -1 }],
    backgroundColor: "rgba(255, 255, 255, 0.51)",
  },
  toggleWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  toggleLabel: {
    fontSize: 12,
    fontWeight: "900",
    color: "rgba(25,25,25,0.78)",
    width: 34,
    textAlign: "right",
  },
  iconRow: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  iconBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255, 255, 255, 0.7)",
  },
  iconBtnActive: {
    backgroundColor: "rgba(247, 159, 207, 0.78)",
  },
  iconBtnOff: {
    opacity: 0.45,
  },
});