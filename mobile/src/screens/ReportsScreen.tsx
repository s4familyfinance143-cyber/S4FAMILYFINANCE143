import React from "react";
import { MobileReportsPanel } from "../components/modules/MobileReportsPanel";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileReportsPanel>;

/** Reports screen — cashflow charts & exports. */
export function ReportsScreen(props: Props) {
  return (
    <ScreenShell title="Reports" subtitle="Cashflow, ledger & export">
      <MobileReportsPanel {...props} />
    </ScreenShell>
  );
}
