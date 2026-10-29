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
