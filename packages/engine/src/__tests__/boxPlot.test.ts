import { describe, expect, it } from "vitest";
import {
  type CellState,
  EMPTY,
  FILLED,
  boxPlotForDate,
  buildPuzzle,
  isSolved,
  lineSolve,
  runsOf,
} from "../games/box-plot/logic.js";
import { PICTURES } from "../games/box-plot/pictures.js";

describe("box plot", () => {
  it("computes runs", () => {
    expect(runsOf([true, true, false, true])).toEqual([2, 1]);
    expect(runsOf([false, false])).toEqual([]);
  });

  it("every picture is 10×10 and solvable by line logic alone", () => {
    const unsolvable: string[] = [];
    for (const pic of PICTURES) {
      expect(pic.rows).toHaveLength(10);
      const p = buildPuzzle(pic);
      if (!lineSolve(p.rowClues, p.colClues)) unsolvable.push(pic.name);
    }
    expect(unsolvable).toEqual([]);
  });

  it("picture names are unique", () => {
    const names = PICTURES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("accepts the solution and rejects an empty board", () => {
    const p = boxPlotForDate("2026-10-14");
    const solved = p.solution.map((row) => row.map((v): CellState => (v ? FILLED : EMPTY)));
    expect(isSolved(p, solved)).toBe(true);
    const empty = p.solution.map((row) => row.map((): CellState => EMPTY));
    expect(isSolved(p, empty)).toBe(false);
  });

  it("is deterministic and does not repeat within a cycle", () => {
    expect(boxPlotForDate("2026-10-14").name).toBe(boxPlotForDate("2026-10-14").name);
    const seen = new Set<string>();
    for (let i = 0; i < PICTURES.length; i++) {
      const d = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      seen.add(boxPlotForDate(d).name);
    }
    expect(seen.size).toBe(PICTURES.length);
  });
});
