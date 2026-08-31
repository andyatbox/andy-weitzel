"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { PortfolioId, PortfolioItem } from "@/lib/portfolios";
import type { ScrollEngine } from "@/lib/ScrollEngine";
import { applyCover, useItemTextures } from "@/lib/textures";
import { driveTeaserPlayback, useTeaserVideo } from "@/lib/teaserVideo";
import { useTeaserSlides } from "@/lib/teaserSlides";

const PLANE_SEGMENTS = 32;
const BEND_FACTOR = 2.5;
const MAX_BEND_RATIO = 0.3;

// RGB shift: like the bend, driven by scroll velocity (speed + momentum +
// direction). The red and blue channel layers slide apart along the motion
// axis by this much; green stays centered. Additive blending sums the three
// back to the exact source image at rest — no shader, no darkening.
const RGB_SHIFT_FACTOR = 1.5;
const MAX_RGB_SHIFT_RATIO = 0.025;

// --- Pointer (mouse) distortion ---------------------------------------------
// A localized swirl + chromatic split centered on the cursor: full strength
// directly under it, easing to zero past MOUSE_RADIUS. It reuses the same
// primitives as the velocity effects — per-vertex geometry displacement for
// the twist, and the additive R/G/B channel layers (offset per-vertex) for the
// split — so there is no ShaderMaterial and images never darken. Completely
// disabled on touch-capable devices (see `detectTouch`).
const MOUSE_RADIUS_RATIO = 0.3; // influence radius vs min(canvas w, h)
const MOUSE_TWIST = 0.85; // peak swirl angle in radians (directly under cursor)
const MOUSE_CHROMA_RATIO = 0.018; // peak channel separation vs min(canvas w, h)
const MOUSE_EASE = 0.22; // strength lerp toward target each frame

function detectTouch() {
  if (typeof window === "undefined") return false;
  return (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
}

// "Pull back" amount. The camera is orthographic, so distance on Z has no
// visual effect — zoom is the equivalent knob. 1 = current plane exactly
// fills the canvas; lower values reveal parts of the previous/next items.
const CAMERA_ZOOM = 0.8;

// How long everything must be still before a teaser video is shown and played.
// Motion stops it instantly; starting waits, so a brief pause mid-fling or the
// moment between two snaps never flickers a video in and out.
const VIDEO_STILL_MS = 220;

// Gap between items in px, added along the scroll axis. Portrait uses a
// tighter gap than the wider landscape rail.
const ITEM_GAP_LANDSCAPE = 36;
const ITEM_GAP_PORTRAIT = 6;

// How far off-centre (in item steps) a plane can be and still touch the
// screen. At CAMERA_ZOOM the visible half-extent is spacing/(2·zoom) and a
// plane's own half-extent is spacing/2, so anything past ~1.2 steps is fully
// outside the frustum; the margin covers the bend and the mouse swirl, which
// can push vertices out by up to MAX_BEND_RATIO of a step. Planes beyond this
// are already frustum-culled by three — this just stops us computing and
// uploading vertex buffers for them too.
const VISIBLE_STEPS = 1.8;

interface GalleryProps {
  items: PortfolioItem[];
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
  onIndexChange: (index: number) => void;
  // Receives the WebGL canvas once created, so the post-process can sample it.
  onReady?: (canvas: HTMLCanvasElement) => void;
}

export default function Gallery({
  items,
  portfolio,
  isLandscape,
  engine,
  opened,
  anim,
  visible,
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
      camera={{ position: [0, 0, 500], near: 0.1, far: 1000, zoom: CAMERA_ZOOM }}
      style={{ background: "#f8f8f8" }}
      onCreated={({ gl }) => onReady?.(gl.domElement)}
    >
      {/* Canvas (gap) background. Images sit on their own black backing so the
          additive RGB-shift channels still sum correctly; see ChannelPlanes. */}
      <color attach="background" args={["#f8f8f8"]} />
      <GalleryScene
        key={portfolio}
        items={items}
        isLandscape={isLandscape}
        engine={engine}
        opened={opened}
        anim={anim}
        visible={visible}
        onIndexChange={onIndexChange}
      />
    </Canvas>
  );
}

function GalleryScene({
  items,
  isLandscape,
  engine,
  opened,
  anim,
  visible,
  onIndexChange,
}: Omit<GalleryProps, "portfolio">) {
  const { size, camera, gl, scene } = useThree();
  const planeWidth = size.width;
  const planeHeight = size.height;
  const itemGap = isLandscape ? ITEM_GAP_LANDSCAPE : ITEM_GAP_PORTRAIT;
  const spacing = (isLandscape ? planeHeight : planeWidth) + itemGap;

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
  // Projects with no video but with gallery stills cycle through them instead.
  const [slideIndex, setSlideIndex] = useState<number | null>(null);
  const slideIndexRef = useRef<number | null>(null);
  const slideItem = slideIndex !== null ? items[slideIndex] : undefined;
  const slides = useTeaserSlides(slideItem?.slides, slideIndex !== null);

  // The video stands in for that item's image only while it's live; otherwise
  // a cycled still if this item has them; otherwise the thumbnail, which is
  // also what shows during any motion.
  const texAt = (i: number) => {
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
  // devices, where the effect is disabled outright.
  const isTouch = useMemo(detectTouch, []);
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
  const basePositions = useMemo(
    () =>
      geoms.mains[0]
        ? Float32Array.from(geoms.mains[0].attributes.position.array)
        : new Float32Array(),
    [geoms]
  );
  const count = basePositions.length / 3;
  useEffect(
    () => () => {
      [...geoms.mains, ...geoms.reds, ...geoms.blues].forEach((g) => g.dispose());
    },
    [geoms]
  );

  useEffect(() => {
    engine.setLayout(spacing, items.length);
  }, [engine, spacing, items.length]);

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
    const W = anim.w || planeWidth;
    const H = anim.h || planeHeight;
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
      const aspect = W / H;
      for (let i = 0; i < items.length; i++) {
        backingRefs.current[i]?.scale.set(W, H, 1);
        redRefs.current[i]?.scale.set(W, H, 1);
        greenRefs.current[i]?.scale.set(W, H, 1);
        blueRefs.current[i]?.scale.set(W, H, 1);
        // Titles are centred on the plane's own origin, so they need no
        // repositioning as it grows — the corner-anchored version did.
        // Re-crop the texture to the live aspect each frame, else the UVs stay
        // at the old aspect while the geometry scales — stretching the image.
        const tex = texAt(i);
        if (tex) applyCover(tex, aspect);
      }
    }
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
    const axis = isLandscape ? (animating ? H : planeHeight) : animating ? W : planeWidth;
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
    const maxBend = MAX_BEND_RATIO * spacing;
    const bendTarget = THREE.MathUtils.clamp(
      engine.velocity * BEND_FACTOR,
      -maxBend,
      maxBend
    );
    const bendActive =
      Math.abs(bendTarget) > 0.01 || Math.abs(lastBend.current) > 0.01;

    // --- pointer (mouse) distortion ---------------------------------------
    // Ease strength toward 1 while the cursor is over the canvas (and nothing
    // is opening/open), else toward 0. The whole block is inert on touch.
    const mTarget =
      !isTouch && pointer.current.active && !opened && !animating && t < 0.001
        ? 1
        : 0;
    pointer.current.strength += (mTarget - pointer.current.strength) * MOUSE_EASE;
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
      ? pointer.current.ndcX * (planeWidth / (2 * cam.zoom))
      : 0;
    const mouseWorldY = mouseOn
      ? pointer.current.ndcY * (planeHeight / (2 * cam.zoom))
      : 0;

    // Infinite wrap + per-plane displacement. Each item is placed at its
    // nearest wrapped copy, then its geometries are rewritten with bend +
    // pointer swirl/chroma — but only when something actually affects it.
    const total = items.length * spacingUsed;
    // Set whenever a vertex buffer is actually rewritten, so the draw gate
    // below knows the picture moved. (A "some plane is displaced" test would
    // be true for as long as the cursor hovers, which is exactly the case
    // this is trying to stop drawing.)
    let geomChanged = false;
    for (let i = 0; i < items.length; i++) {
      const group = groupRefs.current[i];
      if (!group) continue;
      let p = i * spacingUsed - currentUsed;
      p = ((p % total) + total) % total;
      if (p > total / 2) p -= total;
      let gx: number;
      let gy: number;
      if (isLandscape) {
        gx = 0;
        gy = -p;
        group.position.set(0, -p, 0);
      } else {
        gx = p;
        gy = 0;
        group.position.set(p, 0, 0);
      }

      // Does the cursor's influence disc reach this plane's box at all?
      let planeMouse = false;
      if (mouseOn) {
        const ndx = Math.max(0, Math.abs(mouseWorldX - gx) - planeWidth / 2);
        const ndy = Math.max(0, Math.abs(mouseWorldY - gy) - planeHeight / 2);
        if (ndx * ndx + ndy * ndy <= RPx * RPx) planeMouse = true;
      }

      // Off-screen planes get no vertex work at all. The bend is global, so
      // without this every item in the portfolio — 30-odd of them, three
      // geometries each — was rewritten and re-uploaded on every frame of
      // every scroll, to be frustum-culled immediately afterwards.
      const onScreen = Math.abs(p) <= VISIBLE_STEPS * spacingUsed;

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
            if (isLandscape) {
              const fo = 1 - (2 * bx) ** 2;
              my += (-bendTarget / planeHeight) * fo;
            } else {
              const fo = 1 - (2 * by) ** 2;
              mx += (bendTarget / planeWidth) * fo;
            }
          }
          if (planeMouse) {
            const dxPx = bx * planeWidth - mlx;
            const dyPx = by * planeHeight - mly;
            const dist = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
            let f = 1 - dist / RPx;
            if (f > 0) {
              f = f * f * (3 - 2 * f) * mStrength;
              // Swirl: rotate the vertex about the cursor, angle fading outward.
              const ang = MOUSE_TWIST * f;
              const cs = Math.cos(ang);
              const sn = Math.sin(ang);
              mx += (dxPx * cs - dyPx * sn - dxPx) / planeWidth;
              my += (dxPx * sn + dyPx * cs - dyPx) / planeHeight;
              // Chroma: push red outward / blue inward along the cursor radial.
              if (dist > 0.001) {
                const ch = chromaPx * f;
                const cxN = (ch * (dxPx / dist)) / planeWidth;
                const cyN = (ch * (dyPx / dist)) / planeHeight;
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
    const maxShift = MAX_RGB_SHIFT_RATIO * spacing;
    const shift = THREE.MathUtils.clamp(
      engine.velocity * RGB_SHIFT_FACTOR,
      -maxShift,
      maxShift
    );
    if (Math.abs(shift) > 0.01 || Math.abs(lastShift.current) > 0.01) {
      lastShift.current = shift;
      for (let i = 0; i < items.length; i++) {
        const red = redRefs.current[i];
        const blue = blueRefs.current[i];
        if (isLandscape) {
          if (red) red.position.y = shift;
          if (blue) blue.position.y = -shift;
        } else {
          if (red) red.position.x = shift;
          if (blue) blue.position.x = -shift;
        }
      }
    }

    const index = engine.activeIndex;
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
    let want = videoIndexRef.current;
    if (want !== null && (want !== index || !visible || opened)) want = null;
    if (want === null && visible && !opened && restStable && items[index]?.video)
      want = index;
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
    const item = items[index];
    let wantSlides = slideIndexRef.current;
    if (wantSlides !== null && (wantSlides !== index || !visible || opened)) {
      wantSlides = null;
    }
    if (
      wantSlides === null &&
      visible &&
      !opened &&
      restStable &&
      !item?.video &&
      item?.slides?.length
    ) {
      wantSlides = index;
    }
    if (wantSlides !== slideIndexRef.current) {
      slideIndexRef.current = wantSlides;
      setSlideIndex(wantSlides);
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
    const drawing =
      animating ||
      !engine.settled ||
      videoFrame ||
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
      <mesh ref={backingRef} geometry={geomMain} scale={scale}>
        <meshBasicMaterial color="#1a1a1a" />
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
      {/* Opaque black backing: the additive channels sum on top of this, so
          the image renders correctly even though the canvas clears to a light
          gray. Shares the main (twisted) geometry so it tracks the planes. */}
      <mesh ref={backingRef} geometry={geomMain} scale={scale}>
        <meshBasicMaterial color="#000000" toneMapped={false} />
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
