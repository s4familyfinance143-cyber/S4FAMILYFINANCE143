import React from "react";
import { MobileSettingsPanel } from "../components/modules/MobileSettingsPanel";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileSettingsPanel>;

/** Settings screen — profile, family, security, crash vault. */
export function SettingsScreen(props: Props) {
  return (
    <ScreenShell title="Settings" subtitle="Profile, permissions & security">
      <MobileSettingsPanel {...props} />
    </ScreenShell>
  );
}
