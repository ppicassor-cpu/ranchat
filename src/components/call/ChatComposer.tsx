import React, { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "../../i18n/LanguageProvider";

type ChatComposerProps = {
  styles: any;
  visible: boolean;
  insetsBottom: number;
  controlsBottom: number;
  chatInputRef: React.RefObject<TextInput | null>;
  chatInput: string;
  setChatInput: (text: string) => void;
  sendChat: () => void;
  onBackdropPress: () => void;
  onInputFocus: () => void;
};

export default function ChatComposer({
  styles,
  visible,
  insetsBottom,
  controlsBottom,
  chatInputRef,
  chatInput,
  setChatInput,
  sendChat,
  onBackdropPress,
  onInputFocus,
}: ChatComposerProps) {
  const { t } = useTranslation();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [noKeyboardFallbackActive, setNoKeyboardFallbackActive] = useState(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const subShow = Keyboard.addListener(showEvent as any, (evt: any) => {
      setKeyboardVisible(true);
      const nextHeight = Number(evt?.endCoordinates?.height ?? 0);
      setKeyboardHeight(Number.isFinite(nextHeight) ? Math.max(0, Math.trunc(nextHeight)) : 0);
    });
    const subHide = Keyboard.addListener(hideEvent as any, () => {
      setKeyboardVisible(false);
      setKeyboardHeight(0);
    });

    return () => {
      try {
        subShow.remove();
      } catch {}
      try {
        subHide.remove();
      } catch {}
    };
  }, []);

  useEffect(() => {
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current);
      fallbackTimerRef.current = null;
    }

    if (!visible) {
      setNoKeyboardFallbackActive(false);
      return;
    }

    if (keyboardVisible) {
      setNoKeyboardFallbackActive(false);
      return;
    }

    fallbackTimerRef.current = setTimeout(() => {
      setNoKeyboardFallbackActive(true);
      fallbackTimerRef.current = null;
    }, 380);

    return () => {
      if (fallbackTimerRef.current) {
        clearTimeout(fallbackTimerRef.current);
        fallbackTimerRef.current = null;
      }
    };
  }, [keyboardVisible, visible]);

  const dockSpacing = useMemo(() => {
    const baseBottom = Math.max(insetsBottom, 8);
    if (keyboardVisible) {
      // Android: lift by keyboard height so the composer never stays behind the IME.
      const keyboardLift = Platform.OS === "android" ? Math.max(0, keyboardHeight - insetsBottom) : 0;
      const extraClearance = Platform.OS === "android" ? 48 : 0;
      return baseBottom + 4 + keyboardLift + extraClearance;
    }
    if (visible && noKeyboardFallbackActive) {
      // Emulator/LDPlayer fallback: lift composer above bottom controls toward center area.
      return baseBottom + Math.max(controlsBottom + 96, 150);
    }
    return baseBottom + 10;
  }, [controlsBottom, insetsBottom, keyboardHeight, keyboardVisible, noKeyboardFallbackActive, visible]);

  return (
    <View pointerEvents={visible ? "auto" : "none"} style={[styles.chatComposerOverlay, visible ? null : styles.chatComposerOverlayHidden]}>
      <View style={styles.chatComposerModalBackdrop}>
        <Pressable style={styles.chatComposerBackdropHit} onPress={onBackdropPress} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          keyboardVerticalOffset={0}
          style={styles.chatComposerModalWrap}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.chatComposerDock,
              { paddingBottom: dockSpacing },
              visible ? null : styles.chatComposerDockHidden,
            ]}
          >
            <View style={styles.chatInputRow}>
              <TextInput
                ref={chatInputRef}
                style={styles.chatInput}
                value={chatInput}
                onChangeText={setChatInput}
                placeholder={t("chat.input_placeholder")}
                placeholderTextColor="rgba(255,255,255,0.45)"
                returnKeyType="send"
                onSubmitEditing={sendChat}
                blurOnSubmit={false}
                showSoftInputOnFocus
                onFocus={onInputFocus}
              />
              <Pressable
                onPress={sendChat}
                style={({ pressed }) => [
                  styles.chatSendBtn,
                  pressed ? { opacity: 0.75 } : null,
                ]}
              >
                <Ionicons name="send" size={18} color="#f3cddb" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </View>
  );
}
