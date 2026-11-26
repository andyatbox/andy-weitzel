"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { PortfolioItem } from "./portfolios";
import { getVideoEmbedSrc } from "./videoEmbed";
import {
  attachHls,
  createVideoElement,
  resolveHls,
  retryOnNextGesture,
  throttleUploads,
} from "./hlsVideo";
import { overWhite } from "./textures";

/**
 * Every teaser the grid is showing, playing at once.
 *
 * The strip's own `useTeaserVideo` owns one element and swaps its source,
 * which is exactly right when there is one active teaser and wrong here: the
 * grid wants several at a time, each on its own stream, each released as it
 * scrolls out of view. So this is a pool — a fixed, small number of elements
 * that are assigned to cells and handed back, never created per project.
 *
 * What makes it affordable is that a cell is a third of the canvas, not the
 * whole of it. These stream at GRID_VIDEO_HEIGHT where the strip's teaser
 * streams at 720, which is about a seventh of the pixels per frame; six of
 * them together decode less than two full-size ones. Crossing back to the
 * single column tears the pool down and the strip picks its item up again at
 * full size, so the resolution follows the surface rather than the project.
 *
 * Projects with no video — and every project when the device can't be asked
 * to decode several streams at once — cycle their gallery stills instead, at
 * cell size and four frames deep, which costs a few textures and no decoder.
 */

/** The rendition ceiling for a cell. See the note above on why it's low. */
const GRID_VIDEO_HEIGHT = 360;
/** Seconds of runway per stream. Short: six of these buffer at once. */
const GRID_BUFFER_SECONDS = 4;
/**
 * GPU uploads per second, per cell. Lower than the strip's 30 because there
 * are several, and a cell is small enough that the difference doesn't read.
 */
const GRID_TEXTURE_FPS = 24;
/** The strip's own rate, so a teaser doesn't change speed when it moves. */
const PLAYBACK_RATE = 3;
/** Native HLS trick-plays above 2x — keyframes only. See lib/teaserVideo. */
const NATIVE_HLS_MAX_RATE = 2;
/** How long each still holds, matching the strip's slideshow. */
const SLIDE_MS = 800;

interface PoolSlot {
  video: HTMLVideoElement;
  tex: THREE.VideoTexture;
  hls: { destroy: () => void } | null;
  /** The item this is serving, or -1 when free. */
  item: number;
  /** Bumped on every reassignment, so a slow attach can tell it is stale. */
  token: number;
  ready: boolean;
}

export interface GridMedia {
  /** Item index → the texture that cell should show, where there is one. */
  map: Map<number, THREE.Texture>;
}

export function useGridMedia({
  items,
  inView,
  enabled,
  allowVideo,
  maxVideos,
}: {
  items: PortfolioItem[];
  /** Item indices on screen, nearest the middle of the view first. */
  inView: number[];
  /** False whenever there is no grid: the whole pool is torn down. */
  enabled: boolean;
  /**
   * Whether this device should be asked to decode several streams at once.
   * Touch devices are not: iOS runs these through AVFoundation and a handful
   * of simultaneous players is past what it will do, so there they fall
   * through to the stills, which cost no decoder at all.
   */
  allowVideo: boolean;
  maxVideos: number;
}): GridMedia {
  const pool = useRef<PoolSlot[]>([]);
  const slides = useRef(new Map<number, THREE.Texture[]>());
  // Bumped whenever the set of live textures changes, so the scene re-renders
  // and the new maps reach the materials.
  const [rev, setRev] = useState(0);
  const [frame, setFrame] = useState(0);
  const bump = () => setRev((r) => r + 1);

  // The in-view list is an array rebuilt every time the loop checks, so the
  // effects key off its contents rather than its identity.
  const key = inView.join(",");

  // ---- video -------------------------------------------------------------
  useEffect(() => {
    if (typeof document === "undefined") return;

    const want: number[] = [];
    if (enabled && allowVideo) {
      for (const i of inView) {
        if (want.length >= maxVideos) break;
        if (items[i]?.video) want.push(i);
      }
    }

    // Hand back anything no longer wanted. The element and its texture stay —
    // only the stream goes — because building a <video> per cell would put
    // element churn straight into the scroll path.
    for (const slot of pool.current) {
      if (slot.item >= 0 && !want.includes(slot.item)) {
        slot.token++;
        slot.hls?.destroy();
        slot.hls = null;
        slot.video.pause();
        slot.video.removeAttribute("src");
        slot.video.load();
        slot.item = -1;
        slot.ready = false;
      }
    }

    const held = new Set(
      pool.current.filter((s) => s.item >= 0).map((s) => s.item),
    );
    const fresh = want.filter((i) => !held.has(i));
    let changed = fresh.length > 0 || held.size !== want.length;

    for (const item of fresh) {
      let slot = pool.current.find((s) => s.item < 0);
      if (!slot && pool.current.length < maxVideos) {
        const video = createVideoElement();
        video.defaultPlaybackRate = PLAYBACK_RATE;
        video.playbackRate = PLAYBACK_RATE;
        const tex = new THREE.VideoTexture(video);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        throttleUploads(tex, GRID_TEXTURE_FPS);
        slot = { video, tex, hls: null, item: -1, token: 0, ready: false };
        pool.current.push(slot);
      }
      if (!slot) break; // pool is full; the rest keep their thumbnails

      const s = slot;
      s.item = item;
      s.ready = false;
      const token = ++s.token;
      const embed = getVideoEmbedSrc(items[item].video ?? "");
      if (!embed) {
        s.item = -1;
        continue;
      }

      void (async () => {
        const src = await resolveHls(embed);
        if (!src || s.token !== token) return;
        const handle = await attachHls(s.video, src, {
          maxHeight: GRID_VIDEO_HEIGHT,
          bufferSeconds: GRID_BUFFER_SECONDS,
          rate: PLAYBACK_RATE,
        });
        if (s.token !== token) {
          handle?.destroy();
          return;
        }
        if (!handle) {
          s.item = -1;
          return;
        }
        s.hls = handle;
        // Native HLS (iOS) trick-plays above 2x; hls.js is unaffected. Only
        // the handle knows which path was taken — hls.js points the element
        // at a MediaSource blob, so the element's own `src` says nothing.
        const rate = handle.native
          ? Math.min(PLAYBACK_RATE, NATIVE_HLS_MAX_RATE)
          : PLAYBACK_RATE;
        s.video.defaultPlaybackRate = rate;
        s.video.playbackRate = rate;
        // Hold the texture back until there is a frame to show, or the cell
        // flashes the previous project's last one.
        const onReady = () => {
          if (s.token !== token || s.video.readyState < 2) return;
          s.video.playbackRate = s.video.defaultPlaybackRate;
          if (!s.ready) {
            s.ready = true;
            bump();
          }
        };
        for (const ev of ["loadeddata", "canplay", "playing"]) {
          s.video.addEventListener(ev, onReady);
        }
        void s.video.play().catch(() => retryOnNextGesture(s.video));
      })();
    }

    if (changed) bump();
    // `key` stands in for `inView`, whose identity changes every check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, allowVideo, maxVideos, items]);

  // ---- stills ------------------------------------------------------------
  // What a cell shows when it has no video, or when this device isn't being
  // asked to decode several at once. Four frames at cell size: a project can
  // carry twenty stills at 1280 wide, and nine cells holding all of them
  // would be a hundred megabytes of texture for a thumbnail-sized picture.
  useEffect(() => {
    if (typeof document === "undefined") return;

    const want = new Set<number>();
    if (enabled) {
      let videos = 0;
      for (const i of inView) {
        const it = items[i];
        if (!it) continue;
        if (allowVideo && it.video && videos < maxVideos) {
          videos++;
          continue;
        }
        if (it.gridSlides?.length) want.add(i);
      }
    }

    let changed = false;
    for (const [i, list] of slides.current) {
      if (!want.has(i)) {
        list.forEach((t) => t.dispose());
        slides.current.delete(i);
        changed = true;
      }
    }

    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    const cancelled = { now: false };
    for (const i of want) {
      if (slides.current.has(i)) continue;
      const urls = items[i].gridSlides ?? [];
      // Gallery order is kept by filling slots, so a slow image never
      // reorders the cycle — it just joins it late.
      const got: (THREE.Texture | null)[] = urls.map(() => null);
      slides.current.set(i, []);
      changed = true;
      urls.forEach((u, k) =>
        loader.load(
          u,
          (t) => {
            if (cancelled.now || !slides.current.has(i)) {
              t.dispose();
              return;
            }
            t.colorSpace = THREE.SRGBColorSpace;
            t.anisotropy = 4;
            // A still with transparency would otherwise show the gallery's
            // black backing wherever it is see-through.
            got[k] = overWhite(t);
            slides.current.set(
              i,
              got.filter((x): x is THREE.Texture => !!x),
            );
            bump();
          },
          undefined,
          () => {
            /* a failed still just drops out of the rotation */
          },
        ),
      );
    }

    if (changed) bump();
    return () => {
      cancelled.now = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, allowVideo, maxVideos, items]);

  // One timer for the whole grid rather than one per cell. Cells are offset
  // by their own index below, so the grid ripples instead of cutting as a
  // block — a dozen hard cuts on the same frame reads as a glitch.
  useEffect(() => {
    if (!enabled) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => setFrame((f) => f + 1), SLIDE_MS);
    return () => clearInterval(id);
  }, [enabled]);

  // rAF stops in a hidden tab, so nothing would pause these on its own.
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) return;
      for (const s of pool.current) s.video.pause();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Everything goes when the scene does.
  useEffect(
    () => () => {
      for (const s of pool.current) {
        s.token++;
        s.hls?.destroy();
        s.tex.dispose();
        s.video.pause();
        s.video.removeAttribute("src");
        s.video.load();
        s.video.remove();
      }
      pool.current = [];
      for (const list of slides.current.values())
        list.forEach((t) => t.dispose());
      slides.current.clear();
    },
    [],
  );

  const map = useMemo(() => {
    const m = new Map<number, THREE.Texture>();
    for (const s of pool.current) {
      if (s.item >= 0 && s.ready) m.set(s.item, s.tex);
    }
    for (const [i, list] of slides.current) {
      if (list.length && !m.has(i)) m.set(i, list[(frame + i) % list.length]);
    }
    return m;
  }, [rev, frame]);

  return { map };
}
