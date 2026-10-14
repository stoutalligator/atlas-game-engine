import {
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatClock, puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate, useTicker } from "../../core/progress.js";
import { shareText } from "../../core/share.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import { type CubeStep, cubeRushForDate } from "./daily.js";
import {
  ANALYST_ID,
  type CubeRushPuzzle,
  type Difficulty,
  type Direction,
  type Piece,
  type PieceTone,
  type Positions,
  applyMove,
  canMove,
  isSolved,
  positionsOf,
  withPositions,
} from "./logic.js";

interface CubeState {
  positions: Positions;
  moves: number;
  /** One entry per move: which piece, and where it started. */
  history: Array<{ id: string; from: [number, number] }>;
  /** Every single-cell step, for server-side replay. */
  steps?: CubeStep[];
  elapsed: number;
  done: boolean;
}

export function CubeRush({ date: dateProp, storage, onComplete }: DailyGameProps) {
  const date = usePuzzleDate(dateProp);
  if (!date) return <GameLoading />;
  return <CubeRushGame key={date} date={date} storage={storage} onComplete={onComplete} />;
}

const KEY_DIRS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

function CubeRushGame({ date, storage, onComplete }: DailyGameProps & { date: string }) {
  const { puzzle: base, par, difficulty } = useMemo(() => cubeRushForDate(date), [date]);
  const { state, setState, stats, recordHistory } = useDailyProgress<CubeState>(
    "cube-rush",
    date,
    storage,
    () => ({
      positions: positionsOf(base),
      moves: 0,
      history: [],
      steps: [],
      elapsed: 0,
      done: false,
    }),
  );
  const [selected, setSelected] = useState<string | null>(null);

  useTicker(!!state && !state.done, () => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })));

  const pz = useMemo(() => (state ? withPositions(base, state.positions) : base), [base, state]);

  const result = useMemo<GameResult | null>(() => {
    if (!state?.done) return null;
    const underPar = state.moves <= par;
    return {
      gameId: "cube-rush",
      date,
      puzzleNumber: puzzleNumber(date),
      solved: true,
      durationSec: state.elapsed,
      stats: [
        { label: "Moves", value: String(state.moves) },
        { label: "Par", value: String(par) },
        { label: "Time", value: formatClock(state.elapsed) },
      ],
      score: { moves: state.moves },
      proof: { steps: state.steps ?? [] },
      shareText: shareText("cube-rush", date, [
        `${DIFF_EMOJI[difficulty]} ${difficulty[0].toUpperCase()}${difficulty.slice(1)}`,
        `${underPar ? "⭐" : "🚪"} ${state.moves} moves (par ${par}) · ⏱ ${formatClock(state.elapsed)}`,
      ]),
    };
  }, [state, par, date, difficulty]);
  useCompletion(result, onComplete, recordHistory);

  /** One step of one piece. Consecutive steps of the same piece count as one move. */
  // Latest state, so several steps in one drag event build on each other.
  const latest = useRef(state);
  latest.current = state;

  const step = useCallback(
    (id: string, dir: Direction): boolean => {
      const s = latest.current;
      if (!s || s.done) return false;
      const cur = withPositions(base, s.positions);
      if (!canMove(cur, id, dir)) return false;
      const next = applyMove(cur, id, dir);
      const sameMove = s.history.length > 0 && s.history[s.history.length - 1].id === id;
      const piece = cur.pieces.find((p) => p.id === id) as Piece;
      const nextState: CubeState = {
        ...s,
        positions: positionsOf(next),
        moves: sameMove ? s.moves : s.moves + 1,
        history: sameMove ? s.history : [...s.history, { id, from: [piece.col, piece.row] }],
        steps: [...(s.steps ?? []), [id, dir]],
        done: isSolved(next),
      };
      latest.current = nextState;
      setState(nextState);
      return true;
    },
    [base, setState],
  );

  const undo = () =>
    setState((s) => {
      const last = s.history[s.history.length - 1];
      if (!last || s.done) return s;
      // Drop the trailing run of steps that made up the last move.
      const steps = [...(s.steps ?? [])];
      while (steps.length && steps[steps.length - 1][0] === last.id) steps.pop();
      return {
        ...s,
        positions: { ...s.positions, [last.id]: last.from },
        moves: s.moves - 1,
        history: s.history.slice(0, -1),
        steps,
      };
    });

  const reset = () =>
    setState((s) =>
      s.done ? s : { ...s, positions: positionsOf(base), moves: 0, history: [], steps: [] },
    );

  // Arrow keys move the selected piece.
  useEffect(() => {
    if (!selected || state?.done) return;
    const onKey = (e: KeyboardEvent) => {
      const dir = KEY_DIRS[e.key];
      if (e.key === "Escape") setSelected(null);
      if (!dir) return;
      e.preventDefault();
      step(selected, dir);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, step, state?.done]);

  // ── Sizing: fit the floor to the available width ──────────────────────
  // Callback ref: the wrapper only mounts once saved progress has loaded.
  const [wrapEl, setWrapEl] = useState<HTMLDivElement | null>(null);
  const [cell, setCell] = useState(52);
  useLayoutEffect(() => {
    const el = wrapEl;
    if (!el) return;
    const fit = () => {
      const room = el.clientWidth - 2 * PAD;
      setCell(Math.max(30, Math.min(60, Math.floor((room + GAP) / pz.cols - GAP))));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [wrapEl, pz.cols]);
  const stepPx = cell + GAP;

  // ── Dragging ──────────────────────────────────────────────────────────
  const drag = useRef<{ id: string; x: number; y: number } | null>(null);

  const onPiecePointerDown = (e: PointerEvent<HTMLButtonElement>, id: string) => {
    if (state?.done) return;
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(id);
    drag.current = { id, x: e.clientX, y: e.clientY };
  };

  const onPiecePointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    // Step whenever the pointer is half a cell past the piece's last spot.
    for (let guard = 0; guard < 12; guard++) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const dist = horizontal ? dx : dy;
      if (Math.abs(dist) < stepPx / 2) break;
      const dir: Direction = horizontal ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      if (!step(d.id, dir)) break;
      if (horizontal) d.x += Math.sign(dx) * stepPx;
      else d.y += Math.sign(dy) * stepPx;
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  if (!state) return <GameLoading />;

  const boardW = pz.cols * stepPx - GAP;
  const boardH = pz.rows * stepPx - GAP;

  return (
    <GameShell
      game="cube-rush"
      date={date}
      chips={[
        { label: "Moves", value: String(state.moves) },
        { label: "Par", value: String(par) },
        { label: "Time", value: formatClock(state.elapsed) },
      ]}
      banner={
        <span>
          <strong className="ag-banner__strong">{difficulty.toUpperCase()}</strong> floor plan ·{" "}
          {pz.cols}×{pz.rows}
        </span>
      }
      actions={
        !state.done && (
          <>
            <Button disabled={state.history.length === 0} onClick={undo}>
              Undo
            </Button>
            <Button disabled={state.history.length === 0} onClick={reset}>
              Reset
            </Button>
          </>
        )
      }
    >
      <div className="ag-cube-wrap" ref={setWrapEl}>
        <div
          className="ag-cube"
          data-done={state.done}
          style={{ width: boardW + 2 * PAD, height: boardH + 2 * PAD }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
          }}
        >
          <div
            className="ag-cube__floor"
            style={{ left: PAD, top: PAD, width: boardW, height: boardH }}
          >
            {[...pz.valid].map((k) => {
              const [r, c] = k.split(",").map(Number);
              return (
                <div
                  key={k}
                  className="ag-cube__tile"
                  style={{ left: c * stepPx, top: r * stepPx, width: cell, height: cell }}
                />
              );
            })}
            <Walls pz={pz} stepPx={stepPx} cell={cell} />

            {pz.pieces.map((p) => {
              const isAnalyst = p.id === ANALYST_ID;
              const exited = isAnalyst && state.done;
              return (
                <button
                  key={p.id}
                  type="button"
                  className="ag-piece"
                  data-tone={p.tone}
                  data-selected={selected === p.id}
                  data-exited={exited}
                  aria-label={isAnalyst ? "Analyst" : `Cubicle ${p.id.slice(1)}`}
                  aria-pressed={selected === p.id}
                  disabled={state.done}
                  style={{ transform: `translate(${p.col * stepPx}px, ${p.row * stepPx}px)` }}
                  onPointerDown={(e) => onPiecePointerDown(e, p.id)}
                  onPointerMove={onPiecePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onFocus={() => setSelected(p.id)}
                >
                  <PieceShape piece={p} cell={cell} />
                </button>
              );
            })}
          </div>
        </div>
        {!state.done && (
          <p className="ag-footnote">
            {selected
              ? "Drag, or use the arrow keys."
              : "Drag a cubicle — or tap one, then use the arrow keys."}
          </p>
        )}
      </div>

      {result && (
        <ResultPanel
          solved
          headline={state.moves <= par ? "Out the door — at par!" : "Out the door."}
          detail={
            state.moves <= par
              ? "You matched the fewest possible moves."
              : `The fewest possible was ${par}. Tomorrow's floor plan unlocks at midnight.`
          }
          stats={result.stats}
          shareText={result.shareText}
          history={stats}
        />
      )}
    </GameShell>
  );
}

const DIFF_EMOJI: Record<Difficulty, string> = { easy: "🟢", medium: "🟡", hard: "🔴" };
const GAP = 4;
const PAD = 26;
const WALL = 5;

const TONES: Record<PieceTone, { fill: string; edge: string }> = {
  analyst: { fill: "#0f172a", edge: "#020617" },
  indigo: { fill: "#c7d2fe", edge: "#6366f1" },
  cyan: { fill: "#a5f3fc", edge: "#06b6d4" },
  amber: { fill: "#fde68a", edge: "#f59e0b" },
  emerald: { fill: "#a7f3d0", edge: "#10b981" },
  rose: { fill: "#fecdd3", edge: "#f43f5e" },
  violet: { fill: "#ddd6fe", edge: "#8b5cf6" },
};

/** Draws any polyomino as one chunky block: edge layer, then inset fill. */
function PieceShape({ piece, cell }: { piece: Piece; cell: number }) {
  const step = cell + GAP;
  const has = (dc: number, dr: number) => piece.cells.some(([a, b]) => a === dc && b === dr);
  const w = Math.max(...piece.cells.map(([dc]) => dc)) + 1;
  const h = Math.max(...piece.cells.map(([, dr]) => dr)) + 1;
  const b = Math.max(2, Math.round(cell / 22));
  const rects: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    inset: [number, number, number, number];
  }> = [];

  for (const [dc, dr] of piece.cells) {
    const x = dc * step;
    const y = dr * step;
    const L = has(dc - 1, dr);
    const R = has(dc + 1, dr);
    const U = has(dc, dr - 1);
    const D = has(dc, dr + 1);
    rects.push({ x, y, w: cell, h: cell, inset: [U ? 0 : b, R ? 0 : b, D ? 0 : b, L ? 0 : b] });
    if (R) {
      const jU = U && has(dc + 1, dr - 1);
      const jD = D && has(dc + 1, dr + 1);
      rects.push({ x: x + cell, y, w: GAP, h: cell, inset: [jU ? 0 : b, 0, jD ? 0 : b, 0] });
    }
    if (D) {
      const jL = L && has(dc - 1, dr + 1);
      const jR = R && has(dc + 1, dr + 1);
      rects.push({ x, y: y + cell, w: cell, h: GAP, inset: [0, jR ? 0 : b, 0, jL ? 0 : b] });
    }
    if (R && D && has(dc + 1, dr + 1))
      rects.push({ x: x + cell, y: y + cell, w: GAP, h: GAP, inset: [0, 0, 0, 0] });
  }

  const tone = TONES[piece.tone];
  const W = w * step - GAP;
  const H = h * step - GAP;
  const isAnalyst = piece.id === ANALYST_ID;

  return (
    <svg
      className="ag-piece__svg"
      width={W}
      height={H + 3}
      viewBox={`0 0 ${W} ${H + 3}`}
      aria-hidden="true"
    >
      <g className="ag-piece__shadow">
        {rects.map((r) => (
          <rect key={`s${r.x},${r.y},${r.w}`} x={r.x} y={r.y + 3} width={r.w} height={r.h} />
        ))}
      </g>
      <g className="ag-piece__edge" fill={tone.edge}>
        {rects.map((r) => (
          <rect key={`e${r.x},${r.y},${r.w}`} x={r.x} y={r.y} width={r.w} height={r.h} />
        ))}
      </g>
      <g fill={tone.fill}>
        {rects.map((r) => (
          <rect
            key={`f${r.x},${r.y},${r.w}`}
            x={r.x + r.inset[3]}
            y={r.y + r.inset[0]}
            width={Math.max(0, r.w - r.inset[1] - r.inset[3])}
            height={Math.max(0, r.h - r.inset[0] - r.inset[2])}
          />
        ))}
      </g>
      {isAnalyst && (
        <g fill="#fff" transform={`translate(${W / 2} ${H / 2}) scale(${cell / 40})`}>
          <circle cx="0" cy="-7" r="5" />
          <path d="M-9 12c0-7 4-11 9-11s9 4 9 11z" />
          <rect x="-1.2" y="1" width="2.4" height="7" fill="#f59e0b" />
        </g>
      )}
    </svg>
  );
}

/** Floor walls that follow the valid cells, with a gap at the exit. */
function Walls({ pz, stepPx, cell }: { pz: CubeRushPuzzle; stepPx: number; cell: number }) {
  const segs: Array<{ key: string; x: number; y: number; w: number; h: number }> = [];
  const valid = (r: number, c: number) => pz.valid.has(`${r},${c}`);
  const { gate } = pz;

  for (let r = 0; r <= pz.rows; r++) {
    let start: number | null = null;
    const flush = (c: number) => {
      if (start === null) return;
      segs.push({
        key: `h${r}-${start}`,
        x: start * stepPx - WALL,
        y: r * stepPx - GAP / 2 - WALL / 2 - (r === 0 ? 0 : 0),
        w: (c - start) * stepPx - GAP + 2 * WALL,
        h: WALL,
      });
      start = null;
    };
    for (let c = 0; c < pz.cols; c++) {
      const edge = valid(r - 1, c) !== valid(r, c);
      const isGate =
        (gate.side === "top" && r === 0 && c === gate.index) ||
        (gate.side === "bottom" && r === pz.rows && c === gate.index);
      if (edge && !isGate) start ??= c;
      else flush(c);
    }
    flush(pz.cols);
  }
  for (let c = 0; c <= pz.cols; c++) {
    let start: number | null = null;
    const flush = (r: number) => {
      if (start === null) return;
      segs.push({
        key: `v${c}-${start}`,
        x: c * stepPx - GAP / 2 - WALL / 2,
        y: start * stepPx - WALL,
        w: WALL,
        h: (r - start) * stepPx - GAP + 2 * WALL,
      });
      start = null;
    };
    for (let r = 0; r < pz.rows; r++) {
      const edge = valid(r, c - 1) !== valid(r, c);
      const isGate =
        (gate.side === "left" && c === 0 && r === gate.index) ||
        (gate.side === "right" && c === pz.cols && r === gate.index);
      if (edge && !isGate) start ??= r;
      else flush(r);
    }
    flush(pz.rows);
  }

  const mid = gate.index * stepPx + cell / 2;
  const door =
    gate.side === "right" || gate.side === "left"
      ? {
          left: gate.side === "right" ? pz.cols * stepPx - GAP / 2 - WALL / 2 : -GAP / 2 - WALL / 2,
          top: gate.index * stepPx,
          width: WALL,
          height: cell,
        }
      : {
          left: gate.index * stepPx,
          top: gate.side === "bottom" ? pz.rows * stepPx - GAP / 2 - WALL / 2 : -GAP / 2 - WALL / 2,
          width: cell,
          height: WALL,
        };
  const exitStyle =
    gate.side === "right"
      ? { left: pz.cols * stepPx + 2, top: mid, transform: "translateY(-50%)" }
      : gate.side === "left"
        ? { left: -PAD + 1, top: mid, transform: "translateY(-50%)" }
        : gate.side === "top"
          ? { top: -PAD + 4, left: mid, transform: "translateX(-50%)" }
          : { top: pz.rows * stepPx + 2, left: mid, transform: "translateX(-50%)" };

  return (
    <>
      {segs.map((s) => (
        <div
          key={s.key}
          className="ag-cube__wall"
          style={{ left: s.x, top: s.y, width: s.w, height: s.h }}
        />
      ))}
      <div className="ag-cube__door" style={door} />
      <div className="ag-cube__exit" data-side={gate.side} style={exitStyle}>
        {gate.side === "right"
          ? "EXIT →"
          : gate.side === "left"
            ? "← EXIT"
            : gate.side === "top"
              ? "↑ EXIT"
              : "EXIT ↓"}
      </div>
    </>
  );
}
