"use client";

import { useEffect } from "react";

export type InfoKind = "resume" | "contact";

const CONTACT_EMAIL = "andy@box.biz";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-7 border-t border-white/15 pt-5 text-lg font-semibold text-white md:text-xl">
      {children}
    </h3>
  );
}

/** Placeholder content — swap for the real résumé / contact details later. */
const CONTENT: Record<InfoKind, { title: string; body: React.ReactNode }> = {
  resume: {
    title: "Resumé",
    body: (
      <>
        <p>
          Creative Director and full-stack builder with 15+ years shaping
          brands, immersive web experiences, and the systems behind them. I work
          across strategy, art direction, and engineering — from the first
          sketch to the shipped WebGL.
        </p>

        <SectionTitle>Experience</SectionTitle>
        <ul className="space-y-4">
          <li>
            <div className="font-medium text-white">
              Creative Director — Studio Placeholder
            </div>
            <div className="text-sm text-white/45">2019 — Present</div>
            <p className="mt-1">
              Lead creative across brand, product, and interactive. Built the
              design system and the real-time graphics pipeline behind flagship
              launches.
            </p>
          </li>
          <li>
            <div className="font-medium text-white">
              Lead Designer — Agency Lorem
            </div>
            <div className="text-sm text-white/45">2014 — 2019</div>
            <p className="mt-1">
              Art-directed campaigns for global clients and grew the motion and
              web practices from the ground up.
            </p>
          </li>
          <li>
            <div className="font-medium text-white">
              Designer / Developer — Freelance
            </div>
            <div className="text-sm text-white/45">2009 — 2014</div>
            <p className="mt-1">
              Brand identities, sites, and one-off experiments for startups and
              studios.
            </p>
          </li>
        </ul>

        <SectionTitle>Selected Work</SectionTitle>
        <ul className="space-y-1.5">
          <li>Immersive product launch — WebGL configurator</li>
          <li>Rebrand &amp; design system — placeholder retail</li>
          <li>Interactive annual report — data-driven scrollytelling</li>
          <li>Generative identity — broadcast package</li>
        </ul>

        <SectionTitle>Capabilities</SectionTitle>
        <p>
          Brand strategy · Art direction · Identity systems · Motion · WebGL /
          React Three Fiber · Front-end engineering · Design ops.
        </p>

        <SectionTitle>Education</SectionTitle>
        <p>BFA, Placeholder School of Design</p>

        <p className="mt-6 text-white/45">
          This is dummy content — the downloadable résumé will live here.
        </p>
        <a
          href="/resume.pdf"
          className="mt-1 inline-flex items-center rounded-full bg-white px-5 py-2 text-sm font-medium text-black transition-opacity hover:opacity-80 md:text-base"
        >
          Download PDF
        </a>
      </>
    ),
  },
  contact: {
    title: "Contact",
    body: (
      <>
        <p>Let’s talk — projects, collaborations, or just to say hello.</p>
        <p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="font-medium text-white underline underline-offset-2"
          >
            {CONTACT_EMAIL}
          </a>
        </p>
        <p className="text-white/50">
          Based in Anywhere, USA. Dummy contact details for now.
        </p>
      </>
    ),
  },
};

/**
 * Floating DOM popup over everything — black frosted glass, white text. No
 * tinted backdrop; the page shows through. The résumé is an enlarged,
 * scrollable panel. A transparent full-screen catcher closes it on outside
 * click; Escape too.
 */
export default function InfoModal({
  kind,
  onClose,
}: {
  kind: InfoKind;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { title, body } = CONTENT[kind];
  const isResume = kind === "resume";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
      {/* Transparent click-catcher (no tint) — closes on outside click. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden rounded-2xl bg-black/70 text-white shadow-2xl ring-1 ring-white/15 backdrop-blur-xl ${
          isResume ? "max-w-2xl" : "max-w-md"
        }`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          >
            <line x1="5" y1="5" x2="19" y2="19" />
            <line x1="19" y1="5" x2="5" y2="19" />
          </svg>
        </button>
        <div className={`min-h-0 overflow-y-auto ${isResume ? "p-8 sm:p-10" : "p-7"}`}>
          <h2 className="pr-8 text-3xl font-medium md:text-4xl">{title}</h2>
          <div className="mt-5 space-y-4 text-base leading-relaxed text-white/70 md:text-lg">
            {body}
          </div>
        </div>
      </div>
    </div>
  );
}
