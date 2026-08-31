"use client";

import { useEffect, useState } from "react";
import type { PortableTextBlock } from "@portabletext/react";
import { sanity, urlFor } from "./sanity";

export type PortfolioId = "interactive" | "branding";

export interface PortfolioItem {
  id: string;
  title: string;
  image: string;
  slug: string;
  /** Raw embed markup/URL of the project's single video, when it has one. */
  video?: string;
  /** Up to 3 gallery stills, cycled on the teaser when there's no video. */
  slides?: string[];
}

export interface Portfolio {
  label: string;
  items: PortfolioItem[];
}

export type Portfolios = Record<PortfolioId, Portfolio>;

export const PORTFOLIO_IDS: PortfolioId[] = ["interactive", "branding"];

export const LABELS: Record<PortfolioId, string> = {
  interactive: "Interactive",
  branding: "Branding",
};

// Our app portfolios map onto Sanity category values. The dataset may still
// hold `advertising-rich-media` projects; with no id mapped to it they're
// simply dropped from the fetch below.
const CATEGORY: Record<PortfolioId, string> = {
  interactive: "immersive-ux",
  branding: "branding-print",
};
const ID_BY_CATEGORY: Record<string, PortfolioId> = {
  "immersive-ux": "interactive",
  "branding-print": "branding",
};

interface RawProject {
  _id: string;
  title: string;
  slug: string;
  category: string;
  thumbnail: Parameters<typeof urlFor>[0];
  video?: string;
  slides?: Parameters<typeof urlFor>[0][];
}

// `video` is the project's single video slide, if it has one — the teaser
// plays it in place of the thumbnail. Projects carry at most one. `slides` is
// the first few gallery stills, which the teaser cycles through instead when
// there's no video.
const LIST_QUERY = `*[_type == "project" && defined(thumbnail)] | order(orderRank) {
  _id, title, "slug": slug.current, category, thumbnail,
  "video": gallery[_type == "videoSlide"][0].videoUrl,
  "slides": gallery[_type == "image"][0...3]
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
      };
      for (const row of rows) {
        const id = ID_BY_CATEGORY[row.category];
        if (!id) continue;
        next[id].items.push({
          id: row._id,
          title: row.title,
          slug: row.slug,
          video: row.video,
          // Same 16:9 crop as the thumbnail, so cycling between them never
          // shifts the framing.
          slides: (row.slides ?? []).map((img) =>
            urlFor(img).width(1600).height(900).fit("crop").auto("format").url()
          ),
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
  gallery?: GallerySlide[];
  body?: PortableTextBlock[];
  columnsContent?: ColumnsGroup[];
}

export const CATEGORY_LABELS: Record<string, string> = {
  "branding-print": "Branding & Print",
  "immersive-ux": "Interactive Experiences",
};

const PROJECT_QUERY = `*[_type == "project" && slug.current == $slug][0]{
  _id, title, category,
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
