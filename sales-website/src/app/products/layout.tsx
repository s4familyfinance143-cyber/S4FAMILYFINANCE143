import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Explore S4BUSINESSTHINKING software: Spare Parts Inventory Software and S4 FAMILY FINANCE 143 — Family Finance Management Software.",
  alternates: { canonical: "/products" },
  openGraph: {
    title: "Products — S4BUSINESSTHINKING",
    description:
      "Spare Parts Inventory Software and Family Finance Management Software.",
    url: "/products",
  },
};

export default function ProductsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
