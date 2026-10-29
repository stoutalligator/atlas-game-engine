import { useEffect, useRef } from "react";

// Active-play time. The clock only measures while it's running (puzzle open,
// tab visible, not finished) and caps any single step, so a sleeping laptop
// or a throttled background tab can't add minutes. One clock per mounted
// game; resume() is idempotent, so nothing double-counts.

export const MAX_STEP_MS = 2000;

export interface ActiveClock {
  resume(): void;
  /** Stops measuring; the time up to now is kept for the next take(). */
  pause(): void;
  /** Active ms since the last take. */
  take(): number;
  readonly running: boolean;
}

export function createActiveClock(now: () => number, maxStepMs = MAX_STEP_MS): ActiveClock {
  let last: number | null = null;
  let banked = 0;
  const measure = () => {
    if (last === null) return 0;
    const t = now();
    const d = Math.min(Math.max(0, t - last), maxStepMs);
    last = t;
    return d;
  };
  return {
    resume() {
      if (last === null) last = now();
    },
    pause() {
      banked += measure();
      last = null;
    },
    take() {
      const d = banked + measure();
      banked = 0;
      return d;
    },
    get running() {
      return last !== null;
    },
  };
}

/**
 * Feeds active-play time to `onDelta` about once a second while `active`.
 * Pauses when the tab is hidden or the page is being left.
 */
export function useActivePlayClock(
  active: boolean,
  onDelta: (ms: number) => void,
  intervalMs = 1000,
): void {
  const onDeltaRef = useRef(onDelta);
  onDeltaRef.current = onDelta;
  useEffect(() => {
    if (!active) return;
    const clock = createActiveClock(() => performance.now());
    const flush = () => {
      const d = clock.take();
      if (d > 0) onDeltaRef.current(d);
    };
    const sync = () => {
      if (document.visibilityState === "visible") clock.resume();
      else {
        clock.pause();
        flush();
      }
    };
    const leave = () => {
      clock.pause();
      flush();
    };
    sync();
    const id = window.setInterval(flush, intervalMs);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [active, intervalMs]);
}
