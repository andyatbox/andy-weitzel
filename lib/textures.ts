"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { PortfolioItem } from "./portfolios";

const IMAGE_ASPECT = 16 / 9;

/**
 * Crops the 16:9 texture to the plane's aspect ratio via repeat/offset,
 * mimicking CSS object-fit: cover.
 */
export function applyCover(texture: THREE.Texture, planeAspect: number) {
  if (!planeAspect || !isFinite(planeAspect)) return;
  if (planeAspect > IMAGE_ASPECT) {
    texture.repeat.set(1, IMAGE_ASPECT / planeAspect);
    texture.offset.set(0, (1 - texture.repeat.y) / 2);
  } else {
    texture.repeat.set(planeAspect / IMAGE_ASPECT, 1);
    texture.offset.set((1 - texture.repeat.x) / 2, 0);
  }
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
}

// How wide the alpha probe is drawn. Answering "is any of this transparent?"
// at full size would cost more than the flatten it guards; a transparent
// ground is never a few stray pixels, so a thumbnail this small finds it.
const ALPHA_PROBE = 64;

/** Whether any pixel of a loaded image is less than fully opaque. */
function hasAlpha(img: CanvasImageSource, w: number, h: number) {
  const probe = document.createElement("canvas");
  const scale = Math.min(1, ALPHA_PROBE / Math.max(w, h));
  probe.width = Math.max(1, Math.round(w * scale));
  probe.height = Math.max(1, Math.round(h * scale));
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(img, 0, 0, probe.width, probe.height);
  try {
    const { data } = ctx.getImageData(0, 0, probe.width, probe.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  } catch {
    // Tainted canvas: the image isn't CORS-readable, so it can't be flattened
    // either. Leave it exactly as it was rather than failing the load.
    return false;
  }
}

/**
 * Gives a teaser its white ground.
 *
 * The gallery has nothing behind a teaser to show through: three additively
 * blended R/G/B planes sum over an opaque black backing, which is what lets
 * the chromatic split work without darkening (see ChannelPlanes). Where the
 * source is transparent the channels add nothing, so that black backing is
 * what you get — and a still that is black artwork on a transparent ground,
 * as NoHo B.I.D.'s first one is, renders as a solid black teaser.
 *
 * Painting the backing plane white instead does not work, and is worth
 * stating because it is the obvious move: the channels sum *on top of* it, so
 * every teaser clips to flat white. The ground has to go under the artwork
 * before the texture reaches the GPU, which is what this does — over white,
 * the same colour the project sheet shows these stills over, so the teaser
 * and the slider agree.
 *
 * Opaque sources, which is nearly all of them, are handed straight back, so
 * the copy is only paid for by an image that would otherwise render wrong.
 */
export function overWhite(texture: THREE.Texture): THREE.Texture {
  const img = texture.image as (CanvasImageSource & {
    width?: number;
    height?: number;
  }) | null;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  if (!img || !w || !h || !hasAlpha(img, w, h)) return texture;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return texture;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);

  const flat = new THREE.CanvasTexture(canvas);
  flat.colorSpace = texture.colorSpace;
  flat.anisotropy = texture.anisotropy;
  // Never uploaded — this runs the moment the load resolves — so disposing
  // the original only drops the decoded image, not a GPU allocation.
  texture.dispose();
  return flat;
}

/** 16:9 procedural placeholder, shown immediately and kept if the network image fails. */
function makePlaceholderTexture(item: PortfolioItem, index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext("2d")!;

  const hue = (index * 137) % 360;
  const gradient = ctx.createLinearGradient(0, 0, 1600, 900);
  gradient.addColorStop(0, `hsl(${hue} 45% 32%)`);
  gradient.addColorStop(1, `hsl(${(hue + 50) % 360} 50% 12%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1600, 900);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.font = "700 480px Helvetica, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index + 1).padStart(2, "0"), 800, 470);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * One texture per item: a placeholder appears instantly, then is swapped
 * for the remote dummy image once it loads. Cover-cropping is reapplied
 * whenever the plane aspect (window size / orientation) changes.
 */
export function useItemTextures(items: PortfolioItem[], planeAspect: number) {
  const [textures, setTextures] = useState<THREE.Texture[]>([]);
  // What's *currently* in use, which is not the same as what this effect
  // created: each loaded image replaces its placeholder. Disposing only the
  // placeholders on unmount (as this used to) leaked every loaded texture —
  // a full-size RGBA upload per item, orphaned on the GPU on each portfolio
  // switch, since the scene remounts on `key={portfolio}`.
  const live = useRef<THREE.Texture[]>([]);

  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    // Sanity's CDN (cdn.sanity.io) is cross-origin and CORS-enabled; this lets
    // the loaded image be used as a WebGL texture without tainting the canvas.
    loader.setCrossOrigin("anonymous");

    const placeholders = items.map((item, i) => {
      loader.load(
        item.image,
        (loaded) => {
          if (!alive) {
            loaded.dispose();
            return;
          }
          loaded.colorSpace = THREE.SRGBColorSpace;
          loaded.anisotropy = 4;
          const ready = overWhite(loaded);
          setTextures((prev) => {
            const next = prev.map((tex, j) => {
              if (j !== i) return tex;
              tex.dispose();
              return ready;
            });
            // Tracked here rather than in a separate effect: the updater always
            // sees the true current array, where an effect keyed on `textures`
            // can run with a stale one in the same commit that swaps `items`.
            live.current = next;
            return next;
          });
        },
        undefined,
        () => {
          // Keep the procedural placeholder if the image fails to load.
          console.warn(`Image failed to load, using placeholder: ${item.image}`);
        }
      );
      return makePlaceholderTexture(item, i);
    });

    live.current = placeholders;
    setTextures(placeholders);
    return () => {
      alive = false;
      live.current.forEach((tex) => tex.dispose());
      live.current = [];
    };
  }, [items]);

  useEffect(() => {
    textures.forEach((tex) => applyCover(tex, planeAspect));
  }, [textures, planeAspect]);

  return textures;
}
