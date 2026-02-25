import type { z } from "zod";
import type {
  AssumptionDriftPackSchema,
  AssumptionDriftQuestionSchema,
  ChoiceSchema,
  GamePackSchema,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Inferred types from Zod schemas
// ---------------------------------------------------------------------------

export type Choice = z.infer<typeof ChoiceSchema>;
export type AssumptionDriftQuestion = z.infer<typeof AssumptionDriftQuestionSchema>;
export type AssumptionDriftPack = z.infer<typeof AssumptionDriftPackSchema>;

/** Union of all supported pack types. Extend as new gameTypes are added. */
export type GamePack = z.infer<typeof GamePackSchema>;

// ---------------------------------------------------------------------------
// Game result
// ---------------------------------------------------------------------------

export interface QuestionResponse {
  questionId: string;
  choiceId: string;
  correct: boolean;
}

export interface GameResult {
  schemaVersion: 1;
  gameType: string;
  gameId: string;
  packId: string;
  startedAt: string; // ISO-8601
  completedAt: string; // ISO-8601
  durationSec: number;
  responses: QuestionResponse[];
  score: number;
  maxScore: number;
  isPerfect: boolean;
  shareText: string;
}

// ---------------------------------------------------------------------------
// Storage adapter
// ---------------------------------------------------------------------------

/**
 * Minimal async storage interface. Implement this to persist game state in
 * any backing store (localStorage, IndexedDB, remote API, etc.).
 *
 * `T` is the persisted state shape — each engine consumer may define its own.
 */
export interface StorageAdapter<T = unknown> {
  load(key: string): Promise<T | null>;
  save(key: string, value: T): Promise<void>;
  clear(key: string): Promise<void>;
}
