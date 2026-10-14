import { dayIndex } from "../../core/daily.js";
import { seededRng, shuffle } from "../../core/rng.js";
import { PICTURES, type PicturePuzzle } from "./pictures.js";

export const EMPTY = 0;
export const FILLED = 1;
export const MARKED = 2;
export type CellState = typeof EMPTY | typeof FILLED | typeof MARKED;

export interface BoxPlotPuzzle {
  name: string;
  size: number;
  solution: boolean[][];
  rowClues: number[][];
  colClues: number[][];
}

/** Lengths of consecutive filled runs, e.g. [T,T,F,T] → [2,1]. Empty line → []. */
export function runsOf(line: readonly boolean[]): number[] {
  const runs: number[] = [];
  let run = 0;
  for (const v of line) {
    if (v) run++;
    else if (run) {
      runs.push(run);
      run = 0;
    }
  }
  if (run) runs.push(run);
  return runs;
}

function column<T>(grid: readonly (readonly T[])[], c: number): T[] {
  return grid.map((row) => row[c]);
}

export function buildPuzzle(picture: PicturePuzzle): BoxPlotPuzzle {
  const solution = picture.rows.map((r) => [...r].map((ch) => ch === "1"));
  const size = solution.length;
  return {
    name: picture.name,
    size,
    solution,
    rowClues: solution.map(runsOf),
    colClues: Array.from({ length: size }, (_, c) => runsOf(column(solution, c))),
  };
}

const sameRuns = (a: number[], b: number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function lineMatches(cells: readonly CellState[], clue: number[]): boolean {
  return sameRuns(runsOf(cells.map((c) => c === FILLED)), clue);
}

/** Solved when every row and column matches its clue (alternate solutions count). */
export function isSolved(puzzle: BoxPlotPuzzle, cells: readonly (readonly CellState[])[]): boolean {
  for (let r = 0; r < puzzle.size; r++)
    if (!lineMatches(cells[r], puzzle.rowClues[r])) return false;
  for (let c = 0; c < puzzle.size; c++)
    if (!lineMatches(column(cells, c), puzzle.colClues[c])) return false;
  return true;
}

// ── Line solver (used by tests to guarantee no guessing is needed) ─────────

type Known = 0 | 1 | null;

/** All placements of `clue` in a line of length n consistent with `known`. */
function placements(clue: number[], known: Known[]): boolean[][] {
  const n = known.length;
  const out: boolean[][] = [];
  const line: boolean[] = new Array(n).fill(false);

  const fits = (from: number, to: number, value: boolean) => {
    for (let i = from; i < to; i++) {
      const k = known[i];
      if (k !== null && k !== (value ? 1 : 0)) return false;
    }
    return true;
  };

  const place = (idx: number, start: number) => {
    if (idx === clue.length) {
      if (fits(start, n, false)) out.push([...line]);
      return;
    }
    const len = clue[idx];
    const remaining = clue.slice(idx + 1).reduce((s, v) => s + v + 1, 0);
    for (let pos = start; pos + len + remaining <= n; pos++) {
      if (!fits(start, pos, false)) break;
      if (!fits(pos, pos + len, true)) continue;
      if (pos + len < n && known[pos + len] === 1) continue;
      for (let i = pos; i < pos + len; i++) line[i] = true;
      place(idx + 1, pos + len + 1);
      for (let i = pos; i < pos + len; i++) line[i] = false;
    }
  };

  place(0, 0);
  return out;
}

/** Solves with line logic only. Returns the grid, or null if guessing would be needed. */
export function lineSolve(rowClues: number[][], colClues: number[][]): boolean[][] | null {
  const rows = rowClues.length;
  const cols = colClues.length;
  const grid: Known[][] = Array.from({ length: rows }, () => new Array(cols).fill(null));

  const solveLine = (clue: number[], cells: Known[]): Known[] | false => {
    const options = placements(clue, cells);
    if (options.length === 0) return false;
    return cells.map((_, i) => {
      const first = options[0][i];
      return options.every((o) => o[i] === first) ? (first ? 1 : 0) : null;
    });
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < rows; r++) {
      const next = solveLine(rowClues[r], grid[r]);
      if (!next) return null;
      next.forEach((v, c) => {
        if (v !== grid[r][c]) {
          grid[r][c] = v;
          changed = true;
        }
      });
    }
    for (let c = 0; c < cols; c++) {
      const next = solveLine(colClues[c], column(grid, c));
      if (!next) return null;
      next.forEach((v, r) => {
        if (v !== grid[r][c]) {
          grid[r][c] = v;
          changed = true;
        }
      });
    }
  }

  if (grid.some((row) => row.some((v) => v === null))) return null;
  return grid.map((row) => row.map((v) => v === 1));
}

// ── Daily selection ────────────────────────────────────────────────────────

/**
 * Walks a fixed shuffle of the library so pictures don't repeat until all
 * have been used.
 */
export function boxPlotForDate(date: string, pictures: PicturePuzzle[] = PICTURES): BoxPlotPuzzle {
  const order = shuffle(
    seededRng("box-plot:order"),
    pictures.map((_, i) => i),
  );
  const idx = order[((dayIndex(date) % order.length) + order.length) % order.length];
  return buildPuzzle(pictures[idx]);
}
