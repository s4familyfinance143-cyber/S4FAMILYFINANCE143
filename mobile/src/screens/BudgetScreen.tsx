import React from "react";
import { MobileFinancePanel, type FinanceSub } from "../components/modules/MobileFinancePanel";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileFinancePanel>;

/** Budget screen — budgets & remaining. */
export function BudgetScreen(props: Omit<Props, "initialSub"> & { initialSub?: FinanceSub }) {
  return (
    <ScreenShell title="Budget" subtitle="Limits, spend & remaining">
      <MobileFinancePanel {...props} initialSub={props.initialSub || "BUDGET"} />
    </ScreenShell>
  );
}
