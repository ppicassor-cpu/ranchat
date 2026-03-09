// FILE: C:\ranchat\src\navigation\MainStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Pressable, Text } from "react-native";
import HomeScreen from "../screens/HomeScreen";
import CallScreen from "../screens/CallScreen";
import ProfileScreen from "../screens/ProfileScreen";
import PremiumScreen from "../screens/PremiumScreen";
import FortuneScreen from "../screens/FortuneScreen";
import DinoScreen from "../screens/DinoScreen";
import ShopScreen from "../screens/ShopScreen";
import GiftShopScreen from "../screens/GiftShopScreen";
import GiftBoxScreen from "../screens/GiftBoxScreen";
import { theme } from "../config/theme";
import { useTranslation } from "../i18n/LanguageProvider";

export type MainStackParamList = {
  Home: undefined;
  Call:
    | {
        entryMode?: "match" | "contactRecall" | "contactRecallAccept";
        recallPeerSessionId?: string;
        recallPeerProfileId?: string;
        recallInviteId?: string;
      }
    | undefined;
  Fortune: undefined;
  Dino: undefined;
  Profile: undefined;
  Premium: undefined;
  Shop: { initialTab?: 0 | 1 | 2 | 3 | 4 } | undefined;
  GiftShop: undefined;
  GiftBox: { mode?: "view" | "send" } | undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  const { t } = useTranslation();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: t("screen.home") }} />
      <Stack.Screen name="Call" component={CallScreen} options={{ title: t("screen.call") }} />
      <Stack.Screen
        name="Fortune"
        component={FortuneScreen}
        options={({ navigation }) => ({
          title: "",
          headerTransparent: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "transparent" },
          statusBarTranslucent: true,
          statusBarColor: "transparent",
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPressIn={() => navigation.goBack()}
              hitSlop={16}
              style={{
                marginTop: 8,
                marginLeft: 2,
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 24, fontWeight: "700", color: theme.colors.text }}>{"<"}</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen name="Dino" component={DinoScreen} options={{ title: t("screen.dino") }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t("screen.profile") }} />
      <Stack.Screen
        name="Premium"
        component={PremiumScreen}
        options={({ navigation }) => ({
          title: "",
          headerTransparent: true,
          headerShadowVisible: false,
          headerStyle: { backgroundColor: "transparent" },
          statusBarTranslucent: true,
          statusBarColor: "transparent",
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPressIn={() => navigation.goBack()}
              hitSlop={12}
              style={{
                marginTop: 2,
                marginLeft: 2,
                minWidth: 44,
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: "800", color: "#FFFFFF" }}>{"<"}</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen name="Shop" component={ShopScreen} options={{ title: t("shop.title") }} />
      <Stack.Screen name="GiftShop" component={GiftShopScreen} options={{ title: t("giftshop.title") }} />
      <Stack.Screen name="GiftBox" component={GiftBoxScreen} options={{ title: t("giftbox.header_box") }} />
    </Stack.Navigator>
  );
}
