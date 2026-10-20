import type { GameId } from "./core/types.js";

/** Accent colours map to the ATLAS Tailwind palette. */
export type GameAccent = "violet" | "amber" | "cyan" | "emerald" | "slate";

export interface GameInfo {
  id: GameId;
  title: string;
  /** One line for cards. */
  tagline: string;
  /** A sentence or two for the game page header. */
  description: string;
  howToPlay: string[];
  accent: GameAccent;
  /** Typical play time, for cards. */
  minutes: string;
  /** Needs content from the host (Assumption Drift packs, Black Swan questions). */
  needsContent: boolean;
}

export const GAME_CATALOG: readonly GameInfo[] = [
  {
    id: "assumption-drift",
    title: "Assumption Drift",
    tagline: "One assumption shifts. Call the impact.",
    description:
      "Each day a pricing or reserving scenario gets a single assumption change. Predict which way the result moves, then read why.",
    howToPlay: [
      "Read the scenario, then the drift — the one assumption that changes.",
      "Pick the outcome you expect and lock it in. You get one shot.",
      "The explanation shows the reasoning so it sticks for exam day.",
    ],
    accent: "violet",
    minutes: "1 min",
    needsContent: true,
  },
  {
    id: "risk-pool",
    title: "Risk Pool",
    tagline: "Pool policyholders to hit the premium exactly.",
    description:
      "Every policyholder shows their expected claims. Group neighbours into pools that each total exactly the target premium — and leave nobody uninsured.",
    howToPlay: [
      "Drag across neighbouring policyholders (or tap them one by one) to build a pool.",
      "A pool locks in when its claims add up to exactly the target premium.",
      "Every policyholder must end up in exactly one pool. Tap a locked pool to break it up.",
      "Greedy pools can strand a neighbour — plan ahead. Boards grow from 5×5 on Monday to 7×7 on the weekend.",
    ],
    accent: "emerald",
    minutes: "3–6 min",
    needsContent: false,
  },
  {
    id: "box-plot",
    title: "Box Plot",
    tagline: "Fill the grid from the clues to reveal a picture.",
    description:
      "A 10×10 picture logic puzzle. The numbers on each row and column give the runs of filled boxes, in order.",
    howToPlay: [
      "Numbers list the filled runs in that row or column, in order. “3 1” means a run of 3, a gap, then 1.",
      "Fill boxes with the Fill tool. Mark boxes you know are empty with ✕ (right-click also marks).",
      "Drag to paint a whole run. A clue greys out once its line matches.",
      "Every puzzle can be solved by logic alone — no guessing needed.",
    ],
    accent: "cyan",
    minutes: "4–8 min",
    needsContent: false,
  },
  {
    id: "cube-rush",
    title: "Cube Rush",
    tagline: "Slide the cubicles. Get the analyst out by five.",
    description:
      "The office floor is gridlocked. Slide cubicles into open space until the analyst can walk out the exit.",
    howToPlay: [
      "Drag any cubicle, or select it and use the arrow keys. Cubicles slide into empty floor only.",
      "Get the analyst (the dark tile) out through the gap marked EXIT.",
      "Sliding one cubicle any distance counts as one move. Beat par for a perfect day.",
      "Monday is easy, the weekend is hard.",
    ],
    accent: "amber",
    minutes: "2–5 min",
    needsContent: false,
  },
  {
    id: "black-swan",
    title: "Black Swan",
    tagline: "Name the answer nobody else will.",
    description:
      "Five prompts across actuarial, stats, SQL, Python, health and finance. Any accepted answer counts, but the rarer it is among everyone's guesses, the more it scores.",
    howToPlay: [
      "Each prompt has a list of accepted answers. Type one before the 25-second timer runs out.",
      "Not on the list? It shakes and clears — try another while time remains. Typos and short forms are offered as a correction to accept.",
      "Answers are ranked by how often people give them. Tiers shrink toward the tail: the most common 35% are Mode (10 points), then Expected 27% (25), Within σ 20% (50), Tail 12% (100), and the rarest 6% are Black Swans (200).",
      "Rarity blends simulated players with everyone's real answers (credibility weighting), and locks in at midnight.",
    ],
    accent: "slate",
    minutes: "3 min",
    needsContent: true,
  },
];

export const GAME_IDS: readonly GameId[] = GAME_CATALOG.map((g) => g.id);

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

export function getGameInfo(id: GameId): GameInfo {
  const info = GAME_CATALOG.find((g) => g.id === id);
  if (!info) throw new Error(`Unknown game ${id}`);
  return info;
}
