import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SlidePuzzle.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

export type PieceColor = "person" | "orange" | "blue" | "green" | "purple" | "black";
export type Direction = "up" | "down" | "left" | "right";
export type GateSide = "top" | "bottom" | "left" | "right";

export interface Piece {
  id: string;
  color: PieceColor;
  col: number; // top-left column
  row: number; // top-left row
  width: number; // cells wide
  height: number; // cells tall
  immovable: boolean;
  /**
   * For non-rectangular pieces: relative [dc, dr] offsets of each occupied cell
   * from the top-left corner of the bounding box. When absent, the full
   * width×height rectangle is used.
   */
  cellOffsets?: Array<[number, number]>;
}

export interface Gate {
  side: GateSide;
  /** Column index for top/bottom gates; row index for left/right gates */
  index: number;
}

export interface PuzzleConfig {
  gridWidth: number;
  gridHeight: number;
  /** Set of "row,col" strings representing valid grid cells */
  validCells: Set<string>;
  pieces: Piece[]
  gate: Gate;
}

/** Difficulty preset controlling puzzle complexity. */
export type SlidePuzzleDifficulty = "easy" | "medium" | "hard";

/** Visual theme for the puzzle UI. */
export type SlidePuzzleTheme = "modern" | "8bit" | "terminal";

/** Options accepted by generatePuzzle(). */
export interface SlidePuzzleOptions {
  /**
   * ISO date string (e.g. "2026-03-06"). When provided, generatePuzzle returns
   * the same puzzle for that date every time — useful for daily puzzles where
   * all users should see an identical layout.
   */
  date?: string;
  /** Controls scramble depth and which template set is used. Default: "medium" */
  difficulty?: SlidePuzzleDifficulty;
}

/** Props accepted by the <SlidePuzzle> component. */
export interface SlidePuzzleProps {
  /**
   * ISO date string (e.g. "2026-03-06"). Seeds the initial puzzle so all users
   * receive the same layout for the same date. Clicking "Generate New Puzzle"
   * afterwards produces random puzzles.
   */
  date?: string;
  /** Controls puzzle complexity. Default: "medium" */
  difficulty?: SlidePuzzleDifficulty;
  /** Visual theme. Default: "modern" */
  theme?: SlidePuzzleTheme;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CELL = 68; // px per cell
const GAP = 4; // px gap between cells
const BORDER = 5; // px border thickness

// Scramble tuning constants
const MAX_MOVE_ATTEMPTS = 50; // retry limit when searching for a valid scramble move

// ── Seeded RNG ──────────────────────────────────────────────────────────────

type Rng = () => number;

/** Mulberry32 — fast seeded PRNG, no external dependencies. */
function mulberry32(seed: number): Rng {
  let s = seed;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a hash of a string → deterministic u32 seed. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) | 0;
  }
  return h >>> 0;
}

// ── Difficulty settings ─────────────────────────────────────────────────────

interface DifficultySettings {
  minMoves: number;
  movesRange: number;
  /** Only use templates with at most this many valid cells (easy = smaller grids). */
  maxCells?: number;
  /** Only use templates with at least this many valid cells (hard = larger grids). */
  minCells?: number;
}

const DIFFICULTY_SETTINGS: Record<SlidePuzzleDifficulty, DifficultySettings> = {
  easy:   { minMoves: 15, movesRange: 15, maxCells: 36 },
  medium: { minMoves: 40, movesRange: 30 },
  hard:   { minMoves: 80, movesRange: 40, minCells: 40 },
};

// ── Utility helpers ────────────────────────────────────────────────────────

let _uid = 0;
const nextId = (prefix: string) => `${prefix}-${++_uid}`;

const ck = (r: number, c: number) => `${r},${c}`;

function makeRectGrid(w: number, h: number): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) s.add(ck(r, c));
  return s;
}

/**
 * L-shape: full w×h minus top-right corner of size (cutW × cutH).
 */
function makeLGrid(w: number, h: number, cutW: number, cutH: number): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) if (!(r < cutH && c >= w - cutW)) s.add(ck(r, c));
  return s;
}

function isGateExit(gate: Gate, gw: number, gh: number, r: number, c: number): boolean {
  switch (gate.side) {
    case "top":
      return r === -1 && c === gate.index;
    case "bottom":
      return r === gh && c === gate.index;
    case "left":
      return c === -1 && r === gate.index;
    case "right":
      return c === gw && r === gate.index;
  }
}

/** Returns the absolute [col, row] coordinates for every cell occupied by piece p. */
function pieceAbsCells(p: Piece): Array<[col: number, row: number]> {
  if (p.cellOffsets) return p.cellOffsets.map(([dc, dr]) => [p.col + dc, p.row + dr]);
  const cells: Array<[number, number]> = [];
  for (let dc = 0; dc < p.width; dc++)
    for (let dr = 0; dr < p.height; dr++) cells.push([p.col + dc, p.row + dr]);
  return cells;
}

function buildOccupancy(pieces: Piece[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pieces)
    for (const [c, r] of pieceAbsCells(p)) m.set(ck(r, c), p.id);
  return m;
}

// ── Movement logic ─────────────────────────────────────────────────────────

function canMove(cfg: PuzzleConfig, pieceId: string, dir: Direction): boolean {
  const piece = cfg.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.immovable) return false;

  // All movable pieces can slide in any of the four directions.

  const dx = dir === "right" ? 1 : dir === "left" ? -1 : 0;
  const dy = dir === "down" ? 1 : dir === "up" ? -1 : 0;

  const isPerson = piece.color === "person";
  const occ = buildOccupancy(cfg.pieces);
  const currentCells = new Set(pieceAbsCells(piece).map(([c, r]) => ck(r, c)));

  for (const [c, r] of pieceAbsCells(piece)) {
    const nc = c + dx;
    const nr = r + dy;

    // This cell would land on a position already held by this piece (overlap after slide) — OK
    if (currentCells.has(ck(nr, nc))) continue;

    // Gate exit cell: only the person may enter
    if (isGateExit(cfg.gate, cfg.gridWidth, cfg.gridHeight, nr, nc)) {
      if (!isPerson) return false;
      continue;
    }

    // Must be a valid grid cell
    if (!cfg.validCells.has(ck(nr, nc))) return false;

    // Must not be occupied by another piece
    const occupant = occ.get(ck(nr, nc));
    if (occupant && occupant !== pieceId) return false;
  }

  return true;
}

function applyMove(cfg: PuzzleConfig, pieceId: string, dir: Direction): PuzzleConfig {
  const dx = dir === "right" ? 1 : dir === "left" ? -1 : 0;
  const dy = dir === "down" ? 1 : dir === "up" ? -1 : 0;
  return {
    ...cfg,
    pieces: cfg.pieces.map((p) =>
      p.id === pieceId ? { ...p, col: p.col + dx, row: p.row + dy } : p,
    ),
  };
}

function hasWon(cfg: PuzzleConfig): boolean {
  const person = cfg.pieces.find((p) => p.color === "person");
  if (!person) return false;
  return isGateExit(cfg.gate, cfg.gridWidth, cfg.gridHeight, person.row, person.col);
}

// ── Puzzle generator ───────────────────────────────────────────────────────

interface PieceDef {
  color: PieceColor;
  w: number;
  h: number;
  immovable?: boolean;
  /** Non-rectangular piece: relative [dc, dr] cell offsets (same semantics as Piece.cellOffsets). */
  cellOffsets?: Array<[number, number]>;
}

interface Template {
  gw: number;
  gh: number;
  cells: Set<string>;
  gate: Gate;
  pieces: PieceDef[];
}

function makeTemplates(): Template[] {
  // Mix of large (3×1, 1×3) and medium (2×1, 1×2) pieces.
  // Large pieces create hard-to-break blockades; medium pieces add flexibility
  // so there are just enough moves to make the puzzle solvable but non-trivial.
  // No immovable pieces — all blockers are movable. Axis-lock applies throughout.
  return [
    // ── 6×6, gate right row 2 ─────────────────────────────────────────────
    {
      gw: 6, gh: 6,
      cells: makeRectGrid(6, 6),
      gate: { side: "right", index: 2 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "blue",   w: 2, h: 1 },
        { color: "orange", w: 3, h: 1 },
        { color: "orange", w: 1, h: 3 },
        { color: "green",  w: 1, h: 3 },
        { color: "green",  w: 2, h: 1 },
        { color: "purple", w: 1, h: 2 },
      ],
    },
    // ── 7×7, gate right row 3 ─────────────────────────────────────────────
    {
      gw: 7, gh: 7,
      cells: makeRectGrid(7, 7),
      gate: { side: "right", index: 3 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "blue",   w: 2, h: 1 },
        { color: "blue",   w: 1, h: 2 },
        { color: "orange", w: 3, h: 1 },
        { color: "orange", w: 1, h: 3 },
        { color: "orange", w: 2, h: 1 },
        { color: "green",  w: 3, h: 1 },
        { color: "green",  w: 1, h: 3 },
        { color: "purple", w: 1, h: 3 },
        { color: "purple", w: 2, h: 1 },
        // L-shape: ##  (missing bottom-right corner)
        //           #·
        { color: "black", w: 2, h: 2, cellOffsets: [[0,0],[1,0],[0,1]] },
      ],
    },
    // ── 7×7, gate bottom col 3 ────────────────────────────────────────────
    {
      gw: 7, gh: 7,
      cells: makeRectGrid(7, 7),
      gate: { side: "bottom", index: 3 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "blue",   w: 2, h: 1 },
        { color: "orange", w: 3, h: 1 },
        { color: "orange", w: 1, h: 3 },
        { color: "orange", w: 1, h: 2 },
        { color: "green",  w: 3, h: 1 },
        { color: "green",  w: 1, h: 3 },
        { color: "purple", w: 1, h: 3 },
        { color: "purple", w: 2, h: 1 },
        // L-shape: ##  (missing bottom-left corner)
        //           ·#
        { color: "black", w: 2, h: 2, cellOffsets: [[0,0],[1,0],[1,1]] },
      ],
    },
    // ── 6×6, gate left row 3 ──────────────────────────────────────────────
    {
      gw: 6, gh: 6,
      cells: makeRectGrid(6, 6),
      gate: { side: "left", index: 3 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "blue",   w: 1, h: 2 },
        { color: "orange", w: 3, h: 1 },
        { color: "orange", w: 1, h: 3 },
        { color: "green",  w: 3, h: 1 },
        { color: "green",  w: 1, h: 2 },
        { color: "purple", w: 2, h: 1 },
      ],
    },
    // ── 7×7, gate top col 3 ───────────────────────────────────────────────
    {
      gw: 7, gh: 7,
      cells: makeRectGrid(7, 7),
      gate: { side: "top", index: 3 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "blue",   w: 2, h: 1 },
        { color: "blue",   w: 1, h: 2 },
        { color: "orange", w: 3, h: 1 },
        { color: "orange", w: 1, h: 3 },
        { color: "orange", w: 1, h: 2 },
        { color: "green",  w: 3, h: 1 },
        { color: "green",  w: 1, h: 3 },
        { color: "purple", w: 1, h: 3 },
        { color: "purple", w: 2, h: 1 },
        // L-shape: #·  (missing top-right corner)
        //           ##
        { color: "black", w: 2, h: 2, cellOffsets: [[0,0],[0,1],[1,1]] },
      ],
    },
    // ── 8×6, gate right row 2 ─────────────────────────────────────────────
    {
      gw: 8, gh: 6,
      cells: makeRectGrid(8, 6),
      gate: { side: "right", index: 2 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "blue",   w: 2, h: 1 },
        { color: "orange", w: 3, h: 1 },
        { color: "orange", w: 1, h: 3 },
        { color: "orange", w: 2, h: 1 },
        { color: "green",  w: 3, h: 1 },
        { color: "green",  w: 1, h: 3 },
        { color: "purple", w: 3, h: 1 },
        { color: "purple", w: 1, h: 2 },
        // L-shape: ·#  (missing top-left corner)
        //           ##
        { color: "black", w: 2, h: 2, cellOffsets: [[1,0],[0,1],[1,1]] },
      ],
    },
    // ── 5×5, gate right row 2 (easy) ──────────────────────────────────────
    {
      gw: 5, gh: 5,
      cells: makeRectGrid(5, 5),
      gate: { side: "right", index: 2 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "orange", w: 2, h: 1 },
        { color: "orange", w: 1, h: 2 },
        { color: "green",  w: 1, h: 3 },
        { color: "purple", w: 3, h: 1 },
      ],
    },
    // ── 7×7 L-shape (cut top-right 3×3), gate right row 5 ────────────────
    {
      gw: 7, gh: 7,
      cells: makeLGrid(7, 7, 3, 3),
      gate: { side: "right", index: 5 },
      pieces: [
        { color: "blue",   w: 3, h: 1 },
        { color: "blue",   w: 1, h: 3 },
        { color: "orange", w: 2, h: 1 },
        { color: "orange", w: 1, h: 2 },
        { color: "green",  w: 3, h: 1 },
        { color: "green",  w: 1, h: 3 },
        { color: "purple", w: 2, h: 1 },
        { color: "purple", w: 1, h: 2 },
        // L-shape: ##  (missing bottom-right corner)
        //           #·
        { color: "black", w: 2, h: 2, cellOffsets: [[0,0],[1,0],[0,1]] },
      ],
    },
  ];
}

/**
 * Try to find a valid top-left position (col, row) for a piece within validCells,
 * avoiding already-occupied cells. If cellOffsets is provided the piece is non-rectangular
 * and each offset cell is checked individually; otherwise the full w×h rectangle is used.
 */
function tryPlace(
  cells: Set<string>,
  occupied: Set<string>,
  w: number,
  h: number,
  rng: Rng,
  cellOffsets?: Array<[number, number]>,
): { col: number; row: number } | null {
  const candidates: { row: number; col: number }[] = [];

  for (const k of cells) {
    const [r, c] = k.split(",").map(Number);
    let fits = true;
    if (cellOffsets) {
      for (const [dc, dr] of cellOffsets) {
        if (!cells.has(ck(r + dr, c + dc)) || occupied.has(ck(r + dr, c + dc))) {
          fits = false;
          break;
        }
      }
    } else {
      for (let dc = 0; dc < w && fits; dc++)
        for (let dr = 0; dr < h && fits; dr++)
          if (!cells.has(ck(r + dr, c + dc)) || occupied.has(ck(r + dr, c + dc))) fits = false;
    }
    if (fits) candidates.push({ row: r, col: c });
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng() * candidates.length)];
}

/**
 * Returns true if the person can reach the gate exit by moving only in the
 * toward-gate direction without needing to shift any other piece — i.e. a
 * trivial straight-shot that requires zero puzzle-solving effort.
 */
function hasClearPath(cfg: PuzzleConfig): boolean {
  const { gate, gridWidth: gw, gridHeight: gh } = cfg;
  const person = cfg.pieces.find((p) => p.color === "person")!;
  const occ = buildOccupancy(cfg.pieces);

  const towardDir: Direction =
    gate.side === "right" ? "right" :
    gate.side === "left"  ? "left"  :
    gate.side === "top"   ? "up"    : "down";

  const dx = towardDir === "right" ? 1 : towardDir === "left" ? -1 : 0;
  const dy = towardDir === "down"  ? 1 : towardDir === "up"   ? -1 : 0;

  let r = person.row + dy;
  let c = person.col + dx;

  while (r >= 0 && r < gh && c >= 0 && c < gw) {
    if (isGateExit(gate, gw, gh, r, c)) return true;
    if (occ.has(ck(r, c)) && occ.get(ck(r, c)) !== "person") return false;
    r += dy;
    c += dx;
  }
  // Reached grid boundary without hitting the gate — not a clear path.
  return false;
}

/**
 * Generate a solvable puzzle by:
 * 1. Placing pieces (person adjacent to gate, others randomly).
 * 2. Scrambling via N random valid moves (guarantees solvability by reversal).
 */
export function generatePuzzle(options: SlidePuzzleOptions = {}): PuzzleConfig {
  const { date, difficulty = "medium" } = options;
  // When a date is supplied, use a deterministic seeded RNG so the same date
  // always produces an identical puzzle layout for all users.
  const rng: Rng = date
    ? mulberry32(hashString(`${date}:${difficulty}`))
    : Math.random;

  const settings = DIFFICULTY_SETTINGS[difficulty];
  const TEMPLATES = makeTemplates();

  // Filter templates to those appropriate for the chosen difficulty.
  let tmplCandidates = TEMPLATES;
  if (settings.maxCells !== undefined)
    tmplCandidates = tmplCandidates.filter((t) => t.cells.size <= settings.maxCells!);
  if (settings.minCells !== undefined)
    tmplCandidates = tmplCandidates.filter((t) => t.cells.size >= settings.minCells!);
  if (tmplCandidates.length === 0) tmplCandidates = TEMPLATES; // safety fallback

  const tmpl = tmplCandidates[Math.floor(rng() * tmplCandidates.length)];
  const { gw, gh, cells, gate, pieces: defs } = tmpl;

  const pieces: Piece[] = [];
  const occupied = new Set<string>();

  // Place person adjacent to the gate (one step inside the grid).
  // This creates the solved initial state required for solvability-by-reversal:
  // the person can exit in one move, so reversing the scramble always solves the puzzle.
  let pCol = 0;
  let pRow = 0;
  switch (gate.side) {
    case "right":  pCol = gw - 1; pRow = gate.index; break;
    case "left":   pCol = 0;      pRow = gate.index; break;
    case "top":    pCol = gate.index; pRow = 0;      break;
    case "bottom": pCol = gate.index; pRow = gh - 1; break;
  }

  pieces.push({
    id: "person",
    color: "person",
    col: pCol,
    row: pRow,
    width: 1,
    height: 1,
    immovable: false,
  });
  occupied.add(ck(pRow, pCol));

  // Place remaining pieces
  for (const def of defs) {
    const pos = tryPlace(cells, occupied, def.w, def.h, rng, def.cellOffsets);
    if (!pos) continue;

    const placed: Piece = {
      id: nextId(def.color),
      color: def.color,
      col: pos.col,
      row: pos.row,
      width: def.w,
      height: def.h,
      immovable: def.immovable ?? false,
      cellOffsets: def.cellOffsets,
    };
    pieces.push(placed);
    for (const [c, r] of pieceAbsCells(placed)) occupied.add(ck(r, c));
  }

  // ── Build initial sparse config: person + template pieces only ──────────
  // Filler is intentionally NOT added yet so Phase 1 can reliably navigate
  // the person to the far wall without a packed grid blocking the path.
  let cfg: PuzzleConfig = { gridWidth: gw, gridHeight: gh, validCells: cells, pieces, gate };

  const DIRS: Direction[] = ["up", "down", "left", "right"];

  const awayDir: Direction =
    gate.side === "right" ? "left" :
    gate.side === "left"  ? "right" :
    gate.side === "top"   ? "down"  : "up";

  const isOnFarWall = (c: PuzzleConfig): boolean => {
    const person = c.pieces.find((p) => p.color === "person")!;
    switch (gate.side) {
      case "right":  return person.col === 0;
      case "left":   return person.col === gw - 1;
      case "top":    return person.row === gh - 1;
      case "bottom": return person.row === 0;
    }
  };

  // ── Phase 1: push person to the far wall on the sparse grid ──────────────
  // The sparse grid makes unblocking easy and reliable. Solvability guarantee:
  // the full move sequence (Phase 1 + Phase 2) can be reversed to reach the
  // gate, so the puzzle is always solvable.
  for (let attempt = 0; attempt < 2000 && !isOnFarWall(cfg); attempt++) {
    if (canMove(cfg, "person", awayDir)) {
      cfg = applyMove(cfg, "person", awayDir);
    } else {
      const others = cfg.pieces.filter((p) => !p.immovable && p.color !== "person");
      for (let sub = 0; sub < 30; sub++) {
        const p = others[Math.floor(rng() * others.length)];
        const d = DIRS[Math.floor(rng() * DIRS.length)];
        if (canMove(cfg, p.id, d)) { cfg = applyMove(cfg, p.id, d); break; }
      }
    }
  }

  // ── Add filler AFTER person is confirmed on the far wall ─────────────────
  // Now we pack the grid. Filler pieces will be scrambled in Phase 2 too.
  {
    // Rebuild occupation from post-Phase-1 piece positions.
    const occ = new Set<string>();
    for (const p of cfg.pieces)
      for (const [c, r] of pieceAbsCells(p)) occ.add(ck(r, c));

    const minFreeCells = Math.max(5, Math.floor(cells.size * 0.20));
    const fillerColors: PieceColor[] = ["orange", "blue", "green", "purple"];
    let fillerColorIdx = 0;
    const fillerSizes = [{ w: 3, h: 1 }, { w: 1, h: 3 }, { w: 2, h: 1 }, { w: 1, h: 2 }];
    const newPieces = [...cfg.pieces];

    for (const { w, h } of fillerSizes) {
      let pos = tryPlace(cells, occ, w, h, rng);
      while (pos !== null && cells.size - occ.size >= minFreeCells + w * h) {
        const color = fillerColors[fillerColorIdx++ % fillerColors.length];
        newPieces.push({
          id: nextId(color), color, col: pos.col, row: pos.row,
          width: w, height: h, immovable: false,
        });
        for (let dc = 0; dc < w; dc++)
          for (let dr = 0; dr < h; dr++) occ.add(ck(pos.row + dr, pos.col + dc));
        pos = tryPlace(cells, occ, w, h, rng);
      }
    }
    cfg = { ...cfg, pieces: newPieces };
  }

  // ── Phase 2: scramble NON-PERSON pieces only ──────────────────────────────
  // The person is NEVER moved in Phase 2. This gives two hard guarantees:
  //   1. Person stays on the far wall in the final puzzle — always far from gate.
  //   2. Solvability: reverse Phase 2 → restores Phase 1 end state →
  //      reverse Phase 1 → person adjacent to gate → exits.
  const nMoves = settings.minMoves + Math.floor(rng() * settings.movesRange);
  let lastId: string | null = null;

  for (let i = 0; i < nMoves; i++) {
    const movable = cfg.pieces.filter((p) => !p.immovable && p.color !== "person");
    if (movable.length === 0) break;

    for (let attempt = 0; attempt < MAX_MOVE_ATTEMPTS; attempt++) {
      const p = movable[Math.floor(rng() * movable.length)];
      const dir = DIRS[Math.floor(rng() * DIRS.length)];
      if (p.id === lastId) continue;
      if (!canMove(cfg, p.id, dir)) continue;
      cfg = applyMove(cfg, p.id, dir);
      lastId = p.id;
      break;
    }
  }

  // Final check: if the person has a clear straight-shot to the gate with no
  // pieces in the way, this puzzle is trivially easy — run one more scramble
  // pass (non-person pieces only) until the path is blocked.
  let antiTrivialAttempts = 0;
  while (hasClearPath(cfg) && antiTrivialAttempts < 200) {
    antiTrivialAttempts++;
    const movable = cfg.pieces.filter((p) => !p.immovable && p.color !== "person");
    if (movable.length === 0) break;
    for (let attempt = 0; attempt < MAX_MOVE_ATTEMPTS; attempt++) {
      const p = movable[Math.floor(rng() * movable.length)];
      const dir = DIRS[Math.floor(rng() * DIRS.length)];
      if (!canMove(cfg, p.id, dir)) continue;
      cfg = applyMove(cfg, p.id, dir);
      break;
    }
  }

  return cfg;
}

// ── Rendering helpers ──────────────────────────────────────────────────────

function cellToXY(c: number, r: number): { left: number; top: number } {
  return { left: c * (CELL + GAP), top: r * (CELL + GAP) };
}

/**
 * Returns the SVG path `d` string for a 3-cell L-shape piece whose bounding box is 2×2.
 * Uses arc commands so all corners — including the concave inner notch —
 * are smoothly rounded (r=10). The missing corner is inferred from whichever of the
 * four (dc,dr) positions is absent.
 *
 * Arc convention: outer convex corners use sweep=1; the single concave notch uses sweep=0.
 */
function lShapePathD(cellOffsets: Array<[number, number]>): string {
  const r = 10;
  const C = CELL;          // 68
  const tot = C + GAP;     // 72  — leading edge of second cell
  const end = 2 * C + GAP; // 140 — full bounding-box span

  // Inset outer boundary coords so the stroke (max 3px, half = 1.5) stays within the
  // bounding box, matching how CSS border behaves for rectangular pieces.
  const pad = 1.5;
  const ep = end - 2 * pad; // path-local outer extent (translate(pad,pad) applied in JSX)

  const has = (dc: number, dr: number) => cellOffsets.some(([a, b]) => a === dc && b === dr);
  const A = (sweep: 0 | 1, x: number, y: number) => `A ${r},${r} 0 0,${sweep} ${x},${y}`;

  let d: string;
  if (!has(1, 1)) {
    // missing bottom-right
    d = `M ${r},0 L ${ep-r},0 ${A(1,ep,r)} L ${ep},${C-r} ${A(1,ep-r,C)} L ${C+r},${C} ${A(0,C,C+r)} L ${C},${ep-r} ${A(1,C-r,ep)} L ${r},${ep} ${A(1,0,ep-r)} L 0,${r} ${A(1,r,0)} Z`;
  } else if (!has(1, 0)) {
    // missing top-right
    d = `M ${r},0 L ${C-r},0 ${A(1,C,r)} L ${C},${tot-r} ${A(0,C+r,tot)} L ${ep-r},${tot} ${A(1,ep,tot+r)} L ${ep},${ep-r} ${A(1,ep-r,ep)} L ${r},${ep} ${A(1,0,ep-r)} L 0,${r} ${A(1,r,0)} Z`;
  } else if (!has(0, 1)) {
    // missing bottom-left
    d = `M ${r},0 L ${ep-r},0 ${A(1,ep,r)} L ${ep},${ep-r} ${A(1,ep-r,ep)} L ${tot+r},${ep} ${A(1,tot,ep-r)} L ${tot},${C+r} ${A(0,tot-r,C)} L ${r},${C} ${A(1,0,C-r)} L 0,${r} ${A(1,r,0)} Z`;
  } else {
    // missing top-left
    d = `M ${tot+r},0 L ${ep-r},0 ${A(1,ep,r)} L ${ep},${ep-r} ${A(1,ep-r,ep)} L ${r},${ep} ${A(1,0,ep-r)} L 0,${tot+r} ${A(1,r,tot)} L ${tot-r},${tot} ${A(0,tot,tot-r)} L ${tot},${r} ${A(1,tot+r,0)} Z`;
  }
  return d;
}

/** Fill and stroke colours for each PieceColor (default/modern theme). */
const PIECE_SVG_COLORS: Record<PieceColor, { fill: string; stroke: string }> = {
  person: { fill: "#e8e8f0", stroke: "#9ca3af" },
  orange: { fill: "#f4a261", stroke: "#d97b3a" },
  blue:   { fill: "#7ec8e3", stroke: "#3fa8c8" },
  green:  { fill: "#86c87e", stroke: "#4e9e4a" },
  purple: { fill: "#c9a5d6", stroke: "#9966bb" },
  black:  { fill: "#f4a0a0", stroke: "#d96060" },
};

function pieceCSS(p: Piece): React.CSSProperties {
  return {
    left: p.col * (CELL + GAP),
    top: p.row * (CELL + GAP),
    width: p.width * CELL + (p.width - 1) * GAP,
    height: p.height * CELL + (p.height - 1) * GAP,
  };
}

type Seg = { key: string; style: React.CSSProperties };

/** Render border strips that trace the actual perimeter of validCells, with a gap at the gate.
 *  Works for any grid shape (rectangle, L-shape, etc.) — no special-casing needed.
 */
function borderSegments(cfg: PuzzleConfig, borderColor: string): Seg[] {
  const { gate, gridWidth: gw, gridHeight: gh, validCells } = cfg;
  const step = CELL + GAP;
  const B = BORDER;
  const base: React.CSSProperties = { position: "absolute", background: borderColor };
  const segs: Seg[] = [];
  let idx = 0;

  const push = (style: React.CSSProperties) =>
    segs.push({ key: `b${idx++}`, style: { ...base, ...style } });

  const isValid = (r: number, c: number) => validCells.has(ck(r, c));

  // ── Horizontal boundary segments ──────────────────────────────────────────
  // y-boundary `r` sits between row (r-1) above and row r below.
  // A border strip is needed wherever exactly one side is a valid cell.
  // A gate on top/bottom creates a gap by interrupting the current run.
  for (let r = 0; r <= gh; r++) {
    let runStart: number | null = null;

    const flushH = (c: number) => {
      if (runStart === null) return;
      push({
        top: r * step - B,
        left: runStart * step - B,
        width: (c - runStart) * step - GAP + 2 * B,
        height: B,
      });
      runStart = null;
    };

    for (let c = 0; c < gw; c++) {
      const aboveValid = r > 0 && isValid(r - 1, c);
      const belowValid = r < gh && isValid(r, c);
      const isBorder = aboveValid !== belowValid;
      const isGate =
        (gate.side === "top"    && r === 0  && c === gate.index) ||
        (gate.side === "bottom" && r === gh && c === gate.index);

      if (isBorder && !isGate) {
        if (runStart === null) runStart = c;
      } else {
        flushH(c);
      }
    }
    flushH(gw);
  }

  // ── Vertical boundary segments ────────────────────────────────────────────
  // x-boundary `c` sits between column (c-1) on the left and column c on the right.
  for (let c = 0; c <= gw; c++) {
    let runStart: number | null = null;

    const flushV = (r: number) => {
      if (runStart === null) return;
      push({
        left: c * step - B,
        top: runStart * step - B,
        width: B,
        height: (r - runStart) * step - GAP + 2 * B,
      });
      runStart = null;
    };

    for (let r = 0; r < gh; r++) {
      const leftValid  = c > 0  && isValid(r, c - 1);
      const rightValid = c < gw && isValid(r, c);
      const isBorder = leftValid !== rightValid;
      const isGate =
        (gate.side === "left"  && c === 0  && r === gate.index) ||
        (gate.side === "right" && c === gw && r === gate.index);

      if (isBorder && !isGate) {
        if (runStart === null) runStart = r;
      } else {
        flushV(r);
      }
    }
    flushV(gh);
  }

  return segs;
}

/** Position and text for the gate exit arrow. */
function gateArrowStyle(cfg: PuzzleConfig): React.CSSProperties {
  const { gate } = cfg;
  const step = CELL + GAP;
  const pos = gate.index * step + CELL / 2 - 12; // center on gate cell

  switch (gate.side) {
    case "right":
      return { right: -(BORDER + 32), top: pos };
    case "left":
      return { left: -(BORDER + 32), top: pos };
    case "top":
      return { top: -(BORDER + 32), left: pos };
    case "bottom":
      return { bottom: -(BORDER + 32), left: pos };
    default: {
      // TypeScript doesn't narrow exhaustive unions in all cases; this is unreachable at runtime.
      const _exhaustive: never = gate.side;
      throw new Error(`Unhandled gate side: ${_exhaustive}`);
    }
  }
}

const ARROW_CHAR: Record<GateSide, string> = { top: "↑", bottom: "↓", left: "←", right: "→" };

// ── Component ──────────────────────────────────────────────────────────────

/** Standalone slide-puzzle game — no external pack or storage required. */
export function SlidePuzzle({
  date,
  difficulty = "medium",
  theme = "modern",
}: SlidePuzzleProps = {}) {
  const initialCfg = useRef<PuzzleConfig>(generatePuzzle({ date, difficulty }));
  const [cfg, setCfg] = useState<PuzzleConfig>(initialCfg.current);
  const [selected, setSelected] = useState<string | null>(null);
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [won, setWon] = useState(false);

  // Refs for stable callbacks
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const wonRef = useRef(won);
  wonRef.current = won;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Timer
  useEffect(() => {
    if (won) return;
    const id = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [won]);

  // ── Stable move handler (uses refs to avoid stale closures) ───────────────
  const move = useCallback((pieceId: string, dir: Direction) => {
    if (wonRef.current) return;
    const current = cfgRef.current;
    if (!canMove(current, pieceId, dir)) return;
    const next = applyMove(current, pieceId, dir);
    setCfg(next);
    setMoves((m) => m + 1);
    if (hasWon(next)) setWon(true);
  }, []);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const sel = selectedRef.current;
      if (!sel) return;
      const dirMap: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const dir = dirMap[e.key];
      if (dir) {
        e.preventDefault();
        move(sel, dir);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [move]);

  // ── Drag handling ─────────────────────────────────────────────────────────
  const drag = useRef<{ id: string; sx: number; sy: number } | null>(null);

  useEffect(() => {
    const STEP = CELL + GAP;

    const handleMouseMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const { id, sx, sy } = drag.current;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;

      if (Math.abs(dx) >= STEP || Math.abs(dy) >= STEP) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          const steps = Math.trunc(dx / STEP);
          const dir: Direction = steps > 0 ? "right" : "left";
          const n = Math.abs(steps);
          for (let i = 0; i < n; i++) move(id, dir);
          drag.current = { id, sx: e.clientX - (dx % STEP), sy: e.clientY };
        } else {
          const steps = Math.trunc(dy / STEP);
          const dir: Direction = steps > 0 ? "down" : "up";
          const n = Math.abs(steps);
          for (let i = 0; i < n; i++) move(id, dir);
          drag.current = { id, sx: e.clientX, sy: e.clientY - (dy % STEP) };
        }
      }
    };

    const handleMouseUp = () => {
      drag.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [move]);

  // ── New puzzle ────────────────────────────────────────────────────────────
  const handleNew = () => {
    const next = generatePuzzle({ difficulty });
    initialCfg.current = next;
    setCfg(next);
    setSelected(null);
    setMoves(0);
    setElapsed(0);
    setWon(false);
  };

  const handleReset = () => {
    setCfg(initialCfg.current);
    setSelected(null);
    setMoves(0);
    setElapsed(0);
    setWon(false);
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const boardW = cfg.gridWidth * (CELL + GAP) - GAP;
  const boardH = cfg.gridHeight * (CELL + GAP) - GAP;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const borderColor =
    theme === "terminal" ? "#00ff41" : theme === "8bit" ? "#000000" : "#1a1a2e";
  const segs = borderSegments(cfg, borderColor);
  const arrowSt = gateArrowStyle(cfg);
  const arrowChar = ARROW_CHAR[cfg.gate.side];

  return (
    <div className={styles.container} data-theme={theme}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <h1 className={styles.title}>
          Slide Puzzle
          <span className={styles.difficultyBadge} data-difficulty={difficulty}>
            {difficulty.toUpperCase()}
          </span>
        </h1>
        {date && <p className={styles.dateLabel}>Daily Puzzle · {date}</p>}

        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Time</span>
            <span className={styles.statValue}>
              {mm}:{ss}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Moves</span>
            <span className={styles.statValue}>{moves}</span>
          </div>
        </div>

        <div className={styles.btnRow}>
          <button type="button" className={styles.resetBtn} onClick={handleReset}>
            Reset Puzzle
          </button>
          <button type="button" className={styles.newBtn} onClick={handleNew}>
            New Puzzle
          </button>
        </div>
      </div>

      {/* ── Status messages ── */}
      {won ? (
        <div className={styles.winBanner}>🎉 Puzzle Solved! {moves} moves</div>
      ) : selected ? (
        <p className={styles.hint}>Arrow keys or drag to move · click again to deselect</p>
      ) : (
        <p className={styles.hint}>Click a piece to select it</p>
      )}

      {/* ── Board ── */}
      <div className={styles.boardOuter}>
        <div
          className={styles.board}
          style={{ width: boardW, height: boardH }}
          // Deselect when clicking empty board area
          onClick={() => setSelected(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSelected(null);
          }}
          role="application"
          aria-label="Slide puzzle board"
          tabIndex={-1}
        >
          {/* Manual border segments with gate gap */}
          {segs.map((s) => (
            <div key={s.key} style={s.style} />
          ))}

          {/* Gate exit arrow */}
          <div className={styles.gateArrow} style={arrowSt}>
            {arrowChar}
          </div>

          {/* Background grid cells — skip cells inside an L-piece's missing corner */}
          {(() => {
            const shadowCells = new Set<string>();
            for (const p of cfg.pieces) {
              if (!p.cellOffsets) continue;
              const pieceKeys = new Set(
                p.cellOffsets.map(([dc, dr]) => ck(p.row + dr, p.col + dc)),
              );
              for (let dr = 0; dr < p.height; dr++)
                for (let dc = 0; dc < p.width; dc++) {
                  const k = ck(p.row + dr, p.col + dc);
                  if (!pieceKeys.has(k)) shadowCells.add(k);
                }
            }
            return [...cfg.validCells].map((k) => {
              if (shadowCells.has(k)) return null;
              const [r, c] = k.split(",").map(Number);
              const pos = cellToXY(c, r);
              return (
                <div key={k} className={styles.cell} style={{ ...pos, width: CELL, height: CELL }} />
              );
            });
          })()}

          {/* Pieces */}
          {cfg.pieces.map((p) => {
            const colorClass = styles[`piece${p.color.charAt(0).toUpperCase()}${p.color.slice(1)}`];
            const isSelected = p.id === selected;
            const cls = [
              styles.piece,
              colorClass,
              isSelected ? styles.pieceSelected : "",
              p.immovable ? styles.pieceImmovable : "",
              p.cellOffsets ? styles.pieceL : "",
            ]
              .filter(Boolean)
              .join(" ");

            const divStyle: React.CSSProperties = p.cellOffsets && isSelected
              ? { ...pieceCSS(p), filter: "drop-shadow(0 0 4px rgba(37,99,235,0.55))" }
              : pieceCSS(p);

            return (
              <div
                key={p.id}
                className={cls}
                style={divStyle}
                role={p.immovable ? undefined : "button"}
                tabIndex={p.immovable ? undefined : 0}
                aria-label={`${p.color} piece`}
                aria-pressed={p.id === selected}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onKeyDown={(e) => {
                  if (p.immovable || won) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected((prev) => (prev === p.id ? null : p.id));
                  }
                }}
                onMouseDown={(e) => {
                  if (p.immovable || won) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected((prev) => (prev === p.id ? null : p.id));
                  drag.current = { id: p.id, sx: e.clientX, sy: e.clientY };
                }}
              >
                {p.cellOffsets && (
                  <svg
                    width={p.width * CELL + (p.width - 1) * GAP}
                    height={p.height * CELL + (p.height - 1) * GAP}
                    viewBox={`0 0 ${p.width * CELL + (p.width - 1) * GAP} ${p.height * CELL + (p.height - 1) * GAP}`}
                    style={{ position: "absolute", top: 0, left: 0, overflow: "hidden", pointerEvents: "none" }}
                    aria-hidden="true"
                  >
                    <g transform="translate(1.5, 1.5)">
                      <path
                        d={lShapePathD(p.cellOffsets)}
                        fill={PIECE_SVG_COLORS[p.color].fill}
                        stroke={isSelected ? "#2563eb" : PIECE_SVG_COLORS[p.color].stroke}
                        strokeWidth={isSelected ? 3 : 2.5}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    </g>
                  </svg>
                )}
                {p.color === "person" && (
                  <svg
                    viewBox="0 0 32 32"
                    className={styles.personSvg}
                    role="img"
                    aria-label="Person"
                  >
                    <title>Person</title>
                    <circle cx="16" cy="9" r="6" fill="currentColor" />
                    <path d="M6 28 C6 20 26 20 26 28" fill="currentColor" />
                    <rect x="13" y="14" width="6" height="8" rx="1" fill="currentColor" opacity="0.7" />
                    <line x1="13" y1="16" x2="13" y2="22" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                    <line x1="19" y1="16" x2="19" y2="22" stroke="currentColor" strokeWidth="1.5" opacity="0.5" />
                    <line x1="16" y1="17" x2="16" y2="19" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: "#e8e8f0" }} />
          Person
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: "#f4a261" }} />
          Movable box
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: "#2d2d2d" }} />
          Immovable
        </span>
        <span className={styles.legendItem}>
          <span
            className={styles.legendSwatch}
            style={{ background: "#4ade80", border: "2px solid #16a34a" }}
          />
          Gate (exit)
        </span>
      </p>
    </div>
  );
}
