import React from "react";
import { MobileHomeDashboard } from "../components/modules/MobileHomeDashboard";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileHomeDashboard>;

/** Dashboard screen — home overview + sync metrics. */
export function DashboardScreen(props: Props) {
  return (
    <ScreenShell title="Dashboard" subtitle="Family finance overview">
      <MobileHomeDashboard {...props} />
    </ScreenShell>
  );
}

export type { HomeDashboardSummary, HomeAccount, HomeBudget, HomeTransaction } from "../components/modules/MobileHomeDashboard";
