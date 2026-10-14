import { describe, expect, it } from "vitest";
import { addDays, dayIndex, puzzleNumber } from "../core/daily.js";
import { computeStats } from "../core/storage.js";
import { packForDate, parseAssumptionDriftPack } from "../games/assumption-drift/pack.js";

describe("daily calendar", () => {
  it("numbers puzzles from the epoch", () => {
    expect(puzzleNumber("2026-01-01")).toBe(1);
    expect(puzzleNumber("2026-10-14")).toBe(287);
    expect(dayIndex(addDays("2026-03-08", 1)) - dayIndex("2026-03-08")).toBe(1);
  });
});

describe("streaks", () => {
  it("counts current and best streaks, allowing today to be unplayed", () => {
    const h = {
      "2026-10-01": { solved: true, durationSec: 1 },
      "2026-10-02": { solved: true, durationSec: 1 },
      "2026-10-03": { solved: true, durationSec: 1 },
      "2026-10-05": { solved: false, durationSec: 1 },
      "2026-10-12": { solved: true, durationSec: 1 },
      "2026-10-13": { solved: true, durationSec: 1 },
    };
    const s = computeStats(h, "2026-10-14");
    expect(s.played).toBe(6);
    expect(s.solved).toBe(5);
    expect(s.currentStreak).toBe(2);
    expect(s.maxStreak).toBe(3);
    expect(computeStats(h, "2026-10-16").currentStreak).toBe(0);
  });
});

describe("assumption drift packs", () => {
  const pack = {
    schemaVersion: 1,
    gameType: "assumption_drift",
    gameId: "x",
    packId: "x-1",
    title: "Assumption Drift — Test",
    payload: {
      instructions: "",
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
          solution: { text: "because" },
        },
      ],
    },
  };

  it("accepts a valid pack and rejects a bad answer id", () => {
    expect(parseAssumptionDriftPack(pack).packId).toBe("x-1");
    const bad = structuredClone(pack);
    bad.payload.questions[0].answer = "z";
    expect(() => parseAssumptionDriftPack(bad)).toThrow(/answer "z"/);
  });

  it("rotates one pack per day", () => {
    const list = ["a", "b", "c"];
    const seen = new Set([0, 1, 2].map((i) => packForDate(list, addDays("2026-10-14", i))));
    expect(seen.size).toBe(3);
    expect(packForDate([], "2026-10-14")).toBeNull();
  });
});
