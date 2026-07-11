import { useCallback, useEffect, useRef, useState } from "react";
import type { AssumptionDriftPack, GameResult, QuestionResponse } from "../../types.js";
import type { GameComponentProps } from "../registry.js";
import styles from "./AssumptionDrift.module.css";

// ---------------------------------------------------------------------------
// Persisted state shape for assumption_drift
// ---------------------------------------------------------------------------

interface PersistedState {
  startedAt: string;
  responses: QuestionResponse[];
  completed: boolean;
  completedAt?: string;
}

// ---------------------------------------------------------------------------
// Share-grid helpers
// ---------------------------------------------------------------------------

function buildShareText(
  pack: AssumptionDriftPack,
  responses: QuestionResponse[],
  isPerfect: boolean,
): string {
  const grid = responses.map((r) => (r.correct ? "🟩" : "🟥")).join("");
  const score = responses.filter((r) => r.correct).length;
  return [
    `Assumption Drift — ${pack.title}`,
    `${grid} ${score}/${responses.length}${isPerfect ? " ✨" : ""}`,
    pack.gameId,
  ].join("\n");
}

function buildResult(pack: AssumptionDriftPack, state: PersistedState): GameResult {
  const score = state.responses.filter((r) => r.correct).length;
  const maxScore = pack.payload.questions.length;
  const isPerfect = score === maxScore;
  const completedAt = state.completedAt ?? new Date().toISOString();
  const durationSec = Math.round(
    (new Date(completedAt).getTime() - new Date(state.startedAt).getTime()) / 1000,
  );
  return {
    schemaVersion: 1,
    gameType: pack.gameType,
    gameId: pack.gameId,
    packId: pack.packId,
    startedAt: state.startedAt,
    completedAt,
    durationSec,
    responses: state.responses,
    score,
    maxScore,
    isPerfect,
    shareText: buildShareText(pack, state.responses, isPerfect),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STORAGE_KEY_PREFIX = "assumption-drift";

export function AssumptionDrift({ pack, storage, onComplete }: GameComponentProps) {
  const typedPack = pack as AssumptionDriftPack;
  const storageKey = `${STORAGE_KEY_PREFIX}:${typedPack.packId}`;

  const [loaded, setLoaded] = useState(false);
  const [startedAt, setStartedAt] = useState<string>("");

  // one question at a time; v1 packs have exactly 1 question but array is supported
  const [questionIndex, setQuestionIndex] = useState(0);
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [responses, setResponses] = useState<QuestionResponse[]>([]);
  const [completed, setCompleted] = useState(false);
  const [completedAt, setCompletedAt] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const completedRef = useRef(false);

  // ── Load persisted state on mount ────────────────────────────────────────
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs only once on mount
  useEffect(() => {
    storage.load(storageKey).then((raw) => {
      const saved = raw as PersistedState | null;
      if (saved) {
        setStartedAt(saved.startedAt);
        setResponses(saved.responses);
        setCompleted(saved.completed);
        setCompletedAt(saved.completedAt);
        // Resume at next unanswered question
        setQuestionIndex(saved.responses.length);
        if (saved.completed) completedRef.current = true;
      } else {
        setStartedAt(new Date().toISOString());
      }
      setLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // ── Fire onComplete once when the game finishes ───────────────────────────
  useEffect(() => {
    if (completed && loaded && !completedRef.current) {
      completedRef.current = true;
      const state: PersistedState = { startedAt, responses, completed: true, completedAt };
      const result = buildResult(typedPack, state);
      onComplete(result);
    }
  }, [completed, loaded, startedAt, responses, completedAt, typedPack, onComplete]);

  // Also fire if we loaded an already-completed state
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally runs only when `loaded` changes
  useEffect(() => {
    if (loaded && completed && completedRef.current) {
      const state: PersistedState = { startedAt, responses, completed: true, completedAt };
      const result = buildResult(typedPack, state);
      onComplete(result);
    }
    // Only on initial load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const persist = useCallback(
    async (newResponses: QuestionResponse[], done: boolean, doneAt?: string) => {
      const state: PersistedState = {
        startedAt,
        responses: newResponses,
        completed: done,
        completedAt: doneAt,
      };
      await storage.save(storageKey, state);
    },
    [storage, storageKey, startedAt],
  );

  if (!loaded) return <div className={styles.loading}>Loading…</div>;

  const questions = typedPack.payload.questions;

  // ── Results view ──────────────────────────────────────────────────────────
  if (completed) {
    const score = responses.filter((r) => r.correct).length;
    const isPerfect = score === questions.length;
    const shareText = buildShareText(typedPack, responses, isPerfect);

    const handleCopy = () => {
      navigator.clipboard.writeText(shareText).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    return (
      <div className={styles.container}>
        <h2 className={styles.title}>{typedPack.title}</h2>
        <div className={styles.results}>
          <p className={styles.score}>
            Score: {score}/{questions.length} {isPerfect && "✨ Perfect!"}
          </p>
          <div className={styles.shareGrid}>
            {responses.map((r) => (
              <span key={r.questionId} className={styles.shareCell}>
                {r.correct ? "🟩" : "🟥"}
              </span>
            ))}
          </div>
          <button type="button" className={styles.button} onClick={handleCopy}>
            {copied ? "Copied!" : "Copy result"}
          </button>
        </div>
        <p className={styles.completionMessage}>
          You've completed today's puzzle! Come back tomorrow for the next one.
        </p>
        {responses.map((r, i) => {
          const q = questions[i];
          const chosen = q?.choices.find((c) => c.id === r.choiceId);
          const correct = q?.choices.find((c) => c.id === q.answer);
          return (
            <div key={r.questionId} className={styles.reviewCard}>
              <p className={styles.reviewQuestion}>{q?.prompt}</p>
              <p>
                Your answer:{" "}
                <span className={r.correct ? styles.correct : styles.incorrect}>
                  {chosen?.label}
                </span>
              </p>
              {!r.correct && (
                <p>
                  Correct: <span className={styles.correct}>{correct?.label}</span>
                </p>
              )}
              <p className={styles.solutionText}>{q?.solution.text}</p>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Active question view ──────────────────────────────────────────────────
  const question = questions[questionIndex];
  if (!question) return null;

  const handleSubmit = async () => {
    if (!selectedChoiceId) return;
    const correct = selectedChoiceId === question.answer;
    const response: QuestionResponse = {
      questionId: question.id,
      choiceId: selectedChoiceId,
      correct,
    };
    const newResponses = [...responses, response];
    setResponses(newResponses);
    setSubmitted(true);

    const isLast = questionIndex >= questions.length - 1;
    if (isLast) {
      const now = new Date().toISOString();
      setCompletedAt(now);
      await persist(newResponses, true, now);
      setCompleted(true);
    } else {
      await persist(newResponses, false);
    }
  };

  const handleNext = () => {
    setQuestionIndex((i) => i + 1);
    setSelectedChoiceId(null);
    setSubmitted(false);
  };

  const isLast = questionIndex >= questions.length - 1;
  const correctChoice = question.choices.find((c) => c.id === question.answer);

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>{typedPack.title}</h2>
      <p className={styles.instructions}>{typedPack.payload.instructions}</p>

      <div className={styles.questionLayout}>
        <div className={styles.card}>
          <p className={styles.label}>Scenario</p>
          <p className={styles.scenario}>{question.scenario}</p>

          <p className={styles.label}>Drift</p>
          <p className={styles.drift}>{question.drift}</p>

          <p className={styles.prompt}>{question.prompt}</p>
        </div>

        <div className={styles.choicesPanel}>
          <div className={styles.choices}>
            {question.choices.map((choice) => {
              let choiceClass = styles.choice;
              if (submitted) {
                if (choice.id === question.answer)
                  choiceClass = `${styles.choice} ${styles.choiceCorrect}`;
                else if (choice.id === selectedChoiceId)
                  choiceClass = `${styles.choice} ${styles.choiceWrong}`;
              } else if (choice.id === selectedChoiceId) {
                choiceClass = `${styles.choice} ${styles.choiceSelected}`;
              }

              return (
                <button
                  key={choice.id}
                  type="button"
                  className={choiceClass}
                  onClick={() => !submitted && setSelectedChoiceId(choice.id)}
                  disabled={submitted}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className={`${styles.button} ${submitted ? styles.visuallyHidden : ""}`}
            onClick={handleSubmit}
            disabled={!selectedChoiceId || submitted}
          >
            Submit
          </button>

          <div className={`${styles.feedback} ${!submitted ? styles.visuallyHidden : ""}`}>
            <p className={selectedChoiceId === question.answer ? styles.correct : styles.incorrect}>
              {selectedChoiceId === question.answer
                ? "✅ Correct!"
                : `❌ The answer was: ${correctChoice?.label}`}
            </p>
            <p className={styles.solutionText}>{question.solution.text}</p>
            {!isLast && (
              <button type="button" className={styles.button} onClick={handleNext}>
                Next question
              </button>
            )}
            {isLast && (
              <p className={styles.solutionText}>
                <em>Calculating results…</em>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
