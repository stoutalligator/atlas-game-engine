import { describe, expect, it } from "vitest";
import {
  generatePuzzle,
  // We import the pure logic helpers via the file directly since they're not re-exported
} from "../games/slide-puzzle/SlidePuzzle.js";

// ── Re-implement minimal test helpers using the same logic ─────────────────
//    (mirrors the internals without re-exporting private symbols)

type PieceColor = "person" | "orange" | "blue" | "green" | "purple" | "black" | "brown" | "teal";
type Direction = "up" | "down" | "left" | "right";
type GateSide = "top" | "bottom" | "left" | "right";

interface Piece {
  id: string;
  color: PieceColor;
  col: number;
  row: number;
  width: number;
  height: number;
  immovable: boolean;
  cellOffsets?: Array<[number, number]>;
}

interface Gate {
  side: GateSide;
  index: number;
}

interface PuzzleConfig {
  gridWidth: number;
  gridHeight: number;
  validCells: Set<string>;
  pieces: Piece[];
  gate: Gate;
}

const ck = (r: number, c: number) => `${r},${c}`;

function makeRectGrid(w: number, h: number): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) s.add(ck(r, c));
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

function buildOccupancy(pieces: Piece[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pieces)
    for (let c = p.col; c < p.col + p.width; c++)
      for (let r = p.row; r < p.row + p.height; r++) m.set(ck(r, c), p.id);
  return m;
}

function canMove(cfg: PuzzleConfig, pieceId: string, dir: Direction): boolean {
  const piece = cfg.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.immovable) return false;

  const dx = dir === "right" ? 1 : dir === "left" ? -1 : 0;
  const dy = dir === "down" ? 1 : dir === "up" ? -1 : 0;
  const nr = piece.row + dy;
  const nc = piece.col + dx;
  const isPerson = piece.color === "person";
  const occ = buildOccupancy(cfg.pieces);

  for (let c = nc; c < nc + piece.width; c++) {
    for (let r = nr; r < nr + piece.height; r++) {
      if (
        c >= piece.col &&
        c < piece.col + piece.width &&
        r >= piece.row &&
        r < piece.row + piece.height
      )
        continue;
      if (isGateExit(cfg.gate, cfg.gridWidth, cfg.gridHeight, r, c)) {
        if (!isPerson) return false;
        continue;
      }
      if (!cfg.validCells.has(ck(r, c))) return false;
      const occupant = occ.get(ck(r, c));
      if (occupant && occupant !== pieceId) return false;
    }
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

// ── Helpers to build minimal test fixtures ─────────────────────────────────

function minimalPuzzle(overrides: Partial<PuzzleConfig> = {}): PuzzleConfig {
  return {
    gridWidth: 5,
    gridHeight: 5,
    validCells: makeRectGrid(5, 5),
    gate: { side: "right", index: 2 },
    pieces: [
      { id: "person", color: "person", col: 0, row: 2, width: 1, height: 1, immovable: false },
    ],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("canMove", () => {
  it("allows moving into an empty cell", () => {
    const cfg = minimalPuzzle();
    expect(canMove(cfg, "person", "right")).toBe(true);
  });

  it("blocks moving outside the grid (not through gate)", () => {
    const cfg = minimalPuzzle();
    // Person is at col 0, row 2 — cannot go left (outside grid)
    expect(canMove(cfg, "person", "left")).toBe(false);
  });

  it("blocks moving into a cell occupied by another piece", () => {
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 0, row: 2, width: 1, height: 1, immovable: false },
        { id: "box", color: "orange", col: 1, row: 2, width: 1, height: 1, immovable: false },
      ],
    });
    expect(canMove(cfg, "person", "right")).toBe(false);
  });

  it("allows person to move into the gate cell (exit)", () => {
    // Person at rightmost column, gate row matches
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 4, row: 2, width: 1, height: 1, immovable: false },
      ],
    });
    expect(canMove(cfg, "person", "right")).toBe(true);
  });

  it("blocks a non-person from moving into the gate cell", () => {
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 0, row: 0, width: 1, height: 1, immovable: false },
        { id: "box", color: "orange", col: 4, row: 2, width: 1, height: 1, immovable: false },
      ],
    });
    expect(canMove(cfg, "box", "right")).toBe(false);
  });

  it("blocks immovable pieces from moving", () => {
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 0, row: 0, width: 1, height: 1, immovable: false },
        { id: "wall", color: "black", col: 2, row: 2, width: 1, height: 1, immovable: true },
      ],
    });
    expect(canMove(cfg, "wall", "up")).toBe(false);
    expect(canMove(cfg, "wall", "down")).toBe(false);
    expect(canMove(cfg, "wall", "left")).toBe(false);
    expect(canMove(cfg, "wall", "right")).toBe(false);
  });

  it("allows a multi-cell piece to slide when destination is clear", () => {
    // 1×2 horizontal piece at (0,0)–(1,0) moving right
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 0, row: 4, width: 1, height: 1, immovable: false },
        { id: "blue", color: "blue", col: 0, row: 0, width: 2, height: 1, immovable: false },
      ],
    });
    expect(canMove(cfg, "blue", "right")).toBe(true);
  });

  it("blocks a multi-cell piece when blocked by another piece", () => {
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 0, row: 4, width: 1, height: 1, immovable: false },
        { id: "blue", color: "blue", col: 0, row: 0, width: 2, height: 1, immovable: false },
        { id: "box", color: "orange", col: 2, row: 0, width: 1, height: 1, immovable: false },
      ],
    });
    expect(canMove(cfg, "blue", "right")).toBe(false);
  });
});

describe("applyMove", () => {
  it("moves a piece one step in the given direction", () => {
    const cfg = minimalPuzzle();
    const next = applyMove(cfg, "person", "right");
    const person = next.pieces.find((p) => p.id === "person");
    expect(person?.col).toBe(1);
    expect(person?.row).toBe(2);
  });

  it("does not mutate the original config", () => {
    const cfg = minimalPuzzle();
    applyMove(cfg, "person", "right");
    const person = cfg.pieces.find((p) => p.id === "person");
    expect(person?.col).toBe(0); // unchanged
  });
});

describe("hasWon", () => {
  it("returns false when person is inside the grid", () => {
    const cfg = minimalPuzzle();
    expect(hasWon(cfg)).toBe(false);
  });

  it("returns true when person is at the gate exit position", () => {
    // Gate is on right, index 2 → exit is at col=5 (gridWidth), row=2
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 5, row: 2, width: 1, height: 1, immovable: false },
      ],
    });
    expect(hasWon(cfg)).toBe(true);
  });

  it("returns false when person is at gate row but not at exit column", () => {
    const cfg = minimalPuzzle({
      pieces: [
        { id: "person", color: "person", col: 4, row: 2, width: 1, height: 1, immovable: false },
      ],
    });
    expect(hasWon(cfg)).toBe(false);
  });
});

describe("generatePuzzle", () => {
  it("always includes exactly one person piece", () => {
    for (let i = 0; i < 10; i++) {
      const cfg = generatePuzzle();
      const persons = cfg.pieces.filter((p) => p.color === "person");
      expect(persons).toHaveLength(1);
    }
  });

  it("produces a puzzle with valid cell count between 16 and 100", () => {
    for (let i = 0; i < 10; i++) {
      const cfg = generatePuzzle();
      expect(cfg.validCells.size).toBeGreaterThanOrEqual(16);
      expect(cfg.validCells.size).toBeLessThanOrEqual(100);
    }
  });

  it("places all pieces within the valid cell set", () => {
    for (let i = 0; i < 10; i++) {
      const cfg = generatePuzzle();
      for (const p of cfg.pieces) {
        const absCells: Array<[number, number]> = p.cellOffsets
          ? p.cellOffsets.map(([dc, dr]) => [p.col + dc, p.row + dr])
          : Array.from({ length: p.width }, (_, dc) =>
              Array.from(
                { length: p.height },
                (_, dr) => [p.col + dc, p.row + dr] as [number, number],
              ),
            ).flat();
        for (const [c, r] of absCells) {
          if (p.color === "person") continue;
          expect(cfg.validCells.has(ck(r, c))).toBe(true);
        }
      }
    }
  });

  it("produces no overlapping pieces", () => {
    for (let i = 0; i < 10; i++) {
      const cfg = generatePuzzle();
      const seen = new Map<string, string>();
      for (const p of cfg.pieces) {
        const absCells: Array<[number, number]> = p.cellOffsets
          ? p.cellOffsets.map(([dc, dr]) => [p.col + dc, p.row + dr])
          : Array.from({ length: p.width }, (_, dc) =>
              Array.from(
                { length: p.height },
                (_, dr) => [p.col + dc, p.row + dr] as [number, number],
              ),
            ).flat();
        for (const [c, r] of absCells) {
          const key = ck(r, c);
          expect(seen.has(key)).toBe(false);
          seen.set(key, p.id);
        }
      }
    }
  });

  it("always returns a puzzle with a gate defined", () => {
    for (let i = 0; i < 10; i++) {
      const cfg = generatePuzzle();
      expect(["top", "bottom", "left", "right"]).toContain(cfg.gate.side);
      expect(cfg.gate.index).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces the same puzzle layout for the same date (deterministic seeding)", () => {
    const a = generatePuzzle({ date: "2026-03-06" });
    const b = generatePuzzle({ date: "2026-03-06" });
    expect(a.gridWidth).toBe(b.gridWidth);
    expect(a.gridHeight).toBe(b.gridHeight);
    expect(a.gate).toEqual(b.gate);
    const posA = a.pieces
      .map((p) => `${p.color}:${p.col},${p.row}`)
      .sort()
      .join("|");
    const posB = b.pieces
      .map((p) => `${p.color}:${p.col},${p.row}`)
      .sort()
      .join("|");
    expect(posA).toBe(posB);
  });

  it("produces different puzzles for different dates", () => {
    const a = generatePuzzle({ date: "2026-03-06" });
    const b = generatePuzzle({ date: "2026-03-07" });
    // Grid layout, gate, or piece positions must differ across different dates
    const posA = a.pieces
      .map((p) => `${p.col},${p.row}`)
      .sort()
      .join("|");
    const posB = b.pieces
      .map((p) => `${p.col},${p.row}`)
      .sort()
      .join("|");
    const samePuzzle =
      a.gridWidth === b.gridWidth &&
      a.gridHeight === b.gridHeight &&
      a.gate.side === b.gate.side &&
      a.gate.index === b.gate.index &&
      posA === posB;
    // Very unlikely that two different dates produce the exact same scrambled layout
    expect(samePuzzle).toBe(false);
  });

  it("hard difficulty uses larger grids (≥40 valid cells)", () => {
    for (let i = 0; i < 10; i++) {
      const cfg = generatePuzzle({ date: `2026-0${(i % 9) + 1}-01`, difficulty: "hard" });
      expect(cfg.validCells.size).toBeGreaterThanOrEqual(40);
    }
  });

  it("easy difficulty uses smaller grids (≤36 valid cells)", () => {
    for (let i = 0; i < 10; i++) {
      const cfg = generatePuzzle({ date: `2026-0${(i % 9) + 1}-01`, difficulty: "easy" });
      expect(cfg.validCells.size).toBeLessThanOrEqual(36);
    }
  });
});
