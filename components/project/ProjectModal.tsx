"use client";

import { useEffect, useRef, useState } from "react";
import { useProject } from "@/lib/portfolios";
import ProjectPortableText from "./ProjectPortableText";
import ProjectColumns from "./ProjectColumns";
import ProjectGallery from "./ProjectGallery";

export interface ActiveProject {
  slug: string;
  title: string;
  category: string;
}

interface ProjectModalProps {
  project: ActiveProject | null;
  opened: boolean;
  /**
   * True once the teaser has finished expanding to full screen. The sheet
   * waits for it, so the content is never laid over a still-growing teaser.
   * Already true when navigating between projects with the sheet open — that
   * moves the engine, not the canvas — so `revealDelay` governs there.
   */
  expandDone: boolean;
  height: number;
  // Floor on how long the sheet stays hidden, which is what paces the
  // fade-out/fade-in when switching projects without closing.
  revealDelay?: number;
}

// The prev/next and back/portfolio nav is `fixed` in the top corners at z-50,
// and this sheet scrolls underneath it — so copy has to be inset far enough
// horizontally to never pass beneath either column. The left stack (back
// button above the portfolio pills) is the wider of the two and sets the
// figure. Below `md` the viewport is too narrow to clear it and still leave a
// readable measure, so there the gutter drops back to the normal page margin
// and HEADER_TOP does the work instead, starting the title below the nav.
const GUTTER = "px-6 md:px-40";
// At md+ the gutter above clears the nav columns, so the title can sit at the
// nav's own inset (top-5) and align with it. Below md it can't — the left
// stack alone is a third of a phone's width — so there the title drops below
// the stack's full height (top-5 + back button + two pills ≈ 152px) instead.
const HEADER_TOP = "pt-40 md:pt-5";
// Beat between the teaser arriving at full screen and the sheet fading up, so
// the two read as separate moments rather than one continuous crossfade.
const POST_EXPAND_MS = 340;

export default function ProjectModal({
  project,
  opened,
  expandDone,
  height,
  revealDelay = 400,
}: ProjectModalProps) {
  const content = useProject(project?.slug ?? null);
  const [waited, setWaited] = useState(false);
  // The gallery's expanded view is a fixed overlay rendered inside this sheet,
  // so it can only cover the project nav (z-50) if the sheet itself outranks
  // it. Reset on close so a project opened later starts normally.
  const [galleryExpanded, setGalleryExpanded] = useState(false);
  const [settled, setSettled] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reveal after the full-screen open transition; hide immediately on close.
  // On prev/next navigation (project change while open) this also fades the
  // sheet out first — the WebGL teaser slides behind it — then fades back in.
  useEffect(() => {
    if (opened && project) {
      setWaited(false);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      const t = setTimeout(() => setWaited(true), revealDelay);
      return () => clearTimeout(t);
    }
    setWaited(false);
    setGalleryExpanded(false);
  }, [opened, project, revealDelay]);

  // Let the full-screen teaser sit for a moment before the sheet arrives over
  // it. Keyed on `project` too, so prev/next navigation gets the same pacing.
  useEffect(() => {
    if (!opened || !expandDone) {
      setSettled(false);
      return;
    }
    const t = setTimeout(() => setSettled(true), POST_EXPAND_MS);
    return () => clearTimeout(t);
  }, [opened, expandDone, project]);

  // Both gates: the minimum beat, and the teaser having arrived at full screen
  // and then held there.
  const revealed = waited && settled;

  if (!project) return null;

  return (
    <div
      ref={scrollRef}
      className={`fixed inset-0 overflow-y-auto overscroll-contain ${
        galleryExpanded ? "z-[60]" : "z-40"
      }`}
      style={{
        opacity: revealed ? 1 : 0,
        pointerEvents: revealed ? "auto" : "none",
        transition: "opacity 0.32s ease",
      }}
    >
      {/* Frosted scrim over the full-screen WebGL teaser. Deliberately `fixed`
          rather than a background on the sheet itself: the blur then rasterises
          once against a backdrop that never moves, instead of being recomputed
          for the whole sheet on every scroll frame. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 bg-white/70 backdrop-blur-md"
      />

      {/* Content rides above the scrim. Base copy steps up at >=768px (headings
          keep their own explicit sizes). Its floor is the measured window
          height, not min-h-screen — that resolves to 100vh, which is the large
          viewport and so overshoots whenever mobile chrome is showing. */}
      <div
        className="relative pb-24 text-base text-black md:text-lg"
        style={{ minHeight: height }}
      >
        <header
          className={`mx-auto max-w-5xl text-center ${HEADER_TOP} ${GUTTER}`}
        >
          <h1 className="text-3xl text-black md:text-5xl">{project.title}</h1>
        </header>

        {!content ? (
          <p className={`mx-auto max-w-5xl py-10 text-black/40 ${GUTTER}`}>
            Loading…
          </p>
        ) : (
          <div className="pt-6">
            {content.gallery?.length ? (
              <div className={`mx-auto mb-14 max-w-7xl ${GUTTER}`}>
                <ProjectGallery
                  images={content.gallery}
                  height={height}
                  onExpandedChange={setGalleryExpanded}
                />
              </div>
            ) : null}

            {content.body && (
              <div className={`mx-auto mt-4 max-w-5xl ${GUTTER}`}>
                <ProjectPortableText value={content.body} />
              </div>
            )}

            <div className={`mx-auto max-w-7xl ${GUTTER}`}>
              <ProjectColumns groups={content.columnsContent} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
