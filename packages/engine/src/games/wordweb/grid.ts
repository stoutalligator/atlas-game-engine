import type { Cell, Direction } from "./types.js";

/** The geometry every module works with: where an answer's letters sit. */
export interface Placed {
  id: string;
  grid: string;
  row: number;
  col: number;
  direction: Direction;
}

export const cellKey = (r: number, c: number) => `${r},${c}`;

export function cellsOf(a: Placed): Cell[] {
  return Array.from(a.grid, (_, i) =>
    a.direction === "across" ? ([a.row, a.col + i] as const) : ([a.row + i, a.col] as const),
  );
}

/** Index of (r, c) inside the answer, or -1. */
export function indexIn(a: Placed, r: number, c: number): number {
  const i = a.direction === "across" ? c - a.col : r - a.row;
  const onLine = a.direction === "across" ? r === a.row : c === a.col;
  return onLine && i >= 0 && i < a.grid.length ? i : -1;
}

export interface Crossing {
  a: string;
  b: string;
  cell: Cell;
  /** Index in a / in b. */
  ia: number;
  ib: number;
}

/** Every shared cell between two answers (a legal pair has at most one). */
export function crossingsBetween(a: Placed, b: Placed): Crossing[] {
  const out: Crossing[] = [];
  cellsOf(a).forEach(([r, c], ia) => {
    const ib = indexIn(b, r, c);
    if (ib >= 0) out.push({ a: a.id, b: b.id, cell: [r, c], ia, ib });
  });
  return out;
}

export interface Bounds {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
  rows: number;
  cols: number;
}

export function boundsOf(cells: Iterable<Cell>): Bounds {
  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  for (const [r, c] of cells) {
    minRow = Math.min(minRow, r);
    minCol = Math.min(minCol, c);
    maxRow = Math.max(maxRow, r);
    maxCol = Math.max(maxCol, c);
  }
  if (minRow === Number.POSITIVE_INFINITY)
    return { minRow: 0, minCol: 0, maxRow: -1, maxCol: -1, rows: 0, cols: 0 };
  return { minRow, minCol, maxRow, maxCol, rows: maxRow - minRow + 1, cols: maxCol - minCol + 1 };
}

/** Moves a layout so its bounding box starts at (0, 0). */
export function normalizeOrigin<T extends Placed>(answers: T[]): T[] {
  const b = boundsOf(answers.flatMap(cellsOf));
  return answers.map((a) => ({ ...a, row: a.row - b.minRow, col: a.col - b.minCol }));
}

/** Letter in each cell, or a conflict marker when two answers disagree. */
export function letterMap(answers: Placed[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of answers)
    cellsOf(a).forEach(([r, c], i) => {
      const k = cellKey(r, c);
      const prev = map.get(k);
      map.set(k, prev === undefined || prev === a.grid[i] ? a.grid[i] : "!");
    });
  return map;
}
