import { crossingIndexes, treeStats } from "./graph.js";
import { type Placed, boundsOf, cellsOf } from "./grid.js";
import type { DifficultyBreakdown, DifficultyLabel, Weekday } from "./types.js";
import type { UnlockNode } from "./validate.js";

// Composite difficulty. Each component is 0 (easy) … 1 (hard); the score is
// the weighted sum on a 0–100 scale. Weights and weekday bands are plain
// config so they can be tuned without touching the scoring code.

export interface DifficultyInput {
  answers: (UnlockNode & { familiarity: number; alternates: string[] })[];
  start: string;
  revealed: number[];
  /** Category metadata from the content source: 0 narrow/concrete … 1 broad/conceptual. */
  breadth: number;
  /** 0 = members rarely compete for a space … 1 = many near-misses. */
  ambiguity: number;
  actuarial: boolean;
}

export const DIFFICULTY_WEIGHTS = {
  answerCount: 14,
  avgLength: 8,
  maxLength: 6,
  unfamiliarity: 14,
  categoryBreadth: 8,
  startLetters: 8,
  letterInformativeness: 5,
  alternatives: 9,
  branching: 5,
  depth: 6,
  simultaneous: 4,
  gridSize: 3,
  density: 3,
  specialist: 2,
  ambiguity: 5,
} as const;

export type DifficultyWeights = Record<keyof typeof DIFFICULTY_WEIGHTS, number>;

export interface WeekdayTarget {
  label: DifficultyLabel;
  /** Inclusive score band a puzzle must land in. */
  range: [number, number];
  /** Answer counts allowed that day (the overall limit is 4–7). */
  answers: [number, number];
  /** How many starting letters to reveal. */
  revealed: 1 | 2;
  /** Lowest familiarity (1–5) any answer may have. */
  minFamiliarity: number;
  /** Preferred unlock shape; the pipeline tries the other too. */
  shape: "wide" | "deep";
}

/** Index = weekday (0 Sunday … 6 Saturday). Bands overlap so a day rarely goes unfilled. */
export const WEEKDAY_TARGETS: Record<Weekday, WeekdayTarget> = {
  1: {
    label: "Easy",
    range: [0, 34],
    answers: [4, 4],
    revealed: 2,
    minFamiliarity: 4,
    shape: "wide",
  },
  2: {
    label: "Easy–Moderate",
    range: [24, 42],
    answers: [4, 5],
    revealed: 2,
    minFamiliarity: 4,
    shape: "wide",
  },
  3: {
    label: "Moderate",
    range: [34, 52],
    answers: [5, 5],
    revealed: 1,
    minFamiliarity: 3,
    shape: "wide",
  },
  4: {
    label: "Moderate–Hard",
    range: [42, 60],
    answers: [5, 6],
    revealed: 1,
    minFamiliarity: 3,
    shape: "deep",
  },
  5: {
    label: "Hard",
    range: [50, 68],
    answers: [6, 6],
    revealed: 1,
    minFamiliarity: 3,
    shape: "deep",
  },
  6: {
    label: "Hard",
    range: [54, 74],
    answers: [6, 7],
    revealed: 1,
    minFamiliarity: 2,
    shape: "deep",
  },
  0: {
    label: "Hardest",
    range: [60, 100],
    answers: [7, 7],
    revealed: 1,
    minFamiliarity: 2,
    shape: "deep",
  },
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * How much a letter narrows the answer, 0 (tells you little: E, A…) … 1
 * (J, Q, X…). Ordered by English letter frequency.
 */
const FREQUENCY_ORDER = "ETAOINSHRDLCUMWFGYPBVKJXQZ";
export const letterInformation = (ch: string) => {
  const i = FREQUENCY_ORDER.indexOf(ch);
  return i < 0 ? 0.5 : i / (FREQUENCY_ORDER.length - 1);
};

export function difficultyComponents(
  input: DifficultyInput,
): Record<keyof DifficultyWeights, number> {
  const { answers } = input;
  const n = answers.length;
  const lengths = answers.map((a) => a.grid.length);
  const avg = lengths.reduce((t, l) => t + l, 0) / n;
  const fam = answers.reduce((t, a) => t + a.familiarity, 0) / n;
  const stats = treeStats(answers);
  const cells = answers.flatMap(cellsOf);
  const filled = new Set(cells.map(([r, c]) => `${r},${c}`)).size;
  const b = boundsOf(cells);
  const start = answers.find((a) => a.id === input.start) as Placed;

  // Letters the player gets for free: the starting reveal, plus every
  // crossing (supplied by a solved neighbour).
  const given = [
    ...input.revealed.map((i) => start.grid[i]),
    ...answers.flatMap((a) =>
      a.id === input.start ? [] : crossingIndexes(a, answers).map((i) => a.grid[i]),
    ),
  ];
  const info = given.length
    ? given.reduce((t, ch) => t + letterInformation(ch), 0) / given.length
    : 0;
  const alts = answers.reduce((t, a) => t + a.alternates.length, 0) / n;

  return {
    answerCount: clamp01((n - 4) / 3),
    avgLength: clamp01((avg - 3.5) / 4.5),
    maxLength: clamp01((Math.max(...lengths) - 4) / 5),
    unfamiliarity: clamp01((5 - fam) / 3),
    categoryBreadth: clamp01(input.breadth),
    startLetters: input.revealed.length >= 2 ? 0.3 : 1,
    letterInformativeness: clamp01(1 - info * 1.6),
    alternatives: clamp01(alts / 4),
    branching: clamp01((stats.maxBranch - 1) / 2),
    depth: clamp01((stats.depth - 1) / 4),
    simultaneous: clamp01((stats.maxOpen - 1) / 3),
    gridSize: clamp01((b.rows * b.cols - 30) / 70),
    density: clamp01(1 - (filled / (b.rows * b.cols) - 0.15) / 0.3),
    specialist: input.actuarial ? 1 : 0,
    ambiguity: clamp01(input.ambiguity),
  };
}

export function scoreDifficulty(
  input: DifficultyInput,
  weekday: Weekday,
  weights: DifficultyWeights = DIFFICULTY_WEIGHTS,
  targets: Record<Weekday, WeekdayTarget> = WEEKDAY_TARGETS,
): DifficultyBreakdown {
  const components = difficultyComponents(input);
  const total = Object.values(weights).reduce((t, w) => t + w, 0);
  let score = 0;
  for (const [k, w] of Object.entries(weights))
    score += w * components[k as keyof DifficultyWeights];
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, round(v)])),
    weights: { ...weights },
    score: Math.round((score / total) * 1000) / 10,
    target: targets[weekday].range,
  };
}

export const inTarget = (d: DifficultyBreakdown) =>
  d.score >= d.target[0] && d.score <= d.target[1];
