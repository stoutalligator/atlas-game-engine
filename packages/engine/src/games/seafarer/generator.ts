// Seafarer content pipeline: seeded candidate charts → exact solve → metrics →
// rejection of unsolvable / trivial charts → ranking. Deterministic for a seed.
// Packs are built offline (scripts/build-seafarer-pack.ts), reviewed by a
// person, and the chosen charts are stored as plain data.

import { type Rng, pick, randInt, seededRng, shuffle } from "../../core/rng.js";
import {
  type Board,
  FLOW_CHAR,
  HEX_DIRS,
  type Leg,
  OPPOSITE,
  anchor,
  buildBoard,
  harborOf,
  isNavigable,
  neighbor,
  replayRoute,
  sail,
  stormAt,
  tideHigh,
  twoStarSlack,
  voyageExit,
} from "./rules.js";
import { alternativeRoutes, solve } from "./solver.js";
import type {
  ChartSide,
  HexDir,
  Objective,
  Place,
  RouteKind,
  SeafarerPuzzle,
  Storm,
} from "./types.js";

// ── Recipes ────────────────────────────────────────────────────────────────

export interface Recipe {
  objective: Objective;
  cols: number;
  rows: number;
  /** Island count and size range (cells). */
  islands: [number, number];
  islandSize: [number, number];
  /** Reef chains. */
  reefs: [number, number];
  /** Chance a coastal sea cell becomes shallows. */
  shallows: number;
  /** Current streams and their length. */
  currents: [number, number];
  currentLength: [number, number];
  /** Ports to call at (voyage: 1). */
  ports: number;
  /** Charter cargo islands. */
  cargo?: number;
  /** Charter: provisions as a share of the days needed to collect everything. */
  provisionShare?: [number, number];
  /** Voyage/rounds: provisions = par + slack. */
  slack: number;
  par: [number, number];
  /** Minimum par / straight-line distance. */
  minDetour?: number;
  /** Minimum days the currents save over sailing without them. */
  minCurrentGain?: number;
  /** Minimum days nearest-first ordering loses (rounds / charter). */
  minGreedyGap?: number;
  /** Minimum days the shallows add to par (they must be in the way). */
  minShallowCost?: number;
  /**
   * Minimum genuinely different routes that still earn two stars (the
   * optimal one included). Default 2: no chart has only one sensible route.
   */
  minRoutes?: number;
  /** Minimum different kinds among those routes (current / shallows / open water). */
  minKinds?: number;
  /**
   * Kinds that must be among the viable routes: on a currents day, riding a
   * current must be a real option (and with minKinds 2, so must not riding it).
   */
  requireKinds?: RouteKind[];
  /** Place names for the pack's setting (defaults: the Shattered Isles' lists). */
  names?: PlaceNames;
  /** Storm fronts, their size (hexes) and how many days they must add to par. */
  storms?: [number, number];
  stormSize?: [number, number];
  minStormCost?: number;
  /**
   * Tidal flats: runs of flats laid across the calm-water best route (so the
   * tide is in the way), their length, and the tide's cycle. `minTideCost`:
   * days the tide must add to par.
   */
  flats?: [number, number];
  flatsLength?: [number, number];
  tidePeriod?: [number, number];
  tideHigh?: [number, number];
  minTideCost?: number;
  /**
   * The obvious route must cost at least this many days over par: a sailor
   * who plans by eye (see naiveDays) loses stars for not thinking it through.
   */
  minLureGap?: number;
  /** ...and at most this many: on the first days the obvious route should still do well. */
  maxLureGap?: number;
  /** Hard but never hopeless: that sailor still gets there within the provisions. */
  naiveFinishes?: boolean;
  /**
   * Where the region meets its neighbours on the expedition chart (set by the
   * build from the day's position, not by the plan). The harbor sits within
   * two hexes of `entrySide`; candidates whose voyage ends near `exitSide`
   * rank higher, so the sea lane to tomorrow's region stays short.
   */
  entrySide?: ChartSide;
  exitSide?: ChartSide;
}

/** Hexes from a cell to one side of its chart (0 = on the edge row/column). */
export function sideDistance(cols: number, rows: number, cell: number, side: ChartSide): number {
  const row = Math.floor(cell / cols);
  const col = cell % cols;
  switch (side) {
    case "n":
      return row;
    case "s":
      return rows - 1 - row;
    case "w":
      return col;
    case "e":
      return cols - 1 - col;
  }
}

export interface Metrics {
  par: number;
  provisions: number;
  /** par / straight-line hex distance (voyage) or summed leg distance. */
  detour: number;
  currentGain: number;
  /** Days the shallows add to par (charter: cargo they cost). */
  shallowCost: number;
  greedyGap: number;
  /** Share of open sea cells: lower is more cluttered. */
  openness: number;
  /** How many first moves start a route within one day of par. */
  openings: number;
  best: number;
  /** Genuinely different routes within the two-star threshold (optimal included). */
  routes: number;
  /** Different kinds among them (current / shallows / open water). */
  kinds: number;
  /** Days between the optimal route and the best different one. */
  altGap: number;
  /** Days the storms add to par (charter: cargo they cost). */
  stormCost: number;
  /** Days the tide adds to par (charter: cargo it costs). */
  tideCost: number;
  /** Days the obvious, plan-by-eye route loses to par (99: it never gets there). */
  lureGap: number;
  /** Hexes from where the voyage ends to the region's exit side (0 without one). */
  exitDistance: number;
}

export interface Candidate {
  puzzle: SeafarerPuzzle;
  metrics: Metrics;
  /** Higher is more interesting (used to rank candidates for review). */
  interest: number;
}

// ── Hex helpers ────────────────────────────────────────────────────────────

function cube(cols: number, idx: number): [number, number] {
  const row = Math.floor(idx / cols);
  const col = idx % cols;
  return [col - (row - (row & 1)) / 2, row];
}

export function hexDistance(cols: number, a: number, b: number): number {
  const [q1, r1] = cube(cols, a);
  const [q2, r2] = cube(cols, b);
  const dq = q1 - q2;
  const dr = r1 - r2;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

const turn = (d: HexDir, by: number): HexDir => HEX_DIRS[(HEX_DIRS.indexOf(d) + by + 6) % 6];

/** Single-source fewest days to every cell (ignoring places). */
export function cellDays(board: Board, from: number): number[] {
  const dist = new Array(board.cells.length).fill(Number.POSITIVE_INFINITY);
  dist[from] = 0;
  const buckets: number[][] = [[from]];
  for (let d = 0; d < buckets.length; d++) {
    for (const c of buckets[d] ?? []) {
      if (dist[c] !== d) continue;
      for (const dir of HEX_DIRS) {
        const leg = sail(board, c, dir);
        if (!leg) continue;
        const end = leg.path[leg.path.length - 1];
        const nd = d + leg.days;
        if (nd < dist[end]) {
          dist[end] = nd;
          if (!buckets[nd]) buckets[nd] = [];
          buckets[nd].push(end);
        }
      }
    }
  }
  return dist;
}

// ── Chart drawing ──────────────────────────────────────────────────────────

type Grid = string[]; // one char per cell, flat

function growIsland(rng: Rng, g: Grid, cols: number, rows: number, size: number): void {
  const n = cols * rows;
  // Keep a one-cell sea margin on the chart edge most of the time.
  const seed = randInt(rng, 0, n - 1);
  if (g[seed] !== ".") return;
  const cells = [seed];
  g[seed] = "#";
  const b = { cols, rows };
  for (let tries = 0; cells.length < size && tries < size * 12; tries++) {
    const from = pick(rng, cells);
    const to = neighbor(b, from, pick(rng, HEX_DIRS));
    if (to < 0 || g[to] !== ".") continue;
    g[to] = "#";
    cells.push(to);
  }
}

function addReef(rng: Rng, g: Grid, cols: number, rows: number): void {
  const b = { cols, rows };
  let at = randInt(rng, 0, cols * rows - 1);
  let dir = pick(rng, HEX_DIRS);
  const len = randInt(rng, 2, 4);
  for (let i = 0; i < len; i++) {
    if (at < 0 || g[at] !== ".") return;
    g[at] = "*";
    if (rng() < 0.3) dir = turn(dir, rng() < 0.5 ? 1 : -1);
    at = neighbor(b, at, dir);
  }
}

/** The direction from `at` that gets closest to `target`. */
function dirToward(b: { cols: number; rows: number }, at: number, target: number): HexDir {
  let best: HexDir = "e";
  let bestD = Number.POSITIVE_INFINITY;
  for (const d of HEX_DIRS) {
    const n = neighbor(b, at, d);
    if (n < 0) continue;
    const dist = hexDistance(b.cols, n, target);
    if (dist < bestD) [bestD, best] = [dist, d];
  }
  return best;
}

/**
 * A stream of current. Guided streams start near one place and flow roughly
 * toward another, so riding them is a real (often longer but free) option;
 * the rest wander. Streams never cover a place.
 */
function addCurrent(
  rng: Rng,
  g: Grid,
  cols: number,
  rows: number,
  len: number,
  keep: ReadonlySet<number>,
  guide?: { from: number; to: number },
): void {
  const b = { cols, rows };
  let at = randInt(rng, 0, cols * rows - 1);
  if (guide) {
    const near = g
      .map((_, i) => i)
      .filter((i) => {
        const d = hexDistance(cols, i, guide.from);
        return d >= 1 && d <= 3 && g[i] === "." && !keep.has(i);
      });
    if (!near.length) return;
    at = pick(rng, near);
  }
  let dir = guide ? dirToward(b, at, guide.to) : pick(rng, HEX_DIRS);
  for (let i = 0; i < len; i++) {
    if (at < 0 || g[at] !== "." || keep.has(at)) return;
    if (guide && hexDistance(cols, at, guide.to) <= 1) return;
    // A stream bends gently and never points straight back into itself.
    if (i < len - 1 && rng() < 0.25) dir = turn(dir, rng() < 0.5 ? 1 : -1);
    else if (guide && rng() < 0.5) dir = dirToward(b, at, guide.to);
    g[at] = FLOW_CHAR[dir];
    at = neighbor(b, at, dir);
  }
}

/** Coastal sea turns shallow at random, except where a place is moored. */
function addShallows(
  rng: Rng,
  g: Grid,
  cols: number,
  rows: number,
  chance: number,
  keep: ReadonlySet<number>,
): void {
  const b = { cols, rows };
  const coast = g
    .map((_, i) => i)
    .filter((i) => g[i] === "." && HEX_DIRS.some((d) => g[neighbor(b, i, d)] === "#"));
  for (const i of coast) if (rng() < chance && !keep.has(i)) g[i] = ",";
}

/** Sea cells next to land: where harbors, ports and cargo sit. */
function coastalSea(g: Grid, cols: number, rows: number): number[] {
  const b = { cols, rows };
  return g
    .map((_, i) => i)
    .filter((i) => g[i] === "." && HEX_DIRS.some((d) => g[neighbor(b, i, d)] === "#"));
}

// ── Names ──────────────────────────────────────────────────────────────────

export interface PlaceNames {
  ports: readonly string[];
  harbors: readonly string[];
  cargo: readonly string[];
}

/** Enough for a whole pack: no port name is used twice in a month (see linkVoyages). */
export const PORT_NAMES = [
  "Gull's Rest",
  "Saltmarsh",
  "Coral Quay",
  "Driftwood",
  "Lantern Cove",
  "Port Amber",
  "Tidewater",
  "Brightwater",
  "Shellhaven",
  "Kestrel Bay",
  "Pelican Point",
  "Old Anchor",
  "Mistral",
  "Seaglass",
  "Tern Island",
  "Windward",
  "Cobalt Cove",
  "Fairhaven",
  "Palm Reach",
  "Conch Harbor",
  "Sandpiper Cay",
  "Turtle Bay",
  "Mango Wharf",
  "Frigate Rock",
  "Lagoon's End",
  "Heron Isle",
  "Pearlwater",
  "Sunfall Quay",
  "Cinnamon Cove",
  "Starfish Point",
  "Dolphin Sound",
  "Breaker's Hold",
  "Hibiscus Bay",
  "Ironwood Pier",
  "Bluefin Cay",
  "Parrot Key",
  "Saltwind",
  "Moonrise Cove",
  "Cutlass Point",
  "Lighthouse Rock",
  "Rumrunner's Rest",
  "Kelp Harbor",
  "Osprey Bay",
  "Opal Lagoon",
  "Marlin Quay",
  "Wreckers' Cove",
  "Seahorse Isle",
  "Sunken Bell",
  "Cayenne Wharf",
  "Albatross Point",
  "Jade Shoals",
  "Spindrift",
  "Cutter's Landing",
  "Nautilus Cove",
  "Gannet Rock",
  "Tamarind Bay",
  "Barnacle Pier",
  "Calypso Cay",
  "Halcyon Harbor",
  "Coralline",
  "Mangrove Run",
  "Driftglass Bay",
  "Sandbar Quay",
  "Galleon Rest",
  "Trade Wind Isle",
];
export const HARBOR_NAMES = [
  "Home Port",
  "Harbor Town",
  "Anchorage",
  "Watch Harbor",
  "Lighthouse Quay",
];
export const CARGO_NAMES = [
  "Spices",
  "Silk",
  "Pearls",
  "Tea",
  "Amber",
  "Coffee",
  "Cocoa",
  "Indigo",
  "Salt",
];

// ── Generate one candidate ─────────────────────────────────────────────────

export function generateCandidate(recipe: Recipe, seed: string): Candidate | null {
  const rng = seededRng(seed);
  const { cols, rows } = recipe;
  const g: Grid = new Array(cols * rows).fill(".");

  const islandCount = randInt(rng, ...recipe.islands);
  for (let i = 0; i < islandCount; i++)
    growIsland(rng, g, cols, rows, randInt(rng, ...recipe.islandSize));
  const reefCount = randInt(rng, ...recipe.reefs);
  for (let i = 0; i < reefCount; i++) addReef(rng, g, cols, rows);
  // Places go on coastal sea before currents and shallows (a dock is never in either).
  const coast = shuffle(rng, coastalSea(g, cols, rows));
  const isCharter = recipe.objective.type === "charter";
  const needed = 1 + (isCharter ? (recipe.cargo ?? 4) : recipe.ports);
  if (coast.length < needed) return null;
  // On the expedition chart the harbor faces yesterday's region: within two
  // hexes of that side (on the coast if possible, else open sea by the edge).
  let harborCell = coast[0];
  if (recipe.entrySide) {
    const side = recipe.entrySide;
    const near = (c: number) => sideDistance(cols, rows, c, side) <= 2;
    const edgeSea = shuffle(
      rng,
      g.map((_, i) => i).filter((i) => g[i] === "." && sideDistance(cols, rows, i, side) <= 1),
    );
    const at = coast.find(near) ?? edgeSea[0];
    if (at === undefined) return null;
    harborCell = at;
    const idx = coast.indexOf(harborCell);
    if (idx >= 0) coast.splice(idx, 1);
    coast.unshift(harborCell);
  }
  const chosen: number[] = [harborCell];
  const minGap = isCharter ? 2 : recipe.ports === 1 ? Math.floor((cols + rows) / 3) : 3;
  for (const c of coast.slice(1)) {
    if (chosen.length >= needed) break;
    if (chosen.every((o) => hexDistance(cols, o, c) >= minGap)) chosen.push(c);
  }
  if (chosen.length < needed) return null;

  const keep = new Set(chosen);
  const currentCount = randInt(rng, ...recipe.currents);
  for (let i = 0; i < currentCount; i++) {
    // Every other stream is guided between two places (harbor → a port, port → port, …).
    const guided = i % 2 === 0 && chosen.length >= 2;
    const from = guided ? pick(rng, chosen) : -1;
    const to = guided
      ? pick(
          rng,
          chosen.filter((c) => c !== from),
        )
      : -1;
    addCurrent(
      rng,
      g,
      cols,
      rows,
      randInt(rng, ...recipe.currentLength),
      keep,
      guided ? { from, to } : undefined,
    );
  }

  addShallows(rng, g, cols, rows, recipe.shallows, new Set(chosen));

  const portNames = shuffle(rng, recipe.names?.ports ?? PORT_NAMES);
  const cargoNames = shuffle(rng, recipe.names?.cargo ?? CARGO_NAMES);
  const places: Place[] = [
    {
      id: "H",
      kind: "harbor",
      cell: harborCell,
      name: pick(rng, recipe.names?.harbors ?? HARBOR_NAMES),
    },
  ];
  chosen.slice(1).forEach((cell, i) => {
    const id = String.fromCharCode(65 + i);
    places.push(
      isCharter
        ? { id, kind: "cargo", cell, name: cargoNames[i], value: randInt(rng, 2, 9) }
        : { id, kind: "port", cell, name: portNames[i] },
    );
  });

  const map: string[] = [];
  for (let r = 0; r < rows; r++) map.push(g.slice(r * cols, (r + 1) * cols).join(""));

  const draft: SeafarerPuzzle = {
    id: seed,
    number: 0,
    title: "",
    cols,
    rows,
    map,
    places,
    objective: recipe.objective,
    provisions: 999,
    par: 0,
    difficulty: 1,
    meta: { seed },
  };
  if (recipe.flats) {
    const tidal = placeFlats(rng, draft, recipe);
    if (!tidal) return null;
    draft.map = tidal.map;
    draft.tide = tidal.tide;
  }
  if (recipe.storms) {
    const storms = placeStorms(rng, draft, recipe);
    if (!storms) return null;
    draft.storms = storms;
  }
  return evaluate(draft, recipe);
}

// ── Storms ──────────────────────────────────────────────────────────────

/**
 * Storm fronts aimed at the calm-weather best route: pick a point along it,
 * and start the storm upwind so it drifts across that point about when the
 * ship would get there. Footprints are small blobs. The harbor stays clear
 * for the first two days so every voyage can set out.
 */
/**
 * Tidal flats across the calm-water best route: a few short runs of open sea
 * along it turn to flats (never a place or a dock beside one), so crossing
 * them means timing the tide, waiting for it, or going round. The tide's
 * cycle and phase are drawn from the recipe.
 */
function placeFlats(
  rng: Rng,
  p: SeafarerPuzzle,
  recipe: Recipe,
): { map: string[]; tide: { period: number; high: number; offset: number } } | null {
  const board = buildBoard(p);
  const calm = solve({ ...p, provisions: 999 });
  const route = replayRoute({ ...p, provisions: 999 }, calm.taps);
  if (!route) return null;
  const along = route.legs.flatMap((l) => l.path);
  const placeCells = new Set(p.places.map((pl) => pl.cell));
  const nearPlace = (c: number) =>
    placeCells.has(c) || HEX_DIRS.some((d) => placeCells.has(neighbor(board, c, d)));
  const g = p.map.join("").split("");
  const runs = randInt(rng, ...(recipe.flats as [number, number]));
  let placed = 0;
  for (let r = 0; r < runs; r++) {
    const open = along.filter((c) => g[c] === "." && !nearPlace(c));
    if (!open.length) break;
    // Start on the route, then spread to open sea around it (a sandbank, not a line).
    let at = pick(rng, open);
    const len = randInt(rng, ...(recipe.flatsLength ?? [2, 4]));
    for (let i = 0; i < len && at >= 0; i++) {
      if (g[at] === "." && !nearPlace(at)) {
        g[at] = "~";
        placed++;
      }
      at = neighbor(board, at, pick(rng, HEX_DIRS));
    }
  }
  if (!placed) return null;
  const period = randInt(rng, ...(recipe.tidePeriod ?? [4, 6]));
  const high = Math.min(period - 1, randInt(rng, ...(recipe.tideHigh ?? [2, 3])));
  const map: string[] = [];
  for (let row = 0; row < p.rows; row++)
    map.push(g.slice(row * p.cols, (row + 1) * p.cols).join(""));
  return { map, tide: { period, high, offset: randInt(rng, 0, period - 1) } };
}

function placeStorms(rng: Rng, p: SeafarerPuzzle, recipe: Recipe): Storm[] | null {
  const board = buildBoard(p);
  const calm = solve(p);
  const route = replayRoute({ ...p, provisions: 999 }, calm.taps);
  if (!route) return null;
  const timeline: Array<{ cell: number; day: number }> = [];
  let day = 0;
  for (const leg of route.legs) {
    day += leg.days;
    for (const c of leg.path) timeline.push({ cell: c, day });
  }
  if (timeline.length < 4) return null;
  const harbor = harborOf(p).cell;
  const storms: Storm[] = [];
  const count = randInt(rng, ...(recipe.storms as [number, number]));
  for (let s = 0; s < count; s++) {
    const hit = timeline[Math.floor(timeline.length * (0.3 + rng() * 0.45))];
    const drift = pick(rng, HEX_DIRS);
    // Walk upwind from the meeting point; a little early or late is fine.
    let center = hit.cell;
    const back = Math.max(0, hit.day + randInt(rng, -1, 1));
    for (let i = 0; i < back; i++) {
      const prevCell = neighbor(board, center, OPPOSITE[drift]);
      if (prevCell < 0) break;
      center = prevCell;
    }
    const size = randInt(rng, ...(recipe.stormSize ?? [3, 5]));
    const cells = [center];
    for (let tries = 0; cells.length < size && tries < size * 10; tries++) {
      const n = neighbor(board, pick(rng, cells), pick(rng, HEX_DIRS));
      if (n >= 0 && !cells.includes(n)) cells.push(n);
    }
    storms.push({ cells, drift });
  }
  const withStorms = buildBoard({ ...p, storms });
  if (stormAt(withStorms, 0).has(harbor) || stormAt(withStorms, 1).has(harbor)) return null;
  return storms;
}

// ── Measure, reject, rank ──────────────────────────────────────────────────

/** Days for the obvious plan: always sail to the nearest unvisited place next. */
function greedyDays(
  p: SeafarerPuzzle,
  board: Board,
  keys: Place[],
  budget: number,
): {
  days: number;
  value: number;
} {
  const home = harborOf(p).cell;
  const charter = p.objective.type === "charter";
  const returnHome = charter || (p.objective.type === "rounds" && p.objective.returnHome);
  let at = home;
  let days = 0;
  let value = 0;
  const left = new Set(keys);
  while (left.size) {
    const from = cellDays(board, at);
    let next: Place | null = null;
    let score = Number.NEGATIVE_INFINITY;
    for (const pl of left) {
      const d = from[pl.cell];
      if (!Number.isFinite(d)) continue;
      if (charter) {
        // Value per day, but only if we can still get home in time.
        const back = cellDays(board, pl.cell)[home];
        if (days + d + back > budget) continue;
        const s = (pl.value ?? 0) / Math.max(1, d);
        if (s > score) [score, next] = [s, pl];
      } else if (-d > score) [score, next] = [-d, pl];
    }
    if (!next) break;
    days += from[next.cell];
    value += next.value ?? 0;
    at = next.cell;
    left.delete(next);
  }
  if (returnHome && at !== home) days += cellDays(board, at)[home];
  if (!charter && left.size) days = Number.POSITIVE_INFINITY;
  return { days, value };
}

/** Rough position of a hex centre (for "which way looks straighter"). */
function centre(cols: number, idx: number): [number, number] {
  const row = Math.floor(idx / cols);
  return [(idx % cols) + 0.5 * (row & 1), row * 0.866];
}

/**
 * Days for a sailor who plans by eye. They head for the port that looks
 * nearest (then home, if the round trip needs it), steering straight at it
 * while each hex brings them closer; only when nothing does (a bay that
 * closes, an island in the way) do they stop and plan the fewest hexes from
 * there. They don't price shallows, ride currents on purpose or read the
 * storm forecast; they find out when the sea pushes back:
 * - a current carries them off course → they carry on from where they end up;
 * - a move is refused (a storm, or straight up a current) → they wait at
 *   anchor a day or two for a storm, then plan around what's blocking them.
 * Returns Infinity if they never get there (a one-way current trap, or far
 * too long). Voyage and rounds only.
 */
export function naiveDays(p: SeafarerPuzzle): number {
  if (p.objective.type === "charter") return Number.NaN;
  const board = buildBoard(p);
  const home = harborOf(p).cell;
  const returnHome = p.objective.type === "rounds" && p.objective.returnHome;
  const ports = p.places.filter((pl) => pl.kind === "port");
  const portAt = new Map(ports.map((pl) => [pl.cell, pl.id]));
  const left = new Set(ports.map((pl) => pl.id));
  const n = board.cells.length;
  const limit = Math.max(40, (p.par || 20) * 3);
  // Cells the sailor has learnt to avoid: currents for good, storm hexes until they next move.
  const avoid = new Set<number>();
  const stormAvoid = new Set<number>();
  const blocked = (c: number) => avoid.has(c) || stormAvoid.has(c);

  /** Hex steps to `target` from every cell, by eye (every open hex costs the same). */
  const stepsTo = (target: number): number[] => {
    const d = new Array(n).fill(Number.POSITIVE_INFINITY);
    d[target] = 0;
    const queue = [target];
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      for (const dir of HEX_DIRS) {
        const m = neighbor(board, c, dir);
        if (m < 0 || !isNavigable(board.cells[m]) || blocked(m) || d[m] <= d[c] + 1) continue;
        d[m] = d[c] + 1;
        queue.push(m);
      }
    }
    return d;
  };

  let at = home;
  let day = 0;
  let waits = 0;
  // Steering straight at the goal, until that stops working for this goal.
  let careful = false;
  let lastGoal = -1;
  while (day <= limit) {
    // Next goal: the port that looks nearest (straight-line), then home.
    let goal = -1;
    if (left.size) {
      const fromHere = stepsTo(at);
      let bestD = Number.POSITIVE_INFINITY;
      for (const pl of ports) {
        if (!left.has(pl.id) || !Number.isFinite(fromHere[pl.cell])) continue;
        const looks = hexDistance(p.cols, at, pl.cell);
        if (looks < bestD) [bestD, goal] = [looks, pl.cell];
      }
    } else if (returnHome && at !== home) goal = home;
    else return day;
    if (goal !== lastGoal) [careful, lastGoal] = [false, goal];

    const dist = goal >= 0 ? stepsTo(goal) : null;
    if (!dist || !Number.isFinite(dist[at])) {
      // Walled in by a storm: wait for it to move on, or, if it's coming
      // here, back off to the nearest safe hex and look again.
      if (!stormAvoid.size) return Number.POSITIVE_INFINITY;
      stormAvoid.clear();
      if (waits < 4 && anchor(board, at, day)) {
        day += 1;
        waits++;
        continue;
      }
      const toGoal = goal >= 0 ? stepsTo(goal) : null;
      let retreat: Leg | null = null;
      for (const d of HEX_DIRS) {
        const l = sail(board, at, d, day);
        const end = l?.path[l.path.length - 1];
        if (!l || end === undefined || stormAt(board, day + l.days + 1).has(end)) continue;
        if (
          !retreat ||
          (toGoal?.[end] ?? 0) < (toGoal?.[retreat.path[retreat.path.length - 1]] ?? 0)
        )
          retreat = l;
      }
      if (!retreat) return Number.POSITIVE_INFINITY;
      day += retreat.days;
      for (const c of retreat.path) {
        const id = portAt.get(c);
        if (id) left.delete(id);
      }
      at = retreat.path[retreat.path.length - 1];
      continue;
    }
    // Straight at it while a hex brings them closer; else the fewest hexes from here.
    const [gx, gy] = centre(p.cols, goal);
    const pickStep = (ok: (m: number) => boolean) => {
      let best = -1;
      let bestAim = Number.POSITIVE_INFINITY;
      for (const dir of HEX_DIRS) {
        const m = neighbor(board, at, dir);
        if (m < 0 || !ok(m)) continue;
        const [x, y] = centre(p.cols, m);
        const aim = (x - gx) ** 2 + (y - gy) ** 2;
        if (aim < bestAim) [bestAim, best] = [aim, m];
      }
      return best;
    };
    const here = hexDistance(p.cols, at, goal);
    let next = careful
      ? -1
      : pickStep(
          (m) =>
            isNavigable(board.cells[m]) &&
            !blocked(m) &&
            Number.isFinite(dist[m]) &&
            hexDistance(p.cols, m, goal) < here,
        );
    if (next < 0) {
      careful = true;
      next = pickStep((m) => dist[m] === dist[at] - 1);
    }
    const dir = HEX_DIRS.find((d) => neighbor(board, at, d) === next) as HexDir;
    const leg = sail(board, at, dir, day);
    if (!leg) {
      const stormy = stormAt(board, day + 1).has(next) || stormAt(board, day + 2).has(next);
      const dry = board.cells[next].terrain === "flats" && !tideHigh(board, day + 1);
      if (stormy || dry) {
        // A storm in the way, or the flats dry: wait a little, then go around.
        if (waits < 2 && anchor(board, at, day)) {
          day += 1;
          waits++;
          continue;
        }
        for (const c of stormAt(board, day + 1)) stormAvoid.add(c);
        if (dry)
          board.cells.forEach((cell, c) => {
            if (cell.terrain === "flats") stormAvoid.add(c);
          });
        stormAvoid.add(next);
      } else avoid.add(next); // straight up a current
      continue;
    }
    day += leg.days;
    waits = 0;
    stormAvoid.clear();
    for (const c of leg.path) {
      const id = portAt.get(c);
      if (id) left.delete(id);
    }
    at = leg.path[leg.path.length - 1];
  }
  return Number.POSITIVE_INFINITY;
}

export function measure(p: SeafarerPuzzle): Metrics | null {
  const board = buildBoard(p);
  const sol = solve(p);
  if (!Number.isFinite(sol.days) || sol.taps.length === 0) return null;
  const charter = p.objective.type === "charter";
  const keys = p.places.filter((pl) => pl.kind === (charter ? "cargo" : "port"));
  const home = harborOf(p).cell;

  const noCurrents = solve(p, { ignoreCurrents: true });
  const currentGain = charter
    ? (sol.best ?? 0) - (noCurrents.best ?? 0)
    : Number.isFinite(noCurrents.days)
      ? noCurrents.days - sol.days
      : 99;

  const noShallows = solve(p, { ignoreShallows: true });
  const shallowCost = charter
    ? (noShallows.best ?? 0) - (sol.best ?? 0)
    : sol.days - noShallows.days;

  const greedy = greedyDays(p, board, keys, p.provisions);
  // 99 when the obvious plan can't finish at all (a one-way current traps it).
  const greedyGap = charter
    ? (sol.best ?? 0) - greedy.value
    : Number.isFinite(greedy.days)
      ? greedy.days - sol.days
      : 99;

  let straight = 0;
  let at = home;
  for (const k of keys) {
    straight += hexDistance(p.cols, at, k.cell);
    at = k.cell;
  }
  const detour = sol.days / Math.max(1, straight);

  const open =
    p.map
      .join("")
      .split("")
      .filter((c) => c === ".").length /
    (p.cols * p.rows);

  // Openings: first moves from which par (+1) is still reachable.
  let openings = 0;
  if (!charter) {
    for (const dir of HEX_DIRS) {
      const leg = sail(board, home, dir);
      if (!leg) continue;
      const after = solve({
        ...p,
        places: p.places.map((pl) =>
          pl.kind === "harbor" ? { ...pl, cell: leg.path[leg.path.length - 1] } : pl,
        ),
      });
      // Only an approximation for return-home rounds (home moves too); fine for ranking.
      if (after.days + leg.days <= sol.days + 1) openings++;
    }
  }

  // The tide's cost: the same chart with the flats always open.
  const slack = p.tide ? solve({ ...p, tide: undefined }) : sol;
  const tideCost = charter ? (slack.best ?? 0) - (sol.best ?? 0) : sol.days - slack.days;

  const calm = p.storms?.length ? solve({ ...p, storms: undefined }) : sol;
  const stormCost = charter ? (calm.best ?? 0) - (sol.best ?? 0) : sol.days - calm.days;

  const naive = charter ? sol.days : naiveDays({ ...p, par: sol.days });
  const lureGap = charter ? 0 : Number.isFinite(naive) ? naive - sol.days : 99;

  return {
    stormCost,
    tideCost,
    lureGap,
    exitDistance: 0,
    routes: 0,
    kinds: 0,
    altGap: 0,
    par: sol.days,
    provisions: p.provisions,
    detour,
    currentGain,
    shallowCost,
    greedyGap,
    openness: open,
    openings,
    best: sol.best ?? 0,
  };
}

function evaluate(draft: SeafarerPuzzle, recipe: Recipe): Candidate | null {
  const charter = recipe.objective.type === "charter";
  let p = draft;
  if (charter) {
    // Provisions: a share of what collecting everything would take.
    const all = solve({ ...p, provisions: 999 });
    const everything = p.places
      .filter((pl) => pl.kind === "cargo")
      .reduce((s, pl) => s + (pl.value ?? 0), 0);
    if (all.best !== everything) return null; // some cargo unreachable
    const [lo, hi] = recipe.provisionShare ?? [0.55, 0.7];
    const share = lo + (hi - lo) * (seededRng(`${draft.id}:prov`)() ?? 0.5);
    p = { ...p, provisions: Math.max(4, Math.round(all.days * share)) };
  }
  const sol = solve(p);
  if (!Number.isFinite(sol.days)) return null;
  if (!charter) p = { ...p, provisions: sol.days + recipe.slack };
  p = { ...p, par: sol.days, best: charter ? sol.best : undefined };

  const m = measure(p);
  if (!m) return null;
  if (m.par < recipe.par[0] || m.par > recipe.par[1]) return null;
  if (recipe.minDetour && m.detour < recipe.minDetour) return null;
  if (recipe.minCurrentGain !== undefined && m.currentGain < recipe.minCurrentGain) return null;
  if (recipe.minGreedyGap !== undefined && m.greedyGap < recipe.minGreedyGap) return null;
  if (recipe.minShallowCost !== undefined && m.shallowCost < recipe.minShallowCost) return null;
  if (recipe.minStormCost !== undefined && m.stormCost < recipe.minStormCost) return null;
  if (recipe.minTideCost !== undefined && m.tideCost < recipe.minTideCost) return null;
  if (recipe.minLureGap !== undefined && m.lureGap < recipe.minLureGap) return null;
  if (recipe.maxLureGap !== undefined && m.lureGap > recipe.maxLureGap) return null;
  if (recipe.naiveFinishes && m.par + m.lureGap > p.provisions) return null;
  if (charter && (m.best <= 0 || m.best >= totalCargo(p))) return null;
  // Every port must be a real stop: reject charts where a current loop or
  // dead end makes a place unreachable (solve above already proves reachability).
  if (!p.places.every((pl) => isNavigable(buildBoard(p).cells[pl.cell]))) return null;

  if (!charter) {
    // Several sensible routes, not one obvious one. The 2★ threshold is the
    // slowest genuinely different route within a fair band above par.
    const cap = m.par + twoStarSlack(m.par);
    const routes = alternativeRoutes(p, 3);
    const viable = routes.filter((r) => r.days <= cap);
    m.routes = viable.length;
    m.kinds = new Set(viable.map((r) => r.kind)).size;
    m.altGap = routes[1] ? routes[1].days - m.par : 99;
    if (m.routes < (recipe.minRoutes ?? 2)) return null;
    if (m.kinds < (recipe.minKinds ?? 1)) return null;
    if (recipe.requireKinds?.some((k) => !viable.some((r) => r.kind === k))) return null;
    // Every genuinely different sensible route earns at least two stars.
    const twoStar = Math.max(m.par + 1, ...viable.map((r) => r.days));
    p = {
      ...p,
      twoStar,
      // Enough provisions for a two-star voyage plus a restart.
      provisions: Math.max(p.provisions, twoStar + 1),
      routes: viable,
    };
    m.provisions = p.provisions;
  }
  if (recipe.exitSide)
    m.exitDistance = sideDistance(p.cols, p.rows, voyageExit(p).cell, recipe.exitSide);

  const interest =
    Math.min(m.detour, 2) * 3 +
    Math.min(m.currentGain, 6) * 0.8 +
    Math.min(m.greedyGap, 6) * 1.2 +
    (m.openings >= 2 && m.openings <= 3 ? 1.5 : 0) +
    (1 - Math.abs(m.openness - 0.55)) * 2 +
    // The obvious route costs stars (but isn't a dead end on its own).
    (charter ? 0 : Math.min(m.lureGap, 5) * 0.8) -
    // Keep the sea lane to tomorrow's region short.
    Math.max(0, m.exitDistance - 2) * 0.7 +
    // Close tradeoffs make the best puzzles: a different route 1–2 days behind.
    (charter ? 0 : m.routes * 1.5 + m.kinds * 1.5 + (m.altGap >= 1 && m.altGap <= 2 ? 2 : 0));

  p.meta = { seed: draft.id, metrics: { ...m } };
  return { puzzle: p, metrics: m, interest };
}

function totalCargo(p: SeafarerPuzzle): number {
  return p.places.reduce((s, pl) => s + (pl.kind === "cargo" ? (pl.value ?? 0) : 0), 0);
}

/** Tries `attempts` seeds and returns the accepted candidates, most interesting first. */
export function generateCandidates(
  recipe: Recipe,
  seedPrefix: string,
  attempts: number,
): Candidate[] {
  const out: Candidate[] = [];
  for (let i = 0; i < attempts; i++) {
    const c = generateCandidate(recipe, `${seedPrefix}-${i}`);
    if (c) out.push(c);
  }
  return out.sort((a, b) => b.interest - a.interest);
}

export { OPPOSITE };
