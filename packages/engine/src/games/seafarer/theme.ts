// Presentation for a pack: words, an art style and a palette key. The rules
// never read this, so a new setting (a Mediterranean coast, an asteroid belt)
// is a new theme entry + CSS palette (+ art style, if the shapes change), not a
// new game.

/**
 * Which shapes decorate the chart: palms and coral (tropical), pines and
 * icebergs (polar), or lighthouses, lantern-lit cottages and glowing rocks (night).
 */
export type SeafarerArt = "tropical" | "polar" | "night";

export interface SeafarerTheme {
  id: string;
  art: SeafarerArt;
  /** Shown with the pack title, e.g. "November Expedition". */
  kicker: string;
  words: {
    day: string;
    days: string;
    harbor: string;
    port: string;
    ports: string;
    cargo: string;
    provisions: string;
    setSail: string;
    /** Short names in the move-cost chip ("+2 days · shallows"). */
    shallowsTag: string;
    currentTag: string;
    /** Legend lines. */
    shallows: string;
    current: string;
    reef: string;
    storm: string;
    /** Route names on the result screen. */
    rideCurrent: string;
    crossShallows: string;
    waitStorm: string;
    /** Hint shown on stormy days. */
    stormHint: string;
    /** Tidal flats: legend line, route name and the hint on tide days. */
    flats: string;
    timeTide: string;
    tideHint: string;
    /** Shown when the voyage can no longer finish. */
    stuck: string;
  };
}

export const SEAFARER_THEMES: Record<string, SeafarerTheme> = {
  "shattered-isles": {
    id: "shattered-isles",
    art: "tropical",
    kicker: "November Expedition",
    words: {
      day: "day",
      days: "days",
      harbor: "harbor",
      port: "port",
      ports: "ports",
      cargo: "cargo",
      provisions: "Provisions",
      setSail: "Set sail",
      shallowsTag: "shallows",
      currentTag: "current",
      shallows: "Shallows: 2 days",
      current: "Current: carries you free",
      reef: "Reefs & islands: blocked",
      storm: "Storm: no entry, drifts 1 hex a day",
      rideCurrent: "Ride the current",
      crossShallows: "Cut through the shallows",
      waitStorm: "Wait out the storm",
      stormHint:
        "Storms drift one hex a day: dashed hexes show tomorrow, faint ones (+2, +3) the days after. Tap your ship to drop anchor and wait.",
      flats: "Tidal flats: open at high tide only",
      timeTide: "Ride the high tide",
      tideHint:
        "The flats are open at high tide only. The tide clock shows the days ahead: cross while it's high, or drop anchor and wait for it.",
      stuck:
        "You can't finish from here: a current, a storm or your provisions won't allow it. Return to harbor to start over.",
    },
  },
  "frozen-passages": {
    id: "frozen-passages",
    art: "polar",
    kicker: "December Expedition",
    words: {
      day: "day",
      days: "days",
      harbor: "harbor",
      port: "port",
      ports: "ports",
      cargo: "cargo",
      provisions: "Provisions",
      setSail: "Set sail",
      shallowsTag: "slush ice",
      currentTag: "the drift",
      shallows: "Slush ice: 2 days",
      current: "Polar drift: carries you free",
      reef: "Icebergs & islands: blocked",
      storm: "Blizzard: no entry, drifts 1 hex a day",
      rideCurrent: "Ride the polar drift",
      crossShallows: "Break through the slush",
      waitStorm: "Wait out the blizzard",
      stormHint:
        "Blizzards drift one hex a day: dashed hexes show tomorrow, faint ones (+2, +3) the days after. Tap your ship to drop anchor and wait.",
      flats: "Tidal ice: open at high tide only",
      timeTide: "Ride the high tide",
      tideHint:
        "The tidal ice is open at high tide only. The tide clock shows the days ahead: cross while it's high, or drop anchor and wait for it.",
      stuck:
        "You can't finish from here: the drift, a blizzard or your provisions won't allow it. Return to harbor to start over.",
    },
  },
};

// January: a night voyage. Same rules; the tide is the month's new mechanic.
SEAFARER_THEMES["lantern-sea"] = {
  id: "lantern-sea",
  art: "night",
  kicker: "January Expedition",
  words: {
    day: "night",
    days: "nights",
    harbor: "harbor",
    port: "port",
    ports: "ports",
    cargo: "cargo",
    provisions: "Lamp oil",
    setSail: "Set sail",
    shallowsTag: "glowing shallows",
    currentTag: "night current",
    shallows: "Glowing shallows: 2 nights",
    current: "Night current: carries you free",
    reef: "Rocks & islands: blocked",
    storm: "Squall: no entry, drifts 1 hex a night",
    rideCurrent: "Ride the night current",
    crossShallows: "Cut through the glowing shallows",
    waitStorm: "Wait out the squall",
    stormHint:
      "Squalls drift one hex a night: dashed hexes show tomorrow, faint ones (+2, +3) the nights after. Tap your ship to drop anchor and wait.",
    flats: "Tidal flats: open at high tide only",
    timeTide: "Ride the high tide",
    tideHint:
      "The flats are open at high tide only. The tide clock shows the nights ahead: cross while it's high, or drop anchor and wait for it.",
    stuck:
      "You can't finish from here: a current, the tide, a squall or your lamp oil won't allow it. Return to harbor to start over.",
  },
};

export function themeFor(id: string): SeafarerTheme {
  return SEAFARER_THEMES[id] ?? SEAFARER_THEMES["shattered-isles"];
}
