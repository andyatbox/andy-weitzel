"use client";

import { useEffect, useState } from "react";
import type { PortableTextBlock } from "@portabletext/react";
import { sanity, urlFor } from "./sanity";

export type PortfolioId = "interactive" | "branding" | "richmedia";

export interface PortfolioItem {
  id: string;
  title: string;
  image: string;
  slug: string;
}

export interface Portfolio {
  label: string;
  items: PortfolioItem[];
}

export type Portfolios = Record<PortfolioId, Portfolio>;

export const PORTFOLIO_IDS: PortfolioId[] = ["interactive", "branding", "richmedia"];

export const LABELS: Record<PortfolioId, string> = {
  interactive: "Interactive",
  branding: "Branding",
  richmedia: "Rich Media",
};

// Our three app portfolios map onto the three Sanity category values.
const CATEGORY: Record<PortfolioId, string> = {
  interactive: "immersive-ux",
  branding: "branding-print",
  richmedia: "advertising-rich-media",
};
const ID_BY_CATEGORY: Record<string, PortfolioId> = {
  "immersive-ux": "interactive",
  "branding-print": "branding",
  "advertising-rich-media": "richmedia",
};

interface RawProject {
  _id: string;
  title: string;
  slug: string;
  category: string;
  thumbnail: Parameters<typeof urlFor>[0];
}

const LIST_QUERY = `*[_type == "project" && defined(thumbnail)] | order(orderRank) {
  _id, title, "slug": slug.current, category, thumbnail
}`;

/** Fetches both portfolios' teasers (title + 16:9 thumbnail + slug) from Sanity. */
export function usePortfolios(): Portfolios | null {
  const [portfolios, setPortfolios] = useState<Portfolios | null>(null);

  useEffect(() => {
    let alive = true;
    sanity.fetch<RawProject[]>(LIST_QUERY).then((rows) => {
      if (!alive) return;
      const next: Portfolios = {
        interactive: { label: LABELS.interactive, items: [] },
        branding: { label: LABELS.branding, items: [] },
        richmedia: { label: LABELS.richmedia, items: [] },
      };
      for (const row of rows) {
        const id = ID_BY_CATEGORY[row.category];
        if (!id) continue;
        next[id].items.push({
          id: row._id,
          title: row.title,
          slug: row.slug,
          // Force a 16:9 crop (respecting the hotspot) so the WebGL cover logic
          // and procedural fallback stay consistent.
          image: urlFor(row.thumbnail)
            .width(1600)
            .height(900)
            .fit("crop")
            .auto("format")
            .url(),
        });
      }
      setPortfolios(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return portfolios;
}

// ---- Full project content (fetched per slug when a project is opened) -------

export interface SanityImage {
  _type: "image";
  alt?: string;
  caption?: string;
  asset?: { url?: string };
}

// A gallery slide is either an image or a video embed (Vimeo/Gumlet URL or
// full embed code), matching the CMS's videoSlide object.
export interface VideoSlide {
  _type: "videoSlide";
  videoUrl: string;
}

export type GallerySlide = SanityImage | VideoSlide;

export interface ColumnsGroup {
  columns: "2" | "3";
  column1?: PortableTextBlock[];
  column2?: PortableTextBlock[];
  column3?: PortableTextBlock[];
}

export interface ProjectContent {
  _id: string;
  title: string;
  category: string;
  videoUrl?: string;
  gallery?: GallerySlide[];
  body?: PortableTextBlock[];
  columnsContent?: ColumnsGroup[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  "branding-print": "Branding & Print",
  "immersive-ux": "Interactive Experiences",
  "advertising-rich-media": "Advertising Rich Media",
};

const PROJECT_QUERY = `*[_type == "project" && slug.current == $slug][0]{
  _id, title, category, videoUrl,
  gallery[]{ ..., _type == "image" => { ..., asset-> } },
  body[]{ ..., _type == "image" => { ..., asset-> } },
  columnsContent[]{
    columns,
    column1[]{ ..., _type == "image" => { ..., asset-> } },
    column2[]{ ..., _type == "image" => { ..., asset-> } },
    column3[]{ ..., _type == "image" => { ..., asset-> } }
  }
}`;

/** Loads the full structured content for one project by slug. */
export function useProject(slug: string | null): ProjectContent | null {
  const [project, setProject] = useState<ProjectContent | null>(null);

  useEffect(() => {
    if (!slug) {
      setProject(null);
      return;
    }
    let alive = true;
    setProject(null);
    sanity
      .fetch<ProjectContent>(PROJECT_QUERY, { slug })
      .then((doc) => alive && setProject(doc));
    return () => {
      alive = false;
    };
  }, [slug]);

  return project;
}

export { CATEGORY };
