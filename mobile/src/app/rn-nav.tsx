import { Redirect } from "expo-router";

/**
 * Native React Navigation tree lives outside Expo Router for Expo Go compatibility.
 * Open the main architecture UI at `/` instead.
 */
export default function RnNavRoute() {
  return <Redirect href="/" />;
}
