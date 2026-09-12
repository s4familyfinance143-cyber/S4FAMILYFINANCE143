import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Download Center",
  description:
    "Download the latest installers for S4BUSINESSTHINKING Spare Parts Inventory Software and S4 FAMILY FINANCE 143 for Windows and Android.",
  alternates: { canonical: "/installers" },
  openGraph: {
    title: "Download Center — S4BUSINESSTHINKING",
    description: "Official installers for Windows and Android.",
    url: "/installers",
  },
};

export default function InstallersLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
