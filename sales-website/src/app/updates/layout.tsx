import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Updates",
  description:
    "Latest news, release notes and announcements from S4BUSINESSTHINKING.",
  alternates: { canonical: "/updates" },
  openGraph: {
    title: "Updates — S4BUSINESSTHINKING",
    description: "News, release notes and announcements.",
    url: "/updates",
  },
};

export default function UpdatesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
