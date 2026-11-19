// Seafarer — monthly expedition packs of route-planning puzzles on a hex sea chart.
// Everything here is theme-free: a pack's look (ocean, ice, space…) lives in theme.ts.

/** The six hex directions (pointy-top hexes, odd rows shifted right). */
export type HexDir = "e" | "ne" | "nw" | "w" | "sw" | "se";

/**
 * One map character per cell:
 *   .  open sea (1 day)          #  land (impassable)
 *   *  reef (impassable)         ,  shallows (2 days)
 *   ~  tidal flats (1 day at high tide, impassable at low tide)
 *   currents carry the ship one cell per step, for free, in their direction.
 *   They use the keys around S on a keyboard: q nw · e ne · a w · d e · z sw · c se
 */
export type Terrain = "sea" | "land" | "reef" | "shallows" | "current" | "flats";

export interface Cell {
  terrain: Terrain;
  /** Set for currents. */
  flow?: HexDir;
}

/**
 * A storm front: the hexes it covers on the voyage's first day, drifting one
 * hex per day in `drift`. Stormy hexes can't be entered (and a ship can't
 * anchor where the storm will be tomorrow). The storm clock restarts with
 * each voyage.
 */
export interface Storm {
  cells: number[];
  drift: HexDir;
}

/**
 * The tide over a chart's tidal flats: a regular cycle of `period` days, the
 * first `high` of which are high tide, shifted by `offset`. On voyage day d
 * the tide is high when (d + offset) mod period < high. Like storms, the
 * tide clock restarts with each voyage.
 */
export interface Tide {
  period: number;
  high: number;
  offset?: number;
}

export type PlaceKind = "harbor" | "port" | "cargo";

/** A side of a region's chart (where it meets its neighbours on the expedition chart). */
export type ChartSide = "n" | "s" | "e" | "w";

export interface Place {
  /** Short stable id, e.g. "A". */
  id: string;
  kind: PlaceKind;
  /** Cell index (row * cols + col). Always a sea cell. */
  cell: number;
  name: string;
  /** Cargo value (Charter). */
  value?: number;
}

/**
 * - voyage: sail from the harbor to the one port in the fewest days.
 * - rounds: call at every port (any order), optionally returning to the harbor.
 * - charter: within the provisions, collect the most cargo and end at the harbor.
 */
export type Objective =
  | { type: "voyage" }
  | { type: "rounds"; returnHome: boolean }
  | { type: "charter" };

export interface SeafarerPuzzle {
  /** Stable id, e.g. "shattered-isles-07". */
  id: string;
  /** 1-based position in the pack. */
  number: number;
  title: string;
  cols: number;
  rows: number;
  /** `rows` strings of `cols` characters (see Terrain). */
  map: string[];
  places: Place[];
  /** Storm fronts (none on most charts). */
  storms?: Storm[];
  /** The tide over the chart's tidal flats (charts with `~` hexes only). */
  tide?: Tide;
  objective: Objective;
  /** Days of provisions: the route can't cost more. */
  provisions: number;
  /** Fewest days for a perfect voyage (for charter: fewest days that carry `best`). */
  par: number;
  /** Charter only: the most cargo that can be delivered within the provisions. */
  best?: number;
  /**
   * Voyage/rounds: most days that still earn two stars, set from the best
   * genuinely different route the solver found (see generator.ts).
   */
  twoStar?: number;
  /** Distinct strong routes the solver found (the first is optimal), shown after finishing. */
  routes?: ReferenceRoute[];
  /** 1 (gentle) – 5 (hardest). */
  difficulty: number;
  /** Optional one-line tip, shown on days that introduce something new. */
  tip?: string;
  /** Generator seed and metrics, kept for reproducibility and review. */
  meta?: { seed?: string; metrics?: Record<string, number> };
}

/** How a route mostly gets there, for labelling it. */
export type RouteKind = "storm" | "current" | "shallows" | "open";

export interface ReferenceRoute {
  days: number;
  kind: RouteKind;
  taps: number[];
}

export type BadgeTierKey = "bronze" | "silver" | "gold";

export interface SeafarerPack {
  /** Stable pack id, e.g. "shattered-isles". */
  id: string;
  title: string;
  description: string;
  /** Presentation theme (see theme.ts); the rules never read it. */
  theme: string;
  puzzles: SeafarerPuzzle[];
  /** Challenges completed for each badge tier. */
  badgeTiers: Record<BadgeTierKey, number>;
}

/**
 * What the player did: the final voyage's taps, in order, and how many times
 * they returned to harbor first. The server replays it.
 */
export interface SeafarerProof {
  puzzleId: string;
  taps: number[];
  restarts?: number;
}
