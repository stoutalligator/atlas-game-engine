import { describe, expect, it } from "vitest";
import { cubeRushForDate } from "../games/cube-rush/CubeRush.js";
import { CUBE_RUSH_LIBRARY } from "../games/cube-rush/library.js";
import {
  ANALYST_ID,
  type CubeRushPuzzle,
  applyMove,
  canMove,
  decodePuzzle,
  encodePuzzle,
  isSolved,
  positionsOf,
  solveCubeRush,
  withPositions,
} from "../games/cube-rush/logic.js";

const occupiedCells = (pz: CubeRushPuzzle) =>
  pz.pieces.flatMap((p) => p.cells.map(([dc, dr]) => `${p.row + dr},${p.col + dc}`));

describe("cube rush library", () => {
  it("has puzzles for every difficulty", () => {
    for (const list of Object.values(CUBE_RUSH_LIBRARY))
      expect(list.length).toBeGreaterThanOrEqual(40);
  });

  it("every puzzle decodes to a legal, unsolved floor with one analyst", () => {
    for (const code of Object.values(CUBE_RUSH_LIBRARY).flat()) {
      const { puzzle } = decodePuzzle(code);
      const cells = occupiedCells(puzzle);
      expect(new Set(cells).size).toBe(cells.length);
      expect(cells.every((k) => puzzle.valid.has(k))).toBe(true);
      expect(puzzle.pieces.filter((p) => p.id === ANALYST_ID)).toHaveLength(1);
      expect(isSolved(puzzle)).toBe(false);
      expect(encodePuzzle(puzzle, decodePuzzle(code).par)).toBe(code);
    }
  });

  it("stored par matches the solver (easy + medium)", () => {
    for (const code of [...CUBE_RUSH_LIBRARY.easy, ...CUBE_RUSH_LIBRARY.medium].slice(0, 60)) {
      const { puzzle, par } = decodePuzzle(code);
      expect(solveCubeRush(puzzle)).toBe(par);
    }
  });
});

describe("cube rush rules", () => {
  it("picks a deterministic puzzle whose difficulty follows the weekday", () => {
    expect(cubeRushForDate("2026-10-12").difficulty).toBe("easy"); // Monday
    expect(cubeRushForDate("2026-10-14").difficulty).toBe("medium"); // Wednesday
    expect(cubeRushForDate("2026-10-17").difficulty).toBe("hard"); // Saturday
    expect(encodePuzzle(cubeRushForDate("2026-10-14").puzzle, 0)).toBe(
      encodePuzzle(cubeRushForDate("2026-10-14").puzzle, 0),
    );
  });

  it("only the analyst may leave through the exit", () => {
    const { puzzle } = decodePuzzle(CUBE_RUSH_LIBRARY.easy[0]);
    for (const p of puzzle.pieces) {
      for (const d of ["up", "down", "left", "right"] as const) {
        if (!canMove(puzzle, p.id, d)) continue;
        const moved = applyMove(puzzle, p.id, d);
        const a = moved.pieces.find((x) => x.id === p.id);
        if (p.id !== ANALYST_ID) {
          expect(a?.cells.every(([dc, dr]) => moved.valid.has(`${a.row + dr},${a.col + dc}`))).toBe(
            true,
          );
        }
      }
    }
  });

  it("round-trips saved positions", () => {
    const { puzzle } = decodePuzzle(CUBE_RUSH_LIBRARY.medium[0]);
    expect(withPositions(puzzle, positionsOf(puzzle))).toEqual(puzzle);
  });
});
