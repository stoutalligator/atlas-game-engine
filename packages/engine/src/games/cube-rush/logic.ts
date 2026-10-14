import { type Rng, seededRng } from "../../core/rng.js";

// Cube Rush: slide the office cubicles so the analyst can reach the exit.
// Puzzles are built backwards from a solved position with reversible moves,
// so every generated puzzle is solvable.

export type Direction = "up" | "down" | "left" | "right";
export type GateSide = "top" | "bottom" | "left" | "right";
export type PieceTone = "analyst" | "indigo" | "cyan" | "amber" | "emerald" | "rose" | "violet";
export type Difficulty = "easy" | "medium" | "hard";

export interface Piece {
  id: string;
  tone: PieceTone;
  col: number;
  row: number;
  /** Occupied cells as [dc, dr] offsets from (col, row). */
  cells: Array<[number, number]>;
}

export interface Gate {
  side: GateSide;
  /** Column for top/bottom gates, row for left/right gates. */
  index: number;
}

export interface CubeRushPuzzle {
  cols: number;
  rows: number;
  /** "r,c" keys of playable cells. */
  valid: Set<string>;
  gate: Gate;
  pieces: Piece[];
  /** Top-right cut-out for L-shaped floors. */
  cut?: { w: number; h: number };
}

export const ANALYST_ID = "analyst";

const DELTA: Record<Direction, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};
const DIRS: Direction[] = ["up", "down", "left", "right"];
const key = (r: number, c: number) => `${r},${c}`;

const rect = (w: number, h: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  for (let dr = 0; dr < h; dr++) for (let dc = 0; dc < w; dc++) out.push([dc, dr]);
  return out;
};

export function pieceSize(p: Pick<Piece, "cells">): { w: number; h: number } {
  return {
    w: Math.max(...p.cells.map(([dc]) => dc)) + 1,
    h: Math.max(...p.cells.map(([, dr]) => dr)) + 1,
  };
}

function isExit(pz: Pick<CubeRushPuzzle, "gate" | "cols" | "rows">, r: number, c: number) {
  const { gate } = pz;
  switch (gate.side) {
    case "top":
      return r === -1 && c === gate.index;
    case "bottom":
      return r === pz.rows && c === gate.index;
    case "left":
      return c === -1 && r === gate.index;
    case "right":
      return c === pz.cols && r === gate.index;
  }
}

function occupancy(pieces: Piece[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pieces) for (const [dc, dr] of p.cells) m.set(key(p.row + dr, p.col + dc), p.id);
  return m;
}

export function canMove(
  pz: CubeRushPuzzle,
  id: string,
  dir: Direction,
  occ = occupancy(pz.pieces),
) {
  const piece = pz.pieces.find((p) => p.id === id);
  if (!piece) return false;
  const [dx, dy] = DELTA[dir];
  for (const [dc, dr] of piece.cells) {
    const r = piece.row + dr + dy;
    const c = piece.col + dc + dx;
    const holder = occ.get(key(r, c));
    if (holder === id) continue;
    if (isExit(pz, r, c)) {
      if (id !== ANALYST_ID) return false;
      continue;
    }
    if (!pz.valid.has(key(r, c)) || holder) return false;
  }
  return true;
}

export function applyMove(pz: CubeRushPuzzle, id: string, dir: Direction): CubeRushPuzzle {
  const [dx, dy] = DELTA[dir];
  return {
    ...pz,
    pieces: pz.pieces.map((p) => (p.id === id ? { ...p, col: p.col + dx, row: p.row + dy } : p)),
  };
}

export function isSolved(pz: CubeRushPuzzle): boolean {
  const a = pz.pieces.find((p) => p.id === ANALYST_ID);
  return !!a && isExit(pz, a.row, a.col);
}

/** Positions only — what we persist between visits. */
export type Positions = Record<string, [number, number]>;

export function positionsOf(pz: CubeRushPuzzle): Positions {
  return Object.fromEntries(pz.pieces.map((p) => [p.id, [p.col, p.row]]));
}

export function withPositions(pz: CubeRushPuzzle, pos: Positions): CubeRushPuzzle {
  return {
    ...pz,
    pieces: pz.pieces.map((p) => (pos[p.id] ? { ...p, col: pos[p.id][0], row: pos[p.id][1] } : p)),
  };
}

export const OPPOSITE: Record<Direction, Direction> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

// ── Compact encoding for the verified puzzle library ───────────────────────
//
// "<cols><rows>[c<cutW><cutH>]|<gate side t/b/l/r><gate index>|<par>|<pieces>"
// Each piece is three chars: shape code, col, row. The analyst is shape "A".

const SHAPE_CODES: Record<string, Array<[number, number]>> = {
  A: rect(1, 1),
  a: rect(2, 1),
  b: rect(1, 2),
  c: rect(3, 1),
  d: rect(1, 3),
  e: rect(2, 2),
  f: rect(3, 3),
};

function shapeCode(cells: Array<[number, number]>): string {
  const sig = (cs: Array<[number, number]>) =>
    cs
      .map(([x, y]) => `${x}.${y}`)
      .sort()
      .join(" ");
  for (const [code, shape] of Object.entries(SHAPE_CODES))
    if (sig(shape) === sig(cells)) return code;
  const l = L_SHAPES.findIndex((s) => sig(s) === sig(cells));
  if (l >= 0) return "ghij"[l];
  throw new Error(`Unknown piece shape ${sig(cells)}`);
}

function shapeFromCode(code: string): Array<[number, number]> {
  const l = "ghij".indexOf(code);
  if (l >= 0) return L_SHAPES[l];
  const shape = SHAPE_CODES[code];
  if (!shape) throw new Error(`Unknown shape code ${code}`);
  return shape;
}

const SIDE_CODE: Record<GateSide, string> = { top: "t", bottom: "b", left: "l", right: "r" };

export interface LibraryPuzzle {
  puzzle: CubeRushPuzzle;
  par: number;
}

export function encodePuzzle(pz: CubeRushPuzzle, par: number): string {
  const { cut } = pz;
  const head = `${pz.cols}${pz.rows}${cut ? `c${cut.w}${cut.h}` : ""}`;
  const pieces = pz.pieces.map((p) => `${shapeCode(p.cells)}${p.col}${p.row}`).join("");
  return `${head}|${SIDE_CODE[pz.gate.side]}${pz.gate.index}|${par}|${pieces}`;
}

export function decodePuzzle(code: string): LibraryPuzzle {
  const [head, gateCode, parCode, body] = code.split("|");
  const cols = Number(head[0]);
  const rows = Number(head[1]);
  const cut = head[2] === "c" ? { w: Number(head[3]), h: Number(head[4]) } : undefined;
  const side = (Object.keys(SIDE_CODE) as GateSide[]).find((s) => SIDE_CODE[s] === gateCode[0]);
  if (!side) throw new Error(`Bad gate ${gateCode}`);
  const pieces: Piece[] = [];
  let n = 0;
  for (let i = 0; i < body.length; i += 3) {
    const code3 = body[i];
    const cells = shapeFromCode(code3);
    const col = Number(body[i + 1]);
    const row = Number(body[i + 2]);
    if (code3 === "A") pieces.push({ id: ANALYST_ID, tone: "analyst", col, row, cells });
    else {
      pieces.push({ id: `p${n}`, tone: TONES[n % TONES.length], col, row, cells });
      n++;
    }
  }
  return {
    puzzle: {
      cols,
      rows,
      valid: floorCells({ cols, rows, cut, gate: { side, index: 0 }, shapes: [] }),
      gate: { side, index: Number(gateCode.slice(1)) },
      pieces,
      cut,
    },
    par: Number(parCode),
  };
}

// ── Generator (used offline by scripts/build-cube-rush-library.ts) ─────────

interface Template {
  cols: number;
  rows: number;
  /** Optional top-right cut-out for L-shaped floors. */
  cut?: { w: number; h: number };
  gate: Gate;
  shapes: Array<Array<[number, number]>>;
}

const L_SHAPES: Array<Array<[number, number]>> = [
  [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [1, 0],
    [0, 1],
    [1, 1],
  ],
];

const TEMPLATES: Record<Difficulty, Template[]> = {
  easy: [
    {
      cols: 5,
      rows: 5,
      gate: { side: "right", index: 2 },
      shapes: [rect(3, 1), rect(1, 3), rect(2, 1), rect(1, 2), rect(1, 3), rect(3, 1), rect(2, 2)],
    },
    {
      cols: 6,
      rows: 5,
      gate: { side: "bottom", index: 2 },
      shapes: [rect(3, 1), rect(1, 3), rect(2, 1), rect(1, 2), rect(2, 2), rect(3, 1), L_SHAPES[0]],
    },
  ],
  medium: [
    {
      cols: 6,
      rows: 6,
      gate: { side: "right", index: 2 },
      shapes: [
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(3, 1),
        rect(1, 3),
        rect(1, 3),
        rect(2, 1),
        rect(1, 2),
        rect(2, 2),
      ],
    },
    {
      cols: 6,
      rows: 6,
      gate: { side: "left", index: 3 },
      shapes: [
        rect(3, 1),
        rect(1, 3),
        rect(1, 2),
        rect(3, 1),
        rect(1, 3),
        rect(3, 1),
        rect(1, 2),
        rect(2, 1),
        rect(2, 2),
        L_SHAPES[1],
      ],
    },
  ],
  hard: [
    {
      cols: 7,
      rows: 7,
      gate: { side: "right", index: 3 },
      shapes: [
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(1, 2),
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(3, 1),
        rect(1, 3),
        rect(1, 3),
        rect(2, 1),
        rect(2, 2),
        rect(3, 3),
        L_SHAPES[0],
      ],
    },
    {
      cols: 7,
      rows: 7,
      gate: { side: "top", index: 3 },
      shapes: [
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(1, 2),
        rect(3, 1),
        rect(1, 3),
        rect(1, 2),
        rect(3, 1),
        rect(1, 3),
        rect(1, 3),
        rect(2, 1),
        rect(2, 2),
        rect(3, 3),
        L_SHAPES[2],
      ],
    },
    {
      cols: 8,
      rows: 6,
      gate: { side: "right", index: 2 },
      shapes: [
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(3, 1),
        rect(1, 3),
        rect(3, 1),
        rect(1, 2),
        rect(2, 2),
        rect(3, 3),
        L_SHAPES[3],
      ],
    },
    {
      cols: 7,
      rows: 7,
      cut: { w: 3, h: 3 },
      gate: { side: "right", index: 5 },
      shapes: [
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(1, 2),
        rect(3, 1),
        rect(1, 3),
        rect(2, 1),
        rect(1, 2),
        rect(2, 2),
        rect(3, 3),
        L_SHAPES[0],
      ],
    },
  ],
};

const TONES: PieceTone[] = ["indigo", "cyan", "amber", "emerald", "rose", "violet"];

function floorCells(t: Template): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < t.rows; r++)
    for (let c = 0; c < t.cols; c++)
      if (!(t.cut && r < t.cut.h && c >= t.cols - t.cut.w)) s.add(key(r, c));
  return s;
}

function tryPlace(
  valid: Set<string>,
  taken: Set<string>,
  cells: Array<[number, number]>,
  rng: Rng,
): { col: number; row: number } | null {
  const spots: Array<{ col: number; row: number }> = [];
  for (const k of valid) {
    const [r, c] = k.split(",").map(Number);
    if (
      cells.every(([dc, dr]) => valid.has(key(r + dr, c + dc)) && !taken.has(key(r + dr, c + dc)))
    )
      spots.push({ col: c, row: r });
  }
  return spots.length ? spots[Math.floor(rng() * spots.length)] : null;
}

/** Monday–Tuesday easy, Wednesday–Friday medium, weekend hard. */
export function difficultyForWeekday(day: number): Difficulty {
  if (day === 1 || day === 2) return "easy";
  if (day === 0 || day === 6) return "hard";
  return "medium";
}

const SCRAMBLE: Record<Difficulty, [number, number]> = {
  easy: [20, 35],
  medium: [45, 75],
  hard: [90, 130],
};

export function generateCubeRush(seed: string, difficulty: Difficulty): CubeRushPuzzle {
  const rng = seededRng(`cube-rush:${seed}:${difficulty}`);
  const templates = TEMPLATES[difficulty];
  const t = templates[Math.floor(rng() * templates.length)];
  const valid = floorCells(t);
  const { gate } = t;

  // Solved start: analyst one step from the exit.
  const start =
    gate.side === "right"
      ? { col: t.cols - 1, row: gate.index }
      : gate.side === "left"
        ? { col: 0, row: gate.index }
        : gate.side === "top"
          ? { col: gate.index, row: 0 }
          : { col: gate.index, row: t.rows - 1 };

  const pieces: Piece[] = [{ id: ANALYST_ID, tone: "analyst", ...start, cells: [[0, 0]] }];
  const taken = new Set([key(start.row, start.col)]);
  let n = 0;
  const addPiece = (cells: Array<[number, number]>) => {
    const pos = tryPlace(valid, taken, cells, rng);
    if (!pos) return false;
    const tone = TONES[n % TONES.length];
    pieces.push({ id: `p${n++}`, tone, ...pos, cells });
    for (const [dc, dr] of cells) taken.add(key(pos.row + dr, pos.col + dc));
    return true;
  };
  // Keep the floor fairly open while the analyst walks away from the exit;
  // the remaining cubicles go in afterwards.
  const deferred: Array<Array<[number, number]>> = [];
  for (const shape of t.shapes) {
    if (taken.size + shape.length <= valid.size * 0.55) addPiece(shape);
    else deferred.push(shape);
  }

  let pz: CubeRushPuzzle = { cols: t.cols, rows: t.rows, valid, gate, pieces, cut: t.cut };

  const away: Direction =
    gate.side === "right"
      ? "left"
      : gate.side === "left"
        ? "right"
        : gate.side === "top"
          ? "down"
          : "up";
  const farWall = (p: CubeRushPuzzle) => {
    const a = p.pieces[0];
    if (gate.side === "right") return a.col === 0;
    if (gate.side === "left") return a.col === t.cols - 1;
    if (gate.side === "top") return a.row === t.rows - 1;
    return a.row === 0;
  };

  // Phase 1: walk the analyst to the far wall, nudging blockers aside.
  for (let i = 0; i < 3000 && !farWall(pz); i++) {
    if (canMove(pz, ANALYST_ID, away)) {
      pz = applyMove(pz, ANALYST_ID, away);
      continue;
    }
    for (let tries = 0; tries < 30; tries++) {
      const p = pz.pieces[1 + Math.floor(rng() * (pz.pieces.length - 1))];
      const d = DIRS[Math.floor(rng() * 4)];
      if (canMove(pz, p.id, d)) {
        pz = applyMove(pz, p.id, d);
        break;
      }
    }
  }

  // Pack the floor with filler cubicles, leaving ~20% open space.
  const occ = new Set(occupancy(pz.pieces).keys());
  const minFree = Math.max(5, Math.floor(valid.size * 0.2));
  const fillers = [rect(3, 1), rect(1, 3), rect(2, 1), rect(1, 2)];
  for (const shape of deferred) {
    if (valid.size - occ.size < minFree + shape.length) break;
    const pos = tryPlace(valid, occ, shape, rng);
    if (!pos) continue;
    pz.pieces.push({ id: `p${n}`, tone: TONES[n % TONES.length], ...pos, cells: shape });
    n++;
    for (const [dc, dr] of shape) occ.add(key(pos.row + dr, pos.col + dc));
  }
  for (const shape of fillers) {
    for (;;) {
      if (valid.size - occ.size < minFree + shape.length) break;
      const pos = tryPlace(valid, occ, shape, rng);
      if (!pos) break;
      pz.pieces.push({ id: `p${n}`, tone: TONES[n % TONES.length], ...pos, cells: shape });
      n++;
      for (const [dc, dr] of shape) occ.add(key(pos.row + dr, pos.col + dc));
    }
  }

  // Phase 2: scramble the cubicles (never the analyst). Every move is
  // reversible, so undoing both phases always leads back to the exit.
  const [lo, hi] = SCRAMBLE[difficulty];
  const moves = lo + Math.floor(rng() * (hi - lo + 1));
  let last: string | null = null;
  for (let i = 0; i < moves; i++) {
    for (let tries = 0; tries < 50; tries++) {
      const p = pz.pieces[1 + Math.floor(rng() * (pz.pieces.length - 1))];
      const d = DIRS[Math.floor(rng() * 4)];
      if (p.id === last || !canMove(pz, p.id, d)) continue;
      pz = applyMove(pz, p.id, d);
      last = p.id;
      break;
    }
  }

  // Avoid a free straight run to the exit.
  for (let i = 0; i < 300 && hasClearRun(pz); i++) {
    const p = pz.pieces[1 + Math.floor(rng() * (pz.pieces.length - 1))];
    const d = DIRS[Math.floor(rng() * 4)];
    if (canMove(pz, p.id, d)) pz = applyMove(pz, p.id, d);
  }

  return pz;
}

function hasClearRun(pz: CubeRushPuzzle): boolean {
  const a = pz.pieces.find((p) => p.id === ANALYST_ID);
  if (!a) return false;
  const toward =
    OPPOSITE[
      pz.gate.side === "right"
        ? "left"
        : pz.gate.side === "left"
          ? "right"
          : pz.gate.side === "top"
            ? "down"
            : "up"
    ];
  const [dx, dy] = DELTA[toward];
  const occ = occupancy(pz.pieces);
  let r = a.row + dy;
  let c = a.col + dx;
  for (;;) {
    if (isExit(pz, r, c)) return true;
    if (!pz.valid.has(key(r, c)) || occ.has(key(r, c))) return false;
    r += dy;
    c += dx;
  }
}

/**
 * Fewest moves to free the analyst, where one move = one piece sliding any
 * distance (the Rush Hour / Klotski count). Breadth-first search over packed
 * states; returns null if the state budget runs out or there's no solution.
 */
export function solveCubeRush(pz: CubeRushPuzzle, budget = 500_000): number | null {
  const W = pz.cols;
  const H = pz.rows;
  const n = pz.pieces.length;
  const ai = pz.pieces.findIndex((p) => p.id === ANALYST_ID);
  const validMask = new Uint8Array(W * H);
  for (const k of pz.valid) {
    const [r, c] = k.split(",").map(Number);
    validMask[r * W + c] = 1;
  }
  const shapes = pz.pieces.map((p) => p.cells);
  const exitAt = (c: number, r: number) => isExit(pz, r, c);

  // State: [col0,row0,col1,row1,...] packed into a string key.
  const start = new Uint8Array(n * 2);
  pz.pieces.forEach((p, i) => {
    start[i * 2] = p.col;
    start[i * 2 + 1] = p.row;
  });
  const encode = (s: Uint8Array) => String.fromCharCode(...s);

  const seen = new Set<string>([encode(start)]);
  let frontier: Uint8Array[] = [start];
  const occ = new Int16Array(W * H);
  const DX = [0, 0, -1, 1];
  const DY = [-1, 1, 0, 0];

  for (let depth = 1; frontier.length; depth++) {
    const next: Uint8Array[] = [];
    for (const s of frontier) {
      occ.fill(-1);
      for (let i = 0; i < n; i++)
        for (const [dc, dr] of shapes[i]) occ[(s[i * 2 + 1] + dr) * W + s[i * 2] + dc] = i;

      for (let i = 0; i < n; i++) {
        // Flood-fill every spot piece i can slide to with the others fixed.
        const c0 = s[i * 2];
        const r0 = s[i * 2 + 1];
        const reached = new Set<number>([r0 * 64 + c0]);
        const queue: Array<[number, number]> = [[c0, r0]];
        while (queue.length) {
          const [c, r] = queue.pop() as [number, number];
          for (let d = 0; d < 4; d++) {
            const nc = c + DX[d];
            const nr = r + DY[d];
            let ok = true;
            let exits = false;
            for (const [dc, dr] of shapes[i]) {
              const x = nc + dc;
              const y = nr + dr;
              if (x < 0 || y < 0 || x >= W || y >= H) {
                if (i === ai && exitAt(x, y)) {
                  exits = true;
                  continue;
                }
                ok = false;
                break;
              }
              const o = occ[y * W + x];
              if (!validMask[y * W + x] || (o !== -1 && o !== i)) {
                ok = false;
                break;
              }
            }
            if (!ok) continue;
            if (exits) return depth;
            const id = nr * 64 + nc;
            if (reached.has(id)) continue;
            reached.add(id);
            queue.push([nc, nr]);
            const moved = s.slice();
            moved[i * 2] = nc;
            moved[i * 2 + 1] = nr;
            const k = encode(moved);
            if (seen.has(k)) continue;
            seen.add(k);
            if (seen.size > budget) return null;
            next.push(moved);
          }
        }
      }
    }
    frontier = next;
  }
  return null;
}
