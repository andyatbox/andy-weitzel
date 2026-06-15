# Andy Weitzel — Creative Director Portfolio

Full-screen portfolio built with Next.js (App Router), React 19, Tailwind 4, and React Three Fiber. Currently running on dummy content/images (local 16:9 JPEGs in `public/images/`, with procedural fallbacks) until wired to Sanity.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # production build
```

## How it works

- **Two portfolios** — INTERACTIVE (15 items) and BRANDING (8 items), toggled via DOM links in the menu ([lib/portfolios.ts](lib/portfolios.ts)).
- **Layout** — landscape: menu left 25% / gallery 75%; portrait: gallery top 75% / menu bottom 25%. All heights use `window.innerHeight` (not 100vh), refreshed on resize ([lib/useViewport.ts](lib/useViewport.ts)). Page scroll and overscroll are disabled.
- **Gallery** — OrthographicCamera with 1 world unit = 1 px. Each plane exactly fills the gallery canvas, with a 16:9 image cover-cropped via texture repeat/offset (no ShaderMaterial). 3D Helvetica titles (helvetiker typeface) sit bottom-left of each plane ([components/Gallery.tsx](components/Gallery.tsx)).
- **Scrolling** — always vertical wheel/drag input; items wrap infinitely vertically (landscape) or horizontally (portrait). Lerped momentum with fling on drag release ([lib/ScrollEngine.ts](lib/ScrollEngine.ts)). Velocity bends a shared plane geometry opposite the travel direction, peaking at the center and fixed at the edges, easing flat at rest.
