"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { overWhite } from "./textures";

// How long each frame holds. No transition — it's a hard cut between stills.
const SLIDE_MS = 800;

export interface TeaserSlides {
  /** Current still, or null when the thumbnail should show. */
  texture: THREE.Texture | null;
}

/**
 * Cycles a teaser through its project's gallery stills, holding SLIDE_MS on
 * each and looping. The thumbnail is not one of the frames — it is what an
 * inactive teaser shows, and what this one shows only until the first still
 * decodes. Only the active item loads anything, and it drops straight back to
 * the thumbnail the moment it stops being active.
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
  // Indexes `textures` directly.
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
          // A still with transparency would otherwise show the gallery's
          // black backing wherever it is see-through.
          slots[i] = overWhite(t);
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
      // Nothing decoded yet: there is nothing to advance to.
      if (count.current === 0) {
        setFrame(0);
        return;
      }
      setFrame((f) => (f + 1) % count.current);
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, [enabled, urls]);

  // The modulo guards the frame where `frame` is still pointing past a run
  // that has just been emptied (a portfolio switch) — null there means the
  // thumbnail, which is what an inactive teaser shows anyway.
  return {
    texture: textures.length ? textures[frame % textures.length] ?? null : null,
  };
}
