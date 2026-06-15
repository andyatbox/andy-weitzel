"use client";

import { useEffect, useState } from "react";

export interface ViewportState {
  width: number;
  height: number;
  isLandscape: boolean;
}

/**
 * Tracks window.innerWidth/innerHeight (not 100vh) so full-screen DOM
 * containers get a real pixel height, set on mount and on every resize /
 * orientation change.
 */
export function useViewport(): ViewportState | null {
  const [viewport, setViewport] = useState<ViewportState | null>(null);

  useEffect(() => {
    const update = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
        isLandscape: window.innerWidth >= window.innerHeight,
      });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return viewport;
}
