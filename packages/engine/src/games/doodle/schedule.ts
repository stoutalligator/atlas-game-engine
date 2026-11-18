// Doodle scheduling: which approved variant runs on which day, and how
// healthy the reserve is. Pure: the host loads the bank and history, calls
// these, and saves the result.

import { addDays, dayIndex, isDateKey, weekday } from "../../core/daily.js";
import { hashString } from "../../core/rng.js";
import type { DoodleDifficulty, DoodleType } from "./types.js";
import { DOODLE_DIFFICULTIES } from "./types.js";

/** Days the schedule is kept filled ahead. */
export const DOODLE_SCHEDULE_DAYS = 14;
/** A source can't run again within this many days. */
export const DOODLE_SOURCE_COOLDOWN = 120;
/** A category shouldn't repeat within this many days (soft). */
export const DOODLE_CATEGORY_GAP = 3;

/**
 * Allowed difficulties per weekday (0 = Sunday), easiest first. Monday and
 * Tuesday easy, Wednesday easy or medium, Thursday and Friday medium,
 * Saturday medium or hard, Sunday hard.
 */
export const DOODLE_WEEKDAY_DIFFICULTY: Record<number, DoodleDifficulty[]> = {
  0: ["hard"],
  1: ["easy"],
  2: ["easy"],
  3: ["easy", "medium"],
  4: ["medium"],
  5: ["medium"],
  6: ["medium", "hard"],
};

export const doodleDifficultiesFor = (date: string) => DOODLE_WEEKDAY_DIFFICULTY[weekday(date)];

/** What the scheduler needs to know about an approved variant. */
export interface DoodlePoolItem {
  id: string;
  sourceId: string;
  difficulty: DoodleDifficulty;
  category: string;
  type: DoodleType;
  /** ISO timestamp; older approvals go first when otherwise equal. */
  approvedAt: string;
}

export interface DoodlePlanOptions {
  /** First date to fill (YYYY-MM-DD). */
  start: string;
  days?: number;
  /**
   * Every day already used or planned (past puzzles included): date →
   * variant id. Planned days are kept; all of them count for repeats and
   * cooldowns.
   */
  history?: Record<string, string>;
  /** Variant id → source id for history entries that are no longer in the pool. */
  sourceOf?: Record<string, string>;
  /** Variant id → category/type for history entries no longer in the pool. */
  metaOf?: Record<string, { category: string; type: DoodleType }>;
  cooldownDays?: number;
}

export interface DoodlePlan {
  /** The full schedule: history + newly planned days, by date. */
  schedule: Record<string, string>;
  /** Dates added by this run. */
  added: string[];
  /** Problems a person should hear about (no eligible puzzle, difficulty substituted…). */
  warnings: string[];
}

const DIFF_RANK: Record<DoodleDifficulty, number> = { easy: 0, medium: 1, hard: 2 };

/**
 * Fills every unplanned day from `start` for `days` days. Rules, in order:
 * never repeat a variant; never reuse a source within the cooldown (either
 * side of the day, so future plans count too); match the weekday's
 * difficulty (nearest difficulty as a warned fallback); avoid recent
 * categories and yesterday's content type; older approvals first; then a
 * deterministic hash of date + id.
 */
export function planDoodleSchedule(
  pool: readonly DoodlePoolItem[],
  opts: DoodlePlanOptions,
): DoodlePlan {
  const { start } = opts;
  if (!isDateKey(start)) throw new Error(`Bad start date ${start}`);
  const days = opts.days ?? DOODLE_SCHEDULE_DAYS;
  const cooldown = opts.cooldownDays ?? DOODLE_SOURCE_COOLDOWN;
  const byId = new Map(pool.map((v) => [v.id, v]));
  const schedule: Record<string, string> = { ...(opts.history ?? {}) };
  const usedVariants = new Set(Object.values(schedule));
  const sourceDays = new Map<string, number[]>();
  const dayMeta = new Map<number, { category: string; type: DoodleType }>();
  const note = (id: string, day: number) => {
    const v = byId.get(id);
    const src = v?.sourceId ?? opts.sourceOf?.[id];
    if (src) {
      const list = sourceDays.get(src) ?? [];
      list.push(day);
      sourceDays.set(src, list);
    }
    const meta = v ? { category: v.category, type: v.type } : opts.metaOf?.[id];
    if (meta) dayMeta.set(day, meta);
  };
  for (const [date, id] of Object.entries(schedule)) note(id, dayIndex(date));

  const added: string[] = [];
  const warnings: string[] = [];
  const unfilled: string[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    if (schedule[date]) continue;
    const today = dayIndex(date);
    const rested = (v: DoodlePoolItem) =>
      (sourceDays.get(v.sourceId) ?? []).every((d) => Math.abs(d - today) >= cooldown);
    const eligible = pool.filter((v) => !usedVariants.has(v.id) && rested(v));
    const wanted = doodleDifficultiesFor(date);
    let candidates = eligible.filter((v) => wanted.includes(v.difficulty));
    if (candidates.length === 0 && eligible.length > 0) {
      // Nearest difficulty to what the day wants.
      const target = DIFF_RANK[wanted[0]];
      const gap = (v: DoodlePoolItem) =>
        Math.min(...wanted.map((w) => Math.abs(DIFF_RANK[v.difficulty] - DIFF_RANK[w]))) +
        (DIFF_RANK[v.difficulty] < target ? 0.1 : 0);
      const best = Math.min(...eligible.map(gap));
      candidates = eligible.filter((v) => gap(v) === best);
      warnings.push(
        `${date}: no ${wanted.join("/")} puzzle available; using ${candidates[0].difficulty} instead.`,
      );
    }
    if (candidates.length === 0) {
      unfilled.push(date);
      continue;
    }
    const recent = (k: number) => dayMeta.get(today - k);
    const penalty = (v: DoodlePoolItem) => {
      let p = 0;
      for (let k = 1; k <= DOODLE_CATEGORY_GAP; k++)
        if (recent(k)?.category === v.category) p += 10 * (DOODLE_CATEGORY_GAP + 1 - k);
      if (recent(1)?.type === v.type) p += 4;
      if (recent(2)?.type === v.type) p += 1;
      // Two-difficulty days lean to the first listed (Wednesday easy, Saturday medium) a little.
      if (wanted.length > 1 && v.difficulty !== wanted[0]) p += 0.5;
      return p;
    };
    const tie = (v: DoodlePoolItem) => hashString(`${date}:${v.id}`);
    candidates.sort(
      (a, b) =>
        penalty(a) - penalty(b) || a.approvedAt.localeCompare(b.approvedAt) || tie(a) - tie(b),
    );
    const pick = candidates[0];
    schedule[date] = pick.id;
    usedVariants.add(pick.id);
    note(pick.id, today);
    added.push(date);
  }
  if (unfilled.length)
    warnings.push(
      `${unfilled.length === 1 ? unfilled[0] : `${unfilled.length} days (${unfilled[0]} to ${unfilled[unfilled.length - 1]})`}: ` +
        `no eligible Doodle (${pool.length === 0 ? "nothing is approved yet" : "every approved variant is used or its source is cooling down"}).`,
    );
  const sorted = Object.fromEntries(
    Object.entries(schedule).sort(([a], [b]) => a.localeCompare(b)),
  );
  return { schedule: sorted, added, warnings };
}

/** Reserve thresholds (approved, unused, not already in the schedule). */
export const DOODLE_INVENTORY = { healthy: 120, generate: 60, critical: 30 } as const;
export type DoodleInventoryLevel = "healthy" | "generate" | "warning" | "critical";

export function doodleInventoryLevel(reserve: number): DoodleInventoryLevel {
  if (reserve >= DOODLE_INVENTORY.healthy) return "healthy";
  if (reserve >= DOODLE_INVENTORY.generate) return "generate";
  if (reserve >= DOODLE_INVENTORY.critical) return "warning";
  return "critical";
}

/** Reserve per difficulty, for the admin panel. */
export function doodleReserveByDifficulty(
  pool: readonly DoodlePoolItem[],
  used: ReadonlySet<string>,
) {
  const out: Record<DoodleDifficulty, number> = { easy: 0, medium: 0, hard: 0 };
  for (const v of pool) if (!used.has(v.id)) out[v.difficulty]++;
  return out;
}

export { DOODLE_DIFFICULTIES };
