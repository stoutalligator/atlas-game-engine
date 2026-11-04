import {
  type CSSProperties,
  type PointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatClock, puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate, useTicker } from "../../core/progress.js";
import { shareText } from "../../core/share.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import {
  type BoxPlotPuzzle,
  CHECK_COOLDOWN_SEC,
  type CellState,
  EMPTY,
  FILLED,
  MARKED,
  boxPlotForDate,
  findMistakes,
  isSolved,
  lineMatches,
} from "./logic.js";

interface BoxPlotState {
  /** Row-major cell states. */
  cells: CellState[];
  elapsed: number;
  done: boolean;
  /** Checks used (the board's "hints"). Absent in saves from before Check. */
  checks?: number;
  /** Seconds of play until Check is ready again. */
  checkCooldown?: number;
}

type Tool = "fill" | "mark";

export function BoxPlot({ date: dateProp, storage, onComplete }: DailyGameProps) {
  const date = usePuzzleDate(dateProp);
  if (!date) return <GameLoading />;
  return <BoxPlotGame key={date} date={date} storage={storage} onComplete={onComplete} />;
}

function BoxPlotGame({ date, storage, onComplete }: DailyGameProps & { date: string }) {
  const puzzle = useMemo(() => boxPlotForDate(date), [date]);
  const n = puzzle.size;
  const { state, setState, stats, recordHistory } = useDailyProgress<BoxPlotState>(
    "box-plot",
    date,
    storage,
    () => ({
      cells: new Array(n * n).fill(EMPTY),
      elapsed: 0,
      done: false,
      checks: 0,
      checkCooldown: CHECK_COOLDOWN_SEC,
    }),
  );
  // A save from a different picture size (the schedule changed) starts over.
  useEffect(() => {
    if (state && state.cells.length !== n * n)
      setState({
        cells: new Array(n * n).fill(EMPTY),
        elapsed: 0,
        done: false,
        checks: 0,
        checkCooldown: CHECK_COOLDOWN_SEC,
      });
  }, [state, n, setState]);
  /** Cells the last check flagged, shown until the player changes them. */
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [checkMsg, setCheckMsg] = useState<{ text: string; n: number } | null>(null);
  const [tool, setTool] = useState<Tool>("fill");
  const [undoStack, setUndoStack] = useState<CellState[][]>([]);
  const [hover, setHover] = useState<number | null>(null);

  useTicker(!!state && !state.done, () =>
    setState((s) => ({
      ...s,
      elapsed: s.elapsed + 1,
      checkCooldown: Math.max(0, (s.checkCooldown ?? CHECK_COOLDOWN_SEC) - 1),
    })),
  );

  const result = useMemo<GameResult | null>(() => {
    if (!state?.done) return null;
    const checks = state.checks ?? 0;
    return {
      gameId: "box-plot",
      date,
      puzzleNumber: puzzleNumber(date),
      solved: true,
      durationSec: state.elapsed,
      stats: [
        { label: "Time", value: formatClock(state.elapsed) },
        { label: "Checks", value: String(checks) },
        { label: "Picture", value: puzzle.name },
      ],
      score: { hints: checks },
      proof: { cells: state.cells, hints: checks },
      shareText: shareText("box-plot", date, [
        `🟦 Solved in ${formatClock(state.elapsed)} · ${checks === 0 ? "no checks" : `${checks} check${checks === 1 ? "" : "s"}`}`,
      ]),
    };
  }, [state, date, puzzle.name]);
  useCompletion(result, onComplete, recordHistory);

  // ── Painting ───────────────────────────────────────────────────────────
  const stroke = useRef<{
    start: number;
    write: CellState;
    mode: Tool;
    axis: "row" | "col" | null;
    /** Last cell painted, to fill gaps when the pointer jumps. */
    last: number;
    before: CellState[];
  } | null>(null);

  const paint = useCallback(
    (i: number) => {
      const s = stroke.current;
      if (!s) return;
      const r0 = Math.floor(s.start / n);
      const c0 = s.start % n;
      const r = Math.floor(i / n);
      const c = i % n;
      // Lock the stroke to the row or column it first moves along; once
      // locked, project the pointer onto that line.
      if (i !== s.start && !s.axis) s.axis = r === r0 ? "row" : c === c0 ? "col" : null;
      if (!s.axis && i !== s.start) return;
      const target = s.axis === "row" ? r0 * n + c : s.axis === "col" ? r * n + c0 : i;

      // Fill every cell between the last one painted and the target, so a fast
      // drag doesn't skip any.
      const step = s.axis === "col" ? n : 1;
      const dir = Math.sign(target - s.last);
      const run: number[] = [];
      for (let k = s.last; k !== target + dir * step && dir !== 0; k += dir * step) run.push(k);
      if (dir === 0) run.push(target);
      s.last = target;

      // A flagged cell stops being flagged once the player touches it.
      setFlagged((f) =>
        run.some((k) => f.has(k)) ? new Set([...f].filter((k) => !run.includes(k))) : f,
      );
      setState((prev) => {
        let cells: CellState[] | null = null;
        for (const k of run) {
          const cur = prev.cells[k];
          // Marks never overwrite fills, and clearing only clears this tool's state.
          if (s.mode === "mark" && cur === FILLED) continue;
          if (s.write === EMPTY && cur !== (s.mode === "fill" ? FILLED : MARKED)) continue;
          if (cur === s.write) continue;
          cells ??= [...prev.cells];
          cells[k] = s.write;
        }
        return cells ? { ...prev, cells } : prev;
      });
    },
    [n, setState],
  );

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
    const mode: Tool = e.button === 2 ? "mark" : tool;
    const cur = state.cells[i];
    if (mode === "mark" && cur === FILLED) return;
    const target = mode === "fill" ? FILLED : MARKED;
    stroke.current = {
      start: i,
      write: cur === target ? EMPTY : target,
      mode,
      axis: null,
      last: i,
      before: state.cells,
    };
    paint(i);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const i = cellAt(e);
    if (e.pointerType === "mouse") setHover(i);
    if (stroke.current && i !== null) paint(i);
  };

  const endStroke = () => {
    const s = stroke.current;
    if (!s) return;
    stroke.current = null;
    setUndoStack((u) => [...u.slice(-49), s.before]);
    setState((prev) => {
      if (prev.done || !isSolved(puzzle, toGrid(prev.cells, n))) return prev;
      return { ...prev, done: true };
    });
  };

  if (!state || state.cells.length !== n * n) return <GameLoading />;

  const cooldown = state.checkCooldown ?? CHECK_COOLDOWN_SEC;
  const onCheck = () => {
    if (state.done || cooldown > 0) return;
    const mistakes = findMistakes(puzzle, state.cells);
    setFlagged(new Set(mistakes));
    setCheckMsg((m) => ({
      text: mistakes.length
        ? `${mistakes.length} mistake${mistakes.length === 1 ? "" : "s"} outlined in red.`
        : "No mistakes!",
      n: (m?.n ?? 0) + 1,
    }));
    setState((s) => ({ ...s, checks: (s.checks ?? 0) + 1, checkCooldown: CHECK_COOLDOWN_SEC }));
  };

  const grid = toGrid(state.cells, n);
  const rowDone = puzzle.rowClues.map((clue, r) => lineMatches(grid[r], clue));
  const colDone = puzzle.colClues.map((clue, c) =>
    lineMatches(
      grid.map((row) => row[c]),
      clue,
    ),
  );
  const hr = hover === null ? -1 : Math.floor(hover / n);
  const hc = hover === null ? -1 : hover % n;
  const filled = state.cells.filter((c) => c === FILLED).length;

  return (
    <GameShell
      game="box-plot"
      date={date}
      chips={[
        { label: "Time", value: formatClock(state.elapsed) },
        { label: "Filled", value: String(filled) },
        { label: "Checks", value: String(state.checks ?? 0) },
      ]}
      actions={
        !state.done && (
          <>
            <Button
              variant="accent"
              className="ag-nono-check"
              disabled={cooldown > 0}
              aria-describedby="ag-nono-check-status"
              onClick={onCheck}
            >
              {cooldown > 0 ? `Check in ${cooldown}s` : "Check"}
            </Button>
            <Button
              disabled={undoStack.length === 0}
              onClick={() => {
                const prev = undoStack[undoStack.length - 1];
                if (!prev) return;
                setUndoStack((u) => u.slice(0, -1));
                setState((s) => ({ ...s, cells: prev }));
              }}
            >
              Undo
            </Button>
            <Button
              onClick={() => {
                if (!window.confirm("Clear the whole grid?")) return;
                setUndoStack((u) => [...u, state.cells]);
                setState((s) => ({ ...s, cells: new Array(n * n).fill(EMPTY) }));
              }}
            >
              Clear
            </Button>
          </>
        )
      }
    >
      {!state.done && (
        <div className="ag-tools" role="radiogroup" aria-label="Tool">
          <ToolButton active={tool === "fill"} onClick={() => setTool("fill")}>
            <span className="ag-swatch ag-swatch--fill" /> Fill
          </ToolButton>
          <ToolButton active={tool === "mark"} onClick={() => setTool("mark")}>
            <span className="ag-swatch ag-swatch--mark">✕</span> Mark empty
          </ToolButton>
        </div>
      )}

      {!state.done && (
        <output id="ag-nono-check-status" className="ag-nono-check-msg">
          {checkMsg && (
            <span key={checkMsg.n} data-ok={checkMsg.text === "No mistakes!"}>
              {checkMsg.text}
            </span>
          )}
        </output>
      )}

      <div className="ag-nono-wrap">
        <div
          className="ag-nono"
          data-done={state.done}
          style={{ ["--n" as string]: n }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onPointerLeave={() => setHover(null)}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="ag-nono__corner" />
          {puzzle.colClues.map((clue, c) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
              key={`c${c}`}
              className="ag-nono__clue ag-nono__clue--col"
              data-done={colDone[c]}
              data-hot={c === hc}
            >
              {(clue.length ? clue : [0]).map((v, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: clue digits
                <span key={k}>{v}</span>
              ))}
            </div>
          ))}
          {grid.map((row, r) => (
            <Row
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed grid
              key={`r${r}`}
              r={r}
              n={n}
              row={row}
              clue={puzzle.rowClues[r]}
              done={rowDone[r]}
              hotRow={r === hr}
              hotCol={hc}
              solution={state.done ? puzzle.solution[r] : null}
              colors={puzzle.colors[r]}
              palette={puzzle.palette}
              flagged={state.done ? null : flagged}
            />
          ))}
        </div>
      </div>

      {result && (
        <ResultPanel
          solved
          headline={`It's a ${puzzle.name.toLowerCase()}.`}
          detail="Picture revealed. A fresh grid unlocks at midnight."
          stats={result.stats}
          shareText={result.shareText}
          history={stats}
        />
      )}
    </GameShell>
  );
}

function Row({
  r,
  n,
  row,
  clue,
  done,
  hotRow,
  hotCol,
  solution,
  flagged,
  colors,
  palette,
}: {
  r: number;
  n: number;
  row: CellState[];
  clue: number[];
  done: boolean;
  hotRow: boolean;
  hotCol: number;
  solution: boolean[] | null;
  flagged: Set<number> | null;
  colors: (string | null)[];
  palette: string[];
}) {
  return (
    <>
      <div className="ag-nono__clue ag-nono__clue--row" data-done={done} data-hot={hotRow}>
        {(clue.length ? clue : [0]).map((v, k) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: clue digits
          <span key={k}>{v}</span>
        ))}
      </div>
      {row.map((cell, c) => {
        const i = r * n + c;
        return (
          <div
            key={i}
            data-cell={i}
            className="ag-nono__cell"
            data-state={solution ? (solution[c] ? "filled" : "empty") : STATE_NAMES[cell]}
            data-hot={hotRow || c === hotCol}
            data-wrong={flagged?.has(i) || undefined}
            data-edge-r={c === n - 1 ? "end" : c % 5 === 4}
            data-edge-b={r === n - 1 ? "end" : r % 5 === 4}
            style={solution ? flapStyle(r, c, colors[c], palette) : undefined}
          />
        );
      })}
    </>
  );
}

const STATE_NAMES = ["empty", "filled", "marked"] as const;

/**
 * The solved reveal, like a split-flap departure board: each filled cell
 * flips through three of the picture's colours and lands on its own,
 * sweeping across the rows. The flicker colours are fixed per cell.
 */
function flapStyle(r: number, c: number, color: string | null, palette: string[]): CSSProperties {
  if (!color) return {};
  const pick = (k: number) => palette[(r * 7 + c * 13 + k * 5) % palette.length] ?? color;
  return {
    ["--ag-flap-c" as string]: color,
    ["--ag-flap-1" as string]: pick(1),
    ["--ag-flap-2" as string]: pick(2),
    ["--ag-flap-3" as string]: pick(3),
    animationDelay: `${r * 55 + c * 30}ms`,
  };
}

function ToolButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: segmented control
    <button type="button" role="radio" aria-checked={active} className="ag-tool" onClick={onClick}>
      {children}
    </button>
  );
}

function toGrid(cells: CellState[], n: number): CellState[][] {
  return Array.from({ length: n }, (_, r) => cells.slice(r * n, r * n + n));
}

export type { BoxPlotPuzzle };
