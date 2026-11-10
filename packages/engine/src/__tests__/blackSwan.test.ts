import { describe, expect, it } from "vitest";
import { columnAnswers } from "../games/black-swan/chart.js";
import {
  BLACK_SWAN_LIST_LIMIT,
  BLACK_SWAN_MAX_SCORE,
  BLACK_SWAN_PROMPTS,
  BLACK_SWAN_TIERS,
  type BlackSwanAnswer,
  type BlackSwanQuestion,
  assignTiers,
  blackSwanShareLine,
  dayDistribution,
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
    { label: "Chain ladder", aliases: ["chain-ladder", "loss development method"], tier: "mode" },
    { label: "Bornhuetter-Ferguson", aliases: ["bf", "bf method"], tier: "expected" },
    { label: "Expected loss ratio", aliases: ["elr"], tier: "expected", familiarity: 5 },
    { label: "Cape Cod", aliases: ["stanard-buhlmann"], tier: "sigma" },
    { label: "Mack", aliases: [], tier: "tail" },
    { label: "Munich chain ladder", aliases: [], tier: "tail" },
    {
      label: "Schnieper",
      aliases: [],
      tier: "swan",
      fact: "Separates IBNR from reserve changes on known claims.",
    },
  ],
};

function pool(
  perCategory: number,
  categories = ["a", "b", "c", "d", "e", "f", "g", "h"],
): BlackSwanQuestion[] {
  return categories.flatMap((c) =>
    Array.from({ length: perCategory }, (_, i) => ({ ...reserving, id: `${c}-${i}`, category: c })),
  );
}

/** A long-tail question: n answers named "Title 0" … with falling familiarity. */
function bigQuestion(n: number): BlackSwanQuestion {
  const items = Array.from({ length: n }, (_, i) => ({
    label: i === 777 ? "Neon Genesis Evangelion" : `Title ${i}`,
    familiarity: Math.round(1e6 / (i + 1) ** 1.2),
  }));
  return {
    id: "big",
    category: "anime",
    prompt: "Name an anime.",
    answers: assignTiers(items).map(
      (a): BlackSwanAnswer => ({
        label: a.label,
        aliases: [],
        tier: a.tier,
        familiarity: a.familiarity,
      }),
    ),
  };
}

describe("tiers", () => {
  it("scores 10 / 30 / 60 / 85 / 100 over seven prompts", () => {
    expect(BLACK_SWAN_TIERS.map((t) => t.points)).toEqual([10, 30, 60, 85, 100]);
    expect(BLACK_SWAN_PROMPTS).toBe(7);
    expect(BLACK_SWAN_MAX_SCORE).toBe(700);
  });
  it("maps chart positions to tier bands", () => {
    expect(tierFor(0.1).key).toBe("mode");
    expect(tierFor(0.4).key).toBe("expected");
    expect(tierFor(0.7).key).toBe("sigma");
    expect(tierFor(0.9).key).toBe("tail");
    expect(tierFor(0.97).key).toBe("swan");
  });
});

describe("assignTiers", () => {
  it("makes exactly one Black Swan, the least familiar answer by default", () => {
    const out = assignTiers([
      { label: "A", familiarity: 100 },
      { label: "B", familiarity: 50 },
      { label: "C", familiarity: 1 },
    ]);
    expect(out.filter((a) => a.tier === "swan").map((a) => a.label)).toEqual(["C"]);
    expect(out[0].tier).toBe("mode");
  });
  it("lets the curator pick the Black Swan", () => {
    const out = assignTiers(
      [
        { label: "A", familiarity: 100 },
        { label: "B", familiarity: 50 },
        { label: "C", familiarity: 1 },
      ],
      { swan: "B" },
    );
    expect(out.find((a) => a.tier === "swan")?.label).toBe("B");
    expect(() => assignTiers([{ label: "A", familiarity: 1 }], { swan: "Z" })).toThrow();
  });
  it("cuts on cumulative familiarity, so an even list spreads across tiers", () => {
    const even = assignTiers(
      Array.from({ length: 21 }, (_, i) => ({ label: `C${i}`, familiarity: 10 })),
    );
    const count = (k: string) => even.filter((a) => a.tier === k).length;
    expect(count("mode")).toBe(10);
    expect(count("expected")).toBe(5);
    expect(count("sigma")).toBe(3);
    expect(count("tail")).toBe(2);
    expect(count("swan")).toBe(1);
  });
  it("puts nearly all of a long tail in Tail", () => {
    const q = bigQuestion(20000);
    const tail = q.answers.filter((a) => a.tier === "tail").length;
    expect(tail / q.answers.length).toBeGreaterThan(0.9);
    expect(q.answers.filter((a) => a.tier === "mode").length).toBeGreaterThan(0);
  });
});

describe("matchGuess", () => {
  it("locks exact labels straight in, ignoring case and punctuation", () => {
    expect(matchGuess(reserving, "cape cod")).toEqual({ kind: "exact", label: "Cape Cod" });
    expect(matchGuess(reserving, "  CHAIN LADDER! ")).toEqual({
      kind: "exact",
      label: "Chain ladder",
    });
    expect(matchGuess(reserving, "chainladder")).toEqual({ kind: "exact", label: "Chain ladder" });
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
    expect(matchGuess(reserving, "Shnieper")).toEqual({ kind: "suggest", label: "Schnieper" });
  });
  it("rejects answers that aren't on the list", () => {
    expect(matchGuess(reserving, "obamacare")).toBeNull();
    expect(matchGuess(reserving, "")).toBeNull();
    expect(matchGuess(reserving, "mac")).toBeNull(); // short forms get no typo tolerance
  });
  it("stays fast on tens of thousands of answers", () => {
    const q = bigQuestion(30000);
    matchGuess(q, "warm up the index");
    const t0 = performance.now();
    expect(matchGuess(q, "Title 29999")).toEqual({ kind: "exact", label: "Title 29999" });
    expect(matchGuess(q, "neon genisis evangelian")).toEqual({
      kind: "suggest",
      label: "Neon Genesis Evangelion",
    });
    expect(matchGuess(q, "nothing like any title at all")).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("scoreGuess", () => {
  it("scores the answer's fixed tier and zero for a miss", () => {
    expect(scoreGuess(reserving, "Chain ladder", "chain ladder").points).toBe(10);
    expect(scoreGuess(reserving, "Cape Cod", "cape cod").points).toBe(60);
    const swan = scoreGuess(reserving, "Schnieper", "schnieper");
    expect(swan).toMatchObject({ points: 100, tier: "swan" });
    const miss = scoreGuess(reserving, null, "obamacare");
    expect(miss).toMatchObject({ points: 0, tier: null, label: null, p: null, picks: null });
    expect(summarizeDay([swan, miss])).toEqual({
      score: 100,
      rarity: (swan.p ?? 0) / 2,
      blackSwans: 1,
    });
  });
  it("ignores the crowd's picks when scoring, but reports them", () => {
    const counts = { Schnieper: 9000, "Chain ladder": 10, "Not an answer": 99 };
    const r = scoreGuess(reserving, "Schnieper", "schnieper", counts);
    expect(r.points).toBe(100);
    expect(r.picks).toBe(9000);
    expect(r.players).toBe(9010);
  });
  it("reveals the Black Swan and its fact", () => {
    const r = scoreGuess(reserving, "Mack", "mack");
    expect(r.swan).toEqual({
      label: "Schnieper",
      fact: "Separates IBNR from reserve changes on known claims.",
    });
  });
  it("lists answers most common first, by tier then familiarity", () => {
    const r = scoreGuess(reserving, "Mack", "mack");
    expect(r.ranking.map((a) => a.label)).toEqual([
      "Chain ladder",
      "Expected loss ratio",
      "Bornhuetter-Ferguson",
      "Cape Cod",
      "Mack",
      "Munich chain ladder",
      "Schnieper",
    ]);
    expect(r.more).toBe(0);
    expect(r.tierCounts).toEqual({ mode: 1, expected: 2, sigma: 1, tail: 2, swan: 1 });
    for (const a of r.ranking) expect(tierFor(a.p).key).toBe(a.tier);
    expect(r.ranking.every((a, i) => i === 0 || a.p > r.ranking[i - 1].p)).toBe(true);
  });
  it("caps a long list but keeps the player's answer, the swan and the crowd's picks", () => {
    const q = bigQuestion(5000);
    const swan = q.answers.find((a) => a.tier === "swan")?.label as string;
    const r = scoreGuess(q, "Title 4000", "title 4000", { "Title 3000": 12 });
    expect(r.answerCount).toBe(5000);
    const labels = r.ranking.map((a) => a.label);
    expect(labels).toContain("Title 4000");
    expect(labels).toContain("Title 3000");
    expect(labels).toContain(swan);
    expect(r.ranking.length).toBeLessThanOrEqual(BLACK_SWAN_LIST_LIMIT + 3);
    expect(r.more).toBe(5000 - r.ranking.length);
  });
  it("draws a share line out of 700", () => {
    const rs = [
      scoreGuess(reserving, "Schnieper", "x"),
      scoreGuess(reserving, null, "x"),
      scoreGuess(reserving, "Chain ladder", "x"),
    ];
    expect(blackSwanShareLine(rs)).toBe("🦢 ✕ ▁   110/700");
  });
});

describe("dayDistribution", () => {
  it("bins scores and counts players below the viewer", () => {
    const d = dayDistribution([0, 100, 100, 300, 700], 300);
    expect(d.players).toBe(5);
    expect(d.below).toBe(3);
    expect(d.bins).toHaveLength(28);
    expect(d.bins[0]).toBe(1);
    expect(d.bins[4]).toBe(2);
    expect(d.bins[27]).toBe(1); // 700 lands in the last bin
    expect(d.mean).toBe(240);
    expect(d.sd).toBeCloseTo(Math.sqrt((240 ** 2 + 2 * 140 ** 2 + 60 ** 2 + 460 ** 2) / 5));
  });
});

describe("schedule", () => {
  it("plans seven questions a day from seven different categories", () => {
    const p = pool(10);
    const s = planSchedule(p, { start: "2026-11-01", days: 7 });
    expect(Object.keys(s)).toHaveLength(7);
    for (const ids of Object.values(s)) {
      expect(ids).toHaveLength(BLACK_SWAN_PROMPTS);
      expect(new Set(ids.map((id) => id.split("-")[0])).size).toBe(7);
    }
  });
  it("doesn't repeat a question inside the cooldown when the pool allows", () => {
    const p = pool(10); // 80 questions = 11 days of prompts
    const s = planSchedule(p, { start: "2026-11-01", days: 11, cooldownDays: 30 });
    const all = Object.values(s).flat();
    expect(new Set(all).size).toBe(all.length);
  });
  it("keeps existing days and is deterministic", () => {
    const p = pool(4);
    const existing = { "2026-11-01": ["a-0", "b-0", "c-0", "d-0", "e-0", "f-0", "g-0"] };
    const a = planSchedule(p, { start: "2026-11-01", days: 5, existing });
    const b = planSchedule(p, { start: "2026-11-01", days: 5, existing });
    expect(a).toEqual(b);
    expect(a["2026-11-01"]).toEqual(existing["2026-11-01"]);
    expect(a["2026-11-02"]).not.toContain("a-0");
  });
  it("falls back to a deterministic pick for unplanned days", () => {
    const p = pool(3);
    const q1 = questionsForDate(p, {}, "2027-01-01").map((q) => q.id);
    expect(q1).toHaveLength(7);
    expect(new Set(q1.map((id) => id.split("-")[0])).size).toBe(7);
    expect(questionsForDate(p, {}, "2027-01-01").map((q) => q.id)).toEqual(q1);
  });
});

describe("parseBlackSwanQuestions", () => {
  it("accepts a valid pack and keeps familiarity and facts", () => {
    const [q] = parseBlackSwanQuestions({ questions: [reserving] });
    expect(q.answers[2].familiarity).toBe(5);
    expect(q.answers[6].fact).toMatch(/IBNR/);
  });
  it("rejects an alias that matches two answers", () => {
    const bad = {
      ...reserving,
      answers: [...reserving.answers, { label: "BF", aliases: [], tier: "tail" }],
    };
    expect(() => parseBlackSwanQuestions([bad])).toThrow(/matches both/);
  });
  it("needs a tier on every answer and exactly one Black Swan", () => {
    const noTier = reserving.answers.map((a, i) => (i === 0 ? { ...a, tier: "rare" } : a));
    expect(() => parseBlackSwanQuestions([{ ...reserving, answers: noTier }])).toThrow(
      /needs a tier/,
    );
    const twoSwans = reserving.answers.map((a, i) => (i === 0 ? { ...a, tier: "swan" } : a));
    expect(() => parseBlackSwanQuestions([{ ...reserving, answers: twoSwans }])).toThrow(
      /exactly one Black Swan/,
    );
    const noSwan = reserving.answers.map((a) => (a.tier === "swan" ? { ...a, tier: "tail" } : a));
    expect(() => parseBlackSwanQuestions([{ ...reserving, answers: noSwan }])).toThrow(
      /exactly one Black Swan/,
    );
  });
  it("rejects duplicate ids and labels", () => {
    expect(() => parseBlackSwanQuestions([reserving, reserving])).toThrow(/Duplicate/);
    const dup = { ...reserving, answers: [...reserving.answers, reserving.answers[0]] };
    expect(() => parseBlackSwanQuestions([dup])).toThrow(/listed twice/);
  });
});

describe("chart columns", () => {
  const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ lo: i / n, hi: (i + 1) / n }));
  const positions = (q: BlackSwanQuestion) => scoreGuess(q, null, "").ranking.map((a) => a.p);

  it("puts every answer in a column and leaves no column empty", () => {
    const groups = columnAnswers(positions(bigQuestion(200)), cols(30));
    expect(new Set(groups.flat()).size).toBe(200);
    expect(groups.every((g) => g.length > 0)).toBe(true);
  });

  it("gives an empty column its nearest answer when the list is short", () => {
    const groups = columnAnswers(positions(reserving), cols(30));
    expect(groups.every((g) => g.length === 1)).toBe(true);
  });
});
