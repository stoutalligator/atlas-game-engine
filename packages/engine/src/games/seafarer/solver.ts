// Exact solver: shortest routes over (position, places visited). Costs are
// small integers (drift is free, sea 1, shallows 2), so a bucket queue is
// a plain, exact Dijkstra. Boards are small (≤ ~150 cells, ≤ 6 key places).

import {
  type Board,
  HEX_DIRS,
  type Leg,
  type RouteState,
  anchor,
  buildBoard,
  harborOf,
  isTimed,
  neighbor,
  replayRoute,
  sail,
  voyageDay,
} from "./rules.js";
import type { Place, ReferenceRoute, RouteKind, SeafarerPuzzle } from "./types.js";

export interface Solution {
  /** Fewest days (for charter: fewest days carrying `best`). Infinity if unsolvable. */
  days: number;
  /** Charter: the most cargo within the provisions. */
  best?: number;
  /** Cells to tap, in order. */
  taps: number[];
}

export interface SolveOptions {
  /** Treat currents as open sea (to measure how much the currents matter). */
  ignoreCurrents?: boolean;
  /** Treat shallows as open sea (to measure how much the shallows cost). */
  ignoreShallows?: boolean;
  /** Override the provisions cap (default: no cap except for charter). */
  maxDays?: number;
  /** Cells the route may not pass through (to find genuinely different routes). */
  banned?: ReadonlySet<number>;
}

interface Search {
  dist: Map<number, number>;
  prev: Map<number, { key: number; tap: number }>;
  keyPlaces: Place[];
  nMask: number;
  nCells: number;
  /** The first state reached that satisfies `goal` (searches stop there). */
  goalKey: number;
}

function keyPlacesOf(p: SeafarerPuzzle): Place[] {
  const kind = p.objective.type === "charter" ? "cargo" : "port";
  return p.places.filter((pl) => pl.kind === kind);
}

interface SearchOptions {
  from?: { cell: number; mask: number; day: number };
  banned?: ReadonlySet<number>;
  /** Stop at the first (so cheapest) state for which this holds. */
  goal?: (cell: number, mask: number) => boolean;
}

/** Longest a stormy search looks ahead (anchoring could otherwise go on forever). */
const STORM_HORIZON = 120;

/**
 * Dijkstra by days over (cell, places visited). With storms or a tide the day is part
 * of the state too (arriving earlier doesn't always beat arriving later, since
 * waiting somewhere may be blocked), and dropping anchor is a move.
 */
function search(p: SeafarerPuzzle, board: Board, maxDays: number, o: SearchOptions = {}): Search {
  const keyPlaces = keyPlacesOf(p);
  const bit = new Map<number, number>();
  keyPlaces.forEach((pl, i) => bit.set(pl.cell, 1 << i));
  const nMask = 1 << keyPlaces.length;
  const nCells = board.cells.length;
  const timed = isTimed(board);
  const limit = timed ? Math.min(maxDays, STORM_HORIZON) : maxDays;
  const day0 = o.from?.day ?? 0;
  const keyOf = (cell: number, mask: number, d: number) =>
    timed ? (d * nCells + cell) * nMask + mask : cell * nMask + mask;
  const start = keyOf(o.from?.cell ?? harborOf(p).cell, o.from?.mask ?? 0, 0);
  const dist = new Map<number, number>([[start, 0]]);
  const prev = new Map<number, { key: number; tap: number }>();
  const buckets: number[][] = [[start]];
  for (let d = 0; d < buckets.length && d <= limit; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (const key of bucket) {
      if (dist.get(key) !== d) continue;
      const cell = Math.floor(key / nMask) % nCells;
      const mask = key % nMask;
      if (o.goal?.(cell, mask)) return { dist, prev, keyPlaces, nMask, nCells, goalKey: key };
      const legs: Leg[] = [];
      for (const dir of HEX_DIRS) {
        const leg = sail(board, cell, dir, day0 + d);
        if (leg) legs.push(leg);
      }
      const wait = timed ? anchor(board, cell, day0 + d) : null;
      if (wait) legs.push(wait);
      for (const leg of legs) {
        if (o.banned && leg.path.some((c) => o.banned?.has(c))) continue;
        const nd = d + leg.days;
        if (nd > limit) continue;
        let m = mask;
        for (const c of leg.path) m |= bit.get(c) ?? 0;
        const nk = keyOf(leg.path[leg.path.length - 1], m, nd);
        const old = dist.get(nk);
        if (old !== undefined && old <= nd) continue;
        dist.set(nk, nd);
        prev.set(nk, { key, tap: leg.to });
        if (!buckets[nd]) buckets[nd] = [];
        buckets[nd].push(nk);
      }
    }
  }
  return { dist, prev, keyPlaces, nMask, nCells, goalKey: -1 };
}

function tapsTo(s: Search, key: number): number[] {
  const taps: number[] = [];
  let k = key;
  for (let step = s.prev.get(k); step; step = s.prev.get(k)) {
    taps.push(step.tap);
    k = step.key;
  }
  return taps.reverse();
}

/** Same puzzle with currents and/or shallows replaced by open sea. */
function simplified(p: SeafarerPuzzle, currents: boolean, shallows: boolean): SeafarerPuzzle {
  if (!currents && !shallows) return p;
  return {
    ...p,
    map: p.map.map((row) => {
      let r = row;
      if (currents) r = r.replace(/[qeadzc]/g, ".");
      if (shallows) r = r.replace(/,/g, ".");
      return r;
    }),
  };
}

export function solve(puzzle: SeafarerPuzzle, opts: SolveOptions = {}): Solution {
  const p = simplified(puzzle, !!opts.ignoreCurrents, !!opts.ignoreShallows);
  const board = buildBoard(p);
  const charter = p.objective.type === "charter";
  const harbor = harborOf(p).cell;
  const nKeys = keyPlacesOf(p).length;
  const full = (1 << nKeys) - 1;

  if (charter) {
    const s = search(p, board, opts.maxDays ?? p.provisions, { banned: opts.banned });
    const values = s.keyPlaces.map((pl) => pl.value ?? 0);
    let best = 0;
    let days = Number.POSITIVE_INFINITY;
    let bestKey = -1;
    for (const [key, d] of s.dist) {
      const cell = Math.floor(key / s.nMask) % s.nCells;
      const m = key % s.nMask;
      if (cell !== harbor || m === 0) continue;
      const v = values.reduce((sum, val, i) => (m & (1 << i) ? sum + val : sum), 0);
      if (v > best || (v === best && d < days)) {
        best = v;
        days = d;
        bestKey = key;
      }
    }
    return { days, best, taps: bestKey < 0 ? [] : tapsTo(s, bestKey) };
  }

  const returnHome = p.objective.type === "rounds" && p.objective.returnHome;
  const s = search(p, board, opts.maxDays ?? 999, {
    banned: opts.banned,
    goal: (cell, m) => m === full && (!returnHome || cell === harbor),
  });
  if (s.goalKey < 0) return { days: Number.POSITIVE_INFINITY, taps: [] };
  return { days: s.dist.get(s.goalKey) as number, taps: tapsTo(s, s.goalKey) };
}

/**
 * Can the objective still be met from where this route has got to, within
 * the provisions left? False means the player has sailed into a dead end
 * (a one-way current, a storm closing in) and should return to harbor.
 */
export function canFinish(p: SeafarerPuzzle, route: RouteState): boolean {
  if (route.complete) return true;
  const board = buildBoard(p);
  const keys = keyPlacesOf(p);
  let mask = 0;
  keys.forEach((pl, i) => {
    if (route.visited.includes(pl.id)) mask |= 1 << i;
  });
  const harbor = harborOf(p).cell;
  const full = (1 << keys.length) - 1;
  const returnHome = p.objective.type === "rounds" && p.objective.returnHome;
  const charter = p.objective.type === "charter";
  const s = search(p, board, route.remaining, {
    from: { cell: route.position, mask, day: voyageDay(route) },
    // Charter: home with cargo aboard (a start state that qualified was already complete).
    goal: (cell, m) =>
      charter ? cell === harbor && m !== 0 : m === full && (!returnHome || cell === harbor),
  });
  return s.goalKey >= 0;
}

/**
 * What a route mostly relies on: waiting out a storm, timing the tide over
 * the flats, riding currents, cutting through shallows, or open water.
 */
export function routeKind(p: SeafarerPuzzle, taps: readonly number[]): RouteKind {
  const r = replayRoute({ ...p, provisions: 999 }, taps);
  if (!r) return "open";
  if (r.legs.some((l) => l.anchor)) return p.storms?.length ? "storm" : "tide";
  const board = buildBoard(p);
  if (r.legs.some((l) => l.path.some((c) => board.cells[c].terrain === "flats"))) return "tide";
  const drift = r.legs.reduce((n, l) => n + l.path.length - 1, 0);
  if (drift >= 2) return "current";
  return r.legs.some((l) => l.days === 2) ? "shallows" : "open";
}

/**
 * Up to `max` genuinely different routes, best first. After each route is
 * found, every cell it passes through is banned (except next to the harbor
 * and the places, which may be the only way in or out), and the chart is
 * solved again. So each route avoids the waters of all the routes before it.
 * Voyage and rounds only.
 */
export function alternativeRoutes(p: SeafarerPuzzle, max = 3): ReferenceRoute[] {
  if (p.objective.type === "charter") return [];
  const board = buildBoard(p);
  const keep = new Set<number>();
  for (const pl of p.places) {
    keep.add(pl.cell);
    for (const d of HEX_DIRS) {
      const n = neighbor(board, pl.cell, d);
      if (n >= 0) keep.add(n);
    }
  }
  const banned = new Set<number>();
  const routes: ReferenceRoute[] = [];
  while (routes.length < max) {
    const sol = solve(p, { banned });
    if (!Number.isFinite(sol.days) || sol.taps.length === 0) break;
    routes.push({ days: sol.days, kind: routeKind(p, sol.taps), taps: sol.taps });
    const r = replayRoute({ ...p, provisions: 999 }, sol.taps);
    for (const leg of r?.legs ?? []) for (const c of leg.path) if (!keep.has(c)) banned.add(c);
  }
  return routes;
}
