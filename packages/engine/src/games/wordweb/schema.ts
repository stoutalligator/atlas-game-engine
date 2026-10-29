import { isDateKey } from "../../core/daily.js";
import { normalizeWord } from "./normalize.js";
import {
  type DifficultyLabel,
  WORDWEB_SCHEMA_VERSION,
  type Weekday,
  type WordWebAnswer,
  type WordWebPuzzle,
  type WordWebQueue,
  type WordWebRecord,
} from "./types.js";
import { failures, validateLayout, validateStart, validateUnlockGraph } from "./validate.js";

// Runtime checks at every ingestion point (host files, browser props). A
// puzzle that fails here is never shown; the caller falls back instead.

export class WordWebPuzzleError extends Error {}

const LABELS: DifficultyLabel[] = [
  "Easy",
  "Easy–Moderate",
  "Moderate",
  "Moderate–Hard",
  "Hard",
  "Hardest",
];
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const int = (v: unknown, path: string, min = 0): number => {
  if (!Number.isInteger(v) || (v as number) < min)
    throw new WordWebPuzzleError(`${path} must be an integer ≥ ${min}`);
  return v as number;
};
const str = (v: unknown, path: string): string => {
  if (typeof v !== "string" || !v.trim())
    throw new WordWebPuzzleError(`${path} must be a non-empty string`);
  return v;
};

function parseAnswer(raw: unknown, i: number): WordWebAnswer {
  const at = `answers[${i}]`;
  if (!isObj(raw)) throw new WordWebPuzzleError(`${at} must be an object`);
  const display = str(raw.display, `${at}.display`);
  const grid = str(raw.grid, `${at}.grid`);
  if (normalizeWord(display) !== grid)
    throw new WordWebPuzzleError(`${at}.grid must be the normalized display`);
  if (raw.direction !== "across" && raw.direction !== "down")
    throw new WordWebPuzzleError(`${at}.direction must be across or down`);
  if (raw.parent !== null && typeof raw.parent !== "string")
    throw new WordWebPuzzleError(`${at}.parent must be an id or null`);
  if (
    !Array.isArray(raw.alternates) ||
    raw.alternates.some((a) => typeof a !== "string" || normalizeWord(a) !== a)
  )
    throw new WordWebPuzzleError(`${at}.alternates must be normalized strings`);
  const familiarity = int(raw.familiarity, `${at}.familiarity`, 1);
  if (familiarity > 5) throw new WordWebPuzzleError(`${at}.familiarity must be 1–5`);
  return {
    id: str(raw.id, `${at}.id`),
    display,
    grid,
    row: int(raw.row, `${at}.row`),
    col: int(raw.col, `${at}.col`),
    direction: raw.direction,
    parent: raw.parent as string | null,
    requires: Array.isArray(raw.requires)
      ? raw.requires.map((r, j) => str(r, `${at}.requires[${j}]`))
      : undefined,
    alternates: raw.alternates as string[],
    familiarity,
  };
}

/** Validates unknown JSON as a playable puzzle, including every hard layout and unlock rule. */
export function parseWordWebPuzzle(raw: unknown): WordWebPuzzle {
  if (!isObj(raw)) throw new WordWebPuzzleError("puzzle must be an object");
  if (raw.gameType !== "wordweb") throw new WordWebPuzzleError('gameType must be "wordweb"');
  if (raw.schemaVersion !== WORDWEB_SCHEMA_VERSION)
    throw new WordWebPuzzleError(`schemaVersion ${String(raw.schemaVersion)} is not supported`);
  if (raw.date !== null && (typeof raw.date !== "string" || !isDateKey(raw.date)))
    throw new WordWebPuzzleError("date must be YYYY-MM-DD or null");
  const weekday = int(raw.weekday, "weekday");
  if (weekday > 6) throw new WordWebPuzzleError("weekday must be 0–6");
  if (!LABELS.includes(raw.difficulty as DifficultyLabel))
    throw new WordWebPuzzleError("difficulty label unknown");
  if (typeof raw.difficultyScore !== "number")
    throw new WordWebPuzzleError("difficultyScore must be a number");
  if (!Array.isArray(raw.answers)) throw new WordWebPuzzleError("answers must be an array");
  if (!Array.isArray(raw.revealed)) throw new WordWebPuzzleError("revealed must be an array");
  const puzzle: WordWebPuzzle = {
    schemaVersion: WORDWEB_SCHEMA_VERSION,
    gameType: "wordweb",
    id: str(raw.id, "id"),
    date: raw.date as string | null,
    category: str(raw.category, "category"),
    weekday: weekday as Weekday,
    difficulty: raw.difficulty as DifficultyLabel,
    difficultyScore: raw.difficultyScore,
    rows: int(raw.rows, "rows", 1),
    cols: int(raw.cols, "cols", 1),
    answers: raw.answers.map(parseAnswer),
    start: str(raw.start, "start"),
    revealed: raw.revealed.map((r, i) => int(r, `revealed[${i}]`)),
  };
  const start = puzzle.answers.find((a) => a.id === puzzle.start);
  const problems = failures([
    ...validateLayout(puzzle.answers, { rows: puzzle.rows, cols: puzzle.cols }),
    ...validateUnlockGraph(puzzle.answers, puzzle.start),
    validateStart(start, puzzle.revealed),
  ]);
  if (problems.length) throw new WordWebPuzzleError(`${puzzle.id}: ${problems.join(" | ")}`);
  return puzzle;
}

/** A stored record: its puzzle must parse, and it must carry the audit fields. */
export function parseWordWebRecord(raw: unknown): WordWebRecord {
  if (!isObj(raw)) throw new WordWebPuzzleError("record must be an object");
  const puzzle = parseWordWebPuzzle(raw.puzzle);
  if (raw.status !== "published" && raw.status !== "evergreen")
    throw new WordWebPuzzleError("status unknown");
  if (!isObj(raw.generation) || !isObj(raw.validation))
    throw new WordWebPuzzleError(`${puzzle.id}: audit fields missing`);
  if (!Array.isArray(raw.answers) || raw.answers.length !== puzzle.answers.length)
    throw new WordWebPuzzleError(`${puzzle.id}: answer metadata must cover every answer`);
  return { ...(raw as unknown as WordWebRecord), puzzle };
}

/** A queue file. Bad days are reported, not fatal: they're dropped so the rest still serves. */
export function parseWordWebQueue(raw: unknown): { queue: WordWebQueue; errors: string[] } {
  const errors: string[] = [];
  const queue: WordWebQueue = { schemaVersion: WORDWEB_SCHEMA_VERSION, days: {}, evergreen: [] };
  if (!isObj(raw)) return { queue, errors: ["queue must be an object"] };
  if (isObj(raw.days))
    for (const [date, rec] of Object.entries(raw.days)) {
      try {
        const r = parseWordWebRecord(rec);
        if (r.puzzle.date !== date)
          throw new WordWebPuzzleError(`${r.puzzle.id} is filed under ${date}`);
        queue.days[date] = r;
      } catch (err) {
        errors.push(`${date}: ${(err as Error).message}`);
      }
    }
  if (Array.isArray(raw.evergreen))
    raw.evergreen.forEach((rec, i) => {
      try {
        queue.evergreen.push(parseWordWebRecord(rec));
      } catch (err) {
        errors.push(`evergreen[${i}]: ${(err as Error).message}`);
      }
    });
  return { queue, errors };
}
