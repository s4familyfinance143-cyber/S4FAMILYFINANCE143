import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Support",
  description:
    "Get help with S4BUSINESSTHINKING software. Self-service guides, direct support and contact channels.",
  alternates: { canonical: "/support" },
  openGraph: {
    title: "Support — S4BUSINESSTHINKING",
    description: "Self-service guides and direct customer support.",
    url: "/support",
  },
};

export default function SupportLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
