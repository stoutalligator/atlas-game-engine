import { describe, expect, it } from "vitest";
import {
  BLACK_SWAN_PROMPTS,
  type BlackSwanQuestion,
  blackSwanTierSizes,
  buildRarityTable,
  matchGuess,
  parseBlackSwanQuestions,
  planSchedule,
  questionsForDate,
  scoreGuess,
  summarizeDay,
  tierFor,
} from "../games/black-swan/logic.js";

const reserving: BlackSwanQuestion = {
  id: "q-res",
  category: "actuarial",
  prompt: "Name a loss reserving method.",
  answers: [
    { label: "Chain ladder", aliases: ["chain-ladder", "loss development method"], prior: 34 },
    { label: "Bornhuetter-Ferguson", aliases: ["bf", "bf method"], prior: 22 },
    { label: "Expected loss ratio", aliases: ["elr"], prior: 12 },
    { label: "Cape Cod", aliases: ["stanard-buhlmann"], prior: 7 },
    { label: "Mack", aliases: [], prior: 4 },
    { label: "Munich chain ladder", aliases: [], prior: 1 },
    { label: "Schnieper", aliases: [], prior: 0.15 },
  ],
};

function pool(
  perCategory: number,
  categories = ["a", "b", "c", "d", "e", "f"],
): BlackSwanQuestion[] {
  return categories.flatMap((c) =>
    Array.from({ length: perCategory }, (_, i) => ({ ...reserving, id: `${c}-${i}`, category: c })),
  );
}

describe("matchGuess", () => {
  it("locks exact labels straight in, ignoring case and punctuation", () => {
    expect(matchGuess(reserving, "cape cod")).toEqual({ kind: "exact", label: "Cape Cod" });
    expect(matchGuess(reserving, "  CHAIN LADDER! ")).toEqual({
      kind: "exact",
      label: "Chain ladder",
    });
  });
  it("offers aliases and typos as a correction to confirm", () => {
    expect(matchGuess(reserving, "BF")).toEqual({ kind: "suggest", label: "Bornhuetter-Ferguson" });
    expect(matchGuess(reserving, "bornheutter ferguson")).toEqual({
      kind: "suggest",
      label: "Bornhuetter-Ferguson",
    });
    expect(matchGuess(reserving, "Stanard Buhlmann")).toEqual({
      kind: "suggest",
      label: "Cape Cod",
    });
    expect(matchGuess(reserving, "chainladder")?.label).toBe("Chain ladder");
  });
  it("rejects answers that aren't on the list", () => {
    expect(matchGuess(reserving, "obamacare")).toBeNull();
    expect(matchGuess(reserving, "")).toBeNull();
    expect(matchGuess(reserving, "mac")).toBeNull(); // short forms get no typo tolerance
  });
});

describe("rarity", () => {
  it("uses the priors alone when nobody has answered yet", () => {
    const t = buildRarityTable(reserving, {});
    expect(t.realCount).toBe(0);
    expect(t.z).toBe(0);
    expect(t.rows[0].label).toBe("Chain ladder");
    expect(t.rows.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1);
    expect(t.rows[0].tier).toBe("mode");
    expect(t.rows.at(-1)?.tier).toBe("swan");
  });
  it("blends real counts in with credibility Z = n / (n + k)", () => {
    const counts = { "Cape Cod": 300 };
    const t = buildRarityTable(reserving, counts, 200);
    expect(t.z).toBeCloseTo(300 / 500);
    expect(t.rows[0].label).toBe("Cape Cod"); // everyone said it, so now it's the common one
    expect(t.rows.find((r) => r.label === "Cape Cod")?.tier).toBe("mode");
  });
  it("maps rarity positions to tiers at 35 / 62 / 82 / 94%", () => {
    expect(tierFor(0.1).key).toBe("mode");
    expect(tierFor(0.4).key).toBe("expected");
    expect(tierFor(0.7).key).toBe("sigma");
    expect(tierFor(0.9).key).toBe("tail");
    expect(tierFor(0.97).key).toBe("swan");
  });
  it("scores fixed points per tier and zero for a miss", () => {
    const t = buildRarityTable(reserving, {});
    const swan = scoreGuess(t, "Schnieper", "schnieper");
    expect(swan.points).toBe(200);
    expect(scoreGuess(t, "Chain ladder", "chain ladder").points).toBe(10);
    expect(swan.ranking.map((r) => r.label)).toEqual(t.rows.map((r) => r.label));
    expect(swan.ranking[0]).toMatchObject({ label: "Chain ladder", tier: "mode" });
    const miss = scoreGuess(t, null, "obamacare");
    expect(miss.points).toBe(0);
    expect(miss.tier).toBeNull();
    expect(summarizeDay([swan, miss])).toEqual({
      score: 200,
      rarity: (swan.p ?? 0) / 2,
      blackSwans: 1,
    });
  });
});

describe("tier sizes", () => {
  it("slices the answer list 35 / 27 / 20 / 12 / 6%, shrinking toward the tail", () => {
    expect(blackSwanTierSizes(100)).toEqual([35, 27, 20, 12, 6]);
    expect(blackSwanTierSizes(33)).toEqual([12, 9, 6, 4, 2]);
    expect(blackSwanTierSizes(11)).toEqual([4, 3, 2, 1, 1]);
    expect(blackSwanTierSizes(5)).toEqual([1, 1, 1, 1, 1]);
    for (let n = 5; n <= 200; n++) {
      const s = blackSwanTierSizes(n);
      expect(s.reduce((a, b) => a + b, 0)).toBe(n);
      expect(Math.min(...s)).toBeGreaterThanOrEqual(1);
      for (let i = 1; i < s.length; i++) expect(s[i]).toBeLessThanOrEqual(s[i - 1]);
    }
  });
  it("ranks answers and keeps each tier's positions inside its band", () => {
    const t = buildRarityTable(reserving, {});
    expect(t.rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(t.rows.filter((r) => r.tier === "mode")).toHaveLength(2);
    expect(t.rows.filter((r) => r.tier === "swan")).toHaveLength(1);
    for (const r of t.rows) expect(tierFor(r.p).key).toBe(r.tier);
  });
});

describe("schedule", () => {
  it("plans five questions a day from five different categories", () => {
    const p = pool(10);
    const s = planSchedule(p, { start: "2026-11-01", days: 7 });
    expect(Object.keys(s)).toHaveLength(7);
    for (const ids of Object.values(s)) {
      expect(ids).toHaveLength(BLACK_SWAN_PROMPTS);
      expect(new Set(ids.map((id) => id.split("-")[0])).size).toBe(5);
    }
  });
  it("doesn't repeat a question inside the cooldown when the pool allows", () => {
    const p = pool(10); // 60 questions = 12 days of prompts
    const s = planSchedule(p, { start: "2026-11-01", days: 12, cooldownDays: 30 });
    const all = Object.values(s).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it("keeps existing days and is deterministic", () => {
    const p = pool(4);
    const existing = { "2026-11-01": ["a-0", "b-0", "c-0", "d-0", "e-0"] };
    const a = planSchedule(p, { start: "2026-11-01", days: 5, existing });
    const b = planSchedule(p, { start: "2026-11-01", days: 5, existing });
    expect(a).toEqual(b);
    expect(a["2026-11-01"]).toEqual(existing["2026-11-01"]);
    expect(a["2026-11-02"]).not.toContain("a-0");
  });
  it("falls back to a deterministic pick for unplanned days", () => {
    const p = pool(3);
    const q1 = questionsForDate(p, {}, "2027-01-01").map((q) => q.id);
    expect(q1).toHaveLength(5);
    expect(new Set(q1.map((id) => id.split("-")[0])).size).toBe(5);
    expect(questionsForDate(p, {}, "2027-01-01").map((q) => q.id)).toEqual(q1);
  });
});

describe("parseBlackSwanQuestions", () => {
  it("accepts a valid pack", () => {
    expect(parseBlackSwanQuestions({ questions: [reserving] })).toHaveLength(1);
  });
  it("rejects an alias that matches two answers", () => {
    const bad = {
      ...reserving,
      answers: [...reserving.answers, { label: "BF", aliases: [], prior: 1 }],
    };
    expect(() => parseBlackSwanQuestions([bad])).toThrow(/matches both/);
  });
  it("rejects missing priors and duplicate ids", () => {
    expect(() =>
      parseBlackSwanQuestions([
        { ...reserving, answers: reserving.answers.map((a) => ({ ...a, prior: 0 })) },
      ]),
    ).toThrow(/positive prior/);
    expect(() => parseBlackSwanQuestions([reserving, reserving])).toThrow(/Duplicate/);
  });
});
