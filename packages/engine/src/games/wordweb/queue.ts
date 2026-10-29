import { addDays, dayIndex, weekday } from "../../core/daily.js";
import { HOUSEHOLD_PETS } from "./fixture.js";
import { type PipelineOptions, generateForDate } from "./pipeline.js";
import type { HistoryItem } from "./recurrence.js";
import { parseWordWebPuzzle } from "./schema.js";
import {
  WORDWEB_SCHEMA_VERSION,
  type WordWebPuzzle,
  type WordWebQueue,
  type WordWebRecord,
} from "./types.js";

// The validated rolling queue. The scheduler fills dates that don't have a
// puzzle yet and never touches a date that does, so running it twice can't
// give one date two puzzles. Serving falls back from the scheduled puzzle to
// a validated evergreen one to the built-in fixture — never to anything
// unvalidated.

export const QUEUE_DEFAULTS = {
  /** Keep at least this many validated future days. */
  minFutureDays: 7,
  /** How far ahead a planning run fills. */
  targetFutureDays: 14,
};

export const emptyQueue = (): WordWebQueue => ({
  schemaVersion: WORDWEB_SCHEMA_VERSION,
  days: {},
  evergreen: [],
});

export function historyFromQueue(queue: WordWebQueue): HistoryItem[] {
  return Object.entries(queue.days).map(([date, r]) => ({
    date,
    categoryId: r.categoryId,
    group: r.categoryGroup,
    actuarial: r.actuarial,
    answers: r.puzzle.answers.map((a) => a.grid),
  }));
}

/** Validated days from `today` onward (today included). */
export function futureDays(queue: WordWebQueue, today: string): string[] {
  return Object.keys(queue.days)
    .filter((d) => d >= today)
    .sort();
}

export interface PlanOptions extends Omit<PipelineOptions, "date" | "history"> {
  queue: WordWebQueue;
  /** First date to fill (usually today). */
  from: string;
  /** Dates to cover from `from`. */
  days?: number;
}

export interface PlanResult {
  queue: WordWebQueue;
  added: string[];
  /** Dates still without a puzzle after every retry: they'll serve a fallback. */
  failed: { date: string; reasons: string[] }[];
}

/** Fills empty dates in [from, from + days). Existing dates are left exactly as they are. */
export async function planQueue(options: PlanOptions): Promise<PlanResult> {
  const { queue, from, days = QUEUE_DEFAULTS.targetFutureDays, ...pipeline } = options;
  const next: WordWebQueue = { ...queue, days: { ...queue.days }, evergreen: [...queue.evergreen] };
  const added: string[] = [];
  const failed: PlanResult["failed"] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    if (next.days[date]) continue;
    const { record, rejected } = await generateForDate({
      ...pipeline,
      date,
      history: historyFromQueue(next),
    });
    if (record) {
      next.days[date] = record;
      added.push(date);
    } else {
      failed.push({ date, reasons: rejected.flatMap((r) => r.reasons).slice(0, 20) });
    }
  }
  return { queue: next, added, failed };
}

export type PuzzleSource = "scheduled" | "evergreen" | "fixture";

/** Host side: the record to serve for a date. */
export function recordForDate(
  queue: WordWebQueue,
  date: string,
): { record: WordWebRecord; source: PuzzleSource } {
  const scheduled = queue.days[date];
  if (scheduled) return { record: scheduled, source: "scheduled" };
  const evergreen = pickEvergreen(queue.evergreen, (r) => r.puzzle.weekday, date);
  if (evergreen) return { record: evergreen, source: "evergreen" };
  return { record: HOUSEHOLD_PETS, source: "fixture" };
}

/**
 * Browser side: picks today's puzzle from what the host sent. Anything that
 * doesn't parse is skipped, never shown.
 */
export function wordWebForDate(
  raw: readonly unknown[],
  date: string,
): { puzzle: WordWebPuzzle; source: PuzzleSource } {
  const valid: WordWebPuzzle[] = [];
  for (const item of raw) {
    if (!item || (item as { gameType?: unknown }).gameType !== "wordweb") continue;
    try {
      valid.push(parseWordWebPuzzle(item));
    } catch {
      // Malformed or invalid: skipped.
    }
  }
  const scheduled = valid.find((p) => p.date === date);
  if (scheduled) return { puzzle: scheduled, source: "scheduled" };
  const evergreen = pickEvergreen(
    valid.filter((p) => p.date === null),
    (p) => p.weekday,
    date,
  );
  if (evergreen) return { puzzle: evergreen, source: "evergreen" };
  return { puzzle: HOUSEHOLD_PETS.puzzle, source: "fixture" };
}

/** An evergreen puzzle for `date`, preferring one built for the same weekday's difficulty. */
function pickEvergreen<T>(items: T[], weekdayOf: (item: T) => number, date: string): T | null {
  if (!items.length) return null;
  const same = items.filter((i) => weekdayOf(i) === weekday(date));
  const pool = same.length ? same : items;
  return pool[dayIndex(date) % pool.length];
}

/**
 * Turns a validated dated record into an evergreen fallback: same puzzle,
 * no date, its own id. It keeps its weekday so it's served on matching days.
 */
export function toEvergreen(record: WordWebRecord): WordWebRecord {
  return {
    ...record,
    status: "evergreen",
    puzzle: {
      ...record.puzzle,
      id: record.puzzle.id.replace(/^ww-\d{4}-\d{2}-\d{2}-/, "ww-evergreen-"),
      date: null,
    },
  };
}
