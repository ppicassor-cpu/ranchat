import React from "react";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type CallControlsProps = {
  styles: any;
  controlsBottom: number;
  myCamOn: boolean;
  mySoundOn: boolean;
  remoteMuted: boolean;
  openBeauty: () => void;
  toggleCam: () => void;
  toggleSound: () => void;
  toggleRemoteMute: () => void;
  onPressChatControl: () => void;
  openChatComposer: () => void;
};

export default function CallControls({
  styles,
  controlsBottom,
  myCamOn,
  mySoundOn,
  remoteMuted,
  openBeauty,
  toggleCam,
  toggleSound,
  toggleRemoteMute,
  onPressChatControl,
  openChatComposer,
}: CallControlsProps) {
  return (
    <View pointerEvents="box-none" style={[styles.controlsOverlay, { bottom: controlsBottom }]}>
      <View style={styles.controlsRow}>
        <Pressable onPress={openBeauty} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
          <Ionicons name="color-wand" size={22} color="#f3cddb" />
        </Pressable>

        <Pressable onPress={toggleCam} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
          <Ionicons name={myCamOn ? "videocam" : "videocam-off"} size={22} color="#f3cddb" />
        </Pressable>

        <Pressable onPress={toggleSound} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
          <Ionicons name={mySoundOn ? "mic" : "mic-off"} size={22} color="#f3cddb" />
        </Pressable>

        <Pressable onPress={toggleRemoteMute} style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}>
          <Ionicons name={remoteMuted ? "volume-mute" : "volume-high"} size={22} color="#f3cddb" />
        </Pressable>

        <Pressable
          onPressIn={openChatComposer}
          onPress={onPressChatControl}
          style={({ pressed }) => [styles.controlBtn, pressed ? { opacity: 0.7 } : null]}
        >
          <Ionicons name="chatbubble-ellipses" size={21} color="#f3cddb" />
        </Pressable>
      </View>
    </View>
  );
}
