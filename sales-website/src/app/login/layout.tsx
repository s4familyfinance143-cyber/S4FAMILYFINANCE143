import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Customer Login",
  description:
    "Sign in to your S4BUSINESSTHINKING customer account to manage licenses, downloads and support.",
  alternates: { canonical: "/login" },
  robots: { index: false, follow: true },
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
