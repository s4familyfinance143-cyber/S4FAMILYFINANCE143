import { Redirect } from "expo-router";

/** Starter Explore screen removed — send users to the main app. */
export default function ExploreRedirect() {
  return <Redirect href="/" />;
}
