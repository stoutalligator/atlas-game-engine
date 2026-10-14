import { useCallback, useEffect, useMemo } from "react";
import { formatClock, puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate, useTicker } from "../../core/progress.js";
import { shareText } from "../../core/share.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import {
  type AssumptionDriftPack,
  type DriftQuestion,
  packForDate,
  packSubtitle,
  parseAssumptionDriftPack,
} from "./pack.js";

interface DriftState {
  packId: string;
  /** questionId → chosen choice id, once locked in. */
  answers: Record<string, string>;
  /** Choice highlighted but not yet locked in. */
  pending: string | null;
  index: number;
  elapsed: number;
  done: boolean;
}

export interface AssumptionDriftProps extends DailyGameProps {
  /** Every pack for this exam, in rotation order. Raw JSON is validated. */
  packs: readonly unknown[];
}

const LETTERS = "ABCDEF";

export function AssumptionDrift({
  packs,
  date: dateProp,
  storage,
  onComplete,
}: AssumptionDriftProps) {
  const date = usePuzzleDate(dateProp);
  const parsed = useMemo(() => {
    try {
      return { packs: packs.map(parseAssumptionDriftPack), error: null };
    } catch (e) {
      return { packs: [] as AssumptionDriftPack[], error: (e as Error).message };
    }
  }, [packs]);

  if (parsed.error) return <div className="ag-root ag-error">Pack error: {parsed.error}</div>;
  if (!date) return <GameLoading />;
  const pack = packForDate(parsed.packs, date);
  if (!pack)
    return <div className="ag-root ag-error">No Assumption Drift packs for this exam yet.</div>;
  return <DriftGame key={date} pack={pack} date={date} storage={storage} onComplete={onComplete} />;
}

function DriftGame({
  pack,
  date,
  storage,
  onComplete,
}: { pack: AssumptionDriftPack; date: string } & Omit<DailyGameProps, "date">) {
  const questions = pack.payload.questions;
  const { state, setState, stats, recordHistory } = useDailyProgress<DriftState>(
    "assumption-drift",
    date,
    storage,
    () => ({ packId: pack.packId, answers: {}, pending: null, index: 0, elapsed: 0, done: false }),
  );

  useTicker(!!state && !state.done, () => setState((s) => ({ ...s, elapsed: s.elapsed + 1 })));

  const score = state ? questions.filter((q) => state.answers[q.id] === q.answer).length : 0;
  const result = useMemo<GameResult | null>(() => {
    if (!state?.done) return null;
    const grid = questions.map((q) => (state.answers[q.id] === q.answer ? "🟩" : "🟥")).join("");
    return {
      gameId: "assumption-drift",
      date,
      puzzleNumber: puzzleNumber(date),
      solved: score === questions.length,
      durationSec: state.elapsed,
      stats: [
        { label: "Correct", value: `${score}/${questions.length}` },
        { label: "Time", value: formatClock(state.elapsed) },
      ],
      score: { correct: score, total: questions.length },
      proof: { packId: pack.packId, answers: state.answers },
      shareText: shareText("assumption-drift", date, [
        packSubtitle(pack),
        `${grid} ${score}/${questions.length}`,
      ]),
    };
  }, [state, questions, score, date, pack]);
  useCompletion(result, onComplete, recordHistory);

  const lockIn = useCallback(() => {
    setState((s) => {
      const q = questions[s.index];
      if (!q || !s.pending || s.answers[q.id]) return s;
      const answers = { ...s.answers, [q.id]: s.pending };
      const done = questions.every((x) => answers[x.id]);
      return { ...s, answers, pending: null, done };
    });
  }, [setState, questions]);

  const choose = useCallback(
    (choiceId: string) =>
      setState((s) => (s.answers[questions[s.index]?.id] ? s : { ...s, pending: choiceId })),
    [setState, questions],
  );

  // Keys 1–6 / A–F pick a choice, Enter locks it in.
  useEffect(() => {
    if (!state || state.done) return;
    const q = questions[state.index];
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      const k = e.key.toUpperCase();
      const idx = /^[1-6]$/.test(k) ? Number(k) - 1 : LETTERS.indexOf(k);
      if (idx >= 0 && idx < q.choices.length) choose(q.choices[idx].id);
      else if (e.key === "Enter") lockIn();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, questions, choose, lockIn]);

  if (!state) return <GameLoading />;

  const visible = state.done ? questions : questions.slice(0, state.index + 1);

  return (
    <GameShell
      game="assumption-drift"
      date={date}
      chips={[
        { label: "Time", value: formatClock(state.elapsed) },
        ...(questions.length > 1
          ? [
              {
                label: "Question",
                value: `${Math.min(state.index + 1, questions.length)}/${questions.length}`,
              },
            ]
          : []),
      ]}
      banner={
        <div className="ag-drift-topic">
          <span className="ag-drift-topic__name">{packSubtitle(pack)}</span>
          {pack.meta?.tags?.map((t) => (
            <span key={t} className="ag-pill">
              {t}
            </span>
          ))}
        </div>
      }
    >
      {visible.map((q, i) => {
        const locked = state.answers[q.id];
        const isCurrent = !state.done && i === state.index;
        if (!isCurrent && !locked) return null;
        return (
          <QuestionCard
            key={q.id}
            question={q}
            number={questions.length > 1 ? i + 1 : null}
            pending={isCurrent ? state.pending : null}
            locked={locked ?? null}
            onChoose={choose}
            onLock={lockIn}
          />
        );
      })}

      {!state.done &&
        state.answers[questions[state.index]?.id] &&
        state.index < questions.length - 1 && (
          <div className="ag-row ag-row--end">
            <Button
              variant="primary"
              onClick={() => setState((s) => ({ ...s, index: s.index + 1 }))}
            >
              Next question →
            </Button>
          </div>
        )}

      {result && (
        <ResultPanel
          solved={result.solved}
          headline={
            result.solved
              ? questions.length === 1
                ? "Called it."
                : "Perfect read."
              : questions.length === 1
                ? "The drift got you."
                : `${score} of ${questions.length} called.`
          }
          detail={
            result.solved
              ? "Your intuition held up. Keep the streak going tomorrow."
              : "Read the explanation above — tomorrow's scenario is a fresh shot."
          }
          stats={result.stats}
          shareText={result.shareText}
          history={stats}
        />
      )}
    </GameShell>
  );
}

function QuestionCard({
  question,
  number,
  pending,
  locked,
  onChoose,
  onLock,
}: {
  question: DriftQuestion;
  number: number | null;
  pending: string | null;
  locked: string | null;
  onChoose: (id: string) => void;
  onLock: () => void;
}) {
  const revealed = locked !== null;
  const correct = locked === question.answer;
  const answerLabel = question.choices.find((c) => c.id === question.answer)?.label;

  return (
    <div className="ag-drift">
      <div className="ag-drift__story">
        <div className="ag-card">
          <div className="ag-card__label">{number ? `Scenario ${number}` : "Scenario"}</div>
          <p className="ag-card__text">{question.scenario}</p>
        </div>
        <div className="ag-drift__arrow" aria-hidden="true">
          ↓
        </div>
        <div className="ag-card ag-card--accent">
          <div className="ag-card__label">The drift</div>
          <p className="ag-card__text">{question.drift}</p>
        </div>
      </div>

      <div className="ag-drift__ask">
        <p className="ag-drift__prompt">{question.prompt}</p>
        <fieldset className="ag-choices" aria-label="Answer choices">
          {question.choices.map((c, i) => {
            const state = revealed
              ? c.id === question.answer
                ? "correct"
                : c.id === locked
                  ? "wrong"
                  : "idle"
              : c.id === pending
                ? "selected"
                : "idle";
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={c.id === (locked ?? pending)}
                className="ag-choice"
                data-state={state}
                disabled={revealed}
                onClick={() => onChoose(c.id)}
              >
                <span className="ag-choice__key">{LETTERS[i]}</span>
                <span className="ag-choice__label">{c.label}</span>
              </button>
            );
          })}
        </fieldset>

        {!revealed && (
          <Button variant="accent" className="ag-block" disabled={!pending} onClick={onLock}>
            Lock it in
          </Button>
        )}

        {revealed && (
          <div className="ag-explain" data-correct={correct}>
            <div className="ag-explain__verdict">
              {correct ? "✓ Correct" : `✕ The answer was “${answerLabel}”`}
            </div>
            <p className="ag-explain__text">{question.solution.text}</p>
          </div>
        )}
      </div>
    </div>
  );
}
