import { describe, expect, it } from "vitest";
import { addDays, weekday } from "../core/daily.js";
import {
  BOX_PLOT_DAYS,
  BOX_PLOT_SIZES,
  LIBRARY,
  choppiness,
  pictureForDate,
  pictureHeadline,
  poolFor,
} from "../games/box-plot/library.js";
import {
  type CellState,
  EMPTY,
  FILLED,
  MARKED,
  boxPlotForDate,
  buildPuzzle,
  findMistakes,
  isSolved,
  lineSolve,
  runsOf,
} from "../games/box-plot/logic.js";

describe("box plot", () => {
  it("computes runs", () => {
    expect(runsOf([true, true, false, true])).toEqual([2, 1]);
    expect(runsOf([false, false])).toEqual([]);
  });

  it("every picture is a square of a supported size, coloured from its palette", () => {
    const bad: string[] = [];
    for (const pic of LIBRARY) {
      const n = pic.rows.length;
      if (!(BOX_PLOT_SIZES as readonly number[]).includes(n)) bad.push(`${pic.name}: size ${n}`);
      if (pic.rows.some((r) => r.length !== n)) bad.push(`${pic.name}: not square`);
      for (const ch of pic.rows.join(""))
        if (ch !== "." && !pic.palette[ch]) bad.push(`${pic.name}: no colour for "${ch}"`);
      if (Object.keys(pic.palette).some((k) => k.length !== 1 || k === "."))
        bad.push(`${pic.name}: bad palette key`);
      if (!pic.rows.join("").replaceAll(".", "")) bad.push(`${pic.name}: empty`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("every picture is solvable by line logic alone", () => {
    const unsolvable = LIBRARY.filter((pic) => {
      const p = buildPuzzle(pic);
      return !lineSolve(p.rowClues, p.colClues);
    }).map((p) => p.name);
    expect(unsolvable).toEqual([]);
  });

  it("reveal headlines read as one thing, with the right article", () => {
    expect(pictureHeadline("Owl")).toBe("It's an owl.");
    expect(pictureHeadline("Strawberry")).toBe("It's a strawberry.");
    expect(pictureHeadline("Bunch of grapes")).toBe("It's a bunch of grapes.");
    // Names ending in "s" must be singular words, not plurals like "Grapes".
    const singularS = new Set([
      "glasses",
      "octopus",
      "cactus",
      "abacus",
      "bus",
      "compass",
      "walrus",
      "hippopotamus",
    ]);
    const plural = LIBRARY.map((p) => p.name).filter((n) => {
      const head = n.toLowerCase().split(/ (?:of|with|and) /)[0];
      const last = head.split(/[\s-]/).at(-1) ?? "";
      return last.endsWith("s") && !last.endsWith("ss") && !singularS.has(last);
    });
    expect([...new Set(plural)]).toEqual([]);
  });

  it("picture names are unique within a size", () => {
    for (const size of BOX_PLOT_SIZES) {
      const names = LIBRARY.filter((p) => p.rows.length === size).map((p) => p.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("colours follow the picture; empty cells have none", () => {
    const p = buildPuzzle({
      name: "t",
      palette: { R: "#f00", B: "#00f" },
      rows: ["R.B..", ".....", ".....", ".....", "....."],
    });
    expect(p.colors[0]).toEqual(["#f00", null, "#00f", null, null]);
    expect(p.solution[0]).toEqual([true, false, true, false, false]);
    expect(p.palette).toEqual(["#f00", "#00f"]);
  });

  it("accepts the solution and rejects an empty board", () => {
    const p = boxPlotForDate("2026-10-14");
    const solved = p.solution.map((row) => row.map((v): CellState => (v ? FILLED : EMPTY)));
    expect(isSolved(p, solved)).toBe(true);
    const empty = p.solution.map((row) => row.map((): CellState => EMPTY));
    expect(isSolved(p, empty)).toBe(false);
  });

  it("check flags wrong fills and wrong marks, never blanks", () => {
    const p = boxPlotForDate("2026-10-14");
    const want = p.solution.flat();
    const filled = want.indexOf(true);
    const empty = want.indexOf(false);
    const cells: CellState[] = want.map(() => EMPTY);
    expect(findMistakes(p, cells)).toEqual([]); // blank board: no mistakes
    cells[filled] = FILLED;
    expect(findMistakes(p, cells)).toEqual([]); // right fill
    cells[empty] = FILLED;
    expect(findMistakes(p, cells)).toEqual([empty]); // wrong fill
    cells[empty] = MARKED;
    cells[filled] = MARKED;
    expect(findMistakes(p, cells)).toEqual([filled]); // wrong ✕
  });

  it("each weekday gets its size: 5×5 Monday up to 12×12 Sunday", () => {
    // 2026-11-02 is a Monday.
    const sizes = Array.from(
      { length: 7 },
      (_, i) => boxPlotForDate(addDays("2026-11-02", i)).size,
    );
    expect(sizes).toEqual([5, 7, 8, 10, 10, 12, 12]);
  });

  it("days sharing a size split it: the harder day gets the choppier half", () => {
    for (const [easy, hard] of [
      [4, 5],
      [6, 0],
    ]) {
      expect(BOX_PLOT_DAYS[easy].size).toBe(BOX_PLOT_DAYS[hard].size);
      const a = poolFor(easy);
      const b = poolFor(hard);
      expect(a.length + b.length).toBe(
        LIBRARY.filter((p) => p.rows.length === BOX_PLOT_DAYS[easy].size).length,
      );
      expect(a.some((p) => b.includes(p))).toBe(false);
      if (a.length && b.length)
        expect(Math.max(...a.map((p) => choppiness(p.rows)))).toBeLessThanOrEqual(
          Math.min(...b.map((p) => choppiness(p.rows))),
        );
    }
  });

  it("choppiness counts runs per line", () => {
    expect(choppiness(["RRRRR", "RRRRR", "RRRRR", "RRRRR", "RRRRR"])).toBe(1);
    expect(choppiness(["R.R.R", ".....", "R.R.R", ".....", "R.R.R"])).toBe(1.8);
  });

  it("is deterministic, and a weekday doesn't repeat until its pool is used up", () => {
    expect(boxPlotForDate("2026-10-14").name).toBe(boxPlotForDate("2026-10-14").name);
    for (let wd = 0; wd < 7; wd++) {
      const pool = poolFor(wd);
      // The first date on or after 2026-01-01 with this weekday.
      let d = "2026-01-01";
      while (weekday(d) !== wd) d = addDays(d, 1);
      const seen = new Set<string>();
      for (let w = 0; w < pool.length; w++) seen.add(pictureForDate(addDays(d, w * 7)).name);
      expect(seen.size).toBe(pool.length);
    }
  });
});
