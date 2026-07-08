"use client";

import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, useProject } from "@/lib/portfolios";
import {
  getVideoEmbedSrc,
  isVideoEndedMessage,
  isVideoReadyMessage,
  subscribeVideoEnded,
} from "@/lib/videoEmbed";
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
  // Whether the visitor has hit play — the overlay button hides and the
  // embed reloads with the provider's autoplay param (allowed because the
  // reload is user-gesture initiated and the iframe delegates autoplay).
  const [playing, setPlaying] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLIFrameElement>(null);

  // New project or a fresh open → show the play overlay again.
  useEffect(() => {
    setPlaying(false);
  }, [project?.slug, opened]);

  // When the video finishes, drop back to the cover: setPlaying(false) reverts
  // the iframe to its non-autoplay src, reloading the poster with the play
  // button on top. Ended events arrive via the player's postMessage API.
  useEffect(() => {
    if (!playing) return;
    const onMessage = (e: MessageEvent) => {
      const frame = videoRef.current;
      const win = frame?.contentWindow;
      if (!win || e.source !== win) return;
      if (isVideoReadyMessage(e.data)) subscribeVideoEnded(win, frame!.src);
      if (isVideoEndedMessage(e.data)) setPlaying(false);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [playing]);

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

  // Once revealed and loaded, auto-nudge the content up after a beat to hint
  // there's more to scroll — unless the user has already scrolled. Custom
  // rAF tween (slow, ease-out) rather than native smooth scroll.
  useEffect(() => {
    if (!revealed || !content) return;
    let raf = 0;
    const timer = setTimeout(() => {
      const el = scrollRef.current;
      if (!el || el.scrollTop >= 10) return;
      const start = el.scrollTop;
      const dist = 200 - start;
      const duration = 1600;
      const t0 = performance.now();
      const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        el.scrollTop = start + dist * easeOut(p);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, 2000);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [revealed, content]);

  if (!project) return null;

  const src = content ? getVideoEmbedSrc(content.videoUrl) : null;

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
          className="absolute bottom-8 left-1/2 flex h-14 w-14 -translate-x-1/2 animate-bounce items-center justify-center rounded-full bg-black/30 ring-2 ring-inset ring-white backdrop-blur-md"
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
            {src && (
              <div className="mx-auto mb-14 max-w-7xl px-6">
                <div className="relative aspect-video overflow-hidden rounded-lg bg-black">
                  <iframe
                    ref={videoRef}
                    // Cover state hides Gumlet's own centered play button (its
                    // purple ring shows around ours otherwise); playing state
                    // re-enables controls with autoplay.
                    src={
                      src.includes("vimeo")
                        ? playing
                          ? `${src}?autoplay=1`
                          : src
                        : playing
                          ? `${src}?autoplay=true`
                          : `${src}?disable_player_controls=true`
                    }
                    allow="autoplay; fullscreen; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full"
                  />
                  {/* Animated play button: blinking invert loop (see
                      play-invert keyframes). Sits over the provider's own
                      chrome; clicking starts playback and removes it. */}
                  {!playing && (
                    <button
                      type="button"
                      onClick={() => setPlaying(true)}
                      aria-label="Play video"
                      className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-lg outline-none md:h-20 md:w-20"
                      style={{ animation: "play-invert 1.4s infinite" }}
                    >
                      <svg
                        width="26"
                        height="26"
                        viewBox="0 0 24 24"
                        fill="#000000"
                        className="ml-1"
                      >
                        <polygon points="6 4 20 12 6 20" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            )}

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
