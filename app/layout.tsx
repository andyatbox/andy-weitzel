import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GA_ID } from "@/lib/analytics";
import "./globals.css";

// Apex redirects to www (Vercel's recommended setup), so www is the domain
// that actually serves content — canonical/OG URLs should point there.
const SITE_URL = "https://www.andyweitzel.com";
const TITLE = "Andy Weitzel — Creative Director";
const DESCRIPTION =
  "Creative director and full-stack technologist with two decades of award-winning work — brand identities, integrated campaigns, and AR/AI/3D experiences for Fortune 50 brands and startups. Co-founder & CCO of Box Creative; two-time Webby Award winner.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    "Andy Weitzel",
    "Andrew Weitzel",
    "creative director",
    "chief creative officer",
    "marketing director",
    "brand identity",
    "interactive experiences",
    "rich media advertising",
    "AR experiences",
    "WebGL",
    "Box Creative",
    "portfolio",
    "New York",
  ],
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Andy Weitzel",
    title: TITLE,
    description: DESCRIPTION,
    locale: "en_US",
    images: [
      {
        url: "/meta/web-app-manifest-512x512.png",
        width: 512,
        height: 512,
        alt: "Andy Weitzel monogram",
      },
    ],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/meta/web-app-manifest-512x512.png"],
  },
  icons: {
    icon: [
      { url: "/meta/favicon.ico", sizes: "any" },
      { url: "/meta/favicon.svg", type: "image/svg+xml" },
      { url: "/meta/favicon-96x96.png", type: "image/png", sizes: "96x96" },
    ],
    apple: "/meta/apple-touch-icon.png",
  },
  manifest: "/meta/site.webmanifest",
  // TEMPORARY: site is still being built out — keep search engines out until
  // content is ready. Flip both this and public/robots.txt back to allow
  // indexing before announcing the site publicly.
  //
  // Every page inherits this. Route metadata (app/[[...path]]/page.tsx) sets
  // only a title and a canonical, and anything a page leaves unset comes from
  // here — so a new URL is noindex by default rather than by remembering to
  // say so. public/robots.txt disallows the whole site to match.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#070707",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        {/* Google Analytics. `afterInteractive` is Google's own guidance —
            it is measurement, and the first paint of a WebGL scene should
            not be queued behind it.

            The config call sends the page view for the address the visitor
            arrived on, and nothing else: the site never reloads, so every
            move after that is sent by hand — see lib/analytics.ts. */}
        <Script
          id="ga-src"
          strategy="afterInteractive"
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        />
        <Script id="ga-init" strategy="afterInteractive">{`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = gtag;
gtag('js', new Date());
gtag('config', '${GA_ID}');
        `}</Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
