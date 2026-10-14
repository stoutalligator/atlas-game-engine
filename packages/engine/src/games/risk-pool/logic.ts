import { weekday } from "../../core/daily.js";
import { type Rng, randInt, seededRng } from "../../core/rng.js";

// Risk Pool: every cell is a policyholder showing their expected claims.
// Group neighbours into pools whose claims add up to exactly the target
// premium, until every policyholder is pooled. Any valid pooling wins.

export interface RiskPoolPuzzle {
  size: number;
  target: number;
  /** Row-major claim values, 1–9. */
  values: number[];
  /** One valid pooling (the generator's), used for hints. */
  solution: number[][];
}

export const POOL_COLORS = 6;

export function neighbors(i: number, size: number): number[] {
  const r = Math.floor(i / size);
  const c = i % size;
  const out: number[] = [];
  if (r > 0) out.push(i - size);
  if (r < size - 1) out.push(i + size);
  if (c > 0) out.push(i - 1);
  if (c < size - 1) out.push(i + 1);
  return out;
}

export function isAdjacent(a: number, b: number, size: number): boolean {
  return neighbors(a, size).includes(b);
}

export function isConnected(cells: number[], size: number): boolean {
  if (cells.length === 0) return false;
  const set = new Set(cells);
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const cur = stack.pop() as number;
    for (const n of neighbors(cur, size))
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
  }
  return seen.size === set.size;
}

export function poolSum(cells: number[], values: number[]): number {
  return cells.reduce((s, i) => s + values[i], 0);
}

export function isValidPool(cells: number[], pz: RiskPoolPuzzle): boolean {
  return (
    cells.length >= 2 &&
    new Set(cells).size === cells.length &&
    poolSum(cells, pz.values) === pz.target &&
    isConnected(cells, pz.size)
  );
}

export function isComplete(pz: RiskPoolPuzzle, pools: number[][]): boolean {
  const covered = new Set<number>();
  for (const pool of pools) {
    if (!isValidPool(pool, pz)) return false;
    for (const i of pool) {
      if (covered.has(i)) return false;
      covered.add(i);
    }
  }
  return covered.size === pz.size * pz.size;
}

/** Picks a colour index that differs from every pool touching this one. */
export function pickPoolColor(cells: number[], pools: number[][], colors: number[], size: number) {
  const touching = new Set<number>();
  const mine = new Set(cells);
  pools.forEach((pool, idx) => {
    if (pool.some((i) => neighbors(i, size).some((n) => mine.has(n)))) touching.add(colors[idx]);
  });
  for (let k = 0; k < POOL_COLORS; k++) {
    const color = (pools.length + k) % POOL_COLORS;
    if (!touching.has(color)) return color;
  }
  return pools.length % POOL_COLORS;
}

// ── Generator ──────────────────────────────────────────────────────────────

/** Monday–Tuesday 5×5, Wednesday–Friday 6×6, weekend 7×7. */
export function sizeForWeekday(day: number): number {
  if (day === 1 || day === 2) return 5;
  if (day === 0 || day === 6) return 7;
  return 6;
}

function partition(size: number, rng: Rng): number[][] | null {
  const n = size * size;
  const owner = new Array<number>(n).fill(-1);
  const groups: number[][] = [];
  const freeNeighbors = (i: number) => neighbors(i, size).filter((x) => owner[x] === -1).length;

  for (;;) {
    const open = [];
    for (let i = 0; i < n; i++) if (owner[i] === -1) open.push(i);
    if (open.length === 0) break;

    // Start from the most boxed-in cell so nothing gets stranded.
    const least = Math.min(...open.map(freeNeighbors));
    const starts = open.filter((i) => freeNeighbors(i) === least);
    const seed = starts[Math.floor(rng() * starts.length)];
    const want = [2, 3, 3, 4, 4, 5][Math.floor(rng() * 6)];
    const group = [seed];
    owner[seed] = groups.length;

    while (group.length < want) {
      const frontier = [
        ...new Set(group.flatMap((g) => neighbors(g, size)).filter((x) => owner[x] === -1)),
      ];
      if (frontier.length === 0) break;
      const next = frontier[Math.floor(rng() * frontier.length)];
      owner[next] = groups.length;
      group.push(next);
    }

    if (group.length === 1) {
      // Stranded single: fold it into the smallest neighbouring pool.
      const host = neighbors(seed, size)
        .map((x) => owner[x])
        .filter((g) => g >= 0 && g < groups.length && groups[g].length < 6)
        .sort((a, b) => groups[a].length - groups[b].length)[0];
      if (host === undefined) return null;
      owner[seed] = host;
      groups[host].push(seed);
      continue;
    }
    groups.push(group);
  }
  return groups;
}

/** Splits `target` into `k` parts, each 1–9. */
function splitTarget(target: number, k: number, rng: Rng): number[] {
  const parts = new Array<number>(k).fill(1);
  let left = target - k;
  while (left > 0) {
    const i = Math.floor(rng() * k);
    if (parts[i] < 9) {
      parts[i]++;
      left--;
    }
  }
  return parts;
}

function candidate(size: number, target: number, rng: Rng): RiskPoolPuzzle {
  let groups: number[][] | null = null;
  while (!groups) groups = partition(size, rng);

  const values = new Array<number>(size * size).fill(0);
  for (const g of groups) {
    const parts = splitTarget(target, g.length, rng);
    g.forEach((cell, i) => {
      values[cell] = parts[i];
    });
  }
  return { size, target, values, solution: groups.map((g) => [...g].sort((a, b) => a - b)) };
}

/**
 * Builds several candidates and keeps the one with the fewest valid poolings,
 * so there's little slack and greedy pools lead to dead ends.
 */
export function generateRiskPool(
  date: string,
  size = sizeForWeekday(weekday(date)),
): RiskPoolPuzzle {
  const rng = seededRng(`risk-pool:${date}:${size}`);
  const target = [10, 12, 12, 15][randInt(rng, 0, 3)];
  let best: RiskPoolPuzzle | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 6 && bestCount > 1; i++) {
    const pz = candidate(size, target, rng);
    const count = countSolutions(pz, 400);
    if (count < bestCount) {
      best = pz;
      bestCount = count;
    }
  }
  return best as RiskPoolPuzzle;
}

/** Every connected pool containing `start` (and no lower cell) that hits the target. */
function poolsFrom(pz: RiskPoolPuzzle, start: number, used: Uint8Array): number[][] {
  const out: number[][] = [];
  const seen = new Set<string>();
  const cells = [start];
  const grow = (sum: number) => {
    if (sum === pz.target) {
      const k = [...cells].sort((a, b) => a - b).join(",");
      if (!seen.has(k)) {
        seen.add(k);
        out.push([...cells]);
      }
      return;
    }
    for (const c of [...cells])
      for (const n of neighbors(c, pz.size)) {
        if (n < start || used[n] || cells.includes(n) || sum + pz.values[n] > pz.target) continue;
        cells.push(n);
        grow(sum + pz.values[n]);
        cells.pop();
      }
  };
  grow(pz.values[start]);
  return out;
}

/** Number of distinct complete poolings, counting up to `limit`. */
export function countSolutions(pz: RiskPoolPuzzle, limit = 1000): number {
  const n = pz.size * pz.size;
  const used = new Uint8Array(n);
  let found = 0;
  const rec = () => {
    if (found >= limit) return;
    let first = 0;
    while (first < n && used[first]) first++;
    if (first === n) {
      found++;
      return;
    }
    for (const pool of poolsFrom(pz, first, used)) {
      for (const c of pool) used[c] = 1;
      rec();
      for (const c of pool) used[c] = 0;
    }
  };
  rec();
  return found;
}

// ── Hints ──────────────────────────────────────────────────────────────────

export type Hint = { kind: "reveal"; cells: number[] } | { kind: "break"; pool: number };

/**
 * Reveals a pool from the published solution whose policyholders are all
 * still unpooled; if every such pool is blocked, points at a player pool
 * that isn't in the published solution.
 */
export function nextHint(pz: RiskPoolPuzzle, pools: number[][]): Hint | null {
  const pooled = new Set(pools.flat());
  const free = pz.solution.find((g) => g.every((i) => !pooled.has(i)));
  if (free) return { kind: "reveal", cells: free };
  const key = (cells: number[]) => [...cells].sort((a, b) => a - b).join(",");
  const published = new Set(pz.solution.map(key));
  const stray = pools.findIndex((p) => !published.has(key(p)));
  return stray >= 0 ? { kind: "break", pool: stray } : null;
}
