"use client";

import { useEffect, type RefObject } from "react";

// How far up from the bottom of the window an element has to come before it
// animates in — keeps it from finishing its entrance below the fold (and under
// the project strip fixed along the bottom).
const ROOT_MARGIN = "0px 0px -10% 0px";
// Stagger between elements arriving together (the first screenful, or a row of
// columns), capped so a long batch doesn't keep the last one waiting.
const STAGGER_MS = 80;
const MAX_STAGGER_STEPS = 6;

/**
 * Animates every `[data-reveal]` element inside `root` in as it enters the
 * window (see `.reveal-on [data-reveal]` in globals.css), once each.
 *
 * `active` is the sheet being shown. Hiding it rearms everything, so the next
 * project — or the same one reopened — animates in again rather than
 * appearing already in place. Elements that mount while shown (the project's
 * data arriving after its title, or anything re-rendered into new nodes) are
 * picked up as they're added, so nothing is left in its hidden state just
 * because it wasn't in the DOM when watching began.
 */
export function useReveal(rootRef: RefObject<HTMLElement | null>, active: boolean) {
  // Rearm when the sheet hides. It's fading out by then, so nothing is seen
  // dropping back to its starting state.
  useEffect(() => {
    if (active) return;
    rootRef.current
      ?.querySelectorAll<HTMLElement>("[data-reveal].is-in")
      .forEach((el) => {
        el.classList.remove("is-in");
        el.style.transitionDelay = "";
      });
  }, [active, rootRef]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !active) return;
    // The hidden starting state only applies once this is running, so the
    // content is never left invisible if it isn't.
    root.classList.add("reveal-on");

    const io = new IntersectionObserver(
      (entries) => {
        const arriving = entries
          .filter((e) => e.isIntersecting)
          .map((e) => e.target as HTMLElement)
          // Top to bottom, then left to right, so a row of columns ripples
          // across rather than landing in DOM order.
          .sort((a, b) => {
            const ra = a.getBoundingClientRect();
            const rb = b.getBoundingClientRect();
            return ra.top - rb.top || ra.left - rb.left;
          });
        arriving.forEach((el, i) => {
          el.style.transitionDelay = `${Math.min(i, MAX_STAGGER_STEPS) * STAGGER_MS}ms`;
          el.classList.add("is-in");
          io.unobserve(el);
        });
      },
      { rootMargin: ROOT_MARGIN, threshold: 0 }
    );

    const watch = (el: HTMLElement) => {
      if (!el.classList.contains("is-in")) io.observe(el);
    };
    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach(watch);

    // Anything added later gets watched too.
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.matches("[data-reveal]")) watch(n);
          n.querySelectorAll<HTMLElement>("[data-reveal]").forEach(watch);
        });
      }
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, [active, rootRef]);
}
