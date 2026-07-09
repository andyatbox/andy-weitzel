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

export default function ProjectGallery({ images }: { images?: GallerySlide[] }) {
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

  if (!images?.length) return null;
  const count = images.length;

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
    <div className="mx-auto max-w-7xl px-6">
      <div
        className="relative aspect-video cursor-grab touch-none select-none overflow-hidden border border-black bg-neutral-100 active:cursor-grabbing"
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
            transition: dragging.current ? "none" : "transform 0.4s ease",
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
                className="relative h-full flex-shrink-0"
                style={{ width: `${100 / count}%` }}
              >
                {item._type === "videoSlide" ? (
                  videoSrc ? (
                    <div className="absolute inset-0 border border-black">
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
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {count > 1 && (
        <div className="mt-4 flex items-center justify-center">
          <div className="flex items-center gap-4 rounded-full border-2 border-black px-4 py-2">
            <button
              type="button"
              onClick={() => goTo(current - 1)}
              className="flex h-6 w-6 items-center justify-center text-black transition-opacity hover:opacity-50"
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
                  className="h-3 w-3 rounded-full border-2 border-black transition-colors"
                  style={{ backgroundColor: i === current ? "black" : "transparent" }}
                  aria-label={`Go to slide ${i + 1}`}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => goTo(current + 1)}
              className="flex h-6 w-6 items-center justify-center text-black transition-opacity hover:opacity-50"
              aria-label="Next slide"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
