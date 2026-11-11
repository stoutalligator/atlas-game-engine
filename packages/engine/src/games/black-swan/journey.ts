/**
 * Outlier's journey: the day's score is a distance travelled out from Earth.
 * Rarer answers jump farther; real landmarks mark the way, from the Moon to
 * Andromeda. Pure data and maths, no DOM.
 *
 * Distances are in light-years, rounded to what's commonly cited (several,
 * like Betelgeuse and Polaris, are only known to within a few hundred).
 */
import { BLACK_SWAN_MAX_SCORE, type BlackSwanTierKey } from "./logic.js";

export interface Landmark {
  id: string;
  name: string;
  /** Distance from Earth in light-years. */
  ly: number;
  /** How the distance reads to a player. */
  distance: string;
  fact: string;
  /** Drawn as: a planet/moon, a star, a nebula, a galaxy, or a spacecraft. */
  kind: "moon" | "planet" | "belt" | "craft" | "cloud" | "star" | "nebula" | "galaxy";
  /** Main colour for the little drawing. */
  color: string;
}

export const LANDMARKS: readonly Landmark[] = [
  {
    id: "moon",
    name: "The Moon",
    ly: 4.06e-8,
    distance: "1.3 light-seconds",
    fact: "Light from the Moon reaches you in just over a second.",
    kind: "moon",
    color: "#d9dde8",
  },
  {
    id: "sun",
    name: "The Sun",
    ly: 1.58e-5,
    distance: "8.3 light-minutes",
    fact: "The sunlight you see left the Sun eight minutes ago.",
    kind: "star",
    color: "#ffd166",
  },
  {
    id: "mars",
    name: "Mars",
    ly: 2.4e-5,
    distance: "about 12 light-minutes",
    fact: "A radio message to a Mars rover takes up to 22 minutes to arrive.",
    kind: "planet",
    color: "#e0703f",
  },
  {
    id: "belt",
    name: "The Asteroid Belt",
    ly: 4.3e-5,
    distance: "about 22 light-minutes",
    fact: "Millions of rocks, yet spacecraft cross it without ever coming near one.",
    kind: "belt",
    color: "#b8a58c",
  },
  {
    id: "jupiter",
    name: "Jupiter",
    ly: 8.2e-5,
    distance: "about 43 light-minutes",
    fact: "More than 1,300 Earths would fit inside it.",
    kind: "planet",
    color: "#e3b98a",
  },
  {
    id: "saturn",
    name: "Saturn",
    ly: 1.5e-4,
    distance: "about 80 light-minutes",
    fact: "Its rings are 280,000 km across but mostly under a kilometre thick.",
    kind: "planet",
    color: "#e9d29a",
  },
  {
    id: "neptune",
    name: "Neptune",
    ly: 4.75e-4,
    distance: "about 4 light-hours",
    fact: "One Neptune year lasts 165 Earth years.",
    kind: "planet",
    color: "#5b8cff",
  },
  {
    id: "voyager",
    name: "Voyager 1",
    ly: 2.7e-3,
    distance: "about 1 light-day",
    fact: "Launched in 1977, the farthest human-made object is now a full light-day away.",
    kind: "craft",
    color: "#cfd8ff",
  },
  {
    id: "oort",
    name: "The Oort Cloud",
    ly: 0.5,
    distance: "out to about 1.5 light-years",
    fact: "A shell of icy bodies where long-period comets come from.",
    kind: "cloud",
    color: "#9fb4ff",
  },
  {
    id: "proxima",
    name: "Proxima Centauri",
    ly: 4.24,
    distance: "4.24 light-years",
    fact: "The nearest star to the Sun, a small red dwarf with at least one planet.",
    kind: "star",
    color: "#ff8a6b",
  },
  {
    id: "sirius",
    name: "Sirius",
    ly: 8.6,
    distance: "8.6 light-years",
    fact: "The brightest star in the night sky.",
    kind: "star",
    color: "#cfe3ff",
  },
  {
    id: "vega",
    name: "Vega",
    ly: 25,
    distance: "25 light-years",
    fact: "About 12,000 years from now it will be our pole star.",
    kind: "star",
    color: "#dfe9ff",
  },
  {
    id: "polaris",
    name: "Polaris",
    ly: 430,
    distance: "about 430 light-years",
    fact: "The North Star barely moves in the sky; sailors steered by it for centuries.",
    kind: "star",
    color: "#fff1c9",
  },
  {
    id: "betelgeuse",
    name: "Betelgeuse",
    ly: 550,
    distance: "about 550 light-years",
    fact: "A red supergiant in Orion that will one day explode as a supernova.",
    kind: "star",
    color: "#ff7a45",
  },
  {
    id: "orion",
    name: "The Orion Nebula",
    ly: 1344,
    distance: "1,344 light-years",
    fact: "A stellar nursery you can see with the naked eye as Orion's sword.",
    kind: "nebula",
    color: "#ff6fb5",
  },
  {
    id: "crab",
    name: "The Crab Nebula",
    ly: 6500,
    distance: "about 6,500 light-years",
    fact: "The wreck of a supernova seen from Earth in the year 1054.",
    kind: "nebula",
    color: "#7fe3ff",
  },
  {
    id: "core",
    name: "The Milky Way's centre",
    ly: 26000,
    distance: "about 26,000 light-years",
    fact: "A black hole four million times the Sun's mass sits at its heart.",
    kind: "galaxy",
    color: "#ffd9a0",
  },
  {
    id: "lmc",
    name: "The Large Magellanic Cloud",
    ly: 160000,
    distance: "about 160,000 light-years",
    fact: "A small galaxy orbiting ours, visible from the southern hemisphere.",
    kind: "galaxy",
    color: "#c9d6ff",
  },
  {
    id: "andromeda",
    name: "Andromeda",
    ly: 2.5e6,
    distance: "2.5 million light-years",
    fact: "The most distant thing you can see with the naked eye. It will merge with the Milky Way.",
    kind: "galaxy",
    color: "#d7b8ff",
  },
];

/** How big a jump each tier's answer makes (the day's total is where you end up). */
export const TIER_REGION: Record<BlackSwanTierKey, string> = {
  mode: "A short hop",
  expected: "A leap",
  sigma: "A long jump",
  tail: "A warp",
  swan: "Hyperspace",
};

const LOG_MIN = Math.log10(LANDMARKS[0].ly) - 0.15; // one Mode answer just reaches the Moon
const LOG_MAX = Math.log10(LANDMARKS[LANDMARKS.length - 1].ly); // a perfect day reaches Andromeda

/** Light-years travelled for a score (log scale: every point takes you farther than the last). */
export function distanceForScore(score: number): number {
  if (score <= 0) return 0;
  const f = Math.min(1, score / BLACK_SWAN_MAX_SCORE);
  return 10 ** (LOG_MIN + (LOG_MAX - LOG_MIN) * f);
}

/** Where the sky's camera sits for a score: log10(light-years), a little short of the Moon at 0. */
export function logForScore(score: number): number {
  return score <= 0 ? LOG_MIN - 0.35 : Math.log10(distanceForScore(score));
}

/** 0–1 along the journey for a distance (for drawing the route). */
export function journeyFraction(ly: number): number {
  if (ly <= 0) return 0;
  return Math.max(0, Math.min(1, (Math.log10(ly) - LOG_MIN) / (LOG_MAX - LOG_MIN)));
}

/** The farthest landmark reached at this distance, or null before the Moon. */
export function landmarkAt(ly: number): Landmark | null {
  let best: Landmark | null = null;
  for (const l of LANDMARKS) if (l.ly <= ly) best = l;
  return best;
}

/** Landmarks passed going from one distance to another (nearest first). */
export function landmarksBetween(from: number, to: number): Landmark[] {
  return LANDMARKS.filter((l) => l.ly > from && l.ly <= to);
}

const C_KM_S = 299_792;
const SEC_PER_YEAR = 365.25 * 24 * 3600;

/** A distance the way a person would say it: light-seconds up to millions of light-years. */
export function formatDistance(ly: number): string {
  if (ly <= 0) return "Earth";
  const sec = ly * SEC_PER_YEAR;
  const n = (x: number) =>
    x >= 100 ? Math.round(x).toLocaleString("en-US") : x >= 10 ? x.toFixed(0) : x.toFixed(1);
  if (sec < 60) return `${n(sec)} light-seconds`;
  if (sec < 3600) return `${n(sec / 60)} light-minutes`;
  if (sec < 86400) return `${n(sec / 3600)} light-hours`;
  if (sec < 86400 * 365.25 * 0.5) return `${n(sec / 86400)} light-days`;
  if (ly < 1e6) return `${n(ly)} light-years`;
  return `${(ly / 1e6).toFixed(1)} million light-years`;
}

/** Kilometres, for flavour ("1.3 light-seconds · 384,000 km"). */
export function kilometres(ly: number): number {
  return ly * SEC_PER_YEAR * C_KM_S;
}
