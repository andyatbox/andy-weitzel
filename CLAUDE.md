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
- **`components/AgentIntro.tsx`** — the landing gate: a row of location and
  weather data graphics (`WeatherPanel.tsx`; data from `app/api/greeting`,
  Open-Meteo + Vercel's geo headers) above a typed "Hello." and the portfolio
  question, over **`IntroCube.tsx`** — the sizzle reel (HLS via
  `lib/hlsVideo.ts`) twice: as a shape cycling cube → sphere → gooey blob on
  two shader dials (`u_sphere`, `u_goo`) that follows/swirls under the
  pointer, and as a half-skybox behind it that the pointer turns. The sky is
  a full-screen shader, stereographic both for the wrap and for its lens, so
  at rest it shows the picture flat at a chosen framing (`DOME_FRAME`) and
  turning bends it like a dome; a normal rectilinear camera could only show
  a sliver of a 180° sky. One stream feeds both (`EMBED`; any proportions —
  the shape takes a centred square); the sky's soft focus scales with how far
  the picture is enlarged, so a sharp source stays sharp (the 1080p reel
  shows near 1:1). Replacing a Gumlet asset in place regenerated only its
  DASH output, leaving the HLS ladder on the old video — upload a new asset
  and swap the id instead. `SplashIntro.tsx` is the older static gate, kept
  as a revert path.
- **`components/Cursor.tsx`** — custom cursor for fine pointers (ring + dot,
  `mix-blend-mode: difference`), states via classes: link / drag / teaser
  (`body.cursor-teaser`, set by the gallery tooltip, whose "View … Project"
  pill rides beside the ring). Native cursor hidden except over text fields.
- **`components/LogoMark.tsx`** — the AW monogram: stripes sliding through a
  parallelogram clip (`.logo-slide` in globals.css). The slide is exactly five
  stripes (312.9721 units), so the last frame equals the first and the loop is
  seamless — keep that if the art changes.
- **`components/Gallery.tsx`** — the R3F `<Canvas>` scene: infinite-scrolling
  image planes with bend distortion, additive-blended RGB shift, and a cursor
  swirl/chroma effect (desktop only; its numbers live in `lib/pointerFx.ts`,
  shared with the intro shape). Teasers show the project thumbnail; the
  active one swaps in a looping video (`lib/teaserVideo.ts`) or cycles the
  project's first gallery stills (`lib/teaserSlides.ts`), but only while the
  gallery is fully at rest. There are no titles in the canvas — project names
  live only in the DOM menu.
- **`components/Menu.tsx`** — the DOM nav/menu panel (logo, name, role
  ticker, portfolio pills, infinite scrolling item list). A quick tap/click
  on the logo returns to the landing (`returnToLanding` in PortfolioApp);
  holding it plays the psychedelic effect instead, and a drag does neither. Landscape and
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
  rendering, multi-column layout, and `ProjectStrip` — the looping prev/next
  teaser strip fixed along the bottom (scroll/drag, recentres after 3s idle).
  The sheet scrolls with eased wheel input (`lib/useSmoothScroll.ts`; touch
  and keyboard stay native) and blocks marked `data-reveal` animate in on
  entry (`lib/useReveal.ts`).
- **`lib/ScrollEngine.ts`** — single source of truth for scroll position
  (`target`/`current`/`velocity`), shared by the WebGL gallery and the DOM
  menu so they stay locked in sync. Scrolls land on an item in one motion:
  when input ends it plans a single quintic landing curve from the current
  position *and speed* to the chosen item (zero speed on arrival) — no
  coast-then-snap. Trackpad momentum tails are detected as they start and
  absorbed. Moving on to the next item takes intent — a wheel notch (its
  first event is notch-sized; trackpads ramp up from tiny deltas) or ~20% of
  an item of travel; anything less settles back, and doesn't interrupt a
  landing in flight. Interrupting landings for stray input once ratcheted the
  gallery an item per event. Wheel input goes through `engine.input(delta)`, drag release
  through `engine.release(fling)`. It's plain TS with no DOM, so tune it by
  feeding it input on a fake `performance.now()` and checking the
  frame-by-frame speed (it should only fall after its peak), not by eye.
- **`lib/portfolios.ts`** — Sanity queries + types. Two portfolios
  (`interactive` / `branding`) map to Sanity category values `immersive-ux` /
  `branding-print`; `advertising-rich-media` projects are dropped. Gallery
  `imagesSlide` entries (multi-image uploads) are flattened into single slides
  here, so nothing downstream knows about them.
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

- **Shaders live in JS template literals** — a backtick in a GLSL comment ends
  the string and breaks the build. Write names in comments without them.
- **Don't select SVG attributes by name in CSS** (`[pathLength]`): Chrome
  matched it on first style but missed it when an ancestor class changed
  later, leaving the weather icons undrawn. Select by element or class.
- **R3F may copy a `uniforms` prop onto the material**, so mutating your own
  object later reaches nothing (a silent black mesh). Build the
  `ShaderMaterial` yourself (or drive it through a ref) and write its
  uniforms directly — see `IntroCube`.

- **Teaser video is HLS-only.** Gumlet publishes no usable MP4 (every variant
  401/403s), so playback needs `hls.js` — except on WebKit, which renders an
  MSE blob as a black frame through WebGL and must use native HLS instead.
  Chrome answers `"maybe"` to the HLS mime type despite being unable to play
  it, so `canPlayType` can never be the first branch in that decision.
- **Swapping a map between an image and a `VideoTexture` needs the material
  rebuilt.** three picks the sRGB decode with a shader define
  (`DECODE_VIDEO_TEXTURE`) baked in at program-compile time; changing `map` on
  a live material doesn't recompile it, and video silently renders with lifted
  blacks. `ChannelPlanes` keys its materials on the source kind for this.
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
