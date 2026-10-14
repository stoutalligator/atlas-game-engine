import { describe, expect, it } from "vitest";
import { boxPlotForDate } from "../games/box-plot/logic.js";
import { cubeRushForDate } from "../games/cube-rush/daily.js";
import {
  type CubeRushPuzzle,
  type Direction,
  applyMove,
  canMove,
  isSolved,
} from "../games/cube-rush/logic.js";
import { generateRiskPool } from "../games/risk-pool/logic.js";
import { verifyGameResult, wilsonLowerBound } from "../server-entry.js";

const DATE = "2026-10-14";

/** Shortest single-step solution, for building a valid proof. */
function solveSteps(start: CubeRushPuzzle): Array<[string, Direction]> {
  const enc = (p: CubeRushPuzzle) => p.pieces.map((x) => `${x.col},${x.row}`).join(";");
  type Node = { pz: CubeRushPuzzle; path: Array<[string, Direction]> };
  let frontier: Node[] = [{ pz: start, path: [] }];
  const seen = new Set([enc(start)]);
  while (frontier.length) {
    const next: Node[] = [];
    for (const { pz, path } of frontier)
      for (const p of pz.pieces)
        for (const d of ["up", "down", "left", "right"] as Direction[]) {
          if (!canMove(pz, p.id, d)) continue;
          const m = applyMove(pz, p.id, d);
          const steps: Array<[string, Direction]> = [...path, [p.id, d]];
          if (isSolved(m)) return steps;
          if (seen.has(enc(m))) continue;
          seen.add(enc(m));
          next.push({ pz: m, path: steps });
        }
    frontier = next;
  }
  throw new Error("unsolvable");
}

describe("verifyGameResult", () => {
  it("replays a real Cube Rush solution and rejects junk", () => {
    const steps = solveSteps(cubeRushForDate(DATE).puzzle);
    const ok = verifyGameResult({ game: "cube-rush", date: DATE, proof: { steps } });
    expect(ok?.solved).toBe(true);
    expect(ok?.moves).toBeGreaterThan(0);
    const partial = { steps: steps.slice(0, -1) };
    expect(verifyGameResult({ game: "cube-rush", date: DATE, proof: partial })).toBeNull();
    expect(
      verifyGameResult({ game: "cube-rush", date: "2026-10-15", proof: { steps } }),
    ).toBeNull();
  });

  it("checks Risk Pool pools", () => {
    const pz = generateRiskPool(DATE);
    const proof = { pools: pz.solution, hints: 2 };
    expect(verifyGameResult({ game: "risk-pool", date: DATE, proof })).toEqual({
      solved: true,
      hints: 2,
    });
    const missing = { pools: pz.solution.slice(1) };
    expect(verifyGameResult({ game: "risk-pool", date: DATE, proof: missing })).toBeNull();
  });

  it("checks the Box Plot grid", () => {
    const pz = boxPlotForDate(DATE);
    const cells = pz.solution.flat().map((v) => (v ? 1 : 2));
    expect(verifyGameResult({ game: "box-plot", date: DATE, proof: { cells } })?.solved).toBe(true);
    const blank = { cells: cells.map(() => 0) };
    expect(verifyGameResult({ game: "box-plot", date: DATE, proof: blank })).toBeNull();
  });

  it("scores Assumption Drift from the server's pack, not the client", () => {
    const pack = {
      gameType: "assumption_drift",
      gameId: "g",
      packId: "p1",
      title: "Assumption Drift — T",
      payload: {
        questions: [
          {
            id: "q1",
            scenario: "s",
            drift: "d",
            prompt: "p",
            choices: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
            answer: "a",
            solution: { text: "t" },
          },
        ],
      },
    };
    const check = (answers: object, packId = "p1") =>
      verifyGameResult({
        game: "assumption-drift",
        date: DATE,
        packs: [pack],
        proof: { packId, answers },
      });
    expect(check({ q1: "a" })).toEqual({ solved: true, correct: 1, total: 1 });
    expect(check({ q1: "b" })).toEqual({ solved: false, correct: 0, total: 1 });
    expect(check({ q1: "a" }, "other")).toBeNull();
  });

  it("rejects unknown games, bad dates and non-objects", () => {
    expect(verifyGameResult({ game: "chess", date: DATE, proof: {} })).toBeNull();
    expect(verifyGameResult({ game: "box-plot", date: "yesterday", proof: {} })).toBeNull();
    expect(verifyGameResult({ game: "box-plot", date: DATE, proof: null })).toBeNull();
  });
});

describe("wilsonLowerBound", () => {
  it("ranks a long record above a lucky streak", () => {
    expect(wilsonLowerBound(1, 1)).toBeLessThan(wilsonLowerBound(9, 10));
    expect(wilsonLowerBound(9, 10)).toBeLessThan(wilsonLowerBound(27, 30));
    expect(wilsonLowerBound(0, 0)).toBe(0);
  });
});
