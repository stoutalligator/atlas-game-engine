// The tutorial's practice puzzle: complete a circle. Scored in the browser
// and never saved, so it can't touch daily scores or leaderboards.

import type { DoodlePath, DoodleSource, DoodleVariant } from "./types.js";

const circle = (cx: number, cy: number, r: number, n = 48): DoodlePath => {
  const pts: DoodlePath = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([
      Math.round((cx + r * Math.cos(a)) * 10) / 10,
      Math.round((cy + r * Math.sin(a)) * 10) / 10,
    ]);
  }
  pts[n] = pts[0];
  return pts;
};

export const DOODLE_PRACTICE_SOURCE: DoodleSource = {
  id: "practice-circle",
  type: "shape",
  category: "practice",
  title: "a circle",
  height: 700,
  paths: [circle(500, 350, 250)],
  provenance: {
    method: "manual",
    source: "Doodle tutorial",
    license: "Original (ATLAS)",
    checkedBy: "ATLAS",
  },
};

/** The right half hidden: about 50% visible. */
export const DOODLE_PRACTICE_VARIANT: DoodleVariant = {
  id: "practice-circle~side-right-50",
  sourceId: "practice-circle",
  difficulty: "easy",
  mask: { rects: [{ x: 495, y: 55, w: 310, h: 590 }], strategy: "side-right" },
  metrics: { visibility: 0.5, missingLength: 780, detail: 0.4, missingRuns: 1, regionShare: 0.25 },
};
