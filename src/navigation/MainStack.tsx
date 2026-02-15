//C:\ranchat\src\navigation\MainStack.tsx
import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "../screens/HomeScreen";
import CallScreen from "../screens/CallScreen";
import ProfileScreen from "../screens/ProfileScreen";
import { theme } from "../config/theme";

export type MainStackParamList = {
  Home: undefined;
  Call: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<MainStackParamList>();

export default function MainStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.bg },
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: theme.colors.bg },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ title: "RanChat" }} />
      <Stack.Screen name="Call" component={CallScreen} options={{ title: "매칭" }} />
      <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "프로필" }} />
    </Stack.Navigator>
  );
}
