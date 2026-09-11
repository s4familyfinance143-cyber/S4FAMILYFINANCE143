import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Account",
  description: "Register for a S4BUSINESSTHINKING customer account.",
  alternates: { canonical: "/register" },
  robots: { index: false, follow: true },
};

export default function RegisterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
