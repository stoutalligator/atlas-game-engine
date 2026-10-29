// @stoutalligator/engine/server — re-checks a finished game on the server so
// leaderboards rank what the player actually did, not what the browser says.
// No React; safe for API routes and server actions.

import { isGameId } from "./catalog.js";
import { isDateKey } from "./core/daily.js";
import type { GameId } from "./core/types.js";
import { packForDate, parseAssumptionDriftPack } from "./games/assumption-drift/pack.js";
import {
  type CellState,
  EMPTY,
  FILLED,
  boxPlotForDate,
  isSolved as boxPlotSolved,
} from "./games/box-plot/logic.js";
import { type CubeStep, cubeRushForDate, replayCubeRush } from "./games/cube-rush/daily.js";
import { generateRiskPool, isComplete } from "./games/risk-pool/logic.js";
import { replayLog, wordWebForDate } from "./games/wordweb/logic.js";

export interface VerifiedScore {
  solved: boolean;
  moves?: number;
  hints?: number;
  correct?: number;
  total?: number;
  /** Cube Rush par, for display. */
  par?: number;
}

export interface VerifyInput {
  game: string;
  date: string;
  proof: unknown;
  /** Assumption Drift packs in rotation order, or WordWeb puzzles for the date. */
  packs?: readonly unknown[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object";
const isInt = (v: unknown): v is number => Number.isInteger(v);
const DIRS = ["up", "down", "left", "right"];

/**
 * Replays a GameResult.proof against the puzzle for `date`. Returns the
 * recomputed score, or null if the proof is malformed or doesn't solve it.
 */
export function verifyGameResult({
  game,
  date,
  proof,
  packs = [],
}: VerifyInput): VerifiedScore | null {
  if (!isGameId(game) || !isDateKey(date) || !isObj(proof)) return null;
  try {
    switch (game) {
      case "cube-rush": {
        const steps = proof.steps;
        if (!Array.isArray(steps) || steps.length > 5000) return null;
        if (
          !steps.every((s) => Array.isArray(s) && typeof s[0] === "string" && DIRS.includes(s[1]))
        )
          return null;
        const { puzzle, par } = cubeRushForDate(date);
        const moves = replayCubeRush(puzzle, steps as CubeStep[]);
        return moves === null ? null : { solved: true, moves, par };
      }
      case "risk-pool": {
        const pz = generateRiskPool(date);
        const n = pz.size * pz.size;
        const pools = proof.pools;
        if (!Array.isArray(pools)) return null;
        if (!pools.every((p) => Array.isArray(p) && p.every((i) => isInt(i) && i >= 0 && i < n)))
          return null;
        if (!isComplete(pz, pools as number[][])) return null;
        const hints = isInt(proof.hints) && proof.hints >= 0 ? proof.hints : 0;
        return { solved: true, hints };
      }
      case "box-plot": {
        const pz = boxPlotForDate(date);
        const cells = proof.cells;
        if (!Array.isArray(cells) || cells.length !== pz.size * pz.size) return null;
        const grid = Array.from({ length: pz.size }, (_, r) =>
          cells
            .slice(r * pz.size, r * pz.size + pz.size)
            .map((c): CellState => (c === FILLED ? FILLED : EMPTY)),
        );
        return boxPlotSolved(pz, grid) ? { solved: true } : null;
      }
      case "assumption-drift": {
        const raw = packForDate(packs, date);
        if (!raw) return null;
        const pack = parseAssumptionDriftPack(raw);
        const answers = proof.answers;
        if (proof.packId !== pack.packId || !isObj(answers)) return null;
        const questions = pack.payload.questions;
        if (!questions.every((q) => typeof answers[q.id] === "string")) return null;
        const correct = questions.filter((q) => answers[q.id] === q.answer).length;
        return { solved: correct === questions.length, correct, total: questions.length };
      }
      case "wordweb": {
        const { puzzle } = wordWebForDate(packs, date);
        if (proof.puzzleId !== puzzle.id) return null;
        const replay = replayLog(puzzle, proof.log);
        return replay ? { solved: true, hints: replay.hintsUsed, moves: replay.guessCount } : null;
      }
      case "black-swan":
        // Scored on the host's server as each answer is locked in (see scoreGuess):
        // there is no client proof to replay.
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * Fastest plausible finish in seconds, so an edited timer can't claim an
 * impossible time. Generous on purpose: real players are far slower.
 */
export function minPlausibleSeconds(game: GameId, score: VerifiedScore): number {
  switch (game) {
    case "cube-rush":
      return Math.max(3, Math.ceil((score.moves ?? 0) * 0.4));
    case "risk-pool":
      return 10;
    case "box-plot":
      return 15;
    case "wordweb":
      // A few seconds per answer, at the very least.
      return 8;
    case "assumption-drift":
    case "black-swan":
      return 1;
  }
}

/**
 * Confidence-adjusted accuracy (Wilson score lower bound, 95%), 0–1.
 * 1/1 → 0.21, 9/10 → 0.60, 27/30 → 0.74 — more days answered, more weight.
 */
export function wilsonLowerBound(correct: number, total: number, z = 1.96): number {
  if (total <= 0) return 0;
  const p = correct / total;
  const z2 = z * z;
  return (
    (p + z2 / (2 * total) - z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) /
    (1 + z2 / total)
  );
}

/** Fewest possible moves for the Cube Rush puzzle on `date`. */
export function cubeRushPar(date: string): number {
  return cubeRushForDate(date).par;
}

export { isGameId };

// Black Swan: matching, rarity (credibility-weighted), scoring and scheduling.
export {
  BLACK_SWAN_CREDIBILITY_K,
  BLACK_SWAN_MAX_SCORE,
  BLACK_SWAN_PROMPTS,
  BLACK_SWAN_SECONDS,
  BLACK_SWAN_TIERS,
  BlackSwanPackError,
  blackSwanShareLine,
  blackSwanTierSizes,
  buildRarityTable,
  matchGuess,
  normalizeGuess,
  parseBlackSwanQuestions,
  planSchedule,
  questionsForDate,
  scoreGuess,
  summarizeDay,
  tierFor,
} from "./games/black-swan/logic.js";
export type {
  BlackSwanAnswer,
  BlackSwanDayScore,
  BlackSwanQuestion,
  BlackSwanSchedule,
  BlackSwanSlotResult,
  BlackSwanTier,
  BlackSwanTierKey,
  GuessMatch,
  PlanOptions,
  RarityRow,
  RarityTable,
} from "./games/black-swan/logic.js";
export type { GameId };

// WordWeb: content pipeline (generator contract, builder, validators,
// difficulty, safety, recurrence, queue) and the player-state rules the
// server replays. Hosts run the pipeline in scripts or scheduled jobs.
export * from "./games/wordweb/logic.js";
