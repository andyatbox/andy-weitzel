"use client";

import { useRef, useState } from "react";
import type { SanityImage } from "@/lib/portfolios";
import { urlFor } from "@/lib/sanity";

export default function ProjectGallery({ images }: { images?: SanityImage[] }) {
  const [current, setCurrent] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const startX = useRef<number | null>(null);
  const deltaX = useRef(0);
  const dragging = useRef(false);

  if (!images?.length) return null;
  const count = images.length;

  const goTo = (index: number) => {
    setCurrent((index + count) % count);
    setDragOffset(0);
  };

  const dragStart = (x: number) => {
    startX.current = x;
    deltaX.current = 0;
    dragging.current = true;
  };
  const dragMove = (x: number) => {
    if (!dragging.current || startX.current === null) return;
    deltaX.current = x - startX.current;
    setDragOffset(deltaX.current);
  };
  const dragEnd = () => {
    if (!dragging.current) return;
    if (Math.abs(deltaX.current) > 50) goTo(current + (deltaX.current < 0 ? 1 : -1));
    else setDragOffset(0);
    dragging.current = false;
    deltaX.current = 0;
  };

  return (
    <div className="mx-auto max-w-7xl px-6">
      <div
        className="relative aspect-video cursor-grab touch-none select-none overflow-hidden rounded-lg bg-neutral-100 active:cursor-grabbing"
        onTouchStart={(e) => dragStart(e.touches[0].clientX)}
        onTouchMove={(e) => dragMove(e.touches[0].clientX)}
        onTouchEnd={dragEnd}
        onMouseDown={(e) => dragStart(e.clientX)}
        onMouseMove={(e) => dragMove(e.clientX)}
        onMouseUp={dragEnd}
        onMouseLeave={dragEnd}
      >
        <div
          className="flex h-full"
          style={{
            width: `${count * 100}%`,
            transform: `translateX(calc(${-current * (100 / count)}% + ${dragOffset}px))`,
            transition: dragging.current ? "none" : "transform 0.4s ease",
          }}
        >
          {images.map((image, i) => (
            <div
              key={i}
              className="relative h-full flex-shrink-0"
              style={{ width: `${100 / count}%` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={urlFor(image).width(1200).height(675).fit("crop").auto("format").url()}
                alt={image.alt || `Slide ${i + 1}`}
                className="h-full w-full object-cover"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>

      {count > 1 && (
        <div className="mt-4 flex items-center justify-center gap-4">
          <button
            type="button"
            onClick={() => goTo(current - 1)}
            className="flex h-10 w-10 items-center justify-center text-black transition-opacity hover:opacity-50"
            aria-label="Previous slide"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className="flex gap-3">
            {images.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => goTo(i)}
                className="h-3 w-3 rounded-full border-2 border-black transition-colors"
                style={{ backgroundColor: i === current ? "black" : "transparent" }}
                aria-label={`Go to slide ${i + 1}`}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => goTo(current + 1)}
            className="flex h-10 w-10 items-center justify-center text-black transition-opacity hover:opacity-50"
            aria-label="Next slide"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
