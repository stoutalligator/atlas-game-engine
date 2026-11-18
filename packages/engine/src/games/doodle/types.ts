// Doodle: "Draw what's missing." Shared shapes for sources, variants, the
// player-facing puzzle and results. All geometry lives in one normalized
// coordinate system: x runs 0–1000 across the canvas, y runs 0–height down it
// (height is the source's, usually 600–1000). Phones and desktops draw into
// the same numbers, so a drawing scores the same on any screen.

/** A point in canvas units. */
export type DoodlePoint = [number, number];
/** An open polyline. A closed outline repeats its first point at the end. */
export type DoodlePath = DoodlePoint[];

/** Axis-aligned rectangle in canvas units. */
export interface DoodleRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Canvas width in normalized units; every source uses it. */
export const DOODLE_WIDTH = 1000;

/** The three content types (see the Doodle spec, section 4). */
export const DOODLE_TYPES = ["shape", "line", "trend"] as const;
export type DoodleType = (typeof DOODLE_TYPES)[number];

export const DOODLE_DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type DoodleDifficulty = (typeof DOODLE_DIFFICULTIES)[number];

/** Where a source's geometry came from, kept with the source for review and licensing. */
export interface DoodleProvenance {
  /** How the geometry was made. V1 only accepts human-checked geometry. */
  method: "manual" | "public-domain" | "open-data" | "ai-assisted";
  /** Human-readable origin, e.g. "Natural Earth 1:110m admin-1" or "Hand-drawn". */
  source: string;
  /** e.g. "Public domain", "CC0-1.0", "CC-BY-4.0", "Original (ATLAS)". */
  license: string;
  url?: string;
  attribution?: string;
  /** Who checked it, when (V1 requires a human check). */
  checkedBy?: string;
  notes?: string;
}

/** A text label drawn with the puzzle (axis years, a city name). Never scored. */
export interface DoodleLabel {
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle" | "end";
}

/** A trend source's underlying numbers, kept so the chart can be redrawn from data. */
export interface DoodleSeries {
  /** What is measured, e.g. 'Google searches for "pumpkin spice"'. */
  measure: string;
  /** Region / unit notes, e.g. "United States, relative interest 0–100". */
  unit?: string;
  points: Array<[string, number]>;
}

/**
 * The complete canonical object, path or data series — stored once however
 * many variants use it.
 */
export interface DoodleSource {
  /** Stable slug, e.g. "apple" or "trend-pumpkin-spice". */
  id: string;
  type: DoodleType;
  /** Shown as a pill: "food", "geography", "animals", "landmarks"… */
  category: string;
  /** What it is: "an apple", "Montana", "the Mississippi River". */
  title: string;
  /** Overrides the default prompt for the type. */
  prompt?: string;
  /** Canvas height in units (width is always 1000). */
  height: number;
  /** The scored geometry. */
  paths: DoodlePath[];
  /** Context that is always shown and never scored (chart axes, a state outline around a river). */
  guides?: DoodlePath[];
  labels?: DoodleLabel[];
  /** Trend sources: the numbers the chart was drawn from. */
  series?: DoodleSeries;
  provenance: DoodleProvenance;
}

/** How a variant hides part of its source. */
export interface DoodleMask {
  /** Rectangles that hide the source; their union is also the drawing region. */
  rects: DoodleRect[];
  /** Which generator made it, e.g. "side-right" or "middle-v". */
  strategy: string;
}

/** Numbers the validator and review screen use. */
export interface DoodleVariantMetrics {
  /** Share of the source's length left visible, 0–1. */
  visibility: number;
  /** Total length of the missing geometry, in units. */
  missingLength: number;
  /** Turning (radians) per 100 units of missing geometry: higher = more detail. */
  detail: number;
  /** Missing pieces, i.e. reference paths. */
  missingRuns: number;
  /** Drawing region as a share of the canvas. */
  regionShare: number;
}

/** A playable cut of a source. Stores only the mask; geometry comes from the source. */
export interface DoodleVariant {
  /** Stable id, `${sourceId}~${strategy}-${difficulty}`. */
  id: string;
  sourceId: string;
  difficulty: DoodleDifficulty;
  mask: DoodleMask;
  metrics: DoodleVariantMetrics;
}

/** What the browser gets before submitting: nothing that gives the answer away. */
export interface DoodlePuzzle {
  /** The variant id (so a submission is tied to what the player saw). */
  id: string;
  type: DoodleType;
  category: string;
  difficulty: DoodleDifficulty;
  prompt: string;
  width: number;
  height: number;
  /** The visible part of the source. */
  visible: DoodlePath[];
  guides: DoodlePath[];
  labels: DoodleLabel[];
  /** Where the player may draw (the hidden area). */
  region: DoodleRect[];
  /** Share of the source shown, 0–1. */
  visibility: number;
}

/** A finished Doodle: the score plus the answer, only sent after submitting. */
export interface DoodleResult {
  /** 0–100 match (integer). */
  score: number;
  /** 0–1: how much of the player's ink was near the answer. */
  precision: number;
  /** 0–1: how much of the answer the player drew. */
  coverage: number;
  /** The player's own strokes (clipped, simplified), for the reveal. */
  strokes: DoodlePath[];
  /** The missing geometry, in reveal order. */
  reference: DoodlePath[];
  /** Where the source came from, shown under the reveal. */
  credit?: string;
}
