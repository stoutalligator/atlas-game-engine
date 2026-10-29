import { orderForSelection } from "./graph.js";
import { cellKey, cellsOf } from "./grid.js";
import { normalizeLetter, normalizeWord } from "./normalize.js";
import type { WordWebAnswer, WordWebPuzzle } from "./types.js";
import { visibleIds } from "./validate.js";

// Player state for one puzzle on one date, kept apart from the immutable
// puzzle. Every function here is pure: (puzzle, state, input) → new state.
// The component, persistence and the server's replay all go through these.

export const WORDWEB_STATE_VERSION = 1;
export const HINT_COOLDOWN_MS = 10_000;
/** Longest guess/hint log a finished game may carry (server replay bound). */
export const MAX_LOG = 400;

export type ProofStep = ["g", string, string] | ["h", string];

export interface WordWebResultSummary {
  elapsedMs: number;
  hintsUsed: number;
  guessCount: number;
  completedAt: string;
}

export interface WordWebState {
  schemaVersion: number;
  puzzleId: string;
  date: string;
  /** Solved answer ids, in the order solved. */
  solved: string[];
  /** Letters the player has typed but not yet had accepted, by cell. */
  typed: Record<string, string>;
  /** Cells revealed by hints. */
  hinted: string[];
  hintsUsed: number;
  /** Graded guesses per answer (normalized). */
  guesses: Record<string, string[]>;
  guessCount: number;
  active: string | null;
  /**
   * Hint cooldown left, ms. One timer for the whole puzzle: it runs during
   * active play whichever word is selected, and restarts after each hint.
   */
  hintCooldownMs: number;
  elapsedMs: number;
  log: ProofStep[];
  done: boolean;
  /** Set once, on completion; never rewritten. */
  result: WordWebResultSummary | null;
}

export type SubmitOutcome =
  | "correct"
  | "incorrect"
  | "alternate"
  | "repeat"
  | "incomplete"
  | "mismatch"
  | "invalid"
  | "solved"
  | "hidden"
  | "done";

export interface SubmitResult {
  state: WordWebState;
  outcome: SubmitOutcome;
  /** Answers that became visible because of this submission. */
  revealed: string[];
}

const byId = (puzzle: WordWebPuzzle, id: string) => puzzle.answers.find((a) => a.id === id);

export function initialState(puzzle: WordWebPuzzle, date: string): WordWebState {
  return {
    schemaVersion: WORDWEB_STATE_VERSION,
    puzzleId: puzzle.id,
    date,
    solved: [],
    typed: {},
    hinted: [],
    hintsUsed: 0,
    guesses: {},
    guessCount: 0,
    active: puzzle.start,
    hintCooldownMs: HINT_COOLDOWN_MS,
    elapsedMs: 0,
    log: [],
    done: false,
    result: null,
  };
}

/** Visible answers in reading order. */
export function visibleAnswers(puzzle: WordWebPuzzle, state: WordWebState): WordWebAnswer[] {
  const ids = visibleIds(puzzle.answers, new Set(state.solved));
  return orderForSelection(puzzle.answers.filter((a) => ids.has(a.id)));
}

/** Visible, unsolved answers in reading order: the ones a player can pick. */
export function openAnswers(puzzle: WordWebPuzzle, state: WordWebState): WordWebAnswer[] {
  const solved = new Set(state.solved);
  return visibleAnswers(puzzle, state).filter((a) => !solved.has(a.id));
}

/** Letters the player can't change: starting reveal, solved answers, hints. */
export function fixedCells(puzzle: WordWebPuzzle, state: WordWebState): Map<string, string> {
  const fixed = new Map<string, string>();
  const start = byId(puzzle, puzzle.start) as WordWebAnswer;
  const startCells = cellsOf(start);
  for (const i of puzzle.revealed) fixed.set(cellKey(...startCells[i]), start.grid[i]);
  const hinted = new Set(state.hinted);
  for (const a of puzzle.answers) {
    const solved = state.solved.includes(a.id);
    cellsOf(a).forEach(([r, c], i) => {
      const k = cellKey(r, c);
      if (solved || hinted.has(k)) fixed.set(k, a.grid[i]);
    });
  }
  return fixed;
}

/** The answer's letters as currently shown ("" for an empty cell). */
export function currentLetters(puzzle: WordWebPuzzle, state: WordWebState, id: string): string[] {
  const a = byId(puzzle, id);
  if (!a) return [];
  const fixed = fixedCells(puzzle, state);
  return cellsOf(a).map(([r, c]) => fixed.get(cellKey(r, c)) ?? state.typed[cellKey(r, c)] ?? "");
}

export function selectAnswer(puzzle: WordWebPuzzle, state: WordWebState, id: string): WordWebState {
  if (state.done || state.active === id) return state;
  if (!openAnswers(puzzle, state).some((a) => a.id === id)) return state;
  return { ...state, active: id };
}

/** Types into the active answer's next empty, unfixed cell. Grades automatically when it spells the answer. */
export function typeLetter(
  puzzle: WordWebPuzzle,
  state: WordWebState,
  ch: string,
): (Omit<SubmitResult, "outcome"> & { outcome: SubmitOutcome | null }) | null {
  const letter = normalizeLetter(ch);
  const a = state.active && byId(puzzle, state.active);
  if (!letter || !a || state.done) return null;
  const fixed = fixedCells(puzzle, state);
  const target = cellsOf(a).find(
    ([r, c]) => !fixed.has(cellKey(r, c)) && !state.typed[cellKey(r, c)],
  );
  if (!target) return null;
  const next = { ...state, typed: { ...state.typed, [cellKey(...target)]: letter } };
  const word = currentLetters(puzzle, next, a.id).join("");
  if (word === a.grid) return submitGuess(puzzle, next, a.id);
  return { state: next, outcome: null, revealed: [] };
}

/** Removes the active answer's last typed letter. */
export function backspace(puzzle: WordWebPuzzle, state: WordWebState): WordWebState {
  const a = state.active && byId(puzzle, state.active);
  if (!a || state.done) return state;
  const fixed = fixedCells(puzzle, state);
  const last = [...cellsOf(a)]
    .reverse()
    .find(([r, c]) => !fixed.has(cellKey(r, c)) && state.typed[cellKey(r, c)]);
  if (!last) return state;
  const typed = { ...state.typed };
  delete typed[cellKey(...last)];
  return { ...state, typed };
}

function clearTyped(
  state: WordWebState,
  a: WordWebAnswer,
  fixed: Map<string, string>,
): Record<string, string> {
  const typed = { ...state.typed };
  for (const [r, c] of cellsOf(a)) if (!fixed.has(cellKey(r, c))) delete typed[cellKey(r, c)];
  return typed;
}

/**
 * Classifies a guess without changing anything. `text` defaults to what's in
 * the answer's cells.
 */
export function evaluateGuess(
  puzzle: WordWebPuzzle,
  state: WordWebState,
  id: string,
  text?: string,
): { outcome: SubmitOutcome; guess: string } {
  const a = byId(puzzle, id);
  if (state.done) return { outcome: "done", guess: "" };
  if (!a || !visibleAnswers(puzzle, state).some((v) => v.id === id))
    return { outcome: "hidden", guess: "" };
  if (state.solved.includes(id)) return { outcome: "solved", guess: a.grid };
  const letters = text === undefined ? currentLetters(puzzle, state, id) : null;
  if (letters?.some((l) => !l)) return { outcome: "incomplete", guess: letters.join("") };
  const guess = letters ? letters.join("") : normalizeWord(text as string);
  if (guess === null) return { outcome: "invalid", guess: "" };
  if (guess.length !== a.grid.length) return { outcome: "incomplete", guess };
  const fixed = fixedCells(puzzle, state);
  const clash = cellsOf(a).some(([r, c], i) => {
    const f = fixed.get(cellKey(r, c));
    return f !== undefined && f !== guess[i];
  });
  if (clash) return { outcome: "mismatch", guess };
  if (guess === a.grid) return { outcome: "correct", guess };
  if ((state.guesses[id] ?? []).includes(guess)) return { outcome: "repeat", guess };
  if (a.alternates.includes(guess)) return { outcome: "alternate", guess };
  return { outcome: "incorrect", guess };
}

/** Grades the active (or given) answer. Rejected guesses clear the typed letters. */
export function submitGuess(
  puzzle: WordWebPuzzle,
  state: WordWebState,
  id: string | null = state.active,
  text?: string,
  now: () => string = () => new Date().toISOString(),
): SubmitResult {
  if (!id) return { state, outcome: "hidden", revealed: [] };
  const { outcome, guess } = evaluateGuess(puzzle, state, id, text);
  const a = byId(puzzle, id) as WordWebAnswer;
  if (
    outcome === "incomplete" ||
    outcome === "hidden" ||
    outcome === "solved" ||
    outcome === "done" ||
    outcome === "invalid" ||
    outcome === "mismatch"
  )
    return { state, outcome, revealed: [] };

  const fixed = fixedCells(puzzle, state);
  const typed = clearTyped(state, a, fixed);
  if (outcome === "repeat") return { state: { ...state, typed }, outcome, revealed: [] };

  const graded: WordWebState = {
    ...state,
    typed,
    guesses: { ...state.guesses, [id]: [...(state.guesses[id] ?? []), guess] },
    guessCount: state.guessCount + 1,
    log: [...state.log, ["g", id, guess] as ProofStep].slice(-MAX_LOG),
  };
  if (outcome !== "correct") return { state: graded, outcome, revealed: [] };

  const before = new Set(visibleAnswers(puzzle, state).map((v) => v.id));
  const solvedState: WordWebState = { ...graded, solved: [...state.solved, id] };
  // Typed letters under the solved word are now fixed; drop them.
  for (const [r, c] of cellsOf(a)) delete solvedState.typed[cellKey(r, c)];
  const revealed = visibleAnswers(puzzle, solvedState)
    .filter((v) => !before.has(v.id))
    .map((v) => v.id);
  const open = openAnswers(puzzle, solvedState);
  const nextActive = revealed[0] ?? open[0]?.id ?? null;
  const done = solvedState.solved.length === puzzle.answers.length;
  return {
    state: {
      ...solvedState,
      active: done ? null : nextActive,
      done,
      result: done
        ? {
            elapsedMs: solvedState.elapsedMs,
            hintsUsed: solvedState.hintsUsed,
            guessCount: solvedState.guessCount,
            completedAt: now(),
          }
        : null,
    },
    outcome,
    revealed,
  };
}

export type HintReason = "ready" | "cooldown" | "final-letter" | "unavailable";

export interface HintStatus {
  available: boolean;
  reason: HintReason;
  remainingMs: number;
  /** Index the next hint would reveal. */
  nextIndex: number | null;
}

/** Whether the active answer can take a hint, and which letter it would get. */
export function hintStatus(puzzle: WordWebPuzzle, state: WordWebState): HintStatus {
  const a = state.active && byId(puzzle, state.active);
  if (!a || state.done || state.solved.includes(a.id))
    return { available: false, reason: "unavailable", remainingMs: 0, nextIndex: null };
  const fixed = fixedCells(puzzle, state);
  const unknown = cellsOf(a)
    .map(([r, c], i) => (fixed.has(cellKey(r, c)) ? -1 : i))
    .filter((i) => i >= 0);
  // The last unknown letter is always the player's to find.
  if (unknown.length <= 1)
    return { available: false, reason: "final-letter", remainingMs: 0, nextIndex: null };
  const remainingMs = Math.max(0, state.hintCooldownMs);
  if (remainingMs > 0)
    return { available: false, reason: "cooldown", remainingMs, nextIndex: unknown[0] };
  return { available: true, reason: "ready", remainingMs: 0, nextIndex: unknown[0] };
}

/** Reveals the next unknown letter of the active answer (reading order). No-op unless a hint is ready. */
export function takeHint(
  puzzle: WordWebPuzzle,
  state: WordWebState,
): { state: WordWebState; index: number | null } {
  const status = hintStatus(puzzle, state);
  const a = state.active && byId(puzzle, state.active);
  if (!status.available || status.nextIndex === null || !a) return { state, index: null };
  const k = cellKey(...cellsOf(a)[status.nextIndex]);
  const typed = { ...state.typed };
  delete typed[k];
  return {
    state: {
      ...state,
      typed,
      hinted: [...state.hinted, k],
      hintsUsed: state.hintsUsed + 1,
      hintCooldownMs: HINT_COOLDOWN_MS,
      log: [...state.log, ["h", a.id] as ProofStep].slice(-MAX_LOG),
    },
    index: status.nextIndex,
  };
}

/** Active play time passing: the clock, and the puzzle's hint cooldown. */
export function tick(state: WordWebState, deltaMs: number): WordWebState {
  if (state.done || !(deltaMs > 0)) return state;
  return {
    ...state,
    elapsedMs: state.elapsedMs + deltaMs,
    hintCooldownMs: Math.max(0, state.hintCooldownMs - deltaMs),
  };
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const nonNeg = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/**
 * Brings saved state back for this puzzle and date, or starts fresh. State
 * from another puzzle, another date or an unknown version never carries over.
 */
export function restoreState(saved: unknown, puzzle: WordWebPuzzle, date: string): WordWebState {
  const fresh = initialState(puzzle, date);
  if (!isRec(saved) || saved.schemaVersion !== WORDWEB_STATE_VERSION) return fresh;
  if (saved.puzzleId !== puzzle.id || saved.date !== date) return fresh;
  const ids = new Set(puzzle.answers.map((a) => a.id));

  // Keep solved answers only in an order the unlock tree allows.
  const solved: string[] = [];
  for (const id of Array.isArray(saved.solved) ? saved.solved : []) {
    if (typeof id !== "string" || !ids.has(id) || solved.includes(id)) continue;
    if (visibleIds(puzzle.answers, new Set(solved)).has(id)) solved.push(id);
  }
  const cells = new Set(puzzle.answers.flatMap((a) => cellsOf(a).map(([r, c]) => cellKey(r, c))));
  const typed: Record<string, string> = {};
  if (isRec(saved.typed))
    for (const [k, v] of Object.entries(saved.typed))
      if (cells.has(k) && typeof v === "string" && normalizeLetter(v) === v) typed[k] = v;
  const hinted = (Array.isArray(saved.hinted) ? saved.hinted : []).filter(
    (k, i, all): k is string => typeof k === "string" && cells.has(k) && all.indexOf(k) === i,
  );
  const guesses: Record<string, string[]> = {};
  if (isRec(saved.guesses))
    for (const [id, list] of Object.entries(saved.guesses))
      if (ids.has(id) && Array.isArray(list))
        guesses[id] = list.filter((g): g is string => typeof g === "string");
  const hintCooldownMs =
    typeof saved.hintCooldownMs === "number"
      ? Math.min(HINT_COOLDOWN_MS, nonNeg(saved.hintCooldownMs))
      : HINT_COOLDOWN_MS;
  const log = (Array.isArray(saved.log) ? saved.log : []).filter(
    (s): s is ProofStep =>
      Array.isArray(s) && ((s[0] === "g" && s.length === 3) || (s[0] === "h" && s.length === 2)),
  );

  const state: WordWebState = {
    ...fresh,
    solved,
    typed,
    hinted,
    hintsUsed: Math.max(hinted.length, Math.floor(nonNeg(saved.hintsUsed))),
    guesses,
    guessCount: Math.floor(nonNeg(saved.guessCount)),
    hintCooldownMs,
    elapsedMs: nonNeg(saved.elapsedMs),
    log: log.slice(-MAX_LOG),
  };
  const open = openAnswers(puzzle, state);
  const done = solved.length === puzzle.answers.length;
  const savedResult = isRec(saved.result)
    ? (saved.result as unknown as WordWebResultSummary)
    : null;
  const active =
    typeof saved.active === "string" && open.some((a) => a.id === saved.active)
      ? saved.active
      : (open[0]?.id ?? null);
  return {
    ...state,
    active: done ? null : active,
    done,
    // The official result is whatever was recorded at completion.
    result: done
      ? savedResult && typeof savedResult.completedAt === "string"
        ? {
            elapsedMs: nonNeg(savedResult.elapsedMs),
            hintsUsed: Math.floor(nonNeg(savedResult.hintsUsed)),
            guessCount: Math.floor(nonNeg(savedResult.guessCount)),
            completedAt: savedResult.completedAt,
          }
        : {
            elapsedMs: state.elapsedMs,
            hintsUsed: state.hintsUsed,
            guessCount: state.guessCount,
            completedAt: "",
          }
      : null,
  };
}

/**
 * Replays a finished game's log against the puzzle (server re-check).
 * Returns the recomputed counts, or null if it doesn't solve the puzzle.
 */
export function replayLog(
  puzzle: WordWebPuzzle,
  log: unknown,
): { hintsUsed: number; guessCount: number } | null {
  if (!Array.isArray(log) || log.length > MAX_LOG) return null;
  let s = initialState(puzzle, "replay");
  for (const step of log) {
    if (!Array.isArray(step) || typeof step[1] !== "string") return null;
    if (step[0] === "g" && typeof step[2] === "string") {
      if (!openAnswers(puzzle, s).some((a) => a.id === step[1])) return null;
      s = submitGuess(puzzle, s, step[1], step[2], () => "").state;
    } else if (step[0] === "h") {
      s = selectAnswer(puzzle, s, step[1]);
      if (s.active !== step[1]) return null;
      const res = takeHint(puzzle, { ...s, hintCooldownMs: 0 });
      if (res.index === null) return null;
      s = res.state;
    } else return null;
  }
  return s.done ? { hintsUsed: s.hintsUsed, guessCount: s.guessCount } : null;
}
