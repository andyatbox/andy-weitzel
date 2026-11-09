"use client";

import dynamic from "next/dynamic";
import type { PortfolioId } from "@/lib/portfolioMeta";

/**
 * The app, mounted once for the whole site.
 *
 * It can't be server-rendered: it measures the window before it lays
 * anything out, owns two WebGL contexts and fetches its content from Sanity
 * in the browser. What the server does hand it is the address it was asked
 * for, so a link to a portfolio or a project arrives already there instead of
 * opening the landing gate and then jumping.
 */
const PortfolioApp = dynamic(() => import("@/components/PortfolioApp"), {
  ssr: false,
});

export default function AppMount({
  portfolio,
  slug,
}: {
  portfolio: PortfolioId | null;
  slug: string | null;
}) {
  return <PortfolioApp initialPortfolio={portfolio} initialSlug={slug} />;
}
