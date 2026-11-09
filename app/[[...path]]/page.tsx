import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { routeFromSegments, routeHref, routeTitle } from "@/lib/routes";
import AppMount from "./AppMount";

/**
 * Every URL on the site is this one page.
 *
 * Not for want of routes — the portfolios and projects are real, linkable
 * addresses (see lib/routes) — but because the site is a single WebGL scene
 * that must survive moving between them. A visitor going from a portfolio to
 * a project is watching one continuous animation; a route change that swapped
 * one page component for another would tear down the canvas, the video decode
 * and the scroll position to rebuild them a frame later.
 *
 * So the segments are matched here, server-side, which is what tells a real
 * address from a 404 and what titles the page, and the app itself moves the
 * URL with the History API from then on. Because every address resolves to
 * this same component, nothing Next does on a back or forward can remount it.
 */

interface PageProps {
  params: Promise<{ path?: string[] }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const route = routeFromSegments((await params).path ?? []);
  if (!route) return {};
  const url = routeHref(route);
  // A directly linked project is titled from its slug: the real title lives
  // in Sanity, and fetching it here would put the dataset in the path of
  // every request for the sake of a string the app corrects on load anyway.
  const title = routeTitle(route);
  // `robots` is deliberately not set: it comes from the root layout, so every
  // page here is noindex without each one having to remember.
  return {
    title,
    alternates: { canonical: url },
    openGraph: { url, title },
    twitter: { title },
  };
}

export default async function Page({ params }: PageProps) {
  const route = routeFromSegments((await params).path ?? []);
  // Not one of ours: a 404, rather than a quiet redirect home. A mistyped
  // portfolio should say that it is mistyped.
  if (!route) notFound();
  return <AppMount portfolio={route.portfolio} slug={route.slug} />;
}
