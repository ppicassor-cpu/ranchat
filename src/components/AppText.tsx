import React, { useMemo } from "react";
import { Text, TextProps, TextStyle, StyleProp } from "react-native";
import { useAppStore } from "../store/useAppStore";

function scaleOneStyle(s: TextStyle, scale: number): TextStyle {
  const out: TextStyle = { ...s };

  if (typeof out.fontSize === "number") out.fontSize = Math.round(out.fontSize * scale);
  if (typeof out.lineHeight === "number") out.lineHeight = Math.round(out.lineHeight * scale);

  // fontWeight 700 초과 방지
  if (typeof out.fontWeight === "string") {
    const n = Number(out.fontWeight);
    if (!Number.isNaN(n) && n > 700) out.fontWeight = "700";
  }

  return out;
}

function scaleStyle(style: StyleProp<TextStyle>, scale: number): StyleProp<TextStyle> {
  if (!style) return style;

  if (Array.isArray(style)) {
    return style.map((x) => scaleStyle(x as any, scale)) as any;
  }

  if (typeof style === "object") {
    return scaleOneStyle(style as TextStyle, scale);
  }

  return style;
}

type Props = TextProps & {
  children?: React.ReactNode;
  ignoreUiScale?: boolean;
};

export default function AppText(props: Props) {
  const scale = useAppStore((s) => s.ui.fontScale);
  const { ignoreUiScale = false, style, children, ...rest } = props;
  const effectiveScale = ignoreUiScale ? 1 : scale;

  const scaledStyle = useMemo(() => scaleStyle(style as any, effectiveScale), [style, effectiveScale]);

  return (
    <Text {...rest} allowFontScaling={false} maxFontSizeMultiplier={1} style={scaledStyle}>
      {children}
    </Text>
  );
}
