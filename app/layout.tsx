import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { GTM_ID } from "@/lib/analytics";
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
        {/* Google Tag Manager. The container itself decides what runs inside
            it; all this does is load it and leave `gtag` where a tag that
            wants it can find it. `afterInteractive` is Google's own guidance
            for a container — it is measurement, and the first paint of a
            WebGL scene should not be queued behind it.

            One script rather than two: the loader has to find `dataLayer`
            already there, and keeping both halves in the same block settles
            that without depending on the order two tags happen to execute
            in. In-app navigation is a push of its own, since the page never
            reloads — see lib/analytics.ts. */}
        <Script id="gtm" strategy="afterInteractive">{`
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});
var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';
j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;
f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');
        `}</Script>
      </head>
      <body>{children}</body>
    </html>
  );
}
