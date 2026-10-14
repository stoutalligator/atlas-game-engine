import { dayIndex, weekday } from "../../core/daily.js";
import { seededRng, shuffle } from "../../core/rng.js";
import { CUBE_RUSH_LIBRARY } from "./library.js";
import {
  type CubeRushPuzzle,
  type Difficulty,
  type Direction,
  applyMove,
  canMove,
  decodePuzzle,
  difficultyForWeekday,
  isSolved,
} from "./logic.js";

/** Today's puzzle: difficulty follows the weekday; the library is walked in a fixed shuffle. */
export function cubeRushForDate(date: string): {
  puzzle: CubeRushPuzzle;
  par: number;
  difficulty: Difficulty;
} {
  const difficulty = difficultyForWeekday(weekday(date));
  const list = CUBE_RUSH_LIBRARY[difficulty];
  const order = shuffle(
    seededRng(`cube-rush:order:${difficulty}`),
    list.map((_, i) => i),
  );
  const week = Math.floor(dayIndex(date) / 7);
  const slot = (week * 7 + weekday(date)) % order.length;
  const { puzzle, par } = decodePuzzle(list[order[slot]]);
  return { puzzle, par, difficulty };
}

export type CubeStep = [pieceId: string, dir: Direction];

/** Moves = runs of consecutive steps by the same piece. */
export function countMoves(steps: readonly CubeStep[]): number {
  let moves = 0;
  for (let i = 0; i < steps.length; i++) if (i === 0 || steps[i][0] !== steps[i - 1][0]) moves++;
  return moves;
}

/** Replays steps from the start position. Returns the move count if they free the analyst. */
export function replayCubeRush(puzzle: CubeRushPuzzle, steps: readonly CubeStep[]): number | null {
  let pz = puzzle;
  for (const [id, dir] of steps) {
    if (isSolved(pz) || !canMove(pz, id, dir)) return null;
    pz = applyMove(pz, id, dir);
  }
  return isSolved(pz) ? countMoves(steps) : null;
}
