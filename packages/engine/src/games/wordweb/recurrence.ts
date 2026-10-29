import { dayIndex } from "../../core/daily.js";
import type { ValidatorResult } from "./types.js";

// Keeps the daily feed fresh: no category, answer or whole puzzle comes back
// too soon, related categories don't run back to back, and actuarial days
// stay occasional. All comparisons use normalized grid forms.

export const RECURRENCE_RULES = {
  categoryDays: 30,
  answerDays: 14,
  /** No two puzzles from the same category group on consecutive days. */
  groupGapDays: 1,
  /** At most one actuarial category in any window of this many days. */
  actuarialEveryDays: 7,
};

export type RecurrenceRules = typeof RECURRENCE_RULES;

export interface HistoryItem {
  date: string;
  categoryId: string;
  group: string;
  actuarial: boolean;
  answers: string[];
}

export interface RecurrenceCandidate {
  date: string;
  categoryId: string;
  group: string;
  actuarial: boolean;
  answers: string[];
}

const puzzleKey = (c: { categoryId: string; answers: string[] }) =>
  `${c.categoryId}:${[...c.answers].sort().join(",")}`;

/** History within `days` of `date`, either side (the queue can fill gaps between planned days). */
const near = (history: HistoryItem[], date: string, days: number) =>
  history.filter((h) => h.date !== date && Math.abs(dayIndex(h.date) - dayIndex(date)) < days);

/** Category-level checks, before any answers are chosen. */
export function categoryAllowed(
  c: Omit<RecurrenceCandidate, "answers">,
  history: HistoryItem[],
  rules: RecurrenceRules = RECURRENCE_RULES,
): string[] {
  const problems: string[] = [];
  for (const h of near(history, c.date, rules.categoryDays))
    if (h.categoryId === c.categoryId) problems.push(`category ran on ${h.date}`);
  for (const h of near(history, c.date, rules.groupGapDays + 1))
    if (h.group === c.group) problems.push(`related category (${h.group}) on ${h.date}`);
  if (c.actuarial)
    for (const h of near(history, c.date, rules.actuarialEveryDays))
      if (h.actuarial) problems.push(`actuarial category on ${h.date}`);
  return problems;
}

/** What recurrence rules rule out for `date`, so a generator can steer clear up front. */
export function blockedFor(
  date: string,
  history: HistoryItem[],
  rules: RecurrenceRules = RECURRENCE_RULES,
): { categories: string[]; groups: string[]; actuarial: boolean } {
  return {
    categories: [...new Set(near(history, date, rules.categoryDays).map((h) => h.categoryId))],
    groups: [...new Set(near(history, date, rules.groupGapDays + 1).map((h) => h.group))],
    actuarial: near(history, date, rules.actuarialEveryDays).some((h) => h.actuarial),
  };
}

/** Answers used within the answer window of `date`. */
export function recentAnswers(
  date: string,
  history: HistoryItem[],
  rules: RecurrenceRules = RECURRENCE_RULES,
): Set<string> {
  return new Set(near(history, date, rules.answerDays).flatMap((h) => h.answers));
}

export function checkRecurrence(
  c: RecurrenceCandidate,
  history: HistoryItem[],
  rules: RecurrenceRules = RECURRENCE_RULES,
): ValidatorResult[] {
  const recent = recentAnswers(c.date, history, rules);
  const repeated = c.answers.filter((a) => recent.has(a));
  const exact = history.filter((h) => h.date !== c.date && puzzleKey(h) === puzzleKey(c));
  const cat = categoryAllowed(c, history, rules);
  return [
    exact.length
      ? { rule: "no-repeat-puzzle", ok: false, detail: `same puzzle as ${exact[0].date}` }
      : { rule: "no-repeat-puzzle", ok: true },
    cat.length
      ? { rule: "category-recurrence", ok: false, detail: cat.join("; ") }
      : { rule: "category-recurrence", ok: true },
    repeated.length
      ? {
          rule: "answer-recurrence",
          ok: false,
          detail: `${repeated.join(", ")} used within ${rules.answerDays} days`,
        }
      : { rule: "answer-recurrence", ok: true },
  ];
}
