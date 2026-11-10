import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate } from "../../core/progress.js";
import { shareText } from "../../core/share.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import {
  type ChartHit,
  type RevealHandle,
  burst,
  drawDayChart,
  drawDistribution,
  drawGhost,
  runReveal,
} from "./chart.js";
import {
  BLACK_SWAN_MAX_SCORE,
  BLACK_SWAN_SECONDS,
  BLACK_SWAN_TIERS,
  type BlackSwanDistribution,
  type BlackSwanSlotResult,
  type BlackSwanTierKey,
  type GuessMatch,
  blackSwanShareLine,
  summarizeDay,
} from "./logic.js";

export interface BlackSwanPrompt {
  slot: number;
  questionId: string;
  category: string;
  prompt: string;
  /** How many accepted answers exist (shown, never listed). */
  answerCount: number;
}

export interface BlackSwanSlotState {
  slot: number;
  status: "new" | "open" | "done";
  /** Time left on an open prompt. */
  remainingMs?: number;
  result?: BlackSwanSlotResult;
}

export interface BlackSwanDay {
  date: string;
  prompts: BlackSwanPrompt[];
  slots: BlackSwanSlotState[];
}

/**
 * The host's side of Black Swan. Answer lists and rarity data stay on the
 * host's server: the component only ever sees a prompt, a match for what the
 * player typed, and the scored result.
 */
export interface BlackSwanApi {
  load(date: string): Promise<BlackSwanDay | null>;
  /** Starts the prompt's clock (the server decides when time is up). */
  open(date: string, slot: number): Promise<{ remainingMs: number } | null>;
  /** Doesn't lock anything in: tells the player whether their guess is on the list. */
  check(date: string, slot: number, input: string): Promise<GuessMatch | null>;
  /** Locks in an accepted answer (label) or a miss (null) and scores it. */
  lock(
    date: string,
    slot: number,
    label: string | null,
    input: string,
  ): Promise<BlackSwanSlotResult | null>;
  /**
   * Optional: every finished player's score for the day (see dayDistribution),
   * for the summary's distribution chart. Called once the player has finished.
   */
  distribution?(date: string): Promise<BlackSwanDistribution | null>;
}

export interface BlackSwanProps extends DailyGameProps {
  api: BlackSwanApi;
}

export function BlackSwan({ api, date: dateProp, storage, onComplete }: BlackSwanProps) {
  const date = usePuzzleDate(dateProp);
  if (!date) return <GameLoading />;
  return (
    <BlackSwanGame key={date} api={api} date={date} storage={storage} onComplete={onComplete} />
  );
}

type Phase =
  | { kind: "intro" }
  | { kind: "prompt"; slot: number; deadline: number }
  | { kind: "reveal"; slot: number }
  | { kind: "summary" };

const tierInfo = (key: BlackSwanTierKey) =>
  BLACK_SWAN_TIERS.find((t) => t.key === key) ?? BLACK_SWAN_TIERS[0];
const count = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight"];
const word = (n: number) => NUMBER_WORDS[n] ?? String(n);
/** "Better than X%" from a distribution, or null when nobody else has finished. */
function betterThan(d: BlackSwanDistribution | null): number | null {
  if (!d || d.players < 2) return null;
  return Math.round((d.below / (d.players - 1)) * 100);
}
/** Upper-case for labels, keeping σ lowercase (CSS text-transform would make it Σ). */
const caps = (s: string) => s.toUpperCase().replace("Σ", "σ");

function BlackSwanGame({
  api,
  date,
  storage,
  onComplete,
}: { api: BlackSwanApi; date: string } & Omit<DailyGameProps, "date">) {
  const [day, setDay] = useState<BlackSwanDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Array<BlackSwanSlotResult | undefined>>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });
  const [dist, setDist] = useState<BlackSwanDistribution | null>(null);
  const progress = useDailyProgress<{ started: boolean }>("black-swan", date, storage, () => ({
    started: false,
  }));

  useEffect(() => {
    let cancelled = false;
    api
      .load(date)
      .then((d) => {
        if (cancelled) return;
        if (!d) return setError("Today's Black Swan isn't available. Try again shortly.");
        setDay(d);
        setResults(d.slots.map((s) => s.result));
        const open = d.slots.find((s) => s.status === "open");
        if (d.slots.every((s) => s.status === "done")) setPhase({ kind: "summary" });
        else if (open)
          setPhase({
            kind: "prompt",
            slot: open.slot,
            deadline: Date.now() + (open.remainingMs ?? 0),
          });
      })
      .catch(() => !cancelled && setError("Couldn't load today's Black Swan."));
    return () => {
      cancelled = true;
    };
  }, [api, date]);

  const done = results.filter(Boolean) as BlackSwanSlotResult[];
  const allDone = !!day && done.length === day.prompts.length;
  const summary = summarizeDay(done);

  const result = useMemo<GameResult | null>(() => {
    if (!allDone) return null;
    return {
      gameId: "black-swan",
      date,
      puzzleNumber: puzzleNumber(date),
      solved: true,
      durationSec: 0,
      stats: [
        { label: "Score", value: `${summary.score}/${BLACK_SWAN_MAX_SCORE}` },
        { label: "Black Swans", value: String(summary.blackSwans) },
        { label: "Answered", value: `${done.filter((r) => r.label).length}/${done.length}` },
      ],
      score: { points: summary.score, rarity: summary.rarity },
      proof: null,
      shareText: shareText("black-swan", date, [blackSwanShareLine(done)]),
    };
  }, [allDone, date, done, summary.score, summary.blackSwans, summary.rarity]);
  useCompletion(result, onComplete, progress.recordHistory);

  // Once the day is done, fetch everyone's scores for the distribution chart.
  useEffect(() => {
    if (!allDone || !api.distribution) return;
    let cancelled = false;
    api
      .distribution(date)
      .then((d) => !cancelled && setDist(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [allDone, api, date]);
  const better = betterThan(dist);

  const nextSlot = day ? day.prompts.findIndex((_, i) => !results[i]) : -1;

  const openSlot = useCallback(
    async (slot: number) => {
      progress.setState({ started: true });
      const r = await api.open(date, slot).catch(() => null);
      if (!r) return setError("Couldn't start that prompt.");
      setPhase({ kind: "prompt", slot, deadline: Date.now() + r.remainingMs });
    },
    [api, date, progress],
  );

  const onLocked = useCallback((slot: number, r: BlackSwanSlotResult) => {
    setResults((prev) => {
      const next = [...prev];
      next[slot] = r;
      return next;
    });
    setPhase({ kind: "reveal", slot });
  }, []);

  if (error) return <div className="ag-root ag-error">{error}</div>;
  if (!day || progress.state === null) return <GameLoading />;

  const prompt =
    phase.kind === "prompt" || phase.kind === "reveal" ? day.prompts[phase.slot] : null;

  return (
    <GameShell
      game="black-swan"
      date={date}
      chips={[
        {
          label: "Prompt",
          value: `${Math.min(done.length + (phase.kind === "prompt" ? 1 : 0), day.prompts.length)}/${day.prompts.length}`,
        },
        { label: "Score", value: String(summary.score) },
      ]}
    >
      <div className="ag-bs">
        {phase.kind !== "summary" && phase.kind !== "intro" && prompt && (
          <div className="ag-bs__head">
            <Pips results={results} count={day.prompts.length} current={phase.slot} />
            <span className="ag-pill">{prompt.category}</span>
          </div>
        )}

        {phase.kind === "intro" && (
          <Intro
            started={done.length > 0}
            count={day.prompts.length}
            categories={day.prompts.map((p) => p.category)}
            onStart={() => openSlot(nextSlot)}
          />
        )}

        {phase.kind === "prompt" && prompt && (
          <PromptView
            key={phase.slot}
            api={api}
            date={date}
            prompt={prompt}
            deadline={phase.deadline}
            onLocked={(r) => onLocked(phase.slot, r)}
          />
        )}

        {phase.kind === "reveal" && prompt && results[phase.slot] && (
          <Reveal
            key={phase.slot}
            prompt={prompt}
            result={results[phase.slot] as BlackSwanSlotResult}
            last={nextSlot === -1}
            onNext={() => (nextSlot === -1 ? setPhase({ kind: "summary" }) : openSlot(nextSlot))}
          />
        )}

        {phase.kind === "summary" && result && (
          <ResultPanel
            solved
            headline={`${summary.score} points`}
            detail={[
              summary.blackSwans
                ? `${count(summary.blackSwans, "Black Swan")} today.`
                : "No Black Swans today. Hunt the tail tomorrow.",
              better !== null ? `Better than ${better}% of today's players.` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            stats={result.stats}
            shareText={result.shareText}
            history={progress.stats}
          >
            <Recap prompts={day.prompts} results={results} dist={dist} />
          </ResultPanel>
        )}
      </div>
    </GameShell>
  );
}

function Pips({
  results,
  count,
  current,
}: { results: Array<BlackSwanSlotResult | undefined>; count: number; current: number }) {
  return (
    <div className="ag-bs__pips" aria-label={`Prompt ${current + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => {
        const r = results[i];
        return (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed row of five prompt slots
            key={i}
            className="ag-bs__pip"
            data-state={r ? (r.tier ?? "miss") : i === current ? "now" : "todo"}
          />
        );
      })}
    </div>
  );
}

function Intro({
  started,
  count: n,
  categories,
  onStart,
}: { started: boolean; count: number; categories: string[]; onStart: () => void }) {
  return (
    <div className="ag-bs__intro">
      <p className="ag-bs__lede">
        {word(n).replace(/^./, (c) => c.toUpperCase())} prompts, 25 seconds each. The obvious answer
        sits at the Mode; the obscure ones live out in the tail.
      </p>
      <div className="ag-bs__cats">
        {categories.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: categories can repeat; the list never reorders
          <span key={`${c}-${i}`} className="ag-pill">
            {c}
          </span>
        ))}
      </div>
      <div className="ag-bs__tiers">
        {BLACK_SWAN_TIERS.map((t) => (
          <div key={t.key} className="ag-bs__tier" data-tier={t.key}>
            <b>{t.name}</b>
            <span>{t.points} pts</span>
            <small>{t.blurb}</small>
          </div>
        ))}
      </div>
      <div className="ag-row ag-row--end">
        <span className="ag-bs__hint">
          {BLACK_SWAN_SECONDS} seconds per prompt · typos are forgiven · made-up answers don't count
        </span>
        <Button variant="primary" onClick={onStart}>
          {started ? "Continue →" : `Play today's ${word(n)} →`}
        </Button>
      </div>
    </div>
  );
}

function PromptView({
  api,
  date,
  prompt,
  deadline,
  onLocked,
}: {
  api: BlackSwanApi;
  date: string;
  prompt: BlackSwanPrompt;
  deadline: number;
  onLocked: (r: BlackSwanSlotResult) => void;
}) {
  const [text, setText] = useState("");
  const [left, setLeft] = useState(() => Math.max(0, deadline - Date.now()));
  const [pending, setPending] = useState<GuessMatch | null>(null);
  const [tries, setTries] = useState<string[]>([]);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const lockedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLCanvasElement>(null);
  const state = useRef({ text, pending });
  state.current = { text, pending };

  const lock = useCallback(
    async (label: string | null, input: string) => {
      if (lockedRef.current) return;
      lockedRef.current = true;
      setBusy(true);
      const r = await api.lock(date, prompt.slot, label, input).catch(() => null);
      if (r) onLocked(r);
      else {
        lockedRef.current = false;
        setBusy(false);
      }
    },
    [api, date, prompt.slot, onLocked],
  );

  // A new prompt brings the question and answer box into view together.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const top = root.getBoundingClientRect().top;
    const formBottom = root.querySelector(".ag-bs__form")?.getBoundingClientRect().bottom ?? top;
    if (top < 80 || formBottom > window.innerHeight) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      root.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, []);

  // A wrong answer remounts the field (to replay the shake): focus the new input.
  useEffect(() => {
    if (shake > 0) inputRef.current?.focus();
  }, [shake]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    const draw = () =>
      ghostRef.current &&
      drawGhost(
        ghostRef.current,
        `${prompt.answerCount.toLocaleString("en-US")} accepted answers · the crowd fills in after you lock in`,
      );
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [prompt.answerCount]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const ms = Math.max(0, deadline - Date.now());
      setLeft(ms);
      if (ms === 0) {
        window.clearInterval(id);
        const { pending: p, text: t } = state.current;
        void lock(p ? p.label : null, p ? t : ""); // a pending correction counts at the buzzer
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [deadline, lock]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (pending) return lock(pending.label, text);
    const input = text.trim();
    if (!input) return;
    setBusy(true);
    const m = await api.check(date, prompt.slot, input).catch(() => null);
    setBusy(false);
    if (!m) {
      setTries((t) => [...t, input]);
      setText("");
      setShake((n) => n + 1);
    } else if (m.kind === "exact") void lock(m.label, input);
    else setPending(m);
  };

  return (
    <div className="ag-bs__prompt" ref={rootRef}>
      <p className="ag-bs__question">{prompt.prompt}</p>
      <div className="ag-bs__timer" aria-hidden="true">
        <i
          style={{ transform: `scaleX(${left / (BLACK_SWAN_SECONDS * 1000)})` }}
          data-low={left < 6000}
        />
      </div>
      <form className="ag-bs__form" onSubmit={submit} autoComplete="off">
        <div className="ag-bs__field" key={shake} data-shake={shake > 0}>
          <label htmlFor="ag-bs-answer" className="ag-sr">
            Your answer
          </label>
          <input
            id="ag-bs-answer"
            ref={inputRef}
            value={text}
            spellCheck={false}
            placeholder="Type your answer…"
            onChange={(e) => {
              setText(e.target.value);
              setPending(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape" && pending) setPending(null);
            }}
            disabled={busy && !pending}
          />
          {shake > 0 && (
            <span className="ag-bs__x" aria-hidden="true">
              ✕
            </span>
          )}
        </div>
        <Button variant="primary" type="submit" disabled={busy}>
          Lock in
        </Button>
      </form>
      {pending && (
        <output className="ag-bs__confirm">
          <span>
            <s>{text}</s> → <b>{pending.label}</b>?
          </span>
          <Button variant="primary" onClick={() => lock(pending.label, text)} disabled={busy}>
            Accept ↵
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setPending(null);
              inputRef.current?.select();
            }}
          >
            Edit
          </Button>
        </output>
      )}
      <div className="ag-bs__tries" aria-live="polite">
        {tries.map((t, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: append-only list of failed guesses
          <s key={`${t}-${i}`}>{t}</s>
        ))}
      </div>
      <p className="ag-bs__hint">
        Obscure and correct beats obvious. Not on the list? Try again until time runs out.
      </p>
      <div className="ag-bs__stage ag-bs__stage--ghost" aria-hidden="true">
        <canvas ref={ghostRef} />
      </div>
    </div>
  );
}

function Reveal({
  prompt,
  result,
  last,
  onNext,
}: {
  prompt: BlackSwanPrompt;
  result: BlackSwanSlotResult;
  last: boolean;
  onNext: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(-1);
  const [shown, setShown] = useState(false);
  const [points, setPoints] = useState(0);
  const [effect, setEffect] = useState<"" | "tail" | "swan">("");
  const [hit, setHit] = useState<ChartHit | null>(null);
  const chartRef = useRef<RevealHandle | null>(null);
  const top = result.tier ? BLACK_SWAN_TIERS.findIndex((t) => t.key === result.tier) : -1;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const timers: number[] = [];
    const chart = runReveal(cv, {
      p: result.p,
      label: result.label,
      tier: result.tier,
      answers: result.ranking,
      reduceMotion: reduce,
      onLand: (at) => {
        if (top < 0) {
          setShown(true);
          return;
        }
        // The rarity climb: one tier per beat, points jumping 10 → 25 → 50 → 100 → 200.
        for (let i = 0; i <= top; i++)
          timers.push(
            window.setTimeout(
              () => {
                setLit(i);
                setPoints(BLACK_SWAN_TIERS[i].points);
                if (i === top) {
                  const key = BLACK_SWAN_TIERS[i].key;
                  if (key === "tail") setEffect("tail");
                  if (key === "swan") setEffect("swan");
                  const fx = fxRef.current;
                  if (fx && at && !reduce) {
                    const cs = getComputedStyle(fx);
                    const tierColor = cs.getPropertyValue(`--ag-bs-${key}`).trim();
                    const gold = cs.getPropertyValue("--ag-bs-gold").trim();
                    burst(
                      fx,
                      at,
                      [0, 6, 14, 30, 80][i],
                      key === "swan" ? [gold, "#ffffff", gold] : [tierColor, gold],
                    );
                  }
                  timers.push(window.setTimeout(() => setShown(true), reduce ? 0 : 250));
                }
              },
              reduce ? 0 : i * 340,
            ),
          );
      },
    });
    chartRef.current = chart;
    return () => {
      chart.cancel();
      chartRef.current = null;
      timers.forEach(window.clearTimeout);
    };
  }, [result, top]);

  // Hover (or tap) a dot to see the answer it stands for.
  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const chart = chartRef.current;
    if (!chart) return;
    const box = e.currentTarget.getBoundingClientRect();
    const h = chart.hitTest(e.clientX - box.left, e.clientY - box.top);
    chart.highlight(h?.column ?? null);
    setHit((prev) => (prev?.column === h?.column ? prev : h));
  };
  const clearHit = () => {
    chartRef.current?.highlight(null);
    setHit(null);
  };

  const tier = result.tier ? tierInfo(result.tier) : null;

  return (
    <div className="ag-bs__reveal">
      <p className="ag-bs__question ag-bs__question--small">{prompt.prompt}</p>
      <div ref={stageRef} className="ag-bs__stage" data-effect={effect}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Where your answer fell among everyone's guesses"
          data-hover={hit !== null}
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={clearHit}
        />
        {hit && (
          <div
            className="ag-bs__tip"
            style={{ left: hit.x, top: hit.y }}
            data-flip={hit.y < 110}
            data-edge={
              hit.x < 120
                ? "left"
                : hit.x > (canvasRef.current?.clientWidth ?? 0) - 120
                  ? "right"
                  : undefined
            }
            aria-hidden="true"
          >
            {hit.answers.map((a) => (
              <span key={a.label} className="ag-bs__tiprow">
                <span className="ag-bs__chip" data-tier={a.tier}>
                  {caps(tierInfo(a.tier).name)}
                </span>
                <b>
                  {a.label}
                  {a.mine && <em> · you</em>}
                </b>
                <small>{count(a.picks, "pick")}</small>
              </span>
            ))}
            {hit.more > 0 && (
              <span className="ag-bs__tipmore">+{hit.more} more in this column</span>
            )}
          </div>
        )}
        <div className="ag-bs__fx" aria-hidden="true">
          <canvas ref={fxRef} />
        </div>
      </div>
      <div className="ag-bs__legend">
        <span>
          <i data-dot="crowd" /> everyone's guesses
        </span>
        <span>
          <i data-dot="you" /> you
        </span>
        <span>Best-known answers on the left; the tail runs right.</span>
      </div>
      <div className="ag-bs__steps" aria-hidden="true">
        {BLACK_SWAN_TIERS.map((t, i) => (
          <div
            key={t.key}
            className="ag-bs__step"
            data-tier={t.key}
            data-on={i <= lit}
            style={{ height: `${22 + (BLACK_SWAN_TIERS.length - 1 - i) * 9}px` }}
          >
            <i />
            <em>{caps(t.name)}</em>
          </div>
        ))}
      </div>
      <div
        className="ag-bs__result"
        data-tier={result.tier ?? "miss"}
        data-shown={shown}
        aria-live="polite"
      >
        <span className="ag-bs__badge" data-tier={result.tier ?? "miss"}>
          {tier ? caps(tier.name) : "NOT ON THE LIST"}
        </span>
        <div className="ag-bs__what">
          <b>{result.label ?? (result.input ? `“${result.input}”` : "No answer")}</b>
          <span>
            {result.label && tier
              ? `${(result.picks ?? 0) > 1 ? `${count(result.picks ?? 0, "player")} chose` : "Only you chose"} this today. ${tier.blurb}`
              : result.input
                ? "Not an accepted answer, so it scores 0."
                : "Time ran out."}
          </span>
        </div>
        <div className="ag-bs__points">
          <span>{shown ? result.points : points}</span>
          <small>points</small>
        </div>
      </div>
      {shown && <SwanCard result={result} />}
      {shown && <AnswerList result={result} />}
      <div className="ag-row ag-row--between">
        <span className="ag-bs__hint">
          {count(result.answerCount, "accepted answer")} · {count(result.players, "player")}{" "}
          answered so far
        </span>
        <Button variant="primary" onClick={onNext} disabled={!shown}>
          {last ? "See today's result →" : "Next prompt →"}
        </Button>
      </div>
    </div>
  );
}

function Recap({
  prompts,
  results,
  dist,
}: {
  prompts: BlackSwanPrompt[];
  results: Array<BlackSwanSlotResult | undefined>;
  dist: BlackSwanDistribution | null;
}) {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const distRef = useRef<HTMLCanvasElement>(null);
  const showDist = !!dist && dist.players > 1;
  useEffect(() => {
    const draw = () => {
      if (chartRef.current)
        drawDayChart(
          chartRef.current,
          results.map((r) => r?.p ?? null),
        );
      if (distRef.current && dist && showDist) drawDistribution(distRef.current, dist);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [results, dist, showDist]);
  return (
    <div className="ag-bs__recap">
      {showDist && dist && (
        <figure className="ag-bs__dist">
          <div className="ag-bs__stage">
            <canvas
              ref={distRef}
              role="img"
              aria-label={`Today's scores from ${dist.players} players; you scored ${dist.score}`}
            />
          </div>
          <figcaption>
            Today's scores · {count(dist.players, "player")} · μ = {Math.round(dist.mean)}, σ ={" "}
            {Math.round(dist.sd)}
          </figcaption>
        </figure>
      )}
      <div className="ag-bs__stage">
        <canvas
          ref={chartRef}
          role="img"
          aria-label={`Where your ${word(prompts.length)} answers fell on the rarity curve`}
        />
      </div>
      <table>
        <tbody>
          {prompts.map((p, i) => {
            const r = results[i];
            return (
              <tr key={p.questionId}>
                <td className="ag-bs__n">{i + 1}</td>
                <td>
                  <div className="ag-bs__q">{p.prompt}</div>
                  <div className="ag-bs__a">{r?.label ?? (r?.input ? `“${r.input}”` : "—")}</div>
                  {r && <AnswerList result={r} />}
                </td>
                <td>
                  <span className="ag-bs__badge" data-tier={r?.tier ?? "miss"}>
                    {r?.tier ? caps(tierInfo(r.tier).name) : "MISS"}
                  </span>
                </td>
                <td className="ag-bs__n ag-bs__n--right">{r?.points ?? 0}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The prompt's Black Swan, revealed once the player has answered. */
function SwanCard({ result }: { result: BlackSwanSlotResult }) {
  const mine = result.tier === "swan";
  // The result card already names the swan the player found; only its fact is new.
  if (mine && !result.swan.fact) return null;
  return (
    <aside className="ag-bs__swan" data-mine={mine}>
      <span className="ag-bs__chip" data-tier="swan">
        🦢 {mine ? "YOU FOUND THE BLACK SWAN" : "TODAY'S BLACK SWAN"}
      </span>
      <b>{result.swan.label}</b>
      {result.swan.fact && <p>{result.swan.fact}</p>}
    </aside>
  );
}

/** Accepted answers for a prompt the player has answered, rarest first. */
function AnswerList({ result }: { result: BlackSwanSlotResult }) {
  const listRef = useRef<HTMLOListElement>(null);
  const ranking = [...(result.ranking ?? [])].reverse();
  if (!ranking.length) return null;
  // Opening the list scrolls the player's own answer into view.
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const list = listRef.current;
    const mine = list?.querySelector<HTMLElement>('[data-me="true"]');
    if (e.currentTarget.open && list && mine)
      list.scrollTop = mine.offsetTop - list.clientHeight / 2;
  };
  return (
    <details className="ag-bs__answers" onToggle={onToggle}>
      <summary>
        {result.more > 0
          ? `${ranking.length} of ${result.answerCount.toLocaleString("en-US")} accepted answers`
          : `All ${result.answerCount} accepted answers`}
      </summary>
      <ol ref={listRef}>
        {ranking.map((a) => (
          <li key={a.label} data-me={a.label === result.label}>
            <span className="ag-bs__alabel">
              {a.label}
              {a.label === result.label && <em> · you</em>}
            </span>
            <span className="ag-bs__chip" data-tier={a.tier}>
              {caps(tierInfo(a.tier).name)}
            </span>
            <span className="ag-bs__ashare">{a.picks ? count(a.picks, "pick") : ""}</span>
          </li>
        ))}
        {result.more > 0 && (
          <li className="ag-bs__amore">
            + {result.more.toLocaleString("en-US")} more accepted answers
          </li>
        )}
      </ol>
    </details>
  );
}
