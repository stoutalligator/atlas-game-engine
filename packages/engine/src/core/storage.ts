import { addDays } from "./daily.js";
import type { GameHistory, GameId, GameStats, GameStorage } from "./types.js";

const PREFIX = "atlas-games:v2";

export const progressKey = (gameId: GameId, date: string) => `${PREFIX}:${gameId}:${date}`;
export const historyKey = (gameId: GameId) => `${PREFIX}:${gameId}:history`;

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Default storage: the browser's localStorage (no-ops where unavailable). */
export const localStorageAdapter: GameStorage = {
  async load<T>(key: string) {
    const ls = safeLocalStorage();
    if (!ls) return null;
    try {
      const raw = ls.getItem(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  },
  async save(key, value) {
    try {
      safeLocalStorage()?.setItem(key, JSON.stringify(value));
    } catch {
      // Quota or privacy mode — progress just won't persist.
    }
  },
  async remove(key) {
    try {
      safeLocalStorage()?.removeItem(key);
    } catch {
      // ignore
    }
  },
};

/** In-memory storage, handy for tests and previews. */
export function createMemoryStorage(): GameStorage {
  const map = new Map<string, string>();
  return {
    async load<T>(key: string) {
      const raw = map.get(key);
      return raw === undefined ? null : (JSON.parse(raw) as T);
    },
    async save(key, value) {
      map.set(key, JSON.stringify(value));
    },
    async remove(key) {
      map.delete(key);
    },
  };
}

export function computeStats(history: GameHistory, today: string): GameStats {
  const dates = Object.keys(history).sort();
  const played = dates.length;
  const solved = dates.filter((d) => history[d].solved).length;

  let maxStreak = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of dates) {
    if (!history[d].solved) {
      run = 0;
    } else {
      run = prev !== null && addDays(prev, 1) === d && history[prev].solved ? run + 1 : 1;
    }
    maxStreak = Math.max(maxStreak, run);
    prev = d;
  }

  // A streak stays alive until a full day is missed.
  let currentStreak = 0;
  let cursor = history[today]?.solved ? today : addDays(today, -1);
  while (history[cursor]?.solved) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  return {
    played,
    solved,
    solveRate: played ? Math.round((solved / played) * 100) : 0,
    currentStreak,
    maxStreak,
  };
}

export type DailyStatus = "new" | "in-progress" | "solved" | "finished";

/**
 * Synchronous localStorage read of today's status — for dashboard badges.
 * Only reflects the default localStorage adapter.
 */
export function readDailyStatus(gameId: GameId, date: string): DailyStatus {
  const ls = safeLocalStorage();
  if (!ls) return "new";
  try {
    const history = JSON.parse(ls.getItem(historyKey(gameId)) ?? "{}") as GameHistory;
    const entry = history[date];
    if (entry) return entry.solved ? "solved" : "finished";
    return ls.getItem(progressKey(gameId, date)) ? "in-progress" : "new";
  } catch {
    return "new";
  }
}

export function readStreak(gameId: GameId, date: string): number {
  const ls = safeLocalStorage();
  if (!ls) return 0;
  try {
    const history = JSON.parse(ls.getItem(historyKey(gameId)) ?? "{}") as GameHistory;
    return computeStats(history, date).currentStreak;
  } catch {
    return 0;
  }
}
