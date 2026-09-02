"use client";

import { useEffect, useRef } from "react";

const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;

/**
 * Soft morphing gradient, drawn as a single fullscreen-triangle fragment
 * shader over a transparent canvas. The centre is lifted toward white so the
 * black caption type sitting on top of it stays readable at full saturation —
 * without that, big text over a saturated gradient is where this design falls
 * apart.
 */
const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_res;
uniform float u_time;
uniform float u_speak;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Three octaves, not five: this runs behind text, not as the subject.
float fbm(vec2 p){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++){ s += a * noise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  // Unstretched for the silhouette, so the blob fills its (wide) box as an
  // ellipse rather than a circle marooned in the middle...
  vec2 p = (uv - 0.5) * 2.0;
  // ...but aspect-corrected for the noise, so the morph doesn't smear.
  float aspect = u_res.x / max(u_res.y, 1.0);
  vec2 n = vec2(p.x * aspect, p.y);

  float k = u_speak;
  // At rest this barely moves; while a line is typing it churns.
  float amp = 0.09 + 0.34 * k;
  float spd = 0.22 + 1.05 * k;
  float t = u_time * spd;

  // Domain warp: the wobble in the outline and the drift in the colour.
  vec2 q = vec2(fbm(n * 1.15 + t * 0.30),
                fbm(n * 1.15 + vec2(3.1, 1.7) - t * 0.26));
  vec2 w = p + (q - 0.5) * amp * 2.0;
  vec2 wn = vec2(w.x * aspect, w.y);

  float r = length(w);
  // A defined core with a soft shoulder, rather than an even haze across the
  // whole box — the latter reads as a smudge, not a blob.
  float mask = smoothstep(0.98, 0.30, r);
  mask = pow(mask, 0.85);

  // Kept high-luminance on purpose: black caption type sits directly on this,
  // so the palette carries its colour in hue and saturation rather than in
  // darkness.
  vec3 blue   = vec3(0.42, 0.62, 0.99);
  vec3 violet = vec3(0.68, 0.48, 0.97);
  vec3 mint   = vec3(0.38, 0.92, 0.78);
  vec3 blush  = vec3(1.00, 0.66, 0.80);

  float f1 = fbm(wn * 1.5 + t * 0.20);
  float f2 = fbm(wn * 2.0 - t * 0.16 + vec2(1.9, 4.4));
  float f3 = fbm(wn * 1.7 + t * 0.18 + vec2(5.2, 1.3));
  vec3 col = mix(blue, violet, smoothstep(0.25, 0.80, f1));
  col = mix(col, mint,  smoothstep(0.38, 0.92, f2));
  col = mix(col, blush, smoothstep(0.46, 0.98, f3));

  // Lift only the very middle toward white so the densest run of type has a
  // quiet bed; the colour still reaches most of the shape.
  col = mix(col, vec3(1.0), smoothstep(0.55, 0.0, r) * 0.34);

  gl_FragColor = vec4(col, mask);
}
`;

// The blob is decoration behind copy, so it is deliberately cheap: capped
// resolution, capped frame rate, and stopped whenever it isn't on screen.
const MAX_DPR = 1.5;
const FRAME_MS = 1000 / 30;
const SPEAK_EASE = 0.06;

export default function AgentBlob({
  speaking,
  className,
  style,
}: {
  /** True while a line is typing — drives the morph from idle to animated. */
  speaking: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error("AgentBlob shader:", gl.getShaderInfoLog(s));
      }
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error("AgentBlob link:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uSpeak = gl.getUniformLocation(prog, "u_speak");

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const start = performance.now();
    let raf = 0;
    let last = 0;
    let speak = 0;
    let alive = true;

    const loop = (now: number) => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      if (document.hidden) return;

      speak += ((speakingRef.current ? 1 : 0) - speak) * SPEAK_EASE;

      const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
      gl.uniform1f(uTime, (now - start) / 1000);
      gl.uniform1f(uSpeak, speak);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      // Deliberately not forcing a context loss here. StrictMode runs effects
      // twice in dev (mount, cleanup, mount) and `getContext` hands back the
      // *same* context object once it's lost — so releasing it here left the
      // second mount compiling against a dead context, with every shader
      // failing and a null info log. The context goes with the canvas anyway.
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className={className}
      style={style}
    />
  );
}
