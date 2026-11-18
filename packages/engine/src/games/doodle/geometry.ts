// Pure geometry for Doodle: lengths, resampling, simplifying, cutting a
// source by a mask, clipping and erasing strokes. No DOM, no React: the
// browser, the server and the content scripts all share it.

import type { DoodlePath, DoodlePoint, DoodleRect } from "./types.js";

const dist = (a: DoodlePoint, b: DoodlePoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function pathLength(path: DoodlePath): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  return total;
}

export const totalLength = (paths: readonly DoodlePath[]) =>
  paths.reduce((sum, p) => sum + pathLength(p), 0);

export const isClosed = (path: DoodlePath) =>
  path.length > 2 && dist(path[0], path[path.length - 1]) < 0.5;

/** Inserts points so no segment is longer than `step` (keeps every original point). */
export function densify(path: DoodlePath, step: number): DoodlePath {
  if (path.length < 2) return path.map((p) => [p[0], p[1]] as DoodlePoint);
  const out: DoodlePath = [[path[0][0], path[0][1]]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification (keeps the endpoints). */
export function simplify(path: DoodlePath, epsilon: number): DoodlePath {
  if (path.length < 3) return path.slice();
  const keep = new Uint8Array(path.length);
  keep[0] = 1;
  keep[path.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, path.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop() as [number, number];
    const a = path[s];
    const b = path[e];
    const len = dist(a, b);
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const p = path[i];
      const d =
        len === 0
          ? dist(p, a)
          : Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / len;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > epsilon && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return path.filter((_, i) => keep[i]);
}

/** Rounds to `decimals` places (1 by default) so stored geometry stays small. */
export function roundPath(path: DoodlePath, decimals = 1): DoodlePath {
  const f = 10 ** decimals;
  return path.map(([x, y]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
}

export function inRect(p: DoodlePoint, r: DoodleRect): boolean {
  return p[0] >= r.x && p[0] <= r.x + r.w && p[1] >= r.y && p[1] <= r.y + r.h;
}

export const inRects = (p: DoodlePoint, rects: readonly DoodleRect[]) =>
  rects.some((r) => inRect(p, r));

/** Bounding box of some paths (null when empty). */
export function bounds(paths: readonly DoodlePath[]): DoodleRect | null {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const p of paths)
    for (const [x, y] of p) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return x0 === Number.POSITIVE_INFINITY ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Clamps rects to the canvas and drops empty ones. */
export function clampRects(rects: readonly DoodleRect[], width: number, height: number) {
  return rects
    .map((r) => {
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      return {
        x,
        y,
        w: Math.min(width, r.x + r.w) - x,
        h: Math.min(height, r.y + r.h) - y,
      };
    })
    .filter((r) => r.w > 0 && r.h > 0);
}

/**
 * Splits a polyline into runs where `keep` is true. Densified at `step` so
 * runs end close to the boundary. Closed paths join a run that wraps past the
 * start, so an outline cut in two gives two pieces, not three.
 */
export function splitRuns(
  path: DoodlePath,
  keep: (p: DoodlePoint) => boolean,
  step = 2,
): DoodlePath[] {
  const pts = densify(path, step);
  const runs: DoodlePath[] = [];
  let cur: DoodlePath | null = null;
  for (const p of pts) {
    if (keep(p)) {
      if (!cur) {
        cur = [];
        runs.push(cur);
      }
      cur.push(p);
    } else cur = null;
  }
  if (isClosed(path) && runs.length > 1 && keep(pts[0]) && keep(pts[pts.length - 1])) {
    const last = runs.pop() as DoodlePath;
    runs[0] = [...last, ...runs[0].slice(1)];
  }
  return runs.filter((r) => r.length > 1);
}

export interface Cut {
  visible: DoodlePath[];
  missing: DoodlePath[];
  /** Visible length ÷ total length. */
  visibility: number;
}

/** Cuts a source's paths by the mask: what shows, and what the player must draw. */
export function cutPaths(paths: readonly DoodlePath[], rects: readonly DoodleRect[]): Cut {
  const visible: DoodlePath[] = [];
  const missing: DoodlePath[] = [];
  for (const path of paths) {
    visible.push(...splitRuns(path, (p) => !inRects(p, rects)));
    missing.push(...splitRuns(path, (p) => inRects(p, rects)));
  }
  const total = totalLength(paths);
  return { visible, missing, visibility: total > 0 ? totalLength(visible) / total : 0 };
}

/** Keeps only the parts of strokes inside the drawing region (and the canvas). */
export function clipStrokes(
  strokes: readonly DoodlePath[],
  region: readonly DoodleRect[],
  step = 2,
): DoodlePath[] {
  return strokes.flatMap((s) =>
    s.length === 1
      ? inRects(s[0], region)
        ? [[s[0], s[0]] as DoodlePath]
        : []
      : splitRuns(s, (p) => inRects(p, region), step),
  );
}

/** Distance from p to segment ab. */
export function segmentDistance(p: DoodlePoint, a: DoodlePoint, b: DoodlePoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * The eraser: removes every part of the player's strokes within `radius` of
 * the eraser's path, splitting strokes where it passes through. It only ever
 * sees the player's strokes, so the puzzle itself can't be erased.
 */
export function eraseStrokes(
  strokes: readonly DoodlePath[],
  eraser: DoodlePath,
  radius: number,
): DoodlePath[] {
  if (eraser.length === 0) return strokes.slice();
  const segs: Array<[DoodlePoint, DoodlePoint]> =
    eraser.length === 1
      ? [[eraser[0], eraser[0]]]
      : eraser.slice(1).map((p, i) => [eraser[i], p] as [DoodlePoint, DoodlePoint]);
  const box = bounds([eraser]) as DoodleRect;
  const near = (p: DoodlePoint) =>
    p[0] >= box.x - radius &&
    p[0] <= box.x + box.w + radius &&
    p[1] >= box.y - radius &&
    p[1] <= box.y + box.h + radius &&
    segs.some(([a, b]) => segmentDistance(p, a, b) <= radius);
  const out: DoodlePath[] = [];
  for (const s of strokes) {
    if (!s.some(near)) {
      out.push(s);
      continue;
    }
    const pieces = splitRuns(s, (p) => !near(p), 1.5);
    // splitRuns joins wrapped runs for closed paths; strokes are treated as open.
    out.push(...pieces);
  }
  return out;
}

/** Total absolute turning (radians) along a path, ignoring tiny segments. */
export function turning(path: DoodlePath, minSeg = 6): number {
  const pts = simplify(path, 1.5).filter(
    (p, i, arr) => i === 0 || dist(arr[i - 1], p) >= minSeg || i === arr.length - 1,
  );
  let total = 0;
  for (let i = 2; i < pts.length; i++) {
    const a1 = Math.atan2(pts[i - 1][1] - pts[i - 2][1], pts[i - 1][0] - pts[i - 2][0]);
    const a2 = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
    let d = Math.abs(a2 - a1);
    if (d > Math.PI) d = 2 * Math.PI - d;
    total += d;
  }
  return total;
}

/** Area of a union of rects, measured on a coarse grid (good enough for comparisons). */
export function unionArea(rects: readonly DoodleRect[], width: number, height: number, cell = 10) {
  let n = 0;
  for (let y = cell / 2; y < height; y += cell)
    for (let x = cell / 2; x < width; x += cell) if (inRects([x, y], rects)) n++;
  return n * cell * cell;
}

/** Intersection-over-union of two masks (rect unions). */
export function maskIoU(
  a: readonly DoodleRect[],
  b: readonly DoodleRect[],
  width: number,
  height: number,
  cell = 10,
): number {
  let inter = 0;
  let uni = 0;
  for (let y = cell / 2; y < height; y += cell)
    for (let x = cell / 2; x < width; x += cell) {
      const ia = inRects([x, y], a);
      const ib = inRects([x, y], b);
      if (ia && ib) inter++;
      if (ia || ib) uni++;
    }
  return uni === 0 ? 0 : inter / uni;
}

/** Endpoints of a path. */
export const ends = (p: DoodlePath): DoodlePoint[] => [p[0], p[p.length - 1]];
export { dist as pointDistance };
