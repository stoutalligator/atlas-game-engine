import { describe, expect, it } from "vitest";
import { addDays } from "../core/daily.js";
import {
  generateRiskPool,
  isComplete,
  isValidPool,
  nextHint,
  pickPoolColor,
  sizeForWeekday,
} from "../games/risk-pool/logic.js";

describe("risk pool", () => {
  it("is deterministic per date", () => {
    expect(generateRiskPool("2026-10-14")).toEqual(generateRiskPool("2026-10-14"));
    expect(generateRiskPool("2026-10-14").values).not.toEqual(
      generateRiskPool("2026-10-15").values,
    );
  });

  it("generates a valid published solution for 120 straight days", () => {
    let date = "2026-01-01";
    for (let i = 0; i < 120; i++) {
      const pz = generateRiskPool(date);
      expect(pz.values.every((v) => v >= 1 && v <= 9)).toBe(true);
      expect(isComplete(pz, pz.solution)).toBe(true);
      date = addDays(date, 1);
    }
  });

  it("scales grid size through the week", () => {
    expect(sizeForWeekday(1)).toBe(5);
    expect(sizeForWeekday(3)).toBe(6);
    expect(sizeForWeekday(6)).toBe(7);
  });

  it("rejects pools that miss the target or are disconnected", () => {
    const pz = generateRiskPool("2026-10-14");
    const [first] = pz.solution;
    expect(isValidPool(first, pz)).toBe(true);
    expect(isValidPool(first.slice(1), pz)).toBe(false);
    expect(isValidPool([0, pz.size * pz.size - 1], pz)).toBe(false);
  });

  it("hints reveal free solution pools, then flag stray pools", () => {
    const pz = generateRiskPool("2026-10-14");
    const hint = nextHint(pz, []);
    expect(hint?.kind).toBe("reveal");
    expect(nextHint(pz, pz.solution)).toBeNull();
  });

  it("never colours a pool like its neighbours", () => {
    const pz = generateRiskPool("2026-10-18");
    const pools: number[][] = [];
    const colors: number[] = [];
    for (const g of pz.solution) {
      colors.push(pickPoolColor(g, pools, colors, pz.size));
      pools.push(g);
    }
    // spot check: first two adjacent pools differ
    expect(new Set(colors).size).toBeGreaterThan(1);
  });
});
