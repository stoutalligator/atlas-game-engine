// @stoutalligator/engine — ATLAS daily games.
// Hosts also import the stylesheet once: import "@stoutalligator/engine/styles.css";
import "./styles/atlas-games.css";

export { AtlasGame, type AtlasGameProps } from "./AtlasGame.js";
export { GAME_CATALOG, GAME_IDS, getGameInfo, isGameId } from "./catalog.js";
export type { GameAccent, GameInfo } from "./catalog.js";
export { GameIcon } from "./ui/GameIcon.js";

// Individual games
export {
  AssumptionDrift,
  type AssumptionDriftProps,
} from "./games/assumption-drift/AssumptionDrift.js";
export { BoxPlot } from "./games/box-plot/BoxPlot.js";
export { CubeRush, cubeRushForDate } from "./games/cube-rush/CubeRush.js";
export { RiskPool } from "./games/risk-pool/RiskPool.js";

// Content + puzzle helpers
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
export { boxPlotForDate } from "./games/box-plot/logic.js";
export { generateRiskPool } from "./games/risk-pool/logic.js";

// Daily calendar, storage and stats
export { EPOCH, formatClock, formatDateLabel, localDateKey, puzzleNumber } from "./core/daily.js";
export {
  computeStats,
  createMemoryStorage,
  localStorageAdapter,
  readDailyStatus,
  readStreak,
} from "./core/storage.js";
export type { DailyStatus } from "./core/storage.js";
export type {
  DailyGameProps,
  GameHistory,
  GameId,
  GameResult,
  GameStat,
  GameStats,
  GameStorage,
  HistoryEntry,
} from "./core/types.js";
