// Presentation for a pack: words, an art style and a palette key. The rules
// never read this, so a new setting (a Mediterranean coast, an asteroid belt)
// is a new theme entry + CSS palette (+ art style, if the shapes change), not a
// new game.

/** Which shapes decorate the chart: palms and coral, or pines and icebergs. */
export type SeafarerArt = "tropical" | "polar";

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
      stuck:
        "You can't finish from here: the drift, a blizzard or your provisions won't allow it. Return to harbor to start over.",
    },
  },
};

export function themeFor(id: string): SeafarerTheme {
  return SEAFARER_THEMES[id] ?? SEAFARER_THEMES["shattered-isles"];
}
