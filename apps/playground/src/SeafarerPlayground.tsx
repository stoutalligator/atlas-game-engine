// Seafarer in the playground: a stand-in host (progress in localStorage, a
// dev control for how many days have unlocked) and a review page for picking
// each day's chart from the generated candidates.

import {
  SEAFARER_PACKS,
  Seafarer,
  type SeafarerFinish,
  type SeafarerPack,
  type SeafarerPuzzle,
} from "@stoutalligator/engine";
import { useEffect, useMemo, useState } from "react";
import { SeafarerMap } from "../../../packages/engine/src/games/seafarer/SeafarerMap";
import {
  buildBoard,
  replayRoute,
  solve,
  themeFor,
} from "../../../packages/engine/src/games/seafarer/logic";

/** Progress per pack (the first pack keeps the original key). */
const keyFor = (pack: SeafarerPack) =>
  pack.id === SEAFARER_PACKS[0].id ? "pg-seafarer-finished" : `pg-seafarer-finished:${pack.id}`;

function loadFinished(pack: SeafarerPack): Record<number, SeafarerFinish> {
  try {
    return JSON.parse(localStorage.getItem(keyFor(pack)) ?? "{}");
  } catch {
    return {};
  }
}

export function SeafarerPlayground() {
  const params = new URLSearchParams(window.location.search);
  const [mode, setMode] = useState<"play" | "review">(
    params.get("sf") === "review" ? "review" : "play",
  );
  const [packId, setPackId] = useState(params.get("pack") ?? SEAFARER_PACKS[0].id);
  const pack = SEAFARER_PACKS.find((p) => p.id === packId) ?? SEAFARER_PACKS[0];
  return (
    <div>
      <div className="pg-controls" style={{ marginBottom: 12 }}>
        <label>
          Pack{" "}
          <select value={pack.id} onChange={(e) => setPackId(e.target.value)}>
            {SEAFARER_PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title} ({p.puzzles.length})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="pg-btn"
          data-active={mode === "play"}
          onClick={() => setMode("play")}
        >
          Play the pack
        </button>
        <button
          type="button"
          className="pg-btn"
          data-active={mode === "review"}
          onClick={() => setMode("review")}
        >
          Review candidates
        </button>
      </div>
      {mode === "play" ? (
        <PlayPack key={pack.id} pack={pack} />
      ) : (
        <Review key={pack.id} pack={pack} />
      )}
    </div>
  );
}

function PlayPack({ pack }: { pack: SeafarerPack }) {
  const [finished, setFinished] = useState(() => loadFinished(pack));
  // ?locked=1 starts with the real unlock rule (one new region per finished one), to see the fog.
  const [unlockAll, setUnlockAll] = useState(
    () => new URLSearchParams(window.location.search).get("locked") !== "1",
  );
  const done = Object.keys(finished).length;
  // The real rule: your next unfinished challenge, at most one new one a day.
  // Here "a day" is simulated: the next one opens as soon as you finish.
  const available = unlockAll ? pack.puzzles.length : Math.min(pack.puzzles.length, done + 1);
  // ?day=N opens challenge N (dev shortcut).
  const [challenge, setChallenge] = useState(() => {
    const asked = Number(new URLSearchParams(window.location.search).get("day"));
    return asked >= 1 && asked <= pack.puzzles.length
      ? asked
      : Math.min(done + 1, pack.puzzles.length);
  });
  const [nonce, setNonce] = useState(0);

  const reset = () => {
    localStorage.removeItem(keyFor(pack));
    for (const k of Object.keys(localStorage))
      if (k.startsWith(`atlas-games:v2:seafarer:${pack.id}-`)) localStorage.removeItem(k);
    setFinished({});
    setChallenge(1);
    setNonce((n) => n + 1);
  };

  return (
    <>
      <div className="pg-controls" style={{ marginBottom: 12 }}>
        <label>
          <input
            type="checkbox"
            checked={unlockAll}
            onChange={(e) => setUnlockAll(e.target.checked)}
          />{" "}
          Unlock all {pack.puzzles.length} (dev)
        </label>
        <button
          type="button"
          className="pg-btn"
          onClick={() => setChallenge((c) => Math.max(1, c - 1))}
        >
          ◀ Prev
        </button>
        <button
          type="button"
          className="pg-btn"
          onClick={() => setChallenge((c) => Math.min(pack.puzzles.length, c + 1))}
        >
          Next ▶
        </button>
        <button type="button" className="pg-btn" onClick={reset}>
          Reset expedition
        </button>
      </div>
      <Seafarer
        key={nonce}
        pack={pack}
        challenge={challenge}
        available={available}
        finished={finished}
        onSelect={setChallenge}
        footnote={unlockAll ? undefined : "Your next challenge unlocks tomorrow."}
        onSubmit={(s) => {
          setFinished((f) => {
            const next = {
              ...f,
              [s.number]: {
                stars: s.stars,
                days: s.days,
                cargo: s.cargo,
                restarts: s.restarts,
                taps: s.taps,
              },
            };
            localStorage.setItem(keyFor(pack), JSON.stringify(next));
            return next;
          });
        }}
      />
    </>
  );
}

interface ReviewDay {
  day: number;
  title: string;
  candidates: Array<{
    seed: string;
    interest: number;
    metrics: Record<string, number>;
    puzzle: SeafarerPuzzle;
  }>;
}

function Review({ pack }: { pack: SeafarerPack }) {
  const [days, setDays] = useState<ReviewDay[] | null>(null);
  const [day, setDay] = useState(1);
  useEffect(() => {
    fetch(`/seafarer-review-${pack.id}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setDays, () => setDays([]));
  }, [pack.id]);
  if (!days) return <p className="pg-desc">Loading candidates…</p>;
  if (!days.length)
    return (
      <p className="pg-desc">
        No review file. Run{" "}
        <code>
          pnpm --filter @stoutalligator/engine exec tsx scripts/build-seafarer-pack.ts {pack.id}{" "}
          --review
        </code>
        .
      </p>
    );
  const d = days.find((x) => x.day === day) ?? days[0];
  const chosen = pack.puzzles.find((p) => p.number === d.day)?.meta?.seed;
  return (
    <>
      <div className="pg-controls" style={{ marginBottom: 12 }}>
        <label>
          Day{" "}
          <select value={day} onChange={(e) => setDay(Number(e.target.value))}>
            {days.map((x) => (
              <option key={x.day} value={x.day}>
                {x.day}. {x.title}
              </option>
            ))}
          </select>
        </label>
        <span className="pg-desc">
          Pin a chart with <code>pick: "seed"</code> in shattered-isles.plan.ts, then rebuild.
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        {d.candidates.map((c) => (
          <ReviewCard key={c.seed} c={c} chosen={c.seed === chosen} theme={pack.theme} />
        ))}
      </div>
    </>
  );
}

function ReviewCard({
  c,
  chosen,
  theme,
}: { c: ReviewDay["candidates"][number]; chosen: boolean; theme: string }) {
  const board = useMemo(() => buildBoard(c.puzzle), [c.puzzle]);
  const ref = useMemo(() => {
    const r = replayRoute(c.puzzle, solve(c.puzzle).taps);
    return r ? { legs: r.legs } : null;
  }, [c.puzzle]);
  const m = c.metrics;
  return (
    <div
      className="sf-root"
      data-theme={theme}
      style={{ outline: chosen ? "3px solid #e0623f" : undefined, borderRadius: 16, padding: 4 }}
    >
      <SeafarerMap
        board={board}
        places={c.puzzle.places}
        visited={[]}
        start={c.puzzle.places[0].cell}
        legs={[]}
        ship={{ cell: c.puzzle.places[0].cell, heading: 0, moving: false }}
        reachable={[]}
        target={null}
        overlay={ref ? { legs: ref.legs, kind: "open" } : null}
        interactive={false}
        art={themeFor(theme).art}
      />
      <code style={{ fontSize: 11, lineHeight: 1.5 }}>
        {chosen ? "★ in pack · " : ""}
        {c.seed} · interest {c.interest.toFixed(1)}
        <br />
        par {m.par} · 2★ ≤ {c.puzzle.twoStar ?? "–"} · routes {m.routes} ({m.kinds} kinds) · prov{" "}
        {c.puzzle.provisions} · detour {m.detour.toFixed(2)} · current +{m.currentGain} · shallows −
        {m.shallowCost} · greedy +{m.greedyGap} · openings {m.openings}
        {c.puzzle.objective.type === "charter" ? ` · best ${m.best}` : ""}
      </code>
    </div>
  );
}
