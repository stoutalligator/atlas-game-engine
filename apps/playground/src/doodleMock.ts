// An in-memory stand-in for the host's Doodle server, so the game can be
// played in the playground. A real host keeps the answer server-side and
// scores the submission there (see ATLAS's src/app/games/doodleActions.ts).
import type { DoodleApi, DoodlePath, DoodleResult } from "@stoutalligator/engine";
import {
  type DoodleSource,
  type DoodleVariant,
  buildDoodlePuzzle,
  doodleCredit,
  doodleReference,
  parseStrokes,
  pickDoodleVariants,
  scoreDoodle,
  trendSource,
} from "@stoutalligator/engine/server";

const provenance = {
  method: "manual" as const,
  source: "Playground sample",
  license: "Original (ATLAS)",
  checkedBy: "playground",
};

const SOURCES: DoodleSource[] = [
  {
    id: "sample-apple",
    type: "shape",
    category: "food",
    title: "an apple",
    height: 900,
    paths: [
      [
        [500, 260],
        [580, 220],
        [680, 225],
        [760, 290],
        [800, 400],
        [790, 530],
        [740, 650],
        [660, 740],
        [580, 760],
        [500, 730],
        [420, 760],
        [340, 740],
        [260, 650],
        [210, 530],
        [200, 400],
        [240, 290],
        [320, 225],
        [420, 220],
        [500, 260],
      ],
      [
        [500, 260],
        [505, 200],
        [520, 150],
      ],
    ],
    provenance,
  },
  trendSource({
    id: "sample-seasonal",
    category: "trends",
    title: "a seasonal search trend (sample data)",
    series: {
      measure: "Sample seasonal interest",
      points: Array.from({ length: 48 }, (_, i) => [
        `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
        Math.round(30 + 60 * Math.max(0, Math.sin((((i % 12) - 2) / 12) * Math.PI * 2))),
      ]) as Array<[string, number]>,
    },
    provenance,
  }),
];

const VARIANTS: Array<{ source: DoodleSource; variant: DoodleVariant }> = SOURCES.flatMap(
  (source) => pickDoodleVariants(source).map((variant) => ({ source, variant })),
);

const dayNum = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
const forDate = (date: string) => VARIANTS[dayNum(date) % VARIANTS.length];
const results = new Map<string, DoodleResult>();

export const doodleMock: DoodleApi = {
  async load(date) {
    const { source, variant } = forDate(date);
    return { date, puzzle: buildDoodlePuzzle(source, variant), result: results.get(date) };
  },
  async submit(date, puzzleId, strokes: DoodlePath[]) {
    const prior = results.get(date);
    if (prior) return prior;
    const { source, variant } = forDate(date);
    if (variant.id !== puzzleId) return null;
    const puzzle = buildDoodlePuzzle(source, variant);
    const parsed = parseStrokes(strokes, puzzle.width, puzzle.height);
    if (!parsed) return null;
    const reference = doodleReference(source, variant);
    const s = scoreDoodle(reference, parsed, puzzle.region, puzzle.width, puzzle.height);
    const r: DoodleResult = { ...s, strokes: parsed, reference, credit: doodleCredit(source) };
    results.set(date, r);
    return r;
  },
};

export const resetDoodleMock = (date: string) => results.delete(date);
