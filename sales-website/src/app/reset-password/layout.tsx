import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Reset Password",
  robots: { index: false, follow: false },
};

export default function ResetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
