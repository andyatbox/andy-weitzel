# Andy Weitzel — Creative Director Portfolio

Full-screen, WebGL-driven portfolio site. Next.js 15 (App Router) + React 19 +
Tailwind 4 + React Three Fiber 9 / Three.js, content from a public Sanity
dataset. `npm run dev` (defaults to port 3000).

Site is currently **noindex'd** (`app/layout.tsx` + `public/robots.txt`) while
content is being finished — remove both before public launch.

## Architecture

- **`components/PortfolioApp.tsx`** — root orchestrator. Owns portfolio
  switching, the open/close project animation state, the slide-reveal intro,
  window-level scroll/drag input, the hover tooltip, the tag filter, and
  mounts everything else. Two lists live here: `allItems`, the whole
  portfolio, and `items`, the part of it the tags let through. The filtered
  one is what everything counts in — the engine's slots, the menu's rows,
  prev/next, the bottom strip — while the gallery gets both, because a
  teaser that has just been filtered out still has to be on screen long
  enough to fade. The filter is deliberately not in the address: it is a way
  of looking at a portfolio, not a place. Tags clear on a portfolio switch,
  since they are scoped to what the portfolio in front of you carries and
  keeping them could land on one where nothing matches.
- **`components/AgentIntro.tsx`** — the landing gate: one centred block,
  left-aligned down a single edge — the AW monogram, the wordmark under it,
  a row of location and weather data graphics (`WeatherPanel.tsx`; data from
  `app/api/greeting`, Open-Meteo + Vercel's geo headers), and the typed
  portfolio question. The wordmark (`NameWheel`, rolling between the name and
  the role) carries the *copy's* size, not one of its own: it replaced the
  typed "Hello." the script used to open with, which is why no beat sets
  `pause` any more. The monogram and the wordmark used to sit in
  the window's top corners in a header of their own; there is no header now,
  and the monogram is sized against the copy (`LOGO_RATIO`) rather than
  against a line of its own. One left edge for everything also retired the
  centre-until-it-wraps measurement the copy used to do against a zero-width
  caret marker. The "Portfolios:" label before the two pills is measured the
  same way the gate is: it shows only while the whole row fits on one line,
  and keeps its box out of flow while hidden so the sum it is judged by does
  not change with the answer. Under it, Reel, Resumé and Contact — the same
  row, in the same order, as the menu's on a portfolio page. All of it rides
  one shrink-to-fit (`capFit`) measured against the room the gate has, so
  nothing ever scrolls — measured in a layout effect, so the climb finishes
  inside the frame instead of being painted step by step. Nothing shows until
  the block is whole: the fade waits on the weather lookup as well as the
  fonts, because the column is centred and a row arriving under the lockup
  pushes the monogram up the screen. It sits over
  **`IntroCube.tsx`** — the sizzle reel (HLS via
  `lib/hlsVideo.ts`) as a half-skybox the pointer turns. The sky is a
  full-screen shader: the picture is wrapped stereographically, and the lens
  is mixed between that same projection and an ordinary rectilinear one
  (`DOME_BEND`). The mix is the only thing that curves it — wrap and lens
  being identical compose to an identity, which is why the sky used to show
  dead flat at rest however it was framed (`DOME_FRAME`) — and the two agree
  at the centre of the screen, so the bend costs nothing there and grows
  outward. How much of the picture the screen covers (`DOME_FRAME`) is a
  share of the largest frame the *lens* allows, solved afresh whenever the
  window or the source changes — not a fit to the picture's bounding box.
  The bend pulls the corners in, so a box fit was far more conservative than
  it had to be and left a 16:9 reel cropped to a fifth of its width on a
  phone. The two knobs pull against each other: the harder the bend, the
  further it drags the frame's own edges inward, so a stronger curve is paid
  for in picture. 0.8 was tried and read as distortion rather than curve —
  straight edges in the footage bow enough to look like a fault — and
  backing it off is what let the framing open up as far as it has. The sky's soft focus scales with how far the picture
  is enlarged, so a sharp source stays sharp (the 1080p reel shows near
  1:1). A morphing
  cube → sphere → blob of the same footage used to hang in front of it,
  riding the cursor; it was taken out in full (Nov 2026), which is why the
  sky now carries a faint sway of its own while the agent types (`DOME_STIR`).
  Touch steers nothing and rests dead centre. A slow drift used to stand in
  for the pointer there, but a wander is not a return — it starts off-centre
  and takes two minutes to come back, so a phone showed the reel parked to
  one side with no way to straighten it.
  Replacing a Gumlet asset in place regenerated only its
  DASH output, leaving the HLS ladder on the old video — upload a new asset
  and swap the id instead. The two portfolio buttons are `MagneticPill.tsx`,
  which leans them toward the cursor on a rAF lerp — gated on `(pointer: fine)
  and (hover: hover)`, not on touch points, so an iPad with a trackpad keeps
  it.
- **`components/Cursor.tsx`** — custom cursor for fine pointers (ring + dot,
  `mix-blend-mode: difference`), states via classes: link / drag / teaser
  (`body.cursor-teaser`, set by the gallery tooltip, whose "View … Project"
  pill rides beside the ring). Native cursor hidden except over text fields.
- **`components/LogoMark.tsx`** — the AW monogram: stripes sliding through a
  parallelogram clip (`.logo-slide` in globals.css). The slide is exactly five
  stripes (312.9721 units), so the last frame equals the first and the loop is
  seamless — keep that if the art changes.
- **`components/FilterPanel.tsx`** — what takes the rail's place while the
  filters are up: the tags as pills, with Reset and a close X under them.
  The menu lays it out (pill sizes and left padding are passed in) because
  the two panels occupy the same rectangle half a second apart and anything
  measured twice drifts. The tag area shrinks and scrolls (`min-h-0`) rather
  than growing, so the two buttons sit under the last pill on a rail with
  room and stay on screen on a phone, where a dozen-odd tags do not fit;
  pushed off the bottom is where they were when the row simply wrapped.
  `data-filter-scroll` marks that scroller — the window swallows wheels *and*
  pointer-downs to drive the gallery, so both handlers have to be told where
  one belongs to the page. Escape closes the panel too.
- **`components/Pill.tsx`** — the rail's pill button, shared by the menu and
  the filter panel for the same reason.
- **`components/Gallery.tsx`** — the R3F `<Canvas>` scene: infinite-scrolling
  image planes with bend distortion, additive-blended RGB shift, and a cursor
  swirl/chroma effect (desktop only; its numbers live in `lib/pointerFx.ts`,
  shared with the intro shape). Teasers show the project thumbnail; the
  active one swaps in a looping video (`lib/teaserVideo.ts`) or cycles the
  project's first gallery stills (`lib/teaserSlides.ts`), but only while the
  gallery is fully at rest. It takes every item in the portfolio plus
  `order`, the indices it should show, in sequence — the strip's order and
  the grid's reading order alike — so the engine counts *slots* in `order`
  rather than items, and anything the filter has dropped keeps its mesh and
  its texture and simply fades. That is what lets a tag click reflow the grid
  in place instead of rebuilding it. There are no titles in the canvas — project names
  live only in the DOM menu. A teaser's resting size comes from `restSize`:
  in landscape it fills the width the camera actually shows (a canvas-sized
  plane is drawn at `CAMERA_ZOOM`, leaving a tenth of the canvas blank each
  side) less one `ITEM_GAP_LANDSCAPE`, then takes the height that width wants
  at `MIN_ASPECT` — the canvas is three quarters of the window, so without
  that cap a full-height teaser came out nearly square from 16:9 source.
  Height given up that way returns as more of the prev/next item showing,
  half above and half below, which is what `MIN_HEIGHT_FILL` bounds; on a
  canvas near square it, not the aspect, is what binds. The gap doubles as
  the side margin so the gutter reads the same both ways. Portrait is the
  canvas itself — its cross axis is the short one, and filling it would make
  a teaser more upright rather than less. The open/close animation lerps
  `restSize` to the full canvas on both axes, and the resting value React
  writes drops to the canvas as soon as `opened` flips — an open project
  fills the window exactly.
  The **grid** the filters put it in is the same planes on a second blend:
  every position, size and texture crop lerps between the strip's and the
  cell's. What drives it is a **clock in milliseconds**, not an eased
  number, because the teasers leave one after another — each takes
  `GRID_MOVE_MS` from its own start and starts `GRID_STEP_MS` behind the one
  before it, so item 1 lands first. An exponential ease has no timeline to
  offset along: its tail asymptotes, so the last item in the queue would
  crawl. The step tightens on a long portfolio to hold the whole move under
  `GRID_TOTAL_CAP`. Because of that queue two teasers are rarely the same
  size on the same frame, so plane scale and texture crop are written per
  item inside the placement loop rather than once above it.
  Cells are laid out in what the lens covers (`W / CAMERA_ZOOM`), not in
  canvas px, or the grid would leave the strip's side margins empty; they
  keep the teasers' own 16:9 rather than the strip's squarer `MIN_ASPECT`,
  since a row of near-squares reads as a contact sheet. `gridColumns` judges
  2 or 3 by the *canvas's* width, not the window's — in landscape the rail
  has already taken a quarter. Every row reserves a band under it for its
  title, derived from the label's own type size rather than fixed, so
  resizing the labels cannot quietly leave them overlapping the row
  beneath — the band's room comes out of the pictures instead. The titles
  carry the rail list's own weight rather than a caption's, because while
  the grid is up the list has slid away and these are the only names on
  screen. Cells ease
  to their places separately from the scroll, so a tag click slides the
  survivors into their new cells while a drag stays 1:1. A tap goes through
  `hitRef`, a cell hit test published from the frame loop: the planes are
  bent and swirled and the question is which cell, not which triangle. The
  pointer swirl is off in the grid — it is sized against one teaser filling
  the view and over a page of cells it smears.
- **`components/Menu.tsx`** — the DOM nav/menu panel (logo, name, role
  ticker, portfolio pills, then Reel, Resumé and Contact, then the infinite
  scrolling item list), with **Project Filter** — the small grid-icon button
  that turns the strip into the grid — set apart from all of them. In
  landscape it rides the logo's own line, centred on the mark and pulled out
  to the chevrons' inset so the rail reads with one right edge from top to
  bottom; that pull is computed (`chevInset` minus the brand box's right
  padding) because the inset ramps on wide displays while the padding steps
  at 992px. The logo button is `block` rather than `inline-block` for the
  same reason: an inline box's baseline gap sat the button three px low.
  Portrait keeps it below the portfolio pills — the brand column is half a
  phone, and a logo plus a worded button do not fit on one line there at any
  size worth reading. It is deliberately not a fifth pill: the others choose
  *what* you are looking at and this one changes how it is laid out, and in
  the row it kept reading as a third portfolio. It lights up on what is
  *applied*, not on whether the panel is open — once the panel is open this
  whole block has slid away, and the count is the only thing that still has
  to be readable. It is the one control in the rail with no hover effect:
  the psychedelic warp and the morph into the grid are started by the same
  gesture, and the warp paints over the animation it triggered. Opening the filters slides this block out (left in
  landscape, down in portrait) and `FilterPanel` in from the opposite edge,
  inside one clipped box; both stay mounted, since the rail's own metrics
  are measured off the brand box. A quick tap/click
  on the logo returns to the landing (`returnToLanding` in PortfolioApp);
  holding it plays the psychedelic effect instead, and a drag does neither. Landscape and
  portrait are materially different layouts, not just a CSS breakpoint.
  A phone held upright gives the brand block half a narrow window, which is
  why its pills were pinned to the list's own type size; the longest label
  needs less of that half than it was given, so `phoneRoom` spends what a
  bigger phone has (nothing at 340px, pills half again as large at 430px).
  Measure against "Experiential" before raising it.
- **`components/PsychedelicFX.tsx`** — a *real* second WebGL context that
  samples the rendered gallery canvas as a texture and distorts it (swirl,
  domain warp, chromatic aberration). Triggered by hovering the logo/pills;
  requires `preserveDrawingBuffer: true` on the Gallery's `<Canvas>`.
- **`components/InfoModal.tsx`** — Resumé / Contact popup. Contact posts
  natively to a Google Form (no iframe, no click-out); résumé is built from
  static JSX content mirroring the source PDF/docx, not fetched from Sanity.
  The PDF itself is `public/Andrew-Weitzel-Resume.pdf`, which the panel links
  to — so a new résumé is two changes, the file and the copy, and they are
  meant to say the same thing.
- **`components/ReelOverlay.tsx`** — "Reel", the pill that leads the row
  with Resumé and Contact in both the landing gate and the menu: the sizzle
  reel full-screen and flat, the one place on the
  site it is shown with no shader between it and the viewer. A plain
  `<video>`, so none of the WebGL texture plumbing applies — only `attachHls`
  is shared, since how to play a Gumlet stream at all is the same question
  everywhere. The id lives in `lib/reel.ts` so this and `IntroCube` can't
  drift apart; a constant exported from `IntroCube` would drag R3F in behind
  it. The current asset has no audio track (every rendition in the manifest
  is video-only), which is why there is no sound control. It rides
  `infoOpenRef` in `PortfolioApp` like the info panels, which is what tells
  the window-level scroll/drag and the hover tooltip to stand down.
- **`components/project/`** — the full-screen project detail overlay
  (`ProjectModal`), its image/video slider (`ProjectGallery`), portable-text
  rendering, multi-column layout, and `ProjectStrip` — the looping prev/next
  teaser strip fixed along the bottom (scroll/drag, recentres after 3s idle).
  Its thumbs grow on hover, and always where there is no hover to ask with:
  portrait, or a landscape screen 1200px or taller. A phone held upright gets
  a taller thumb again (`MAX_H_PHONE`) — the strip is the only picture on
  screen beside a column of type, and the portrait height read as a row of
  stamps there. Touch only, so a narrow desktop window still grows on hover.
  The sheet scrolls with eased wheel input (`lib/useSmoothScroll.ts`; touch
  and keyboard stay native) and blocks marked `data-reveal` animate in on
  entry (`lib/useReveal.ts`). Closing a project only fades the sheet —
  nothing unmounts, deliberately, so the players survive the gallery's
  expand — which means a video left running goes on being *heard* over the
  portfolio behind it. `ProjectGallery` takes `active` and pauses on the way
  out for that.
- **`lib/ScrollEngine.ts`** — single source of truth for scroll position
  (`target`/`current`/`velocity`), shared by the WebGL gallery and the DOM
  menu so they stay locked in sync. Scrolls land on an item in one motion:
  when input ends it plans a single quintic landing curve from the current
  position *and speed* to the chosen item (zero speed on arrival) — no
  coast-then-snap. Trackpad momentum tails are detected as they start and
  absorbed. Moving on to the next item takes intent — a wheel notch (its
  first event is notch-sized; trackpads ramp up from tiny deltas) or ~20% of
  an item of travel; anything less settles back. Equally, momentum rounds but
  never invents travel: the "too fast to stop here, carry on" rule may only
  reach an item the input was actually pointed at, and the chase is held to
  the speed a landing had when it handed back — without either guard the
  engine read its own lurch as speed and sent most one-item scrolls two on.
  It rests on the item *nearest* where the input pointed — no forward lean —
  and will settle back on to one the chase has already slipped past, but only
  while the settle curve's own overshoot keeps that pull inside a quarter of
  an item (`SETTLE_BACK`). Refusing to land behind at all, which is what it
  used to do, pushed every scroll whose chase had crept past its item a whole
  item further.
  A fresh nudge doesn't interrupt a landing in flight; a gesture still
  going after a hesitation resumes 1:1 from where the motion is.
  Interrupting landings by jumping the target to the landing's item once
  ratcheted the gallery an item per event.
  Check changes against the old engine on the full gesture set (taps, notch
  spins at several rates, swipes, a pause mid-scroll, a push over momentum,
  reversals) — each fix here has broken a different one of those. Wheel input goes through `engine.input(delta)`, drag release
  through `engine.release(fling)`. It's plain TS with no DOM, so tune it by
  feeding it input on a fake `performance.now()` and checking the
  frame-by-frame speed (it should only fall after its peak), not by eye.
- **`lib/GridScroll.ts`** — the grid's scroll position. Deliberately not the
  ScrollEngine: that engine's whole job is to land on an item — it plans a
  curve to the nearest one and treats the list as endless — and a grid has a
  first row, a last row and nothing to snap to. Teaching the engine about
  bounds would mean touching the one file here where every past fix broke a
  different gesture, so this is the small version: a target the input moves,
  a current that chases it, hard ends. It takes the same wheel and drag
  deltas in the same units, so the two feel like one scroll, and the strip's
  engine is left exactly where it was for when the filters close.
- **`lib/tags.ts`** — the tag slugs the CMS stores and the words a visitor
  reads for them, since the dataset holds only the slugs. Keep it in step
  with `tags` in the studio's `project` schema (the box-creative repo); an
  unknown slug title-cases rather than disappearing. `tagsPresent` scopes the
  filter row to the tags the portfolio in front of you actually carries — a
  pill that can only ever empty the grid is worse than no pill — and
  `matchesTags` is a **union**: any one of the selected tags is enough, so a
  second pill adds work to the grid rather than cutting it down. An
  intersection was tried and reverted, and the tagging is what rules it out —
  most projects carry five or six of these, and the overlap of any two
  specific ones is one or two projects when it isn't empty, so half the
  second clicks left a single teaser or a blank grid. The row answers "show
  me the AR work, and the illustration work", not "show me what is both".
  Because nothing can empty the grid, every pill is always live; the
  `tagCounts` / disabled-pill machinery that an intersection needed went with
  it.
- **`lib/gridMedia.ts`** — every teaser the grid is showing, playing at once.
  The strip's `useTeaserVideo` owns one element and swaps its source, which
  is right for one active teaser and wrong here, so this is a **pool**: a
  fixed few elements assigned to cells and handed back as they scroll out,
  never built per project. What makes it affordable is that a cell is a
  third of the canvas, so these stream at 360 where the strip streams at
  720 — about a seventh of the pixels a frame, so six together decode less
  than two full-size ones. Crossing back to the single column tears the pool
  down and the strip picks its item up at full size again: the resolution
  follows the surface, not the project. Beyond the pool's six, and on touch,
  a cell falls through to cycling its gallery stills — `gridSlides`, four
  frames at cell size, because a dozen cells each holding a project's full
  twenty at 1280 wide is a hundred megabytes of texture for a picture a
  third of the canvas across. Touch devices never stream here at all: iOS
  runs HLS through AVFoundation and several players at once is past what it
  will do. Cells are adopted only once the grid has been still for a moment,
  so a flick through four rows doesn't spin up twenty streams on the way,
  and they are taken in reading order with whole cells before clipped ones —
  sorting by distance from the middle of the view skipped the top row in
  favour of the second.
- **`lib/portfolios.ts`** — Sanity queries + types. Two portfolios
  (`interactive` / `branding`) map to Sanity category values `immersive-ux` /
  `branding-print`; `advertising-rich-media` projects are dropped. Each
  project also carries `tags`, a list of slugs (see `lib/tags.ts`). Gallery
  `imagesSlide` entries (multi-image uploads) are flattened into single slides
  here, so nothing downstream knows about them. The ids are historical: the
  `interactive` portfolio is called **Experiential** and lives at
  `/experiential`. Both the label and the id live in **`lib/portfolioMeta.ts`**
  rather than here, because a module the server reads cannot import a React
  hook — see the hard rules — and `portfolios.ts` re-exports them so client
  code still has one import.
- **`lib/routes.ts`** — every URL on the site and the one place that maps
  between them and app state: `/`, `/experiential`, `/experiential/<slug>`,
  and `?panel=resume|contact|reel` for the three overlays (a query, so an
  overlay keeps whatever page it was opened over, and back closes it rather
  than leaving the page). Also the document titles. No `"use client"`: the
  route segment reads it on the server.
- **`app/[[...path]]/page.tsx`** — *every* address resolves to this one page
  component, which validates the segments (`notFound()` otherwise, see
  `app/not-found.tsx`) and sets the title and canonical. The app then moves
  its own URL with `history.pushState` and plays `popstate` back into state
  (`go` / `applyRoute` in `PortfolioApp`). See the hard rules for why.
- **`lib/analytics.ts`** — the GA4 measurement id, loaded in `app/layout.tsx`,
  plus the `page_view` event every in-app move sends (the page never reloads,
  so gtag's own page view only ever fires for the address the visitor arrived
  on, and `page_location` has to be passed explicitly or every move is
  reported as that first address). Measured directly rather than through a
  Tag Manager container: there is one tag, so a container would only mean the
  switch for analytics lives outside the repo. The old container id is in the
  file's comment if tags ever need adding without a deploy.
- **`lib/videoEmbed.ts`** — resolves a pasted Vimeo/Gumlet URL or full embed
  code to a player src, plus postMessage helpers for detecting playback end
  across both providers' cross-origin iframes.
- **`app/api/video-poster/route.ts`** — server-side only: resolves a video
  embed to its poster image (Gumlet's poster needs a collection ID that only
  exists in CORS-blocked embed HTML; Vimeo via public oEmbed).

## Theme

The site's **chrome is dark**: a near-black page (`#070707`, a true inversion
of the off-white it used to be), a black menu rail with white type, and
white-filled active pills. Two surfaces are deliberately *not* part of that
and stay as they were:

- **the open project** — `components/project/` plus the back / portfolio /
  prev-next buttons in `PortfolioApp`, which live there but are gated on
  `opened`. A light sheet with black type;
- **`InfoModal`** — the résumé (white sheet, black type) and Contact
  (no background of its own, white type over the psychedelic effect), which
  are inverted relative to *each other* and have to flip as a pair or not at
  all.

The landing gate (`AgentIntro` + `WeatherPanel`, `IntroCube`'s scene clear)
was already dark and is unchanged. Its `bg-black/45` scrim is what lets the
sizzle reel read; turning it white washes the reel out to pastel.

Flipping the chrome is a find-and-replace on the Tailwind `*-white` /
`*-black` utilities plus that hex — but four colours in it are *mechanisms*,
not theme, and must never be swapped:

- the custom cursor's `#fff` ring and dot (`globals.css`) — under
  `mix-blend-mode: difference` white is a full inversion and black a no-op,
  so swapping it makes the cursor disappear;
- the gallery's `#000000` backing plane — what the additive R/G/B channels
  sum against, whatever the canvas clears to;
- the corner-mask canvas fill — white as an alpha operand, not as a colour;
- `Menu`'s list `linear-gradient` — a CSS mask, where black/white are alpha.

`body`'s own `color` is the default for anything that sets none, so it tracks
the chrome (white), not the light panels, which all set their own.

## Hard rules (violating these has broken things before)

- **Never navigate with the router.** `<Link>`, `router.push` and friends
  swap the page tree, which tears down both WebGL contexts, the video decode
  and the scroll position — the very things a move from a portfolio to a
  project animates. In-app moves go through `go()` in `PortfolioApp`, which
  pushes a `history` entry; back/forward come back in through `popstate` and
  `applyRoute`. Every address resolving to one page component
  (`app/[[...path]]`) is what makes that safe: nothing Next does on a
  restore can remount the app.
- **A module a server component imports cannot import a React hook** — the
  compiler refuses it outright, whether or not the hook is ever called. This
  is why the portfolio ids and labels sit in `lib/portfolioMeta.ts` apart
  from the hooks in `lib/portfolios.ts`: the route segment needs the labels
  to title a page. Anything else both sides need goes there too, not into
  `portfolios.ts`.
- **Page metadata inherits, so leave `robots` alone.** The root layout sets
  `noindex, nofollow, nocache` and route metadata sets only a title and a
  canonical, which means a new route is noindex without anyone remembering
  to say so. Verified in the served HTML, not assumed.
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
- **Tailwind's `scale-*`/`rotate-*` set the standalone `scale`/`rotate`
  properties**, not `transform` — so `transition-[...,transform]` doesn't
  animate them and the element jumps to size. Name the property itself
  (`transition-[opacity,scale]`).
- **Don't select SVG attributes by name in CSS** (`[pathLength]`): Chrome
  matched it on first style but missed it when an ancestor class changed
  later, leaving the weather icons undrawn. Select by element or class.
- **R3F may copy a `uniforms` prop onto the material**, so mutating your own
  object later reaches nothing (a silent black mesh). Build the
  `ShaderMaterial` yourself (or drive it through a ref) and write its
  uniforms directly — see `IntroCube`.

- **`attachHls` has to say which path it took.** Callers that speed playback
  up need to know whether they are on native HLS (iOS), which trick-plays
  above 2x — keyframes only — where hls.js is unaffected. It cannot be read
  off the element afterwards: hls.js points `src` at a MediaSource blob, so
  an element with a `src` is evidence of neither. That is why `HlsHandle`
  carries `native`; testing the element instead quietly ran the whole grid
  at 2x while the strip ran at 3x.
- **Teaser video is HLS-only.** Gumlet publishes no usable MP4 (every variant
  401/403s), so playback needs `hls.js` — except on WebKit, which renders an
  MSE blob as a black frame through WebGL and must use native HLS instead.
  Chrome answers `"maybe"` to the HLS mime type despite being unable to play
  it, so `canPlayType` can never be the first branch in that decision.
- **Additive planes that overlap sum past white.** The channels add over a
  black backing, which is exact while planes never overlap — and they never
  do in the strip, or in the grid at rest. They do on the way between the
  two, where a teaser crossing another left a hard white rectangle. The fix
  is a brightness dip through the middle of the morph (`dip` in Gallery),
  exactly 1 at both ends so it costs nothing at rest. Drawing each item's
  black backing immediately before its own channels would occlude instead of
  summing, but every backing shares a depth and a renderOrder, so that is a
  change to the open/close animation as much as to this.
- **A transparent source renders as a black teaser.** The gallery sums
  additively-blended R/G/B planes over the opaque black backing, so wherever
  an image is transparent the channels add nothing and the backing is what
  shows — NoHo B.I.D.'s first still is black artwork on a transparent ground
  and came out solid black. Painting the backing white is not the fix: the
  channels sum *on top of* it and every teaser clips to flat white (measured:
  centre pixel 255,255,255). `overWhite` in `lib/textures.ts` puts the ground
  under the artwork before the texture reaches the GPU instead, for both
  thumbnails and cycled stills.
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
