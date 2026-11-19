// Every Seafarer pack the engine ships. A pack is content + a theme id; which
// month a pack runs is the host's decision (it can slip a month with no
// engine change).

import type { SeafarerPack, SeafarerPuzzle } from "../types.js";
import { FROZEN_PASSAGES } from "./frozen-passages.js";
import { LANTERN_SEA } from "./lantern-sea.js";
import { SHATTERED_ISLES } from "./shattered-isles.js";

/** In release order. Which month each pack runs is the host's call. */
export const SEAFARER_PACKS: readonly SeafarerPack[] = [
  SHATTERED_ISLES,
  FROZEN_PASSAGES,
  LANTERN_SEA,
];

export function seafarerPack(id: string): SeafarerPack | null {
  return SEAFARER_PACKS.find((p) => p.id === id) ?? null;
}

/** Finds a challenge by its id ("shattered-isles-07") in any pack. */
export function seafarerPuzzle(puzzleId: string): SeafarerPuzzle | null {
  for (const pack of SEAFARER_PACKS) {
    const p = pack.puzzles.find((pz) => pz.id === puzzleId);
    if (p) return p;
  }
  return null;
}

export { FROZEN_PASSAGES, LANTERN_SEA, SHATTERED_ISLES };
