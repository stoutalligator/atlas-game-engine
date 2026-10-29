import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatClock, puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate } from "../../core/progress.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import { useActivePlayClock } from "./clock.js";
import { boundsOf, cellKey, cellsOf } from "./grid.js";
import {
  type SubmitOutcome,
  type WordWebState,
  backspace,
  currentLetters,
  fixedCells,
  hintStatus,
  initialState,
  openAnswers,
  restoreState,
  selectAnswer,
  submitGuess,
  takeHint,
  tick,
  typeLetter,
  visibleAnswers,
} from "./play.js";
import { wordWebForDate } from "./queue.js";
import { wordWebShareText } from "./share.js";
import type { WordWebAnswer, WordWebPuzzle } from "./types.js";

export interface WordWebProps extends DailyGameProps {
  /**
   * Puzzles from the host: validated Word Web puzzles for today (and nearby
   * days), plus any evergreen fallbacks. Anything else is ignored. With none,
   * the built-in canonical puzzle plays.
   */
  puzzles?: readonly unknown[];
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const CLOSE_MESSAGE = "Close! Right category, but wrong answer.";
/** How long a guess's feedback (shake, ✕, glow) stays on the word. */
const FLASH_MS = 900;
/** Stagger between cells as a new word unfolds from its crossing. */
const UNFOLD_STEP_MS = 55;

type FlashKind = "bad" | "close" | "repeat" | "incomplete" | "good";

export function WordWeb({ date: dateProp, storage, onComplete, puzzles = [] }: WordWebProps) {
  const date = usePuzzleDate(dateProp);
  if (!date) return <GameLoading />;
  return (
    <WordWebLoader
      key={date}
      date={date}
      storage={storage}
      onComplete={onComplete}
      puzzles={puzzles}
    />
  );
}

function WordWebLoader({ date, puzzles, ...rest }: WordWebProps & { date: string }) {
  // Chosen once per mount: a date change while the page is open never swaps the board.
  const [{ puzzle }] = useState(() => wordWebForDate(puzzles ?? [], date));
  return <WordWebGame date={date} puzzle={puzzle} {...rest} />;
}

function WordWebGame({
  date,
  puzzle,
  storage,
  onComplete,
}: DailyGameProps & { date: string; puzzle: WordWebPuzzle }) {
  const {
    state: raw,
    setState,
    stats,
    recordHistory,
  } = useDailyProgress<WordWebState>("wordweb", date, storage, () => initialState(puzzle, date));
  // Saved state is checked against this puzzle and date before use.
  const state = useMemo(() => (raw ? restoreState(raw, puzzle, date) : null), [raw, puzzle, date]);
  const restored = useRef(false);
  useEffect(() => {
    if (raw && !restored.current) {
      restored.current = true;
      setState(restoreState(raw, puzzle, date));
    }
  }, [raw, puzzle, date, setState]);

  // The newest state, updated synchronously, so events that land before
  // React re-renders (fast typing, a paste, a double-clicked Hint) build on
  // each other instead of on a stale render.
  const latest = useRef<WordWebState | null>(null);
  latest.current = state;
  const apply = useCallback(
    (fn: (s: WordWebState) => WordWebState) => {
      const cur = latest.current;
      if (!cur) return;
      const next = fn(cur);
      if (next === cur) return;
      latest.current = next;
      setState(next);
    },
    [setState],
  );

  const [message, setMessage] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [flash, setFlash] = useState<{ id: string; kind: FlashKind; n: number } | null>(null);
  /** Cells that just appeared → stagger delay, for the unfold animation. */
  const [unfolding, setUnfolding] = useState<Map<string, number>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const announce = useCallback((text: string) => {
    // Re-set so the same sentence twice is still read out.
    setAnnouncement("");
    window.requestAnimationFrame(() => setAnnouncement(text));
  }, []);

  useActivePlayClock(!!state && !state.done, (ms) => apply((s) => tick(s, ms)));

  // ── Derived view ─────────────────────────────────────────────────────
  const visible = state ? visibleAnswers(puzzle, state) : [];
  const fixed = useMemo(
    () => (state ? fixedCells(puzzle, state) : new Map<string, string>()),
    [puzzle, state],
  );
  const active = state?.active ? (puzzle.answers.find((a) => a.id === state.active) ?? null) : null;
  const hint = state ? hintStatus(puzzle, state) : null;
  const hintSeconds = hint ? Math.ceil(hint.remainingMs / 1000) : 0;

  // The hint timer is shared by the whole puzzle: announce once each time it runs out.
  const hintReady = !!state && !state.done && state.hintCooldownMs <= 0;
  const wasReady = useRef(hintReady);
  useEffect(() => {
    if (hintReady && !wasReady.current) announce("Hint available.");
    wasReady.current = hintReady;
  }, [hintReady, announce]);

  const result = useMemo<GameResult | null>(() => {
    if (!state?.done || !state.result) return null;
    const secs = Math.round(state.result.elapsedMs / 1000);
    return {
      gameId: "wordweb",
      date,
      puzzleNumber: puzzleNumber(date),
      solved: true,
      durationSec: secs,
      stats: [
        { label: "Time", value: formatClock(secs) },
        { label: "Hints", value: String(state.result.hintsUsed) },
        { label: "Guesses", value: String(state.result.guessCount) },
      ],
      score: { hints: state.result.hintsUsed, moves: state.result.guessCount },
      proof: { puzzleId: puzzle.id, log: state.log },
      shareText: wordWebShareText(puzzle, state, date),
    };
  }, [state, date, puzzle]);
  useCompletion(result, onComplete, recordHistory);

  // ── Actions ──────────────────────────────────────────────────────────
  const focusInput = useCallback(() => inputRef.current?.focus({ preventScroll: true }), []);

  // Desktop: be ready to type straight away. (Touch devices wait for a tap, so
  // the keyboard doesn't pop up uninvited.)
  const playing = !!state && !state.done;
  useEffect(() => {
    if (playing && window.matchMedia?.("(pointer: fine)").matches) focusInput();
  }, [playing, focusInput]);

  const showFlash = useCallback((id: string, kind: FlashKind) => {
    window.clearTimeout(flashTimer.current);
    setFlash((f) => ({ id, kind, n: (f?.n ?? 0) + 1 }));
    flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const react = useCallback(
    (next: WordWebState, outcome: SubmitOutcome | null, revealed: string[], id: string | null) => {
      if (!outcome || !id) return;
      const word = puzzle.answers.find((a) => a.id === id) as WordWebAnswer;
      switch (outcome) {
        case "correct": {
          showFlash(id, "good");
          setMessage(null);
          const after = next;
          const fresh = new Map<string, number>();
          for (const rid of revealed) {
            const r = puzzle.answers.find((a) => a.id === rid) as WordWebAnswer;
            const cells = cellsOf(r);
            // Unfold outward from where it crosses the word just solved.
            const anchor = cells.findIndex(([rr, cc]) =>
              cellsOf(word).some(([wr, wc]) => wr === rr && wc === cc),
            );
            cells.forEach(([rr, cc], i) => {
              if (i !== anchor) fresh.set(cellKey(rr, cc), Math.abs(i - Math.max(0, anchor)));
            });
          }
          setUnfolding(fresh);
          if (after.done) announce(`${word.display} is correct. Puzzle complete!`);
          else if (revealed.length)
            announce(
              `${word.display} is correct. ${revealed.length === 1 ? "A new word" : `${revealed.length} new words`} revealed. ${describe(puzzle.answers.find((a) => a.id === after.active) as WordWebAnswer)} selected.`,
            );
          else announce(`${word.display} is correct.`);
          break;
        }
        case "incorrect":
          showFlash(id, "bad");
          setMessage(null);
          announce("Not the answer. Try again.");
          break;
        case "alternate":
          showFlash(id, "close");
          setMessage(CLOSE_MESSAGE);
          announce(CLOSE_MESSAGE);
          break;
        case "repeat":
          showFlash(id, "repeat");
          setMessage("You've already tried that one.");
          announce("Already tried that word.");
          break;
        case "incomplete":
          showFlash(id, "incomplete");
          announce("Fill every box before submitting.");
          break;
        default:
          break;
      }
    },
    [puzzle, showFlash, announce],
  );

  const submit = () => {
    const cur = latest.current;
    if (!cur?.active) return;
    const res = submitGuess(puzzle, cur, cur.active);
    apply(() => res.state);
    react(res.state, res.outcome, res.revealed, cur.active);
    focusInput();
  };

  const type = (text: string) => {
    const cur = latest.current;
    if (!cur) return;
    let next = cur;
    let graded: ReturnType<typeof typeLetter> = null;
    for (const ch of text) {
      const res = typeLetter(puzzle, next, ch);
      if (!res) continue;
      next = res.state;
      if (res.outcome) {
        graded = res;
        break;
      }
    }
    if (next === cur) return;
    apply(() => next);
    setMessage(null);
    if (graded) react(graded.state, graded.outcome, graded.revealed, cur.active);
  };

  const select = (id: string) => {
    const cur = latest.current;
    if (!cur) return;
    apply((s) => selectAnswer(puzzle, s, id));
    setMessage(null);
    const a = puzzle.answers.find((x) => x.id === id);
    if (a && id !== cur.active) announce(`${describe(a)} selected.`);
    focusInput();
  };

  const cycle = (step: 1 | -1) => {
    const cur = latest.current;
    if (!cur) return;
    const list = openAnswers(puzzle, cur);
    if (list.length < 2) return;
    const i = list.findIndex((a) => a.id === cur.active);
    select(list[(i + step + list.length) % list.length].id);
  };

  const onHint = () => {
    const cur = latest.current;
    const word = cur && puzzle.answers.find((a) => a.id === cur.active);
    if (!cur || !word) return;
    // takeHint is a no-op until the cooldown restarts, so a second click
    // (even before React re-renders) can't take another.
    const res = takeHint(puzzle, cur);
    if (res.index === null) return;
    apply(() => res.state);
    announce(`Hint: letter ${res.index + 1} of ${word.grid.length} is ${word.grid[res.index]}.`);
    focusInput();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Backspace") {
      e.preventDefault();
      apply((s) => backspace(puzzle, s));
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      cycle(1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      cycle(-1);
    } else if (/^[a-zA-Z]$/.test(e.key)) {
      e.preventDefault();
      type(e.key);
    }
  };

  // Touch keyboards (and IMEs) arrive as input events instead of keydowns.
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    e.target.value = "";
    type(text);
  };

  if (!state) return <GameLoading />;

  // ── Board geometry ───────────────────────────────────────────────────
  // The board reserves the finished puzzle's size; the visible part is
  // centred inside it and slides gently as the web grows.
  const visibleCells = visible.flatMap(cellsOf);
  const vb = boundsOf(visibleCells);
  const shiftX = ((puzzle.cols - (vb.minCol + vb.maxCol + 1)) / 2 / puzzle.cols) * 100;
  const shiftY = ((puzzle.rows - (vb.minRow + vb.maxRow + 1)) / 2 / puzzle.rows) * 100;
  const solvedSet = new Set(state.solved);
  const activeCells = new Set(active ? cellsOf(active).map(([r, c]) => cellKey(r, c)) : []);
  const hinted = new Set(state.hinted);
  const startCells = cellsOf(puzzle.answers.find((a) => a.id === puzzle.start) as WordWebAnswer);
  const given = new Set(puzzle.revealed.map((i) => cellKey(...startCells[i])));
  const flashCells = new Set(
    flash
      ? cellsOf(puzzle.answers.find((a) => a.id === flash.id) as WordWebAnswer).map(([r, c]) =>
          cellKey(r, c),
        )
      : [],
  );

  const cells = new Map<string, { r: number; c: number; owners: WordWebAnswer[] }>();
  for (const a of visible)
    for (const [r, c] of cellsOf(a)) {
      const k = cellKey(r, c);
      const cell = cells.get(k) ?? { r, c, owners: [] };
      cell.owners.push(a);
      cells.set(k, cell);
    }
  const firstCellOf = new Map(visible.map((a) => [cellKey(a.row, a.col), a]));

  const onCellClick = (owners: WordWebAnswer[]) => {
    const choices = owners.filter((o) => !solvedSet.has(o.id));
    if (!choices.length) return;
    // A crossing cell toggles between its two words.
    const current = choices.findIndex((o) => o.id === state.active);
    select(choices[(current + 1) % choices.length].id);
  };

  const weekdayName = WEEKDAY_NAMES[puzzle.weekday];

  return (
    <GameShell
      game="wordweb"
      date={date}
      chips={[
        {
          label: "Time",
          value: formatClock(
            // Live time ticks down to the second; the final result matches the share text.
            state.result
              ? Math.round(state.result.elapsedMs / 1000)
              : Math.floor(state.elapsedMs / 1000),
          ),
        },
        { label: "Hints", value: String(state.result?.hintsUsed ?? state.hintsUsed) },
        { label: "Guesses", value: String(state.result?.guessCount ?? state.guessCount) },
      ]}
      banner={
        <span className="ag-ww-banner">
          <span className="ag-ww-banner__label">Category</span>
          <span className="ag-banner__strong ag-ww-banner__category">
            {puzzle.category.toUpperCase()}
          </span>
          <span className="ag-ww-banner__day">
            {weekdayName} · {puzzle.difficulty}
          </span>
        </span>
      }
    >
      <div className="ag-ww">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: the board is a pointer view; the word list is the keyboard control */}
        <div
          className="ag-ww-board"
          data-done={state.done}
          style={{
            ["--rows" as string]: puzzle.rows,
            ["--cols" as string]: puzzle.cols,
            aspectRatio: `${puzzle.cols} / ${puzzle.rows}`,
          }}
          onClick={focusInput}
          aria-hidden="true"
        >
          <div className="ag-ww-layer" style={{ transform: `translate(${shiftX}%, ${shiftY}%)` }}>
            {[...cells].map(([k, { r, c, owners }]) => {
              const solved = owners.some((o) => solvedSet.has(o.id));
              const letter = fixed.get(k) ?? state.typed[k] ?? "";
              const delay = unfolding.get(k);
              const starts = firstCellOf.get(k);
              return (
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users pick words from the word list
                <div
                  key={k}
                  className="ag-ww-cell"
                  data-solved={solved}
                  data-active={activeCells.has(k)}
                  data-given={!solved && given.has(k)}
                  data-hinted={!solved && hinted.has(k)}
                  data-typed={!fixed.has(k) && !!state.typed[k]}
                  data-flash={flashCells.has(k) ? flash?.kind : undefined}
                  data-unfold={delay !== undefined}
                  style={{
                    left: `${(c / puzzle.cols) * 100}%`,
                    top: `${(r / puzzle.rows) * 100}%`,
                    width: `${100 / puzzle.cols}%`,
                    height: `${100 / puzzle.rows}%`,
                    ...(delay !== undefined
                      ? { animationDelay: `${delay * UNFOLD_STEP_MS}ms` }
                      : {}),
                  }}
                  onClick={() => onCellClick(owners)}
                >
                  <span className="ag-ww-cell__box">
                    <span className="ag-ww-cell__letter">{letter}</span>
                    {starts && solvedSet.has(starts.id) && (
                      <span className="ag-ww-cell__badge">✓</span>
                    )}
                    {starts &&
                      flash?.id === starts.id &&
                      (flash.kind === "bad" || flash.kind === "repeat") && (
                        <span key={flash.n} className="ag-ww-cell__badge ag-ww-cell__badge--bad">
                          ✕
                        </span>
                      )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Keyboard target: typing goes to the active word. */}
        <input
          ref={inputRef}
          className="ag-ww-input"
          aria-label={
            active
              ? `Type ${describe(active)}. Enter to check, arrows to switch words.`
              : "Puzzle complete"
          }
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          enterKeyHint="go"
          disabled={state.done}
          onKeyDown={onKeyDown}
          onChange={onChange}
        />

        {!state.done && (
          <div className="ag-ww-controls">
            <p
              className="ag-ww-message"
              data-tone={message === CLOSE_MESSAGE ? "close" : "info"}
              aria-hidden="true"
            >
              {message ?? (active ? `${describe(active)} — type, then press Enter.` : "")}
            </p>
            <div className="ag-ww-actions">
              <Button
                variant="accent"
                className="ag-ww-hint"
                disabled={!hint?.available}
                aria-describedby="ag-ww-hint-status"
                onClick={onHint}
              >
                Hint
              </Button>
              <span id="ag-ww-hint-status" className="ag-ww-hint-status">
                {hint?.reason === "final-letter"
                  ? "No hint: the last letter is yours to find."
                  : hint?.reason === "cooldown"
                    ? `Hint in ${hintSeconds}s`
                    : hint?.available
                      ? "Hint ready"
                      : ""}
              </span>
              <Button variant="primary" onClick={submit}>
                Check ↵
              </Button>
            </div>
          </div>
        )}

        <WordList
          visible={visible}
          solved={solvedSet}
          active={state.active}
          letters={(id) => currentLetters(puzzle, state, id)}
          onSelect={select}
          done={state.done}
        />

        <div className="ag-sr" aria-live="polite" aria-atomic="true">
          {announcement}
        </div>
      </div>

      {result && (
        <ResultPanel
          solved
          headline="Web complete."
          detail={`${puzzle.category} · ${weekdayName} · ${puzzle.difficulty}. A new web unfolds at midnight.`}
          stats={result.stats}
          shareText={result.shareText}
          history={stats}
        />
      )}
    </GameShell>
  );
}

function describe(a: WordWebAnswer): string {
  return `${a.direction === "across" ? "Across" : "Down"}, ${a.grid.length} letters`;
}

/** The accessible way to pick a word: one button per visible word. */
function WordList({
  visible,
  solved,
  active,
  letters,
  onSelect,
  done,
}: {
  visible: WordWebAnswer[];
  solved: Set<string>;
  active: string | null;
  letters: (id: string) => string[];
  onSelect: (id: string) => void;
  done: boolean;
}) {
  return (
    <ul className="ag-ww-words" aria-label="Words">
      {visible.map((a) => {
        const isSolved = solved.has(a.id);
        const l = letters(a.id);
        const filled = l.filter(Boolean).length;
        return (
          <li key={a.id}>
            <button
              type="button"
              className="ag-ww-word"
              data-solved={isSolved}
              data-active={a.id === active}
              aria-pressed={a.id === active}
              disabled={isSolved || done}
              onClick={() => onSelect(a.id)}
              aria-label={
                isSolved
                  ? `${a.display}, ${a.direction}, solved`
                  : `${describe(a)}, ${filled} of ${l.length} filled${a.id === active ? ", selected" : ""}`
              }
            >
              <span className="ag-ww-word__dir" aria-hidden="true">
                {a.direction === "across" ? "→" : "↓"}
              </span>
              <span className="ag-ww-word__slots" aria-hidden="true">
                {l.map((ch, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length slots
                  <span key={i} className="ag-ww-word__slot">
                    {ch || "·"}
                  </span>
                ))}
              </span>
              {isSolved && (
                <span className="ag-ww-word__ok" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
