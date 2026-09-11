import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React from "react";
import { LoginHost, RegisterHost, VerifyEmailHost, ForgotPasswordHost } from "./screenHosts";

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  VerifyEmail: undefined;
  ForgotPassword: undefined;
};

const Stack = createNativeStackNavigator<AuthStackParamList>();

/** Auth stack — login / register / verify / forgot. */
export function AuthStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginHost} />
      <Stack.Screen name="Register" component={RegisterHost} />
      <Stack.Screen name="VerifyEmail" component={VerifyEmailHost} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordHost} />
    </Stack.Navigator>
  );
}

export const AuthStack = {
  id: "AuthStack",
  screens: {
    Login: "login",
    Register: "register",
    VerifyEmail: "verify-email",
    ForgotPassword: "forgot-password",
  },
  Navigator: AuthStackNavigator,
} as const;

export type AuthStackScreen = keyof typeof AuthStack.screens;
