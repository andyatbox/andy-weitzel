# Andy Weitzel — Creative Director Portfolio

Full-screen, WebGL-driven portfolio site. Next.js 15 (App Router) + React 19 +
Tailwind 4 + React Three Fiber 9 / Three.js, content from a public Sanity
dataset. `npm run dev` (defaults to port 3000).

Site is currently **noindex'd** (`app/layout.tsx` + `public/robots.txt`) while
content is being finished — remove both before public launch.

## Architecture

- **`components/PortfolioApp.tsx`** — root orchestrator. Owns portfolio
  switching, the open/close project animation state, the slide-reveal intro,
  window-level scroll/drag input, the hover tooltip, and mounts everything
  else.
- **`components/Gallery.tsx`** — the R3F `<Canvas>` scene: infinite-scrolling
  image/title planes with bend distortion, additive-blended RGB shift, and a
  cursor swirl/chroma effect (desktop only). Titles are WebGL `Text3D`, word
  wrapped to the plane width.
- **`components/Menu.tsx`** — the DOM nav/menu panel (logo, name, role
  ticker, portfolio pills, infinite scrolling item list). Landscape and
  portrait are materially different layouts, not just a CSS breakpoint.
- **`components/PsychedelicFX.tsx`** — a *real* second WebGL context that
  samples the rendered gallery canvas as a texture and distorts it (swirl,
  domain warp, chromatic aberration). Triggered by hovering the logo/pills;
  requires `preserveDrawingBuffer: true` on the Gallery's `<Canvas>`.
- **`components/InfoModal.tsx`** — Resumé / Contact popup. Contact posts
  natively to a Google Form (no iframe, no click-out); résumé is built from
  static JSX content mirroring the source PDF/docx, not fetched from Sanity.
- **`components/project/`** — the full-screen project detail overlay
  (`ProjectModal`), its image/video slider (`ProjectGallery`), portable-text
  rendering, and multi-column layout.
- **`lib/ScrollEngine.ts`** — single source of truth for scroll position
  (`target`/`current`/`velocity`), shared by the WebGL gallery and the DOM
  menu so they stay locked in sync. Snapping blends into the easing itself
  (no separate setTimeout snap).
- **`lib/portfolios.ts`** — Sanity queries + types. Three portfolios
  (`interactive` / `branding` / `richmedia`) map to Sanity category values
  `immersive-ux` / `branding-print` / `advertising-rich-media`.
- **`lib/videoEmbed.ts`** — resolves a pasted Vimeo/Gumlet URL or full embed
  code to a player src, plus postMessage helpers for detecting playback end
  across both providers' cross-origin iframes.
- **`app/api/video-poster/route.ts`** — server-side only: resolves a video
  embed to its poster image (Gumlet's poster needs a collection ID that only
  exists in CORS-blocked embed HTML; Vimeo via public oEmbed).

## Hard rules (violating these has broken things before)

- **Never use `100vh`** for sizing — always `window.innerHeight` via
  `lib/useViewport.ts`. Mobile browser chrome makes `100vh` wrong.
- **Hooks run unconditionally, before any early return.** This component tree
  returns `null` until `viewport`/`portfolios` load. Any effect that reads a
  ref to DOM rendered *after* that guard must include the `ready` boolean in
  its dependency array, or it fires once during the loading render (captures
  a null ref) and never re-runs. This exact bug silently broke the hover
  tooltip for an entire session before being caught.
- **`ring`/`ring-inset` is a `box-shadow` — it paints *underneath* an
  element's children.** A full-bleed child (image/iframe with zero padding)
  completely hides an inset ring visually, even though the computed style is
  "correct." Use a real `border` for strokes around edge-to-edge media.
- **No `ShaderMaterial`** for the gallery's bend/RGB-shift effects — those are
  done via vertex displacement and additively-blended R/G/B channel meshes,
  intentionally, to avoid darkening. `PsychedelicFX` is the one place a real
  fragment shader is used, and it's a separate canvas, not part of the
  Gallery's own material pipeline.
- **Sanity CORS**: the dataset is public/read-only, no token — but the
  *browser origin* still needs to be allow-listed in the Sanity dashboard
  (sanity.io/manage, project `qdpuwnm5`) or fetches fail (blank page). Add any
  new dev port or deploy domain there before testing.

## Known gotchas worth remembering

- **`NewSpirit-Medium.typeface.json`** (used for WebGL `Text3D`) has a winding
  bug from its OTF→JSON conversion — counters in e/d/o render as solid blobs.
  Current file is winding-repaired via `scripts/fix-typeface.cjs`. Fallback
  is `/fonts/helvetiker_regular.typeface.json` if it ever regresses.
- **Gumlet embeds**: `disable_player_controls=true` hides the scrubber/chrome
  but *not* the built-in center play button (which is purple and can't be
  removed via embed params). The only fix is covering the iframe entirely
  with our own opaque poster + play button until playback starts.
- **Next's `fetch` cache** (`next: { revalidate }`) can serve stale upstream
  data for the whole window — bit us on the video-poster route after a
  Gumlet re-upload. Keep revalidate short (minutes, not a day) for anything
  that mirrors externally-editable content.
- **Touch detection**: `navigator.maxTouchPoints > 0` is true on iPads *even
  with a physical mouse/trackpad attached* — don't assume touch-points-only
  means "no hover intent." Effects gated to "non-touch only" use this check
  and deliberately fall back to a modal-open trigger on touch.
- **Next dev HMR can wedge** after a parse error (duplicate declaration,
  etc.) — if things look broken after an edit that should have fixed them,
  `rm -rf .next` + restart the dev server, and hard-refresh the browser tab
  (it can hold a stale client bundle independent of the server).
- **DNS**: `andyweitzel.com` apex redirects to `www.andyweitzel.com` on
  Vercel (their recommended setup) — canonical/OG URLs in `app/layout.tsx`
  point to the `www` host accordingly.

## Working conventions

- Commit only when explicitly asked; push only when explicitly asked.
- Commit messages explain *why*, not *what* — the diff already shows what.
- Verify changes by actually checking (`tsc --noEmit`, hit the dev server,
  and for anything visual/interactive, drive a real headless browser rather
  than trusting a code read) — this codebase has burned that assumption more
  than once (see the hooks-timing and box-shadow-occlusion gotchas above).
