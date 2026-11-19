// A pack plan: the pack's identity plus one recipe per day. The build script
// (scripts/build-seafarer-pack.ts <pack-id>) turns it into pack data.

import type { PlaceNames, Recipe } from "../generator.js";
import type { BadgeTierKey } from "../types.js";

export interface PlannedDay {
  title: string;
  difficulty: number;
  recipe: Recipe;
  tip?: string;
  /** The reviewer's chosen seed for this day; omit to take the top-ranked candidate. */
  pick?: string;
  /** Seeds to try. */
  attempts?: number;
}

export interface PackPlan {
  id: string;
  title: string;
  description: string;
  /** Presentation theme id (theme.ts). */
  theme: string;
  badgeTiers: Record<BadgeTierKey, number>;
  /** Place names; each day's harbor is renamed from these when they'd clash. */
  names: PlaceNames;
  days: PlannedDay[];
}
