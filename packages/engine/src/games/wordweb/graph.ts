import { type Rng, shuffle } from "../../core/rng.js";
import { type Placed, crossingsBetween } from "./grid.js";
import { type UnlockNode, visibleIds } from "./validate.js";

// The unlock tree: each answer has one parent it crosses, and solving the
// parent reveals it. Built from a finished layout; validated by
// validateUnlockGraph.

export type TreeShape = "wide" | "deep";

/**
 * Assigns parents by walking the crossing graph from the start. "wide"
 * (breadth-first) lets one answer reveal several at once; "deep"
 * (depth-first) makes longer chains.
 */
export function buildUnlockTree(
  layout: Placed[],
  start: string,
  shape: TreeShape,
  rng: Rng,
): UnlockNode[] {
  const parent = new Map<string, string | null>([[start, null]]);
  const byId = new Map(layout.map((a) => [a.id, a]));
  const neighbours = (id: string) =>
    shuffle(
      rng,
      layout.filter(
        (b) => !parent.has(b.id) && crossingsBetween(byId.get(id) as Placed, b).length > 0,
      ),
    );
  if (shape === "wide") {
    const queue = [start];
    while (queue.length) {
      const id = queue.shift() as string;
      for (const b of neighbours(id)) {
        parent.set(b.id, id);
        queue.push(b.id);
      }
    }
  } else {
    const visit = (id: string) => {
      for (const b of neighbours(id)) {
        if (parent.has(b.id)) continue;
        parent.set(b.id, id);
        visit(b.id);
      }
    };
    visit(start);
  }
  return layout.map((a) => ({ ...a, parent: parent.get(a.id) ?? null }));
}

export function childrenOf(nodes: UnlockNode[], id: string): string[] {
  return orderForSelection(nodes.filter((n) => n.parent === id)).map((n) => n.id);
}

/** Reading order: top to bottom, then left to right, across before down. */
export function orderForSelection<T extends Placed>(answers: T[]): T[] {
  return [...answers].sort(
    (a, b) =>
      a.row - b.row ||
      a.col - b.col ||
      (a.direction === b.direction ? 0 : a.direction === "across" ? -1 : 1),
  );
}

export interface TreeStats {
  /** Longest chain of unlocks below the start. */
  depth: number;
  /** Most children any answer reveals. */
  maxBranch: number;
  /** Answers that reveal more than one child. */
  branchPoints: number;
  /** Most answers open (visible, unsolved) at once, over any solve order. */
  maxOpen: number;
  /** Cells in the completed grid shared by two answers. */
  crossings: number;
}

export function treeStats(nodes: UnlockNode[]): TreeStats {
  const kids = new Map<string, number>();
  for (const n of nodes) if (n.parent) kids.set(n.parent, (kids.get(n.parent) ?? 0) + 1);
  const depthOf = (n: UnlockNode): number => {
    let d = 0;
    let cur = n;
    while (cur.parent) {
      d++;
      cur = nodes.find((x) => x.id === cur.parent) as UnlockNode;
    }
    return d;
  };
  // Most answers open at once, over every solve order (≤ 2^7 states).
  let maxOpen = 1;
  const seen = new Set<string>();
  const walk = (solved: Set<string>) => {
    const key = [...solved].sort().join(",");
    if (seen.has(key)) return;
    seen.add(key);
    const open = [...visibleIds(nodes, solved)].filter((id) => !solved.has(id));
    maxOpen = Math.max(maxOpen, open.length);
    for (const id of open) walk(new Set([...solved, id]));
  };
  walk(new Set());
  let crossings = 0;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++)
      crossings += crossingsBetween(nodes[i], nodes[j]).length;
  return {
    depth: Math.max(0, ...nodes.map(depthOf)),
    maxBranch: Math.max(0, ...kids.values()),
    branchPoints: [...kids.values()].filter((k) => k > 1).length,
    maxOpen,
    crossings,
  };
}

/** Cells of `a` already filled by answers crossing it. */
export function crossingIndexes(a: Placed, others: Placed[]): number[] {
  const idx = new Set<number>();
  for (const b of others) if (b.id !== a.id) for (const x of crossingsBetween(a, b)) idx.add(x.ia);
  return [...idx].sort((x, y) => x - y);
}

/**
 * How many free letters a word gets when it unfurls, by length, on top of
 * the one it shares with its parent: none for 3- and 4-letter words, one for
 * 5, two for 6, three for 7 and longer.
 */
export function unfurlCount(length: number): number {
  if (length <= 4) return 0;
  if (length === 5) return 1;
  if (length === 6) return 2;
  return 3;
}

/** Free letters no other word supplies that always stay for the player to type. */
const UNFURL_KEEP_BLANK = 2;

/**
 * The free letters a word shows when it unfurls, on top of the one it shares
 * with the word that revealed it (its parent); unfurlCount says how many.
 * Only cells no other answer fills: the first letter if it's one, then each
 * next letter as far as possible from the ones already showing (the later on
 * a tie). At least two such cells always stay blank. Empty for the starting
 * answer. Fixed per puzzle, so every player — and the server's replay — sees
 * the same letters.
 */
export function unfurlIndexes(
  nodes: readonly (Placed & { parent: string | null })[],
  id: string,
): number[] {
  const a = nodes.find((n) => n.id === id);
  const parent = a?.parent ? nodes.find((n) => n.id === a.parent) : undefined;
  if (!a || !parent) return [];
  const shared = crossingsBetween(a, parent)[0];
  if (!shared) return [];
  const crossed = new Set(crossingIndexes(a, [...nodes]));
  const fresh = Array.from(a.grid, (_, i) => i).filter((i) => !crossed.has(i));
  const count = Math.min(unfurlCount(a.grid.length), fresh.length - UNFURL_KEEP_BLANK);
  const known = [shared.ia];
  const picked: number[] = [];
  const gap = (i: number) => Math.min(...known.map((k) => Math.abs(k - i)));
  for (let n = 0; n < count; n++) {
    const pool = fresh.filter((i) => !picked.includes(i));
    const next =
      n === 0 && pool.includes(0) ? 0 : pool.reduce((best, i) => (gap(i) >= gap(best) ? i : best));
    picked.push(next);
    known.push(next);
  }
  return picked.sort((x, y) => x - y);
}

/**
 * The starting answer's free letters: the ones the puzzle picked
 * (`revealed`), topped up to unfurlCount for its length. Added letters
 * follow the unfurl order (the first letter, then spread out, the later on a
 * tie). Nothing crosses the start before it's solved, so any cell can show,
 * and at least two stay blank.
 */
export function startIndexes(word: string, revealed: readonly number[]): number[] {
  const known = [...revealed];
  const target = Math.min(
    Math.max(known.length, unfurlCount(word.length)),
    word.length - UNFURL_KEEP_BLANK,
  );
  const gap = (i: number) => Math.min(...known.map((k) => Math.abs(k - i)));
  while (known.length < target) {
    const pool = Array.from(word, (_, i) => i).filter((i) => !known.includes(i));
    known.push(pool.includes(0) ? 0 : pool.reduce((best, i) => (gap(i) >= gap(best) ? i : best)));
  }
  return known.sort((x, y) => x - y);
}
