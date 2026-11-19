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
    "Icebound Quay",
    "Snowdrift Bay",
    "Walrus Point",
    "Ptarmigan Isle",
    "Hollow Fjord",
    "Frostfern",
    "Kittiwake Rock",
    "Puffin Haven",
    "Bluefrost Cove",
    "Elk Harbor",
    "Glimmerice",
    "Ironbark Pier",
    "Owl's Watch",
    "Ravenhold",
    "Snowberry Cove",
    "Stillwater Fjord",
    "Sledrun",
    "Tundra Quay",
    "Whalebone Bay",
    "Winterset",
    "Crystalmere",
    "Moonice Bay",
    "Lichen Point",
    "Skerry's End",
    "Fur Traders' Rest",
    "Cold Spring",
    "Pale Harbor",
    "Hearthstone Cove",
    "Iceglass",
    "Brightfrost",
    "Seastack Point",
    "Gannet Fjord",
    "Narwhal Rest",
    "Halo Bay",
    "Coldwater Sound",
    "Sealskin Wharf",
    "Firnhaven",
    "Borealis Quay",
    "Glacierfoot",
    "Frostwind",
    "Rime Rock",
    "Tusk Island",
    "Wolfden Cove",
    "Morrow Fjord",
    "Stormwatch",
    "Snowcap Isle",
    "Auk's Ledge",
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
    tip: "Tap the glowing water beside your ship to sail there. Every move is final, and pale slush ice costs 2 days.",
  },
  { title: "Snowbound Sound", tip: "Look ahead: there's usually more than one good way through." },
  { title: "The Ice Gate" },
  { title: "Glacier Bay" },
  { title: "Northern Lights" },
  {
    title: "Slush Shoals",
    tip: "The slush ice thickens from here: 2 days a hex. Is the long way round quicker?",
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
const PICKS: Array<string | undefined> = [
  "frozen-passages-01-5063",
  "frozen-passages-02-2367",
  "frozen-passages-03-5091",
  "frozen-passages-04-5518",
  "frozen-passages-05-291",
  "frozen-passages-06-1411",
  "frozen-passages-07-432",
  "frozen-passages-08-3610",
  "frozen-passages-09-3452",
  "frozen-passages-10-1202",
  "frozen-passages-11-3267",
  "frozen-passages-12-3455",
  "frozen-passages-13-1909",
  "frozen-passages-14-36",
  "frozen-passages-15-609",
  "frozen-passages-16-3391",
  "frozen-passages-17-654",
  "frozen-passages-18-2332",
  "frozen-passages-19-4164",
  "frozen-passages-20-4692",
  "frozen-passages-21-618",
  "frozen-passages-22-4517",
  "frozen-passages-23-3762",
  "frozen-passages-24-5939",
  "frozen-passages-25-7967",
  "frozen-passages-26-5960",
  "frozen-passages-27-5900",
  "frozen-passages-28-5003",
  "frozen-passages-29-3502",
  "frozen-passages-30-16275",
  "frozen-passages-31-9679",
];

/** December's day N follows November's day N; day 31 is a second, larger finale. */
const days: PlannedDay[] = SHATTERED_ISLES_PLAN.map((d, i) => ({
  title: DAYS[i].title,
  difficulty: d.difficulty,
  ...(PICKS[i] ? { pick: PICKS[i] } : {}),
  ...(DAYS[i].tip ? { tip: DAYS[i].tip } : {}),
  // Bigger ice islands crowd the charts, so fewer qualify: try more seeds.
  attempts: Math.round((d.attempts ?? 4000) * 1.5),
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
  ...(PICKS[30] ? { pick: PICKS[30] } : {}),
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
