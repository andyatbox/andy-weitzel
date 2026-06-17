"use client";

import { useEffect, useRef } from "react";

// Fullscreen triangle.
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

// Real post-process: samples the rendered gallery (u_scene) and distorts those
// pixels — swirl + domain-warp UV displacement, chromatic aberration, and a
// psychedelic recolor — all ramped by u_intensity (0 = clean scene, 1 = full
// chaos). This warps the actual R3F output, which a CSS blend cannot do.
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_scene;
uniform float u_time;
uniform float u_intensity;
uniform vec2 u_res;

vec3 pal(float t){ return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67))); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){ s += a * noise(p); p = p * 2.02 + 1.7; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float t = u_time;
  float k = u_intensity;
  float aspect = u_res.x / u_res.y;

  // Centered, aspect-corrected coords.
  vec2 p = uv - 0.5;
  p.x *= aspect;

  // Swirl the sampling coordinates around the center.
  float r = length(p);
  float ang = atan(p.y, p.x);
  ang += k * (sin(r * 6.0 - t * 1.5) * 0.7 + t * 0.35);
  vec2 sp = r * vec2(cos(ang), sin(ang));
  sp.x /= aspect;
  vec2 swirlUV = sp + 0.5;

  // Domain-warped displacement field.
  vec2 w = vec2(fbm(p * 3.0 + t * 0.3),
                fbm(p * 3.0 + vec2(4.1, 1.7) - t * 0.25));
  vec2 disp = (w - 0.5) * 0.28 * k;

  vec2 baseUV = mix(uv, swirlUV, k * 0.85) + disp;

  // Chromatic aberration along the displacement direction.
  vec2 ca = disp * 0.7 + normalize(p + 1e-4) * 0.012 * k;
  float rC = texture2D(u_scene, baseUV + ca).r;
  float gC = texture2D(u_scene, baseUV).g;
  float bC = texture2D(u_scene, baseUV - ca).b;
  vec3 scene = vec3(rC, gC, bC);

  // Psychedelic recolor driven by the warp, mixed into the distorted scene.
  float f = fbm(p * 4.0 + 3.0 * w + t * 0.2);
  vec3 psy = pal(f + t * 0.1 + r * 0.5);
  vec3 crazy = mix(scene, scene * psy * 2.0, 0.65);
  crazy += 0.15 * pal(f * 1.3 - t * 0.15);

  vec3 col = mix(scene, crazy, k);          // ramp clean -> crazy
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

/**
 * WebGL post-process distortion of the live R3F gallery. Owns its own canvas
 * and GL context, uploads the gallery's framebuffer as a texture each frame,
 * and renders the warped result on top. Eases an intensity/opacity `strength`
 * toward `active`, so it ramps the distortion in and out, and only runs its
 * frame loop while there's something to show.
 */
export default function PsychedelicFX({
  active,
  source,
}: {
  active: boolean;
  source: HTMLCanvasElement | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<{
    gl: WebGLRenderingContext;
    tex: WebGLTexture;
    u: {
      time: WebGLUniformLocation | null;
      intensity: WebGLUniformLocation | null;
      res: WebGLUniformLocation | null;
    };
  } | null>(null);
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const activeRef = useRef(active);
  activeRef.current = active;
  const runningRef = useRef(false);
  const rafRef = useRef(0);

  // One-time GL setup.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    // Scene texture: NPOT-safe params, flipped to match screen orientation.
    const tex = gl.createTexture()!;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, "u_scene"), 0);

    stateRef.current = {
      gl,
      tex,
      u: {
        time: gl.getUniformLocation(prog, "u_time"),
        intensity: gl.getUniformLocation(prog, "u_intensity"),
        res: gl.getUniformLocation(prog, "u_res"),
      },
    };
    return () => {
      stateRef.current = null;
    };
  }, []);

  // Cancel the loop on unmount only (active toggles let it fade out first).
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Start the frame loop when activated; it self-sustains through the fade-out
  // and stops once fully hidden.
  useEffect(() => {
    if (!active || runningRef.current) return;
    const canvas = canvasRef.current;
    const st = stateRef.current;
    if (!canvas || !st) return;
    runningRef.current = true;
    const { gl, tex, u } = st;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const start = performance.now();
    let strength = 0;

    const loop = (now: number) => {
      const target = activeRef.current ? 1 : 0;
      strength += (target - strength) * 0.07;
      const src = sourceRef.current;

      if (src && strength > 0.002) {
        const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
          gl.viewport(0, 0, w, h);
        }
        gl.bindTexture(gl.TEXTURE_2D, tex);
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        } catch {
          /* source not readable this frame — keep last texture */
        }
        gl.uniform1f(u.time, (now - start) / 1000);
        gl.uniform1f(u.intensity, Math.min(1, strength * 1.15));
        gl.uniform2f(u.res, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        canvas.style.opacity = String(Math.min(1, strength * 1.4));
      } else {
        canvas.style.opacity = "0";
      }

      if (target === 1 || strength > 0.003) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        canvas.style.opacity = "0";
        runningRef.current = false;
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [active]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      style={{ opacity: 0 }}
    />
  );
}
