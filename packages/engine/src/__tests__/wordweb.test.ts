import { afterEach, describe, expect, it } from "vitest";
import { addDays, localDateKey, weekday } from "../core/daily.js";
import { mulberry32 } from "../core/rng.js";
import { createMemoryStorage } from "../core/storage.js";
import { MAX_STEP_MS, createActiveClock } from "../games/wordweb/clock.js";
import {
  type BankCategory,
  DIFFICULTY_WEIGHTS,
  HINT_COOLDOWN_MS,
  HOUSEHOLD_PETS,
  type Placed,
  WEEKDAY_TARGETS,
  type WordWebGenerator,
  type WordWebPuzzle,
  type WordWebState,
  allPass,
  answerPolicyProblem,
  backspace,
  buildUnlockTree,
  checkCategorySafety,
  checkRecurrence,
  constructLayouts,
  createBankGenerator,
  currentLetters,
  difficultyComponents,
  emptyQueue,
  evaluateGuess,
  fixedCells,
  generateForDate,
  hintStatus,
  historyFromQueue,
  inTarget,
  initialState,
  nearDuplicates,
  normalizeWord,
  openAnswers,
  parseBank,
  parseWordWebPuzzle,
  parseWordWebQueue,
  planQueue,
  progressionSquares,
  recordForDate,
  replayLog,
  restoreState,
  scoreDifficulty,
  selectAnswer,
  submitGuess,
  takeHint,
  tick,
  toEvergreen,
  treeStats,
  typeLetter,
  validateLayout,
  validateUnlockGraph,
  visibleAnswers,
  wordWebForDate,
  wordWebShareText,
} from "../games/wordweb/logic.js";
import { WORDWEB_TEST_BANK } from "./fixtures/wordwebBank.js";

const PETS = HOUSEHOLD_PETS.puzzle;
const DATE = "2026-11-02";
const bank: BankCategory[] = parseBank(WORDWEB_TEST_BANK);

declare const process: { env: Record<string, string | undefined> };

const id = (grid: string) => PETS.answers.find((a) => a.grid === grid)?.id as string;
const type = (s: WordWebState, word: string) => {
  let st = s;
  let last = null;
  for (const ch of word) {
    const r = typeLetter(PETS, st, ch);
    if (r) {
      st = r.state;
      last = r.outcome;
    }
  }
  return { state: st, outcome: last };
};
/** Solves `grid` by guess text, selecting it first. */
const solve = (s: WordWebState, grid: string) =>
  submitGuess(PETS, selectAnswer(PETS, s, id(grid)), id(grid), grid, () => "t").state;
const fresh = () => initialState(PETS, DATE);
const across = (gid: string, grid: string, row: number, col: number): Placed => ({
  id: gid,
  grid,
  row,
  col,
  direction: "across",
});
const down = (gid: string, grid: string, row: number, col: number): Placed => ({
  id: gid,
  grid,
  row,
  col,
  direction: "down",
});
const rule = (results: { rule: string; ok: boolean }[], name: string) =>
  results.find((r) => r.rule === name)?.ok;

// ── Canonical fixture ────────────────────────────────────────────────────

describe("canonical HOUSEHOLD PETS fixture", () => {
  it("passes every hard validator", () => {
    expect(() => parseWordWebPuzzle(PETS)).not.toThrow();
    expect(allPass(HOUSEHOLD_PETS.validation.layout)).toBe(true);
    expect(allPass(HOUSEHOLD_PETS.validation.graph)).toBe(true);
  });

  it("the layout exactly as written is illegal (documented adjustment)", () => {
    const written = [
      across("h", "HAMSTER", 5, 0),
      down("r", "RABBIT", 0, 4),
      across("c", "CAT", 1, 3),
      across("b", "BIRD", 3, 4),
      down("d", "DOG", 3, 7),
    ];
    const res = validateLayout(written);
    expect(rule(res, "runs-are-answers")).toBe(false);
    expect(res.find((r) => r.rule === "runs-are-answers")?.detail).toContain("HAMSTERG");
  });

  it("keeps the specified progression", () => {
    const parent = (g: string) => PETS.answers.find((a) => a.grid === g)?.parent;
    expect(parent("HAMSTER")).toBeNull();
    expect(parent("RABBIT")).toBe(id("HAMSTER"));
    expect(parent("CAT")).toBe(id("RABBIT"));
    expect(parent("BIRD")).toBe(id("RABBIT"));
    expect(parent("DOG")).toBe(id("BIRD"));
    // T (the fifth letter of HAMSTER) is the revealed start letter.
    expect(PETS.revealed).toEqual([4]);
  });

  it("BIRD begins at RABBIT's second B and DOG hangs down from BIRD's D", () => {
    const r = PETS.answers.find((a) => a.grid === "RABBIT") as Placed;
    const b = PETS.answers.find((a) => a.grid === "BIRD") as Placed;
    const d = PETS.answers.find((a) => a.grid === "DOG") as Placed;
    expect([b.row, b.col]).toEqual([r.row + 3, r.col]);
    expect(d.direction).toBe("down");
    expect([d.row, d.col]).toEqual([b.row, b.col + 3]);
  });
});

// ── Normalization ────────────────────────────────────────────────────────

describe("normalization", () => {
  it("handles case, spaces, hyphens and trim", () => {
    expect(normalizeWord("gold fish")).toBe("GOLDFISH");
    expect(normalizeWord("Goldfish")).toBe("GOLDFISH");
    expect(normalizeWord("T-shirt")).toBe("TSHIRT");
    expect(normalizeWord("t shirt")).toBe("TSHIRT");
    expect(normalizeWord("  hamster  ")).toBe("HAMSTER");
    expect(normalizeWord("Tic-tac-toe")).toBe("TICTACTOE");
  });
  it("folds accents and a few special letters", () => {
    expect(normalizeWord("Crème brûlée")).toBe("CREMEBRULEE");
    expect(normalizeWord("Jalapeño")).toBe("JALAPENO");
    expect(normalizeWord("Straße")).toBe("STRASSE");
  });
  it("rejects input that isn't letters rather than changing it", () => {
    expect(normalizeWord("R2D2")).toBeNull();
    expect(normalizeWord("Кот")).toBeNull();
    expect(normalizeWord(42 as unknown as string)).toBeNull();
  });
});

// ── Guess evaluation ─────────────────────────────────────────────────────

describe("guess evaluation", () => {
  it("accepts the correct answer and reveals RABBIT", () => {
    const res = submitGuess(PETS, fresh(), id("HAMSTER"), "hamster");
    expect(res.outcome).toBe("correct");
    expect(res.revealed).toEqual([id("RABBIT")]);
    expect(res.state.active).toBe(id("RABBIT"));
    expect(res.state.guessCount).toBe(1);
  });

  it("an ordinary miss counts a guess, changes nothing else and clears typed letters", () => {
    const typed = type(fresh(), "HAMPTER");
    expect(typed.outcome).toBeNull();
    const res = submitGuess(PETS, typed.state);
    expect(res.outcome).toBe("incorrect");
    expect(res.state.guessCount).toBe(1);
    expect(res.state.solved).toEqual([]);
    expect(currentLetters(PETS, res.state, id("HAMSTER")).join("")).toBe("T");
  });

  it("a plausible alternate gets the Close! outcome", () => {
    const s = solve(fresh(), "HAMSTER");
    const res = submitGuess(PETS, s, id("RABBIT"), "parrot");
    expect(submitGuess(PETS, s, id("RABBIT"), "ferret").outcome).toBe("mismatch");
    expect(res.outcome).toBe("alternate");
    expect(res.state.solved).toEqual([id("HAMSTER")]);
    expect(res.revealed).toEqual([]);
  });

  it("a repeated guess isn't counted again", () => {
    const once = submitGuess(PETS, fresh(), id("HAMSTER"), "HAMPTER").state;
    const twice = submitGuess(PETS, once, id("HAMSTER"), "hampter");
    expect(twice.outcome).toBe("repeat");
    expect(twice.state.guessCount).toBe(1);
  });

  it("an incomplete word isn't submitted", () => {
    const s = type(fresh(), "HAM").state;
    const res = submitGuess(PETS, s);
    expect(res.outcome).toBe("incomplete");
    expect(res.state).toBe(s);
  });

  it("a guess that contradicts a fixed letter is a mismatch, not a counted guess", () => {
    expect(evaluateGuess(PETS, fresh(), id("HAMSTER"), "HAMPTER").outcome).toBe("incorrect");
    const res = submitGuess(PETS, fresh(), id("HAMSTER"), "HAMMERS");
    expect(res.outcome).toBe("mismatch");
    expect(res.state.guessCount).toBe(0);
  });

  it("solved and hidden words can't be guessed", () => {
    const s = solve(fresh(), "HAMSTER");
    expect(submitGuess(PETS, s, id("HAMSTER"), "HAMSTER").outcome).toBe("solved");
    expect(submitGuess(PETS, s, id("DOG"), "DOG").outcome).toBe("hidden");
    expect(submitGuess(PETS, s, "nope", "DOG").outcome).toBe("hidden");
  });

  it("grades automatically once the typed letters spell the answer", () => {
    const res = type(fresh(), "HAMSER");
    expect(res.outcome).toBe("correct");
    expect(res.state.solved).toEqual([id("HAMSTER")]);
  });

  it("solved words can't be typed into", () => {
    const s = solve(fresh(), "HAMSTER");
    const onRabbit = typeLetter(PETS, { ...s, active: id("HAMSTER") }, "X");
    expect(onRabbit).toBeNull();
  });
});

// ── Unlock progression ───────────────────────────────────────────────────

describe("unlock progression", () => {
  it("starts with only the starting answer visible", () => {
    expect(visibleAnswers(PETS, fresh()).map((a) => a.grid)).toEqual(["HAMSTER"]);
  });

  it("one child, then two at once, then a nested descendant", () => {
    let s = solve(fresh(), "HAMSTER");
    expect(
      visibleAnswers(PETS, s)
        .map((a) => a.grid)
        .sort(),
    ).toEqual(["HAMSTER", "RABBIT"]);
    s = solve(s, "RABBIT");
    expect(
      openAnswers(PETS, s)
        .map((a) => a.grid)
        .sort(),
    ).toEqual(["BIRD", "CAT"]);
    // Auto-selects the first new word in reading order (BIRD sits above CAT).
    expect(s.active).toBe(id("BIRD"));
    expect(visibleAnswers(PETS, s).some((a) => a.grid === "DOG")).toBe(false);
    s = solve(s, "BIRD");
    expect(
      openAnswers(PETS, s)
        .map((a) => a.grid)
        .sort(),
    ).toEqual(["CAT", "DOG"]);
  });

  it("completes in any order, and only when every answer is solved", () => {
    for (const order of [
      ["HAMSTER", "RABBIT", "CAT", "BIRD", "DOG"],
      ["HAMSTER", "RABBIT", "BIRD", "DOG", "CAT"],
      ["HAMSTER", "RABBIT", "BIRD", "CAT", "DOG"],
    ]) {
      let s = fresh();
      order.forEach((g, i) => {
        s = solve(s, g);
        expect(s.done).toBe(i === order.length - 1);
      });
      expect(s.result?.guessCount).toBe(5);
    }
  });

  it("switching words keeps each word's typed letters", () => {
    let s = solve(solve(fresh(), "HAMSTER"), "RABBIT");
    s = selectAnswer(PETS, s, id("BIRD"));
    s = typeLetter(PETS, s, "I")?.state as WordWebState;
    s = selectAnswer(PETS, s, id("CAT"));
    s = typeLetter(PETS, s, "C")?.state as WordWebState;
    s = selectAnswer(PETS, s, id("BIRD"));
    expect(currentLetters(PETS, s, id("BIRD"))).toEqual(["B", "I", "", ""]);
    expect(currentLetters(PETS, s, id("CAT"))).toEqual(["C", "", "T"]);
    expect(backspace(PETS, s).typed).not.toHaveProperty("3,3");
  });

  it("rejects a cycle and an unreachable answer", () => {
    const base = PETS.answers.map((a) => ({ ...a }));
    const cyclic = base.map((a) => (a.grid === "RABBIT" ? { ...a, parent: id("DOG") } : a));
    expect(rule(validateUnlockGraph(cyclic, PETS.start), "acyclic")).toBe(false);
    const orphan = base.map((a) => (a.grid === "DOG" ? { ...a, parent: "zz" } : a));
    expect(rule(validateUnlockGraph(orphan, PETS.start), "parents-exist")).toBe(false);
    const twoRoots = base.map((a) => (a.grid === "CAT" ? { ...a, parent: null } : a));
    expect(rule(validateUnlockGraph(twoRoots, PETS.start), "single-start")).toBe(false);
  });

  it("rejects a parent the child doesn't cross", () => {
    const bad = PETS.answers.map((a) => (a.grid === "DOG" ? { ...a, parent: id("HAMSTER") } : a));
    expect(rule(validateUnlockGraph(bad, PETS.start), "parent-intersects")).toBe(false);
  });

  it("rejects a hidden answer that would show through its neighbours early", () => {
    //   S T A I R      PEA (row 2) is hidden until TOE is solved, but once
    //   . O . . I      STAIR, RIVER and TAR are solved, TOE and ART are both
    //   P E A . V      visible: PEA's E and A sit side by side on the board
    //   . . R . E      before PEA unlocks.
    //   . . T A R
    const grid = [
      { ...across("s", "STAIR", 0, 0), parent: null },
      { ...down("toe", "TOE", 0, 1), parent: "s" },
      { ...down("river", "RIVER", 0, 4), parent: "s" },
      { ...across("tar", "TAR", 4, 2), parent: "river" },
      { ...down("art", "ART", 2, 2), parent: "tar" },
      { ...across("pea", "PEA", 2, 0), parent: "toe" },
    ];
    expect(allPass(validateLayout(grid))).toBe(true);
    const res = validateUnlockGraph(grid, "s");
    expect(rule(res, "no-premature-reveal")).toBe(false);
    expect(res.find((r) => r.rule === "no-premature-reveal")?.detail).toContain("pea");
    // The canonical fixture never leaks.
    expect(rule(validateUnlockGraph(PETS.answers, PETS.start), "no-premature-reveal")).toBe(true);
  });
});

// ── Crossword validity ───────────────────────────────────────────────────

describe("crossword validity", () => {
  const legal = [
    across("a", "CAT", 0, 0),
    down("b", "ART", 0, 1),
    across("c", "TOE", 2, 1),
    down("d", "EAR", 2, 3),
  ];

  it("accepts a matching intersection", () => {
    expect(allPass(validateLayout(legal))).toBe(true);
  });
  it("rejects a conflicting intersection", () => {
    const bad = [
      across("a", "CAT", 0, 0),
      down("b", "ORE", 0, 1),
      across("c", "EEL", 2, 1),
      down("d", "LAP", 2, 3),
    ];
    expect(rule(validateLayout(bad), "matching-intersections")).toBe(false);
  });
  it("rejects overlap and embedding in the same direction", () => {
    const overlap = [...legal, across("e", "ATE", 0, 1)];
    expect(rule(validateLayout(overlap), "one-answer-per-direction")).toBe(false);
  });
  it("rejects side-by-side words that spell accidental runs", () => {
    const side = [across("a", "CAT", 0, 0), across("b", "DOG", 1, 0), down("c", "CD", 0, 0)];
    const res = validateLayout(side);
    expect(rule(res, "runs-are-answers")).toBe(false);
  });
  it("rejects an accidental two-letter sequence", () => {
    const res = validateLayout([
      ...legal.slice(0, 3),
      down("d", "EAR", 2, 3),
      across("e", "RAN", 5, 0),
    ]);
    expect(rule(res, "connected")).toBe(false);
    const touching = [across("a", "CAT", 0, 0), down("b", "ART", 0, 1), across("x", "TOP", 3, 1)];
    expect(rule(validateLayout(touching), "runs-are-answers")).toBe(false);
  });
  it("rejects an answer extended by a neighbouring letter", () => {
    const ext = [...legal, across("e", "SHE", 0, 3)];
    expect(rule(validateLayout(ext), "runs-are-answers")).toBe(false);
  });
  it("rejects disconnected islands", () => {
    const islands = [...legal.slice(0, 2), across("x", "DOG", 6, 6), down("y", "DIG", 6, 6)];
    expect(rule(validateLayout(islands), "connected")).toBe(false);
  });
  it("rejects a pair that shares more than one cell", () => {
    // Perpendicular words can share at most one cell, so only an overlap can.
    const res = validateLayout([...legal, across("e", "ATE", 0, 1)]);
    expect(rule(res, "cross-at-most-once")).toBe(false);
    // A closed ring is legal: each pair still crosses once.
    const ring = [
      across("a", "CAT", 0, 0),
      down("b", "COD", 0, 0),
      down("c", "TOE", 0, 2),
      across("d", "DOE", 2, 0),
    ];
    expect(rule(validateLayout(ring), "cross-at-most-once")).toBe(true);
  });
  it("rejects a cell holding more than two answers", () => {
    const three = [...legal, down("z", "ACT", 0, 1)];
    expect(rule(validateLayout(three), "one-answer-per-direction")).toBe(false);
  });
  it("rejects a layout outside the supported bounds", () => {
    const wide = [
      across("a", "ABCDEFGHIJ", 0, 0),
      down("b", "JKLMNOPQRS", 0, 9),
      across("c", "STUVW", 9, 9),
      down("d", "WXYZA", 9, 13),
    ];
    expect(rule(validateLayout(wide), "within-bounds")).toBe(false);
    expect(rule(validateLayout(legal, { rows: 9, cols: 9 }), "within-bounds")).toBe(false);
  });
  it("orphan cells can't exist in a valid layout", () => {
    expect(rule(validateLayout(legal), "no-orphan-cells")).toBe(true);
  });
});

// ── Construction ─────────────────────────────────────────────────────────

describe("construction", () => {
  const words = ["HAMSTER", "RABBIT", "CAT", "BIRD", "DOG"].map((g) => ({ id: g, grid: g }));
  it("is deterministic and only returns legal layouts", () => {
    const a = constructLayouts(words, { seed: 7, start: "HAMSTER" });
    const b = constructLayouts(words, { seed: 7, start: "HAMSTER" });
    expect(a.layouts).toEqual(b.layouts);
    expect(a.layouts.length).toBeGreaterThan(0);
    for (const l of a.layouts) expect(allPass(validateLayout(l))).toBe(true);
  });
  it("builds wide and deep unlock trees that validate", () => {
    const [layout] = constructLayouts(words, { seed: 3, start: "HAMSTER" }).layouts;
    for (const shape of ["wide", "deep"] as const) {
      const tree = buildUnlockTree(layout, "HAMSTER", shape, mulberry32(1));
      expect(allPass(validateUnlockGraph(tree, "HAMSTER"))).toBe(true);
    }
  });
});

// ── Hints ────────────────────────────────────────────────────────────────

describe("hints", () => {
  const ready = (s: WordWebState) => ({
    ...s,
    hintCooldownMs: 0,
  });

  it("waits ten seconds on the active word", () => {
    let s = fresh();
    expect(s.hintCooldownMs).toBe(HINT_COOLDOWN_MS);
    s = tick(s, 9_000);
    expect(hintStatus(PETS, s)).toMatchObject({
      available: false,
      reason: "cooldown",
      remainingMs: 1_000,
    });
    s = tick(s, 1_000);
    expect(hintStatus(PETS, s).available).toBe(true);
  });

  it("is one timer for the whole puzzle: switching words doesn't pause or reset it", () => {
    let s = solve(solve(fresh(), "HAMSTER"), "RABBIT");
    // Solving words doesn't restart it either: 0 ms of play so far, so it's still 10 s.
    expect(s.hintCooldownMs).toBe(HINT_COOLDOWN_MS);
    s = tick(s, 4_000); // BIRD active
    s = selectAnswer(PETS, s, id("CAT"));
    expect(hintStatus(PETS, s).remainingMs).toBe(6_000);
    s = tick(s, 3_000);
    s = selectAnswer(PETS, s, id("BIRD"));
    expect(hintStatus(PETS, s).remainingMs).toBe(3_000);
    s = tick(s, 3_000);
    expect(hintStatus(PETS, s).available).toBe(true);
    s = takeHint(PETS, s).state;
    s = selectAnswer(PETS, s, id("CAT"));
    expect(hintStatus(PETS, s).remainingMs).toBe(HINT_COOLDOWN_MS);
  });

  it("reveals left to right across and top to bottom down, never the final letter", () => {
    let s = ready(fresh());
    const order: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = takeHint(PETS, ready(s));
      if (res.index === null) break;
      order.push(res.index);
      s = res.state;
    }
    // HAMSTER: T (index 4) is given; hints fill 0,1,2,3,5 and leave 6.
    expect(order).toEqual([0, 1, 2, 3, 5]);
    expect(hintStatus(PETS, ready(s))).toMatchObject({ available: false, reason: "final-letter" });

    let r = solve(fresh(), "HAMSTER"); // RABBIT active, A fixed by HAMSTER
    r = takeHint(PETS, ready(r)).state;
    expect([...r.hinted]).toEqual(["0,2"]); // R, the top cell
    r = takeHint(PETS, ready(r)).state;
    expect([...r.hinted]).toEqual(["0,2", "2,2"]); // skips the A at 1,2
  });

  it("counts hints, not guesses, and resets the cooldown", () => {
    const res = takeHint(PETS, ready(fresh()));
    expect(res.state.hintsUsed).toBe(1);
    expect(res.state.guessCount).toBe(0);
    expect(res.state.hintCooldownMs).toBe(HINT_COOLDOWN_MS);
  });

  it("ignores a second click before the cooldown restarts", () => {
    const once = takeHint(PETS, ready(fresh())).state;
    const again = takeHint(PETS, once);
    expect(again.index).toBeNull();
    expect(again.state).toBe(once);
  });

  it("the next hint letter survives a refresh", () => {
    const s = takeHint(PETS, ready(fresh())).state;
    const restored = restoreState(JSON.parse(JSON.stringify(s)), PETS, DATE);
    expect(restored.hinted).toEqual(s.hinted);
    expect(hintStatus(PETS, ready(restored)).nextIndex).toBe(hintStatus(PETS, ready(s)).nextIndex);
  });

  it("never hints a word with only one unknown letter (crossings count as known)", () => {
    let s = solve(solve(solve(fresh(), "HAMSTER"), "RABBIT"), "BIRD");
    s = selectAnswer(PETS, s, id("CAT")); // T fixed by RABBIT; C, A unknown
    expect(hintStatus(PETS, ready(s)).available).toBe(true);
    s = takeHint(PETS, ready(s)).state;
    expect(hintStatus(PETS, ready(s)).reason).toBe("final-letter");
    expect(fixedCells(PETS, s).get("5,0")).toBe("C");
  });

  it("starting letters and crossings aren't counted as hints", () => {
    const s = solve(fresh(), "HAMSTER");
    expect(s.hintsUsed).toBe(0);
    expect(currentLetters(PETS, s, id("RABBIT"))).toEqual(["", "A", "", "", "", ""]);
  });
});

// ── Timer ────────────────────────────────────────────────────────────────

describe("active-play clock", () => {
  const fake = () => {
    let t = 0;
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
  };

  it("counts while running and stops while paused (hidden tab, navigation)", () => {
    const f = fake();
    const c = createActiveClock(f.now);
    c.resume();
    f.advance(1000);
    expect(c.take()).toBe(1000);
    c.pause(); // tab hidden
    f.advance(60_000);
    expect(c.take()).toBe(0);
    c.resume(); // back
    f.advance(500);
    expect(c.take()).toBe(500);
  });

  it("keeps the time up to a pause for the next take", () => {
    const f = fake();
    const c = createActiveClock(f.now);
    c.resume();
    f.advance(700);
    c.pause();
    expect(c.take()).toBe(700);
  });

  it("caps one step so a sleeping device can't add minutes", () => {
    const f = fake();
    const c = createActiveClock(f.now);
    c.resume();
    f.advance(10 * 60_000);
    expect(c.take()).toBe(MAX_STEP_MS);
  });

  it("resume is idempotent, so a second start can't double-count", () => {
    const f = fake();
    const c = createActiveClock(f.now);
    c.resume();
    f.advance(400);
    c.resume();
    f.advance(600);
    expect(c.take()).toBe(1000);
  });

  it("persists elapsed time across a refresh and stops at completion", () => {
    let s = tick(fresh(), 5_000);
    s = restoreState(JSON.parse(JSON.stringify(s)), PETS, DATE);
    expect(s.elapsedMs).toBe(5_000);
    for (const g of ["HAMSTER", "RABBIT", "CAT", "BIRD", "DOG"]) s = solve(s, g);
    expect(tick(s, 9_000).elapsedMs).toBe(5_000);
    expect(s.result?.elapsedMs).toBe(5_000);
  });
});

// ── Persistence ──────────────────────────────────────────────────────────

describe("persistence", () => {
  const roundTrip = (s: WordWebState) => JSON.parse(JSON.stringify(s));

  it("restores answers, typed letters, hints and the active word", () => {
    let s = solve(fresh(), "HAMSTER");
    s = typeLetter(PETS, s, "R")?.state as WordWebState;
    const back = restoreState(roundTrip(s), PETS, DATE);
    expect(back.solved).toEqual(s.solved);
    expect(back.typed).toEqual(s.typed);
    expect(back.active).toBe(s.active);
    expect(back.schemaVersion).toBe(1);
  });

  it("never applies another date's or another puzzle's state", () => {
    const s = solve(fresh(), "HAMSTER");
    expect(restoreState(roundTrip(s), PETS, addDays(DATE, 1)).solved).toEqual([]);
    expect(restoreState({ ...roundTrip(s), puzzleId: "other" }, PETS, DATE).solved).toEqual([]);
    expect(restoreState({ ...roundTrip(s), schemaVersion: 99 }, PETS, DATE).solved).toEqual([]);
    expect(restoreState("garbage", PETS, DATE).solved).toEqual([]);
  });

  it("drops solved answers that skip the unlock order", () => {
    const tampered = { ...roundTrip(fresh()), solved: [id("DOG"), id("HAMSTER")] };
    expect(restoreState(tampered, PETS, DATE).solved).toEqual([id("HAMSTER")]);
  });

  it("preserves the official completed result", () => {
    let s = tick(fresh(), 1000);
    for (const g of ["HAMSTER", "RABBIT", "CAT", "BIRD", "DOG"]) s = solve(s, g);
    const later = restoreState({ ...roundTrip(s), elapsedMs: 99_999 }, PETS, DATE);
    expect(later.done).toBe(true);
    expect(later.result).toEqual(s.result);
  });

  it("works through a storage adapter", async () => {
    const store = createMemoryStorage();
    const s = solve(fresh(), "HAMSTER");
    await store.save("k", s);
    expect(restoreState(await store.load("k"), PETS, DATE).solved).toEqual(s.solved);
  });
});

// ── Sharing ──────────────────────────────────────────────────────────────

describe("share text", () => {
  const finished = () => {
    let s = tick(fresh(), 138_000);
    s = takeHint(PETS, { ...s, hintCooldownMs: 0 }).state;
    s = submitGuess(PETS, s, id("HAMSTER"), "HAMPTER").state;
    for (const g of ["HAMSTER", "RABBIT", "CAT", "BIRD", "DOG"]) s = solve(s, g);
    return s;
  };

  it("has the number, difficulty, squares, hints, time and guesses", () => {
    expect(wordWebShareText(PETS, finished(), "2026-02-11")).toBe(
      ["ATLAS WordWeb 🕸️ #42", "Mon · Easy", "🟨🟩🟩🟩🟩", "1 hint | 2:18 | 6 guesses"].join("\n"),
    );
  });

  it("never includes answers, letters or the category", () => {
    const text = wordWebShareText(PETS, finished(), DATE);
    for (const a of PETS.answers) expect(text.toUpperCase()).not.toContain(a.grid);
    expect(text.toLowerCase()).not.toContain("pets");
    expect(progressionSquares(finished())).toHaveLength(10); // 5 squares, 2 code units each
  });
});

// ── Content checks ───────────────────────────────────────────────────────

describe("safety and content policy", () => {
  it("rejects unsafe categories and answers", () => {
    expect(checkCategorySafety("Casino games").ok).toBe(false);
    expect(checkCategorySafety("Household pets").ok).toBe(true);
    expect(answerPolicyProblem({ display: "Pistol" }, false)).toContain("violence");
  });
  it("rejects brands, proper nouns and general abbreviations", () => {
    expect(answerPolicyProblem({ display: "Frisbee" }, false)).toContain("brand");
    expect(answerPolicyProblem({ display: "Paris", proper: true }, false)).toContain("proper");
    expect(answerPolicyProblem({ display: "NASA", kind: "abbreviation" }, false)).toContain(
      "general",
    );
    expect(answerPolicyProblem({ display: "FSA", kind: "abbreviation" }, true)).toBeNull();
    expect(answerPolicyProblem({ display: "XYZ", kind: "abbreviation" }, true)).toContain(
      "approved",
    );
  });
  it("matches whole words, so SHELL and GLASS are fine", () => {
    expect(answerPolicyProblem({ display: "Shell" }, false)).toBeNull();
    expect(answerPolicyProblem({ display: "Glass" }, false)).toBeNull();
  });
  it("flags near-duplicate answers", () => {
    expect(nearDuplicates(["CAT", "CATS"])).toHaveLength(1);
    expect(nearDuplicates(["FISH", "GOLDFISH"])).toHaveLength(1);
    expect(nearDuplicates(["CAT", "DOG"])).toHaveLength(0);
    expect(nearDuplicates(["DAISY", "DAISIES"])).toHaveLength(1);
  });
});

// ── Difficulty ───────────────────────────────────────────────────────────

describe("difficulty", () => {
  const input = (overrides: Partial<Parameters<typeof difficultyComponents>[0]> = {}) => ({
    answers: PETS.answers,
    start: PETS.start,
    revealed: PETS.revealed,
    breadth: 0.1,
    ambiguity: 0.4,
    actuarial: false,
    ...overrides,
  });

  it("weights sum to 100 and every weekday has a band", () => {
    expect(Object.values(DIFFICULTY_WEIGHTS).reduce((t, w) => t + w, 0)).toBe(100);
    for (let d = 0; d < 7; d++) expect(WEEKDAY_TARGETS[d as 0]).toBeDefined();
    expect(WEEKDAY_TARGETS[1].range[0]).toBeLessThan(WEEKDAY_TARGETS[0].range[0]);
  });

  it("the canonical fixture sits in Monday's band and outside Sunday's", () => {
    expect(inTarget(scoreDifficulty(input(), 1))).toBe(true);
    expect(inTarget(scoreDifficulty(input(), 0))).toBe(false);
  });

  it("more starting letters make it easier", () => {
    const one = scoreDifficulty(input(), 1).score;
    const two = scoreDifficulty(input({ revealed: [2, 4] }), 1).score;
    expect(two).toBeLessThan(one);
  });

  it("depth and branching add difficulty", () => {
    const stats = treeStats(PETS.answers);
    expect(stats.depth).toBe(3);
    expect(stats.maxBranch).toBe(2);
    expect(difficultyComponents(input()).depth).toBeGreaterThan(0);
  });

  it("lower familiarity and more alternates add difficulty", () => {
    const base = scoreDifficulty(input(), 1).score;
    const obscure = scoreDifficulty(
      input({ answers: PETS.answers.map((a) => ({ ...a, familiarity: 2 })) }),
      1,
    ).score;
    const ambiguous = scoreDifficulty(
      input({
        answers: PETS.answers.map((a) => ({ ...a, alternates: ["AAA", "BBB", "CCC", "DDD"] })),
        ambiguity: 0.9,
      }),
      1,
    ).score;
    expect(obscure).toBeGreaterThan(base);
    expect(ambiguous).toBeGreaterThan(base);
  });
});

// ── Generation, queue and scheduling ─────────────────────────────────────

describe("generation pipeline and queue", () => {
  const gen = createBankGenerator(bank);
  const NOW = "2026-10-29T00:00:00.000Z";

  it("produces a fully validated Monday and Sunday puzzle", async () => {
    for (const date of ["2026-11-02", "2026-11-08"]) {
      const { record } = await generateForDate({ date, generator: gen, history: [], now: NOW });
      expect(record).not.toBeNull();
      const r = record as NonNullable<typeof record>;
      expect(() => parseWordWebPuzzle(r.puzzle)).not.toThrow();
      expect(inTarget(r.validation.difficulty)).toBe(true);
      expect(r.puzzle.answers.length).toBeGreaterThanOrEqual(
        WEEKDAY_TARGETS[weekday(date) as 0].answers[0],
      );
      expect(r.puzzle.revealed).toHaveLength(WEEKDAY_TARGETS[weekday(date) as 0].revealed);
      expect(r.answers.every((a) => a.fit.length >= 10)).toBe(true);
      expect(allPass(r.validation.safety)).toBe(true);
    }
  });

  it("is deterministic for a date", async () => {
    const a = await generateForDate({ date: "2026-11-04", generator: gen, history: [], now: NOW });
    const b = await generateForDate({ date: "2026-11-04", generator: gen, history: [], now: NOW });
    expect(a.record).toEqual(b.record);
  });

  it("fills the queue, respects recurrence and never reassigns a date", async () => {
    const first = await planQueue({
      queue: emptyQueue(),
      from: "2026-11-02",
      days: 14,
      generator: gen,
      now: NOW,
    });
    expect(first.added).toHaveLength(14);
    const history = historyFromQueue(first.queue);
    for (const h of history) {
      const others = history.filter((o) => o.date !== h.date);
      expect(allPass(checkRecurrence({ ...h }, others))).toBe(true);
    }
    const again = await planQueue({
      queue: first.queue,
      from: "2026-11-02",
      days: 18,
      generator: gen,
      now: "later",
    });
    expect(again.added).toEqual(Array.from({ length: 4 }, (_, i) => addDays("2026-11-16", i)));
    for (const d of first.added) expect(again.queue.days[d]).toBe(first.queue.days[d]);
  });

  it("retries, then reports a failed date instead of publishing anything", async () => {
    const empty: WordWebGenerator = { name: "empty", version: "0", propose: async () => null };
    const res = await planQueue({
      queue: emptyQueue(),
      from: "2026-11-02",
      days: 2,
      generator: empty,
    });
    expect(res.added).toEqual([]);
    expect(res.failed.map((f) => f.date)).toEqual(["2026-11-02", "2026-11-03"]);
    let calls = 0;
    const unsafe: WordWebGenerator = {
      name: "unsafe",
      version: "0",
      propose: async () => {
        calls++;
        return {
          categoryId: "x",
          category: "Casino games",
          group: "g",
          actuarial: false,
          breadth: 0.2,
          ambiguity: 0.2,
          answers: [],
          alsoValid: [],
        };
      },
    };
    const r2 = await generateForDate({
      date: "2026-11-02",
      generator: unsafe,
      history: [],
      maxAttempts: 3,
    });
    expect(r2.record).toBeNull();
    expect(calls).toBe(3);
  });

  it("serves the scheduled puzzle, then evergreen, then the fixture", () => {
    const q = emptyQueue();
    expect(recordForDate(q, DATE).source).toBe("fixture");
    q.evergreen.push(HOUSEHOLD_PETS);
    expect(recordForDate(q, DATE).source).toBe("evergreen");
  });

  it("the browser picks by date and skips anything malformed", () => {
    const dated: WordWebPuzzle = { ...PETS, id: "ww-dated", date: DATE };
    const broken = {
      ...PETS,
      id: "bad",
      date: "2026-11-03",
      answers: PETS.answers.map((a) => ({ ...a, row: a.row + 1 })),
    };
    expect(wordWebForDate([dated], DATE).puzzle.id).toBe("ww-dated");
    expect(wordWebForDate([broken], "2026-11-03").source).toBe("fixture");
    expect(wordWebForDate([{ gameType: "assumption_drift" }, PETS], "2026-11-09").source).toBe(
      "evergreen",
    );
  });

  it("drops invalid days from a queue file without losing the rest", () => {
    const good = { ...HOUSEHOLD_PETS, puzzle: { ...PETS, date: DATE } };
    const bad = { ...HOUSEHOLD_PETS, puzzle: { ...PETS, date: "2026-11-03", rows: 2 } };
    const { queue, errors } = parseWordWebQueue({ days: { [DATE]: good, "2026-11-03": bad } });
    expect(Object.keys(queue.days)).toEqual([DATE]);
    expect(errors).toHaveLength(1);
  });

  it("rejects a bank entry without a rationale", () => {
    expect(() =>
      parseBank([
        {
          id: "a",
          category: "A",
          group: "g",
          breadth: 0.1,
          ambiguity: 0.1,
          answers: [{ display: "Cat", fit: "", familiarity: 5 }],
        },
      ]),
    ).toThrow();
  });
});

// ── Daily dates ──────────────────────────────────────────────────────────

describe("daily dates across daylight saving", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });

  it("the local date key follows the wall clock through both DST changes", () => {
    process.env.TZ = "America/New_York";
    expect(localDateKey(new Date("2026-03-08T06:59:00Z"))).toBe("2026-03-08"); // 01:59 EST
    expect(localDateKey(new Date("2026-03-08T07:30:00Z"))).toBe("2026-03-08"); // 03:30 EDT
    expect(localDateKey(new Date("2026-11-01T03:59:00Z"))).toBe("2026-10-31"); // 23:59 EDT
    expect(localDateKey(new Date("2026-11-01T04:00:00Z"))).toBe("2026-11-01"); // 00:00 EDT
    expect(localDateKey(new Date("2026-11-02T04:59:00Z"))).toBe("2026-11-01"); // 23:59 EST
    expect(localDateKey(new Date("2026-11-02T05:00:00Z"))).toBe("2026-11-02"); // 00:00 EST
  });

  it("date arithmetic and weekdays don't depend on offsets", () => {
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
    expect(weekday("2026-03-08")).toBe(0);
    expect(weekday("2026-11-02")).toBe(1);
  });
});

// ── Server replay ────────────────────────────────────────────────────────

describe("proof replay", () => {
  it("recomputes hints and guesses from the log", () => {
    let s = takeHint(PETS, { ...fresh(), hintCooldownMs: 0 }).state;
    s = submitGuess(PETS, s, id("HAMSTER"), "HAMPTER").state;
    for (const g of ["HAMSTER", "RABBIT", "CAT", "BIRD", "DOG"]) s = solve(s, g);
    expect(replayLog(PETS, s.log)).toEqual({ hintsUsed: 1, guessCount: 6 });
  });
  it("rejects an unfinished or forged log", () => {
    expect(replayLog(PETS, [["g", id("HAMSTER"), "HAMSTER"]])).toBeNull();
    expect(replayLog(PETS, [["g", id("DOG"), "DOG"]])).toBeNull();
    expect(replayLog(PETS, "nope")).toBeNull();
  });
});

describe("evergreen fallbacks", () => {
  it("prefer the same weekday and drop the date", () => {
    const monday = toEvergreen({
      ...HOUSEHOLD_PETS,
      puzzle: { ...PETS, id: "ww-2026-11-02-household-pets", date: "2026-11-02" },
    });
    expect(monday.puzzle.date).toBeNull();
    expect(monday.puzzle.id).toBe("ww-evergreen-household-pets");
    const friday = {
      ...monday,
      puzzle: { ...monday.puzzle, id: "ww-evergreen-fri", weekday: 5 as const },
    };
    const q = { ...emptyQueue(), evergreen: [monday, friday] };
    expect(recordForDate(q, "2026-11-06").record.puzzle.id).toBe("ww-evergreen-fri");
    expect(recordForDate(q, "2026-11-09").record.puzzle.id).toBe("ww-evergreen-household-pets");
  });
});
