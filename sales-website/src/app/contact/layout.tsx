import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact S4BUSINESSTHINKING via WhatsApp, email or Facebook for sales, support and licensing questions.",
  alternates: { canonical: "/contact" },
  openGraph: {
    title: "Contact — S4BUSINESSTHINKING",
    description: "Reach us via WhatsApp, email or Facebook.",
    url: "/contact",
  },
};

export default function ContactLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
