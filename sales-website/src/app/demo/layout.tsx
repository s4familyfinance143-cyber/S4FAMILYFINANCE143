import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Request a Demo",
  description:
    "Request a live demo of S4BUSINESSTHINKING Spare Parts Inventory Software or S4 FAMILY FINANCE 143.",
  alternates: { canonical: "/demo" },
  openGraph: {
    title: "Request a Demo — S4BUSINESSTHINKING",
    description: "See our software in action with a guided demo.",
    url: "/demo",
  },
};

export default function DemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
