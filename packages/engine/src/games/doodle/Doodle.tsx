import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate } from "../../core/progress.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import {
  DOODLE_ERASER_RADIUS,
  type DrawingState,
  drawingReducer,
  emptyDrawing,
  strokesForSubmit,
} from "./drawing.js";
import { pathLength } from "./geometry.js";
import { DOODLE_PRACTICE_SOURCE, DOODLE_PRACTICE_VARIANT } from "./practice.js";
import {
  buildDoodlePuzzle,
  doodleDifficultyLabel,
  doodleReference,
  doodleShareText,
} from "./puzzle.js";
import { hasInk, scoreDoodle } from "./score.js";
import type { DoodlePath, DoodlePoint, DoodlePuzzle, DoodleResult } from "./types.js";

/** Today's puzzle, and the player's result if they've already submitted. */
export interface DoodleDay {
  date: string;
  puzzle: DoodlePuzzle;
  result?: DoodleResult;
}

/**
 * The host's side of Doodle. The answer stays on the host's server until the
 * player submits: the component only sees the visible part and the drawing
 * region, and gets the answer back with the server's score.
 */
export interface DoodleApi {
  load(date: string): Promise<DoodleDay | null>;
  /** Scores and saves the one submission (a second one returns the first result). */
  submit(date: string, puzzleId: string, strokes: DoodlePath[]): Promise<DoodleResult | null>;
}

export interface DoodleProps extends DailyGameProps {
  api: DoodleApi;
}

/** How long the answer takes to trace itself in. */
const REVEAL_MS = 2000;

export function Doodle({ api, date: dateProp, storage, onComplete }: DoodleProps) {
  const date = usePuzzleDate(dateProp);
  if (!date) return <GameLoading game="doodle" />;
  return <DoodleGame key={date} api={api} date={date} storage={storage} onComplete={onComplete} />;
}

/** The practice round: a circle, scored in the browser, never saved. */
const PRACTICE_PUZZLE = buildDoodlePuzzle(DOODLE_PRACTICE_SOURCE, DOODLE_PRACTICE_VARIANT);
const PRACTICE_REFERENCE = doodleReference(DOODLE_PRACTICE_SOURCE, DOODLE_PRACTICE_VARIANT);

interface Draft {
  /** Unfinished drawing, kept across a refresh until it's submitted. */
  strokes: DoodlePath[];
  puzzleId: string | null;
}

function DoodleGame({
  api,
  date,
  storage,
  onComplete,
}: { api: DoodleApi; date: string } & Omit<DailyGameProps, "date">) {
  const [day, setDay] = useState<DoodleDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [practice, setPractice] = useState(false);
  const progress = useDailyProgress<Draft>("doodle", date, storage, () => ({
    strokes: [],
    puzzleId: null,
  }));

  useEffect(() => {
    let cancelled = false;
    api
      .load(date)
      .then((d) => {
        if (cancelled) return;
        if (!d) setError("Today's Doodle isn't available. Try again shortly.");
        else setDay(d);
      })
      .catch(() => !cancelled && setError("Couldn't load today's Doodle."));
    return () => {
      cancelled = true;
    };
  }, [api, date]);

  const result = day?.result ?? null;
  const gameResult = useMemo<GameResult | null>(() => {
    if (!day || !result) return null;
    return {
      gameId: "doodle",
      date,
      puzzleNumber: puzzleNumber(date),
      solved: true,
      durationSec: 0,
      stats: [
        { label: "Match", value: `${result.score}%` },
        { label: "Placement", value: `${Math.round(result.precision * 100)}%` },
        { label: "Coverage", value: `${Math.round(result.coverage * 100)}%` },
      ],
      score: { match: result.score },
      proof: null,
      shareText: doodleShareText(date, day.puzzle.difficulty, result.score),
    };
  }, [day, result, date]);
  useCompletion(gameResult, onComplete, progress.recordHistory);

  if (error) return <div className="ag-root ag-error">{error}</div>;
  if (!day || progress.state === null) return <GameLoading game="doodle" />;

  if (practice)
    return (
      <GameShell
        game="doodle"
        date={date}
        banner={<PromptLine puzzle={PRACTICE_PUZZLE} practice />}
        actions={
          <Button variant="ghost" onClick={() => setPractice(false)}>
            Back to today
          </Button>
        }
      >
        <Board
          key="practice"
          puzzle={PRACTICE_PUZZLE}
          initial={[]}
          submit={async (strokes) => ({
            ...scoreDoodle(
              PRACTICE_REFERENCE,
              strokes,
              PRACTICE_PUZZLE.region,
              PRACTICE_PUZZLE.width,
              PRACTICE_PUZZLE.height,
            ),
            strokes,
            reference: PRACTICE_REFERENCE,
          })}
          renderDone={(r) => (
            <div className="ag-dd__practice-done">
              <strong>{r.score}% match.</strong> That was practice: it doesn't count. Today's Doodle
              is still waiting.
              <Button variant="primary" onClick={() => setPractice(false)}>
                Play today's Doodle
              </Button>
            </div>
          )}
        />
      </GameShell>
    );

  const draft = progress.state.puzzleId === day.puzzle.id ? progress.state.strokes : [];
  return (
    <GameShell
      game="doodle"
      date={date}
      chips={result ? [{ label: "Match", value: `${result.score}%` }] : []}
      banner={<PromptLine puzzle={day.puzzle} />}
      actions={
        !result && (
          <Button variant="ghost" onClick={() => setPractice(true)}>
            Practice
          </Button>
        )
      }
    >
      <Board
        key={day.puzzle.id}
        puzzle={day.puzzle}
        initial={draft}
        done={result}
        onDraft={(strokes) => progress.setState({ strokes, puzzleId: day.puzzle.id })}
        submit={async (strokes) => {
          const r = await api.submit(date, day.puzzle.id, strokes);
          if (r) {
            progress.setState({ strokes: [], puzzleId: day.puzzle.id });
            return r;
          }
          return null;
        }}
        onRevealed={(r) => setDay((d) => (d ? { ...d, result: r } : d))}
        renderDone={() =>
          gameResult && (
            <ResultPanel
              solved
              headline={`${result?.score ?? 0}% match`}
              detail={headlineFor(result?.score ?? 0)}
              stats={gameResult.stats}
              shareText={gameResult.shareText}
              history={progress.stats}
            >
              {result?.credit && <p className="ag-dd__credit">Source: {result.credit}</p>}
            </ResultPanel>
          )
        }
      />
    </GameShell>
  );
}

function headlineFor(score: number): string {
  if (score >= 90) return "Spot on. That's practically the real thing.";
  if (score >= 75) return "Great eye: close in shape and place.";
  if (score >= 55) return "Good attempt. The overlay shows where it drifted.";
  if (score >= 30) return "Part of the way there. Compare your line with the answer.";
  return "A tough one. Tomorrow's is a fresh start.";
}

function PromptLine({ puzzle, practice = false }: { puzzle: DoodlePuzzle; practice?: boolean }) {
  return (
    <div className="ag-dd__prompt">
      <div className="ag-dd__pills">
        {practice ? (
          <span className="ag-pill ag-dd__pill--practice">Practice · doesn't count</span>
        ) : (
          <>
            <span className="ag-pill ag-dd__pill" data-difficulty={puzzle.difficulty}>
              {doodleDifficultyLabel(puzzle.difficulty)}
            </span>
            <span className="ag-pill">{puzzle.category}</span>
            <span className="ag-pill">{Math.round(puzzle.visibility * 100)}% shown</span>
          </>
        )}
      </div>
      <div className="ag-dd__prompt-text">{puzzle.prompt}</div>
    </div>
  );
}

type Tool = "pen" | "eraser";

interface BoardProps {
  puzzle: DoodlePuzzle;
  initial: DoodlePath[];
  /** Set once submitted (or when reopening a submitted puzzle). */
  done?: DoodleResult | null;
  onDraft?: (strokes: DoodlePath[]) => void;
  submit: (strokes: DoodlePath[]) => Promise<DoodleResult | null>;
  onRevealed?: (r: DoodleResult) => void;
  renderDone: (r: DoodleResult) => React.ReactNode;
}

function Board({ puzzle, initial, done, onDraft, submit, onRevealed, renderDone }: BoardProps) {
  const [drawing, dispatch] = useReducer(
    drawingReducer,
    initial,
    (s): DrawingState => ({ ...emptyDrawing(), strokes: s }),
  );
  const [tool, setTool] = useState<Tool>("pen");
  const [live, setLive] = useState<DoodlePath | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** The result being revealed; `shown` flips once the trace has finished. */
  const [reveal, setReveal] = useState<{ result: DoodleResult; shown: boolean } | null>(
    done ? { result: done, shown: true } : null,
  );
  const svgRef = useRef<SVGSVGElement>(null);
  const pointerRef = useRef<{ id: number; type: string } | null>(null);
  const liveRef = useRef<DoodlePath | null>(null);
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const locked = !!reveal || submitting;

  // Save the unfinished drawing (not after submitting).
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return;
    }
    if (!reveal) onDraftRef.current?.(drawing.strokes);
  }, [drawing.strokes, reveal]);

  const toUnits = useCallback((clientX: number, clientY: number): DoodlePoint | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  }, []);

  const commit = useCallback(() => {
    const pts = liveRef.current;
    liveRef.current = null;
    pointerRef.current = null;
    setLive(null);
    if (!pts || pts.length === 0) return;
    if (toolRef.current === "pen") dispatch({ kind: "pen", points: pts, region: puzzle.region });
    else dispatch({ kind: "erase", points: pts });
  }, [puzzle.region]);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (locked) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointerRef.current) {
      // A second finger while drawing is a pinch or a palm: drop the stroke.
      if (e.pointerType === "touch" && pointerRef.current.type === "touch") {
        liveRef.current = null;
        pointerRef.current = null;
        setLive(null);
      }
      return;
    }
    const p = toUnits(e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    try {
      // Keeps the stroke going when the finger leaves the board; strokes are clipped anyway.
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers refuse capture for pen/emulated pointers; drawing still works without it.
    }
    pointerRef.current = { id: e.pointerId, type: e.pointerType };
    liveRef.current = [p];
    setLive([p]);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointerRef.current || e.pointerId !== pointerRef.current.id || !liveRef.current) return;
    e.preventDefault();
    const events =
      typeof e.nativeEvent.getCoalescedEvents === "function"
        ? e.nativeEvent.getCoalescedEvents()
        : [];
    const list = events.length ? events : [e.nativeEvent];
    const next = [...liveRef.current];
    for (const ev of list) {
      const p = toUnits(ev.clientX, ev.clientY);
      if (!p) continue;
      const last = next[next.length - 1];
      if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 1.5) next.push(p);
    }
    liveRef.current = next;
    setLive(next);
  };

  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!pointerRef.current || e.pointerId !== pointerRef.current.id) return;
    if (e.type === "pointercancel") {
      liveRef.current = null;
      pointerRef.current = null;
      setLive(null);
      return;
    }
    commit();
  };

  // Ctrl/Cmd+Z undoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (locked) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ kind: "undo" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  // While erasing, preview the strokes without what's under the eraser.
  const shownStrokes = useMemo(() => {
    if (reveal) return reveal.result.strokes;
    if (tool === "eraser" && live)
      return drawingReducer(drawing, { kind: "erase", points: live }).strokes;
    return drawing.strokes;
  }, [reveal, tool, live, drawing]);

  const canSubmit = !locked && hasInk(drawing.strokes, puzzle.region);

  const onSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setSubmitError(null);
    const r = await submit(strokesForSubmit(drawing.strokes)).catch(() => null);
    setSubmitting(false);
    if (!r) {
      setSubmitError("Couldn't submit. Check your connection and try again.");
      return;
    }
    setReveal({ result: r, shown: false });
  };

  // The trace: once it has finished, show the score.
  useEffect(() => {
    if (!reveal || reveal.shown) return;
    const reduce =
      typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = window.setTimeout(
      () => {
        setReveal((r) => (r ? { ...r, shown: true } : r));
        onRevealed?.(reveal.result);
      },
      reduce ? 0 : REVEAL_MS + 250,
    );
    return () => window.clearTimeout(id);
  }, [reveal, onRevealed]);

  const { width, height } = puzzle;
  const toD = (p: DoodlePath) => (p.length ? `M${p.map(([x, y]) => `${x} ${y}`).join("L")}` : "");

  // Reveal timing: paths trace one after another, each for its share of the length.
  const reference = reveal?.result.reference ?? [];
  const lengths = reference.map(pathLength);
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let start = 0;
  const timing = lengths.map((len) => {
    const t = { delay: (start / total) * REVEAL_MS, dur: Math.max(120, (len / total) * REVEAL_MS) };
    start += len;
    return t;
  });

  return (
    <div className="ag-dd">
      <div className="ag-dd__board-wrap">
        <svg
          ref={svgRef}
          className="ag-dd__board"
          data-tool={tool}
          data-locked={locked}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`${puzzle.prompt} Drawing board; the shaded area is where you draw.`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onLostPointerCapture={onPointerEnd}
          onContextMenu={(e) => e.preventDefault()}
        >
          {puzzle.region.map((r, i) => (
            <rect
              // biome-ignore lint/suspicious/noArrayIndexKey: static geometry, never reordered
              key={`r${i}`}
              className="ag-dd__region"
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              rx={8}
            />
          ))}
          {puzzle.guides.map((p, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: static geometry, never reordered
              key={`g${i}`}
              className="ag-dd__guide"
              d={toD(p)}
            />
          ))}
          {puzzle.labels.map((l, i) => (
            <text
              // biome-ignore lint/suspicious/noArrayIndexKey: static geometry, never reordered
              key={`l${i}`}
              className="ag-dd__label"
              x={l.x}
              y={l.y}
              textAnchor={l.anchor ?? "middle"}
            >
              {l.text}
            </text>
          ))}
          {puzzle.visible.map((p, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: static geometry, never reordered
              key={`v${i}`}
              className="ag-dd__visible"
              d={toD(p)}
            />
          ))}
          {shownStrokes.map((p, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: static geometry, never reordered
              key={`s${i}`}
              className="ag-dd__ink"
              d={toD(p)}
            />
          ))}
          {live && tool === "pen" && <path className="ag-dd__ink ag-dd__ink--live" d={toD(live)} />}
          {live && tool === "eraser" && (
            <circle
              className="ag-dd__eraser"
              cx={live[live.length - 1][0]}
              cy={live[live.length - 1][1]}
              r={DOODLE_ERASER_RADIUS}
            />
          )}
          {reference.map((p, i) => (
            <path
              // biome-ignore lint/suspicious/noArrayIndexKey: static geometry, never reordered
              key={`a${i}`}
              className="ag-dd__answer"
              d={toD(p)}
              pathLength={1}
              style={
                done
                  ? undefined
                  : {
                      animationDelay: `${timing[i].delay}ms`,
                      animationDuration: `${timing[i].dur}ms`,
                    }
              }
              data-instant={done ? "true" : undefined}
            />
          ))}
        </svg>
      </div>

      {reveal?.shown && (
        <div className="ag-dd__score" aria-live="polite">
          <span className="ag-dd__score-num">{reveal.result.score}%</span>
          <span className="ag-dd__score-label">match</span>
        </div>
      )}
      {reveal && (
        <div className="ag-dd__legend" aria-hidden="true">
          <span className="ag-dd__key ag-dd__key--ink">Your drawing</span>
          <span className="ag-dd__key ag-dd__key--answer">Answer</span>
        </div>
      )}

      {!reveal && (
        <div className="ag-dd__controls">
          <div className="ag-tools" role="radiogroup" aria-label="Tool">
            {(["pen", "eraser"] as const).map((t) => (
              <button
                key={t}
                type="button"
                className="ag-tool"
                // biome-ignore lint/a11y/useSemanticElements: segmented control, like Box Plot's
                role="radio"
                aria-checked={tool === t}
                onClick={() => setTool(t)}
              >
                {t === "pen" ? "✏️ Pen" : "🧽 Eraser"}
              </button>
            ))}
          </div>
          <div className="ag-dd__actions">
            <Button
              onClick={() => dispatch({ kind: "undo" })}
              disabled={locked || drawing.undo.length === 0}
            >
              Undo
            </Button>
            <Button
              onClick={() => dispatch({ kind: "clear" })}
              disabled={locked || drawing.strokes.length === 0}
            >
              Clear
            </Button>
            <Button variant="primary" onClick={onSubmit} disabled={!canSubmit}>
              {submitting ? "Scoring…" : "Submit"}
            </Button>
          </div>
        </div>
      )}
      {!reveal && (
        <p className="ag-dd__hint">
          {hasInk(drawing.strokes, puzzle.region)
            ? "One submission per day, and it's final."
            : "Draw inside the shaded area. Submit unlocks once you've drawn."}
        </p>
      )}
      {submitError && <p className="ag-dd__error">{submitError}</p>}
      {reveal?.shown && renderDone(reveal.result)}
    </div>
  );
}
