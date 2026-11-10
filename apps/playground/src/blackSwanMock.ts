// An in-memory stand-in for the host's Black Swan server, so the game can be
// played in the playground. A real host keeps answers and counts server-side.
import type { BlackSwanApi, BlackSwanSlotResult } from "@stoutalligator/engine";
import {
  BLACK_SWAN_PROMPTS,
  BLACK_SWAN_SECONDS,
  type BlackSwanQuestion,
  dayDistribution,
  matchGuess,
  parseBlackSwanQuestions,
  questionsForDate,
  scoreGuess,
  summarizeDay,
} from "@stoutalligator/engine/server";
import sample from "./packs/black_swan_sample.json";

const POOL: BlackSwanQuestion[] = parseBlackSwanQuestions(sample);

interface Slot {
  openedAt?: number;
  result?: BlackSwanSlotResult;
}
const days = new Map<string, Slot[]>();
const slotsFor = (date: string) => {
  if (!days.has(date))
    days.set(
      date,
      Array.from({ length: BLACK_SWAN_PROMPTS }, () => ({})),
    );
  return days.get(date) as Slot[];
};
const prompts = (date: string) => questionsForDate(POOL, {}, date);

function seeded(seedText: string) {
  let s = [...seedText].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Fake crowd picks, weighted by how familiar each answer is. */
function fakeCounts(q: BlackSwanQuestion): Record<string, number> {
  const rand = seeded(q.id);
  const counts: Record<string, number> = {};
  const n = 200 + Math.floor(rand() * 800);
  const weights = q.answers.map((a) => (a.familiarity ?? 1) * (0.6 + rand() * 0.8));
  const total = weights.reduce((t, w) => t + w, 0);
  for (let i = 0; i < n; i++) {
    let u = rand() * total;
    let j = 0;
    while (j < weights.length - 1 && u > weights[j]) u -= weights[j++];
    counts[q.answers[j].label] = (counts[q.answers[j].label] ?? 0) + 1;
  }
  return counts;
}

/** Fake day scores: a rough bell around 300 out of 700. */
function fakeScores(date: string): number[] {
  const rand = seeded(date);
  return Array.from({ length: 1500 }, () => {
    const z = (rand() + rand() + rand() + rand() - 2) * 1.7;
    return Math.round(Math.min(700, Math.max(0, 300 + z * 110)) / 5) * 5;
  });
}

const remaining = (slot: Slot) =>
  slot.openedAt
    ? Math.max(0, slot.openedAt + BLACK_SWAN_SECONDS * 1000 - Date.now())
    : BLACK_SWAN_SECONDS * 1000;

export const blackSwanMock: BlackSwanApi = {
  async load(date) {
    const qs = prompts(date);
    const slots = slotsFor(date);
    return {
      date,
      prompts: qs.map((q, slot) => ({
        slot,
        questionId: q.id,
        category: q.category,
        prompt: q.prompt,
        answerCount: q.answers.length,
      })),
      slots: slots.map((s, slot) => ({
        slot,
        status: s.result ? "done" : s.openedAt ? "open" : "new",
        remainingMs: remaining(s),
        result: s.result,
      })),
    };
  },
  async open(date, slot) {
    const s = slotsFor(date)[slot];
    s.openedAt ??= Date.now();
    return { remainingMs: remaining(s) };
  },
  async check(date, slot, input) {
    return matchGuess(prompts(date)[slot], input);
  },
  async lock(date, slot, label, input) {
    const s = slotsFor(date)[slot];
    if (s.result) return s.result;
    const q = prompts(date)[slot];
    const late =
      remaining(s) === 0 && Date.now() - (s.openedAt ?? 0) > (BLACK_SWAN_SECONDS + 3) * 1000;
    const ok = label && !late && q.answers.some((a) => a.label === label) ? label : null;
    const counts = fakeCounts(q);
    if (ok) counts[ok] = (counts[ok] ?? 0) + 1; // the player's own pick
    s.result = scoreGuess(q, ok, input, counts);
    return s.result;
  },
  async distribution(date) {
    const results = slotsFor(date).map((s) => s.result);
    if (results.some((r) => !r)) return null;
    const mine = summarizeDay(results as BlackSwanSlotResult[]).score;
    return dayDistribution([...fakeScores(date), mine], mine);
  },
};

export function resetBlackSwanMock(date: string) {
  days.delete(date);
}
