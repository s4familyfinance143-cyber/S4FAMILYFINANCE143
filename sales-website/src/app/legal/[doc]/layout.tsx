import type { Metadata } from "next";

const titles: Record<string, string> = {
  privacy: "Privacy Policy",
  terms: "Terms of Service",
  refund: "Refund Policy",
  eula: "End User License Agreement (EULA)",
  cookie: "Cookie Policy",
  security: "Security Policy",
  "acceptable-use": "Acceptable Use Policy",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const { doc } = await params;
  const title = titles[doc];
  if (!title) {
    return { title: "Legal", robots: { index: false, follow: false } };
  }
  return {
    title,
    description: `${title} for S4BUSINESSTHINKING software and services.`,
    alternates: { canonical: `/legal/${doc}` },
  };
}

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
