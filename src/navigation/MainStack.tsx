// FILE: C:\ranchat\src\navigation\MainStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import CallScreen from "../screens/CallScreen";
import ProfileScreen from "../screens/ProfileScreen";
import PremiumScreen from "../screens/PremiumScreen";
import { theme } from "../config/theme";
import { useTranslation } from "../i18n/LanguageProvider";

export type MainStackParamList = {
  Home: undefined;
  Call: undefined;
  Profile: undefined;
  Premium: undefined;
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
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: t("screen.profile") }} />
      <Stack.Screen name="Premium" component={PremiumScreen} options={{ title: t("screen.premium") }} />
    </Stack.Navigator>
  );
}