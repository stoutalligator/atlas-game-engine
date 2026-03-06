// Main entry point — re-export everything consumers need.

export { DailyGame } from "./DailyGame.js";
export { SlidePuzzle, generatePuzzle } from "./games/slide-puzzle/SlidePuzzle.js";
export type { Theme } from "./DailyGame.js";
export { LocalStorageAdapter } from "./storage.js";
export {
  AssumptionDriftPackSchema,
  AssumptionDriftPayloadSchema,
  AssumptionDriftQuestionSchema,
  ChoiceSchema,
  GamePackSchema,
} from "./schemas.js";
export type {
  AssumptionDriftPack,
  AssumptionDriftQuestion,
  Choice,
  GamePack,
  GameResult,
  QuestionResponse,
  StorageAdapter,
} from "./types.js";
