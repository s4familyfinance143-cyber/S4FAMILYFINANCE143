import React from "react";
import { MobileFinancePanel, type FinanceSub } from "../components/modules/MobileFinancePanel";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileFinancePanel>;

/** Expense screen — spend transactions & categories. */
export function ExpenseScreen(props: Omit<Props, "initialSub"> & { initialSub?: FinanceSub }) {
  return (
    <ScreenShell title="Expense" subtitle="Spend tracking & categories">
      <MobileFinancePanel {...props} initialSub={props.initialSub || "TX"} />
    </ScreenShell>
  );
}
