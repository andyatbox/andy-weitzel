"use client";

import { useEffect, useState } from "react";

export type InfoKind = "resume" | "contact";

const RESUME_FILE = "/Andrew_Weitzel_Resume_2026.docx";

// Contact email kept out of the source/markup as base64, decoded at runtime —
// a light deterrent against address-scraping bots. (App is client-only, so the
// plain address only ever exists in the live DOM after Contact is opened.)
const CONTACT_EMAIL_B64 = "YW5kcmV3LmpvaG4ud2VpdHplbEBnbWFpbC5jb20=";
function contactEmail() {
  return typeof window === "undefined" ? "" : window.atob(CONTACT_EMAIL_B64);
}

// Native submission to the Google Form (no embed, no click-out). Field ids
// were read from the form's FB_PUBLIC_LOAD_DATA_.
const FORM_ACTION =
  "https://docs.google.com/forms/d/e/1FAIpQLSep8EqJOnZfN7qU70TRF2F2oQWZBp8h18WuWX7Ly8GYpy9EOg/formResponse";
const FIELD = {
  name: "entry.608113601",
  email: "entry.1497395854",
  message: "entry.1322325202",
};

// Larger serif heading shared by role titles and skill-group labels.
const HEADING = "text-xl font-medium text-white md:text-2xl";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-12 border-t border-white/15 pt-8">
      <h3 className="font-label text-sm uppercase tracking-[0.18em] text-white">
        {title}
      </h3>
      <div className="mt-6 space-y-5">{children}</div>
    </section>
  );
}

function Role({
  title,
  meta,
  children,
}: {
  title: string;
  meta: string;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <div className={HEADING}>{title}</div>
      <div className="mt-1 tracking-wide text-white">{meta}</div>
      {children}
    </div>
  );
}

function Skill({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className={HEADING}>{label}</h4>
      <p className="mt-1">{children}</p>
    </div>
  );
}

function ResumeBody() {
  return (
    <>
      <Section title="Profile">
        <p>
          Creative leader and full-stack technologist with over two decades of
          experience at the intersection of design, brand strategy, and emerging
          technology. As co-founder and Creative Director / CCO of Box Creative,
          has directed campaigns and digital experiences for Fortune 50 brands
          and high-growth startups alike — spanning identity systems, integrated
          marketing campaigns, AR/3D experiences, and custom application
          development. Distinguished by a rare fluency across the full
          creative-to-technical pipeline: equally comfortable art directing a
          national campaign, writing the strategy behind it, and building the
          application that delivers it. A recipient of the Society of
          Illustrators Award of Merit, and a two-time Webby Award winner.
        </p>
      </Section>

      <Section title="Experience">
        <Role
          title="Chief Creative Officer & Co-Founder — Box Creative"
          meta="2007 — Present  ·  Midtown, SoHo & Queens, NY  ·  www.box.biz"
        >
          <p className="mt-4">
            Co-founded and built Box, an award-winning design firm and digital
            studio, alongside his twin brother. Within the first year, landed
            immersive 3D projects for Pepsi and MoMA/PS1, setting the trajectory
            for nearly two decades of work for Fortune 50 brands and startups
            including Adidas, Amazon, GM, LG, JP Morgan, MTV, Pepsi, and Urban
            Decay. Operates across the full scope of agency leadership and
            hands-on production — creative direction, UX/UI design, project
            management, copywriting, illustration, photography, print production,
            and social/campaign management.
          </p>
          <ul className="mt-4 list-disc space-y-2 pl-5 marker:text-white/50">
            <li>
              Direct creative vision and brand strategy across integrated
              campaigns spanning print, digital, motion, and emerging AR/AI/3D
              platforms
            </li>
            <li>
              Lead client relationships and new business development alongside
              agency operations and team direction
            </li>
            <li>
              Architect applications and experiences, bridging the gap between
              creative and technical execution
            </li>
            <li>
              Delivered award-winning work recognized by the Society of
              Illustrators and the Webby Awards
            </li>
          </ul>
        </Role>

        <Role
          title="Senior Designer, Associate Art Director — Asphalt Jungle"
          meta="2005 — 2007  ·  Manhattan, NY"
        >
          <p className="mt-4">
            Provided design, web development, production, illustration, and
            animation for a national client roster including Hanes, working
            across both digital and traditional media.
          </p>
        </Role>

        <Role
          title="Senior Designer — Flight Design Communications"
          meta="2004 — 2005  ·  Queens, NY"
        >
          <p className="mt-4">
            Designed and produced print, packaging, and point-of-sale work for
            major brands including Reebok, with additional contributions in web
            design and development.
          </p>
        </Role>
      </Section>

      <Section title="Skills & Expertise">
        <Skill label="Creative & Strategic Leadership">
          Campaign & Marketing Strategy, Brand Identity & Evolution, Application
          Development, Video & Motion Graphics, Print/Packaging Production, Media
          & Ad Ops, Copywriting
        </Skill>
        <Skill label="Design Tools">
          Adobe Creative Cloud (Illustrator, Photoshop, InDesign, Premiere Pro,
          After Effects, Dreamweaver, Express), Figma, Blender (3D/CGI)
        </Skill>
        <Skill label="Development Tools">
          Agentic Full-Stack Development (Claude Code, Codex), VS Code, Xcode,
          Google Web Designer (Rich Media), Nova, Google Studio (Formerly
          Doubleclick, QA certified)
        </Skill>
        <Skill label="Development Languages">JavaScript, HTML, CSS</Skill>
        <Skill label="Libraries & Frameworks">
          React, Tailwind, Bootstrap, Node.js, Three.js / React Three Fiber,
          jQuery, Google MediaPipe, 8th Wall
        </Skill>
        <Skill label="CMS Platforms">Sanity, Drupal, WordPress, Shopify</Skill>
        <Skill label="Project Management">
          Slack, Linear, Asana, Google Analytics
        </Skill>
        <Skill label="Strategy">
          Brand Audits, Analytics & Analysis, New Business Development, Marketing
          Strategy
        </Skill>
      </Section>

      <Section title="Awards">
        <ul className="list-disc space-y-3 pl-5 marker:text-white/50">
          <li>
            Society of Illustrators, Award of Merit — mixed-media illustration of
            William S. Burroughs
          </li>
          <li>
            Webby Award — E.L.F. Cosmetics “Elfnalysis,” an AI-driven skincare
            season identifier
          </li>
          <li>
            Webby Award — Burger King x MTV VMAs, an AR experience featuring the
            King and Lil Yachty
          </li>
        </ul>
      </Section>

      <Section title="Education">
        <Role
          title="BFA — Columbus College of Art & Design"
          meta="1999 — 2003"
        >
          <p className="mt-1">
            Illustration major, Graphic Design minor, with additional studies in
            fine art, web development, and industrial design.
          </p>
        </Role>
        <Role title="LaSalle High School" meta="Graduated 1999" />
      </Section>

      <Section title="Clients of Note">
        <p className="leading-loose">
          Adidas, AdventHealth, Afterpay, Amazon, BBC, BMW, Burger King,
          Cadillac, Corona, Crocs, Crowne Plaza, Downtown Newark, Dyson, Kroger,
          E.L.F. Cosmetics, Foot Locker, GM, JP Morgan, Invesco QQQ, Lionsgate
          Films, LG, L’Oréal, Microsoft, McKesson, Modelo, MoMA, MTV, Nature
          Valley, Nickelodeon, NY Islanders, NY Life, NY Yankees, Oppenheimer,
          Oxygen, Paramount, Pepsi, Redken, Showtime, Stick With Me, Synchrony,
          TED Talks, Timberland, Westfield, Urban Decay, Visit Philly,
          Winston-Salem Open.
        </p>
      </Section>
    </>
  );
}

function ContactForm() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const body = new URLSearchParams();
    body.append(FIELD.name, String(data.get("name") ?? ""));
    body.append(FIELD.email, String(data.get("email") ?? ""));
    body.append(FIELD.message, String(data.get("message") ?? ""));
    body.append("fvv", "1");
    body.append("pageHistory", "0");
    setStatus("sending");
    // no-cors: Google records the response; the opaque reply can't be read, so
    // we treat completion as success and keep the user on-site.
    await fetch(FORM_ACTION, { method: "POST", mode: "no-cors", body }).catch(
      () => {}
    );
    form.reset();
    setStatus("sent");
  };

  if (status === "sent") {
    return (
      <div className="mt-8 border-t border-white/15 pt-8">
        <p className="text-base font-medium text-white">
          Thanks — your message has been sent.
        </p>
        <button
          type="button"
          onClick={() => setStatus("idle")}
          className="mt-4 inline-flex items-center rounded-full border border-white/60 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10"
        >
          Send another
        </button>
      </div>
    );
  }

  const fieldCls =
    "w-full border-b border-white/30 bg-transparent py-2 text-sm text-white placeholder-white/40 outline-none transition-colors focus:border-white md:text-base";

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-6 border-t border-white/15 pt-8">
      <input name="name" required placeholder="Full name" className={fieldCls} />
      <input
        name="email"
        type="email"
        required
        placeholder="Email"
        className={fieldCls}
      />
      <textarea
        name="message"
        required
        placeholder="Message"
        rows={4}
        className={`${fieldCls} resize-none`}
      />
      <button
        type="submit"
        disabled={status === "sending"}
        className="inline-flex items-center rounded-full border border-white/60 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-white/10 disabled:opacity-50"
      >
        {status === "sending" ? "Sending…" : "Send message"}
      </button>
    </form>
  );
}

/**
 * Floating popup over the full-screen dark backdrop. The résumé is a wide,
 * airy, all-white panel with a top download link; Contact has a native form
 * that posts straight to the Google Form. Escape / outside-click / X close it.
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

  const isResume = kind === "resume";
  const email = contactEmail();

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-6">
      {/* Full-screen dark tint + blur backdrop; closes on outside click. */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/65 backdrop-blur-md"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isResume ? "Resumé" : "Contact"}
        className={`relative z-10 flex max-h-[88vh] w-full flex-col overflow-hidden text-white ring-1 ring-white/80 ${
          isResume ? "max-w-4xl" : "max-w-lg"
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
        <div className={`min-h-0 overflow-y-auto ${isResume ? "p-8 sm:p-12" : "p-8"}`}>
          {isResume ? (
            <>
              <h2 className="pr-12 text-3xl font-medium md:text-4xl">
                Andrew Weitzel
              </h2>
              <p className="mt-1 text-base font-normal text-white md:text-lg">
                Resumé
              </p>
              <a
                href={RESUME_FILE}
                download
                className="mt-5 inline-flex items-center rounded-full border border-white/60 px-5 py-2 font-medium text-white transition-colors hover:bg-white/10"
              >
                Download Resumé
              </a>
              <div className="mt-2 text-base leading-relaxed text-white md:text-lg">
                <ResumeBody />
              </div>
            </>
          ) : (
            <>
              <h2 className="pr-12 text-3xl font-medium md:text-4xl">Contact</h2>
              <div className="mt-5 text-sm leading-relaxed text-white md:text-base">
                <p>
                  Nice to meet ya! Feel free to email me at{" "}
                  <a
                    href={`mailto:${email}`}
                    className="font-medium text-white underline underline-offset-2"
                  >
                    {email}
                  </a>{" "}
                  or rock the fields below. Thanks!
                </p>
              </div>
              <ContactForm />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
