"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PortfolioId, PortfolioItem } from "@/lib/portfolios";
import type { ScrollEngine } from "@/lib/ScrollEngine";
import type { GridScroll } from "@/lib/GridScroll";
import { applyCover, useItemTextures } from "@/lib/textures";
import { driveTeaserPlayback, useTeaserVideo } from "@/lib/teaserVideo";
import { useTeaserSlides } from "@/lib/teaserSlides";
import { useGridMedia } from "@/lib/gridMedia";
import {
  MAX_RGB_SHIFT_RATIO,
  MOUSE_CHROMA_RATIO,
  MOUSE_EASE,
  MOUSE_RADIUS_RATIO,
  MOUSE_TWIST,
  RGB_SHIFT_FACTOR,
  detectTouch,
} from "@/lib/pointerFx";

const PLANE_SEGMENTS = 32;
const BEND_FACTOR = 2.5;
const MAX_BEND_RATIO = 0.3;

// RGB shift: like the bend, driven by scroll velocity (speed + momentum +
// direction). The red and blue channel layers slide apart along the motion
// axis by this much; green stays centered. Additive blending sums the three
// back to the exact source image at rest — no shader, no darkening.

// --- Pointer (mouse) distortion ---------------------------------------------
// A localized swirl + chromatic split centered on the cursor: full strength
// directly under it, easing to zero past MOUSE_RADIUS. It reuses the same
// primitives as the velocity effects — per-vertex geometry displacement for
// the twist, and the additive R/G/B channel layers (offset per-vertex) for the
// split — so there is no ShaderMaterial and images never darken. Completely
// disabled on touch-capable devices (see `detectTouch`).
// The numbers live in lib/pointerFx.ts, shared with the landing blob.

// "Pull back" amount. The camera is orthographic, so distance on Z has no
// visual effect — zoom is the equivalent knob. 1 = current plane exactly
// fills the canvas; lower values reveal parts of the previous/next items.
const CAMERA_ZOOM = 0.8;

// How long everything must be still before a teaser video is shown and played.
// Motion stops it instantly; starting waits, so a brief pause mid-fling or the
// moment between two snaps never flickers a video in and out.
const VIDEO_STILL_MS = 220;

// Gap between items in world px, added along the scroll axis — and, in
// landscape, the margin across it as well, so a teaser sits in the same
// gutter whichever way you measure. Portrait uses a tighter gap than the
// wider landscape rail.
const ITEM_GAP_LANDSCAPE = 36;
const ITEM_GAP_PORTRAIT = 6;

// The shape a landscape teaser is held to. The canvas is three quarters of
// the window, so unless the display is very wide it comes out close to
// square — and a teaser that took its full height came out nearly square
// too, from 16:9 source, cropping the sides to do it. Capping the height
// against the width keeps the picture landscape whatever the window does.
const MIN_ASPECT = 1.45;
// Ceiling on the aspect, for the opposite case. Teasers are 16:9, and past
// that the cover crop starts taking the top and bottom instead — the very
// trade MIN_ASPECT is there to avoid. Only an ultra-wide canvas reaches it.
const MAX_ASPECT = 16 / 9;
// Floor on a teaser's height as a share of the canvas. Height given up to
// MIN_ASPECT comes back as more of the previous/next item showing above and
// below — half of it each — so on a canvas near square the aspect has to
// stop somewhere short. At the camera's pull-back alone a teaser covers 0.8
// of the height; this is how far below that it may be pushed.
const MIN_HEIGHT_FILL = 0.66;

/**
 * The resting size of a teaser, in world px, for a canvas of `W`x`H`.
 *
 * Landscape fills the width the camera actually shows (`W / CAMERA_ZOOM`,
 * since at the pull-back a canvas-sized plane is drawn at 80% and left a
 * tenth of the canvas empty on each side) less a gutter, then takes whatever
 * height that width wants at MIN_ASPECT. Portrait is the canvas: its cross
 * axis is the short one, and filling it would make a teaser more upright
 * rather than less.
 *
 * Shared by the React props and the open/close lerp so the two agree at rest
 * — a mismatch there snaps the mesh the instant a transition starts.
 */
function restSize(W: number, H: number, isLandscape: boolean) {
  if (!isLandscape) return { w: W, h: H };
  const w = Math.min(W / CAMERA_ZOOM - 2 * ITEM_GAP_LANDSCAPE, H * MAX_ASPECT);
  const h = THREE.MathUtils.clamp(
    w / MIN_ASPECT,
    (MIN_HEIGHT_FILL * H) / CAMERA_ZOOM,
    H,
  );
  return { w, h };
}

// Teaser corner radius, in plane px. A plane is sized in canvas px, so this is
// screen px before the camera's zoom scales it down.
const CORNER_RADIUS = 28;
// Resolution ceiling for the corner mask. A soft curve is the only thing in
// it, so a half-size mask filtered back up is indistinguishable from an exact
// one — and the filtering is what makes the edge smooth.
const CORNER_MASK_MAX = 1024;

/**
 * A rounded-rectangle alpha mask, sized to the plane's aspect.
 *
 * The corners can't come from the geometry — a plane is a flat 32x32 grid and
 * every one of its vertices is already spoken for by the bend and the swirl —
 * and they can't come from a fragment shader without giving up the additive
 * channel trick that keeps images from darkening. A mask in UV space costs one
 * small texture, applies to all four layers alike, and rides along with every
 * distortion the vertices do, so the corners stay rounded while the plane
 * bends.
 *
 * Built per aspect rather than square-and-stretched: a square mask on a
 * 16:9 plane gives elliptical corners.
 */
function makeCornerMask(w: number, h: number): THREE.CanvasTexture | null {
  if (typeof document === "undefined" || w <= 0 || h <= 0) return null;
  const scale = Math.min(1, CORNER_MASK_MAX / Math.max(w, h));
  const cw = Math.max(2, Math.round(w * scale));
  const ch = Math.max(2, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const r = Math.min(CORNER_RADIUS * scale, cw / 2, ch / 2);
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.roundRect(0, 0, cw, ch, r);
  ctx.fill();
  const tex = new THREE.CanvasTexture(canvas);
  // A mask, not a picture: no sRGB decode, or the ramp at the curve shifts.
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// --- Grid form --------------------------------------------------------------
// What the strip becomes while the filters are open: a plain scrolling grid,
// no wrap, hard ends. Cells keep the teasers' own 16:9 rather than the
// strip's squarer MIN_ASPECT crop — a grid is read by scanning across it, and
// a row of near-squares reads as a contact sheet.
const GRID_ASPECT = 16 / 9;
// Gutter between cells, and the margin around the whole grid, in world px.
const GRID_GAP = 20;
// The title under each cell. Sized against the cell's width and bounded, so
// it holds its place in the hierarchy as the grid reflows. Deliberately at
// the rail list's own weight rather than under it: these are the only names
// on screen while the grid is up — the list itself has slid away — so they
// are the work's titles here, not captions on it. All in *screen* px,
// because the label is DOM type drawn where the viewer sits, not geometry.
// The band reserved below each cell is derived from this, so raising it
// takes its room out of the pictures rather than overlapping the next row.
const GRID_LABEL_RATIO = 0.075;
const GRID_LABEL_MIN = 15;
const GRID_LABEL_MAX = 26;
const GRID_LABEL_GAP = 12;
// The band the grid reserves allows exactly two lines at that size, and the
// label clamps to two: a long project name wraps rather than pushing the row
// below it down. The grid's rhythm is most of what makes it scannable, and a
// ragged one reads as a mistake.
const GRID_LABEL_LINES = 2;
export const GRID_LABEL_LEADING = 1.3;
// One teaser's trip from the strip to its cell, and how far behind the one
// before it each starts. The whole move is held under the cap, so a long
// portfolio tightens the step rather than taking three seconds.
// How many cells may stream at once, and how long the grid has to be still
// before any of them is adopted. Six is about where a desktop's hardware
// decoder stops keeping up and the work falls to the CPU; the wait is what
// stops a flick through four rows spinning up twenty streams on the way.
const GRID_MAX_VIDEOS = 6;
const GRID_MEDIA_STILL_MS = 250;
const GRID_MOVE_MS = 440;
const GRID_STEP_MS = 34;
const GRID_TOTAL_CAP = 1150;
// Share of the remaining distance a cell closes per frame when the filter
// reflows the grid under it.
const CELL_EASE = 0.16;

/** Where the DOM layer should draw one title, in screen px in the canvas. */
export interface GridLabelLayout {
  /** False when there is no grid, so the whole layer can stand down. */
  live: boolean;
  font: number;
  width: number;
  x: Float32Array;
  y: Float32Array;
  a: Float32Array;
}

/**
 * Columns, from the canvas's width in CSS px — not the window's. In
 * landscape the rail has already taken a quarter of the window, so judging
 * this by window width would put four columns in three quarters of the room.
 */
function gridColumns(cssWidth: number) {
  return cssWidth < 620 ? 2 : 3;
}

// How far off-centre (in item steps) a plane can be and still touch the
// screen. At CAMERA_ZOOM the visible half-extent is spacing/(2·zoom) and a
// plane's own half-extent is spacing/2, so anything past ~1.2 steps is fully
// outside the frustum; the margin covers the bend and the mouse swirl, which
// can push vertices out by up to MAX_BEND_RATIO of a step. Planes beyond this
// are already frustum-culled by three — this just stops us computing and
// uploading vertex buffers for them too.
const VISIBLE_STEPS = 1.8;

interface GalleryProps {
  /**
   * Every project in the portfolio, filtered or not. The filter decides what
   * is *shown*, not what exists: an item that has just been filtered out has
   * to stay mounted long enough to fade, and rebuilding the meshes on every
   * tag click would throw away the textures along with them.
   */
  items: PortfolioItem[];
  /**
   * Indices into `items`, in display order — the strip's sequence and the
   * grid's reading order alike. Anything missing from it is faded out and
   * parked. The scroll engine counts slots in here, not items.
   */
  order: number[];
  portfolio: PortfolioId;
  isLandscape: boolean;
  engine: ScrollEngine;
  opened: boolean;
  // Shared open/close state, eased per frame by the parent in lockstep with
  // the canvas resize. `t` is progress (0=closed, 1=open); `w`/`h` are the
  // live eased canvas size; `animating` is true only during a transition.
  anim: { t: number; w: number; h: number; animating: boolean };
  // False while the gallery is off-screen (splash still up, or mid portfolio
  // switch). Teaser video stays dormant until it's actually visible, so
  // nothing streams behind a cover.
  visible: boolean;
  /** True while the filters are up: the strip morphs into the grid. */
  gridOpen: boolean;
  /** The grid's own scroll position; the strip's engine is left where it is. */
  gridScroll: GridScroll;
  /**
   * Filled in with a hit test from viewport coords to a slot in `order`, so a
   * tap on a cell can open that project. Null while there is no grid to hit.
   */
  hitRef: React.MutableRefObject<
    ((x: number, y: number) => number | null) | null
  >;
  /** Filled in with where the DOM layer should draw each project's title. */
  labelRef: React.MutableRefObject<GridLabelLayout | null>;
  onIndexChange: (index: number) => void;
  // Receives the WebGL canvas once created, so the post-process can sample it.
  onReady?: (canvas: HTMLCanvasElement) => void;
}

export default function Gallery({
  items,
  order,
  portfolio,
  isLandscape,
  engine,
  opened,
  anim,
  visible,
  gridOpen,
  gridScroll,
  hitRef,
  labelRef,
  onIndexChange,
  onReady,
}: GalleryProps) {
  return (
    <Canvas
      orthographic
      flat
      dpr={[1, 2]}
      // preserveDrawingBuffer lets the post-process read this canvas as a
      // texture (otherwise the buffer may be cleared before it can be sampled).
      gl={{ antialias: true, alpha: false, preserveDrawingBuffer: true }}
      camera={{
        position: [0, 0, 500],
        near: 0.1,
        far: 1000,
        zoom: CAMERA_ZOOM,
      }}
      style={{ background: "#070707" }}
      onCreated={({ gl }) => onReady?.(gl.domElement)}
    >
      {/* Canvas (gap) background. Images sit on their own black backing so the
          additive RGB-shift channels still sum correctly; see ChannelPlanes. */}
      <color attach="background" args={["#070707"]} />
      <GalleryScene
        key={portfolio}
        items={items}
        order={order}
        isLandscape={isLandscape}
        engine={engine}
        opened={opened}
        anim={anim}
        visible={visible}
        gridOpen={gridOpen}
        gridScroll={gridScroll}
        hitRef={hitRef}
        labelRef={labelRef}
        onIndexChange={onIndexChange}
      />
    </Canvas>
  );
}

function GalleryScene({
  items,
  order,
  isLandscape,
  engine,
  opened,
  anim,
  visible,
  gridOpen,
  gridScroll,
  hitRef,
  labelRef,
  onIndexChange,
}: Omit<GalleryProps, "portfolio">) {
  const { size, camera, gl, scene } = useThree();
  // Only while closed: an open project fills the window exactly, and this is
  // the resting value React writes to the mesh whenever the canvas resizes —
  // which it does all through the open transition. Left at the teaser size
  // there, it would fight the per-frame lerp below and crop the open project.
  const rest =
    isLandscape && !opened
      ? restSize(size.width, size.height, true)
      : { w: size.width, h: size.height };
  const planeWidth = rest.w;
  const planeHeight = rest.h;
  const itemGap = isLandscape ? ITEM_GAP_LANDSCAPE : ITEM_GAP_PORTRAIT;
  const spacing = (isLandscape ? planeHeight : planeWidth) + itemGap;

  // Where each item sits in the shown sequence, or -1 if the filter has taken
  // it out. The frame loop runs over every item (they all still have meshes)
  // and asks this; the engine and the grid both count slots, not items.
  const slotOf = useMemo(() => {
    const map = new Array<number>(items.length).fill(-1);
    order.forEach((item, slot) => {
      if (item >= 0 && item < map.length) map[item] = slot;
    });
    return map;
  }, [items.length, order]);
  const shown = order.length;

  const textures = useItemTextures(items, planeWidth / planeHeight);

  // Teaser video. Only one item streams at a time — whichever the gallery is
  // currently settled on — so a portfolio can carry any number of videos
  // without the cost growing. `videoIndexRef` mirrors the state so the frame
  // loop can read it without waiting for a re-render.
  const [videoIndex, setVideoIndex] = useState<number | null>(null);
  const videoIndexRef = useRef<number | null>(null);
  const videoItem = videoIndex !== null ? items[videoIndex] : undefined;
  const teaser = useTeaserVideo(videoItem?.video, videoIndex !== null);
  // Owning the video element and *showing* it are separate: the element is
  // kept alive while its item stays active (re-fetching HLS on every snap
  // would be far worse), but the texture is only swapped in — and played —
  // once nothing is moving. Anything less means decoding a video through the
  // same frames that are already busy animating.
  const [videoLive, setVideoLive] = useState(false);
  const videoLiveRef = useRef(false);
  const stillSince = useRef(0);
  // Every cell on screen plays, rather than only the one the strip is on.
  // The list is published from the frame loop once the grid has stopped
  // moving; the pool below turns it into streams and still-cycles. Touch
  // devices get the stills only — see lib/gridMedia.
  const [inView, setInView] = useState<number[]>([]);
  const [gridLive, setGridLive] = useState(false);
  const gridLiveRef = useRef(false);
  const viewKey = useRef("");
  const viewSince = useRef(0);
  const nextViewCheck = useRef(0);
  const lastGridVersion = useRef(-1);

  // Projects with no video but with gallery stills cycle through them instead.
  const [slideIndex, setSlideIndex] = useState<number | null>(null);
  const slideIndexRef = useRef<number | null>(null);
  const slideItem = slideIndex !== null ? items[slideIndex] : undefined;
  const slides = useTeaserSlides(slideItem?.slides, slideIndex !== null);
  const isTouch = useMemo(detectTouch, []);
  const gridMedia = useGridMedia({
    items,
    inView,
    enabled: gridLive,
    allowVideo: !isTouch,
    maxVideos: GRID_MAX_VIDEOS,
  });

  // The video stands in for that item's image only while it's live; otherwise
  // a cycled still if this item has them; otherwise the thumbnail, which is
  // also what shows during any motion.
  const texAt = (i: number) => {
    // The grid's own media wins while there is a grid: its pool is emptied
    // the moment there isn't, so this falls through on its own.
    const inGridTex = gridMedia.map.get(i);
    if (inGridTex) return inGridTex;
    if (teaser.texture && videoLive && i === videoIndex) return teaser.texture;
    if (slides.texture && i === slideIndex) return slides.texture;
    return textures[i];
  };

  // Crop the video the same way as the stills (it's 16:9 like the thumbnails).
  useEffect(() => {
    if (teaser.texture) applyCover(teaser.texture, planeWidth / planeHeight);
  }, [teaser.texture, planeWidth, planeHeight]);
  useEffect(() => {
    if (slides.texture) applyCover(slides.texture, planeWidth / planeHeight);
  }, [slides.texture, planeWidth, planeHeight]);
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const redRefs = useRef<(THREE.Mesh | null)[]>([]);
  const blueRefs = useRef<(THREE.Mesh | null)[]>([]);
  // Backing + green layers too, so every plane mesh can be scaled imperatively
  // during the open/close transition.
  const backingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const greenRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lastIndex = useRef(-1);
  // Per-item fade (0 = filtered out), and the cell each one is easing toward,
  // in grid-local px with the scroll left out so a reflow can ease while the
  // scroll stays 1:1 under the finger. Rebuilt only when the portfolio does.
  const fx = useMemo(
    () => ({
      alpha: new Float32Array(items.length),
      cellX: new Float32Array(items.length),
      cellY: new Float32Array(items.length),
      /** False until this item has been given a cell to ease from. */
      placed: new Uint8Array(items.length),
      x: new Float32Array(items.length),
      y: new Float32Array(items.length),
      seeded: false,
    }),
    [items.length],
  );
  // How far through the move the whole form is, in ms. Driven here rather
  // than by the parent because this callback runs every frame anyway, and
  // the parent would only be passing the number back in.
  const gridClock = useRef(0);
  const lastTick = useRef(0);
  // Last frame's master progress, so the frame that *finishes* the morph
  // still writes the resting scale before React takes the plane sizes back.
  const lastGridT = useRef(0);
  // Where the DOM layer should put each title. Written every frame; read by
  // GridLabels on its own rAF.
  const labels = useMemo<GridLabelLayout>(
    () => ({
      live: false,
      font: 12,
      width: 0,
      x: new Float32Array(items.length),
      y: new Float32Array(items.length),
      a: new Float32Array(items.length),
    }),
    [items.length],
  );
  useEffect(() => {
    labelRef.current = labels;
    return () => {
      labelRef.current = null;
    };
  }, [labels, labelRef]);
  // The last frame's grid geometry, for the hit test below — which has to
  // answer from a pointer event, outside the loop that computes it.
  const gridBox = useRef({
    cols: 2,
    cellW: 0,
    cellH: 0,
    pitchY: 0,
    viewW: 0,
    viewH: 0,
    scroll: 0,
    live: false,
  });

  // A tap on a cell opens that project, so the app needs to know which cell.
  // Published as a function rather than raycast on demand: the planes are
  // bent and swirled, and the answer wanted is which *cell* was hit, not
  // which triangle.
  useEffect(() => {
    hitRef.current = (clientX: number, clientY: number) => {
      const box = gridBox.current;
      if (!box.live) return null;
      const r = gl.domElement.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const wx = (((clientX - r.left) / r.width) * 2 - 1) * (box.viewW / 2);
      const wy = -(((clientY - r.top) / r.height) * 2 - 1) * (box.viewH / 2);
      const pitchX = box.cellW + GRID_GAP;
      const col = Math.floor((wx + box.viewW / 2 - GRID_GAP / 2) / pitchX);
      // The title belongs to the cell above it, so the band counts as part
      // of the target — a tap on a project's name opens that project.
      const row = Math.floor(
        (box.viewH / 2 - GRID_GAP / 2 - wy + box.scroll) / box.pitchY,
      );
      if (col < 0 || col >= box.cols || row < 0) return null;
      const slot = row * box.cols + col;
      return slot >= 0 && slot < order.length ? slot : null;
    };
    return () => {
      hitRef.current = null;
    };
  }, [gl, hitRef, order.length]);

  const lastBend = useRef(0);
  const lastShift = useRef(0);
  // Per-plane "is currently displaced" flag, so idle planes are reset to flat
  // exactly once (instead of rewritten every frame).
  const planeDirty = useRef<boolean[]>([]);
  // Last drawing-buffer size actually pushed to the renderer, in device pixels.
  const lastBuffer = useRef({ w: 0, h: 0 });
  const lastZoom = useRef(-1);
  const lastVideoVersion = useRef(-1);
  const lastPointer = useRef({ x: NaN, y: NaN });
  // Redraw deadline. This scene is static whenever nothing is scrolling,
  // animating or playing, but anything React changes (a texture finishing its
  // load, a slide swap, a resize) alters it without touching any of those
  // signals — so every commit buys a short window of frames.
  const dirtyUntil = useRef(performance.now() + 1000);
  useEffect(() => {
    dirtyUntil.current = performance.now() + 250;
  });

  // Pointer state (canvas-local NDC + eased strength). Untouched on touch
  // devices, where the effect is disabled outright (`isTouch` is declared
  // with the grid pool above, which needs the same answer).
  const pointer = useRef({ ndcX: 0, ndcY: 0, active: false, strength: 0 });

  // Per-plane geometries. The mouse swirl displaces each plane differently
  // (each sits at a different distance from the cursor), so a single shared
  // geometry can't represent them all — every plane gets its own. The backing
  // and green channel share `main` (twist only); red and blue each get their
  // own buffer so the chromatic split can push them apart per-vertex.
  const geoms = useMemo(() => {
    const make = () =>
      new THREE.PlaneGeometry(1, 1, PLANE_SEGMENTS, PLANE_SEGMENTS);
    return {
      mains: items.map(make),
      reds: items.map(make),
      blues: items.map(make),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);
  // One mask for every plane: they all share a size.
  const cornerMask = useMemo(
    () => makeCornerMask(planeWidth, planeHeight),
    [planeWidth, planeHeight],
  );
  useEffect(() => () => void cornerMask?.dispose(), [cornerMask]);

  const basePositions = useMemo(
    () =>
      geoms.mains[0]
        ? Float32Array.from(geoms.mains[0].attributes.position.array)
        : new Float32Array(),
    [geoms],
  );
  const count = basePositions.length / 3;
  useEffect(
    () => () => {
      [...geoms.mains, ...geoms.reds, ...geoms.blues].forEach((g) =>
        g.dispose(),
      );
    },
    [geoms],
  );

  useEffect(() => {
    // Slots, not items: a filtered strip is as long as what it shows.
    engine.setLayout(spacing, Math.max(1, shown));
  }, [engine, spacing, shown]);

  // Track the cursor in canvas-local NDC. Skipped entirely on touch devices.
  useEffect(() => {
    if (isTouch) return;
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current.ndcX = ((e.clientX - r.left) / r.width) * 2 - 1;
      pointer.current.ndcY = -(((e.clientY - r.top) / r.height) * 2 - 1);
      pointer.current.active = true;
    };
    const onLeave = () => {
      pointer.current.active = false;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerenter", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerenter", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, [gl, isTouch]);

  useFrame(() => {
    engine.update();

    // --- open/close animation -------------------------------------------
    // The progress `t` is owned by the parent and eased in lockstep with the
    // canvas resize, so plane dims (from R3F size), zoom and gap stay synced.
    const t = anim.t;

    // Pull-back eases to a perfect fill (zoom 1) as the project opens.
    const cam = camera as THREE.OrthographicCamera;
    cam.zoom = THREE.MathUtils.lerp(CAMERA_ZOOM, 1, t);

    // The live, parent-eased canvas size. R3F's React-state `size` lags the
    // per-frame DOM resize by a few commits, so during a transition we drive
    // the frustum, buffer, plane scales and title from these values directly —
    // that's what makes the planes grow smoothly instead of snapping at the end.
    const animating = anim.animating;
    const W = anim.w || size.width;
    const H = anim.h || size.height;
    // A resting teaser is smaller than the canvas on both axes while the open
    // one fills it exactly, so blend the two on the same `t` that drives the
    // zoom — otherwise the plane would snap to canvas size the instant a
    // project started opening. Computed from the live, parent-eased canvas
    // rather than React's `size`, which lags the resize by a few commits.
    // --- grid morph -------------------------------------------------------
    // A clock in milliseconds, not an eased number. The teasers leave one
    // after another — each takes GRID_MOVE_MS from its own start, and its
    // start is a step later than the one before it — and an exponential
    // ease has no timeline to offset along: its tail asymptotes, so the
    // last item in the queue would crawl into place.
    const nowMs = performance.now();
    const dt = Math.min(50, Math.max(0, nowMs - (lastTick.current || nowMs)));
    lastTick.current = nowMs;
    // The step shrinks on a long portfolio so the whole move stays inside
    // GRID_TOTAL_CAP: a tiny delay times thirty items is not a tiny delay.
    const step =
      shown > 1
        ? Math.min(GRID_STEP_MS, (GRID_TOTAL_CAP - GRID_MOVE_MS) / (shown - 1))
        : 0;
    const span = GRID_MOVE_MS + step * Math.max(0, shown - 1);
    gridClock.current = THREE.MathUtils.clamp(
      gridClock.current + (gridOpen ? dt : -dt),
      0,
      span,
    );
    const clock = gridClock.current;
    // The master progress: what the whole form is doing, for the things that
    // are not per-item — the dip, which scroll is in charge, whether the
    // hit test may answer.
    const g = span > 0 ? clock / span : gridOpen ? 1 : 0;
    const inGrid = clock > 0;
    const gridLed = g > 0.5;
    const settledGrid = gridOpen && clock >= span;
    // The pool exists for as long as there is a grid on screen, not merely
    // while the panel is open: the teasers are still in their cells all
    // through the morph out, and cutting their media at the first frame of
    // it would drop every one of them back to a thumbnail at once.
    if (inGrid !== gridLiveRef.current) {
      gridLiveRef.current = inGrid;
      setGridLive(inGrid);
    }
    /** One item's own progress, 0 at its start and 1 once it has landed. */
    const progressAt = (slot: number) => {
      if (span <= 0) return gridOpen ? 1 : 0;
      const u = THREE.MathUtils.clamp(
        (clock - slot * step) / GRID_MOVE_MS,
        0,
        1,
      );
      return u * u * (3 - 2 * u);
    };
    // Teasers cross each other on the way between the strip and the grid,
    // and the channels are additive: two bright planes overlapping sum past
    // white and leave a hard flare where they cross. Dipping everything
    // through the middle of the morph keeps those sums in range — and reads
    // as the gallery passing through a shadow, which is no bad thing for a
    // change of form. Exactly 1 at both ends, so it costs nothing at rest.
    // The stagger thins the crossings out, so it needs less than it did.
    const dip = 1 - 0.38 * Math.sin(Math.PI * g) ** 0.7;

    // The grid is laid out in what the lens covers, not in canvas px: at the
    // closed pull-back the camera shows 1/CAMERA_ZOOM of the canvas, so a
    // grid measured in canvas px would leave a tenth of the width empty down
    // each side — the very margin the strip exists to show through.
    const viewW = W / cam.zoom;
    const viewH = H / cam.zoom;
    const cols = gridColumns(size.width);
    const cellW = (viewW - GRID_GAP * (cols + 1)) / cols;
    const cellH = cellW / GRID_ASPECT;
    // Each row carries its titles under it, so the row's pitch is the cell
    // plus the band those take plus the gutter. The band is derived from the
    // type rather than fixed, so changing the label's size cannot quietly
    // leave it overlapping the row beneath.
    const labelFont = THREE.MathUtils.clamp(
      cellW * cam.zoom * GRID_LABEL_RATIO,
      GRID_LABEL_MIN,
      GRID_LABEL_MAX,
    );
    const labelBand =
      (GRID_LABEL_GAP + labelFont * GRID_LABEL_LINES * GRID_LABEL_LEADING) /
      cam.zoom;
    const rowPitch = cellH + labelBand + GRID_GAP;
    const rows = Math.max(1, Math.ceil(Math.max(1, shown) / cols));
    const contentH = rows * rowPitch + GRID_GAP;
    if (inGrid) {
      gridScroll.setMax(contentH - viewH);
      gridScroll.update();
    }
    const scrollY = gridScroll.current;
    const box = gridBox.current;
    box.cols = cols;
    box.cellW = cellW;
    box.cellH = cellH;
    box.pitchY = rowPitch;
    box.viewW = viewW;
    box.viewH = viewH;
    box.scroll = scrollY;
    // Only answer taps once the grid is the form on screen; mid-morph the
    // cells are nowhere near where this maths says they are.
    box.live = settledGrid;

    const liveRest = restSize(W, H, isLandscape);
    const openW = THREE.MathUtils.lerp(liveRest.w, W, t);
    const openH = THREE.MathUtils.lerp(liveRest.h, H, t);
    if (animating) {
      cam.left = -W / 2;
      cam.right = W / 2;
      cam.top = H / 2;
      cam.bottom = -H / 2;
      // Reallocating the drawing buffer clears and re-allocates the default
      // framebuffer, so only do it when the size actually moves a whole device
      // pixel — the tail of the ease creeps by well under one.
      const pr = gl.getPixelRatio();
      const dw = Math.round(W * pr);
      const dh = Math.round(H * pr);
      if (dw !== lastBuffer.current.w || dh !== lastBuffer.current.h) {
        lastBuffer.current.w = dw;
        lastBuffer.current.h = dh;
        gl.setSize(W, H);
      }
    }
    // Plane scale and texture crop are React's at rest and ours while
    // anything moves them — the open transition, the morph, or simply being
    // in the grid, where the resting size is not the one React wrote. Both
    // are per item now, because the stagger means two teasers are rarely the
    // same size on the same frame. Written inside the placement loop below.
    const resizing = animating || inGrid || lastGridT.current > 0.0001;
    lastGridT.current = g;

    // The titles the DOM layer draws under the cells, in screen px within
    // the canvas box. Published rather than rendered here: a line of type is
    // a thing the browser is extremely good at and three.js is not, and the
    // canvas has carried no text since the titles came out of it.
    const lab = labels;
    lab.live = inGrid;
    lab.width = cellW * cam.zoom;
    lab.font = labelFont;

    // Only rebuild the projection when it can have changed: while a transition
    // is running (frustum + zoom move together), or if the zoom itself moved.
    // R3F updates it on resize itself.
    if (animating || cam.zoom !== lastZoom.current) {
      lastZoom.current = cam.zoom;
      cam.updateProjectionMatrix();
    }

    // Closed: engine-driven scroll. Opening/open: the engine's continuous
    // progress is rescaled to the collapsed spacing, so the active item stays
    // centered while filling the screen — and prev/next navigation while open
    // slides the full-screen planes to the new project. The two modes agree at
    // t=0, so the switch is seamless.
    const axis = isLandscape
      ? animating
        ? openH
        : planeHeight
      : animating
        ? openW
        : planeWidth;
    let spacingUsed: number;
    let currentUsed: number;
    if (t > 0.0001) {
      spacingUsed = axis + THREE.MathUtils.lerp(itemGap, 0, t);
      currentUsed = (engine.current / (engine.spacing || 1)) * spacingUsed;
    } else {
      spacingUsed = spacing;
      currentUsed = engine.current;
    }

    // --- velocity bend (global, all planes share the same displacement) ---
    // Whichever scroll is in charge drives it, on whichever axis that scroll
    // runs: the grid is always vertical, however the window is held.
    const vertical = gridLed ? true : isLandscape;
    const vel = gridLed ? gridScroll.velocity : engine.velocity;
    const bendSpan = inGrid
      ? THREE.MathUtils.lerp(spacing, cellH + GRID_GAP, g)
      : spacing;
    const maxBend = MAX_BEND_RATIO * bendSpan;
    const bendTarget = THREE.MathUtils.clamp(
      vel * BEND_FACTOR,
      -maxBend,
      maxBend,
    );
    const bendActive =
      Math.abs(bendTarget) > 0.01 || Math.abs(lastBend.current) > 0.01;

    // --- pointer (mouse) distortion ---------------------------------------
    // Ease strength toward 1 while the cursor is over the canvas (and nothing
    // is opening/open), else toward 0. The whole block is inert on touch, and
    // in the grid: the swirl is sized against one teaser filling the view, and
    // over a page of small cells it reads as a smear rather than a lens.
    const mTarget =
      !isTouch &&
      pointer.current.active &&
      !opened &&
      !animating &&
      !inGrid &&
      t < 0.001
        ? 1
        : 0;
    pointer.current.strength +=
      (mTarget - pointer.current.strength) * MOUSE_EASE;
    const mStrength = pointer.current.strength;
    const mouseOn = mStrength > 0.001;

    // A cursor merely *resting* over the canvas leaves the swirl live but
    // completely unchanging. Without this the strength test alone kept the
    // whole stack redrawing at 60fps — at full cost — for as long as the
    // pointer sat anywhere over the gallery, which is most of the time.
    const now = performance.now();
    const fresh = now < dirtyUntil.current;
    const pointerChanged =
      pointer.current.ndcX !== lastPointer.current.x ||
      pointer.current.ndcY !== lastPointer.current.y ||
      Math.abs(mTarget - mStrength) > 0.001;
    lastPointer.current.x = pointer.current.ndcX;
    lastPointer.current.y = pointer.current.ndcY;
    // Whether the displacement maths can have produced a different result than
    // last frame. If not, the buffers already hold the right vertices.
    const recompute = bendActive || pointerChanged || fresh || animating;
    const minDim = Math.min(planeWidth, planeHeight);
    const RPx = minDim * MOUSE_RADIUS_RATIO;
    const chromaPx = minDim * MOUSE_CHROMA_RATIO;
    // Cursor in world px (orthographic: visible half-extent = size/(2·zoom)).
    const mouseWorldX = mouseOn
      ? pointer.current.ndcX * (size.width / (2 * cam.zoom))
      : 0;
    const mouseWorldY = mouseOn
      ? pointer.current.ndcY * (size.height / (2 * cam.zoom))
      : 0;

    // Placement. Each shown item is put at its nearest wrapped copy of its
    // slot in the strip, at its cell in the grid, and at the blend of the two
    // in between; then its geometries are rewritten with bend + pointer
    // swirl/chroma, but only when something actually affects it.
    const total = Math.max(1, shown) * spacingUsed;
    // Set whenever a vertex buffer is actually rewritten, so the draw gate
    // below knows the picture moved. (A "some plane is displaced" test would
    // be true for as long as the cursor hovers, which is exactly the case
    // this is trying to stop drawing.)
    let geomChanged = false;
    // Set whenever a fade or a cell is still travelling, so the same gate
    // keeps drawing until the reflow has settled.
    let fxMoving = false;
    // The first frame places and reveals everything outright: a portfolio
    // should arrive built, not assemble itself.
    const seeding = !fx.seeded;
    fx.seeded = true;

    for (let i = 0; i < items.length; i++) {
      const group = groupRefs.current[i];
      if (!group) continue;
      const slot = slotOf[i];
      const member = slot >= 0;
      // This item's own place in the queue. Non-members have no slot to
      // queue behind, so they follow the form as a whole.
      const gi = member ? progressAt(slot) : g;
      const sw = inGrid ? THREE.MathUtils.lerp(openW, cellW, gi) : openW;
      const sh = inGrid ? THREE.MathUtils.lerp(openH, cellH, gi) : openH;
      if (resizing) {
        backingRefs.current[i]?.scale.set(sw, sh, 1);
        redRefs.current[i]?.scale.set(sw, sh, 1);
        greenRefs.current[i]?.scale.set(sw, sh, 1);
        blueRefs.current[i]?.scale.set(sw, sh, 1);
        // Re-crop the texture to the live aspect each frame, else the UVs
        // stay at the old aspect while the geometry scales — stretching the
        // image. Titles are centred on the plane's own origin, so they need
        // no repositioning as it grows.
        const tex = texAt(i);
        if (tex) applyCover(tex, sw / sh);
      }

      // The fade is what filtering *is* here: an item that stops matching
      // keeps its mesh, its geometry and its texture and simply stops being
      // drawn, which is what lets a tag click reflow the grid in place
      // instead of rebuilding it.
      const aim = member ? 1 : 0;
      if (seeding) fx.alpha[i] = aim;
      else if (fx.alpha[i] !== aim) {
        fx.alpha[i] += (aim - fx.alpha[i]) * CELL_EASE;
        if (Math.abs(aim - fx.alpha[i]) < 0.004) fx.alpha[i] = aim;
        fxMoving = true;
      }
      const alpha = fx.alpha[i];

      if (member) {
        let p = slot * spacingUsed - currentUsed;
        p = ((p % total) + total) % total;
        if (p > total / 2) p -= total;
        const stripX = isLandscape ? 0 : p;
        const stripY = isLandscape ? -p : 0;

        // The cell, with the scroll left out: a filter change eases the
        // survivors into their new places, while the scroll stays 1:1 under
        // the finger. Rolling both into one eased number would make the grid
        // lag the drag.
        const cx =
          -viewW / 2 +
          GRID_GAP +
          cellW / 2 +
          (slot % cols) * (cellW + GRID_GAP);
        const cy =
          viewH / 2 - GRID_GAP - cellH / 2 - Math.floor(slot / cols) * rowPitch;
        if (seeding || !fx.placed[i]) {
          fx.cellX[i] = cx;
          fx.cellY[i] = cy;
          fx.placed[i] = 1;
        } else if (fx.cellX[i] !== cx || fx.cellY[i] !== cy) {
          fx.cellX[i] += (cx - fx.cellX[i]) * CELL_EASE;
          fx.cellY[i] += (cy - fx.cellY[i]) * CELL_EASE;
          if (Math.abs(cx - fx.cellX[i]) < 0.05) fx.cellX[i] = cx;
          if (Math.abs(cy - fx.cellY[i]) < 0.05) fx.cellY[i] = cy;
          fxMoving = true;
        }

        fx.x[i] = inGrid
          ? THREE.MathUtils.lerp(stripX, fx.cellX[i], gi)
          : stripX;
        fx.y[i] = inGrid
          ? THREE.MathUtils.lerp(stripY, fx.cellY[i] + scrollY, gi)
          : stripY;
      } else {
        // Left exactly where it was last shown, fading out in place. Its cell
        // is forgotten, so coming back it arrives at the new one rather than
        // sliding in from a layout two filters ago.
        fx.placed[i] = 0;
      }

      const gx = fx.x[i];
      const gy = fx.y[i];
      group.position.set(gx, gy, 0);

      // The title under this cell, in screen px inside the canvas box. It
      // comes up over the last third of the item's own move, so a teaser
      // arrives before it is named rather than dragging a label across the
      // screen behind it.
      if (inGrid) {
        const z = cam.zoom;
        lab.x[i] = W / 2 + (gx - sw / 2) * z;
        lab.y[i] = H / 2 - (gy - sh / 2) * z + GRID_LABEL_GAP;
        lab.a[i] =
          member && gi > 0.66 ? fx.alpha[i] * ((gi - 0.66) / 0.34) * dip : 0;
      } else {
        lab.a[i] = 0;
      }

      // One opacity across all four layers. The channels are additive, so
      // fading them together simply stops them adding; the backing fades with
      // them, leaving the page's own black rather than a black rectangle.
      const drawn = alpha > 0.004;
      const shown_a = alpha * dip;
      const mBack = backingRefs.current[i];
      const mRed = redRefs.current[i];
      const mGreen = greenRefs.current[i];
      const mBlue = blueRefs.current[i];
      if (mBack) {
        mBack.visible = drawn;
        (mBack.material as THREE.Material).opacity = shown_a;
      }
      if (mRed) {
        mRed.visible = drawn;
        (mRed.material as THREE.Material).opacity = shown_a;
      }
      if (mGreen) {
        mGreen.visible = drawn;
        (mGreen.material as THREE.Material).opacity = shown_a;
      }
      if (mBlue) {
        mBlue.visible = drawn;
        (mBlue.material as THREE.Material).opacity = shown_a;
      }
      if (!drawn) continue;

      // Does the cursor's influence disc reach this plane's box at all?
      let planeMouse = false;
      if (mouseOn) {
        const ndx = Math.max(0, Math.abs(mouseWorldX - gx) - sw / 2);
        const ndy = Math.max(0, Math.abs(mouseWorldY - gy) - sh / 2);
        if (ndx * ndx + ndy * ndy <= RPx * RPx) planeMouse = true;
      }

      // Off-screen planes get no vertex work at all. The bend is global, so
      // without this every item in the portfolio — 30-odd of them, three
      // geometries each — was rewritten and re-uploaded on every frame of
      // every scroll, to be frustum-culled immediately afterwards. Measured
      // against what the lens covers, which holds for the grid as well as for
      // the strip; the plane's own half-extent is the margin for the bend.
      const onScreen =
        Math.abs(gx) <= viewW / 2 + sw && Math.abs(gy) <= viewH / 2 + sh;

      const gMain = geoms.mains[i];
      const gRed = geoms.reds[i];
      const gBlue = geoms.blues[i];
      const pm = gMain.attributes.position as THREE.BufferAttribute;
      const pr = gRed.attributes.position as THREE.BufferAttribute;
      const pb = gBlue.attributes.position as THREE.BufferAttribute;

      // Whether this plane *should* be displaced, kept separate from whether
      // the displacement needs recalculating: a hovered plane that nothing has
      // changed under keeps the buffers it already has, but must not be
      // flattened by the branch below.
      const wantsDisplace = onScreen && (bendActive || planeMouse);

      if (wantsDisplace && recompute) {
        // Cursor in this plane's local px (origin at the plane center).
        const mlx = mouseWorldX - gx;
        const mly = mouseWorldY - gy;
        for (let v = 0; v < count; v++) {
          const bx = basePositions[v * 3];
          const by = basePositions[v * 3 + 1];
          let mx = bx;
          let my = by;
          if (bendActive) {
            // Normalised against the plane's *live* scale, so the bend keeps
            // the same depth whether the plane is a teaser, a grid cell or
            // halfway between the two.
            if (vertical) {
              const fo = 1 - (2 * bx) ** 2;
              my += (-bendTarget / sh) * fo;
            } else {
              const fo = 1 - (2 * by) ** 2;
              mx += (bendTarget / sw) * fo;
            }
          }
          if (planeMouse) {
            const dxPx = bx * sw - mlx;
            const dyPx = by * sh - mly;
            const dist = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
            let f = 1 - dist / RPx;
            if (f > 0) {
              f = f * f * (3 - 2 * f) * mStrength;
              // Swirl: rotate the vertex about the cursor, angle fading outward.
              const ang = MOUSE_TWIST * f;
              const cs = Math.cos(ang);
              const sn = Math.sin(ang);
              mx += (dxPx * cs - dyPx * sn - dxPx) / sw;
              my += (dxPx * sn + dyPx * cs - dyPx) / sh;
              // Chroma: push red outward / blue inward along the cursor radial.
              if (dist > 0.001) {
                const ch = chromaPx * f;
                const cxN = (ch * (dxPx / dist)) / sw;
                const cyN = (ch * (dyPx / dist)) / sh;
                pm.setXY(v, mx, my);
                pr.setXY(v, mx + cxN, my + cyN);
                pb.setXY(v, mx - cxN, my - cyN);
                continue;
              }
            }
          }
          pm.setXY(v, mx, my);
          pr.setXY(v, mx, my);
          pb.setXY(v, mx, my);
        }
        pm.needsUpdate = true;
        pr.needsUpdate = true;
        pb.needsUpdate = true;
        planeDirty.current[i] = true;
        geomChanged = true;
      } else if (!wantsDisplace && planeDirty.current[i]) {
        // Nothing affects this plane now — flatten it back to base once.
        for (let v = 0; v < count; v++) {
          const bx = basePositions[v * 3];
          const by = basePositions[v * 3 + 1];
          pm.setXY(v, bx, by);
          pr.setXY(v, bx, by);
          pb.setXY(v, bx, by);
        }
        pm.needsUpdate = true;
        pr.needsUpdate = true;
        pb.needsUpdate = true;
        planeDirty.current[i] = false;
        geomChanged = true;
      }
    }
    lastBend.current = bendTarget;

    // RGB shift (velocity): slide red one way and blue the other along the
    // motion axis via a whole-mesh offset, scaled by the same velocity that
    // drives the bend. Green stays at center, so all three realign and sum to
    // the original at rest. This is independent of — and adds to — the
    // per-vertex pointer chroma above.
    const maxShift = MAX_RGB_SHIFT_RATIO * bendSpan;
    const shift = THREE.MathUtils.clamp(
      vel * RGB_SHIFT_FACTOR,
      -maxShift,
      maxShift,
    );
    if (Math.abs(shift) > 0.01 || Math.abs(lastShift.current) > 0.01) {
      lastShift.current = shift;
      for (let i = 0; i < items.length; i++) {
        const red = redRefs.current[i];
        const blue = blueRefs.current[i];
        if (vertical) {
          if (red) red.position.y = shift;
          if (blue) blue.position.y = -shift;
        } else {
          if (red) red.position.x = shift;
          if (blue) blue.position.x = -shift;
        }
      }
    }

    // The engine counts slots in `order`; everything that reaches for the
    // item itself — the teaser video, the cycled stills — has to go through
    // it, or a filtered strip plays the wrong project's reel.
    const index = engine.activeIndex;
    const activeItem = order[index] ?? -1;
    if (index !== lastIndex.current) {
      lastIndex.current = index;
      onIndexChange(index);
    }

    // --- teaser video lifecycle -------------------------------------------
    // "At rest" means the strip has stopped AND the open/close transition is
    // done. The engine doesn't move during that transition, so `settled` alone
    // reads true right through it — the most expensive animation in the app.
    const atRest = engine.settled && !anim.animating;
    if (atRest) {
      if (!stillSince.current) stillSince.current = now;
    } else {
      stillSince.current = 0;
    }
    const restStable =
      stillSince.current !== 0 && now - stillSince.current >= VIDEO_STILL_MS;

    // Adopt a video only once things are at rest, so flicking past never spins
    // one up; hold it while it stays the active item; drop it the moment the
    // active item changes (the playhead is remembered).
    //
    // `opened` drops it too: the project sheet sits over the teaser, so playing
    // underneath would decode and upload frames nobody can see — and the sheet
    // is translucent, which would leak the motion through the blur. Reverting
    // to the thumbnail matches what an inactive teaser shows; closing the
    // project re-adopts the video and resumes from the remembered playhead.
    // The strip's single full-size teaser and the grid's pool must never
    // both hold the same project: `visible` already drops this while the
    // panel is open, but the morph out flips it back long before the cells
    // have left, which would stream one project at 720 and at 360 at once.
    let want = videoIndexRef.current;
    if (want !== null && (want !== activeItem || !visible || opened || inGrid))
      want = null;
    if (
      want === null &&
      visible &&
      !opened &&
      !inGrid &&
      restStable &&
      activeItem >= 0 &&
      items[activeItem]?.video
    )
      want = activeItem;
    if (want !== videoIndexRef.current) {
      videoIndexRef.current = want;
      setVideoIndex(want);
    }

    // Show and play only at rest. Motion drops straight back to the thumbnail,
    // so no video frame is decoded or uploaded while anything is animating.
    const live = want !== null && restStable;
    if (live !== videoLiveRef.current) {
      videoLiveRef.current = live;
      setVideoLive(live);
    }
    driveTeaserPlayback(teaser.el.current, live);

    // Still-cycling teasers: same adoption rule, but only for items with no
    // video, and it stops the moment the project is opened — an open project
    // shows its thumbnail behind the sheet rather than shuffling underneath.
    const item = activeItem >= 0 ? items[activeItem] : undefined;
    let wantSlides = slideIndexRef.current;
    if (
      wantSlides !== null &&
      (wantSlides !== activeItem || !visible || opened || inGrid)
    ) {
      wantSlides = null;
    }
    if (
      wantSlides === null &&
      visible &&
      !opened &&
      !inGrid &&
      restStable &&
      !item?.video &&
      item?.slides?.length
    ) {
      wantSlides = activeItem;
    }
    if (wantSlides !== slideIndexRef.current) {
      slideIndexRef.current = wantSlides;
      setSlideIndex(wantSlides);
    }

    // --- which cells are on screen ----------------------------------------
    // Only once the grid has stopped: adopting a stream for a cell that is
    // flying past is the one cost worth refusing, and it is the one a plain
    // "is it on screen" test would pay on every frame of a flick.
    if (settledGrid && gridScroll.settled) {
      if (!viewSince.current) viewSince.current = now;
    } else {
      viewSince.current = 0;
    }
    if (
      viewSince.current &&
      now - viewSince.current >= GRID_MEDIA_STILL_MS &&
      now >= nextViewCheck.current
    ) {
      nextViewCheck.current = now + 200;
      const reach = viewH / 2 + cellH / 2;
      const seen: number[] = [];
      for (let i = 0; i < items.length; i++) {
        if (slotOf[i] < 0) continue;
        if (Math.abs(fx.cellY[i] + scrollY) <= reach) seen.push(i);
      }
      // Whole cells before clipped ones, and reading order within each —
      // there are always more cells on screen than the pool can serve, and
      // the ones to give up are the halves at the edge, not the top row.
      // Sorting by distance from the middle of the view did exactly that
      // wrong: at the top of the grid it skipped the first row in favour of
      // the second and third.
      const whole = (i: number) =>
        Math.abs(fx.cellY[i] + scrollY) + cellH / 2 <= viewH / 2 ? 0 : 1;
      seen.sort((a, b) => whole(a) - whole(b) || slotOf[a] - slotOf[b]);
      const k = seen.join(",");
      if (k !== viewKey.current) {
        viewKey.current = k;
        setInView(seen);
      }
    } else if (!inGrid && viewKey.current !== "") {
      viewKey.current = "";
      setInView([]);
    }

    // --- draw -------------------------------------------------------------
    // A priority > 0 frame callback takes rendering over from R3F, which lets
    // us skip the draw entirely when the scene provably hasn't changed. Sitting
    // on a snapped teaser with no video, that's every frame: previously the
    // full stack was re-rendered 60x a second to produce an identical image,
    // which is most of what the fan was for. The state machine above still runs
    // every frame, so nothing can wedge — only the GPU work is skipped.
    // A playing teaser only needs a frame when it has actually decoded one.
    // `throttleUploads` caps that at MAX_TEXTURE_FPS and bumps `version` each
    // time it lets one through, so following the version draws at the video's
    // rate instead of the display's — half the work, same picture.
    const texVersion = teaser.texture ? teaser.texture.version : -1;
    const videoFrame =
      videoLiveRef.current && texVersion !== lastVideoVersion.current;
    // The grid's cells are moving pictures of their own. Summing their
    // texture versions draws on exactly the frames one of them decoded,
    // rather than at the display's rate for a grid of stills.
    let gridVersion = 0;
    if (inGrid)
      for (const t of gridMedia.map.values()) gridVersion += t.version;
    const gridFrame = gridVersion !== lastGridVersion.current;
    lastGridVersion.current = gridVersion;
    const drawing =
      animating ||
      !engine.settled ||
      // The morph, the grid's own scroll, and any fade or cell still
      // travelling after a tag click — each of them moves the picture
      // without touching the engine or a vertex buffer.
      (gridOpen ? clock < span : clock > 0) ||
      (inGrid && !gridScroll.settled) ||
      fxMoving ||
      videoFrame ||
      gridFrame ||
      geomChanged ||
      pointerChanged ||
      fresh;
    if (drawing) {
      lastVideoVersion.current = texVersion;
      gl.render(scene, camera);
    }
  }, 1);

  return (
    <>
      {items.map((item, i) => (
        <group key={item.id} ref={(el) => void (groupRefs.current[i] = el)}>
          <ChannelPlanes
            geomMain={geoms.mains[i]}
            geomRed={geoms.reds[i]}
            geomBlue={geoms.blues[i]}
            texture={texAt(i)}
            mask={cornerMask}
            width={planeWidth}
            height={planeHeight}
            backingRef={(el) => void (backingRefs.current[i] = el)}
            redRef={(el) => void (redRefs.current[i] = el)}
            greenRef={(el) => void (greenRefs.current[i] = el)}
            blueRef={(el) => void (blueRefs.current[i] = el)}
          />
        </group>
      ))}
    </>
  );
}

/**
 * One image rendered as three additively-blended channel layers (R, G, B).
 * Backing and green share the `main` geometry (bend + swirl, no chroma); red
 * and blue use their own geometries so the chromatic split can offset them
 * per-vertex near the cursor. The scene scrolls behind a black backing, so
 * summing red+green+blue reproduces the source exactly when aligned — sliding
 * them apart (per-vertex near the mouse, or per-mesh with velocity) produces
 * the chromatic split without a ShaderMaterial, so nothing darkens.
 */
function ChannelPlanes({
  geomMain,
  geomRed,
  geomBlue,
  texture,
  mask,
  width,
  height,
  backingRef,
  redRef,
  greenRef,
  blueRef,
}: {
  geomMain: THREE.PlaneGeometry;
  geomRed: THREE.PlaneGeometry;
  geomBlue: THREE.PlaneGeometry;
  texture: THREE.Texture | undefined;
  /** Rounded-corner alpha mask, shared by all four layers. */
  mask: THREE.Texture | null;
  width: number;
  height: number;
  backingRef: (el: THREE.Mesh | null) => void;
  redRef: (el: THREE.Mesh | null) => void;
  greenRef: (el: THREE.Mesh | null) => void;
  blueRef: (el: THREE.Mesh | null) => void;
}) {
  const scale: [number, number, number] = [width, height, 1];

  if (!texture) {
    return (
      <mesh ref={backingRef} geometry={geomMain} scale={scale} renderOrder={-1}>
        <meshBasicMaterial color="#e5e5e5" alphaMap={mask} transparent />
      </mesh>
    );
  }

  // three decides whether to sRGB-decode a map with a *shader define*
  // (DECODE_VIDEO_TEXTURE), chosen when the program is compiled. Swapping the
  // map from an image to a VideoTexture on a live material doesn't recompile
  // it, so the decode silently never runs and video renders with lifted
  // blacks — measurably ~2.2x on the darks. Keying the material on the source
  // kind rebuilds it, so each gets the program it needs.
  const kind = (texture as THREE.Texture & { isVideoTexture?: boolean })
    ?.isVideoTexture
    ? "video"
    : "image";

  // depthTest off so all three coincident layers draw and sum (equal-depth
  // testing would otherwise let only the first win); renderOrder keeps them
  // behind the title text, which draws afterward at a higher order.
  const channel = (color: string) => (
    <meshBasicMaterial
      key={kind}
      map={texture}
      alphaMap={mask}
      color={color}
      toneMapped={false}
      transparent
      blending={THREE.AdditiveBlending}
      depthWrite={false}
      depthTest={false}
    />
  );

  return (
    <>
      {/* Black backing: the additive channels sum on top of this, so the
          image renders correctly whatever the canvas clears to — this stays
          black on a dark page as it did on a light one, because it is what
          the channels sum against, not a theme colour. Shares the main
          (twisted) geometry so it tracks the planes.
          The corner mask makes it transparent rather than opaque, which moves
          it into the sorted transparent pass — hence the explicit renderOrder,
          so it can never be drawn after the channels it has to sit behind. */}
      <mesh ref={backingRef} geometry={geomMain} scale={scale} renderOrder={-1}>
        <meshBasicMaterial
          color="#000000"
          alphaMap={mask}
          transparent
          toneMapped={false}
        />
      </mesh>
      <mesh ref={redRef} geometry={geomRed} scale={scale} renderOrder={0}>
        {channel("#ff0000")}
      </mesh>
      <mesh ref={greenRef} geometry={geomMain} scale={scale} renderOrder={0}>
        {channel("#00ff00")}
      </mesh>
      <mesh ref={blueRef} geometry={geomBlue} scale={scale} renderOrder={0}>
        {channel("#0000ff")}
      </mesh>
    </>
  );
}
