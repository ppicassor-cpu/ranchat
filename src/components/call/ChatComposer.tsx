import React from "react";
import { KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type ChatComposerProps = {
  styles: any;
  visible: boolean;
  insetsBottom: number;
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
  chatInputRef,
  chatInput,
  setChatInput,
  sendChat,
  onBackdropPress,
  onInputFocus,
}: ChatComposerProps) {
  return (
    <View pointerEvents={visible ? "auto" : "none"} style={[styles.chatComposerOverlay, visible ? null : styles.chatComposerOverlayHidden]}>
      <View style={styles.chatComposerModalBackdrop}>
        <Pressable style={styles.chatComposerBackdropHit} onPress={onBackdropPress} />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={0}
          style={styles.chatComposerModalWrap}
          pointerEvents="box-none"
        >
          <View
            style={[
              styles.chatComposerDock,
              { paddingBottom: Math.max(insetsBottom, 8) + 10 },
              visible ? null : styles.chatComposerDockHidden,
            ]}
          >
            <View style={styles.chatInputRow}>
              <TextInput
                ref={chatInputRef}
                style={styles.chatInput}
                value={chatInput}
                onChangeText={setChatInput}
                placeholder={"메시지 입력"}
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
