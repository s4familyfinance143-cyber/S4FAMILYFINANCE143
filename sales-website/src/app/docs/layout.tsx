import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Official S4BUSINESSTHINKING documentation for installation, accounts, downloads, licensing and troubleshooting.",
  alternates: { canonical: "/docs" },
  openGraph: {
    title: "Documentation — S4BUSINESSTHINKING",
    description: "Installation, licensing and support documentation.",
    url: "/docs",
  },
};

export default function DocsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
