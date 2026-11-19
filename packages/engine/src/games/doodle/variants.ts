// Variant generation and automatic validation. A variant is only a mask over
// its source (rectangles hiding part of it); the geometry is never copied.
//
// Generation tries several cut strategies (sides, middle bands, corners for
// shapes and lines; the end or a middle stretch for trends), each tuned by
// binary search to a target visibility per difficulty, validates every
// candidate, and keeps up to a few strong, distinct ones. Nothing here goes
// live on its own: candidates land in the review queue as drafts.

import { seededRng, shuffle } from "../../core/rng.js";
import {
  bounds,
  clampRects,
  cutPaths,
  ends,
  inRects,
  isClosed,
  maskIoU,
  pathLength,
  pointDistance,
  segmentDistance,
  simplify,
  splitRuns,
  totalLength,
  turning,
  unionArea,
} from "./geometry.js";
import type {
  DoodleDifficulty,
  DoodleMask,
  DoodlePath,
  DoodleRect,
  DoodleSource,
  DoodleVariant,
  DoodleVariantMetrics,
} from "./types.js";
import { DOODLE_DIFFICULTIES, DOODLE_TYPES, DOODLE_WIDTH } from "./types.js";

/** Hard rule: 20% ≤ visible ≤ 50%. */
export const DOODLE_MIN_VISIBILITY = 0.2;
export const DOODLE_MAX_VISIBILITY = 0.5;

/** Visibility band and generation target per difficulty. */
export const DOODLE_BANDS: Record<DoodleDifficulty, { min: number; max: number; target: number }> =
  {
    easy: { min: 0.4, max: 0.5, target: 0.46 },
    medium: { min: 0.3, max: 0.4, target: 0.35 },
    hard: { min: 0.2, max: 0.3, target: 0.25 },
  };

/** Validation thresholds (tuned against the starter bank; see the tests). */
export const DOODLE_LIMITS = {
  /** Smallest side of the drawing region, in units (~4.5 cm on a phone at 1000 → 360 px). */
  minRegionSide: 120,
  /** Smallest drawing region, as a share of the canvas. */
  minRegionShare: 0.08,
  /** Most separate missing pieces. */
  maxMissingRuns: 4,
  /** Shortest missing piece (shorter = a sliver nobody can reproduce). */
  minMissingRun: 25,
  /** Shortest visible fragment (shorter = meaningless crumbs). */
  minVisibleRun: 40,
  /** Turning per 100 units of missing geometry above which it's too detailed to draw. */
  maxDetail: 3.2,
  /** Detail at which a cut counts one level harder than its visibility says. */
  hardDetail: 2.0,
  /** Two variants of a source whose masks overlap more than this are too similar. */
  maxMaskOverlap: 0.6,
  /** Most points in a source (more = unnecessary complexity; simplify first). */
  maxSourcePoints: 900,
  /** How close a missing piece's end must be to visible geometry to count as anchored. */
  anchorDistance: 4,
  /** Most variants kept per source. */
  maxVariantsPerSource: 3,
  /** Charts: the hidden stretch must stray at least this far (units) from a straight line. */
  minTrendBend: 50,
  /** Outlines and lines: some hidden piece, simplified at this tolerance (units), must be more than three straight edges. */
  cornerTolerance: 12,
} as const;

/** Margin (units) the mask extends past the source, so the region has room around the answer. */
const PAD = 45;

type Strategy = (b: DoodleRect, t: number, height: number) => DoodleRect[];

const span = (b: DoodleRect, height: number) => ({
  y0: Math.max(0, b.y - PAD),
  y1: Math.min(height, b.y + b.h + PAD),
  x0: Math.max(0, b.x - PAD),
  x1: Math.min(DOODLE_WIDTH, b.x + b.w + PAD),
});

const rect = (x0: number, y0: number, x1: number, y1: number): DoodleRect => ({
  x: Math.round(x0),
  y: Math.round(y0),
  w: Math.round(x1 - x0),
  h: Math.round(y1 - y0),
});

/** Cut strategies; t ∈ (0, 1) grows the hidden area. */
const SHAPE_STRATEGIES: Record<string, Strategy> = {
  "side-left": (b, t, h) => {
    const s = span(b, h);
    return [rect(s.x0, s.y0, b.x + t * b.w, s.y1)];
  },
  "side-right": (b, t, h) => {
    const s = span(b, h);
    return [rect(b.x + (1 - t) * b.w, s.y0, s.x1, s.y1)];
  },
  "side-top": (b, t, h) => {
    const s = span(b, h);
    return [rect(s.x0, s.y0, s.x1, b.y + t * b.h)];
  },
  "side-bottom": (b, t, h) => {
    const s = span(b, h);
    return [rect(s.x0, b.y + (1 - t) * b.h, s.x1, s.y1)];
  },
  "middle-v": (b, t, h) => {
    const s = span(b, h);
    const cx = b.x + b.w / 2;
    return [rect(cx - (t * b.w) / 2, s.y0, cx + (t * b.w) / 2, s.y1)];
  },
  "middle-h": (b, t, h) => {
    const s = span(b, h);
    const cy = b.y + b.h / 2;
    return [rect(s.x0, cy - (t * b.h) / 2, s.x1, cy + (t * b.h) / 2)];
  },
  "corner-tl": (b, t, h) => {
    const s = span(b, h);
    const k = Math.sqrt(t);
    return [rect(s.x0, s.y0, b.x + k * b.w, b.y + k * b.h)];
  },
  "corner-tr": (b, t, h) => {
    const s = span(b, h);
    const k = Math.sqrt(t);
    return [rect(b.x + (1 - k) * b.w, s.y0, s.x1, b.y + k * b.h)];
  },
  "corner-bl": (b, t, h) => {
    const s = span(b, h);
    const k = Math.sqrt(t);
    return [rect(s.x0, b.y + (1 - k) * b.h, b.x + k * b.w, s.y1)];
  },
  "corner-br": (b, t, h) => {
    const s = span(b, h);
    const k = Math.sqrt(t);
    return [rect(b.x + (1 - k) * b.w, b.y + (1 - k) * b.h, s.x1, s.y1)];
  },
};

/** Trends hide a stretch of time, always the full chart height (so the band says nothing about values). */
const TREND_STRATEGIES: Record<string, Strategy> = {
  end: (b, t, h) => [rect(b.x + (1 - t) * b.w, 0, Math.min(DOODLE_WIDTH, b.x + b.w + PAD), h)],
  "middle-v": (b, t, h) => {
    const cx = b.x + b.w * 0.55;
    return [rect(cx - (t * b.w) / 2, 0, cx + (t * b.w) / 2, h)];
  },
};

export const strategiesFor = (type: DoodleSource["type"]) =>
  type === "trend" ? TREND_STRATEGIES : SHAPE_STRATEGIES;

/** The strategies a source allows: its `cuts`, or all of its type's. */
function sourceStrategies(source: DoodleSource): Array<[string, Strategy]> {
  const all = Object.entries(strategiesFor(source.type));
  return source.cuts ? all.filter(([name]) => source.cuts?.includes(name)) : all;
}

/**
 * How much the missing part bends away from a straight line, in canvas units:
 * for each missing piece, the farthest point from the line joining its ends;
 * the largest over the pieces. Near zero means a ruler would do (a straight
 * border, a steady chart stretch): too obvious to be a puzzle.
 */
export function missingBend(missing: readonly DoodlePath[]): number {
  let best = 0;
  for (const run of missing) {
    if (run.length < 3) continue;
    const a = run[0];
    const b = run[run.length - 1];
    let dev = 0;
    for (const p of run) dev = Math.max(dev, segmentDistance(p, a, b));
    best = Math.max(best, dev);
  }
  return Math.round(best);
}

/** Measures a mask against its source. */
export function measureVariant(source: DoodleSource, rects: readonly DoodleRect[]) {
  const region = clampRects(rects, DOODLE_WIDTH, source.height);
  const cut = cutPaths(source.paths, region);
  const missingLength = totalLength(cut.missing);
  const turn = cut.missing.reduce((s, p) => s + turning(p), 0);
  const metrics: DoodleVariantMetrics = {
    visibility: Math.round(cut.visibility * 1000) / 1000,
    missingLength: Math.round(missingLength),
    detail: missingLength > 0 ? Math.round((turn / missingLength) * 100 * 100) / 100 : 0,
    missingRuns: cut.missing.length,
    bend: missingBend(cut.missing),
    regionShare:
      Math.round(
        (unionArea(region, DOODLE_WIDTH, source.height) / (DOODLE_WIDTH * source.height)) * 1000,
      ) / 1000,
  };
  return { region, cut, metrics };
}

/**
 * Difficulty from visibility, one level harder when the missing part is
 * intricate. A trend that isn't smooth is never easy: it leans on knowing the
 * data, not just on geometry.
 */
export function difficultyFor(
  metrics: DoodleVariantMetrics,
  type?: DoodleSource["type"],
): DoodleDifficulty | null {
  const v = metrics.visibility;
  const band = DOODLE_DIFFICULTIES.find(
    (d) => v >= DOODLE_BANDS[d].min - 1e-9 && v <= DOODLE_BANDS[d].max + 1e-9,
  );
  if (!band) return null;
  if (metrics.detail >= DOODLE_LIMITS.hardDetail && band !== "hard")
    return band === "easy" ? "medium" : "hard";
  if (type === "trend" && band === "easy" && metrics.detail >= 1) return "medium";
  return band;
}

export interface ValidationResult {
  ok: boolean;
  /** Why it was rejected (empty when ok). */
  problems: string[];
}

/** Checks a source before any variant is made from it. */
export function validateDoodleSource(source: DoodleSource): ValidationResult {
  const problems: string[] = [];
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.id ?? ""))
    problems.push("id must be a lowercase slug");
  if (!DOODLE_TYPES.includes(source.type)) problems.push(`unknown type "${source.type}"`);
  if (!source.category?.trim()) problems.push("category is missing");
  if (!source.title?.trim()) problems.push("title is missing");
  if (source.family && !source.family.every((f) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(f)))
    problems.push("family entries must be lowercase slugs");
  if (source.cuts) {
    const known = Object.keys(strategiesFor(source.type));
    const bad = source.cuts.filter((c) => !known.includes(c));
    if (!source.cuts.length || bad.length)
      problems.push(
        `cuts must be some of: ${known.join(", ")}${bad.length ? ` (unknown: ${bad.join(", ")})` : ""}`,
      );
  }
  if (!(source.height >= 300 && source.height <= 1400)) problems.push("height must be 300–1400");
  if (!Array.isArray(source.paths) || source.paths.length === 0) problems.push("no paths");
  const all = [...(source.paths ?? []), ...(source.guides ?? [])];
  const points = all.reduce((n, p) => n + p.length, 0);
  if (points > DOODLE_LIMITS.maxSourcePoints)
    problems.push(`too complex (${points} points; simplify to ≤ ${DOODLE_LIMITS.maxSourcePoints})`);
  for (const p of all) {
    if (p.length < 2) problems.push("a path has fewer than 2 points");
    if (p.some(([x, y]) => !(x >= 0 && x <= DOODLE_WIDTH && y >= 0 && y <= source.height))) {
      problems.push("a point is off the canvas");
      break;
    }
  }
  if (source.paths?.some((p) => pathLength(p) < 40))
    problems.push("a scored path is too short to matter");
  const pv = source.provenance;
  if (!pv?.method || !pv.source?.trim() || !pv.license?.trim())
    problems.push("provenance needs method, source and license");
  if (
    pv &&
    (pv.method === "public-domain" || pv.method === "open-data") &&
    !pv.url &&
    !pv.attribution
  )
    problems.push("public-domain and open-data sources need a url or attribution");
  if (!pv?.checkedBy?.trim())
    problems.push("V1 sources must be human-checked (provenance.checkedBy)");
  if (source.type === "trend" && (!source.series || source.series.points.length < 8))
    problems.push("trend sources need their data series (≥ 8 points)");
  return { ok: problems.length === 0, problems };
}

/** Checks one candidate cut. `others` are masks already kept for the same source. */
export function validateDoodleVariant(
  source: DoodleSource,
  rects: readonly DoodleRect[],
  others: readonly DoodleRect[][] = [],
): ValidationResult & { metrics: DoodleVariantMetrics } {
  const { region, cut, metrics } = measureVariant(source, rects);
  const problems: string[] = [];
  const L = DOODLE_LIMITS;
  if (
    metrics.visibility < DOODLE_MIN_VISIBILITY - 1e-9 ||
    metrics.visibility > DOODLE_MAX_VISIBILITY + 1e-9
  )
    problems.push(`visibility ${Math.round(metrics.visibility * 100)}% is outside 20–50%`);
  if (region.length === 0 || region.some((r) => Math.min(r.w, r.h) < L.minRegionSide))
    problems.push("drawing region is too narrow for a finger");
  if (metrics.regionShare < L.minRegionShare)
    problems.push("drawing region is too small for a phone");
  if (metrics.missingRuns === 0) problems.push("nothing is missing");
  if (metrics.missingRuns > L.maxMissingRuns)
    problems.push(`${metrics.missingRuns} separate missing pieces`);
  if (cut.missing.some((p) => pathLength(p) < L.minMissingRun))
    problems.push("a missing piece is a tiny sliver");
  if (cut.visible.some((p) => pathLength(p) < L.minVisibleRun))
    problems.push("visible fragments are crumbs");
  if (metrics.detail > L.maxDetail) problems.push("missing part needs unreasonable fine detail");
  // Too obvious: a ruler would do. Charts whose hidden stretch barely bends
  // (a steady population line); outlines whose every hidden piece is at most
  // three straight edges (a rectangle's side, a polygon's corner).
  if (metrics.missingRuns > 0) {
    if (source.type === "trend") {
      if ((metrics.bend ?? 0) < L.minTrendBend)
        problems.push("too obvious: the hidden stretch is nearly a straight line");
    } else if (cut.missing.every((m) => simplify(m, L.cornerTolerance).length <= 4)) {
      problems.push("too obvious: the missing part is just a few straight edges");
    }
  }
  // Ambiguity: every missing piece must connect to something the player can see,
  // and a closed outline's gap must be bounded on both sides.
  const visEnds = cut.visible.flatMap(ends);
  const anchored = (pt: [number, number]) =>
    visEnds.some((v) => pointDistance(v, pt) <= L.anchorDistance);
  outer: for (const path of source.paths) {
    const closed = isClosed(path);
    for (const m of splitRuns(path, (p) => inRects(p, region))) {
      if (m.length < 2) continue;
      const [a, b] = ends(m);
      const n = Number(anchored(a)) + Number(anchored(b));
      if (n === 0) {
        problems.push("a missing piece isn't connected to anything visible (ambiguous)");
        break outer;
      }
      if (closed && n < 2 && pointDistance(a, b) > L.anchorDistance) {
        problems.push("a gap in an outline is open-ended (ambiguous)");
        break outer;
      }
    }
  }
  if (source.type === "trend" && cut.visible.length === 0)
    problems.push("trend has no visible data");
  for (const o of others)
    if (maskIoU(region, o, DOODLE_WIDTH, source.height) > L.maxMaskOverlap) {
      problems.push("too similar to another variant of this source");
      break;
    }
  return { ok: problems.length === 0, problems, metrics };
}

/** Stable variant id: the source, the strategy and the visibility it was tuned to. */
export const doodleVariantId = (sourceId: string, strategy: string, target: number) =>
  `${sourceId}~${strategy}-${Math.round(target * 100)}`;

export interface DoodleCandidate extends DoodleVariant {
  problems: string[];
}

/** Finds t so the strategy's mask leaves `target` visible (binary search). */
function tune(
  source: DoodleSource,
  strategy: Strategy,
  b: DoodleRect,
  target: number,
): DoodleRect[] {
  let lo = 0.02;
  let hi = 0.98;
  let best = strategy(b, 0.5, source.height);
  for (let i = 0; i < 22; i++) {
    const t = (lo + hi) / 2;
    best = strategy(b, t, source.height);
    // Only visibility matters here (the full metrics also measure the region's area, which is slow).
    const v = cutPaths(source.paths, clampRects(best, DOODLE_WIDTH, source.height)).visibility;
    if (v > target) lo = t;
    else hi = t;
  }
  return best;
}

/**
 * Every candidate cut for a source (valid or not), for review tooling and
 * tests. Use pickDoodleVariants for the ones worth reviewing.
 */
export function doodleCandidates(source: DoodleSource): DoodleCandidate[] {
  const b = bounds(source.paths);
  if (!b) return [];
  const out: DoodleCandidate[] = [];
  for (const [name, strategy] of sourceStrategies(source)) {
    for (const d of DOODLE_DIFFICULTIES) {
      const target = DOODLE_BANDS[d].target;
      const rects = tune(source, strategy, b, target);
      const check = validateDoodleVariant(source, rects);
      const difficulty = difficultyFor(check.metrics, source.type);
      const problems = [...check.problems];
      if (!difficulty) problems.push("visibility doesn't fit a difficulty band");
      out.push({
        id: doodleVariantId(source.id, name, target),
        sourceId: source.id,
        difficulty: difficulty ?? d,
        mask: { rects, strategy: name },
        metrics: check.metrics,
        problems,
      });
    }
  }
  return out;
}

/**
 * The variants worth reviewing for a source: at most one per difficulty, up
 * to maxVariantsPerSource, each distinct from the others, and never forced
 * from a weak source (no valid cut → nothing). Existing masks (already in the
 * bank) count for "too similar". Order varies by source id so the bank
 * doesn't cut everything the same way.
 */
export function pickDoodleVariants(
  source: DoodleSource,
  opts: { existing?: DoodleMask[]; max?: number } = {},
): DoodleVariant[] {
  if (!validateDoodleSource(source).ok) return [];
  const max = opts.max ?? DOODLE_LIMITS.maxVariantsPerSource;
  const taken: DoodleRect[][] = (opts.existing ?? []).map((m) => m.rects);
  const rng = seededRng(`doodle:${source.id}`);
  const valid = shuffle(
    rng,
    doodleCandidates(source).filter((c) => c.problems.length === 0),
  );
  // Prefer cuts whose gap is bounded on both sides, then fewer pieces.
  const quality = (c: DoodleCandidate) => c.metrics.missingRuns;
  valid.sort((a, b) => quality(a) - quality(b));
  const picked: DoodleVariant[] = [];
  for (const d of DOODLE_DIFFICULTIES) {
    if (picked.length >= max) break;
    const c = valid.find(
      (v) => v.difficulty === d && validateDoodleVariant(source, v.mask.rects, taken).ok,
    );
    if (!c) continue;
    taken.push(c.mask.rects);
    picked.push({
      id: c.id,
      sourceId: c.sourceId,
      difficulty: c.difficulty,
      mask: c.mask,
      metrics: c.metrics,
    });
  }
  return picked;
}
