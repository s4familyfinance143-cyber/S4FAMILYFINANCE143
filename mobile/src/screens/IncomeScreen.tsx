import React from "react";
import { MobileFinancePanel, type FinanceSub } from "../components/modules/MobileFinancePanel";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileFinancePanel>;

/** Income screen — wallets + income posting. */
export function IncomeScreen(props: Omit<Props, "initialSub"> & { initialSub?: FinanceSub }) {
  return (
    <ScreenShell title="Income" subtitle="Wallets, credits & transfers">
      <MobileFinancePanel {...props} initialSub={props.initialSub || "WALLETS"} />
    </ScreenShell>
  );
}
