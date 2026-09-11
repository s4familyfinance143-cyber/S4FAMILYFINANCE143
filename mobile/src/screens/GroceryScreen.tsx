import React from "react";
import { MobileGroceryPanel } from "../components/modules/MobileGroceryPanel";
import { ScreenShell } from "./ScreenShell";

type Props = React.ComponentProps<typeof MobileGroceryPanel>;

/** Grocery screen — lists, vendors, barcode. */
export function GroceryScreen(props: Props) {
  return (
    <ScreenShell title="Grocery" subtitle="Lists, scan & vendors">
      <MobileGroceryPanel {...props} />
    </ScreenShell>
  );
}
