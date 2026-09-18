"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// How long each frame holds. No transition — it's a hard cut between stills.
const SLIDE_MS = 800;

export interface TeaserSlides {
  /** Current still, or null when the thumbnail should show. */
  texture: THREE.Texture | null;
}

/**
 * Cycles a teaser through its project's gallery stills: the thumbnail first,
 * then every still it has, holding SLIDE_MS on each and looping. Only the
 * active item loads anything, and it drops straight back to the thumbnail the
 * moment it stops being active.
 *
 * Stills are published as they decode rather than in one batch at the end: a
 * project can carry twenty, and waiting for the last one would leave the
 * teaser sitting on its thumbnail for the whole download. The cycle simply
 * grows as more arrive, which is why the timer below reads the count from a
 * ref — keyed on it instead, every arrival would restart the interval and a
 * slow trickle of images could hold the slideshow on one frame indefinitely.
 */
export function useTeaserSlides(
  urls: string[] | undefined,
  enabled: boolean
): TeaserSlides {
  const [textures, setTextures] = useState<THREE.Texture[]>([]);
  // 0 is the thumbnail; 1..n index into `textures`.
  const [frame, setFrame] = useState(0);
  const loaded = useRef<THREE.Texture[]>([]);
  const count = useRef(0);

  useEffect(() => {
    if (!enabled || !urls?.length) return;
    let alive = true;
    const loader = new THREE.TextureLoader();
    // Sanity's CDN is CORS-enabled; this keeps the canvas readable for the
    // post-process, same as the thumbnails.
    loader.setCrossOrigin("anonymous");

    // Slots keep gallery order no matter which image decodes first; the
    // published run is the slots filled so far, so order never scrambles.
    const slots: (THREE.Texture | null)[] = urls.map(() => null);
    const publish = () => {
      const ready = slots.filter((t): t is THREE.Texture => !!t);
      loaded.current = ready;
      count.current = ready.length;
      setTextures(ready);
    };

    urls.forEach((u, i) => {
      loader.load(
        u,
        (t) => {
          if (!alive) {
            t.dispose();
            return;
          }
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          slots[i] = t;
          publish();
        },
        undefined,
        () => {
          /* a failed still just drops out of the rotation */
        }
      );
    });

    return () => {
      alive = false;
      loaded.current.forEach((t) => t.dispose());
      loaded.current = [];
      count.current = 0;
      setTextures([]);
      setFrame(0);
    };
  }, [urls, enabled]);

  useEffect(() => {
    if (!enabled) {
      setFrame(0);
      return;
    }
    const id = setInterval(() => {
      // Nothing decoded yet: hold the thumbnail rather than dividing by one.
      if (count.current === 0) {
        setFrame(0);
        return;
      }
      setFrame((f) => (f + 1) % (count.current + 1));
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, [enabled, urls]);

  return { texture: frame > 0 ? textures[frame - 1] ?? null : null };
}
