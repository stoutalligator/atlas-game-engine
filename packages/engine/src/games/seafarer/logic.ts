// Seafarer's pure, React-free surface: rules, solver, generator, packs.
export type {
  BadgeTierKey,
  Cell as SeafarerCell,
  HexDir,
  Objective,
  Place,
  PlaceKind,
  ReferenceRoute,
  RouteKind,
  SeafarerPack,
  SeafarerProof,
  SeafarerPuzzle,
  Terrain,
} from "./types.js";
export {
  HEX_DIRS,
  buildBoard,
  emptyRoute,
  extendRoute,
  replayRoute,
  scoreRoute,
  starsFor,
  twoStarSlack,
} from "./rules.js";
export type { Board, Leg, RouteState, SeafarerScore, Stars } from "./rules.js";
export { alternativeRoutes, canFinish, routeKind, solve } from "./solver.js";
export type { Solution, SolveOptions } from "./solver.js";
export { generateCandidate, generateCandidates, measure } from "./generator.js";
export type { Candidate, Metrics, Recipe } from "./generator.js";
export {
  FROZEN_PASSAGES,
  LANTERN_SEA,
  SEAFARER_PACKS,
  SHATTERED_ISLES,
  seafarerPack,
  seafarerPuzzle,
} from "./packs/index.js";
export { SEAFARER_THEMES, themeFor } from "./theme.js";
export type { SeafarerTheme } from "./theme.js";
