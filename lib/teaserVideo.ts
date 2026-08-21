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
// in place rather than restarting. Only one video element exists at a time, so
// this is what makes "pauses in place" survive the teardown.
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

export interface TeaserVideo {
  texture: THREE.VideoTexture | null;
  /** Live element, for per-frame play/pause without re-rendering React. */
  el: React.RefObject<HTMLVideoElement | null>;
}

/**
 * Builds a VideoTexture for one item's video, and only while `enabled`.
 * Exactly one video element is alive at a time: when the gallery moves on,
 * this tears down (remembering the playhead) so memory and decode cost stay
 * flat no matter how many projects carry video.
 */
export function useTeaserVideo(
  videoUrl: string | undefined,
  enabled: boolean
): TeaserVideo {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
  const el = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const embed = videoUrl ? getVideoEmbedSrc(videoUrl) : null;
    if (!enabled || !embed) return;

    let alive = true;
    let video: HTMLVideoElement | null = null;
    let tex: THREE.VideoTexture | null = null;
    // hls.js instance; typed loosely so the dynamic import stays lazy.
    let hls: { destroy: () => void } | null = null;
    let src: string | null = null;

    const onLoaded = () => {
      if (!alive || !video) return;
      video.playbackRate = PLAYBACK_RATE; // re-assert after the media loaded
      tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      throttleUploads(tex, MAX_TEXTURE_FPS);
      el.current = video;
      // Swap only once a frame is decodable, so the image teaser never
      // flashes to black while the stream spins up.
      setTexture(tex);
    };
    // rAF stops when the tab is hidden, so the per-frame gate below stops
    // running — pause explicitly rather than decode in the background.
    const onVisibility = () => {
      if (document.hidden) video?.pause();
    };

    void (async () => {
      src = await resolveHls(embed);
      if (!alive || !src) return;

      video = document.createElement("video");
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
      // load() resets playbackRate to defaultPlaybackRate, and assigning src
      // (or attaching hls) triggers exactly that — so set both, or the rate is
      // silently dropped back to 1x before the first frame.
      video.defaultPlaybackRate = PLAYBACK_RATE;
      video.playbackRate = PLAYBACK_RATE;
      video.addEventListener("loadeddata", onLoaded, { once: true });
      // WebKit will not reliably decode a detached media element, so keep it
      // in the document — parked off-screen at 1px, never display:none, which
      // would stop decoding altogether.
      video.setAttribute("aria-hidden", "true");
      video.style.cssText =
        "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;" +
        "pointer-events:none;z-index:-1;";
      document.body.appendChild(video);

      if (prefersNativeHls(video)) {
        video.src = src;
      } else {
        const Hls = (await import("hls.js")).default;
        if (!alive || !video) return;
        if (Hls.isSupported()) {
          const instance = new Hls({
            // Only a few seconds of runway — this is a teaser, not a player.
            maxBufferLength: 8,
            maxMaxBufferLength: 12,
            capLevelToPlayerSize: false,
            enableWorker: true,
          });
          instance.on(Hls.Events.MANIFEST_PARSED, () => {
            // Let ABR adapt to the connection, but never above the height the
            // teaser can actually show. Levels aren't ordered by quality in
            // the manifest, so pick the tallest that fits the cap.
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
          hls = instance;
        } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
          video.src = src;
        } else {
          return; // no path to play it; the image stays
        }
      }

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
      if (video) {
        if (src) resumeAt.set(src, video.currentTime);
        video.removeEventListener("loadeddata", onLoaded);
        video.pause();
        video.removeAttribute("src");
        video.load(); // drop the decoder + buffers
        video.remove();
      }
      hls?.destroy();
      tex?.dispose();
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
    if (video.paused) void video.play().catch(() => {});
  } else if (!video.paused) {
    video.pause(); // holds position — no rewind
  }
}
