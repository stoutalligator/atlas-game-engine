// Black Swan — name an answer that fits the prompt; the rarer it is among
// everyone's answers, the more it scores. Pure logic only (no React, no I/O):
// the host stores guesses and passes answer counts in, so it runs on a server.

import { addDays, dayIndex, isDateKey } from "../../core/daily.js";

export const BLACK_SWAN_PROMPTS = 5;
export const BLACK_SWAN_SECONDS = 25;
/** Simulated players behind each question's prior (the credibility constant k). */
export const BLACK_SWAN_CREDIBILITY_K = 200;

export interface BlackSwanAnswer {
  label: string;
  aliases: string[];
  /** Relative weight: roughly how many of 100 simulated players give this answer. */
  prior: number;
}

export interface BlackSwanQuestion {
  id: string;
  category: string;
  prompt: string;
  answers: BlackSwanAnswer[];
}

export class BlackSwanPackError extends Error {}

/**
 * Tiers cut the answer list, ranked by how common each answer is, into fixed
 * slices: the most common 20% of answers are Mode, the next 30% Expected, then
 * 35% Within σ, 12% Tail, and the rarest 3% (always at least one) Black Swan.
 * `upTo` is each tier's upper bound on the rarity position p (see RarityRow).
 */
export const BLACK_SWAN_TIERS = [
  {
    key: "mode",
    name: "Mode",
    points: 10,
    upTo: 0.2,
    fraction: 0.2,
    range: "Most common 20% of answers",
  },
  { key: "expected", name: "Expected", points: 25, upTo: 0.5, fraction: 0.3, range: "Next 30%" },
  { key: "sigma", name: "Within σ", points: 50, upTo: 0.85, fraction: 0.35, range: "Next 35%" },
  { key: "tail", name: "Tail", points: 100, upTo: 0.97, fraction: 0.12, range: "Next 12%" },
  {
    key: "swan",
    name: "Black Swan",
    points: 200,
    upTo: Number.POSITIVE_INFINITY,
    fraction: 0.03,
    range: "Rarest 3%",
  },
] as const;

export type BlackSwanTier = (typeof BLACK_SWAN_TIERS)[number];
export type BlackSwanTierKey = BlackSwanTier["key"];
export const BLACK_SWAN_MAX_SCORE = BLACK_SWAN_PROMPTS * BLACK_SWAN_TIERS[4].points;

export function tierFor(p: number): BlackSwanTier {
  return BLACK_SWAN_TIERS.find((t) => p < t.upTo) ?? BLACK_SWAN_TIERS[4];
}

/**
 * How many of `n` ranked answers fall in each tier (Mode … Black Swan), sized to
 * the tier fractions with at least one answer per tier. 33 answers → 7 / 10 / 11 / 4 / 1.
 */
export function blackSwanTierSizes(n: number): number[] {
  const at = (i: number) => Math.max(1, Math.round(n * BLACK_SWAN_TIERS[i].fraction));
  const sizes = [at(0), at(1), 0, at(3), at(4)];
  sizes[2] = n - sizes[0] - sizes[1] - sizes[3] - sizes[4];
  // Very short lists: borrow from the bigger common tiers so Within σ keeps one.
  while (sizes[2] < 1) {
    const from = sizes[0] >= sizes[1] && sizes[0] > 1 ? 0 : sizes[1] > 1 ? 1 : -1;
    if (from < 0) break;
    sizes[from]--;
    sizes[2]++;
  }
  return sizes;
}

// ── matching ────────────────────────────────────────────────────────────────

/** Lower-case, strip accents and punctuation, collapse spaces. */
export function normalizeGuess(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Typos allowed for a form of this length. */
const tolerance = (n: number) => (n >= 9 ? 2 : n >= 5 ? 1 : 0);

export interface GuessMatch {
  /** "exact": the player typed the answer itself. "suggest": an alias or a near miss — confirm first. */
  kind: "exact" | "suggest";
  label: string;
}

/** Matches a typed guess to an accepted answer, or null if it isn't one. */
export function matchGuess(question: BlackSwanQuestion, input: string): GuessMatch | null {
  const x = normalizeGuess(input);
  if (!x) return null;
  const xs = x.replace(/ /g, "");
  let best: { label: string; d: number; exact: boolean } | null = null;
  for (const a of question.answers) {
    const forms = [a.label, ...a.aliases];
    for (let f = 0; f < forms.length; f++) {
      const form = normalizeGuess(forms[f]);
      if (!form) continue;
      const fs = form.replace(/ /g, "");
      const tol = tolerance(fs.length);
      const d = Math.min(levenshtein(x, form, tol), levenshtein(xs, fs, tol));
      if (d > tol) continue;
      const exact = f === 0 && d === 0;
      if (!best || d < best.d || (d === best.d && exact && !best.exact))
        best = { label: a.label, d, exact };
    }
  }
  return best ? { kind: best.exact ? "exact" : "suggest", label: best.label } : null;
}

// ── pack parsing ────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/**
 * Validates raw question JSON (an array of questions, or { questions: [...] }).
 * Throws BlackSwanPackError naming the first problem, including any alias that
 * would match two different answers.
 */
export function parseBlackSwanQuestions(raw: unknown): BlackSwanQuestion[] {
  const list = Array.isArray(raw)
    ? raw
    : isObj(raw) && Array.isArray(raw.questions)
      ? raw.questions
      : null;
  if (!list)
    throw new BlackSwanPackError("Expected an array of questions or { questions: [...] }.");
  const ids = new Set<string>();
  return list.map((q, i) => {
    const where = `question ${i + 1}`;
    if (!isObj(q)) throw new BlackSwanPackError(`${where} is not an object.`);
    const { id, category, prompt, answers } = q;
    if (typeof id !== "string" || !id) throw new BlackSwanPackError(`${where} has no id.`);
    if (ids.has(id)) throw new BlackSwanPackError(`Duplicate question id ${id}.`);
    ids.add(id);
    if (typeof category !== "string" || !category)
      throw new BlackSwanPackError(`${id} has no category.`);
    if (typeof prompt !== "string" || !prompt) throw new BlackSwanPackError(`${id} has no prompt.`);
    if (!Array.isArray(answers) || answers.length < 5)
      throw new BlackSwanPackError(`${id} needs at least 5 accepted answers.`);
    const seen = new Map<string, string>();
    const parsed = answers.map((a, j): BlackSwanAnswer => {
      if (!isObj(a) || typeof a.label !== "string" || !a.label)
        throw new BlackSwanPackError(`${id} answer ${j + 1} has no label.`);
      const prior = a.prior;
      if (typeof prior !== "number" || !(prior > 0))
        throw new BlackSwanPackError(`${id} "${a.label}" needs a positive prior.`);
      const aliases = Array.isArray(a.aliases)
        ? a.aliases.filter((x): x is string => typeof x === "string")
        : [];
      for (const form of [a.label, ...aliases]) {
        const k = normalizeGuess(form);
        if (!k) continue;
        const other = seen.get(k);
        if (other && other !== a.label)
          throw new BlackSwanPackError(
            `${id}: "${form}" matches both "${other}" and "${a.label}".`,
          );
        seen.set(k, a.label);
      }
      return { label: a.label, aliases, prior };
    });
    return { id, category, prompt, answers: parsed };
  });
}

// ── rarity ──────────────────────────────────────────────────────────────────

export interface RarityRow {
  label: string;
  /** Credibility-blended share of guesses. */
  share: number;
  /** 1 = most common answer. */
  rank: number;
  /**
   * Rarity position in [0, 1): where the answer sits in the ranked list, spread evenly
   * within its tier so tier boundaries fall at 0.2 / 0.5 / 0.85 / 0.97. Places the
   * player's dot on the chart and breaks leaderboard ties.
   */
  p: number;
  tier: BlackSwanTierKey;
  points: number;
}

export interface RarityTable {
  questionId: string;
  /** Real (non-simulated) guesses behind the table. */
  realCount: number;
  /** Credibility Z = n / (n + k). */
  z: number;
  /** Most common first. */
  rows: RarityRow[];
}

/**
 * Blends each answer's prior with real guess counts using Bühlmann credibility,
 * share = Z·observed + (1 − Z)·prior with Z = n / (n + k), then ranks answers
 * and assigns tiers. Hosts freeze one table per question per day.
 */
export function buildRarityTable(
  question: BlackSwanQuestion,
  counts: Readonly<Record<string, number>>,
  k: number = BLACK_SWAN_CREDIBILITY_K,
): RarityTable {
  const priorTotal = question.answers.reduce((t, a) => t + a.prior, 0);
  const n = question.answers.reduce((t, a) => t + Math.max(0, counts[a.label] ?? 0), 0);
  const z = n / (n + k);
  const rows = question.answers
    .map((a) => {
      const observed = n ? Math.max(0, counts[a.label] ?? 0) / n : 0;
      return { label: a.label, share: z * observed + (1 - z) * (a.prior / priorTotal) };
    })
    .sort((a, b) => b.share - a.share || a.label.localeCompare(b.label));
  const sizes = blackSwanTierSizes(rows.length);
  const bounds = [0, ...BLACK_SWAN_TIERS.slice(0, 4).map((t) => t.upTo), 1];
  const ranked: RarityRow[] = [];
  let i = 0;
  sizes.forEach((size, t) => {
    const tier = BLACK_SWAN_TIERS[t];
    for (let j = 0; j < size && i < rows.length; j++, i++) {
      const p = bounds[t] + ((bounds[t + 1] - bounds[t]) * (j + 0.5)) / size;
      ranked.push({ ...rows[i], rank: i + 1, p, tier: tier.key, points: tier.points });
    }
  });
  return { questionId: question.id, realCount: n, z, rows: ranked };
}

export interface BlackSwanSlotResult {
  questionId: string;
  /** What the player typed (empty if time ran out). */
  input: string;
  /** The accepted answer they locked in, or null for a miss. */
  label: string | null;
  tier: BlackSwanTierKey | null;
  points: number;
  /** Rank of the answer among all accepted answers (1 = most common). */
  rank: number | null;
  answerCount: number;
  p: number | null;
  share: number | null;
  realCount: number;
  z: number;
  mostCommon: { label: string; share: number };
  rarest: string;
  /**
   * Every accepted answer, most common first, so the player can see the whole list once
   * they've answered. Only ever sent after the prompt is locked in.
   */
  ranking: Array<{ label: string; share: number; tier: BlackSwanTierKey }>;
}

/** Scores a locked-in answer (label) against the day's frozen table. */
export function scoreGuess(
  table: RarityTable,
  label: string | null,
  input: string,
): BlackSwanSlotResult {
  const row = label ? table.rows.find((r) => r.label === label) : undefined;
  return {
    questionId: table.questionId,
    input,
    label: row?.label ?? null,
    tier: row?.tier ?? null,
    points: row?.points ?? 0,
    rank: row?.rank ?? null,
    answerCount: table.rows.length,
    p: row?.p ?? null,
    share: row?.share ?? null,
    realCount: table.realCount,
    z: table.z,
    mostCommon: { label: table.rows[0].label, share: table.rows[0].share },
    rarest: table.rows[table.rows.length - 1].label,
    ranking: table.rows.map((r) => ({ label: r.label, share: r.share, tier: r.tier })),
  };
}

export interface BlackSwanDayScore {
  score: number;
  /** Mean rarity percentile across the prompts (misses count as 0). Breaks ties. */
  rarity: number;
  blackSwans: number;
}

export function summarizeDay(results: readonly BlackSwanSlotResult[]): BlackSwanDayScore {
  return {
    score: results.reduce((t, r) => t + r.points, 0),
    rarity: results.length ? results.reduce((t, r) => t + (r.p ?? 0), 0) / results.length : 0,
    blackSwans: results.filter((r) => r.tier === "swan").length,
  };
}

// ── scheduling ──────────────────────────────────────────────────────────────

export type BlackSwanSchedule = Record<string, string[]>;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface PlanOptions {
  /** First date to plan ("YYYY-MM-DD"). */
  start: string;
  days: number;
  /** A question isn't reused within this many days (relaxed when the pool runs short). */
  cooldownDays?: number;
  /** Days already planned. Kept as is, and they count toward cooldowns. */
  existing?: BlackSwanSchedule;
}

/**
 * Plans `days` days from `start`: five prompts a day from five different
 * categories (when there are five), least-recently-used questions first, never
 * repeating one inside the cooldown when the pool allows. Deterministic.
 */
export function planSchedule(
  pool: readonly BlackSwanQuestion[],
  opts: PlanOptions,
): BlackSwanSchedule {
  const { start, days, existing = {} } = opts;
  if (!isDateKey(start)) throw new BlackSwanPackError(`Bad start date ${start}.`);
  const cooldown = opts.cooldownDays ?? 90;
  const byId = new Map(pool.map((q) => [q.id, q]));
  const lastUsed = new Map<string, number>();
  const catLast = new Map<string, number>();
  const catCount = new Map<string, number>();
  const use = (q: BlackSwanQuestion, day: number) => {
    lastUsed.set(q.id, day);
    catLast.set(q.category, day);
    catCount.set(q.category, (catCount.get(q.category) ?? 0) + 1);
  };
  for (const date of Object.keys(existing).sort()) {
    for (const id of existing[date]) {
      const q = byId.get(id);
      if (q) use(q, dayIndex(date));
      else lastUsed.set(id, dayIndex(date));
    }
  }
  const categories = [...new Set(pool.map((q) => q.category))];
  const out: BlackSwanSchedule = { ...existing };
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    if (out[date]) continue;
    const today = dayIndex(date);
    const tie = (s: string) => hash(`${date}:${s}`);
    // Least-used categories first (then least recently), so the mix stays even.
    const cats = [...categories].sort(
      (a, b) =>
        (catCount.get(a) ?? 0) - (catCount.get(b) ?? 0) ||
        (catLast.get(a) ?? -1e9) - (catLast.get(b) ?? -1e9) ||
        tie(a) - tie(b),
    );
    const picked: BlackSwanQuestion[] = [];
    const take = (candidates: BlackSwanQuestion[]) => {
      const fresh = candidates.filter((q) => !picked.includes(q));
      if (!fresh.length) return;
      const rested = fresh.filter((q) => today - (lastUsed.get(q.id) ?? -1e9) > cooldown);
      const from = rested.length ? rested : fresh;
      from.sort(
        (a, b) =>
          (lastUsed.get(a.id) ?? -1e9) - (lastUsed.get(b.id) ?? -1e9) || tie(a.id) - tie(b.id),
      );
      picked.push(from[0]);
    };
    for (const c of cats) {
      if (picked.length === BLACK_SWAN_PROMPTS) break;
      take(pool.filter((q) => q.category === c));
    }
    while (picked.length < Math.min(BLACK_SWAN_PROMPTS, pool.length)) take([...pool]);
    for (const q of picked) use(q, today);
    out[date] = picked.map((q) => q.id);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * The prompts for a date: the planned ones, topped up deterministically (by
 * date) if the schedule doesn't cover the day or names retired questions.
 */
export function questionsForDate(
  pool: readonly BlackSwanQuestion[],
  schedule: Readonly<BlackSwanSchedule>,
  date: string,
): BlackSwanQuestion[] {
  const byId = new Map(pool.map((q) => [q.id, q]));
  const chosen = (schedule[date] ?? [])
    .map((id) => byId.get(id))
    .filter((q): q is BlackSwanQuestion => !!q);
  if (chosen.length >= BLACK_SWAN_PROMPTS) return chosen.slice(0, BLACK_SWAN_PROMPTS);
  const rest = pool
    .filter((q) => !chosen.includes(q))
    .sort((a, b) => hash(`${date}:${a.id}`) - hash(`${date}:${b.id}`));
  // New categories first, then anything.
  for (const q of rest)
    if (chosen.length < BLACK_SWAN_PROMPTS && !chosen.some((c) => c.category === q.category))
      chosen.push(q);
  for (const q of rest)
    if (chosen.length < BLACK_SWAN_PROMPTS && !chosen.includes(q)) chosen.push(q);
  return chosen;
}

/** Share card line, e.g. "▁ ▃ ▇ 🦢 ✕   575/1000". */
export function blackSwanShareLine(results: readonly BlackSwanSlotResult[]): string {
  const glyph: Record<BlackSwanTierKey, string> = {
    mode: "▁",
    expected: "▃",
    sigma: "▅",
    tail: "▇",
    swan: "🦢",
  };
  const { score } = summarizeDay(results);
  return `${results.map((r) => (r.tier ? glyph[r.tier] : "✕")).join(" ")}   ${score}/${BLACK_SWAN_MAX_SCORE}`;
}
