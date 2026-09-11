import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tutorials",
  description:
    "S4BUSINESSTHINKING tutorials for setup, licensing, backup, reports and support workflows.",
  alternates: { canonical: "/tutorials" },
  openGraph: {
    title: "Tutorials — S4BUSINESSTHINKING",
    description: "Product setup, license and support tutorials.",
    url: "/tutorials",
  },
};

export default function TutorialsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
