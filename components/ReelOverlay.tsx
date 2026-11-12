"use client";

import { useEffect, useRef, useState } from "react";
import {
  attachHls,
  resolveHls,
  retryOnNextGesture,
  type HlsHandle,
} from "@/lib/hlsVideo";
import { detectTouch } from "@/lib/pointerFx";
import { REEL_EMBED } from "@/lib/reel";

/**
 * The sizzle reel, full-screen and flat.
 *
 * The landing gate plays the same stream (`REEL_EMBED`) bent around a shape
 * and a dome; this is the other half of that idea — the one place on the site
 * the reel is shown as shot, with no shader between it and the viewer. It is
 * a plain `<video>`, not a WebGL surface, so none of the texture plumbing
 * (`VideoTexture`, upload throttling, the sRGB-decode trap) applies. What is
 * shared is `attachHls`, because the engine-by-engine question of how to play
 * a Gumlet stream at all is the same wherever it is asked.
 *
 * The source carries no audio track — every rendition in the manifest is
 * video-only — so there is deliberately no sound control to offer.
 */

/** Tallest rendition to pull. The same policy the landing uses. */
const MAX_HEIGHT = 1080;
const MAX_HEIGHT_TOUCH = 720;

export default function ReelOverlay({
  onClose,
  height,
}: {
  onClose: () => void;
  /** Measured window height. Never vh — see the hard rules in CLAUDE.md. */
  height: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let alive = true;
    let handle: HlsHandle | null = null;

    void (async () => {
      const src = await resolveHls(REEL_EMBED);
      if (!alive) return;
      if (!src) {
        setFailed(true);
        return;
      }
      handle = await attachHls(video, src, {
        maxHeight: detectTouch() ? MAX_HEIGHT_TOUCH : MAX_HEIGHT,
        bufferSeconds: 12,
        // Shown at the size of the whole window, so open on the top
        // rendition rather than climbing to it over the first few seconds.
        assumeBandwidth: 6_000_000,
      });
      if (!alive) {
        handle?.destroy();
        return;
      }
      if (!handle) {
        setFailed(true);
        return;
      }
      void video.play().catch(() => retryOnNextGesture(video));
    })();

    return () => {
      alive = false;
      // Tear the stream down rather than leave it buffering behind a closed
      // overlay — nothing else on this page is playing it.
      handle?.destroy();
      video.pause();
    };
  }, []);

  return (
    // Below the custom cursor (z-index 200) and above everything else,
    // including the splash gate at z-80 and the info panels at z-90.
    <div
      className="fixed inset-x-0 top-0 z-[95] bg-black"
      style={{ height }}
      role="dialog"
      aria-modal="true"
      aria-label="Showreel"
    >
      {/* The letterbox margin doubles as the backdrop, as in InfoModal: a
          click anywhere off the picture closes. The video itself swallows
          clicks, so the frame is never dismissed by a click on the work. */}
      <button
        type="button"
        aria-label="Close reel"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <video
        ref={videoRef}
        className="relative h-full w-full object-contain transition-opacity duration-500"
        style={{ opacity: playing ? 1 : 0 }}
        onPlaying={() => setPlaying(true)}
        playsInline
        muted
        loop
        preload="auto"
      />
      {failed && (
        <p className="absolute inset-0 z-10 flex items-center justify-center p-8 text-center text-sm text-white/70">
          The reel could not be loaded.
        </p>
      )}
      {/* A real border, not a ring: the stroke has to read against whatever
          frame of the reel is behind it, and the picture runs edge to edge. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close reel"
        className="absolute right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full border border-white text-white transition-colors hover:bg-white hover:text-black"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
        >
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
      </button>
    </div>
  );
}
