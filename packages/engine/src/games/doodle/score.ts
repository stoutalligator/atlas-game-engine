// Doodle scoring. Only two things count: whether the ink is in the right
// place, and whether it covers the whole missing part. Speed, stroke count,
// smoothness and undo are never looked at.
//
// 1. Both the answer and the player's strokes are rasterized onto the same
//    grid (canvas units, so a phone and a desktop drawing score the same).
// 2. A distance transform gives every cell its distance to the nearest
//    answer cell (and, separately, to the nearest ink cell).
// 3. Precision = average credit of the player's ink cells by their distance
//    to the answer; coverage = average credit of the answer's cells by their
//    distance to the ink. Credit is 1 within TOLERANCE and fades to 0 at
//    FALLOFF, so a finger-drawn line isn't punished for wobble.
// 4. Score = harmonic mean (F1) of the two, as a whole percent. A tiny
//    correct dash has great precision but no coverage; scribbling over the
//    whole region has coverage but no precision. Both score low.
//
// Difficulty never changes the tolerance: a hard puzzle shows less, it isn't
// marked more strictly.

import { clipStrokes, densify } from "./geometry.js";
import type { DoodlePath, DoodleRect } from "./types.js";

/** Grid cell in canvas units (canvas is 1000 wide → 250 cells). */
export const DOODLE_CELL = 4;
/** Full credit within this distance (units) of the line: 2% of the width (tuned in doodle.test.ts). */
export const DOODLE_TOLERANCE = 20;
/** No credit beyond this distance. */
export const DOODLE_FALLOFF = 55;
/** Limits on what a submission may contain. */
export const DOODLE_MAX_STROKES = 300;
export const DOODLE_MAX_POINTS = 8000;

export interface DoodleScore {
  score: number;
  precision: number;
  coverage: number;
}

interface Grid {
  cols: number;
  rows: number;
  cells: Uint8Array;
}

function rasterize(paths: readonly DoodlePath[], width: number, height: number): Grid {
  const cols = Math.ceil(width / DOODLE_CELL) + 1;
  const rows = Math.ceil(height / DOODLE_CELL) + 1;
  const cells = new Uint8Array(cols * rows);
  for (const p of paths)
    for (const [x, y] of densify(p, DOODLE_CELL / 2)) {
      const c = Math.round(x / DOODLE_CELL);
      const r = Math.round(y / DOODLE_CELL);
      if (c >= 0 && c < cols && r >= 0 && r < rows) cells[r * cols + c] = 1;
    }
  return { cols, rows, cells };
}

/** Chamfer (3-4) distance transform: distance in units from every cell to the nearest set cell. */
function distanceField(g: Grid): Float32Array {
  const { cols, rows, cells } = g;
  const INF = 1e9;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = cells[i] ? 0 : INF;
  const A = 1;
  const B = Math.SQRT2;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      let v = d[i];
      if (c > 0) v = Math.min(v, d[i - 1] + A);
      if (r > 0) {
        v = Math.min(v, d[i - cols] + A);
        if (c > 0) v = Math.min(v, d[i - cols - 1] + B);
        if (c < cols - 1) v = Math.min(v, d[i - cols + 1] + B);
      }
      d[i] = v;
    }
  for (let r = rows - 1; r >= 0; r--)
    for (let c = cols - 1; c >= 0; c--) {
      const i = r * cols + c;
      let v = d[i];
      if (c < cols - 1) v = Math.min(v, d[i + 1] + A);
      if (r < rows - 1) {
        v = Math.min(v, d[i + cols] + A);
        if (c < cols - 1) v = Math.min(v, d[i + cols + 1] + B);
        if (c > 0) v = Math.min(v, d[i + cols - 1] + B);
      }
      d[i] = v;
    }
  for (let i = 0; i < d.length; i++) d[i] *= DOODLE_CELL;
  return d;
}

const credit = (d: number) =>
  d <= DOODLE_TOLERANCE
    ? 1
    : d >= DOODLE_FALLOFF
      ? 0
      : 1 - (d - DOODLE_TOLERANCE) / (DOODLE_FALLOFF - DOODLE_TOLERANCE);

function meanCredit(from: Grid, field: Float32Array): number {
  let n = 0;
  let sum = 0;
  for (let i = 0; i < from.cells.length; i++)
    if (from.cells[i]) {
      n++;
      sum += credit(field[i]);
    }
  return n === 0 ? 0 : sum / n;
}

/**
 * Scores strokes against the missing geometry. Strokes are clipped to the
 * drawing region first (the server never trusts the browser's clipping).
 */
export function scoreDoodle(
  reference: readonly DoodlePath[],
  strokes: readonly DoodlePath[],
  region: readonly DoodleRect[],
  width: number,
  height: number,
): DoodleScore {
  const ink = clipStrokes(strokes, region);
  if (ink.length === 0 || reference.length === 0) return { score: 0, precision: 0, coverage: 0 };
  const ref = rasterize(reference, width, height);
  const mine = rasterize(ink, width, height);
  const precision = meanCredit(mine, distanceField(ref));
  const coverage = meanCredit(ref, distanceField(mine));
  const f1 = precision + coverage === 0 ? 0 : (2 * precision * coverage) / (precision + coverage);
  return {
    score: Math.round(f1 * 100),
    precision: Math.round(precision * 1000) / 1000,
    coverage: Math.round(coverage * 1000) / 1000,
  };
}

/** Whether a drawing has any ink inside the region (Submit stays disabled until it does). */
export function hasInk(strokes: readonly DoodlePath[], region: readonly DoodleRect[]): boolean {
  return clipStrokes(strokes, region).length > 0;
}

/**
 * Checks and normalizes submitted strokes: finite numbers on the canvas,
 * within the size limits. Returns null when malformed.
 */
export function parseStrokes(raw: unknown, width: number, height: number): DoodlePath[] | null {
  if (!Array.isArray(raw) || raw.length > DOODLE_MAX_STROKES) return null;
  let points = 0;
  const out: DoodlePath[] = [];
  for (const s of raw) {
    if (!Array.isArray(s) || s.length === 0) return null;
    points += s.length;
    if (points > DOODLE_MAX_POINTS) return null;
    const path: DoodlePath = [];
    for (const p of s) {
      if (!Array.isArray(p) || p.length !== 2) return null;
      const [x, y] = p;
      if (typeof x !== "number" || typeof y !== "number") return null;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      if (x < -1 || y < -1 || x > width + 1 || y > height + 1) return null;
      path.push([x, y]);
    }
    out.push(path);
  }
  return out;
}
