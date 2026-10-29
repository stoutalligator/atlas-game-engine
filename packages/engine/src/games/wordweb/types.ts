// Word Web data model. A puzzle is immutable once published: the layout, the
// unlock tree and every answer are fixed before anyone plays. Player state
// (play.ts) only tracks what's visible, typed, hinted and solved.

export const WORDWEB_SCHEMA_VERSION = 1;

export type Direction = "across" | "down";

/** [row, col] in puzzle coordinates. Row 0 / col 0 is the top-left of the bounds. */
export type Cell = readonly [number, number];

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface WordWebAnswer {
  /** Stable within the puzzle, e.g. "a1". */
  id: string;
  /** How the answer is written ("Gold fish", "T-shirt"). */
  display: string;
  /** Letters only, uppercase: what goes in the grid. */
  grid: string;
  row: number;
  col: number;
  direction: Direction;
  /** null for the starting answer. Solving the parent reveals this answer. */
  parent: string | null;
  /**
   * Reserved for later: every id here must be solved too. The initial game
   * uses `parent` alone, so this is always empty or absent.
   */
  requires?: string[];
  /** Normalized category members that fit this space but aren't the answer. */
  alternates: string[];
  /** 1 (obscure) … 5 (everyone knows it). */
  familiarity: number;
}

/** What the browser needs to play. No generation or validation metadata. */
export interface WordWebPuzzle {
  schemaVersion: number;
  gameType: "wordweb";
  /** Stable content id, e.g. "ww-2026-10-29-household-pets". */
  id: string;
  /** "YYYY-MM-DD", or null for an evergreen fallback. */
  date: string | null;
  category: string;
  weekday: Weekday;
  /** Label for the weekday's band ("Easy", "Hard"…). */
  difficulty: DifficultyLabel;
  /** Composite 0–100 score (difficulty.ts). */
  difficultyScore: number;
  rows: number;
  cols: number;
  answers: WordWebAnswer[];
  start: string;
  /** Indexes into the starting answer that show from the start. */
  revealed: number[];
}

export type DifficultyLabel =
  | "Easy"
  | "Easy–Moderate"
  | "Moderate"
  | "Moderate–Hard"
  | "Hard"
  | "Hardest";

/** One step of a generation attempt, kept for the audit trail. */
export interface ValidatorResult {
  rule: string;
  ok: boolean;
  detail?: string;
}

export interface AnswerMeta {
  id: string;
  display: string;
  fit: string;
  familiarity: number;
  kind: AnswerKind;
}

export type AnswerKind = "noun" | "plural" | "multiword" | "abbreviation";

export interface DifficultyBreakdown {
  components: Record<string, number>;
  weights: Record<string, number>;
  score: number;
  target: [number, number];
}

/**
 * A published puzzle plus everything about how it was made. Hosts store
 * these; players only ever get `toPlayerPuzzle(record)`.
 */
export interface WordWebRecord {
  puzzle: WordWebPuzzle;
  status: "published" | "evergreen";
  /** Category bank id and grouping, for recurrence checks. */
  categoryId: string;
  categoryGroup: string;
  actuarial: boolean;
  answers: AnswerMeta[];
  generation: {
    generator: string;
    generatorVersion: string;
    pipelineVersion: string;
    generatedAt: string;
    seed: number;
    attempts: number;
    constructionAttempts: number;
    rejected: { attempt: number; reasons: string[] }[];
  };
  validation: {
    layout: ValidatorResult[];
    graph: ValidatorResult[];
    safety: ValidatorResult[];
    recurrence: ValidatorResult[];
    difficulty: DifficultyBreakdown;
  };
}

/** The validated queue a host keeps on disk: future dates plus fallbacks. */
export interface WordWebQueue {
  schemaVersion: number;
  /** date → record. Dates are never reassigned once written. */
  days: Record<string, WordWebRecord>;
  /** Validated puzzles for days the queue doesn't cover. */
  evergreen: WordWebRecord[];
}
