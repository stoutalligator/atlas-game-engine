// Seafarer rules: hex geometry, sailing, currents, route replay and scoring. Pure.

import type { Cell, HexDir, Place, SeafarerPuzzle, Storm, Tide } from "./types.js";

export const HEX_DIRS: readonly HexDir[] = ["e", "ne", "nw", "w", "sw", "se"];

export const OPPOSITE: Record<HexDir, HexDir> = {
  e: "w",
  w: "e",
  ne: "sw",
  sw: "ne",
  nw: "se",
  se: "nw",
};

const FLOW_CHARS: Record<string, HexDir> = { d: "e", e: "ne", q: "nw", a: "w", z: "sw", c: "se" };
export const FLOW_CHAR: Record<HexDir, string> = {
  e: "d",
  ne: "e",
  nw: "q",
  w: "a",
  sw: "z",
  se: "c",
};

export function parseCell(ch: string): Cell {
  if (ch === "#") return { terrain: "land" };
  if (ch === "*") return { terrain: "reef" };
  if (ch === ",") return { terrain: "shallows" };
  if (ch === "~") return { terrain: "flats" };
  const flow = FLOW_CHARS[ch];
  if (flow) return { terrain: "current", flow };
  if (ch === ".") return { terrain: "sea" };
  throw new Error(`Unknown map character "${ch}"`);
}

export interface Board {
  cols: number;
  rows: number;
  cells: Cell[];
  /** Place by cell index. */
  placeAt: Map<number, Place>;
  storms: Storm[];
  /** The tide over the flats (none: flats are always open). */
  tide: Tide | null;
  /** Stormy cells by voyage day (filled lazily by stormAt). */
  stormCache: Map<number, ReadonlySet<number>>;
}

export function buildBoard(
  p: Pick<SeafarerPuzzle, "cols" | "rows" | "map" | "places" | "storms"> &
    Partial<Pick<SeafarerPuzzle, "tide">>,
): Board {
  if (p.map.length !== p.rows) throw new Error(`Map has ${p.map.length} rows, expected ${p.rows}`);
  const cells: Cell[] = [];
  for (const line of p.map) {
    if (line.length !== p.cols) throw new Error(`Map row "${line}" is not ${p.cols} wide`);
    for (const ch of line) cells.push(parseCell(ch));
  }
  const placeAt = new Map<number, Place>();
  for (const place of p.places) placeAt.set(place.cell, place);
  return {
    cols: p.cols,
    rows: p.rows,
    cells,
    placeAt,
    storms: p.storms ?? [],
    tide: p.tide ?? null,
    stormCache: new Map(),
  };
}

/** Odd rows are shifted half a cell right ("odd-r" offset layout). */
export function neighbor(b: Pick<Board, "cols" | "rows">, idx: number, dir: HexDir): number {
  const row = Math.floor(idx / b.cols);
  const col = idx % b.cols;
  const odd = row & 1;
  let c = col;
  let r = row;
  switch (dir) {
    case "e":
      c += 1;
      break;
    case "w":
      c -= 1;
      break;
    case "ne":
      r -= 1;
      c += odd;
      break;
    case "nw":
      r -= 1;
      c += odd - 1;
      break;
    case "se":
      r += 1;
      c += odd;
      break;
    case "sw":
      r += 1;
      c += odd - 1;
      break;
  }
  if (c < 0 || r < 0 || c >= b.cols || r >= b.rows) return -1;
  return r * b.cols + c;
}

/** Direction from `a` to the adjacent cell `b`, or null if they aren't neighbours. */
export function dirBetween(board: Board, a: number, b: number): HexDir | null {
  for (const d of HEX_DIRS) if (neighbor(board, a, d) === b) return d;
  return null;
}

export function isNavigable(cell: Cell | undefined): boolean {
  return !!cell && cell.terrain !== "land" && cell.terrain !== "reef";
}

/** Days to sail into a cell. Shallows are slow going. */
export function entryCost(cell: Cell): number {
  return cell.terrain === "shallows" ? 2 : 1;
}

export interface Leg {
  /** The cell the player chose (their own cell when anchoring). */
  to: number;
  /** Every cell the ship passes through, ending where it stops (drift included). */
  path: number[];
  /** Days this leg costs (drift is free). */
  days: number;
  /** Dropped anchor: waited a day where it was. */
  anchor?: boolean;
}

/** Cells covered by a storm on voyage day `day` (day 0 = setting out). */
export function stormAt(board: Board, day: number): ReadonlySet<number> {
  if (!board.storms.length) return EMPTY;
  const hit = board.stormCache.get(day);
  if (hit) return hit;
  const out = new Set<number>();
  for (const storm of board.storms)
    for (let c of storm.cells) {
      for (let i = 0; i < day && c >= 0; i++) c = neighbor(board, c, storm.drift);
      if (c >= 0) out.add(c);
    }
  board.stormCache.set(day, out);
  return out;
}
const EMPTY: ReadonlySet<number> = new Set();

/** High tide on voyage day `day` (always, on a chart without a tide). */
export function tideHigh(board: Pick<Board, "tide">, day: number): boolean {
  const t = board.tide;
  if (!t) return true;
  return (((day + (t.offset ?? 0)) % t.period) + t.period) % t.period < t.high;
}

/** Whether a ship may be in `cell` on voyage day `day` (no storm, and no flats at low tide). */
function openOn(board: Board, cell: number, day: number): boolean {
  if (board.cells[cell].terrain === "flats" && !tideHigh(board, day)) return false;
  return !stormAt(board, day).has(cell);
}

/** Charts where time matters: storms move, the tide turns. Waiting is a move there. */
export function isTimed(board: Pick<Board, "storms" | "tide">): boolean {
  return board.storms.length > 0 || board.tide !== null;
}

/**
 * Waiting a day where the ship is (drop anchor). Only on charts where time
 * matters, and not where the ship couldn't be tomorrow (a storm arriving, or
 * flats drying out at low tide).
 */
export function anchor(board: Board, at: number, day: number): Leg | null {
  if (!isTimed(board) || !openOn(board, at, day + 1)) return null;
  return { to: at, path: [at], days: 1, anchor: true };
}

/**
 * Sails from `from` one cell in `dir` on voyage day `day`, then lets currents
 * carry the ship. Returns null when the move isn't allowed: off the chart,
 * onto land or reef, straight up a current, or into a storm (where it will
 * be on arrival).
 */
export function sail(board: Board, from: number, dir: HexDir, day = 0): Leg | null {
  const to = neighbor(board, from, dir);
  if (to < 0) return null;
  const cell = board.cells[to];
  if (!isNavigable(cell)) return null;
  if (cell.terrain === "current" && cell.flow === OPPOSITE[dir]) return null;
  const arrive = day + entryCost(cell);
  if (!openOn(board, to, arrive)) return null;
  const path = [to];
  let at = to;
  const seen = new Set<number>([from, to]);
  // Drift: a current pushes the ship one cell along its flow until it reaches
  // water without a current, or the next cell is blocked.
  while (board.cells[at].terrain === "current") {
    const next = neighbor(board, at, board.cells[at].flow as HexDir);
    if (
      next < 0 ||
      !isNavigable(board.cells[next]) ||
      seen.has(next) ||
      !openOn(board, next, arrive)
    )
      break;
    path.push(next);
    seen.add(next);
    at = next;
  }
  return { to, path, days: entryCost(cell) };
}

/**
 * Where a region's voyage ends on the expedition chart, and so where tomorrow
 * departs from: the port (voyage), home again (round trips and charters), or,
 * for rounds that end away from home, the port the best route calls at last.
 * Players who finish in a different order still continue from there; the
 * month follows the charted course.
 */
export function voyageExit(
  p: Pick<SeafarerPuzzle, "places" | "objective"> &
    Partial<Pick<SeafarerPuzzle, "routes" | "cols" | "rows" | "map" | "storms" | "provisions">>,
): Place {
  const ports = p.places.filter((pl) => pl.kind === "port");
  if (!ports.length || p.objective.type === "charter") return harborOf(p);
  if (p.objective.type === "rounds" && p.objective.returnHome) return harborOf(p);
  if (p.objective.type === "voyage") return ports[ports.length - 1];
  const best = p.routes?.[0];
  if (best && p.cols && p.rows && p.map) {
    const r = replayRoute({ ...(p as SeafarerPuzzle), provisions: 999 }, best.taps);
    const last = r?.visited[r.visited.length - 1];
    const port = ports.find((pl) => pl.id === last);
    if (port) return port;
  }
  return ports[ports.length - 1];
}

/**
 * Turns a month of separately generated charts into one journey:
 * - each day's harbor takes the name of the place yesterday's voyage ended
 *   ("you set out from Gull's Rest"), and
 * - every other port is a new place: no name is used twice in the pack
 *   (ports are renamed from `pool`, in order, when their name is taken).
 * Throws if the pool runs out, so a pack can't ship with repeats.
 */
export function linkVoyages(puzzles: SeafarerPuzzle[], pool: readonly string[]): SeafarerPuzzle[] {
  const out: SeafarerPuzzle[] = [];
  const used = new Set<string>();
  const fresh = (name: string): string => {
    if (!used.has(name)) return name;
    const next = pool.find((n) => !used.has(n));
    if (!next) throw new Error(`Seafarer: ran out of port names (need more than ${used.size})`);
    return next;
  };
  puzzles.forEach((p, i) => {
    const from = i === 0 ? null : voyageExit(out[i - 1]).name;
    const places = p.places.map((pl) => {
      if (pl.kind === "cargo") return pl;
      const name = pl.kind === "harbor" && from !== null ? from : fresh(pl.name);
      used.add(name);
      return { ...pl, name };
    });
    out.push({ ...p, places });
  });
  return out;
}

export function harborOf(p: Pick<SeafarerPuzzle, "places">): Place {
  const harbor = p.places.find((pl) => pl.kind === "harbor");
  if (!harbor) throw new Error("Puzzle has no harbor");
  return harbor;
}

export interface RouteState {
  legs: Leg[];
  /** Where the ship is now. */
  position: number;
  /** Days at sea so far: this voyage's sailing days plus a day in port per restart. */
  days: number;
  /** Times the player returned to harbor to start over (each costs a day). */
  restarts: number;
  /** Ids of ports and cargo called at so far (in order of first visit). */
  visited: string[];
  cargo: number;
  /** The objective is met right now (the route can be submitted). */
  complete: boolean;
  /** Days of provisions left. */
  remaining: number;
}

/** A fresh voyage from the harbor; each earlier restart has already cost a day. */
export function emptyRoute(p: SeafarerPuzzle, restarts = 0): RouteState {
  return withStatus(p, {
    legs: [],
    position: harborOf(p).cell,
    days: restarts,
    restarts,
    visited: [],
    cargo: 0,
    complete: false,
    remaining: p.provisions,
  });
}

function withStatus(p: SeafarerPuzzle, s: RouteState): RouteState {
  return { ...s, remaining: p.provisions - s.days, complete: objectiveMet(p, s) };
}

function objectiveMet(p: SeafarerPuzzle, s: Omit<RouteState, "complete">): boolean {
  if (s.legs.length === 0) return false;
  const home = s.position === harborOf(p).cell;
  switch (p.objective.type) {
    case "voyage":
    case "rounds": {
      const ports = p.places.filter((pl) => pl.kind === "port");
      const all = ports.every((pl) => s.visited.includes(pl.id));
      return p.objective.type === "rounds" && p.objective.returnHome ? all && home : all;
    }
    case "charter":
      return home && s.cargo > 0;
  }
}

/** Days into the current voyage (the storm clock): days at sea minus days in port. */
export function voyageDay(s: Pick<RouteState, "days" | "restarts">): number {
  return s.days - s.restarts;
}

/** Voyages and rounds end the moment the objective is met; charters can sail on. */
export function routeClosed(p: SeafarerPuzzle, s: RouteState): boolean {
  return s.complete && p.objective.type !== "charter";
}

/**
 * Extends the route to the adjacent cell `to`. Null when that move isn't
 * allowed (not adjacent, blocked, upstream, out of provisions, route closed).
 */
export function extendRoute(
  p: SeafarerPuzzle,
  board: Board,
  s: RouteState,
  to: number,
): RouteState | null {
  if (routeClosed(p, s)) return null;
  const day = voyageDay(s);
  let leg: Leg | null;
  if (to === s.position) leg = anchor(board, s.position, day);
  else {
    const dir = dirBetween(board, s.position, to);
    leg = dir ? sail(board, s.position, dir, day) : null;
  }
  if (!leg || s.days + leg.days > p.provisions) return null;
  const visited = [...s.visited];
  let cargo = s.cargo;
  for (const c of leg.path) {
    const place = board.placeAt.get(c);
    if (!place || place.kind === "harbor" || visited.includes(place.id)) continue;
    visited.push(place.id);
    if (place.kind === "cargo") cargo += place.value ?? 0;
  }
  return withStatus(p, {
    ...s,
    legs: [...s.legs, leg],
    position: leg.path[leg.path.length - 1],
    days: s.days + leg.days,
    visited,
    cargo,
  });
}

/** Replays the final voyage's taps after `restarts` returns to harbor. Null if any tap is illegal. */
export function replayRoute(
  p: SeafarerPuzzle,
  taps: readonly number[],
  restarts = 0,
): RouteState | null {
  if (!Number.isInteger(restarts) || restarts < 0 || restarts >= p.provisions) return null;
  const board = buildBoard(p);
  let s = emptyRoute(p, restarts);
  for (const t of taps) {
    if (!Number.isInteger(t)) return null;
    const next = extendRoute(p, board, s, t);
    if (!next) return null;
    s = next;
  }
  return s;
}

/** Cells the ship can sail to from where it is now (for highlighting). */
export function reachableNext(p: SeafarerPuzzle, board: Board, s: RouteState): number[] {
  if (routeClosed(p, s)) return [];
  const out: number[] = [];
  for (const d of HEX_DIRS) {
    const leg = sail(board, s.position, d, voyageDay(s));
    if (leg && s.days + leg.days <= p.provisions) out.push(leg.to);
  }
  return out;
}

export type Stars = 1 | 2 | 3;

/** Most days over par that two stars can allow (the threshold is usually tighter: see twoStarDays). */
export function twoStarSlack(par: number): number {
  return Math.max(2, Math.ceil(par * 0.15));
}

/**
 * Days that still earn two stars. Puzzles carry a threshold from their
 * validation (the best genuinely different route); older data falls back to
 * par + slack.
 */
export function twoStarDays(p: Pick<SeafarerPuzzle, "par" | "twoStar">): number {
  return p.twoStar ?? p.par + twoStarSlack(p.par);
}

/**
 * Stars for a completed route: 3 at par (charter: the best cargo), 2 when
 * close, 1 for any completed route. Finishing is never a failure.
 */
export function starsFor(p: SeafarerPuzzle, s: RouteState): Stars {
  if (p.objective.type === "charter") {
    const best = p.best ?? 1;
    if (s.cargo >= best) return 3;
    return s.cargo >= Math.ceil(best * 0.75) ? 2 : 1;
  }
  if (s.days <= p.par) return 3;
  return s.days <= twoStarDays(p) ? 2 : 1;
}

export interface SeafarerScore {
  stars: Stars;
  days: number;
  cargo: number;
  restarts: number;
}

/** Re-checks a finished voyage: null unless it replays legally and completes the objective. */
export function scoreRoute(
  p: SeafarerPuzzle,
  taps: readonly number[],
  restarts = 0,
): SeafarerScore | null {
  const s = replayRoute(p, taps, restarts);
  if (!s || !s.complete) return null;
  return { stars: starsFor(p, s), days: s.days, cargo: s.cargo, restarts: s.restarts };
}
