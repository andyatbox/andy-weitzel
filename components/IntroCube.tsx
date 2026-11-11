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
import { detectTouch } from "@/lib/pointerFx";
// The reel the sky plays. Any proportions work: the wrap takes the whole
// picture. Shared with the "Work Reel" overlay, which shows the same stream
// flat.
import { REEL_EMBED as EMBED } from "@/lib/reel";
// The decode, capped in height, with uploads gated well below the source's
// frame rate. Desktops get up to 1080p, which the sky shows near 1:1; touch
// devices, where both decode and upload cost more, stop at 720p.
const MAX_VIDEO_HEIGHT = 1080;
const MAX_VIDEO_HEIGHT_TOUCH = 720;
const MAX_TEXTURE_FPS = 30;

/**
 * Streams the reel into a VideoTexture for as long as the intro is up.
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

/** Slow, non-repeating drift — three sines that never line up again. */
function drift(t: number, a: number, b: number, c: number) {
  return Math.sin(t * a) * 0.6 + Math.sin(t * b + 1.7) * 0.3 + Math.sin(t * c + 4.2) * 0.1;
}

/**
 * The reel as a half skybox: the picture wrapped round the viewer, which the
 * visitor looks around by moving the pointer. Since the morphing shape that
 * used to hang in front of it was taken out, this is the landing's whole
 * scene.
 *
 * The picture is wrapped stereographically — the projection planetarium dome
 * content is made in. The lens is mixed between that same projection and an
 * ordinary rectilinear one (DOME_BEND): matching the wrap exactly would undo
 * it and show the picture dead flat, which is what this did before, while a
 * rectilinear lens on dome content is what bends it. The two agree at the
 * centre of the screen, so the bend costs nothing there and grows outward.
 * Turning bends it further and smoothly (circles stay circles), opening up
 * the side turned toward.
 *
 * Past the picture's edges the sky carries on as its mirror image, so a turn
 * can never reach a rim. A soft-focus blur turns any upscaling into depth of
 * field, scaled to how far past 1:1 the picture is actually enlarged — so a
 * source with pixels to spare, like the 1080p reel, stays sharp.
 */
// How much of the largest frame the picture allows is used at rest, 0..1.
// One puts the rest view's border exactly on the picture's edge — every pixel
// of the reel that can be shown without the mirrored sky coming into view,
// and no room left to turn. Lower backs off that edge, showing less of the
// picture and buying room to turn toward it.
//
// That maximum is solved for each frame shape rather than fitted to the
// picture's bounding box: the bend pulls the corners in, so the box fit was
// far more conservative than it needed to be, and on a tall screen it left
// a 16:9 reel cropped to a fifth of its width for nothing.
const DOME_FRAME = 0.92;
// How far the lens is bent away from the picture's own projection, 0..1.
// Zero is the flat view the sky used to show at rest, one an ordinary camera
// looking at dome content. Nothing but this makes the sky read as curved: the
// wrap and an identical lens compose to an identity, so no amount of framing
// or zoom could bend it.
const DOME_BEND = 0.8;
// How far the view sways on its own while the agent types, as a share of the
// turn the pointer commands.
const DOME_STIR = 0.14;
// How far past the picture's edge a full turn may reach into the mirrored
// sky beyond it, as a share of the picture's half-width. Kept to a sliver:
// the reel is full of type, and mirrored type reads as a mistake.
const DOME_SPILL = 0.03;
// Most the view tilts up or down.
const DOME_PITCH_CAP = THREE.MathUtils.degToRad(30);
// Multiplier on the picture: the sky is a bed for the copy over it, so it
// reads below the type rather than competing with it.
const DOME_DIM = 0.55;
// Soft focus, there to hide upscaling: its radius in texels of the video is
// DOME_BLUR_PER × how far past 1:1 the picture is enlarged, up to
// DOME_BLUR_MAX. A source with pixels to spare stays sharp; a small one,
// enlarged several times over, gets the full blur.
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

// The picture is sampled as stored and written out unchanged but for the dim,
// so what the sky shows is the reel's own colour.
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
// How far the lens is bent from the picture's own projection (see DOME_BEND).
uniform float u_bend;
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
  // Screen point to view ray, through a lens mixed between two projections,
  // both looking straight ahead along -z and both unit length.
  //
  // The wrap ray is the inverse of the picture's own stereographic
  // projection, so unturned it undoes the wrap exactly and the picture comes
  // out dead flat at any framing. The lens ray is an ordinary rectilinear
  // camera, which is what bends dome content. They agree to first order at the centre of the
  // screen — so the middle of the picture keeps its scale and its sharpness,
  // and the bend grows with the square of the distance out from it, folding
  // the edges away from the viewer.
  vec2 q = vNdc * u_scale;
  float r2 = dot(q, q);
  vec3 wrap = vec3(2.0 * q, r2 - 1.0) / (1.0 + r2);
  vec3 lens = normalize(vec3(2.0 * q, -1.0));
  vec3 ray = normalize(mix(wrap, lens, u_bend));
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
 * The shader's lens, on the CPU: a point on the projection plane to a unit
 * view ray, straight ahead along -z. The two have to agree — the turn limits
 * below are worked out from this, and a lens that reached further than they
 * assumed would carry mirrored footage into the frame.
 */
function domeRay(qx: number, qy: number, out: THREE.Vector3) {
  const r2 = qx * qx + qy * qy;
  const w = 1 + r2;
  const l = Math.sqrt(4 * r2 + 1);
  const b = DOME_BEND;
  return out
    .set(
      (2 * qx) / w + ((2 * qx) / l - (2 * qx) / w) * b,
      (2 * qy) / w + ((2 * qy) / l - (2 * qy) / w) * b,
      (r2 - 1) / w + (-1 / l - (r2 - 1) / w) * b
    )
    .normalize();
}

/** Where a view ray lands on the picture, in half-extents of the wrap. */
function domeHit(v: THREE.Vector3) {
  const w = Math.max(1e-6, 1 - v.z);
  return { x: v.x / w, y: v.y / w };
}

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
    domeRay(nx * sx, ny * sy, v).applyMatrix4(m);
    const hit = domeHit(v);
    worst = Math.max(worst, Math.abs(hit.x) / ex, Math.abs(hit.y) / ey);
  }
  return worst;
}

function Dome({
  speaking,
  texture,
}: {
  speaking: boolean;
  texture: THREE.VideoTexture | null;
}) {
  const { size } = useThree();
  const isTouch = useMemo(detectTouch, []);
  const target = useRef({ x: 0, y: 0 }); // pointer, -1..1, y up
  const look = useRef({ yaw: 0, pitch: 0 });
  // The solved frame size, kept across frames: see the fit in the loop below.
  const fit = useRef({ aspect: 0, ex: 0, ey: 0, k: 0 });
  const speak = useRef(0); // eased 0..1, so the sway starts and stops smoothly

  const { geometry, material, uniforms, m4, m4b, v3 } = useMemo(() => {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const uniforms = {
      u_map: { value: null as THREE.Texture | null },
      u_dim: { value: DOME_DIM },
      u_scale: { value: new THREE.Vector2(1, 1) },
      u_bend: { value: DOME_BEND },
      u_look: { value: new THREE.Matrix3() },
      u_fit: { value: new THREE.Vector2(1, 1) },
      u_blur: { value: new THREE.Vector2(0, 0) },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      uniforms,
      // Always behind: drawn first, and never occluding anything.
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

  // Desktop: the pointer turns the sky. Touch gets no steering at all — see
  // the frame loop for why the drift that used to stand in for a pointer is
  // gone.
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
    // plane are k·(aspect, 1), and k is DOME_FRAME of the largest value whose
    // rest view still lands inside the picture everywhere along its border.
    // Solved through the lens, so the bend's own pull on the corners is part
    // of the answer. Only reshaping the window or swapping the source can
    // change it, so it is kept rather than searched every frame.
    const aspect = size.width / size.height;
    const f = fit.current;
    if (f.aspect !== aspect || f.ex !== ex || f.ey !== ey) {
      let lo = 0;
      let hi = 4;
      for (let i = 0; i < 20; i++) {
        const mid = (lo + hi) / 2;
        if (domeReach(0, 0, mid * aspect, mid, ex, ey, m4, m4b, v3) > 1) hi = mid;
        else lo = mid;
      }
      f.aspect = aspect;
      f.ex = ex;
      f.ey = ey;
      f.k = lo;
    }
    const k = DOME_FRAME * f.k;
    const sx = k * aspect;
    const sy = k;

    // How far the view may turn straight sideways or straight up: until the
    // screen's edge reaches the picture's edge (plus the allowed spill into
    // its mirror image) at 2·atan(e). Where that edge lands is a question for
    // the lens, since the bend pulls it in from the 2·atan(s) a bare
    // stereographic view would put it at — which is why the bend buys a
    // little more room to turn rather than costing it.
    const edgeX = Math.abs(domeHit(domeRay(sx, 0, v3)).x);
    const edgeY = Math.abs(domeHit(domeRay(0, sy, v3)).y);
    const yawMax = Math.max(0, 2 * Math.atan(ex * (1 + DOME_SPILL)) - 2 * Math.atan(edgeX));
    const pitchMax = Math.min(
      DOME_PITCH_CAP,
      Math.max(0, 2 * Math.atan(ey * (1 + DOME_SPILL)) - 2 * Math.atan(edgeY))
    );

    const t = state.clock.elapsedTime;
    const d = Math.min(delta, 0.05);
    // A slow sway while the agent is typing, over whatever is steering the
    // view. With the shape gone the sky is the only thing on the landing that
    // can answer the copy arriving, so it leans about as the words land and
    // settles once they stop.
    speak.current += ((speaking ? 1 : 0) - speak.current) * d * 2;
    const stir = DOME_STIR * speak.current;
    // Touch steers nothing. A slow drift used to stand in for the pointer
    // here, but it is a wander, not a return: it starts away from centre and
    // takes two minutes to come back, so a phone showed the reel parked off
    // to one side with no way to put it straight. The typing sway below is
    // the only thing that moves it there now, and that one settles to dead
    // centre when the words stop.
    const px = isTouch ? 0 : target.current.x;
    const py = isTouch ? 0 : target.current.y;
    const tx = px + drift(t, 0.23, 0.47, 0.71) * stir;
    const ty = py + drift(t, 0.19, 0.39, 0.63) * stir;
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
 * The landing's backdrop: the sizzle reel wrapped round a curved half-dome
 * behind the copy, until a portfolio is chosen (see Dome). Full-bleed — it
 * owns the viewport rather than sitting in a box.
 *
 * A morphing shape of the same footage used to hang in front of it, riding
 * the cursor and swirling under it. That is gone; the cursor now only turns
 * the sky, which is what the bend in the lens is there to make legible.
 */
function IntroCube({
  speaking,
  visible,
}: {
  /** True while the agent is typing — sways the sky a little. */
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
        <Dome speaking={speaking} texture={texture} />
      </Canvas>
    </div>
  );
}

// Memoised because the landing re-renders on every frame the typewriter
// advances, and without this each of those renders reconciled the whole 3D
// scene again — sixty times a second, for props that change a handful of times
// per visit.
export default memo(IntroCube);
