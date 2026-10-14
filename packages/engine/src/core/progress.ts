import { useCallback, useEffect, useRef, useState } from "react";
import { localDateKey } from "./daily.js";
import { computeStats, historyKey, localStorageAdapter, progressKey } from "./storage.js";
import type {
  GameHistory,
  GameId,
  GameResult,
  GameStats,
  GameStorage,
  HistoryEntry,
} from "./types.js";

/**
 * Resolves the puzzle date. Without an explicit date this is the player's local
 * date, which is only known in the browser — so it's null on the server and
 * during hydration, and games render a placeholder until then.
 */
export function usePuzzleDate(date?: string): string | null {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    if (!date) setLocal(localDateKey());
  }, [date]);
  return date ?? local;
}

type Updater<T> = T | ((prev: T) => T);

export interface DailyProgress<T> {
  /** null until the saved state has loaded. */
  state: T | null;
  setState: (next: Updater<T>) => void;
  stats: GameStats;
  /** Writes today's entry to the player's history (streaks, solve rate). */
  recordHistory: (entry: HistoryEntry) => void;
}

/** Loads, saves and tracks history for one game on one date. */
export function useDailyProgress<T>(
  gameId: GameId,
  date: string,
  storage: GameStorage | undefined,
  initial: () => T,
): DailyProgress<T> {
  const store = storage ?? localStorageAdapter;
  const [state, setRawState] = useState<T | null>(null);
  const [history, setHistory] = useState<GameHistory>({});
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const key = progressKey(gameId, date);

  useEffect(() => {
    let cancelled = false;
    setRawState(null);
    Promise.all([store.load<T>(key), store.load<GameHistory>(historyKey(gameId))]).then(
      ([saved, hist]) => {
        if (cancelled) return;
        setRawState(saved ?? initialRef.current());
        setHistory(hist ?? {});
      },
    );
    return () => {
      cancelled = true;
    };
  }, [store, key, gameId]);

  const setState = useCallback(
    (next: Updater<T>) => {
      setRawState((prev) => {
        if (prev === null) return prev;
        const value = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        if (value !== prev) void store.save(key, value);
        return value;
      });
    },
    [store, key],
  );

  const recordHistory = useCallback(
    (entry: HistoryEntry) => {
      setHistory((prev) => {
        const nextHistory = { ...prev, [date]: entry };
        void store.save(historyKey(gameId), nextHistory);
        return nextHistory;
      });
    },
    [store, gameId, date],
  );

  return { state, setState, stats: computeStats(history, date), recordHistory };
}

/** Calls `onTick` every second while `active` and the tab is visible. */
export function useTicker(active: boolean, onTick: () => void): void {
  const tickRef = useRef(onTick);
  tickRef.current = onTick;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") tickRef.current();
    }, 1000);
    return () => window.clearInterval(id);
  }, [active]);
}

/**
 * Once a result exists: records it in the player's history and fires
 * onComplete (once per mount — so also when reopening a finished puzzle).
 */
export function useCompletion(
  result: GameResult | null,
  onComplete: ((result: GameResult) => void) | undefined,
  recordHistory: (entry: HistoryEntry) => void,
): void {
  const firedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  useEffect(() => {
    if (!result || firedRef.current) return;
    firedRef.current = true;
    recordHistory({ solved: result.solved, durationSec: result.durationSec });
    onCompleteRef.current?.(result);
  }, [result, recordHistory]);
}
