// The expedition chart's geometry, shared by the pack build (which places each
// day's harbor on the side facing yesterday's region) and the chart itself.
//
// The month is one hex map. Every region sits in a block of the same size on
// one world lattice, in a snake of five per row (left to right, then right to
// left), so neighbouring days share an edge. The hexes around a smaller
// region are filler sea and islands, generated from the pack id, so there
// are no channels or frames: the regions read as parts of one archipelago.

import { type Board, HEX_DIRS, buildBoard, isNavigable, neighbor } from "./rules.js";
import type { Cell, ChartSide, SeafarerPuzzle } from "./types.js";

/** Regions per row of the snake. */
export const EXPEDITION_COLS = 5;
/** Rows of open sea above the first row of regions (even, so odd-row shifts line up). */
export const TITLE_ROWS = 2;

/**
 * Which sides of day `index`'s region (0-based) face yesterday's and
 * tomorrow's regions. Along a row the voyage runs west to east (even rows)
 * or east to west (odd rows); at the end of a row it turns south.
 */
export function regionSides(index: number, total: number): { entry?: ChartSide; exit?: ChartSide } {
  const k = index % EXPEDITION_COLS;
  const eastward = Math.floor(index / EXPEDITION_COLS) % 2 === 0;
  return {
    entry: index === 0 ? undefined : k === 0 ? "n" : eastward ? "w" : "e",
    exit: index === total - 1 ? undefined : k === EXPEDITION_COLS - 1 ? "s" : eastward ? "e" : "w",
  };
}

export interface RegionSlot {
  /** World hex offset of the region's top-left cell (row is even, so odd-row shifts line up). */
  col: number;
  row: number;
  /** The block it sits in (world hexes). */
  block: { col: number; row: number; cols: number; rows: number };
}

export interface ExpeditionWorld {
  cols: number;
  rows: number;
  /** One slot per puzzle, in order. */
  slots: RegionSlot[];
  /** The whole month as one board: regions, filler sea and islands. */
  board: Board;
  /** World cell for a region's local cell. */
  toWorld: (index: number, cell: number) => number;
}

/** Small deterministic hash in [0, 1). */
function hash(n: number, salt: number): number {
  let x = (n + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

function saltOf(id: string): number {
  let s = 7;
  for (const ch of id) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return s % 100000;
}

/** Lays a pack's regions out on one world lattice and fills the space between them. */
export function expeditionWorld(
  packId: string,
  puzzles: Pick<SeafarerPuzzle, "cols" | "rows" | "map" | "places" | "storms">[],
): ExpeditionWorld {
  const blockCols = Math.max(...puzzles.map((p) => p.cols));
  const tallest = Math.max(...puzzles.map((p) => p.rows));
  const blockRows = tallest + (tallest % 2); // even, so every block starts on an even row
  const nRows = Math.ceil(puzzles.length / EXPEDITION_COLS);
  const cols = EXPEDITION_COLS * blockCols;
  const rows = TITLE_ROWS + nRows * blockRows;

  const slots: RegionSlot[] = puzzles.map((p, i) => {
    const r = Math.floor(i / EXPEDITION_COLS);
    const k = i % EXPEDITION_COLS;
    const c = r % 2 === 0 ? k : EXPEDITION_COLS - 1 - k;
    const block = {
      col: c * blockCols,
      row: TITLE_ROWS + r * blockRows,
      cols: blockCols,
      rows: blockRows,
    };
    // Centre the region in its block; its first row stays even.
    let row = block.row + Math.floor((blockRows - p.rows) / 2);
    row -= row % 2;
    return { col: block.col + Math.floor((blockCols - p.cols) / 2), row, block };
  });
  const toWorld = (index: number, cell: number) => {
    const p = puzzles[index];
    const s = slots[index];
    return (s.row + Math.floor(cell / p.cols)) * cols + s.col + (cell % p.cols);
  };

  // Filler: open sea with the odd island, kept a hex clear of every region
  // and of the title, so it never walls a region in.
  const salt = saltOf(packId);
  const grid: string[] = new Array(cols * rows).fill(".");
  const owner = new Int16Array(cols * rows).fill(-1);
  puzzles.forEach((p, i) => {
    for (let c = 0; c < p.cols * p.rows; c++) owner[toWorld(i, c)] = i;
  });
  const geo = { cols, rows };
  const clear = (c: number) =>
    owner[c] < 0 &&
    Math.floor(c / cols) >= TITLE_ROWS &&
    HEX_DIRS.every((d) => {
      const n = neighbor(geo, c, d);
      return n < 0 || owner[n] < 0;
    });
  for (let c = 0; c < grid.length; c++) {
    if (!clear(c) || hash(c, salt) > 0.035) continue;
    // Grow a small island from this seed.
    let at = c;
    const size = 2 + Math.floor(hash(c, salt + 1) * 5);
    for (let i = 0; i < size; i++) {
      if (clear(at)) grid[at] = "#";
      const n = neighbor(geo, at, HEX_DIRS[Math.floor(hash(at * 7 + i, salt + 2) * 6)]);
      if (n < 0) break;
      at = n;
    }
  }
  const map: string[] = [];
  for (let r = 0; r < rows; r++) map.push(grid.slice(r * cols, (r + 1) * cols).join(""));
  const board = buildBoard({ cols, rows, map, places: [] });
  // The regions' own hexes, exactly as charted.
  puzzles.forEach((p, i) => {
    const local = buildBoard({ ...p, storms: [] });
    local.cells.forEach((cell: Cell, c) => {
      board.cells[toWorld(i, c)] = cell;
    });
  });
  return { cols, rows, slots, board, toWorld };
}

/**
 * The sea lane between two world cells: fewest hexes over navigable water
 * (currents and shallows count as sea; this is a sketch on the chart, not a
 * voyage). Falls back to the two ends if they're not connected.
 */
export function seaLane(board: Board, from: number, to: number): number[] {
  const prev = new Int32Array(board.cells.length).fill(-2);
  prev[from] = -1;
  const queue = [from];
  for (let i = 0; i < queue.length && prev[to] === -2; i++) {
    const c = queue[i];
    for (const d of HEX_DIRS) {
      const n = neighbor(board, c, d);
      if (n < 0 || prev[n] !== -2 || !isNavigable(board.cells[n])) continue;
      prev[n] = c;
      queue.push(n);
    }
  }
  if (prev[to] === -2) return [from, to];
  const path: number[] = [];
  for (let c = to; c !== -1; c = prev[c]) path.push(c);
  return path.reverse();
}
