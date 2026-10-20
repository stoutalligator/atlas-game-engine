// @stoutalligator/engine/catalog — hook-free metadata and helpers, safe to
// import from React Server Components (game lists, admin pages, routing).

export { GAME_CATALOG, GAME_IDS, getGameInfo, isGameId } from "./catalog.js";
export type { GameAccent, GameInfo } from "./catalog.js";
export { GameIcon } from "./ui/GameIcon.js";
export { EPOCH, formatDateLabel, localDateKey, puzzleNumber } from "./core/daily.js";
export {
  PackError,
  packForDate,
  packSubtitle,
  parseAssumptionDriftPack,
} from "./games/assumption-drift/pack.js";
export type {
  AssumptionDriftPack,
  DriftChoice,
  DriftQuestion,
} from "./games/assumption-drift/pack.js";
export type { GameId } from "./core/types.js";
export { readDailyStatus, readStreak } from "./core/storage.js";
export {
  BLACK_SWAN_MAX_SCORE,
  BLACK_SWAN_PROMPTS,
  BLACK_SWAN_SECONDS,
  BLACK_SWAN_TIERS,
  BlackSwanPackError,
  parseBlackSwanQuestions,
} from "./games/black-swan/logic.js";
export type {
  BlackSwanQuestion,
  BlackSwanSlotResult,
  BlackSwanTierKey,
  GuessMatch,
} from "./games/black-swan/logic.js";
export type { DailyStatus } from "./core/storage.js";
