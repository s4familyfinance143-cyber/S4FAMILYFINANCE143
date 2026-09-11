import type { Metadata } from "next";
import { products, site } from "@/lib/site";

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const p = products.find((x) => x.slug === slug);
  if (!p) {
    return { title: "Product", robots: { index: false, follow: false } };
  }
  return {
    title: `${p.name} — ${p.short}`,
    description: p.description,
    alternates: { canonical: p.href },
    openGraph: {
      title: `${p.name} — ${p.short}`,
      description: p.description,
      url: p.href,
    },
  };
}

export default async function ProductLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const p = products.find((x) => x.slug === slug);
  const jsonLd = p
    ? {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: p.name,
        applicationCategory: "BusinessApplication",
        operatingSystem: p.platforms.join(", "),
        description: p.description,
        url: `${site.url}${p.href}`,
        publisher: {
          "@type": "Organization",
          name: site.brand,
          url: site.url,
        },
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
