import React from "react";
import { MobileFinancePanel, type FinanceSub } from "../components/modules/MobileFinancePanel";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileFinancePanel>;

/** Loans screen — taken / given loans. */
export function LoansScreen(props: Omit<Props, "initialSub"> & { initialSub?: FinanceSub }) {
  return (
    <ScreenShell title="Loans" subtitle="Taken & given balances">
      <MobileFinancePanel {...props} initialSub={props.initialSub || "LOANS"} />
    </ScreenShell>
  );
}
