/**
 * Repairs a typeface.json whose glyph contours all share one winding
 * direction, which makes three.js render counters (the holes in e, d, o…)
 * as solid blobs. For every glyph: parse the outline into contours, find
 * nesting depth via point-in-polygon, then force even-depth (solid)
 * contours to the dominant solid winding and odd-depth (hole) contours to
 * the opposite.
 *
 * Usage: node scripts/fix-typeface.cjs <in.json> <out.json>
 */
const fs = require("fs");

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node fix-typeface.cjs <in.json> <out.json>");
  process.exit(1);
}

function parseOutline(o) {
  const tokens = o.trim().split(/\s+/);
  const contours = [];
  let cur = null;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === "m") {
      cur = { start: [num(), num()], segs: [] };
      contours.push(cur);
    } else if (cmd === "l") {
      cur.segs.push({ c: "l", p: [num(), num()] });
    } else if (cmd === "q") {
      cur.segs.push({ c: "q", p: [num(), num()], c1: [num(), num()] });
    } else if (cmd === "b") {
      cur.segs.push({ c: "b", p: [num(), num()], c1: [num(), num()], c2: [num(), num()] });
    } else if (cmd === "z") {
      // some converters emit close commands; geometry closes implicitly
    } else if (cmd !== "") {
      throw new Error(`unknown outline command "${cmd}"`);
    }
  }
  return contours;
}

const endpoints = (c) => [c.start, ...c.segs.map((s) => s.p)];

function signedArea(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function pointInPolygon([px, py], pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function reverseContour(c) {
  const pts = endpoints(c);
  const n = c.segs.length;
  const segs = [];
  for (let i = n - 1; i >= 0; i--) {
    const s = c.segs[i];
    const target = pts[i];
    if (s.c === "l") segs.push({ c: "l", p: target });
    else if (s.c === "q") segs.push({ c: "q", p: target, c1: s.c1 });
    else segs.push({ c: "b", p: target, c1: s.c2, c2: s.c1 });
  }
  return { start: pts[n], segs };
}

function serialize(contours) {
  const out = [];
  const f = (v) => String(Math.round(v * 100) / 100);
  for (const c of contours) {
    out.push("m", f(c.start[0]), f(c.start[1]));
    for (const s of c.segs) {
      if (s.c === "l") out.push("l", f(s.p[0]), f(s.p[1]));
      else if (s.c === "q") out.push("q", f(s.p[0]), f(s.p[1]), f(s.c1[0]), f(s.c1[1]));
      else out.push("b", f(s.p[0]), f(s.p[1]), f(s.c1[0]), f(s.c1[1]), f(s.c2[0]), f(s.c2[1]));
    }
  }
  return out.join(" ");
}

const font = JSON.parse(fs.readFileSync(inPath, "utf8"));
let glyphsFixed = 0;
let contoursReversed = 0;

for (const [name, glyph] of Object.entries(font.glyphs)) {
  if (!glyph.o || !glyph.o.trim()) continue;
  let contours;
  try {
    contours = parseOutline(glyph.o);
  } catch (err) {
    console.warn(`skipping glyph ${JSON.stringify(name)}: ${err.message}`);
    continue;
  }
  if (contours.length === 0) continue;

  const polys = contours.map(endpoints);
  // Nesting depth: how many other contours enclose this contour's first
  // vertex. Even depth = solid, odd depth = hole.
  const depths = contours.map((c, i) => {
    let depth = 0;
    for (let j = 0; j < contours.length; j++) {
      if (j !== i && pointInPolygon(polys[i][0], polys[j])) depth++;
    }
    return depth;
  });

  // three.js's stock typeface fonts (helvetiker et al.) wind solids
  // clockwise (negative signed area) and holes counter-clockwise. Enforce
  // that absolute convention — relative-only normalization isn't enough,
  // since a globally inverted font makes three.js treat counters as the
  // solid shape and drop the outer contour.
  const SOLID_SIGN = -1;

  let changed = false;
  const fixed = contours.map((c, i) => {
    const sign = Math.sign(signedArea(polys[i])) || SOLID_SIGN;
    const wantSign = depths[i] % 2 === 0 ? SOLID_SIGN : -SOLID_SIGN;
    if (sign !== wantSign) {
      changed = true;
      contoursReversed++;
      return reverseContour(c);
    }
    return c;
  });

  if (changed) {
    glyph.o = serialize(fixed);
    glyphsFixed++;
  }
}

fs.writeFileSync(outPath, JSON.stringify(font));
console.log(`fixed ${glyphsFixed} glyphs (${contoursReversed} contours reversed) -> ${outPath}`);
