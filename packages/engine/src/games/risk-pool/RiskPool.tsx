import { type PointerEvent, useMemo, useRef, useState } from "react";
import { formatClock, puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate, useTicker } from "../../core/progress.js";
import { shareText } from "../../core/share.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import {
  type RiskPoolPuzzle,
  generateRiskPool,
  isAdjacent,
  isComplete,
  isConnected,
  nextHint,
  pickPoolColor,
  poolSum,
} from "./logic.js";

interface PoolState {
  pools: number[][];
  /** Colour index per pool. */
  colors: number[];
  /** Pools placed by a hint. */
  hinted: boolean[];
  hints: number;
  breaks: number;
  elapsed: number;
  done: boolean;
}

export function RiskPool({ date: dateProp, storage, onComplete }: DailyGameProps) {
  const date = usePuzzleDate(dateProp);
  if (!date) return <GameLoading />;
  return <RiskPoolGame key={date} date={date} storage={storage} onComplete={onComplete} />;
}

function RiskPoolGame({ date, storage, onComplete }: DailyGameProps & { date: string }) {
  const pz = useMemo(() => generateRiskPool(date), [date]);
  const total = pz.size * pz.size;
  const { state, setState, stats, recordHistory } = useDailyProgress<PoolState>(
    "risk-pool",
    date,
    storage,
    () => ({ pools: [], colors: [], hinted: [], hints: 0, breaks: 0, elapsed: 0, done: false }),
  );
  const [sel, setSelState] = useState<number[]>([]);
  // Mirror of the selection so fast pointer events see each other's changes.
  const selRef = useRef<number[]>([]);
  const setSel = (cells: number[]) => {
    selRef.current = cells;
    setSelState(cells);
  };
  const [flash, setFlash] = useState<{ kind: "bust" | "stray"; cells: number[] } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useTicker(!!state && !state.done, () => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })));

  const result = useMemo<GameResult | null>(() => {
    if (!state?.done) return null;
    return {
      gameId: "risk-pool",
      date,
      puzzleNumber: puzzleNumber(date),
      solved: true,
      durationSec: state.elapsed,
      stats: [
        { label: "Time", value: formatClock(state.elapsed) },
        { label: "Pools", value: String(state.pools.length) },
        { label: "Hints", value: String(state.hints) },
        { label: "Break-ups", value: String(state.breaks) },
      ],
      score: { hints: state.hints },
      proof: { pools: state.pools, hints: state.hints },
      shareText: shareText("risk-pool", date, [
        `${state.hints === 0 ? "🛡️" : "💡"} ${pz.size}×${pz.size} · premium ${pz.target}`,
        `⏱ ${formatClock(state.elapsed)} · ${state.hints} hint${state.hints === 1 ? "" : "s"} · ${state.breaks} break-up${state.breaks === 1 ? "" : "s"}`,
      ]),
    };
  }, [state, date, pz]);
  useCompletion(result, onComplete, recordHistory);

  const owner = useMemo(() => {
    const m = new Array<number>(total).fill(-1);
    state?.pools.forEach((pool, idx) => {
      for (const i of pool) m[i] = idx;
    });
    return m;
  }, [state, total]);

  // ── Pool actions ───────────────────────────────────────────────────────
  const lock = (cells: number[], viaHint = false) => {
    setState((s) => {
      const color = pickPoolColor(cells, s.pools, s.colors, pz.size);
      const pools = [...s.pools, cells];
      return {
        ...s,
        pools,
        colors: [...s.colors, color],
        hinted: [...s.hinted, viaHint],
        hints: s.hints + (viaHint ? 1 : 0),
        done: isComplete(pz, pools),
      };
    });
    setSel([]);
  };

  const breakPool = (idx: number) => {
    setState((s) => ({
      ...s,
      pools: s.pools.filter((_, k) => k !== idx),
      colors: s.colors.filter((_, k) => k !== idx),
      hinted: s.hinted.filter((_, k) => k !== idx),
      breaks: s.breaks + 1,
    }));
    setNote(null);
  };

  const bust = (cells: number[]) => {
    setFlash({ kind: "bust", cells });
    window.setTimeout(() => setFlash(null), 450);
    setSel([]);
  };

  /** Locks the selection if it hits the target, busts it if it overshoots. */
  const settle = (cells: number[]) => {
    const sum = poolSum(cells, pz.values);
    if (cells.length >= 2 && sum === pz.target && isConnected(cells, pz.size)) lock(cells);
    else if (sum > pz.target) bust(cells);
    else setSel(cells);
  };

  const takeHint = () => {
    if (!state) return;
    const hint = nextHint(pz, state.pools);
    if (!hint) return;
    setSel([]);
    if (hint.kind === "reveal") {
      lock(hint.cells, true);
      setNote("A pool from the published solution was added.");
    } else {
      setState((s) => ({ ...s, hints: s.hints + 1 }));
      setFlash({ kind: "stray", cells: state.pools[hint.pool] });
      window.setTimeout(() => setFlash(null), 1600);
      setNote("The flashing pool doesn't fit the published solution — tap it to break it up.");
    }
  };

  // ── Pointer handling: drag a path, or tap cells one by one ─────────────
  const gesture = useRef<{ last: number; moved: boolean; toggle: number | null } | null>(null);

  const cellAt = (e: PointerEvent): number | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const v = el?.closest<HTMLElement>("[data-cell]")?.dataset.cell;
    return v === undefined ? null : Number(v);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!state || state.done) return;
    const i = cellAt(e);
    if (i === null) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setNote(null);

    if (owner[i] >= 0) {
      breakPool(owner[i]);
      gesture.current = null;
      return;
    }
    const cur = selRef.current;
    if (cur.includes(i)) {
      gesture.current = { last: i, moved: false, toggle: i };
      return;
    }
    const next = cur.length > 0 && cur.some((s) => isAdjacent(s, i, pz.size)) ? [...cur, i] : [i];
    setSel(next);
    gesture.current = { last: i, moved: false, toggle: null };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const j = cellAt(e);
    if (j === null || j === g.last) return;
    const cur = selRef.current;
    // Step back along the path to undo the last cell.
    if (cur.length >= 2 && cur[cur.length - 2] === j && cur[cur.length - 1] === g.last) {
      g.last = j;
      g.moved = true;
      setSel(cur.slice(0, -1));
      return;
    }
    if (owner[j] >= 0 || cur.includes(j) || !isAdjacent(j, g.last, pz.size)) return;
    g.last = j;
    g.moved = true;
    setSel([...cur, j]);
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    let cells = selRef.current;
    if (!g.moved && g.toggle !== null) {
      // Tapping a selected cell drops it (or the whole selection if that splits it).
      cells = cells.filter((c) => c !== g.toggle);
      if (cells.length && !isConnected(cells, pz.size)) cells = [];
    }
    settle(cells);
  };

  if (!state) return <GameLoading />;

  const selSum = poolSum(sel, pz.values);
  const pooledCount = state.pools.reduce((n, p) => n + p.length, 0);
  const pct = Math.min(100, (selSum / pz.target) * 100);
  const flashSet = new Set(flash?.cells ?? []);
  const selSet = new Set(sel);

  return (
    <GameShell
      game="risk-pool"
      date={date}
      chips={[
        { label: "Time", value: formatClock(state.elapsed) },
        { label: "Insured", value: `${pooledCount}/${total}` },
      ]}
      actions={
        !state.done && (
          <>
            <Button onClick={takeHint}>Hint</Button>
            <Button
              disabled={state.pools.length === 0}
              onClick={() => {
                if (!window.confirm("Break up every pool and start over?")) return;
                setSel([]);
                setState((s) => ({
                  ...s,
                  pools: [],
                  colors: [],
                  hinted: [],
                  breaks: s.breaks + s.pools.length,
                }));
              }}
            >
              Reset
            </Button>
          </>
        )
      }
    >
      <div className="ag-pool-meter" data-over={selSum > pz.target}>
        <div className="ag-pool-meter__target">
          <span className="ag-pool-meter__label">Target premium</span>
          <span className="ag-pool-meter__value">{pz.target}</span>
        </div>
        <div className="ag-pool-meter__track" aria-hidden="true">
          <div className="ag-pool-meter__fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="ag-pool-meter__current">
          <span className="ag-pool-meter__label">This pool</span>
          <span className="ag-pool-meter__value">
            {sel.length ? selSum : "—"}
            {sel.length > 0 && <small> / {pz.target}</small>}
          </span>
        </div>
      </div>

      {note && <div className="ag-note">{note}</div>}

      <div className="ag-pool-wrap">
        <div
          className="ag-pool"
          data-done={state.done}
          style={{ ["--n" as string]: pz.size }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {pz.values.map((v, i) => {
            const p = owner[i];
            const inSel = selSet.has(i);
            const edge = (n: number) => (p >= 0 ? owner[n] !== p : inSel ? !selSet.has(n) : false);
            const [up, down, left, right] = sides(i, pz);
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: cells are a fixed grid
                key={i}
                data-cell={i}
                className="ag-pool__cell"
                data-pool={p >= 0 ? state.colors[p] : undefined}
                data-hinted={p >= 0 && state.hinted[p]}
                data-selected={inSel}
                data-flash={flashSet.has(i) ? flash?.kind : undefined}
                data-et={up === null || edge(up)}
                data-eb={down === null || edge(down)}
                data-el={left === null || edge(left)}
                data-er={right === null || edge(right)}
                aria-label={`Claims ${v}${p >= 0 ? ", pooled" : ""}`}
              >
                <span className="ag-pool__value">{v}</span>
              </div>
            );
          })}
        </div>
      </div>

      {!state.done && (
        <p className="ag-footnote">
          Drag across neighbours or tap them one by one. Tap a coloured pool to break it up.
        </p>
      )}

      {result && (
        <ResultPanel
          solved
          headline={state.hints === 0 ? "Fully insured. No hints needed." : "Fully insured."}
          detail={`${state.pools.length} pools, each priced at exactly ${pz.target}.`}
          stats={result.stats}
          shareText={result.shareText}
          history={stats}
        />
      )}
    </GameShell>
  );
}

/** [up, down, left, right] neighbour indices, null at the board edge. */
function sides(i: number, pz: RiskPoolPuzzle): Array<number | null> {
  const n = pz.size;
  const r = Math.floor(i / n);
  const c = i % n;
  return [
    r > 0 ? i - n : null,
    r < n - 1 ? i + n : null,
    c > 0 ? i - 1 : null,
    c < n - 1 ? i + 1 : null,
  ];
}
