"use client";

import { useEffect, useState } from "react";
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
          setTextures((prev) =>
            prev.map((tex, j) => {
              if (j !== i) return tex;
              tex.dispose();
              return loaded;
            })
          );
        },
        undefined,
        () => {
          // Keep the procedural placeholder if the image fails to load.
          console.warn(`Image failed to load, using placeholder: ${item.image}`);
        }
      );
      return makePlaceholderTexture(item, i);
    });

    setTextures(placeholders);
    return () => {
      alive = false;
      placeholders.forEach((tex) => tex.dispose());
    };
  }, [items]);

  useEffect(() => {
    textures.forEach((tex) => applyCover(tex, planeAspect));
  }, [textures, planeAspect]);

  return textures;
}
