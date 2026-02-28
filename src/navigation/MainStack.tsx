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
  Call: undefined;
  Fortune: undefined;
  Dino: undefined;
  Profile: undefined;
  Premium: undefined;
  Shop: undefined;
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
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable onPress={() => navigation.goBack()} style={{ paddingHorizontal: 8, paddingVertical: 4 }}>
              <Text style={{ fontSize: 24, fontWeight: "700", color: theme.colors.text }}>{"<"}</Text>
            </Pressable>
          ),
        })}
      />
      <Stack.Screen name="Dino" component={DinoScreen} options={{ title: t("screen.dino") }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t("screen.profile") }} />
      <Stack.Screen name="Premium" component={PremiumScreen} options={{ title: t("screen.premium") }} />
      <Stack.Screen name="Shop" component={ShopScreen} options={{ title: "팝톡 상점" }} />
      <Stack.Screen name="GiftShop" component={GiftShopScreen} options={{ title: "선물 상점" }} />
      <Stack.Screen name="GiftBox" component={GiftBoxScreen} options={{ title: "내 선물함" }} />
    </Stack.Navigator>
  );
}
