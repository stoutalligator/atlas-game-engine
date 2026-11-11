/**
 * Outlier's 8-bit sky objects. Each landmark is drawn once as a small pixel
 * grid (planets with dithered shading, banded and ringed giants, sparkling
 * stars, spiral galaxies, nebula clouds, the asteroid belt, Voyager) into an
 * offscreen canvas, then blitted with smoothing off at whole-number scales so
 * every pixel stays crisp.
 */
import type { Landmark } from "./journey.js";

type RGB = [number, number, number];

const hex = (h: string): RGB => {
  const n = Number.parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [6, 8, 22];

/** Four shades, light to dark, for a base colour. */
const ramp = (c: RGB): RGB[] => [mix(c, WHITE, 0.45), c, mix(c, BLACK, 0.35), mix(c, BLACK, 0.68)];

/** 4×4 Bayer matrix for ordered dithering (values 0–1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

/** Small deterministic hash noise in 0–1. */
const hash = (x: number, y: number, seed: number) => {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
};

class Grid {
  readonly px: Array<RGB | null>;
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.px = new Array(w * h).fill(null);
  }
  set(x: number, y: number, c: RGB) {
    if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y * this.w + x] = c;
  }
  get(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.px[y * this.w + x] : null;
  }
  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = this.w;
    cv.height = this.h;
    const ctx = cv.getContext("2d") as CanvasRenderingContext2D;
    const img = ctx.createImageData(this.w, this.h);
    this.px.forEach((c, i) => {
      if (!c) return;
      img.data.set([c[0], c[1], c[2], 255], i * 4);
    });
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

/** A shaded sphere lit from the upper left; `tint` lets features recolour a pixel. */
function sphere(
  g: Grid,
  cx: number,
  cy: number,
  r: number,
  base: RGB,
  tint?: (x: number, y: number, nx: number, ny: number) => RGB | null,
) {
  const L = [-0.55, -0.6, 0.58];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const nx = (x + 0.5 - cx) / r;
      const ny = (y + 0.5 - cy) / r;
      const d = nx * nx + ny * ny;
      if (d > 1) continue;
      const nz = Math.sqrt(1 - d);
      const light = nx * L[0] + ny * L[1] + nz * L[2]; // −1..1
      const v = Math.max(0, Math.min(0.999, (light + 0.35) / 1.25));
      const shades = ramp(tint?.(x, y, nx, ny) ?? base);
      // 4 bands, dithered at the boundaries
      const level = Math.min(3, Math.floor((1 - v) * 3 + dither(x, y) * 0.9));
      g.set(x, y, shades[level]);
    }
}

function moon(c: RGB) {
  const g = new Grid(14, 14);
  sphere(g, 7, 7, 6.6, c, (x, y) => {
    const crater =
      Math.hypot(x - 5, y - 5) < 1.6 ||
      Math.hypot(x - 9, y - 8) < 1.3 ||
      Math.hypot(x - 6, y - 10) < 1;
    return crater ? mix(c, BLACK, 0.3) : null;
  });
  return g;
}

function rockyPlanet(c: RGB, seed: number) {
  const g = new Grid(14, 14);
  sphere(g, 7, 7, 6.6, c, (x, y) =>
    hash(x >> 1, y >> 1, seed) > 0.72 ? mix(c, BLACK, 0.25) : null,
  );
  return g;
}

function bandedPlanet(c: RGB, size: number, bands: number) {
  const g = new Grid(size, size);
  const r = size / 2 - 0.4;
  sphere(g, size / 2, size / 2, r, c, (_x, _y, _nx, ny) => {
    const b = Math.sin(ny * Math.PI * bands);
    return b > 0.45 ? mix(c, WHITE, 0.22) : b < -0.55 ? mix(c, [150, 80, 40], 0.35) : null;
  });
  // the Great Red Spot, for Jupiter-sized planets
  if (size >= 16)
    for (const [x, y] of [
      [10, 10],
      [11, 10],
      [10, 11],
      [11, 11],
      [12, 10],
    ])
      g.set(x, y, [196, 98, 64]);
  return g;
}

function ringedPlanet(c: RGB) {
  const g = new Grid(26, 16);
  const ring = mix(c, WHITE, 0.15);
  const ringDark = mix(c, BLACK, 0.3);
  const onRing = (x: number, y: number) => {
    const dx = (x + 0.5 - 13) / 12.5;
    const dy = (y + 0.5 - 8) / 3.2;
    const e = dx * dx + dy * dy;
    return e <= 1 && e >= 0.55;
  };
  // back of the ring, then the planet, then the front of the ring
  for (let y = 0; y < 8; y++) for (let x = 0; x < 26; x++) if (onRing(x, y)) g.set(x, y, ringDark);
  sphere(g, 13, 8, 6.4, c, (_x, _y, _nx, ny) =>
    Math.sin(ny * Math.PI * 3) > 0.5 ? mix(c, WHITE, 0.18) : null,
  );
  for (let y = 8; y < 16; y++) for (let x = 0; x < 26; x++) if (onRing(x, y)) g.set(x, y, ring);
  return g;
}

function sun(c: RGB) {
  const g = new Grid(19, 19);
  const core = mix(c, WHITE, 0.55);
  for (let y = 0; y < 19; y++)
    for (let x = 0; x < 19; x++) {
      const d = Math.hypot(x + 0.5 - 9.5, y + 0.5 - 9.5);
      if (d < 5.2) g.set(x, y, d < 3 ? core : d + dither(x, y) * 1.4 < 5 ? mix(c, WHITE, 0.2) : c);
    }
  // rays
  for (let i = 0; i < 3; i++) {
    for (const [x, y] of [
      [9, 2 - i + 1],
      [9, 16 + i - 1],
      [2 - i + 1, 9],
      [16 + i - 1, 9],
    ])
      g.set(x, y, c);
  }
  for (const [x, y] of [
    [4, 4],
    [14, 4],
    [4, 14],
    [14, 14],
    [5, 5],
    [13, 5],
    [5, 13],
    [13, 13],
  ])
    g.set(x, y, mix(c, BLACK, 0.1));
  return g;
}

/** A twinkling pixel star: a bright core and a cross of fading rays. */
function sparkle(c: RGB, big: boolean) {
  const n = big ? 13 : 9;
  const g = new Grid(n, n);
  const m = (n - 1) / 2;
  const glow = mix(c, BLACK, 0.35);
  for (let i = 0; i < n; i++) {
    const t = Math.abs(i - m) / m;
    const col = t < 0.25 ? WHITE : t < 0.6 ? c : glow;
    g.set(m, i, col);
    g.set(i, m, col);
  }
  for (const [x, y] of [
    [m - 1, m - 1],
    [m + 1, m - 1],
    [m - 1, m + 1],
    [m + 1, m + 1],
  ])
    g.set(x, y, c);
  if (big)
    for (const [x, y] of [
      [m - 2, m - 2],
      [m + 2, m - 2],
      [m - 2, m + 2],
      [m + 2, m + 2],
    ])
      g.set(x, y, glow);
  return g;
}

function giantStar(c: RGB) {
  const g = new Grid(16, 16);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x + 0.5 - 8, y + 0.5 - 8);
      if (d > 7.2) continue;
      const t = d / 7.2 + (dither(x, y) - 0.5) * 0.25;
      g.set(x, y, t < 0.35 ? mix(c, WHITE, 0.5) : t < 0.7 ? c : mix(c, BLACK, 0.35));
    }
  return g;
}

function galaxy(c: RGB, seed: number) {
  const W = 28;
  const H = 18;
  const g = new Grid(W, H);
  const core = mix(c, WHITE, 0.7);
  const arm = c;
  const dim = mix(c, BLACK, 0.45);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      // undo the tilt: treat the galaxy as a squashed disc
      const dx = (x + 0.5 - W / 2) / (W / 2);
      const dy = (y + 0.5 - H / 2) / (H / 2);
      const r = Math.hypot(dx, dy);
      if (r > 1) continue;
      const th = Math.atan2(dy, dx);
      const spiral = Math.cos(2 * th - 5.5 * Math.log(r + 0.08) + seed);
      const v =
        (1 - r) * 1.1 + Math.max(0, spiral) * 0.55 * (1 - r * 0.6) + (dither(x, y) - 0.5) * 0.3;
      if (v < 0.32) continue;
      g.set(x, y, r < 0.18 ? WHITE : v > 0.95 ? core : v > 0.58 ? arm : dim);
    }
  return g;
}

function nebula(c: RGB, seed: number) {
  const n = 26;
  const g = new Grid(n, n);
  const second: RGB = [125, 140, 255];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - n / 2) / (n / 2);
      const dy = (y + 0.5 - n / 2) / (n / 2);
      const falloff = 1 - Math.hypot(dx, dy);
      if (falloff <= 0) continue;
      const noise =
        hash(x >> 2, y >> 2, seed) * 0.5 +
        hash(x >> 1, y >> 1, seed + 3) * 0.3 +
        hash(x, y, seed + 7) * 0.2;
      const v = falloff * 1.3 + noise * 0.6 - 0.55 + (dither(x, y) - 0.5) * 0.18;
      if (v < 0.12) continue;
      const base = hash(x >> 3, y >> 3, seed + 11) > 0.55 ? second : c;
      g.set(x, y, v > 0.62 ? mix(base, WHITE, 0.4) : v > 0.35 ? base : mix(base, BLACK, 0.45));
    }
  return g;
}

function belt(c: RGB, sparse: boolean) {
  const W = 30;
  const H = 14;
  const g = new Grid(W, H);
  const shades = ramp(c);
  for (let i = 0; i < (sparse ? 26 : 46); i++) {
    const a = hash(i, 1, 9) * Math.PI * 2;
    const rr = 0.62 + hash(i, 2, 9) * 0.38;
    const x = Math.round(W / 2 + Math.cos(a) * rr * (W / 2 - 1));
    const y = Math.round(H / 2 + Math.sin(a) * rr * (H / 2 - 1));
    const big = !sparse && hash(i, 3, 9) > 0.7;
    g.set(x, y, shades[big ? 0 : 1]);
    if (big) {
      g.set(x + 1, y, shades[2]);
      g.set(x, y + 1, shades[2]);
    }
  }
  return g;
}

const VOYAGER = [
  "......aaa......",
  ".....abbba.....",
  "....abbbbba....",
  "....abbbbba....",
  ".....aaaaa.....",
  "c......d......c",
  "ccccccdddcccccc",
  ".......d.......",
  "......d.d......",
  ".....d...d.....",
];
function voyager(c: RGB) {
  const g = new Grid(VOYAGER[0].length, VOYAGER.length);
  const pal: Record<string, RGB> = {
    a: mix(c, BLACK, 0.2),
    b: mix(c, WHITE, 0.4),
    c: mix(c, BLACK, 0.35),
    d: c,
  };
  VOYAGER.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== ".") g.set(x, y, pal[row[x]]);
  });
  return g;
}

function build(l: Landmark): Grid {
  const c = hex(l.color);
  switch (l.id) {
    case "moon":
      return moon(c);
    case "sun":
      return sun(c);
    case "mars":
      return rockyPlanet(c, 3);
    case "jupiter":
      return bandedPlanet(c, 18, 3.5);
    case "saturn":
      return ringedPlanet(c);
    case "neptune":
      return bandedPlanet(c, 14, 2);
    case "belt":
      return belt(c, false);
    case "oort":
      return belt(c, true);
    case "voyager":
      return voyager(c);
    case "betelgeuse":
      return giantStar(c);
    default:
      if (l.kind === "galaxy") return galaxy(c, l.id.length);
      if (l.kind === "nebula") return nebula(c, l.id.length);
      return sparkle(c, l.id === "sirius" || l.id === "polaris");
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/** The landmark's pixel sprite (built once). */
export function spriteFor(l: Landmark): HTMLCanvasElement {
  let cv = cache.get(l.id);
  if (!cv) {
    cv = build(l).toCanvas();
    cache.set(l.id, cv);
  }
  return cv;
}

/**
 * Draws the landmark's sprite centred at (x, y) about `size` px across, at a
 * whole-number scale so pixels stay square. Returns the drawn height.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  l: Landmark,
  x: number,
  y: number,
  size: number,
) {
  const sp = spriteFor(l);
  // At least 2× so the pixels read as chunky 8-bit art even far away.
  const scale = Math.max(2, Math.round(size / Math.max(sp.width, sp.height)));
  const w = sp.width * scale;
  const h = sp.height * scale;
  const smoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sp, Math.round(x - w / 2), Math.round(y - h / 2), w, h);
  ctx.imageSmoothingEnabled = smoothing;
  return h;
}
