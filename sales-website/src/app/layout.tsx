import type { Metadata } from "next";
import { Inter, Noto_Sans_Arabic, Noto_Sans_Bengali, Noto_Sans_Devanagari } from "next/font/google";
import "./globals.css";
import { site } from "@/lib/site";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { LanguageProvider } from "@/components/LanguageProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { MarqueeHeading } from "@/components/MarqueeHeading";
import { WelcomeGreeting } from "@/components/WelcomeGreeting";
import { DEFAULT_LANG, dirFor } from "@/lib/i18n";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const bengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  display: "swap",
});

const devanagari = Noto_Sans_Devanagari({
  variable: "--font-devanagari",
  subsets: ["devanagari"],
  display: "swap",
});

const arabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: `${site.domain} — Spare Parts Inventory & Family Finance Software`,
    template: `%s — ${site.domain}`,
  },
  description:
    "Official website for S4BUSINESSTHINKING Spare Parts Inventory Software and S4 FAMILY FINANCE 143. Download, pricing, licensing and support.",
  applicationName: site.brand,
  authors: [{ name: site.brand, url: site.url }],
  creator: site.brand,
  publisher: site.brand,
  category: "software",
  keywords: [
    "S4BUSINESSTHINKING",
    "S4 FAMILY FINANCE 143",
    "spare parts inventory software",
    "family finance software",
    "inventory ERP",
    "inventory management",
    "family budget software",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: site.url,
    siteName: site.domain,
    locale: "en_US",
    title: `${site.domain} — Official Software Website`,
    description:
      "Spare Parts Inventory Software and Family Finance Management Software.",
  },
  twitter: {
    card: "summary_large_image",
    title: `${site.domain} — Official Software Website`,
    description:
      "Spare Parts Inventory Software and Family Finance Management Software.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${site.url}/#organization`,
      name: site.brand,
      url: site.url,
      email: site.contact.email.toLowerCase(),
      sameAs: [site.contact.facebookUrl],
    },
    {
      "@type": "WebSite",
      "@id": `${site.url}/#website`,
      url: site.url,
      name: site.domain,
      publisher: { "@id": `${site.url}/#organization` },
      inLanguage: ["en", "bn", "hi", "ur", "ar"],
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang={DEFAULT_LANG}
      dir={dirFor(DEFAULT_LANG)}
      data-scroll-behavior="smooth"
      suppressHydrationWarning
      className={`${inter.variable} ${bengali.variable} ${devanagari.variable} ${arabic.variable} h-full antialiased`}
    >
      <body className="font-sans min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('s4-theme');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){}",
          }}
        />
        <ThemeProvider>
          <LanguageProvider>
            <AuthProvider>
              <WelcomeGreeting />
              <Header />
              <MarqueeHeading />
              <main className="flex-1">{children}</main>
              <Footer />
            </AuthProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
