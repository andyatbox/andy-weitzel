"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// How long each frame holds. No transition — it's a hard cut between stills.
const SLIDE_MS = 1300;
// Thumbnail + this many gallery stills is the whole cycle.
const MAX_SLIDES = 3;

export interface TeaserSlides {
  /** Current still, or null when the thumbnail should show. */
  texture: THREE.Texture | null;
}

/**
 * Cycles a teaser through its project's opening gallery stills: the thumbnail
 * first, then up to MAX_SLIDES images, holding SLIDE_MS on each and looping.
 * Only the active item loads anything, and it drops straight back to the
 * thumbnail the moment it stops being active.
 */
export function useTeaserSlides(
  urls: string[] | undefined,
  enabled: boolean
): TeaserSlides {
  const [textures, setTextures] = useState<THREE.Texture[]>([]);
  // 0 is the thumbnail; 1..n index into `textures`.
  const [frame, setFrame] = useState(0);
  const loaded = useRef<THREE.Texture[]>([]);

  useEffect(() => {
    if (!enabled || !urls?.length) return;
    let alive = true;
    const loader = new THREE.TextureLoader();
    // Sanity's CDN is CORS-enabled; this keeps the canvas readable for the
    // post-process, same as the thumbnails.
    loader.setCrossOrigin("anonymous");

    void Promise.all(
      urls.slice(0, MAX_SLIDES).map(
        (u) =>
          new Promise<THREE.Texture | null>((res) => {
            loader.load(
              u,
              (t) => {
                t.colorSpace = THREE.SRGBColorSpace;
                t.anisotropy = 4;
                res(t);
              },
              undefined,
              () => res(null) // a failed still just drops out of the rotation
            );
          })
      )
    ).then((list) => {
      const ok = list.filter((t): t is THREE.Texture => !!t);
      if (!alive) {
        ok.forEach((t) => t.dispose());
        return;
      }
      loaded.current = ok;
      setTextures(ok);
    });

    return () => {
      alive = false;
      loaded.current.forEach((t) => t.dispose());
      loaded.current = [];
      setTextures([]);
      setFrame(0);
    };
  }, [urls, enabled]);

  useEffect(() => {
    if (!enabled || textures.length === 0) {
      setFrame(0);
      return;
    }
    const id = setInterval(
      () => setFrame((f) => (f + 1) % (textures.length + 1)),
      SLIDE_MS
    );
    return () => clearInterval(id);
  }, [enabled, textures.length]);

  return { texture: frame > 0 ? textures[frame - 1] ?? null : null };
}
