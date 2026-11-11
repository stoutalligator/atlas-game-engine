import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { puzzleNumber } from "../../core/daily.js";
import { useCompletion, useDailyProgress, usePuzzleDate } from "../../core/progress.js";
import { shareText } from "../../core/share.js";
import type { DailyGameProps, GameResult } from "../../core/types.js";
import { Button, GameLoading, GameShell, ResultPanel } from "../../ui/Shell.js";
import { Starfield, type StarfieldHandle } from "./Starfield.js";
import { drawDistribution } from "./chart.js";
import {
  LANDMARKS,
  TIER_REGION,
  distanceForScore,
  formatDistance,
  journeyFraction,
  landmarkAt,
  logForScore,
} from "./journey.js";
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
  | { kind: "jump"; slot: number }
  | { kind: "summary" };

/** How hard the starfield warps for each tier. */
const WARP: Record<BlackSwanTierKey, number> = {
  mode: 0.25,
  expected: 0.45,
  sigma: 0.65,
  tail: 0.85,
  swan: 1,
};
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
  const starsRef = useRef<StarfieldHandle>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const progress = useDailyProgress<{ started: boolean }>("black-swan", date, storage, () => ({
    started: false,
  }));

  useEffect(() => {
    let cancelled = false;
    api
      .load(date)
      .then((d) => {
        if (cancelled) return;
        if (!d) return setError("Today's Outlier isn't available. Try again shortly.");
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
      .catch(() => !cancelled && setError("Couldn't load today's Outlier."));
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
        { label: "Outliers", value: String(summary.blackSwans) },
        { label: "Distance", value: formatDistance(distanceForScore(summary.score)) },
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
  const reachedLandmark = landmarkAt(distanceForScore(summary.score));

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
    const next = [...resultsRef.current];
    next[slot] = r;
    setResults(next);
    // The jump: the camera flies out to the new total distance; rarer answers warp harder.
    const after = summarizeDay(next.filter(Boolean) as BlackSwanSlotResult[]).score;
    const strength = r.tier ? WARP[r.tier] : 0;
    if (strength) starsRef.current?.travel(logForScore(after), strength, 1100 + 1900 * strength);
    setPhase({ kind: "jump", slot });
  }, []);

  if (error) return <div className="ag-root ag-error">{error}</div>;
  if (!day || progress.state === null) return <GameLoading />;

  const prompt = phase.kind === "prompt" ? day.prompts[phase.slot] : null;

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
        { label: "Distance", value: formatDistance(distanceForScore(summary.score)) },
      ]}
    >
      <div className="ag-bs">
        <Starfield ref={starsRef} startLog={logForScore(summary.score)} />
        {phase.kind === "prompt" && prompt && (
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

        {phase.kind === "jump" && results[phase.slot] && (
          <Jump
            key={phase.slot}
            result={results[phase.slot] as BlackSwanSlotResult}
            before={summary.score - (results[phase.slot]?.points ?? 0)}
            after={summary.score}
            last={nextSlot === -1}
            onNext={() => (nextSlot === -1 ? setPhase({ kind: "summary" }) : openSlot(nextSlot))}
          />
        )}

        {phase.kind === "summary" && result && (
          <ResultPanel
            solved
            headline={
              reachedLandmark ? `You reached ${reachedLandmark.name}` : "You never left orbit"
            }
            detail={[
              `${formatDistance(distanceForScore(summary.score))} from Earth · ${summary.score} points.`,
              summary.blackSwans
                ? `${count(summary.blackSwans, "Outlier")} found.`
                : "No Outliers today. Aim for the tail tomorrow.",
              better !== null ? `Better than ${better}% of today's players.` : "",
            ]
              .filter(Boolean)
              .join(" ")}
            stats={result.stats}
            shareText={result.shareText}
            history={progress.stats}
          >
            <JourneyArt reached={distanceForScore(summary.score)} />
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
      <div className="ag-bs__hero">
        <span className="ag-bs__eyebrow">
          {word(n).replace(/^./, (c) => c.toUpperCase())} prompts · {BLACK_SWAN_SECONDS} seconds
          each
        </span>
        <h2 className="ag-bs__title">Outlier</h2>
        <p className="ag-bs__lede">
          Name the answer nobody else will. The rarer it is, the farther from Earth it takes you:
          past the planets, out through the stars, maybe all the way to Andromeda.
        </p>
      </div>
      <JourneyArt />
      <div className="ag-bs__tiers">
        {BLACK_SWAN_TIERS.map((t) => (
          <div key={t.key} className="ag-bs__tier" data-tier={t.key}>
            <b>{caps(t.name)}</b>
            <span>{t.points} pts</span>
            <small>{TIER_REGION[t.key]}</small>
          </div>
        ))}
      </div>
      <div className="ag-bs__cats">
        {categories.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: categories can repeat; the list never reorders
          <span key={`${c}-${i}`} className="ag-pill">
            {c}
          </span>
        ))}
      </div>
      <div className="ag-bs__go">
        <Button variant="primary" onClick={onStart}>
          {started ? "Continue the journey →" : "Launch →"}
        </Button>
        <span className="ag-bs__hint">Typos are forgiven · made-up answers don't count</span>
      </div>
    </div>
  );
}

/** Landmarks named on the route (the rest are drawn as small ticks). */
const ROUTE_LABELS = new Set([
  "moon",
  "jupiter",
  "voyager",
  "proxima",
  "betelgeuse",
  "core",
  "andromeda",
]);

/**
 * The route out from Earth on a log scale, with real landmarks along it. With
 * `reached`, the travelled part lights up and a marker shows where you are.
 */
function JourneyArt({ reached }: { reached?: number }) {
  const W = 640;
  const H = 96;
  const y0 = 52;
  const x = (ly: number) => 24 + journeyFraction(ly) * (W - 48);
  const at = reached !== undefined ? x(reached) : null;
  let labelIndex = 0;
  return (
    <svg className="ag-bs__route" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <defs>
        <linearGradient id="ag-bs-route" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--ag-bs-mode)" />
          <stop offset="0.3" stopColor="var(--ag-bs-expected)" />
          <stop offset="0.55" stopColor="var(--ag-bs-sigma)" />
          <stop offset="0.8" stopColor="var(--ag-bs-tail)" />
          <stop offset="1" stopColor="var(--ag-bs-swan)" />
        </linearGradient>
      </defs>
      <line className="ag-bs__route-track" x1="24" x2={W - 24} y1={y0} y2={y0} />
      <line
        className="ag-bs__route-lit"
        x1="24"
        x2={at ?? W - 24}
        y1={y0}
        y2={y0}
        stroke="url(#ag-bs-route)"
      />
      <circle className="ag-bs__route-earth" cx="14" cy={y0} r="6" />
      <text className="ag-bs__route-earthlabel" x="14" y={y0 + 22} textAnchor="middle">
        Earth
      </text>
      {LANDMARKS.map((l) => {
        const lx = x(l.ly);
        const labelled = ROUTE_LABELS.has(l.id);
        const up = labelled && labelIndex++ % 2 === 0;
        const passed = reached === undefined || l.ly <= reached;
        return (
          <g key={l.id} className="ag-bs__route-stop" data-passed={passed}>
            <circle cx={lx} cy={y0} r={labelled ? 4 : 2.2} fill={l.color} />
            {labelled && (
              <text x={lx} y={up ? y0 - 14 : y0 + 22} textAnchor="middle">
                {l.name.replace(/^The /, "")}
              </text>
            )}
          </g>
        );
      })}
      {at !== null && (
        <g className="ag-bs__route-you" transform={`translate(${at} ${y0})`}>
          <circle r="10" />
          <circle r="4.5" />
        </g>
      )}
    </svg>
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
  }, []);

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
      <div className="ag-bs__clock" data-low={left < 6000} aria-hidden="true">
        {Math.ceil(left / 1000)}
      </div>
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
        {prompt.answerCount.toLocaleString("en-US")} accepted answers · the rarer yours, the farther
        you fly. Not on the list? Try again until time runs out.
      </p>
    </div>
  );
}

/**
 * The moment after an answer: the sky is flying out (farther for rarer
 * answers) while centre screen shows the tier and the points earned.
 */
function Jump({
  result,
  before,
  after,
  last,
  onNext,
}: {
  result: BlackSwanSlotResult;
  before: number;
  after: number;
  last: boolean;
  onNext: () => void;
}) {
  const tier = result.tier ? tierInfo(result.tier) : null;
  const [n, setN] = useState(0);
  const [ly, setLy] = useState(distanceForScore(before));
  useEffect(() => {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const from = logForScore(before);
    const to = logForScore(after);
    if (reduce) {
      setN(result.points);
      setLy(distanceForScore(after));
      return;
    }
    const start = performance.now();
    const ms = 1600;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - t) ** 3;
      setN(Math.round(result.points * e));
      setLy(after > 0 ? 10 ** (from + (to - from) * e) : 0);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [before, after, result.points]);

  return (
    <div className="ag-bs__jump" data-tier={result.tier ?? "miss"} aria-live="polite">
      <span className="ag-bs__badge" data-tier={result.tier ?? "miss"}>
        {tier ? caps(tier.name) : result.input ? "NOT ON THE LIST" : "TIME'S UP"}
      </span>
      <div className="ag-bs__jumppts">+{n}</div>
      <b className="ag-bs__jumpanswer">
        {result.label ?? (result.input ? `“${result.input}”` : "No answer")}
      </b>
      <span className="ag-bs__jumpsub">
        {result.label && tier
          ? `${(result.picks ?? 0) > 1 ? `${count(result.picks ?? 0, "player")} chose this` : "Only you chose this"} · ${TIER_REGION[result.tier as BlackSwanTierKey]}`
          : "No jump this time."}
      </span>
      <span className="ag-bs__jumpdist">{formatDistance(ly)} from Earth</span>
      {result.tier !== "swan" && result.swan && (
        <span className="ag-bs__jumpswan">
          Today's Outlier: <b>{result.swan.label}</b>
        </span>
      )}
      <Button variant="primary" onClick={onNext}>
        {last ? "See where you ended up →" : "Continue →"}
      </Button>
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
  const distRef = useRef<HTMLCanvasElement>(null);
  const showDist = !!dist && dist.players > 1;
  useEffect(() => {
    const draw = () => {
      if (distRef.current && dist && showDist) drawDistribution(distRef.current, dist);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, [dist, showDist]);
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
