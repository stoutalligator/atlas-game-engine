// The Frozen Passages (December): the same mechanics and difficulty curve as
// the Shattered Isles, in polar waters. Each day reuses November's recipe for
// the same day (so validation is identical) with its own seeds, names, titles
// and tips; ice islands run a little larger. December has 31 days, so day 31
// is a second finale.
//
// Theme mapping (rules unchanged; only words and art differ):
//   islands → snowy islands and pines   reefs → icebergs
//   shallows → slush ice (2 days)        currents → polar drift
//   storms → blizzards

import type { PlaceNames } from "../generator.js";
import type { PackPlan, PlannedDay } from "./plan.js";
import { SHATTERED_ISLES_PLAN } from "./shattered-isles.plan.js";

const NAMES: PlaceNames = {
  ports: [
    "Frostholm",
    "Icewharf",
    "Snowmere",
    "Whitecap",
    "Rimehaven",
    "Glacier Point",
    "Aurora Bay",
    "Northwatch",
    "Pinecrest",
    "Fjord's End",
    "Seal Rock",
    "Coldharbor",
    "Hoarfrost",
    "Starlight Cove",
    "Tern Fjord",
    "Lanternice",
    "Bearpaw",
    "Silverfell",
  ],
  harbors: ["Winter Quay", "Frost Harbor", "Northport", "Lantern Fjord", "Hearthhaven"],
  cargo: [
    "Furs",
    "Pine tar",
    "Salted cod",
    "Wool",
    "Timber",
    "Amber",
    "Lamp oil",
    "Antlers",
    "Cocoa",
  ],
};

const DAYS: Array<{ title: string; tip?: string }> = [
  {
    title: "First Frost",
    tip: "Tap the glowing water beside your ship to sail there. Every move is final.",
  },
  { title: "Snowbound Sound", tip: "Look ahead: there's usually more than one good way through." },
  { title: "The Ice Gate" },
  { title: "Glacier Bay" },
  { title: "Northern Lights" },
  {
    title: "Slush Shoals",
    tip: "Pale, broken water is slush ice: each hex costs 2 days. Is the long way round quicker?",
  },
  { title: "Thin Ice" },
  { title: "Rimefield" },
  { title: "The Frozen Flats" },
  { title: "Floe Reach" },
  {
    title: "Polar Drift",
    tip: "The polar drift carries your ship for free, but you can't sail straight against it.",
  },
  { title: "The Cold Current" },
  { title: "Narwhal Strait" },
  { title: "Driftice Run" },
  { title: "The Long Drift" },
  {
    title: "Two Lanterns",
    tip: "Call at both ports, in either order. A port counts as soon as you pass it.",
  },
  { title: "Trappers' Triangle" },
  { title: "The Fur Lanes" },
  { title: "Walrus Circuit" },
  { title: "Hearthside Tour" },
  {
    title: "First Blizzard",
    tip: "A blizzard drifts one hex a day: you can't sail into it. Tap your own ship to drop anchor and wait a day, or race past it.",
  },
  { title: "Whiteout" },
  { title: "Eye of the Blizzard" },
  { title: "Snowbound Rounds" },
  { title: "Howling Reach" },
  {
    title: "The Ice Merchant",
    tip: "Not enough provisions for every crate. Choose your cargo, and be home before the barrels run dry.",
  },
  { title: "Frostbite Coast" },
  { title: "The Four Beacons" },
  { title: "Last Furs" },
  { title: "The Aurora Crown" },
];

/** The reviewed chart for each day (seeds from the --review build), so rebuilds are exact. */
const PICKS: string[] = [
  "frozen-passages-01-1528",
  "frozen-passages-02-1121",
  "frozen-passages-03-1434",
  "frozen-passages-04-226",
  "frozen-passages-05-523",
  "frozen-passages-06-1760",
  "frozen-passages-07-360",
  "frozen-passages-08-1708",
  "frozen-passages-09-668",
  "frozen-passages-10-1447",
  "frozen-passages-11-4870",
  "frozen-passages-12-4738",
  "frozen-passages-13-4966",
  "frozen-passages-14-5127",
  "frozen-passages-15-4190",
  "frozen-passages-16-4023",
  "frozen-passages-17-4901",
  "frozen-passages-18-1663",
  "frozen-passages-19-2664",
  "frozen-passages-20-2284",
  "frozen-passages-21-2016",
  "frozen-passages-22-4620",
  "frozen-passages-23-1600",
  "frozen-passages-24-3103",
  "frozen-passages-25-1535",
  "frozen-passages-26-1667",
  "frozen-passages-27-6415",
  "frozen-passages-28-8081",
  "frozen-passages-29-1504",
  "frozen-passages-30-16881",
  "frozen-passages-31-6939",
];

/** December's day N follows November's day N; day 31 is a second, larger finale. */
const days: PlannedDay[] = SHATTERED_ISLES_PLAN.map((d, i) => ({
  title: DAYS[i].title,
  difficulty: d.difficulty,
  pick: PICKS[i],
  ...(DAYS[i].tip ? { tip: DAYS[i].tip } : {}),
  // Bigger ice islands crowd the charts, so fewer qualify: try more seeds.
  attempts: Math.max(2000, (d.attempts ?? 600) * 2),
  recipe: {
    ...d.recipe,
    names: NAMES,
    // Ice shelves: islands run a little larger.
    islandSize: [d.recipe.islandSize[0] + 1, d.recipe.islandSize[1] + 1] as [number, number],
  },
}));
const finale = SHATTERED_ISLES_PLAN[SHATTERED_ISLES_PLAN.length - 1];
days.push({
  title: "Midwinter Crossing",
  difficulty: 5,
  pick: PICKS[30],
  attempts: finale.attempts,
  recipe: { ...finale.recipe, names: NAMES, storms: [2, 2], minStormCost: 1 },
});

export const FROZEN_PASSAGES_PLAN: PlannedDay[] = days;

export const FROZEN_PASSAGES_PACK_PLAN: PackPlan = {
  id: "frozen-passages",
  title: "The Frozen Passages",
  description:
    "Thirty-one crossings of the polar sea: icebergs, slush ice, the polar drift and midwinter blizzards.",
  theme: "frozen-passages",
  badgeTiers: { bronze: 10, silver: 20, gold: 31 },
  names: NAMES,
  days,
};
