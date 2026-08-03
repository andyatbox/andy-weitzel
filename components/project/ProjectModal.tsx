"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, useProject } from "@/lib/portfolios";
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
  height: number;
  // Delay before the modal reveals, so it appears after the open transition.
  revealDelay?: number;
}

export default function ProjectModal({
  project,
  opened,
  height,
  revealDelay = 650,
}: ProjectModalProps) {
  const content = useProject(project?.slug ?? null);
  const [revealed, setRevealed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Reveal after the full-screen open transition; hide immediately on close.
  // On prev/next navigation (project change while open) this also fades the
  // sheet out first — the WebGL teaser slides behind it — then fades back in.
  useEffect(() => {
    if (opened && project) {
      setRevealed(false);
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      const t = setTimeout(() => setRevealed(true), revealDelay);
      return () => clearTimeout(t);
    }
    setRevealed(false);
  }, [opened, project, revealDelay]);

  if (!project) return null;

  return (
    <div
      ref={scrollRef}
      className="fixed inset-0 z-40 overflow-y-auto overscroll-contain"
      style={{
        opacity: revealed ? 1 : 0,
        pointerEvents: revealed ? "auto" : "none",
        transition: "opacity 0.5s ease",
      }}
    >
      {/* Transparent hero spacer — the full-screen WebGL teaser shows through.
          A chevron hints that there's content to scroll into. */}
      <div className="relative w-full" style={{ height }}>
        <div
          className="absolute bottom-12 left-1/2 flex h-14 w-14 -translate-x-1/2 animate-bounce items-center justify-center rounded-full bg-black/30 ring-2 ring-inset ring-white backdrop-blur-md"
          style={{ opacity: revealed ? 1 : 0, transition: "opacity 0.6s ease" }}
        >
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </div>

      {/* White content sheet. Base copy steps up at >=768px (headings keep
          their own explicit sizes). */}
      <div className="min-h-screen bg-white pb-24 text-black text-base md:text-lg">
        <header className="mx-auto max-w-5xl px-6 pt-16 pb-4">
          <p className="text-sm text-black/50">
            {CATEGORY_LABELS[project.category] || project.category}
          </p>
          <h1 className="mt-2 text-3xl md:text-5xl">{project.title}</h1>
        </header>

        {!content ? (
          <p className="mx-auto max-w-5xl px-6 py-10 text-black/40">Loading…</p>
        ) : (
          <div className="pt-8">
            {content.gallery?.length ? (
              <div className="mb-14">
                <ProjectGallery images={content.gallery} />
              </div>
            ) : null}

            {content.body && (
              <div className="mx-auto mt-4 max-w-5xl px-6">
                <ProjectPortableText value={content.body} />
              </div>
            )}

            <div className="mx-auto max-w-7xl px-6">
              <ProjectColumns groups={content.columnsContent} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
