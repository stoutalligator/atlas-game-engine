import { formatClock, puzzleNumber } from "../../core/daily.js";
import type { WordWebState } from "./play.js";
import type { WordWebPuzzle } from "./types.js";

// Share text. It names the day, the difficulty, time, hints and guesses, and
// one square per answer in the order solved — never letters, lengths,
// positions or the category.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** 🟩 first guess with no hint in its cells, 🟨 otherwise. */
export function progressionSquares(state: WordWebState): string {
  const hintedBy = new Set(state.log.filter((s) => s[0] === "h").map((s) => s[1]));
  return state.solved
    .map((id) => ((state.guesses[id]?.length ?? 0) <= 1 && !hintedBy.has(id) ? "🟩" : "🟨"))
    .join("");
}

export function wordWebShareText(puzzle: WordWebPuzzle, state: WordWebState, date: string): string {
  const r = state.result;
  const hints = r?.hintsUsed ?? state.hintsUsed;
  const guesses = r?.guessCount ?? state.guessCount;
  const secs = Math.round((r?.elapsedMs ?? state.elapsedMs) / 1000);
  return [
    `ATLAS Word Web 🕸️ #${puzzleNumber(date)}`,
    `${WEEKDAYS[puzzle.weekday]} · ${puzzle.difficulty}`,
    progressionSquares(state),
    `${hints} hint${hints === 1 ? "" : "s"} | ${formatClock(secs)} | ${guesses} guess${guesses === 1 ? "" : "es"}`,
  ].join("\n");
}
