"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { getVideoEmbedSrc } from "./videoEmbed";

// --- Trim/speed. Teasers loop just the opening at a lifted rate, which also
// means only the first HLS segments are ever fetched. Set LOOP_SECONDS to 0 to
// play the whole video, and PLAYBACK_RATE to 1 for normal speed.
const LOOP_SECONDS = 15;
const PLAYBACK_RATE = 1.5;

// Quality/cost dial. The teaser plane is at most about window-sized, so 720p
// covers it; each step up multiplies both decode work and the per-frame GPU
// upload. Drop this to 480 if the effect ever needs to get cheaper.
const MAX_VIDEO_HEIGHT = 720;
// These sources run at 50fps. Re-uploading a 720p frame to the GPU that often
// is the largest cost this feature adds, and the teaser reads identically at
// half the rate, so uploads are capped here. Decode still runs at source rate.
const MAX_TEXTURE_FPS = 30;

/**
 * Gumlet publishes no usable MP4 (every variant 401/403s), so teasers stream
 * HLS. Safari plays that natively; everywhere else needs hls.js, which is
 * imported dynamically so the ~40KB never reaches visitors who don't hit a
 * project with a video.
 */

// Embed src -> HLS manifest, resolved through our own route (the collection
// id lives in the embed HTML, which the browser can't read cross-origin).
// Memoised so revisiting an item costs nothing.
const sourceCache = new Map<string, Promise<string | null>>();
function resolveHls(embedSrc: string): Promise<string | null> {
  let p = sourceCache.get(embedSrc);
  if (!p) {
    p = fetch(`/api/video-poster?src=${encodeURIComponent(embedSrc)}`)
      .then((r) => r.json())
      .then((d: { hls?: string | null }) => d?.hls ?? null)
      .catch(() => null);
    sourceCache.set(embedSrc, p);
  }
  return p;
}

// Where each video was when it went inactive, so returning to an item picks up
// in place rather than restarting.
const resumeAt = new Map<string, number>();

/**
 * WebKit (Safari desktop, and every browser on iOS) plays HLS natively and can
 * texture that into WebGL. Feeding it hls.js instead hands it a MediaSource
 * blob, which WebKit will play but renders as a black frame through WebGL —
 * so route Apple engines to the native path and keep hls.js for Blink/Gecko.
 * Note Chrome answers "maybe" to the HLS mime type despite being unable to
 * play it, so canPlayType alone can't make this decision.
 */
function prefersNativeHls(video: HTMLVideoElement): boolean {
  if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
  return typeof navigator !== "undefined" && /apple/i.test(navigator.vendor || "");
}

/**
 * VideoTexture re-arms requestVideoFrameCallback for every decoded frame and
 * flips needsUpdate each time — 50 GPU uploads a second at these sources'
 * frame rate. Gate the setter so uploads happen at most MAX_TEXTURE_FPS times
 * a second; otherwise it mirrors three's own setter exactly.
 */
function throttleUploads(tex: THREE.VideoTexture, fps: number) {
  const interval = 1000 / fps;
  let last = 0;
  Object.defineProperty(tex, "needsUpdate", {
    configurable: true,
    get: () => false,
    set(value: boolean) {
      if (value !== true) return;
      const now = performance.now();
      if (now - last < interval) return;
      last = now;
      tex.version++;
      tex.source.needsUpdate = true;
    },
  });
}

// If play() is refused, retrying on a timer never helps — only a call made
// from inside a real user gesture will be granted. Queue one retry against the
// next interaction rather than hammering it every frame.
let gestureRetryArmed = false;
function retryOnNextGesture(video: HTMLVideoElement) {
  if (gestureRetryArmed || typeof window === "undefined") return;
  gestureRetryArmed = true;
  const go = () => {
    gestureRetryArmed = false;
    window.removeEventListener("pointerup", go, true);
    window.removeEventListener("touchend", go, true);
    void video.play().catch(() => {});
  };
  window.addEventListener("pointerup", go, true);
  window.addEventListener("touchend", go, true);
}

export interface TeaserVideo {
  texture: THREE.VideoTexture | null;
  /** Live element, for per-frame play/pause without re-rendering React. */
  el: React.RefObject<HTMLVideoElement | null>;
}

/**
 * Streams one item's video into a VideoTexture, while `enabled`.
 *
 * The <video> element and its texture are created once and then *reused* for
 * every project — only the source is swapped. That matters on iOS: an element
 * that has played once following a user gesture stays unlocked for later
 * programmatic play(), but a freshly created element does not inherit that, so
 * building a new one per project meant the first teaser played (unlocked by
 * the splash tap) and every one after it was silently refused. Reuse also
 * keeps element and decoder churn out of the scroll path.
 */
export function useTeaserVideo(
  videoUrl: string | undefined,
  enabled: boolean
): TeaserVideo {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
  const el = useRef<HTMLVideoElement | null>(null);
  // Persistent across source changes; torn down only when the scene unmounts.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const texRef = useRef<THREE.VideoTexture | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  // Build the element + texture once, on first use.
  const ensure = () => {
    if (videoRef.current) return videoRef.current;
    const video = document.createElement("video");
    // CORS is open on Gumlet's media (ACAO: *); this keeps the WebGL canvas
    // untainted, which PsychedelicFX depends on to read it back.
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.defaultMuted = true;
    video.loop = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("muted", "");
    video.preload = "auto";
    // load() resets playbackRate to defaultPlaybackRate, and every source swap
    // triggers that — so set both or the rate silently drops back to 1x.
    video.defaultPlaybackRate = PLAYBACK_RATE;
    video.playbackRate = PLAYBACK_RATE;
    // WebKit will not reliably decode a detached media element, so keep it in
    // the document — parked off-screen at 1px, never display:none, which would
    // stop decoding altogether.
    video.setAttribute("aria-hidden", "true");
    video.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;" +
      "pointer-events:none;z-index:-1;";
    document.body.appendChild(video);

    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    throttleUploads(tex, MAX_TEXTURE_FPS);

    videoRef.current = video;
    texRef.current = tex;
    return video;
  };

  // Tear the shared element down only when the gallery scene goes away.
  useEffect(
    () => () => {
      hlsRef.current?.destroy();
      hlsRef.current = null;
      texRef.current?.dispose();
      texRef.current = null;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      }
      videoRef.current = null;
      el.current = null;
    },
    []
  );

  useEffect(() => {
    const embed = videoUrl ? getVideoEmbedSrc(videoUrl) : null;
    if (!enabled || !embed) return;

    let alive = true;
    let src: string | null = null;

    // Publish the texture only once the new source has a decodable frame, so
    // the teaser never shows the previous project's last frame. Several events
    // are watched because engines disagree on which fires first for a stream
    // that only starts buffering on play().
    const onReady = () => {
      const video = videoRef.current;
      if (!alive || !video || !texRef.current) return;
      if (video.readyState < 2) return;
      video.playbackRate = PLAYBACK_RATE; // re-assert after the media loaded
      setTexture(texRef.current);
    };
    const READY_EVENTS = ["loadeddata", "canplay", "playing"] as const;
    // rAF stops when the tab is hidden, so the per-frame gate below stops
    // running — pause explicitly rather than decode in the background.
    const onVisibility = () => {
      if (document.hidden) videoRef.current?.pause();
    };

    void (async () => {
      src = await resolveHls(embed);
      if (!alive || !src) return;

      const video = ensure();
      setTexture(null); // old source's frames must not show under the new item
      hlsRef.current?.destroy();
      hlsRef.current = null;
      for (const ev of READY_EVENTS) video.addEventListener(ev, onReady);

      // Order matters: Chrome answers "maybe" to the HLS mime type but cannot
      // actually play it, so canPlayType must never be the first branch — it
      // would send every Chrome visitor down a path that silently never
      // decodes. Prefer hls.js wherever Media Source Extensions exist, and
      // keep native for the engines that lack MSE but do speak HLS (iOS).
      const canNative = !!video.canPlayType("application/vnd.apple.mpegurl");
      const hasMse = typeof window !== "undefined" && "MediaSource" in window;
      const Hls = hasMse ? (await import("hls.js")).default : null;
      if (!alive) return;

      if (Hls?.isSupported()) {
        const instance = new Hls({
          // A teaser needs a few seconds of runway, not the whole file.
          maxBufferLength: 8,
          maxMaxBufferLength: 12,
          capLevelToPlayerSize: false,
          enableWorker: true,
        });
        instance.on(Hls.Events.MANIFEST_PARSED, () => {
          // Let ABR adapt to the connection, but never above the height the
          // teaser can actually show. Levels aren't ordered by quality in the
          // manifest, so pick the tallest that fits the cap.
          const levels = instance.levels ?? [];
          let cap = -1;
          let capH = -1;
          levels.forEach((l, i) => {
            if (l.height <= MAX_VIDEO_HEIGHT && l.height > capH) {
              capH = l.height;
              cap = i;
            }
          });
          if (cap >= 0) instance.autoLevelCapping = cap;
        });
        instance.loadSource(src);
        instance.attachMedia(video);
        hlsRef.current = instance;
      } else if (canNative) {
        video.src = src; // iOS Safari: no MSE, but native HLS
      } else {
        return; // no path to play it; the image stays
      }

      // Publish the element now, not when it becomes decodable. iOS Safari
      // ignores preload="auto" and won't buffer until playback is requested,
      // so gating this on readiness deadlocks: no play() means no data, no
      // data means no ready event, so play() is never called.
      el.current = video;
      document.addEventListener("visibilitychange", onVisibility);

      // Resume where this item left off.
      let at = resumeAt.get(src);
      if (at && LOOP_SECONDS > 0 && at >= LOOP_SECONDS) at = 0;
      if (at) {
        try {
          video.currentTime = at;
        } catch {
          /* seeking before metadata — harmless, starts at 0 */
        }
      }
    })();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      const video = videoRef.current;
      if (video) {
        if (src) resumeAt.set(src, video.currentTime);
        for (const ev of READY_EVENTS) video.removeEventListener(ev, onReady);
        video.pause(); // holds position; the element itself is kept
      }
      // Drop the stream's buffers, but keep the element and its texture.
      hlsRef.current?.destroy();
      hlsRef.current = null;
      el.current = null;
      setTexture(null);
    };
  }, [videoUrl, enabled]);

  return { texture, el };
}

/**
 * Per-frame playback gate. Kept out of React state so scrolling never
 * re-renders: called from the render loop with whether the item is the
 * active, settled one.
 */
export function driveTeaserPlayback(
  video: HTMLVideoElement | null,
  shouldPlay: boolean
) {
  if (!video) return;
  if (shouldPlay) {
    // Trim to the opening seconds when configured.
    if (LOOP_SECONDS > 0 && video.currentTime >= LOOP_SECONDS) {
      video.currentTime = 0;
    }
    if (video.paused) void video.play().catch(() => retryOnNextGesture(video));
  } else if (!video.paused) {
    video.pause(); // holds position — no rewind
  }
}
