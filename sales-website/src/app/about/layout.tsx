import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "About S4BUSINESSTHINKING, the official software brand for spare parts inventory and family finance management.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About Us — S4BUSINESSTHINKING",
    description:
      "Official software brand for spare parts inventory and family finance management.",
    url: "/about",
  },
};

export default function AboutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
