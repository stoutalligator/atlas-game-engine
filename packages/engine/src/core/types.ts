export type GameId = "assumption-drift" | "cube-rush" | "box-plot" | "risk-pool";

export interface GameStat {
  label: string;
  value: string;
}

/** Emitted once when a player finishes today's puzzle (and again on reload of a finished one). */
export interface GameResult {
  gameId: GameId;
  date: string;
  puzzleNumber: number;
  /** false when the player finished without solving (e.g. a wrong Assumption Drift answer). */
  solved: boolean;
  durationSec: number;
  stats: GameStat[];
  shareText: string;
}

/**
 * Where progress and history live. Defaults to localStorage; a host can pass
 * its own (e.g. backed by an API) to sync across devices.
 */
export interface GameStorage {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Props every daily game accepts. */
export interface DailyGameProps {
  /** "YYYY-MM-DD". Defaults to the player's local date. */
  date?: string;
  storage?: GameStorage;
  onComplete?: (result: GameResult) => void;
}

export interface HistoryEntry {
  solved: boolean;
  durationSec: number;
}

export type GameHistory = Record<string, HistoryEntry>;

export interface GameStats {
  played: number;
  solved: number;
  solveRate: number;
  currentStreak: number;
  maxStreak: number;
}
