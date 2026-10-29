import { scoreDifficulty } from "./difficulty.js";
import { checkCategorySafety } from "./safety.js";
import { WORDWEB_SCHEMA_VERSION, type WordWebRecord } from "./types.js";
import { validateLayout, validateStart, validateUnlockGraph } from "./validate.js";

// The canonical HOUSEHOLD PETS puzzle: a permanent validated fixture, the
// playground's default, and the last-resort evergreen fallback.
//
// Progression is exactly as specified:
//   HAMSTER └─ RABBIT ├─ CAT
//                     └─ BIRD └─ DOG
//
// Coordinate adjustment (verified by the validator, see wordweb tests): the
// written geometry — RABBIT rising from HAMSTER's T, CAT straddling RABBIT's
// A, BIRD from the second B, DOG down from D — puts DOG's G directly after
// HAMSTER's final R, spelling "HAMSTERG". BIRD from the first B instead puts
// its I under CAT's T. No legal layout keeps both the T crossing and CAT on
// the A, so RABBIT now crosses HAMSTER at the shared A and CAT ends on
// RABBIT's T. BIRD (second B, across) and DOG (down from D) are unchanged.
// HAMSTER's fifth letter, T, is still the one revealed at the start.
// Alternates are the pets that also fit each space once it appears (same
// length, same letter where it crosses its parent): CANARY/PARROT for
// ?A????, RAT for ??T.
//
//   . . R . . . . .
//   . H A M S T E R
//   . . B . . . . .
//   . . B I R D . .
//   . . I . . O . .
//   C A T . . G . .

const base: WordWebRecord = {
  puzzle: {
    schemaVersion: WORDWEB_SCHEMA_VERSION,
    gameType: "wordweb",
    id: "ww-canonical-household-pets",
    date: null,
    category: "Household pets",
    weekday: 1,
    difficulty: "Easy",
    difficultyScore: 0,
    rows: 6,
    cols: 8,
    start: "a1",
    revealed: [4],
    answers: [
      {
        id: "a1",
        display: "Hamster",
        grid: "HAMSTER",
        row: 1,
        col: 1,
        direction: "across",
        parent: null,
        alternates: [],
        familiarity: 5,
      },
      {
        id: "a2",
        display: "Rabbit",
        grid: "RABBIT",
        row: 0,
        col: 2,
        direction: "down",
        parent: "a1",
        alternates: ["CANARY", "PARROT"],
        familiarity: 5,
      },
      {
        id: "a3",
        display: "Bird",
        grid: "BIRD",
        row: 3,
        col: 2,
        direction: "across",
        parent: "a2",
        alternates: [],
        familiarity: 5,
      },
      {
        id: "a4",
        display: "Dog",
        grid: "DOG",
        row: 3,
        col: 5,
        direction: "down",
        parent: "a3",
        alternates: [],
        familiarity: 5,
      },
      {
        id: "a5",
        display: "Cat",
        grid: "CAT",
        row: 5,
        col: 0,
        direction: "across",
        parent: "a2",
        alternates: ["RAT"],
        familiarity: 5,
      },
    ],
  },
  status: "evergreen",
  categoryId: "household-pets",
  categoryGroup: "animals",
  actuarial: false,
  answers: [
    {
      id: "a1",
      display: "Hamster",
      fit: "A small rodent kept in a cage at home.",
      familiarity: 5,
      kind: "noun",
    },
    {
      id: "a2",
      display: "Rabbit",
      fit: "A common indoor or hutch pet.",
      familiarity: 5,
      kind: "noun",
    },
    {
      id: "a3",
      display: "Bird",
      fit: "Parakeets and canaries are kept as house pets.",
      familiarity: 5,
      kind: "noun",
    },
    {
      id: "a4",
      display: "Dog",
      fit: "The most common household pet.",
      familiarity: 5,
      kind: "noun",
    },
    {
      id: "a5",
      display: "Cat",
      fit: "A common indoor household pet.",
      familiarity: 5,
      kind: "noun",
    },
  ],
  generation: {
    generator: "hand-authored",
    generatorVersion: "canonical",
    pipelineVersion: "wordweb-pipeline/1",
    generatedAt: "2026-10-29T00:00:00.000Z",
    seed: 0,
    attempts: 1,
    constructionAttempts: 0,
    rejected: [],
  },
  // Replaced below with live validator output.
  validation: {
    layout: [],
    graph: [],
    safety: [],
    recurrence: [],
    difficulty: { components: {}, weights: {}, score: 0, target: [0, 100] },
  },
};

const { puzzle } = base;
const difficulty = scoreDifficulty(
  {
    answers: puzzle.answers,
    start: puzzle.start,
    revealed: puzzle.revealed,
    breadth: 0.1,
    ambiguity: 0.4,
    actuarial: false,
  },
  puzzle.weekday,
);

/** The fixture with its validation report computed from the live validators. */
export const HOUSEHOLD_PETS: WordWebRecord = {
  ...base,
  puzzle: { ...puzzle, difficultyScore: difficulty.score },
  validation: {
    layout: validateLayout(puzzle.answers, { rows: puzzle.rows, cols: puzzle.cols }),
    graph: [
      ...validateUnlockGraph(puzzle.answers, puzzle.start),
      validateStart(
        puzzle.answers.find((a) => a.id === puzzle.start),
        puzzle.revealed,
      ),
    ],
    safety: [checkCategorySafety(puzzle.category)],
    recurrence: [],
    difficulty,
  },
};
