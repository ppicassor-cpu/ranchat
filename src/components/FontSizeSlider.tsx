//C:\ranchat\src\components\FontSizeSlider.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { LayoutChangeEvent, PanResponder, StyleSheet, View } from "react-native";
import { theme } from "../config/theme";

type Props = {
  value: number;          // 예: 1.0
  min?: number;           // 기본 0.85
  max?: number;           // 기본 1.25
  onChange: (v: number) => void;
};

export default function FontSizeSlider({ value, min = 0.85, max = 1.25, onChange }: Props) {
  const [w, setW] = useState(1);
  const draggingRef = useRef(false);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const pct = useMemo(() => {
    const p = (value - min) / (max - min);
    return Math.min(1, Math.max(0, p));
  }, [value, min, max]);

  const knobLeft = useMemo(() => Math.round(pct * (w - 18)), [pct, w]);

  const setFromX = (x: number) => {
    const p = Math.min(1, Math.max(0, x / (w - 18)));
    const v = min + p * (max - min);
    onChange(Number(clamp(v).toFixed(2)));
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          draggingRef.current = true;
          const x = evt.nativeEvent.locationX - 9;
          setFromX(x);
        },
        onPanResponderMove: (_evt, g) => {
          // g.moveX는 화면 절대좌표라서 locationX 기반으로 처리하기가 더 안정적임
        },
        onPanResponderRelease: () => {
          draggingRef.current = false;
        },
      }),
    [w, min, max]
  );

  // move 이벤트는 View의 onTouchMove에서 locationX로 처리 (RN에서 가장 덜 꼬임)
  const onTouchMove = (evt: any) => {
    if (!draggingRef.current) return;
    const x = evt?.nativeEvent?.locationX - 9;
    if (typeof x === "number") setFromX(x);
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const next = Math.max(1, Math.floor(e.nativeEvent.layout.width));
    setW(next);
  };

  useEffect(() => {
    if (!Number.isFinite(value)) onChange(1);
  }, [value, onChange]);

  return (
    <View style={styles.wrap} onLayout={onLayout} {...pan.panHandlers} onTouchMove={onTouchMove}>
      <View style={styles.track} />
      <View style={[styles.fill, { width: Math.max(0, knobLeft + 9) }]} />
      <View style={[styles.knob, { left: knobLeft }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    height: 28,
    justifyContent: "center",
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.line,
  },
  fill: {
    position: "absolute",
    left: 0,
    height: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.pinkDeep,
  },
  knob: {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 999,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.line,
  },
});
