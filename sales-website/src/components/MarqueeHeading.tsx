"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "@/components/LanguageProvider";

export function MarqueeHeading() {
  const { t } = useI18n();
  const pathname = usePathname();
  const text = t("marquee");

  if (pathname === "/") return null;

  return (
    <div className="s4-marquee-viewport overflow-hidden border-b border-line bg-gradient-to-r from-accent/15 via-panel to-accent2/15">
      <div className="s4-marquee-track py-2.5">
        {/* duplicated for a seamless loop */}
        <span className="px-6 text-sm font-semibold tracking-wide text-text">
          {text}
        </span>
        <span
          className="px-6 text-sm font-semibold tracking-wide text-text"
          aria-hidden
        >
          {text}
        </span>
      </div>
    </div>
  );
}
