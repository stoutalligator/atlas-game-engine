import { type Rng, mulberry32, shuffle } from "../../core/rng.js";
import { type Placed, boundsOf, cellsOf, crossingsBetween, normalizeOrigin } from "./grid.js";
import { LAYOUT_LIMITS, type LayoutLimits, validateLayout } from "./validate.js";

// Deterministic crossword builder. It only proposes geometry: each word is
// laid across a word already on the board at a shared letter, and a partial
// layout survives only if the validator's geometry rules still hold. The
// validator (validate.ts) makes the final call on the finished grid.
//
// It builds like a crossword, not a tree: at every step it tries first the
// placements that cross the most words already down (then the most compact),
// so words interlock where the letters allow, and finished layouts are
// ranked by how many crossings they have. Legality always comes first: a
// placement that breaks a rule is never kept, however many words it crosses.

export interface BuildWord {
  id: string;
  grid: string;
}

export interface ConstructOptions {
  seed: number;
  /** The starting answer is placed first, across, at the origin. */
  start: string;
  /** Distinct layouts to collect. */
  maxLayouts?: number;
  /** Search runs, each with its own word and placement order. */
  runs?: number;
  /** Placement attempts per run before giving up on it. */
  maxSteps?: number;
  /**
   * Partial grids the crossword (beam) search keeps at each step; 0 turns it
   * off. It finds the interlocking layouts the depth-first runs rarely reach.
   */
  beamWidth?: number;
  limits?: LayoutLimits;
}

export interface ConstructResult {
  layouts: Placed[][];
  /** Placements tried across all runs, for the audit trail. */
  steps: number;
}

const PARTIAL_RULES = new Set([
  "matching-intersections",
  "one-answer-per-direction",
  "cross-at-most-once",
  "runs-are-answers",
]);

function partialOk(placed: Placed[], limits: LayoutLimits): boolean {
  const b = boundsOf(placed.flatMap(cellsOf));
  if (b.rows > limits.maxRows || b.cols > limits.maxCols) return false;
  return validateLayout(placed, undefined, limits).every((r) => !PARTIAL_RULES.has(r.rule) || r.ok);
}

/** Every distinct way `word` can cross a word already placed. */
function candidatePlacements(word: BuildWord, placed: Placed[]): Placed[] {
  const out: Placed[] = [];
  const seen = new Set<string>();
  const add = (p: Placed) => {
    const k = `${p.direction}:${p.row},${p.col}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  for (const p of placed) {
    const cells = cellsOf(p);
    for (let i = 0; i < p.grid.length; i++)
      for (let j = 0; j < word.grid.length; j++) {
        if (p.grid[i] !== word.grid[j]) continue;
        const [r, c] = cells[i];
        add(
          p.direction === "across"
            ? { ...word, direction: "down", row: r - j, col: c }
            : { ...word, direction: "across", row: r, col: c - j },
        );
      }
  }
  return out;
}

/** Words already placed that `cand` crosses. */
const crossCount = (cand: Placed, placed: Placed[]) =>
  placed.reduce((n, p) => n + (crossingsBetween(cand, p).length ? 1 : 0), 0);

/** Crossings in a layout: shared cells between pairs of answers. */
export function crossingCount(layout: Placed[]): number {
  let n = 0;
  for (let i = 0; i < layout.length; i++)
    for (let j = i + 1; j < layout.length; j++) n += crossingsBetween(layout[i], layout[j]).length;
  return n;
}

/**
 * Crossings beyond the minimum a connected layout needs (one per word after
 * the first): 0 for a pure tree; each one closes a loop, crossword-style.
 */
export const extraCrossings = (layout: Placed[]) =>
  Math.max(0, crossingCount(layout) - (layout.length - 1));

const area = (layout: Placed[]) => {
  const b = boundsOf(layout.flatMap(cellsOf));
  return b.rows * b.cols;
};

const layoutKey = (layout: Placed[]) =>
  normalizeOrigin(layout)
    .map((a) => `${a.id}:${a.direction}:${a.row},${a.col}`)
    .sort()
    .join("|");

function search(
  words: BuildWord[],
  start: BuildWord,
  rng: Rng,
  limits: LayoutLimits,
  maxSteps: number,
): { layout: Placed[] | null; steps: number } {
  let steps = 0;
  const placed: Placed[] = [{ ...start, direction: "across", row: 0, col: 0 }];
  const rest = shuffle(
    rng,
    words.filter((w) => w.id !== start.id),
  );

  const dfs = (remaining: BuildWord[]): boolean => {
    if (remaining.length === 0) return true;
    // Every (word, spot) option, most crossings first, then most compact;
    // the shuffle breaks ties so each run explores differently.
    const options = shuffle(
      rng,
      remaining.flatMap((w) => candidatePlacements(w, placed).map((cand) => ({ w, cand }))),
    )
      .map((o) => ({ ...o, crosses: crossCount(o.cand, placed), size: area([...placed, o.cand]) }))
      .sort((a, b) => b.crosses - a.crosses || a.size - b.size);
    for (const { w, cand } of options) {
      if (++steps > maxSteps) return false;
      placed.push(cand);
      if (partialOk(placed, limits) && dfs(remaining.filter((x) => x.id !== w.id))) return true;
      placed.pop();
    }
    return false;
  };

  return { layout: dfs(rest) ? normalizeOrigin([...placed]) : null, steps };
}

/**
 * Beam search: place one word per step, keeping the `width` best partial
 * grids (most crossings, then most compact; seeded shuffle breaks ties).
 * Every kept grid passes the partial rules, so every result is legal so far.
 */
function beamSearch(
  words: BuildWord[],
  start: BuildWord,
  rng: Rng,
  limits: LayoutLimits,
  width: number,
): { layouts: Placed[][]; steps: number } {
  let steps = 0;
  let beam: Placed[][] = [[{ ...start, direction: "across", row: 0, col: 0 }]];
  const total = words.length;
  while (beam.length && beam[0].length < total) {
    const next = new Map<string, { layout: Placed[]; crosses: number; size: number }>();
    for (const placed of beam) {
      const ids = new Set(placed.map((p) => p.id));
      for (const w of words) {
        if (ids.has(w.id)) continue;
        for (const cand of candidatePlacements(w, placed)) {
          const layout = [...placed, cand];
          const key = layoutKey(layout);
          if (next.has(key)) continue;
          steps++;
          if (!partialOk(layout, limits)) continue;
          next.set(key, { layout, crosses: crossingCount(layout), size: area(layout) });
        }
      }
    }
    beam = shuffle(rng, [...next.values()])
      .sort((a, b) => b.crosses - a.crosses || a.size - b.size)
      .slice(0, width)
      .map((o) => o.layout);
  }
  return { layouts: beam.filter((l) => l.length === total).map(normalizeOrigin), steps };
}

/**
 * Up to `maxLayouts` distinct legal layouts for the words, or none, most
 * crossings first (then most compact). Same words + same options → same
 * layouts, always.
 */
export function constructLayouts(words: BuildWord[], options: ConstructOptions): ConstructResult {
  const {
    seed,
    maxLayouts = 6,
    runs = 24,
    maxSteps = 4000,
    beamWidth = 24,
    limits = LAYOUT_LIMITS,
  } = options;
  const start = words.find((w) => w.id === options.start);
  if (!start) throw new Error(`start ${options.start} is not one of the words`);
  const seen = new Set<string>();
  const layouts: Placed[][] = [];
  let steps = 0;
  if (beamWidth > 0) {
    const beam = beamSearch(words, start, mulberry32(seed ^ 0x5bd1e995), limits, beamWidth);
    steps += beam.steps;
    for (const layout of beam.layouts) {
      const key = layoutKey(layout);
      if (seen.has(key)) continue;
      seen.add(key);
      layouts.push(layout);
    }
  }
  for (let run = 0; run < runs && layouts.length < maxLayouts; run++) {
    const res = search(words, start, mulberry32(seed + run * 7919), limits, maxSteps);
    steps += res.steps;
    if (!res.layout) continue;
    const key = layoutKey(res.layout);
    if (seen.has(key)) continue;
    seen.add(key);
    layouts.push(res.layout);
  }
  // Stable sort: equal layouts keep the order they were found in.
  layouts.sort((a, b) => crossingCount(b) - crossingCount(a) || area(a) - area(b));
  return { layouts: layouts.slice(0, maxLayouts), steps };
}
