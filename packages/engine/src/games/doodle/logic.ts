// Doodle's pure logic, server- and script-safe (no React).
export * from "./types.js";
export {
  bounds as doodleBounds,
  clipStrokes,
  cutPaths,
  densify,
  eraseStrokes,
  pathLength,
  simplify as simplifyPath,
  roundPath,
  totalLength,
} from "./geometry.js";
export {
  DOODLE_CELL,
  DOODLE_FALLOFF,
  DOODLE_MAX_POINTS,
  DOODLE_MAX_STROKES,
  DOODLE_TOLERANCE,
  type DoodleScore,
  hasInk,
  parseStrokes,
  scoreDoodle,
} from "./score.js";
export {
  buildDoodlePuzzle,
  doodleBar,
  doodleCredit,
  doodleDifficultyLabel,
  doodlePrompt,
  doodleReference,
  doodleShareText,
  labelBox,
  maskRects,
  placeMapLabels,
} from "./puzzle.js";
export {
  DOODLE_BANDS,
  DOODLE_LIMITS,
  DOODLE_MAX_VISIBILITY,
  DOODLE_MIN_VISIBILITY,
  type DoodleCandidate,
  type ValidationResult as DoodleValidation,
  difficultyFor as doodleDifficultyFor,
  doodleCandidates,
  doodleVariantId,
  measureVariant as measureDoodleVariant,
  pickDoodleVariants,
  sourceMirrorAxis as doodleMirrorAxis,
  validateDoodleSource,
  validateDoodleVariant,
} from "./variants.js";
export {
  DOODLE_CATEGORY_GAP,
  DOODLE_FAMILY_GAP,
  DOODLE_INVENTORY,
  DOODLE_SCHEDULE_DAYS,
  DOODLE_SOURCE_COOLDOWN,
  DOODLE_WEEKDAY_DIFFICULTY,
  type DoodleInventoryLevel,
  type DoodlePlan,
  type DoodlePlanOptions,
  type DoodlePoolItem,
  doodleDifficultiesFor,
  doodleInventoryLevel,
  doodleReserveByDifficulty,
  planDoodleSchedule,
} from "./schedule.js";
export { trendSource, trendTicks, type TrendSourceInput } from "./trend.js";
export { DOODLE_PRACTICE_SOURCE, DOODLE_PRACTICE_VARIANT } from "./practice.js";
export {
  DOODLE_ERASER_RADIUS,
  type DrawingAction,
  type DrawingState,
  drawingReducer,
  emptyDrawing,
  finishStroke,
  strokesForSubmit,
  toCanvasUnits,
} from "./drawing.js";
