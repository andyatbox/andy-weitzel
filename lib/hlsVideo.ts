"use client";

import * as THREE from "three";

/**
 * Shared plumbing for texturing a Gumlet video into WebGL.
 *
 * Gumlet publishes no usable MP4 (every variant 401/403s), so anything that
 * shows one of these videos streams HLS. The traps below have each cost this
 * codebase a session, so they live in one place rather than being re-derived
 * per feature — see the teaser and the intro cube, which both build on this.
 */

// Embed src -> HLS manifest, resolved through our own route (the collection
// id lives in the embed HTML, which the browser can't read cross-origin).
// Memoised so a second consumer of the same source costs nothing.
const sourceCache = new Map<string, Promise<string | null>>();

export function resolveHls(embedSrc: string): Promise<string | null> {
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

/**
 * A muted, inline, autoplay-capable element parked in the document.
 *
 * WebKit will not reliably decode a detached media element, so it stays in the
 * DOM at 1px — never `display:none`, which stops decoding altogether.
 */
export function createVideoElement(): HTMLVideoElement {
  const video = document.createElement("video");
  // CORS is open on Gumlet's media (ACAO: *); this keeps the WebGL canvas
  // untainted, which the post-process depends on to read it back.
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("muted", "");
  video.preload = "auto";
  video.setAttribute("aria-hidden", "true");
  video.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;" +
    "pointer-events:none;z-index:-1;";
  document.body.appendChild(video);
  return video;
}

/**
 * VideoTexture re-arms requestVideoFrameCallback for every decoded frame and
 * flips needsUpdate each time — 50 GPU uploads a second at these sources'
 * frame rate. Gate the setter so uploads happen at most `fps` times a second;
 * otherwise it mirrors three's own setter exactly.
 */
export function throttleUploads(tex: THREE.VideoTexture, fps: number) {
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

export function retryOnNextGesture(video: HTMLVideoElement) {
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

export interface HlsHandle {
  destroy: () => void;
}

/**
 * Points a <video> at an HLS manifest, by whichever route this engine can
 * actually decode.
 *
 * Order matters and is not negotiable: Chrome answers "maybe" to the HLS mime
 * type but cannot play it, so `canPlayType` must never be the first branch —
 * it would send every Chrome visitor down a path that silently never decodes.
 * Prefer hls.js wherever Media Source Extensions exist, and keep native for
 * the engines that lack MSE but do speak HLS (iOS). Feeding WebKit hls.js
 * instead hands it a MediaSource blob, which it plays but renders as a black
 * frame through WebGL.
 *
 * Returns a handle to tear the stream down, or null when neither path works
 * (the caller keeps whatever it was showing).
 */
export async function attachHls(
  video: HTMLVideoElement,
  src: string,
  opts: {
    maxHeight?: number;
    bufferSeconds?: number;
    rate?: number;
    /**
     * Bandwidth (bits/s) to assume before any has been measured. hls.js
     * otherwise guesses low and opens on its smallest rendition, climbing
     * only once a few segments have been timed — seconds of a soft picture
     * on a surface that's shown large.
     */
    assumeBandwidth?: number;
  } = {}
): Promise<HlsHandle | null> {
  const { maxHeight = 720, bufferSeconds = 8, rate = 1, assumeBandwidth } = opts;
  const canNative = !!video.canPlayType("application/vnd.apple.mpegurl");
  const hasMse = typeof window !== "undefined" && "MediaSource" in window;
  const Hls = hasMse ? (await import("hls.js")).default : null;

  if (Hls?.isSupported()) {
    const instance = new Hls({
      // Media seconds, which drain at the playback rate — scaled so the
      // wall-clock runway doesn't shrink when the caller speeds playback up.
      maxBufferLength: bufferSeconds * rate,
      maxMaxBufferLength: bufferSeconds * 1.5 * rate,
      capLevelToPlayerSize: false,
      enableWorker: true,
      ...(assumeBandwidth ? { abrEwmaDefaultEstimate: assumeBandwidth } : {}),
    });
    instance.on(Hls.Events.MANIFEST_PARSED, () => {
      // Let ABR adapt to the connection, but never above the height this
      // surface can actually show. Levels aren't ordered by quality in the
      // manifest, so pick the tallest that fits the cap.
      const levels = instance.levels ?? [];
      let cap = -1;
      let capH = -1;
      levels.forEach((l, i) => {
        if (l.height <= maxHeight && l.height > capH) {
          capH = l.height;
          cap = i;
        }
      });
      if (cap >= 0) instance.autoLevelCapping = cap;
    });
    instance.loadSource(src);
    instance.attachMedia(video);
    return instance;
  }

  if (canNative) {
    // iOS Safari: no MSE, but native HLS. Above 2x it switches to trick play
    // off the I-frame playlists Gumlet publishes, so callers cap their rate.
    video.src = src;
    return {
      destroy: () => {
        video.removeAttribute("src");
        video.load();
      },
    };
  }

  return null; // no path to play it
}
