import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Pricing and license plans for S4BUSINESSTHINKING Spare Parts Inventory Software and S4 FAMILY FINANCE 143.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Pricing — S4BUSINESSTHINKING",
    description: "License plans and pricing for our software.",
    url: "/pricing",
  },
};

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
