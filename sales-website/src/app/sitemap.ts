import type { MetadataRoute } from "next";
import { site, products } from "@/lib/site";

const legalDocs = [
  "privacy",
  "terms",
  "refund",
  "eula",
  "cookie",
  "security",
  "acceptable-use",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const staticRoutes: { path: string; priority: number }[] = [
    { path: "", priority: 1 },
    { path: "/products", priority: 0.9 },
    { path: "/pricing", priority: 0.8 },
    { path: "/installers", priority: 0.8 },
    { path: "/downloads", priority: 0.5 },
    { path: "/docs", priority: 0.7 },
    { path: "/tutorials", priority: 0.7 },
    { path: "/support", priority: 0.7 },
    { path: "/contact", priority: 0.7 },
    { path: "/about", priority: 0.6 },
    { path: "/demo", priority: 0.6 },
    { path: "/updates", priority: 0.6 },
    { path: "/login", priority: 0.4 },
  ];

  const staticEntries: MetadataRoute.Sitemap = staticRoutes.map((r) => ({
    url: `${site.url}${r.path}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: r.priority,
  }));

  const productEntries: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${site.url}${p.href}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.85,
  }));

  const legalEntries: MetadataRoute.Sitemap = legalDocs.map((d) => ({
    url: `${site.url}/legal/${d}`,
    lastModified: now,
    changeFrequency: "yearly",
    priority: 0.3,
  }));

  return [...staticEntries, ...productEntries, ...legalEntries];
}
