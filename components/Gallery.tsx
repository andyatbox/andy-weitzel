"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Text3D } from "@react-three/drei";
import * as THREE from "three";
import type { PortfolioId, PortfolioItem } from "@/lib/portfolios";
import type { ScrollEngine } from "@/lib/ScrollEngine";
import { applyCover, useItemTextures } from "@/lib/textures";

// Winding-repaired via scripts/fix-typeface.cjs — the raw conversion
// ("New Spirit_Medium.json") renders counters (e, d, o…) as solid blobs.
// Fallback if needed: "/fonts/helvetiker_regular.typeface.json".
const FONT_URL = "/fonts/NewSpirit-Medium.typeface.json";
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
const MOUSE_RADIUS_RATIO = 0.45; // influence radius vs min(canvas w, h)
const MOUSE_TWIST = 0.85; // peak swirl angle in radians (directly under cursor)
const MOUSE_CHROMA_RATIO = 0.013; // peak channel separation vs min(canvas w, h)
const MOUSE_EASE = 0.16; // strength lerp toward target each frame

function detectTouch() {
  if (typeof window === "undefined") return false;
  return (navigator.maxTouchPoints || 0) > 0 || "ontouchstart" in window;
}

// "Pull back" amount. The camera is orthographic, so distance on Z has no
// visual effect — zoom is the equivalent knob. 1 = current plane exactly
// fills the canvas; lower values reveal parts of the previous/next items.
const CAMERA_ZOOM = 0.8;

// Gap between items in px, added along the scroll axis. Portrait uses a
// tighter gap than the wider landscape rail.
const ITEM_GAP_LANDSCAPE = 75;
const ITEM_GAP_PORTRAIT = 12;

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
  onIndexChange,
}: Omit<GalleryProps, "portfolio">) {
  const { size, camera, gl } = useThree();
  const planeWidth = size.width;
  const planeHeight = size.height;
  const itemGap = isLandscape ? ITEM_GAP_LANDSCAPE : ITEM_GAP_PORTRAIT;
  const spacing = (isLandscape ? planeHeight : planeWidth) + itemGap;

  const textures = useItemTextures(items, planeWidth / planeHeight);
  const groupRefs = useRef<(THREE.Group | null)[]>([]);
  const textRefs = useRef<(THREE.Mesh | null)[]>([]);
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
  // anchorIndex is the active item captured at open time, kept centered while
  // the gap collapses.
  const anchorIndex = useRef(0);
  const prevOpened = useRef(false);

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
    // Freeze the active item as the anchor the moment opening begins. The
    // progress `t` is owned by the parent and eased in lockstep with the
    // canvas resize, so plane dims (from R3F size), zoom and gap stay synced.
    if (opened && !prevOpened.current) anchorIndex.current = engine.activeIndex;
    prevOpened.current = opened;
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
      gl.setSize(W, H);
      const fs = Math.min(W, H) * 0.05;
      const pad = fs * 0.8;
      const aspect = W / H;
      for (let i = 0; i < items.length; i++) {
        backingRefs.current[i]?.scale.set(W, H, 1);
        redRefs.current[i]?.scale.set(W, H, 1);
        greenRefs.current[i]?.scale.set(W, H, 1);
        blueRefs.current[i]?.scale.set(W, H, 1);
        textRefs.current[i]?.position.set(-W / 2 + pad, -H / 2 + pad, 4);
        // Re-crop the texture to the live aspect each frame, else the UVs stay
        // at the old aspect while the geometry scales — stretching the image.
        const tex = textures[i];
        if (tex) applyCover(tex, aspect);
      }
    }
    cam.updateProjectionMatrix();

    // Closed: engine-driven scroll. Opening/open: anchored on the active item
    // with the gap collapsing to 0, so it stays centered while filling the
    // screen. The two modes agree at t=0, so the switch is seamless.
    const axis = isLandscape ? (animating ? H : planeHeight) : animating ? W : planeWidth;
    let spacingUsed: number;
    let currentUsed: number;
    if (t > 0.0001) {
      spacingUsed = axis + THREE.MathUtils.lerp(itemGap, 0, t);
      currentUsed = anchorIndex.current * spacingUsed;
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

    // Per-vertex updater for a title mesh: same bend it always had, plus the
    // pointer swirl (in px, since text geometry is already in px).
    const updateText = (i: number, gx: number, gy: number, planeMouse: boolean) => {
      const mesh = textRefs.current[i];
      if (!mesh) return;
      const geo = mesh.geometry;
      const tp = geo.attributes.position as THREE.BufferAttribute;
      if (!tp) return;
      let base = geo.userData.basePositions as Float32Array | undefined;
      if (!base) {
        base = Float32Array.from(tp.array);
        geo.userData.basePositions = base;
      }
      const ox = mesh.position.x;
      const oy = mesh.position.y;
      for (let v = 0; v < tp.count; v++) {
        const bx = base[v * 3];
        const by = base[v * 3 + 1];
        let x = bx;
        let y = by;
        if (bendActive) {
          if (isLandscape) {
            const nx = (ox + bx) / planeWidth;
            const fo = Math.max(0, 1 - (2 * nx) ** 2);
            y = by - bendTarget * fo;
          } else {
            const ny = (oy + by) / planeHeight;
            const fo = Math.max(0, 1 - (2 * ny) ** 2);
            x = bx + bendTarget * fo;
          }
        }
        if (planeMouse) {
          const dxPx = gx + ox + bx - mouseWorldX;
          const dyPx = gy + oy + by - mouseWorldY;
          const dist = Math.sqrt(dxPx * dxPx + dyPx * dyPx);
          let f = 1 - dist / RPx;
          if (f > 0) {
            f = f * f * (3 - 2 * f) * mStrength;
            const ang = MOUSE_TWIST * f;
            const cs = Math.cos(ang);
            const sn = Math.sin(ang);
            x += dxPx * cs - dyPx * sn - dxPx;
            y += dxPx * sn + dyPx * cs - dyPx;
          }
        }
        tp.setXY(v, x, y);
      }
      tp.needsUpdate = true;
    };
    const resetText = (i: number) => {
      const mesh = textRefs.current[i];
      if (!mesh) return;
      const tp = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const base = mesh.geometry.userData.basePositions as Float32Array | undefined;
      if (!tp || !base) return;
      for (let v = 0; v < tp.count; v++) tp.setXY(v, base[v * 3], base[v * 3 + 1]);
      tp.needsUpdate = true;
    };

    // Infinite wrap + per-plane displacement. Each item is placed at its
    // nearest wrapped copy, then its geometries are rewritten with bend +
    // pointer swirl/chroma — but only when something actually affects it.
    const total = items.length * spacingUsed;
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

      const gMain = geoms.mains[i];
      const gRed = geoms.reds[i];
      const gBlue = geoms.blues[i];
      const pm = gMain.attributes.position as THREE.BufferAttribute;
      const pr = gRed.attributes.position as THREE.BufferAttribute;
      const pb = gBlue.attributes.position as THREE.BufferAttribute;

      if (bendActive || planeMouse) {
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
        updateText(i, gx, gy, planeMouse);
      } else if (planeDirty.current[i]) {
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
        resetText(i);
        planeDirty.current[i] = false;
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
  });

  const fontSize = Math.min(planeWidth, planeHeight) * 0.05;
  const padding = fontSize * 0.8;

  return (
    <>
      {items.map((item, i) => (
        <group key={item.id} ref={(el) => void (groupRefs.current[i] = el)}>
          <ChannelPlanes
            geomMain={geoms.mains[i]}
            geomRed={geoms.reds[i]}
            geomBlue={geoms.blues[i]}
            texture={textures[i]}
            width={planeWidth}
            height={planeHeight}
            backingRef={(el) => void (backingRefs.current[i] = el)}
            redRef={(el) => void (redRefs.current[i] = el)}
            greenRef={(el) => void (greenRefs.current[i] = el)}
            blueRef={(el) => void (blueRefs.current[i] = el)}
          />
          <Suspense fallback={null}>
            <Text3D
              ref={(el) => void (textRefs.current[i] = el)}
              font={FONT_URL}
              size={fontSize}
              height={fontSize * 0.08}
              curveSegments={6}
              bevelEnabled={false}
              renderOrder={1}
              position={[-planeWidth / 2 + padding, -planeHeight / 2 + padding, 4]}
            >
              {item.title}
              <meshBasicMaterial
                color="#ffffff"
                toneMapped={false}
                transparent
                depthTest={false}
              />
            </Text3D>
          </Suspense>
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

  // depthTest off so all three coincident layers draw and sum (equal-depth
  // testing would otherwise let only the first win); renderOrder keeps them
  // behind the title text, which draws afterward at a higher order.
  const channel = (color: string) => (
    <meshBasicMaterial
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
