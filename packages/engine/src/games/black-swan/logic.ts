// Black Swan — name an answer that fits the prompt; the less well known it is,
// the more it scores. Every accepted answer carries a fixed tier (set from
// real-world familiarity when the question is built), and each prompt has
// exactly one Black Swan. Pure logic only (no React, no I/O): the host stores
// questions and guesses and calls these on its server.

import { addDays, dayIndex, isDateKey } from "../../core/daily.js";

export const BLACK_SWAN_PROMPTS = 7;
export const BLACK_SWAN_SECONDS = 25;

/**
 * The five tiers, most common first. Points are fixed per tier. `upTo` only
 * places answers on the chart: each tier gets a band of the x axis (35 / 27 /
 * 20 / 12 / 6%) and an answer's rarity position p falls inside its tier's band.
 */
export const BLACK_SWAN_TIERS = [
  {
    key: "mode",
    name: "Mode",
    points: 10,
    upTo: 0.35,
    blurb: "The answer everyone reaches for.",
  },
  {
    key: "expected",
    name: "Expected",
    points: 30,
    upTo: 0.62,
    blurb: "Right where the crowd expected.",
  },
  {
    key: "sigma",
    name: "Within σ",
    points: 60,
    upTo: 0.82,
    blurb: "A standard deviation off the pack.",
  },
  {
    key: "tail",
    name: "Tail",
    points: 85,
    upTo: 0.94,
    blurb: "Out in the tail. Few travel this far.",
  },
  {
    key: "swan",
    name: "Outlier",
    points: 100,
    upTo: Number.POSITIVE_INFINITY,
    blurb: "The one answer nobody else saw. Straight to hyperspace.",
  },
] as const;

export type BlackSwanTier = (typeof BLACK_SWAN_TIERS)[number];
export type BlackSwanTierKey = BlackSwanTier["key"];
export const BLACK_SWAN_TIER_KEYS: readonly BlackSwanTierKey[] = BLACK_SWAN_TIERS.map((t) => t.key);
export const BLACK_SWAN_MAX_SCORE = BLACK_SWAN_PROMPTS * BLACK_SWAN_TIERS[4].points;

const tierIndex = (key: BlackSwanTierKey) => BLACK_SWAN_TIER_KEYS.indexOf(key);
const isTierKey = (v: unknown): v is BlackSwanTierKey =>
  typeof v === "string" && (BLACK_SWAN_TIER_KEYS as readonly string[]).includes(v);

/** The tier whose chart band holds rarity position p. */
export function tierFor(p: number): BlackSwanTier {
  return BLACK_SWAN_TIERS.find((t) => p < t.upTo) ?? BLACK_SWAN_TIERS[4];
}

export interface BlackSwanAnswer {
  label: string;
  aliases: string[];
  tier: BlackSwanTierKey;
  /**
   * How well known the answer is (e.g. yearly Wikipedia pageviews). Only orders
   * answers inside a tier, most familiar first; it never changes the score.
   */
  familiarity?: number;
  /** A line of trivia, shown with the prompt's Black Swan once the player has answered. */
  fact?: string;
}

export interface BlackSwanQuestion {
  id: string;
  category: string;
  prompt: string;
  answers: BlackSwanAnswer[];
}

export class BlackSwanPackError extends Error {}

// ── tiers from familiarity ──────────────────────────────────────────────────

/**
 * Default cuts on cumulative familiarity: the answers that make up the first
 * 50% of all familiarity are Mode, up to 75% Expected, up to 90% Within σ, and
 * everything after that is Tail. A long-tail list (every anime ever made)
 * therefore puts nearly everything in Tail; an even list (countries) spreads out.
 */
export const BLACK_SWAN_TIER_CUTS: readonly [number, number, number] = [0.5, 0.75, 0.9];

export interface AssignTiersOptions {
  /** Cumulative-familiarity cuts for Mode / Expected / Within σ. */
  cuts?: readonly [number, number, number];
  /** The label to make the Black Swan. Defaults to the least familiar answer. */
  swan?: string;
}

/**
 * Turns familiarity scores into tiers for the question pipeline. Exactly one
 * answer becomes the Black Swan; the rest are tiered by where they start on the
 * cumulative familiarity curve, most familiar first. The most familiar answer
 * is always Mode.
 */
export function assignTiers<T extends { label: string; familiarity: number }>(
  items: readonly T[],
  opts: AssignTiersOptions = {},
): Array<T & { tier: BlackSwanTierKey }> {
  if (!items.length) return [];
  const cuts = opts.cuts ?? BLACK_SWAN_TIER_CUTS;
  const sorted = [...items].sort(
    (a, b) => b.familiarity - a.familiarity || a.label.localeCompare(b.label),
  );
  const swanLabel = opts.swan ?? sorted[sorted.length - 1].label;
  if (!sorted.some((a) => a.label === swanLabel))
    throw new BlackSwanPackError(`assignTiers: "${swanLabel}" isn't one of the answers.`);
  const rest = sorted.filter((a) => a.label !== swanLabel);
  const total = rest.reduce((t, a) => t + Math.max(0, a.familiarity), 0);
  let before = 0;
  const tiers = new Map<string, BlackSwanTierKey>([[swanLabel, "swan"]]);
  rest.forEach((a, i) => {
    const start = total > 0 ? before / total : i / rest.length;
    const t = i === 0 ? 0 : start < cuts[0] ? 0 : start < cuts[1] ? 1 : start < cuts[2] ? 2 : 3;
    tiers.set(a.label, BLACK_SWAN_TIER_KEYS[t]);
    before += Math.max(0, a.familiarity);
  });
  return items.map((a) => ({ ...a, tier: tiers.get(a.label) as BlackSwanTierKey }));
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

/** Typos allowed for a form of this length (spaces removed). */
const tolerance = (n: number) => (n >= 9 ? 2 : n >= 5 ? 1 : 0);
const MAX_TOLERANCE = 2;

export interface GuessMatch {
  /** "exact": the player typed the answer itself. "suggest": an alias or a near miss — confirm first. */
  kind: "exact" | "suggest";
  label: string;
}

interface Form {
  /** Normalized form with spaces removed. */
  key: string;
  label: string;
  isLabel: boolean;
  /** Position of the answer in the question's order (most common first). */
  order: number;
}

/** Everything derived from a question once: answer order, positions and the match index. */
interface QuestionIndex {
  /** Answers, most common first: by tier, then familiarity, then label. */
  ordered: BlackSwanAnswer[];
  byLabel: Map<string, { answer: BlackSwanAnswer; order: number; p: number }>;
  /** Spaceless normalized form → its best form (labels beat aliases). */
  exact: Map<string, Form>;
  /** Spaceless length → forms, for typo matching inside a small length band. */
  byLength: Map<number, Form[]>;
  tierCounts: Record<BlackSwanTierKey, number>;
  swan: BlackSwanAnswer;
}

const indexes = new WeakMap<BlackSwanQuestion, QuestionIndex>();

const TIER_BOUNDS = [0, ...BLACK_SWAN_TIERS.slice(0, 4).map((t) => t.upTo), 1];

/** Rarity position of the j-th of `size` answers in tier t: spread evenly across the tier's band. */
export function tierPosition(t: number, j: number, size: number): number {
  return TIER_BOUNDS[t] + ((TIER_BOUNDS[t + 1] - TIER_BOUNDS[t]) * (j + 0.5)) / size;
}

function indexQuestion(q: BlackSwanQuestion): QuestionIndex {
  const cached = indexes.get(q);
  if (cached) return cached;
  const ordered = [...q.answers].sort(
    (a, b) =>
      tierIndex(a.tier) - tierIndex(b.tier) ||
      (b.familiarity ?? 0) - (a.familiarity ?? 0) ||
      a.label.localeCompare(b.label),
  );
  const tierCounts = Object.fromEntries(BLACK_SWAN_TIER_KEYS.map((k) => [k, 0])) as Record<
    BlackSwanTierKey,
    number
  >;
  for (const a of ordered) tierCounts[a.tier]++;
  const seen = Object.fromEntries(BLACK_SWAN_TIER_KEYS.map((k) => [k, 0])) as Record<
    BlackSwanTierKey,
    number
  >;
  const byLabel = new Map<string, { answer: BlackSwanAnswer; order: number; p: number }>();
  const exact = new Map<string, Form>();
  const byLength = new Map<number, Form[]>();
  ordered.forEach((answer, order) => {
    const t = tierIndex(answer.tier);
    const p = tierPosition(t, seen[answer.tier]++, tierCounts[answer.tier]);
    byLabel.set(answer.label, { answer, order, p });
    [answer.label, ...answer.aliases].forEach((raw, f) => {
      const key = normalizeGuess(raw).replace(/ /g, "");
      if (!key) return;
      const form: Form = { key, label: answer.label, isLabel: f === 0, order };
      const prev = exact.get(key);
      if (!prev || (form.isLabel && !prev.isLabel)) exact.set(key, form);
      const band = byLength.get(key.length);
      if (band) band.push(form);
      else byLength.set(key.length, [form]);
    });
  });
  const swan = ordered[ordered.length - 1];
  const index = { ordered, byLabel, exact, byLength, tierCounts, swan };
  indexes.set(q, index);
  return index;
}

/**
 * Matches a typed guess to an accepted answer, or null if it isn't one. Exact
 * forms are a map lookup; typos are only checked against forms of a similar
 * length, so lists with tens of thousands of answers stay fast.
 */
export function matchGuess(question: BlackSwanQuestion, input: string): GuessMatch | null {
  const key = normalizeGuess(input).replace(/ /g, "");
  if (!key) return null;
  const idx = indexQuestion(question);
  const hit = idx.exact.get(key);
  if (hit) return { kind: hit.isLabel ? "exact" : "suggest", label: hit.label };
  let best: { form: Form; d: number } | null = null;
  for (let len = key.length - MAX_TOLERANCE; len <= key.length + MAX_TOLERANCE; len++) {
    for (const form of idx.byLength.get(len) ?? []) {
      const tol = tolerance(form.key.length);
      if (Math.abs(len - key.length) > tol) continue;
      const d = levenshtein(key, form.key, tol);
      if (d > tol) continue;
      // Closest first; on a tie, the answer's own label, then the more common answer.
      if (
        !best ||
        d < best.d ||
        (d === best.d && form.isLabel && !best.form.isLabel) ||
        (d === best.d && form.isLabel === best.form.isLabel && form.order < best.form.order)
      )
        best = { form, d };
    }
  }
  return best ? { kind: "suggest", label: best.form.label } : null;
}

// ── pack parsing ────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/**
 * Validates raw question JSON (an array of questions, or { questions: [...] }).
 * Throws BlackSwanPackError naming the first problem: a missing tier, not
 * exactly one Black Swan, or an alias that would match two different answers.
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
    const labels = new Set<string>();
    const parsed = answers.map((a, j): BlackSwanAnswer => {
      if (!isObj(a) || typeof a.label !== "string" || !a.label)
        throw new BlackSwanPackError(`${id} answer ${j + 1} has no label.`);
      if (labels.has(a.label)) throw new BlackSwanPackError(`${id}: "${a.label}" is listed twice.`);
      labels.add(a.label);
      if (!isTierKey(a.tier))
        throw new BlackSwanPackError(
          `${id} "${a.label}" needs a tier (${BLACK_SWAN_TIER_KEYS.join(", ")}).`,
        );
      const aliases = Array.isArray(a.aliases)
        ? a.aliases.filter((x): x is string => typeof x === "string")
        : [];
      for (const form of [a.label, ...aliases]) {
        const k = normalizeGuess(form).replace(/ /g, "");
        if (!k) continue;
        const other = seen.get(k);
        if (other && other !== a.label)
          throw new BlackSwanPackError(
            `${id}: "${form}" matches both "${other}" and "${a.label}".`,
          );
        seen.set(k, a.label);
      }
      const out: BlackSwanAnswer = { label: a.label, aliases, tier: a.tier };
      if (typeof a.familiarity === "number" && Number.isFinite(a.familiarity))
        out.familiarity = a.familiarity;
      if (typeof a.fact === "string" && a.fact.trim()) out.fact = a.fact.trim();
      return out;
    });
    const swans = parsed.filter((a) => a.tier === "swan");
    if (swans.length !== 1)
      throw new BlackSwanPackError(
        `${id} needs exactly one Black Swan answer (has ${swans.length}).`,
      );
    return { id, category, prompt, answers: parsed };
  });
}

// ── scoring ─────────────────────────────────────────────────────────────────

/** Answers sent with a result, at most (plus the player's own, the Black Swan and the crowd's picks). */
export const BLACK_SWAN_LIST_LIMIT = 250;
/** How many of the crowd's most-picked answers are always included in a result's list. */
const TOP_PICKS = 40;

export interface BlackSwanListedAnswer {
  label: string;
  tier: BlackSwanTierKey;
  /** Rarity position, for placing the answer on the chart. */
  p: number;
  /** Players who locked this answer in (from the host's counts). */
  picks: number;
}

export interface BlackSwanSlotResult {
  questionId: string;
  /** What the player typed (empty if time ran out). */
  input: string;
  /** The accepted answer they locked in, or null for a miss. */
  label: string | null;
  tier: BlackSwanTierKey | null;
  points: number;
  /** Rarity position in [0, 1) (see tierPosition), or null for a miss. */
  p: number | null;
  /** Players who locked in the same answer, this player included. */
  picks: number | null;
  /** Players who locked in any accepted answer to this prompt. */
  players: number;
  answerCount: number;
  tierCounts: Record<BlackSwanTierKey, number>;
  /** The prompt's Black Swan and its fact. Only ever sent after the prompt is locked in. */
  swan: { label: string; fact: string | null };
  /**
   * Accepted answers, most common first: the most common ones up to
   * BLACK_SWAN_LIST_LIMIT, plus the player's answer, the Black Swan and the
   * crowd's most-picked answers. `more` counts the ones left out.
   */
  ranking: BlackSwanListedAnswer[];
  more: number;
}

/**
 * Scores a locked-in answer (label, or null for a miss). `counts` is how many
 * players have locked in each answer to this prompt so far; it never changes
 * the points, it only fills in "N players chose this".
 */
export function scoreGuess(
  question: BlackSwanQuestion,
  label: string | null,
  input: string,
  counts: Readonly<Record<string, number>> = {},
): BlackSwanSlotResult {
  const idx = indexQuestion(question);
  const mine = label ? idx.byLabel.get(label) : undefined;
  const picksOf = (l: string) => Math.max(0, counts[l] ?? 0);
  let players = 0;
  for (const [l, n] of Object.entries(counts)) if (idx.byLabel.has(l)) players += Math.max(0, n);

  const keep = new Set<number>();
  for (let i = 0; i < Math.min(BLACK_SWAN_LIST_LIMIT, idx.ordered.length); i++) keep.add(i);
  keep.add(idx.ordered.length - 1);
  if (mine) keep.add(mine.order);
  const topPicks = Object.entries(counts)
    .filter(([l, n]) => n > 0 && idx.byLabel.has(l))
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_PICKS);
  for (const [l] of topPicks) keep.add((idx.byLabel.get(l) as { order: number }).order);
  const ranking = [...keep]
    .sort((a, b) => a - b)
    .map((i) => {
      const a = idx.ordered[i];
      const e = idx.byLabel.get(a.label) as { p: number };
      return { label: a.label, tier: a.tier, p: e.p, picks: picksOf(a.label) };
    });

  return {
    questionId: question.id,
    input,
    label: mine?.answer.label ?? null,
    tier: mine?.answer.tier ?? null,
    points: mine ? BLACK_SWAN_TIERS[tierIndex(mine.answer.tier)].points : 0,
    p: mine?.p ?? null,
    picks: mine ? picksOf(mine.answer.label) : null,
    players,
    answerCount: idx.ordered.length,
    tierCounts: { ...idx.tierCounts },
    swan: { label: idx.swan.label, fact: idx.swan.fact ?? null },
    ranking,
    more: idx.ordered.length - ranking.length,
  };
}

export interface BlackSwanDayScore {
  score: number;
  /** Mean rarity position across the prompts (misses count as 0). Breaks ties. */
  rarity: number;
  blackSwans: number;
}

export function summarizeDay(
  results: ReadonlyArray<Pick<BlackSwanSlotResult, "points" | "p" | "tier">>,
): BlackSwanDayScore {
  return {
    score: results.reduce((t, r) => t + r.points, 0),
    rarity: results.length ? results.reduce((t, r) => t + (r.p ?? 0), 0) / results.length : 0,
    blackSwans: results.filter((r) => r.tier === "swan").length,
  };
}

// ── the day's distribution ──────────────────────────────────────────────────

export interface BlackSwanDistribution {
  /** Width of each histogram bin, in points. */
  binSize: number;
  /** Players per bin: bins[i] covers scores [i·binSize, (i+1)·binSize). The last bin includes the max. */
  bins: number[];
  /** Players who finished the day, the viewer included. */
  players: number;
  /** Players who scored strictly less than the viewer. */
  below: number;
  /** The viewer's day score. */
  score: number;
  mean: number;
  /** Population standard deviation of the scores. */
  sd: number;
}

/** Bins every finished player's day score, for the summary's distribution chart. */
export function dayDistribution(
  scores: readonly number[],
  mine: number,
  binSize = 25,
): BlackSwanDistribution {
  const nBins = Math.ceil(BLACK_SWAN_MAX_SCORE / binSize);
  const bins = Array.from({ length: nBins }, () => 0);
  for (const s of scores) bins[Math.min(nBins - 1, Math.max(0, Math.floor(s / binSize)))]++;
  const n = scores.length;
  const mean = n ? scores.reduce((t, s) => t + s, 0) / n : 0;
  const sd = n ? Math.sqrt(scores.reduce((t, s) => t + (s - mean) ** 2, 0) / n) : 0;
  return {
    binSize,
    bins,
    players: n,
    below: scores.filter((s) => s < mine).length,
    score: mine,
    mean,
    sd,
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
 * Plans `days` days from `start`: BLACK_SWAN_PROMPTS prompts a day, one per
 * category while categories last, least-recently-used questions first, never
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

/** Share card line, e.g. "▁ ▃ ▇ 🦢 ✕ ▅ ▃   325/700". */
export function blackSwanShareLine(results: readonly BlackSwanSlotResult[]): string {
  const glyph: Record<BlackSwanTierKey, string> = {
    mode: "▁",
    expected: "▃",
    sigma: "▅",
    tail: "▇",
    swan: "🌠",
  };
  const { score } = summarizeDay(results);
  return `${results.map((r) => (r.tier ? glyph[r.tier] : "✕")).join(" ")}   ${score}/${BLACK_SWAN_MAX_SCORE}`;
}
