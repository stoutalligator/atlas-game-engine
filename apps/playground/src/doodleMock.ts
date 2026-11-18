// An in-memory stand-in for ATLAS's Doodle server, so the game can be played
// day by day in the playground. It uses a snapshot of ATLAS's real bank
// (packs/doodle_bank.json: atlas content/doodle/sources/*.json plus their cut
// variants; refresh it with `pnpm --filter playground sync:doodle`), treats every generated
// variant as approved, and plans days with the real scheduler — so each date
// shows the puzzle that weekday's rules would pick. A real host keeps the
// answer server-side and scores the submission there (ATLAS:
// src/lib/doodleSubmissions.ts).
import type { DoodleApi, DoodlePath, DoodleResult } from "@stoutalligator/engine";
import {
  type DoodlePoolItem,
  type DoodleSource,
  type DoodleVariant,
  buildDoodlePuzzle,
  doodleCredit,
  doodleDifficultiesFor,
  doodleReference,
  parseStrokes,
  planDoodleSchedule,
  scoreDoodle,
} from "@stoutalligator/engine/server";
import bank from "./packs/doodle_bank.json";

/** The sandbox plans every day of 2026 and 2027 with the real rules (spacing included). */
export const DOODLE_SANDBOX_START = "2026-01-01";
const PLANNED_DAYS = 730;

// Variants are cut when the bank is synced (pickDoodleVariants), not in the browser.
const SNAPSHOT = bank as unknown as { sources: DoodleSource[]; variants: DoodleVariant[] };
const SOURCES = SNAPSHOT.sources;
const byId = new Map(SOURCES.map((s) => [s.id, s]));
const VARIANTS = new Map<string, { source: DoodleSource; variant: DoodleVariant }>();
for (const variant of SNAPSHOT.variants) {
  const source = byId.get(variant.sourceId);
  if (source) VARIANTS.set(variant.id, { source, variant });
}

const POOL: DoodlePoolItem[] = [...VARIANTS.values()].map(({ source, variant }) => ({
  id: variant.id,
  sourceId: source.id,
  difficulty: variant.difficulty,
  category: source.category,
  type: source.type,
  approvedAt: "2026-11-01T00:00:00.000Z",
  family: source.family,
}));

/** What the scheduler planned (until the bank runs dry under the 120-day source cooldown). */
const PLAN = planDoodleSchedule(POOL, { start: DOODLE_SANDBOX_START, days: PLANNED_DAYS });

const hash = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

/** The day's variant: the plan, or (outside it) a stable pick of the weekday's difficulty. */
export function doodleSandboxPick(date: string): {
  source: DoodleSource;
  variant: DoodleVariant;
  planned: boolean;
} {
  const planned = PLAN.schedule[date];
  if (planned)
    return {
      ...(VARIANTS.get(planned) as { source: DoodleSource; variant: DoodleVariant }),
      planned: true,
    };
  const wanted = doodleDifficultiesFor(date);
  const list = POOL.filter((v) => wanted.includes(v.difficulty));
  const pick = list[hash(date) % list.length];
  return {
    ...(VARIANTS.get(pick.id) as { source: DoodleSource; variant: DoodleVariant }),
    planned: false,
  };
}

export const doodleSandboxStats = {
  sources: SOURCES.length,
  variants: POOL.length,
  plannedThrough: PLAN.added[PLAN.added.length - 1] ?? DOODLE_SANDBOX_START,
};

const results = new Map<string, DoodleResult>();

export const doodleMock: DoodleApi = {
  async load(date) {
    const { source, variant } = doodleSandboxPick(date);
    return { date, puzzle: buildDoodlePuzzle(source, variant), result: results.get(date) };
  },
  async submit(date, puzzleId, strokes: DoodlePath[]) {
    const prior = results.get(date);
    if (prior) return prior;
    const { source, variant } = doodleSandboxPick(date);
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
