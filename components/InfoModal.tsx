"use client";

import { useEffect, useState } from "react";

export type InfoKind = "resume" | "contact";

const RESUME_FILE = "/Andrew-Weitzel-Resume.pdf";

// Contact email kept out of the source/markup as base64, decoded at runtime —
// a light deterrent against scraping bots. (App is client-only, so the plain
// address only ever exists in the live DOM once Contact is opened.)
const CONTACT_EMAIL_B64 = "YW5kcmV3LmpvaG4ud2VpdHplbEBnbWFpbC5jb20=";
function decode(b64: string) {
  return typeof window === "undefined" ? "" : window.atob(b64);
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

// Type system mirrors the résumé PDF: serif (New Spirit) for name/section/item
// headings, sans (Arial) for body copy and uppercase labels.
const NAME = "text-3xl font-medium md:text-4xl";
const SECTION = "text-2xl font-medium md:text-3xl";
const ITEM = "text-xl font-medium md:text-2xl";
const LABEL = "font-label text-xs uppercase tracking-wide text-white";
const BODY = "font-sans-copy text-base leading-relaxed text-white";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12 border-t border-white/15 pt-8">
      <h3 className={SECTION}>{title}</h3>
      <div className="mt-6 space-y-8">{children}</div>
    </section>
  );
}

function Job({
  title,
  org,
  meta,
  children,
}: {
  title: string;
  org: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className={ITEM}>{title}</h4>
      <p className="mt-1.5">
        <span className={LABEL}>{org}</span>
        {meta && <span className="ml-2 font-sans-copy text-sm text-white">{meta}</span>}
      </p>
      <div className={`mt-3 space-y-3 ${BODY}`}>{children}</div>
    </div>
  );
}

function Skill({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className={ITEM}>{title}</h4>
      <div className={`mt-1.5 ${BODY}`}>{children}</div>
    </div>
  );
}

function Award({
  title,
  tag,
  children,
}: {
  title: string;
  tag: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className={ITEM}>{title}</h4>
      <p className={`mt-1 ${LABEL}`}>{tag}</p>
      <div className={`mt-2 space-y-0.5 ${BODY}`}>{children}</div>
    </div>
  );
}

const CLIENTS = [
  "Adidas", "AdventHealth", "Afterpay", "Amazon", "BBC", "BMW", "Burger King",
  "Cadillac", "Corona", "Crocs", "Crowne Plaza", "Downtown Newark", "Dyson",
  "Kroger", "E.L.F. Cosmetics", "Foot Locker", "GM", "JP Morgan", "Invesco QQQ",
  "Lionsgate Films", "LG", "L’Oréal", "Microsoft", "McKesson", "Modelo", "MoMA",
  "MTV", "Nature Valley", "Nickelodeon", "NY Islanders", "NY Life", "NY Yankees",
  "Oppenheimer", "Oxygen", "Paramount", "Pepsi", "Redken", "Showtime",
  "Stick With Me", "Synchrony", "TED Talks", "Timberland", "Westfield",
  "Urban Decay", "Visit New Jersey", "Visit Philly", "Winston-Salem Open",
];

function ResumeBody() {
  return (
    <>
      <p className="mt-8 text-lg leading-relaxed text-white md:text-xl">
        Creative leader and full-stack technologist with over two decades of
        experience at the intersection of design, brand strategy, and emerging
        technology. As co-founder of Box Creative and its Creative Director —
        currently serving as CCO — has directed award-winning campaigns and
        digital experiences for Fortune 50 brands and high-growth startups alike
        — spanning identity systems, integrated marketing, AR/AI/3D experiences,
        and custom application development. Defined by a rare fluency across the
        full creative-to-technical pipeline: equally comfortable directing a
        national campaign, crafting the strategy behind it, and engineering the
        application that delivers it.
      </p>

      <Section title="Experience">
        <Job
          title="Chief Creative Officer, Creative Director & Co-founder"
          org="Box Creative"
          meta="2007 — Present · www.box.biz"
        >
          <p>
            Co-founded and built Box Creative, an award-winning design firm and
            digital studio, alongside his twin brother. Within the first year,
            landed immersive 3D projects for Pepsi and MoMA/PS1 — setting the
            trajectory for nearly two decades of work for Fortune 50 brands and
            startups including Adidas, Amazon, GM, LG, JP Morgan, MTV, Pepsi, and
            Urban Decay. Operates across the full scope of agency leadership:
            creative direction, UX/UI, project management, copywriting,
            illustration, photography, print production, and social/campaign
            management.
          </p>
          <ul className="list-disc space-y-2 pl-5 marker:text-white/50">
            <li>
              Direct creative vision and brand strategy across integrated
              campaigns spanning print, digital, motion, AR/AI/3D, and IRL
              activations
            </li>
            <li>
              Lead client relationships, new business development, agency
              operations, and team direction
            </li>
            <li>
              Architect applications and experiences that bridge creative
              concept and technical execution
            </li>
          </ul>
        </Job>

        <Job
          title="Senior Designer, Associate Art Director"
          org="Asphalt Jungle"
          meta="2005 — 2007"
        >
          <p>
            Provided design, web development, production, illustration, and
            animation for a national client roster including Hanes, working
            across both digital and traditional media.
          </p>
        </Job>

        <Job
          title="Senior Designer"
          org="Flight Design Communications"
          meta="2004 — 2005"
        >
          <p>
            Designed and produced print, packaging, and point-of-sale work for
            major brands including Reebok, with additional contributions in web
            design and development.
          </p>
        </Job>
      </Section>

      <Section title="Skills & Expertise">
        <Skill title="Creative & Strategic Leadership">
          Visionary Strategist, Campaign & Marketing Strategy, Team Mentorship,
          Brand Identity Guardian, Project Management, Application Development
          Direction, Video & Social Marketing Direction, Print/Packaging QC,
          Media & Ad Ops, Budget Steward, Copywriting
        </Skill>
        <Skill title="Design Tools">
          Adobe Creative Cloud (Illustrator, Photoshop, InDesign, Premiere Pro,
          After Effects, Dreamweaver, Express), Figma, ChatGPT, Claude Design,
          Google Gemini, Blender (3D/CGI)
        </Skill>
        <Skill title="Coding Tools">
          Agentic Full-Stack Development (Claude Code, Codex), VS Code, Xcode,
          Google Web Designer (Rich Media), Nova / Coda
        </Skill>
        <Skill title="Coding Languages">
          <p>
            <span className={LABEL}>Core</span> — JavaScript, HTML, CSS
          </p>
          <p className="mt-1.5">
            <span className={LABEL}>Libraries & Frameworks</span> — React,
            Tailwind, Bootstrap, Node.js, Three.js / React Three Fiber, jQuery,
            Google MediaPipe, 8th Wall, Google Analytics, Google Studio (Fmly
            Doubleclick, QA-certified)
          </p>
        </Skill>
        <Skill title="CMS Platforms">
          Sanity (Headless CMS), Drupal, WordPress, Shopify
        </Skill>
        <Skill title="Project Management Tools">Slack, Linear, Asana</Skill>
        <Skill title="Strategic">
          Brand Audits, Analytics & Media Analysis, New Business Development
        </Skill>
      </Section>

      <Section title="Awards">
        <Award
          title="Webby Awards, 2026"
          tag="Webby Winner / People’s Voice Winner / Nominee (AR)"
        >
          <p>Agency: Movement Strategy</p>
          <p>
            E.L.F. Cosmetics —{" "}
            <a
              href="https://www.elfnalysis.com"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              elfnalysis.com
            </a>{" "}
            · AI-driven beauty season identifier
          </p>
        </Award>
        <Award title="Webby Awards, 2021" tag="Honoree">
          <p>Agencies: Coffee Labs, Paramount</p>
          <p>MTV VMAs AR — Burger King x Lil Yachty</p>
        </Award>
        <Award title="Society of Illustrators" tag="Award of Merit">
          <p>Painting / illustration of William S. Burroughs</p>
        </Award>
      </Section>

      <Section title="Education">
        <div>
          <h4 className={ITEM}>BFA, Columbus College of Art & Design</h4>
          <p className={`mt-1.5 ${LABEL}`}>1999 — 2003</p>
          <p className={`mt-2 ${BODY}`}>
            Major in Illustration, additional studies in Graphic Design, Fine
            Arts, Industrial Design
          </p>
        </div>
        <div>
          <h4 className={ITEM}>LaSalle High School</h4>
          <p className={`mt-1.5 ${LABEL}`}>Graduated 1999</p>
        </div>
      </Section>

      <Section title="Clients">
        <ul className="columns-2 gap-8 text-base leading-relaxed text-white sm:columns-3">
          {CLIENTS.map((c) => (
            <li key={c} className="break-inside-avoid">
              {c}
            </li>
          ))}
        </ul>
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
    "w-full border-b border-white/30 bg-transparent py-2 font-sans-copy text-sm text-white placeholder-white/40 outline-none transition-colors focus:border-white md:text-base";

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
 * airy, all-white panel (serif headings / sans body, matching the PDF) with a
 * top download link; Contact has a native form that posts straight to the
 * Google Form. Escape / outside-click / X close it.
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
  const email = decode(CONTACT_EMAIL_B64);

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
              <p className="font-label text-xs uppercase tracking-[0.2em] text-white">
                Résumé — 2026
              </p>
              <h2 className={`mt-2 pr-12 ${NAME}`}>Andrew Weitzel</h2>
              <p className="mt-3 text-lg font-medium text-white md:text-xl">
                Creative Director · Chief Creative Officer · Marketing Director
              </p>
              <a
                href={RESUME_FILE}
                download
                className="mt-6 inline-flex items-center rounded-full border border-white/60 px-5 py-2 font-medium text-white transition-colors hover:bg-white/10"
              >
                Download Resumé
              </a>
              <ResumeBody />
            </>
          ) : (
            <>
              <h2 className="pr-12 text-3xl font-medium md:text-4xl">Contact</h2>
              <div className="mt-5 font-sans-copy text-sm leading-relaxed text-white md:text-base">
                <p>
                  Nice to meet ya! Feel free to email me at{" "}
                  <a
                    href={`mailto:${email}`}
                    className="font-medium underline underline-offset-2"
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
