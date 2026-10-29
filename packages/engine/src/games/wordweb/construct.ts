import { type Rng, mulberry32, shuffle } from "../../core/rng.js";
import { type Placed, boundsOf, cellsOf, normalizeOrigin } from "./grid.js";
import { LAYOUT_LIMITS, type LayoutLimits, validateLayout } from "./validate.js";

// Deterministic crossword builder. It only proposes geometry: each word is
// laid across a word already on the board at a shared letter, and a partial
// layout survives only if the validator's geometry rules still hold. The
// validator (validate.ts) makes the final call on the finished grid.

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

/** Every way `word` can cross a word already placed. */
function candidatePlacements(word: BuildWord, placed: Placed[]): Placed[] {
  const out: Placed[] = [];
  for (const p of placed) {
    const cells = cellsOf(p);
    for (let i = 0; i < p.grid.length; i++)
      for (let j = 0; j < word.grid.length; j++) {
        if (p.grid[i] !== word.grid[j]) continue;
        const [r, c] = cells[i];
        out.push(
          p.direction === "across"
            ? { ...word, direction: "down", row: r - j, col: c }
            : { ...word, direction: "across", row: r, col: c - j },
        );
      }
  }
  return out;
}

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
    for (const w of remaining) {
      for (const cand of shuffle(rng, candidatePlacements(w, placed))) {
        if (++steps > maxSteps) return false;
        placed.push(cand);
        if (partialOk(placed, limits) && dfs(remaining.filter((x) => x.id !== w.id))) return true;
        placed.pop();
      }
    }
    return false;
  };

  return { layout: dfs(rest) ? normalizeOrigin([...placed]) : null, steps };
}

/**
 * Up to `maxLayouts` distinct legal layouts for the words, or none. Same
 * words + same options → same layouts, always.
 */
export function constructLayouts(words: BuildWord[], options: ConstructOptions): ConstructResult {
  const { seed, maxLayouts = 6, runs = 24, maxSteps = 4000, limits = LAYOUT_LIMITS } = options;
  const start = words.find((w) => w.id === options.start);
  if (!start) throw new Error(`start ${options.start} is not one of the words`);
  const seen = new Set<string>();
  const layouts: Placed[][] = [];
  let steps = 0;
  for (let run = 0; run < runs && layouts.length < maxLayouts; run++) {
    const res = search(words, start, mulberry32(seed + run * 7919), limits, maxSteps);
    steps += res.steps;
    if (!res.layout) continue;
    const key = layoutKey(res.layout);
    if (seen.has(key)) continue;
    seen.add(key);
    layouts.push(res.layout);
  }
  return { layouts, steps };
}
