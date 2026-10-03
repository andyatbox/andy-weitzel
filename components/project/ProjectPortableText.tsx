"use client";

import {
  PortableText,
  type PortableTextComponents,
  type PortableTextBlock,
} from "@portabletext/react";
import { urlFor } from "@/lib/sanity";

const makeComponents = (compact: boolean): PortableTextComponents => ({
  types: {
    image: ({ value }) => (
      <figure data-reveal className={compact ? "" : "my-10"}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {/* Never taller than 90% of the window (--body-img-max, set on the
            sheet from the measured height — vh is wrong on mobile). A tall
            image scales down whole and centres in the full-width box;
            anything shorter than the cap is unaffected. */}
        <img
          src={urlFor(value).width(1200).auto("format").url()}
          alt={value.alt || ""}
          className="h-auto max-h-[var(--body-img-max)] w-full object-contain"
        />
        {value.caption && (
          <figcaption className="mt-3 text-center text-sm text-black/60">
            {value.caption}
          </figcaption>
        )}
      </figure>
    ),
    code: ({ value }) => (
      <pre data-reveal className="my-8 overflow-x-auto bg-neutral-950 p-6 font-mono text-sm text-neutral-100">
        {value.language && (
          <div className="mb-4 text-neutral-500">{value.language}</div>
        )}
        <code>{value.code}</code>
      </pre>
    ),
  },
  block: {
    h1: ({ children }) => <h1 data-reveal className="mt-16 mb-6 text-4xl md:text-5xl">{children}</h1>,
    h2: ({ children }) => <h2 data-reveal className="mt-14 mb-5 text-2xl md:text-4xl">{children}</h2>,
    h3: ({ children }) => <h3 data-reveal className="mt-10 mb-4 text-xl md:text-3xl">{children}</h3>,
    h4: ({ children }) => <h4 data-reveal className="mt-8 mb-3 text-lg md:text-2xl">{children}</h4>,
    normal: ({ children }) => <p data-reveal className="mb-6 leading-relaxed">{children}</p>,
    blockquote: ({ children }) => (
      <blockquote data-reveal className="my-8 border-l-2 border-black/15 pl-6 text-black/55 italic">
        {children}
      </blockquote>
    ),
  },
  marks: {
    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    underline: ({ children }) => (
      <span className="underline underline-offset-2">{children}</span>
    ),
    link: ({ value, children }) => {
      const href: string = value?.href || "#";
      const external = href.startsWith("http");
      return (
        <a
          href={href}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
          className="underline underline-offset-2 transition-opacity hover:opacity-50"
        >
          {children}
        </a>
      );
    },
  },
  list: {
    bullet: ({ children }) => <ul data-reveal className="mb-6 list-disc space-y-2 pl-6">{children}</ul>,
    number: ({ children }) => <ol data-reveal className="mb-6 list-decimal space-y-2 pl-6">{children}</ol>,
  },
  listItem: {
    bullet: ({ children }) => <li className="leading-relaxed">{children}</li>,
    number: ({ children }) => <li className="leading-relaxed">{children}</li>,
  },
});

// Built once, not per render. These are component types to React: a fresh set
// on every render makes every block a different component each time, so the
// whole body unmounts and remounts whenever the sheet re-renders — which threw
// away the elements the reveal-on-scroll had started watching and left their
// replacements invisible.
const COMPONENTS = makeComponents(false);
const COMPONENTS_COMPACT = makeComponents(true);

export default function ProjectPortableText({
  value,
  compact = false,
}: {
  value?: PortableTextBlock[];
  compact?: boolean;
}) {
  if (!value) return null;
  return <PortableText value={value} components={compact ? COMPONENTS_COMPACT : COMPONENTS} />;
}
