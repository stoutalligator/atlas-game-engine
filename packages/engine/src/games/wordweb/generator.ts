import { type Rng, mulberry32, shuffle } from "../../core/rng.js";
import type { WeekdayTarget } from "./difficulty.js";
import { normalizeWord } from "./normalize.js";
import type { AnswerKind, Weekday } from "./types.js";

// Content proposal is the only replaceable part of the pipeline. A generator
// suggests a category and candidate answers with their metadata; it decides
// nothing about geometry, unlocks, difficulty, safety, scheduling or
// publication — pipeline.ts checks all of that deterministically.
//
// Adding a provider (an approved model or content service): implement
// WordWebGenerator in the host, server-side, and pass it to generateForDate /
// planQueue. Keep credentials in the host's server environment; the engine
// never calls the network.

export interface GenerationRequest {
  date: string;
  weekday: Weekday;
  target: WeekdayTarget;
  /** 1-based attempt number for this date; generators should vary output by it. */
  attempt: number;
  seed: number;
  /** Category ids that recurrence rules rule out for this date. */
  avoidCategories: string[];
  /** Category groups ruled out (a related category ran yesterday/tomorrow). */
  avoidGroups: string[];
  /** Normalized answers used too recently. */
  avoidAnswers: string[];
  /** False when an actuarial category ran too recently. */
  allowActuarial: boolean;
}

export interface ProposedAnswer {
  display: string;
  /** One sentence: why this belongs in the category. */
  fit: string;
  /** 1 (obscure) … 5 (everyone knows it). */
  familiarity: number;
  kind?: AnswerKind;
  proper?: boolean;
  brand?: boolean;
}

export interface ContentProposal {
  categoryId: string;
  category: string;
  group: string;
  actuarial: boolean;
  breadth: number;
  ambiguity: number;
  /** Candidate answers (more than the puzzle needs is fine: the pipeline picks). */
  answers: ProposedAnswer[];
  /** Other recognized category members, used as "Close!" alternates only. */
  alsoValid: string[];
  /** The source's own safety notes. Recorded, never relied on. */
  selfReportedSafety?: string;
}

export interface WordWebGenerator {
  name: string;
  version: string;
  propose(request: GenerationRequest): Promise<ContentProposal | null>;
}

// ── Local bank generator ──────────────────────────────────────────────────

/** One curated category, as hosts store it (ATLAS: src/packs/wordweb/bank/*.json). */
export interface BankCategory {
  id: string;
  category: string;
  group: string;
  actuarial?: boolean;
  breadth: number;
  ambiguity: number;
  answers: ProposedAnswer[];
  alsoValid?: string[];
}

export class BankError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";

/** Validates a bank file's JSON. Throws BankError naming the bad entry. */
export function parseBank(raw: unknown): BankCategory[] {
  if (!Array.isArray(raw)) throw new BankError("bank must be an array of categories");
  const ids = new Set<string>();
  return raw.map((c, i) => {
    const at = `bank[${i}]`;
    if (!isObj(c)) throw new BankError(`${at} must be an object`);
    for (const k of ["id", "category", "group"] as const)
      if (typeof c[k] !== "string" || !(c[k] as string).trim())
        throw new BankError(`${at}.${k} must be a non-empty string`);
    if (ids.has(c.id as string)) throw new BankError(`${at}.id "${c.id}" repeats`);
    ids.add(c.id as string);
    for (const k of ["breadth", "ambiguity"] as const)
      if (typeof c[k] !== "number" || (c[k] as number) < 0 || (c[k] as number) > 1)
        throw new BankError(`${at}.${k} must be 0–1`);
    if (!Array.isArray(c.answers) || c.answers.length < 4)
      throw new BankError(`${at}.answers needs at least 4 entries`);
    const answers = c.answers.map((a: unknown, j: number): ProposedAnswer => {
      const aat = `${at}.answers[${j}]`;
      if (!isObj(a) || typeof a.display !== "string") throw new BankError(`${aat}.display missing`);
      if (typeof a.fit !== "string" || a.fit.trim().length < 10)
        throw new BankError(`${aat}.fit needs a sentence`);
      if (
        !Number.isInteger(a.familiarity) ||
        (a.familiarity as number) < 1 ||
        (a.familiarity as number) > 5
      )
        throw new BankError(`${aat}.familiarity must be 1–5`);
      return {
        display: a.display,
        fit: a.fit,
        familiarity: a.familiarity as number,
        kind: a.kind as AnswerKind | undefined,
        proper: a.proper === true || undefined,
        brand: a.brand === true || undefined,
      };
    });
    const alsoValid = Array.isArray(c.alsoValid)
      ? c.alsoValid.filter((x) => typeof x === "string")
      : [];
    return {
      id: c.id as string,
      category: c.category as string,
      group: c.group as string,
      actuarial: c.actuarial === true,
      breadth: c.breadth as number,
      ambiguity: c.ambiguity as number,
      answers,
      alsoValid,
    };
  });
}

/** Breadth band a weekday prefers: narrow, concrete categories early in the week. */
const BREADTH_BY_WEEKDAY: Record<Weekday, [number, number]> = {
  1: [0, 0.45],
  2: [0, 0.55],
  3: [0.1, 0.7],
  4: [0.2, 0.8],
  5: [0.3, 1],
  6: [0.3, 1],
  0: [0.4, 1],
};

/**
 * The deterministic local generator: proposes from a curated bank. Same
 * request → same proposal. Works offline and in tests.
 */
export function createBankGenerator(bank: BankCategory[]): WordWebGenerator {
  return {
    name: "local-bank",
    version: "1.0.0",
    async propose(req) {
      const rng: Rng = mulberry32(req.seed + req.attempt * 104729);
      const [lo, hi] = BREADTH_BY_WEEKDAY[req.weekday];
      const eligible = bank.filter(
        (c) =>
          !req.avoidCategories.includes(c.id) &&
          !req.avoidGroups.includes(c.group) &&
          (req.allowActuarial || !c.actuarial),
      );
      if (!eligible.length) return null;
      const banded = eligible.filter((c) => c.breadth >= lo && c.breadth <= hi);
      // Actuarial categories are occasional: offered on a minority of attempts.
      const pool = (banded.length ? banded : eligible).filter((c) => !c.actuarial || rng() < 0.35);
      const chosen = shuffle(rng, pool.length ? pool : eligible)[0];
      const avoid = new Set(req.avoidAnswers);
      return {
        categoryId: chosen.id,
        category: chosen.category,
        group: chosen.group,
        actuarial: !!chosen.actuarial,
        breadth: chosen.breadth,
        ambiguity: chosen.ambiguity,
        answers: chosen.answers.filter(
          (a) =>
            a.familiarity >= req.target.minFamiliarity &&
            !avoid.has(normalizeWord(a.display) ?? ""),
        ),
        // Every member, used or not, can be a near-miss for another space.
        alsoValid: [...chosen.answers.map((a) => a.display), ...(chosen.alsoValid ?? [])],
        selfReportedSafety: "curated bank",
      };
    },
  };
}
