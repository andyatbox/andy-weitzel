"use client";

import { useEffect, useRef, useState } from "react";
import type { GallerySlide } from "@/lib/portfolios";
import { urlFor } from "@/lib/sanity";
import {
  getVideoEmbedSrc,
  isVideoEndedMessage,
  isVideoReadyMessage,
  subscribeVideoEnded,
} from "@/lib/videoEmbed";

// Ceiling on the slide height as a fraction of the window. Only bites where
// the strip is wide relative to the window — short landscape laptops — since
// otherwise the 16:9 width constraint is the smaller of the two.
const MAX_HEIGHT = 0.72;
// Vertical room the expanded view keeps for the controls row under the media
// (button height + its margin + the overlay's own padding).
const CONTROLS_SPACE = 120;

export default function ProjectGallery({
  images,
  height,
  onExpandedChange,
}: {
  images?: GallerySlide[];
  /** Measured window height — never size this in vh (mobile chrome). */
  height: number;
  /**
   * Announces the expanded state. The overlay below is `fixed`, but it lives
   * inside the modal's own `z-40` stacking context, so its z-index can't lift
   * it over the project nav at `z-50` — the sheet has to raise itself.
   */
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  // Per-slide reload counters: bumped when that video finishes, remounting its
  // iframe so the player rewinds and shows its cover again (with the play
  // button back on top).
  const [reloadTicks, setReloadTicks] = useState<Record<number, number>>({});
  // Poster image per video slide, resolved via /api/video-poster. Shown as our
  // own cover over the iframe: restores the poster while fully hiding the
  // provider's built-in center play button (Gumlet's is purple and can't be
  // disabled via embed params).
  const [posters, setPosters] = useState<Record<number, string>>({});
  const startX = useRef<number | null>(null);
  const deltaX = useRef(0);
  const dragging = useRef(false);
  // Magnitude of the last completed drag, so the video overlay can tell a
  // tap (toggle playback) apart from the tail end of a swipe.
  const lastDragAbs = useRef(0);
  const iframeRefs = useRef<Record<number, HTMLIFrameElement | null>>({});
  // The strip's own width, measured. It used to be derived from `100vw` in a
  // calc, which both ignored whatever padding the caller applies (the sheet
  // now insets this to clear the fixed nav) and counted the scrollbar.
  const stripRef = useRef<HTMLDivElement>(null);
  const [stripW, setStripW] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  // Watch every mounted player (iframes stay mounted across slides so swiping
  // never drops to a black frame): subscribe to each one's "ended" event when
  // it reports ready, and reset that slide to its cover when playback ends.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const entry = Object.entries(iframeRefs.current).find(
        ([, frame]) => frame && frame.contentWindow === e.source
      );
      if (!entry) return;
      const [key, frame] = entry;
      const i = Number(key);
      const win = frame!.contentWindow!;
      if (isVideoReadyMessage(e.data)) subscribeVideoEnded(win, frame!.src);
      if (isVideoEndedMessage(e.data)) {
        setPlayingIndex((p) => (p === i ? null : p));
        setReloadTicks((m) => ({ ...m, [i]: (m[i] ?? 0) + 1 }));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Resolve poster images for the video slides.
  useEffect(() => {
    if (!images?.length) return;
    let alive = true;
    images.forEach((item, i) => {
      if (item._type !== "videoSlide") return;
      const src = getVideoEmbedSrc(item.videoUrl);
      if (!src) return;
      fetch(`/api/video-poster?src=${encodeURIComponent(src)}`)
        .then((r) => r.json())
        .then((data: { poster?: string | null }) => {
          if (alive && data?.poster) {
            setPosters((m) => ({ ...m, [i]: data.poster! }));
          }
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
    };
  }, [images]);

  // Expanded: Escape closes, and the wheel is swallowed so the project sheet
  // underneath doesn't scroll away behind the overlay. Touch needs no handler —
  // the strip already carries `touch-none`, and so does the overlay.
  useEffect(() => {
    onExpandedChange?.(fullscreen);
  }, [fullscreen, onExpandedChange]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    const onWheel = (e: WheelEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    // Non-passive, because React's own wheel listener is passive and can't
    // preventDefault.
    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", onWheel);
    };
  }, [fullscreen]);

  // Must run before the early return below, and must re-run once `images`
  // arrives — the ref points at DOM that only exists past that guard, so on the
  // first (null-returning) render there is nothing to observe.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const measure = () => setStripW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [images]);

  if (!images?.length) return null;
  const count = images.length;
  // 16:9 against the width actually available, capped against the measured
  // window height (never vh — that's the large viewport, so mobile Safari's
  // collapsing chrome makes it wrong by exactly the chrome's height).
  // Expanded, the cap is the window less the controls row beneath it.
  const cap = fullscreen
    ? Math.max(120, height - CONTROLS_SPACE)
    : height * MAX_HEIGHT;
  const stripH = Math.round(Math.min((stripW * 9) / 16, cap));
  const ink = fullscreen ? "text-white" : "text-black";

  // Send play/pause to a player iframe — Vimeo's player protocol or Gumlet's
  // player.js protocol.
  const postCommand = (i: number, method: "play" | "pause") => {
    const frame = iframeRefs.current[i];
    const win = frame?.contentWindow;
    if (!frame || !win) return;
    if (frame.src.includes("vimeo")) {
      win.postMessage(JSON.stringify({ method }), "*");
    } else {
      win.postMessage(
        JSON.stringify({ context: "player.js", version: "0.0.11", method }),
        "*"
      );
    }
  };

  const goTo = (index: number) => {
    // Players stay mounted across slides, so pause the one that was playing
    // instead of letting it run (or unmounting it to black, as before).
    if (playingIndex !== null) postCommand(playingIndex, "pause");
    setCurrent((index + count) % count);
    setDragOffset(0);
    setPlayingIndex(null);
  };

  // The iframe sits under a transparent overlay so swipes reach the slider
  // (drag works on touch); taps control the player through its postMessage
  // API instead.
  const toggleVideo = (i: number) => {
    postCommand(i, playingIndex === i ? "pause" : "play");
    setPlayingIndex(playingIndex === i ? null : i);
  };

  const dragStart = (x: number) => {
    startX.current = x;
    deltaX.current = 0;
    dragging.current = true;
  };
  const dragMove = (x: number) => {
    if (!dragging.current || startX.current === null) return;
    deltaX.current = x - startX.current;
    setDragOffset(deltaX.current);
  };
  const dragEnd = () => {
    if (!dragging.current) return;
    lastDragAbs.current = Math.abs(deltaX.current);
    if (Math.abs(deltaX.current) > 50) goTo(current + (deltaX.current < 0 ? 1 : -1));
    else setDragOffset(0);
    dragging.current = false;
    deltaX.current = 0;
  };

  return (
    // Full-bleed strip: slides travel to the window edges, but each slide's
    // media keeps the previous boxed dimensions (16:9 at the old max-w-7xl
    // content width), centered and vh-capped — the strip's height matches
    // that media box, so nothing scales up to "cover" the wider strip.
    // Expanding only swaps classes on this wrapper — the slider markup below is
    // untouched, so React never unmounts the player iframes and a video keeps
    // playing straight through the transition. Portalling it elsewhere, or
    // rendering a second copy, would reload every player.
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-[60] flex touch-none flex-col items-center justify-center bg-black p-4 sm:p-6"
          : undefined
      }
    >
      <div ref={stripRef} className="w-full">
      <div
        className="relative cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
        style={{ height: stripH || undefined }}
        onTouchStart={(e) => dragStart(e.touches[0].clientX)}
        onTouchMove={(e) => dragMove(e.touches[0].clientX)}
        onTouchEnd={dragEnd}
        onMouseDown={(e) => dragStart(e.clientX)}
        onMouseMove={(e) => dragMove(e.clientX)}
        onMouseUp={dragEnd}
        onMouseLeave={dragEnd}
      >
        <div
          className="flex h-full"
          style={{
            width: `${count * 100}%`,
            transform: `translateX(calc(${-current * (100 / count)}% + ${dragOffset}px))`,
            transition: dragging.current ? "none" : "transform 0.28s ease",
          }}
        >
          {images.map((item, i) => {
            const base =
              item._type === "videoSlide" ? getVideoEmbedSrc(item.videoUrl) : null;
            // Gumlet: hide the player's own controls (its purple play button
            // would ring around ours); our overlay drives play/pause anyway.
            const videoSrc = base
              ? base.includes("vimeo")
                ? base
                : `${base}?disable_player_controls=true`
              : null;
            return (
              <div
                key={i}
                className="h-full flex-shrink-0"
                style={{ width: `${100 / count}%` }}
              >
                {/* Centered, contained media box: 16:9 at the strip height.
                    Clips its own corners so the rounding applies to the image,
                    the iframe and the poster/play overlay alike. */}
                <div className="relative mx-auto aspect-video h-full max-w-full overflow-hidden rounded-xl">
                {item._type === "videoSlide" ? (
                  videoSrc ? (
                    <div className="absolute inset-0">
                      <iframe
                        key={reloadTicks[i] ?? 0}
                        ref={(el) => void (iframeRefs.current[i] = el)}
                        src={videoSrc}
                        allow="autoplay; fullscreen; picture-in-picture"
                        allowFullScreen
                        className="pointer-events-none h-full w-full bg-black"
                      />
                      <div
                        role="button"
                        aria-label={playingIndex === i ? "Pause video" : "Play video"}
                        className={`absolute inset-0 flex cursor-pointer items-center justify-center outline-none ${
                          playingIndex === i ? "" : "bg-black"
                        }`}
                        onClick={() => {
                          if (lastDragAbs.current > 10) return;
                          toggleVideo(i);
                        }}
                      >
                        {/* Our own cover until playback starts: the video's
                            poster (fetched via /api/video-poster) over an
                            opaque black backing. Covering the iframe hides the
                            provider's built-in play button (Gumlet's purple
                            circle) while keeping the poster visible. */}
                        {playingIndex !== i && posters[i] && (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={posters[i]}
                            alt=""
                            draggable={false}
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                          />
                        )}
                        {playingIndex !== i && (
                          <span
                            className="relative z-10 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-lg"
                            style={{ animation: "play-invert 1.4s infinite" }}
                          >
                            <svg
                              width="24"
                              height="24"
                              viewBox="0 0 24 24"
                              fill="#000000"
                              className="ml-1"
                            >
                              <polygon points="6 4 20 12 6 20" />
                            </svg>
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="h-full w-full bg-black" />
                  )
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={urlFor(item).width(1200).height(675).fit("crop").auto("format").url()}
                    alt={item.alt || `Slide ${i + 1}`}
                    className="h-full w-full object-contain"
                    draggable={false}
                  />
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Dots stay dead-centred under the media; the expand/close toggle is
          absolutely placed so adding it doesn't shift them off centre. Colours
          invert when expanded, where the ground is black rather than the
          sheet. */}
      <div className="relative mt-4 flex min-h-11 items-center justify-center gap-3 sm:gap-0">
        {count > 1 && (
          <div
            className={`flex items-center gap-4 rounded-full border-2 px-4 py-2 ${ink} ${
              fullscreen ? "border-white" : "border-black"
            }`}
          >
            <button
              type="button"
              onClick={() => goTo(current - 1)}
              className="flex h-6 w-6 items-center justify-center transition-opacity hover:opacity-50"
              aria-label="Previous slide"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
            <div className="flex gap-3">
              {images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => goTo(i)}
                  className={`h-3 w-3 rounded-full border-2 transition-colors ${
                    fullscreen ? "border-white" : "border-black"
                  }`}
                  style={{
                    backgroundColor:
                      i === current
                        ? fullscreen
                          ? "white"
                          : "black"
                        : "transparent",
                  }}
                  aria-label={`Go to slide ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => goTo(current + 1)}
              className="flex h-6 w-6 items-center justify-center transition-opacity hover:opacity-50"
              aria-label="Next slide"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setFullscreen((v) => !v)}
          aria-label={fullscreen ? "Exit full screen" : "View full screen"}
          // In flow beside the dots on narrow screens, where an absolute
          // button would sit on top of a full-width pill; docked right (dots
          // dead-centred) once there's room.
          className={`right-0 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 transition-colors sm:absolute ${
            fullscreen
              ? "border-white text-white hover:bg-white hover:text-black"
              : "border-black text-black hover:bg-black hover:text-white"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            {fullscreen ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <polyline points="15 3 21 3 21 9" />
                <polyline points="9 21 3 21 3 15" />
                <line x1="21" y1="3" x2="14" y2="10" />
                <line x1="3" y1="21" x2="10" y2="14" />
              </>
            )}
          </svg>
        </button>
      </div>
      </div>
    </div>
  );
}
