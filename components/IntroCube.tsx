"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  attachHls,
  createVideoElement,
  resolveHls,
  retryOnNextGesture,
  throttleUploads,
} from "@/lib/hlsVideo";
import {
  MOUSE_EASE,
  MOUSE_RADIUS_RATIO,
  MOUSE_TWIST,
  detectTouch,
} from "@/lib/pointerFx";

// The reel the shape and the sky both play — one stream feeds both. Any
// proportions work: the sky wraps the whole picture, the shape takes a
// centred square of it.
const EMBED = "https://play.gumlet.io/embed/6ac0ee1dd6a6ba7c2cbf0b19";
// One decode shared by the shape's six faces and the sky, capped in height,
// with uploads gated well below the source's frame rate. Desktops get up to
// 1080p, which the sky shows near 1:1; touch devices, where both decode and
// upload cost more, stop at 720p.
const MAX_VIDEO_HEIGHT = 1080;
const MAX_VIDEO_HEIGHT_TOUCH = 720;
const MAX_TEXTURE_FPS = 30;
// How far the goo can swell past the pillowed shape, in half-widths. Shared
// by the shader and the frame clamp, which has to allow for the worst case.
const MORPH = 0.55;

/**
 * Streams the reel into a VideoTexture for as long as the intro is up.
 *
 * One element, one decode — all six faces sample the same texture, so the
 * cube costs no more to feed than a single plane would.
 */
function useReelTexture(enabled: boolean) {
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const texRef = useRef<THREE.VideoTexture | null>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    const onVisibility = () => {
      // rAF stops when the tab is hidden, so the per-frame gate stops running.
      // Pause explicitly rather than decode in the background.
      if (document.hidden) videoRef.current?.pause();
      else void videoRef.current?.play().catch(() => {});
    };

    void (async () => {
      const src = await resolveHls(EMBED);
      if (!alive || !src) return;

      const video = createVideoElement();
      videoRef.current = video;

      const tex = new THREE.VideoTexture(video);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      throttleUploads(tex, MAX_TEXTURE_FPS);
      texRef.current = tex;

      const handle = await attachHls(video, src, {
        maxHeight: detectTouch() ? MAX_VIDEO_HEIGHT_TOUCH : MAX_VIDEO_HEIGHT,
        bufferSeconds: 10,
        // Open on the top rendition rather than climbing to it: the sky
        // shows the picture large from the first frame.
        assumeBandwidth: 6_000_000,
      });
      if (!alive) {
        handle?.destroy();
        return;
      }
      hlsRef.current = handle;

      // Publish only once there's a decodable frame, so the first paint isn't
      // a black face.
      const onReady = () => {
        if (!alive || video.readyState < 2) return;
        setTexture(tex);
      };
      for (const ev of ["loadeddata", "canplay", "playing"] as const) {
        video.addEventListener(ev, onReady);
      }
      document.addEventListener("visibilitychange", onVisibility);
      void video.play().catch(() => retryOnNextGesture(video));
    })();

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      hlsRef.current?.destroy();
      hlsRef.current = null;
      texRef.current?.dispose();
      texRef.current = null;
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
        video.remove();
      }
      videoRef.current = null;
      setTexture(null);
    };
  }, [enabled]);

  return texture;
}

/**
 * Pillows each face: every vertex is pushed out along its own face's normal by
 * (1-u²)(1-v²), where u,v are its position across that face. That's zero along
 * the face's border and peaks at its centre, so the faces bow out while the
 * twelve edges and eight corners stay exactly where a hard cube has them —
 * sharp, straight, unrounded.
 *
 * BoxGeometry gives each face its own vertices with a flat face normal, which
 * is what makes the per-face push possible: a shared-vertex cube would have no
 * single direction to push an edge vertex in.
 *
 * On top of that, the goo: slow, large-scale simplex noise swells and sinks
 * the surface, and a slow twist wrings it about its vertical axis, so the cube
 * never holds a shape — a lava lamp rather than a solid.
 *
 * The goo must not tear the cube open. Each face owns its own copy of the
 * vertices along a shared edge, so anything that moves those copies apart
 * opens a crack. The pillow is safe because it's zero on the edges; the goo is
 * made safe by depending only on things the copies share — their undisplaced
 * position, and the direction out from the centre — never on the face normal.
 */
const VERT = `
uniform float u_inflate;
uniform float u_morph;
// The shape is two dials, both eased in the frame loop (see shapeAt):
// u_sphere rounds the pillowed cube toward a sphere (0..1), u_goo scales
// everything that makes it a blob — swell, squash, wring and the picture's
// slide. Cube, sphere and blob are just points on those two dials, so moving
// between any two is one surface morphing, never a cut.
uniform float u_sphere;
uniform float u_goo;
uniform float u_time;
// Pointer swirl (see lib/pointerFx.ts), all in canvas px with y up.
uniform vec2 u_res;
uniform vec2 u_mouse;
uniform float u_mstr;
uniform float u_radius;
uniform float u_twist;
varying vec2 vUv;
varying float vDisp;

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT).
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  vUv = uv;
  vec3 p = position * 2.0;               // unit box spans -0.5..0.5
  // Position across the face: zero out the component along the normal, so
  // only the two in-face coordinates shape the bulge.
  vec3 f = p * (1.0 - abs(normal));
  float bulge = (1.0 - f.x * f.x) * (1.0 - f.y * f.y) * (1.0 - f.z * f.z);
  vec3 q = p + normal * u_inflate * bulge;

  // Round toward a sphere — all the way for the sphere state, and partway
  // under the blob: at that much swell the cube's hard edges stop reading as
  // edges and fold into creases, and a softened base keeps the lobes smooth.
  // Like everything else here it depends only on position, so the seams hold.
  vec3 p2 = p * p;
  vec3 sph = vec3(
    p.x * sqrt(max(0.0, 1.0 - (p2.y + p2.z) * 0.5 + p2.y * p2.z / 3.0)),
    p.y * sqrt(max(0.0, 1.0 - (p2.z + p2.x) * 0.5 + p2.z * p2.x / 3.0)),
    p.z * sqrt(max(0.0, 1.0 - (p2.x + p2.y) * 0.5 + p2.x * p2.y / 3.0))
  );
  q = mix(q, sph * (1.0 + u_inflate * 0.5), u_sphere);

  // Goo: few, big lobes. One low-frequency noise, sampled through a second
  // slow noise that bends its coordinates (domain warp), so neighbouring
  // lobes pull into each other like wax rather than sitting as separate
  // bumps. Sampled at the undisplaced position and pushed straight out from
  // the centre — both shared by coincident edge vertices, so the surface
  // flows without splitting along the seams.
  float t = u_time * 0.38;
  vec3 warp = vec3(
    snoise(p * 0.45 + vec3(t * 0.6, 0.0, 0.0)),
    snoise(p * 0.45 + vec3(0.0, t * 0.5, 3.1)),
    snoise(p * 0.45 + vec3(5.7, 0.0, t * 0.55))
  );
  float n = snoise(p * 0.6 + warp * 0.55 + vec3(0.0, t, t * 0.7)) * 0.85
          + snoise(p * 1.1 - vec3(t * 0.8, 0.0, t)) * 0.15;
  q += normalize(p) * n * u_morph * u_goo;

  // Squash and stretch along an axis that keeps turning, so the whole mass
  // elongates and flattens in changing directions.
  vec3 ax = normalize(vec3(sin(t * 0.7), cos(t * 0.53), sin(t * 0.41 + 1.3)));
  q += ax * dot(q, ax) * 0.28 * sin(t * 1.1) * u_goo;

  // A wring about the vertical axis, stronger toward the top and bottom,
  // swinging back and forth. Kept gentle: past this the shear folds the
  // surface over itself into pleats instead of bending it.
  float a = sin(t * 0.9) * 0.45 * q.y * u_morph * u_goo;
  float c = cos(a), s = sin(a);
  q.xz = mat2(c, -s, s, c) * q.xz;

  vDisp = n * u_goo;

  // --- Pointer swirl, in screen space -----------------------------------
  // The teasers' swirl, shape only: within a radius of the cursor the blob
  // twists about it by up to u_twist — full strength under the cursor,
  // smoothstepped to nothing at the radius. Applied after projection, so it
  // bends the shape as seen, exactly as it bends the flat teaser planes. The
  // teasers' colour split is deliberately left out here.
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(q * 0.5, 1.0);
  vec2 sp = (clip.xy / clip.w * 0.5 + 0.5) * u_res;
  if (u_mstr > 0.001) {
    vec2 d = sp - u_mouse;
    float dist = length(d);
    float f = 1.0 - dist / u_radius;
    if (f > 0.0) {
      f = f * f * (3.0 - 2.0 * f) * u_mstr;
      float ang = u_twist * f;
      float cs = cos(ang), sn = sin(ang);
      sp = u_mouse + vec2(d.x * cs - d.y * sn, d.x * sn + d.y * cs);
    }
  }
  clip.xy = (sp / u_res * 2.0 - 1.0) * clip.w;
  gl_Position = clip;
}
`;

/**
 * The reel, as is. No colour conversion: the video texture is sampled as
 * stored and written out unchanged, so the picture is exact.
 */
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_map;
// Share of the picture each face shows, per axis: a centred square of it, so
// a wide reel isn't squashed onto the square faces.
uniform vec2 u_crop;
varying vec2 vUv;
varying float vDisp;

void main() {
  // The picture slides with the swell underneath it, so the reel reads as
  // painted on the goo rather than projected onto a rigid box.
  vec2 uv = vUv + vec2(vDisp * 0.07, -vDisp * 0.055);
  uv = 0.5 + (uv - 0.5) * u_crop;
  gl_FragColor = vec4(texture2D(u_map, uv).rgb, 1.0);
}
`;

// The shape cycles cube → sphere → blob → cube: HOLD seconds on each, easing
// into the next over the last MORPH_TIME of each hold.
const HOLD = 7;
const MORPH_TIME = 1.6;
const SHAPES = [
  { sphere: 0, goo: 0 }, // inflated cube
  { sphere: 1, goo: 0 }, // sphere
  { sphere: 0.75, goo: 1 }, // distorted blob (on a mostly-rounded base)
];

function shapeAt(t: number) {
  const c = t % (HOLD * SHAPES.length);
  const i = Math.floor(c / HOLD);
  const from = SHAPES[i];
  const to = SHAPES[(i + 1) % SHAPES.length];
  const into = c - i * HOLD - (HOLD - MORPH_TIME);
  if (into <= 0) return from;
  const k = into / MORPH_TIME;
  const e = k * k * (3 - 2 * k); // smoothstep
  return { sphere: from.sphere + (to.sphere - from.sphere) * e, goo: from.goo + (to.goo - from.goo) * e };
}

/** Slow, non-repeating drift — three sines that never line up again. */
function drift(t: number, a: number, b: number, c: number) {
  return Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.2) * 0.1;
}

function Cube({ speaking, texture }: { speaking: boolean; texture: THREE.VideoTexture | null }) {
  const group = useRef<THREE.Group>(null);
  const { viewport, size } = useThree();
  const isTouch = useMemo(detectTouch, []);
  // Pointer target in -1..1 for the follow, the pointer in canvas px (y up)
  // for the teaser effect, and that effect's eased strength.
  const target = useRef(new THREE.Vector2(0, 0));
  const pointer = useRef({ x: 0, y: 0, active: false, strength: 0 });
  const enter = useRef(0); // 0 -> 1 arrival ramp
  // Goo phase. It runs a little faster while the agent is typing, so the blob
  // stirs as it speaks — accumulated rather than scaled, so speeding up never
  // makes the shape jump.
  const phase = useRef(0);
  const speak = useRef(0);

  // The material is built here and owned outright, not declared as a JSX
  // prop: R3F is free to copy a `uniforms` prop onto the material, after which
  // writes to our copy reach nothing — which once rendered this as a silent
  // black cube.
  const { geometry, shared, material } = useMemo(() => {
    // Subdivided so the bulge and goo are smooth: a 6-quad box has no
    // interior vertices to move.
    const geometry = new THREE.BoxGeometry(1, 1, 1, 40, 40, 40);
    const shared = {
      u_map: { value: null as THREE.Texture | null },
      u_crop: { value: new THREE.Vector2(1, 1) },
      u_time: { value: 0 },
      // How far each face centre bows out, in half-widths of the cube.
      u_inflate: { value: 0.32 },
      u_morph: { value: MORPH },
      u_sphere: { value: 0 },
      u_goo: { value: 0 },
      u_res: { value: new THREE.Vector2(1, 1) },
      u_mouse: { value: new THREE.Vector2(0, 0) },
      u_mstr: { value: 0 },
      u_radius: { value: 1 },
      u_twist: { value: MOUSE_TWIST },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: shared,
    });
    return { geometry, shared, material };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  // Pointer: follow target and teaser effect, desktop only. Touch devices
  // fire a single synthetic move on tap, which would jerk the blob to the tap
  // and leave it there.
  useEffect(() => {
    if (isTouch) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      target.current.set(
        (e.clientX / window.innerWidth) * 2 - 1,
        -((e.clientY / window.innerHeight) * 2 - 1)
      );
      pointer.current.x = e.clientX;
      pointer.current.y = window.innerHeight - e.clientY;
      pointer.current.active = true;
    };
    const onLeave = () => {
      pointer.current.active = false;
    };
    window.addEventListener("pointermove", onMove);
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, [isTouch]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    const d = Math.min(delta, 0.05); // a backgrounded tab must not jump

    // Size off the smaller viewport axis so it fills the frame on a phone
    // without overflowing a wide desktop. Kept below the rigid cube's size
    // because the goo swells it by up to half again.
    const base = Math.min(viewport.width, viewport.height) * 0.36;
    enter.current += (1 - enter.current) * d * 1.4;
    const breathe = 1 + Math.sin(t * 0.7) * 0.06 + Math.sin(t * 1.9 + 2.1) * 0.02;
    const scale = base * breathe * (0.6 + 0.4 * enter.current);
    g.scale.setScalar(scale);

    // Rotation: three axes at unrelated rates, so it never repeats a pose.
    g.rotation.x += d * (0.18 + 0.05 * Math.sin(t * 0.31));
    g.rotation.y += d * (0.26 + 0.07 * Math.sin(t * 0.23 + 1.1));
    g.rotation.z += d * 0.045;

    // Travel: pointer target plus its own drift, clamped so the shape can
    // never leave the frame. The extent is the corner radius plus the most
    // the goo can swell it, measured at the shape's *nearest* point: R3F's
    // `viewport` describes z=0, and the near side sits closer to the camera
    // where the visible area is smaller.
    const half = (scale * (Math.sqrt(3) + MORPH)) / 2;
    const cam = state.camera as THREE.PerspectiveCamera;
    const nearDist = Math.max(0.1, cam.position.z - half);
    const halfH = Math.tan((cam.fov * Math.PI) / 360) * nearDist;
    const halfW = halfH * (viewport.width / viewport.height);
    const limitX = Math.max(0, halfW - half);
    const limitY = Math.max(0, halfH - half);
    const wantX = target.current.x * limitX + drift(t, 0.11, 0.27, 0.53) * limitX * 0.25;
    const wantY = target.current.y * limitY + drift(t, 0.09, 0.21, 0.44) * limitY * 0.25;
    g.position.x += (THREE.MathUtils.clamp(wantX, -limitX, limitX) - g.position.x) * d * 1.8;
    g.position.y += (THREE.MathUtils.clamp(wantY, -limitY, limitY) - g.position.y) * d * 1.8;

    speak.current += ((speaking ? 1 : 0) - speak.current) * d * 3;
    phase.current += d * (1 + 0.6 * speak.current);
    shared.u_time.value = phase.current;
    const shape = shapeAt(t);
    shared.u_sphere.value = shape.sphere;
    shared.u_goo.value = shape.goo;
    if (shared.u_map.value !== texture) shared.u_map.value = texture;
    const video = texture?.image as HTMLVideoElement | undefined;
    const va = (video?.videoWidth || 1) / (video?.videoHeight || 1);
    shared.u_crop.value.set(Math.min(1, 1 / va), Math.min(1, va));

    // The teasers' swirl: same radius, twist and easing as the gallery.
    const minDim = Math.min(size.width, size.height);
    const p = pointer.current;
    p.strength += ((!isTouch && p.active ? 1 : 0) - p.strength) * MOUSE_EASE;
    shared.u_res.value.set(size.width, size.height);
    shared.u_mouse.value.set(p.x, p.y);
    shared.u_mstr.value = p.strength;
    shared.u_radius.value = minDim * MOUSE_RADIUS_RATIO;
  });

  return (
    <group ref={group}>
      {/* The shader moves every vertex well past the box's own bounds. */}
      <mesh geometry={geometry} material={material} frustumCulled={false} />
    </group>
  );
}

/**
 * The reel again, as a half skybox: the picture wrapped round the viewer,
 * which the visitor looks around by moving the pointer. The same texture as
 * the shape (one decode feeds both), so the shape reads as a piece of the
 * world behind it, pulled forward.
 *
 * The wrap and the lens are both stereographic — the projection planetarium
 * dome content is made in. Using one projection for both means that looking
 * straight ahead shows the picture flat and undistorted, framed however
 * DOME_FRAME says; turning bends it smoothly (circles stay circles), opening
 * up the side turned toward. An ordinary rectilinear lens can't do this: it
 * can only take in a small window of a dome before its edges smear, which
 * left the first version showing barely a tenth of the reel, hugely
 * magnified.
 *
 * Past the picture's edges the sky carries on as its mirror image, so a turn
 * can never reach a rim. The reel is only 600px square, so a soft-focus blur
 * turns its upscaling into depth of field; the shape in front stays sharp.
 */
// How much of the picture fills the screen at rest, along whichever axis is
// the tighter fit (the screen's long side, for a square reel). Lower shows
// more of the picture, smaller, and leaves less of it to turn toward.
const DOME_FRAME = 0.82;
// How far past the picture's edge a full turn may reach into the mirrored
// sky beyond it, as a share of the picture's half-width. Kept to a sliver:
// the reel is full of type, and mirrored type reads as a mistake.
const DOME_SPILL = 0.03;
// Most the view tilts up or down.
const DOME_PITCH_CAP = THREE.MathUtils.degToRad(30);
// Multiplier on the picture. The backdrop is darker than the shape so the
// shape stays the subject even though they show the same footage.
const DOME_DIM = 0.55;
// Soft focus, there to hide upscaling: its radius in texels of the video is
// DOME_BLUR_PER × how far past 1:1 the picture is enlarged, up to
// DOME_BLUR_MAX. A source with pixels to spare stays sharp; the 600px stand-in
// reel, enlarged about fourfold, gets the full blur.
const DOME_BLUR_PER = 0.7;
const DOME_BLUR_MAX = 2.4;

const DOME_VERT = `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  // A full-screen quad, at the back of the depth range.
  gl_Position = vec4(position.xy, 0.999, 1.0);
}
`;

// Like the shape, the picture is sampled as stored and written out unchanged
// (just dimmed), so the two match exactly.
const DOME_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_map;
uniform float u_dim;
// Half-extent of the screen on the lens's projection plane.
uniform vec2 u_scale;
// Where the view is turned: rotates a view ray into the sky's frame.
uniform mat3 u_look;
// Projection plane to texture: the picture's longer side spans -1..1.
uniform vec2 u_fit;
// Blur radius in texture coordinates, per axis.
uniform vec2 u_blur;
varying vec2 vNdc;

// Mirrored repeat, so the sky past the picture's edges is its reflection.
vec3 tap(vec2 uv) {
  return texture2D(u_map, 1.0 - abs(1.0 - mod(uv, 2.0))).rgb;
}

void main() {
  // Screen point to view ray: the inverse stereographic projection, with
  // straight ahead along -z.
  vec2 q = vNdc * u_scale;
  float r2 = dot(q, q);
  vec3 ray = vec3(2.0 * q, r2 - 1.0) / (1.0 + r2);
  ray = u_look * ray;
  // Ray to the picture: the stereographic projection again, in the sky's
  // frame. Unturned, this undoes the line above exactly.
  vec2 p = ray.xy / (1.0 - ray.z);
  vec2 uv = 0.5 + 0.5 * p * u_fit;

  // Soft focus: a disc of taps on a golden-angle spiral, which covers the
  // disc evenly without the ringing a regular grid of taps leaves.
  vec3 sum = tap(uv);
  float a = 0.0;
  for (int i = 1; i <= 12; i++) {
    a += 2.39996;
    float r = sqrt(float(i) / 12.0);
    sum += tap(uv + vec2(cos(a), sin(a)) * r * u_blur);
  }
  gl_FragColor = vec4(sum / 13.0 * u_dim, 1.0);
}
`;

// Points around the screen's border (in -1..1), checked to keep a turn from
// carrying any of the frame past the picture: corners, edge midpoints and the
// quarter points between them.
const DOME_EDGE = [-1, -0.5, 0, 0.5, 1].flatMap((a) => [
  [a, -1],
  [a, 1],
  [-1, a],
  [1, a],
]);

/**
 * How far out the screen's border lands on the picture for a given turn, as
 * a multiple of the picture's half-extent (1 = exactly at its edge). The same
 * maths as the shader, on the CPU, for a handful of points.
 */
function domeReach(
  yaw: number,
  pitch: number,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  m: THREE.Matrix4,
  mb: THREE.Matrix4,
  v: THREE.Vector3
) {
  m.makeRotationY(yaw).multiply(mb.makeRotationX(pitch));
  let worst = 0;
  for (const [nx, ny] of DOME_EDGE) {
    const qx = nx * sx;
    const qy = ny * sy;
    const r2 = qx * qx + qy * qy;
    v.set(2 * qx, 2 * qy, r2 - 1).divideScalar(1 + r2).applyMatrix4(m);
    const w = Math.max(1e-6, 1 - v.z);
    worst = Math.max(worst, Math.abs(v.x / w) / ex, Math.abs(v.y / w) / ey);
  }
  return worst;
}

function Dome({ texture }: { texture: THREE.VideoTexture | null }) {
  const { size } = useThree();
  const isTouch = useMemo(detectTouch, []);
  const target = useRef({ x: 0, y: 0 }); // pointer, -1..1, y up
  const look = useRef({ yaw: 0, pitch: 0 });

  const { geometry, material, uniforms, m4, m4b, v3 } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
      u_map: { value: null as THREE.Texture | null },
      u_dim: { value: DOME_DIM },
      u_scale: { value: new THREE.Vector2(1, 1) },
      u_look: { value: new THREE.Matrix3() },
      u_fit: { value: new THREE.Vector2(1, 1) },
      u_blur: { value: new THREE.Vector2(0, 0) },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms,
      // Always behind: drawn first, and never occluding the shape.
      depthWrite: false,
      depthTest: false,
    });
    return {
      geometry,
      material,
      uniforms,
      m4: new THREE.Matrix4(),
      m4b: new THREE.Matrix4(),
      v3: new THREE.Vector3(),
    };
  }, []);

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material]
  );

  // Desktop: the pointer turns the sky. Touch has no hover to read, so the
  // sky drifts on its own instead (see the frame loop).
  useEffect(() => {
    if (isTouch) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      target.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      target.current.y = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [isTouch]);

  useFrame((state, delta) => {
    // The picture's extent on the projection plane: its longer side spans
    // -1..1, the shorter side in proportion.
    const video = texture?.image as HTMLVideoElement | undefined;
    const va = (video?.videoWidth || 1) / (video?.videoHeight || 1);
    const ex = va >= 1 ? 1 : va;
    const ey = va >= 1 ? 1 / va : 1;

    // Frame the screen inside the picture: the screen's half-extents on the
    // plane, k·(aspect, 1), at DOME_FRAME of the tightest fit.
    const aspect = size.width / size.height;
    const k = DOME_FRAME * Math.min(ex / aspect, ey);
    const sx = k * aspect;
    const sy = k;

    // How far the view may turn straight sideways or straight up: until the
    // screen's edge, which sits 2·atan(s) off-centre, reaches the picture's
    // edge (plus the allowed spill into its mirror image) at 2·atan(e).
    const yawMax = Math.max(0, 2 * Math.atan(ex * (1 + DOME_SPILL)) - 2 * Math.atan(sx));
    const pitchMax = Math.min(
      DOME_PITCH_CAP,
      Math.max(0, 2 * Math.atan(ey * (1 + DOME_SPILL)) - 2 * Math.atan(sy))
    );

    const t = state.clock.elapsedTime;
    const d = Math.min(delta, 0.05);
    const tx = isTouch ? drift(t, 0.05, 0.13, 0.31) * 0.7 : target.current.x;
    const ty = isTouch ? drift(t, 0.04, 0.11, 0.27) * 0.5 : target.current.y;
    const kk = 1 - Math.exp(-d * 2.2);
    const L = look.current;
    // Look toward the pointer: right turns the view right, up tilts it up.
    let wantYaw = -tx * yawMax;
    let wantPitch = ty * pitchMax;
    // Turning both ways at once swings the screen's corners out further than
    // either turn alone, which carried mirrored footage into view. Pull a
    // diagonal turn back along its own direction until the frame fits again,
    // so straight turns keep their full range.
    const limit = 1 + DOME_SPILL;
    if (domeReach(wantYaw, wantPitch, sx, sy, ex, ey, m4, m4b, v3) > limit) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (domeReach(wantYaw * mid, wantPitch * mid, sx, sy, ex, ey, m4, m4b, v3) > limit) hi = mid;
        else lo = mid;
      }
      wantYaw *= lo;
      wantPitch *= lo;
    }
    L.yaw += (wantYaw - L.yaw) * kk;
    L.pitch += (wantPitch - L.pitch) * kk;
    // A view ray is tilted, then turned: Ry(yaw)·Rx(pitch).
    m4.makeRotationY(L.yaw).multiply(m4b.makeRotationX(L.pitch));
    uniforms.u_look.value.setFromMatrix4(m4);
    uniforms.u_scale.value.set(sx, sy);
    uniforms.u_fit.value.set(1 / ex, 1 / ey);
    // Enlargement at the centre of the screen: device pixels per video pixel.
    // The picture's half-width (ex on the plane) is vw/2 video pixels; the
    // screen's (sx) is width·dpr/2 device pixels.
    const vw = video?.videoWidth || 1;
    const vh = video?.videoHeight || 1;
    const mag = (size.width * state.viewport.dpr * ex) / (sx * vw);
    const blur = Math.min(DOME_BLUR_MAX, Math.max(0, (mag - 1) * DOME_BLUR_PER));
    uniforms.u_blur.value.set(blur / vw, blur / vh);
    if (uniforms.u_map.value !== texture) uniforms.u_map.value = texture;
  });

  return (
    <mesh geometry={geometry} material={material} renderOrder={-1} frustumCulled={false} />
  );
}

/**
 * The landing's backdrop: a gooey, always-shifting mass of the sizzle reel,
 * turning behind the copy until a portfolio is chosen, in front of the same
 * reel wrapped round a half-dome (see Dome). Full-bleed — it owns the
 * viewport rather than sitting in a box, which is what the blob it replaced
 * did. On desktop the cursor swirls the shape, as it does the gallery
 * teasers, and turns the dome.
 */
function IntroCube({
  speaking,
  visible,
}: {
  /** True while the agent is typing — stirs the goo a little faster. */
  speaking: boolean;
  /** False once the intro is dismissed; tears the stream down. */
  visible: boolean;
}) {
  const texture = useReelTexture(visible);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0"
      style={{
        opacity: texture ? 1 : 0,
        transition: "opacity 1.1s ease 120ms",
      }}
    >
      <Canvas
        // Deliberately not the device ratio: this is a heavily distorted
        // background, and detail that fine is destroyed by the effect itself.
        dpr={[1, 1.5]}
        camera={{ fov: 45, position: [0, 0, 6] }}
        // Opaque black to match the page behind it.
        gl={{ alpha: false, antialias: false }}
        style={{ position: "absolute", inset: 0 }}
      >
        <color attach="background" args={["#000000"]} />
        <Dome texture={texture} />
        <Cube speaking={speaking} texture={texture} />
      </Canvas>
    </div>
  );
}

// Memoised because the landing re-renders on every frame the typewriter
// advances, and without this each of those renders reconciled the whole 3D
// scene again — sixty times a second, for props that change a handful of times
// per visit.
export default memo(IntroCube);
