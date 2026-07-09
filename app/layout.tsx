import type { Metadata, Viewport } from "next";
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
  alternates: { canonical: "/" },
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
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f8f8f8",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
