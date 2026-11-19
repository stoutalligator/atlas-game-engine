import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localStorageAdapter } from "../../core/storage.js";
import type { GameStorage } from "../../core/types.js";
import { ExpeditionChart } from "./ExpeditionChart.js";
import { type Overlay, SeafarerMap, cellCenter, hexPoints } from "./SeafarerMap.js";
import {
  type Board,
  FLOW_CHAR,
  HEX_DIRS,
  type RouteState,
  anchor,
  buildBoard,
  dirBetween,
  emptyRoute,
  harborOf,
  neighbor,
  reachableNext,
  replayRoute,
  sail,
  starsFor,
  stormAt,
  twoStarDays,
  voyageDay,
  voyageExit,
} from "./rules.js";
import { alternativeRoutes, canFinish } from "./solver.js";
import { type SeafarerTheme, themeFor } from "./theme.js";
import type { HexDir, ReferenceRoute, RouteKind, SeafarerPack, SeafarerPuzzle } from "./types.js";

/** A finished challenge, as the host records it. */
export interface SeafarerFinish {
  stars: 1 | 2 | 3;
  /** The final voyage's taps, so the expedition chart can ink the route. */
  taps?: number[];
  /** Days at sea, a day in port per restart included. */
  days: number;
  cargo: number;
  restarts?: number;
}

export interface SeafarerSubmission extends SeafarerFinish {
  packId: string;
  puzzleId: string;
  number: number;
  /** The final voyage's taps (the proof, with `restarts`). */
  taps: number[];
  restarts: number;
  durationSec: number;
  shareText: string;
}

export interface SeafarerProps {
  pack: SeafarerPack;
  /** Challenge to show (1-based). */
  challenge: number;
  /** The newest challenge the player may play now (null: none today). */
  available: number | null;
  /** Finished challenges by number. */
  finished?: Record<number, SeafarerFinish>;
  /** Switch to another challenge (e.g. a finished one, from the track). */
  onSelect?: (n: number) => void;
  /** Called once when a voyage is finished. The host saves (and re-checks) it. */
  onSubmit?: (s: SeafarerSubmission) => void | Promise<void>;
  /** Text under the result, e.g. "Your next challenge unlocks tomorrow". */
  footnote?: string;
  /**
   * Open on the expedition chart and fly in to the challenge (default true).
   * False opens straight onto the puzzle.
   */
  startOnChart?: boolean;
  storage?: GameStorage;
}

interface Saved {
  /** The current voyage's taps. */
  taps: number[];
  /** Returns to harbor so far (each cost a day in port). */
  restarts: number;
  /** Finished: the result is final. */
  done: boolean;
  elapsed: number;
}

interface Motion {
  /** Cells the ship moves through, starting where it was. */
  cells: number[];
  step: number;
}

const SAIL_MS = 340;
const DRIFT_MS = 190;
const KEY_DIRS: Record<string, HexDir> = Object.fromEntries(
  HEX_DIRS.map((d) => [FLOW_CHAR[d], d]),
) as Record<string, HexDir>;

/** Shared, so a host that passes no `finished` doesn't defeat the chart's memo. */
const NO_FINISHES: Record<number, SeafarerFinish> = {};

export function Seafarer(props: SeafarerProps) {
  // The chart and the puzzle are two views of one expedition: arrive on the
  // chart, fly in to today's region, and step back out to it after a voyage.
  const [view, setView] = useState<"intro" | "chart" | "voyage">(
    props.startOnChart === false ? "voyage" : "intro",
  );
  const puzzle = props.pack.puzzles.find((p) => p.number === props.challenge);
  if (!puzzle)
    return (
      <div className="ag-root sf-root" data-game="seafarer">
        That challenge isn't in this pack.
      </div>
    );
  if (view !== "voyage")
    return (
      <div
        className="ag-root sf-root"
        data-game="seafarer"
        data-accent="cyan"
        data-theme={props.pack.theme}
      >
        <ExpeditionChart
          key={puzzle.number}
          pack={props.pack}
          finished={props.finished ?? NO_FINISHES}
          available={props.available}
          focus={puzzle.number}
          intro={view === "intro"}
          onOpen={(n) => {
            if (n !== puzzle.number) props.onSelect?.(n);
            setView("voyage");
          }}
        />
      </div>
    );
  return (
    <div className="sf-enter">
      <SeafarerGame
        key={puzzle.id}
        {...props}
        puzzle={puzzle}
        onShowChart={() => setView("chart")}
      />
    </div>
  );
}

function angleBetween(cols: number, a: number, b: number): number {
  const [x1, y1] = cellCenter(cols, a);
  const [x2, y2] = cellCenter(cols, b);
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

function SeafarerGame({
  pack,
  puzzle,
  available,
  finished = {},
  onSelect,
  onSubmit,
  footnote,
  storage = localStorageAdapter,
  onShowChart,
}: SeafarerProps & { puzzle: SeafarerPuzzle; onShowChart: () => void }) {
  const theme = themeFor(pack.theme);
  const board = useMemo(() => buildBoard(puzzle), [puzzle]);
  const harbor = harborOf(puzzle).cell;
  const storeKey = `atlas-games:v2:seafarer:${puzzle.id}`;
  const prior = finished[puzzle.number];
  const isFinished = !!prior;
  /** Seconds spent sailing (a tie-break only). Saved with moves, never on its own. */
  const elapsed = useRef(0);
  const submitted = useRef(false);
  const charter = puzzle.objective.type === "charter";

  // ── Saved voyage ──
  const [saved, setSaved] = useState<Saved | null>(null);
  useEffect(() => {
    let live = true;
    storage.load<Saved>(storeKey).then((s) => {
      if (!live) return;
      const ok = s && replayRoute(puzzle, s.taps, s.restarts ?? 0) ? s : null;
      // A finished challenge with no local voyage still shows as finished.
      // The host's record wins: a challenge finished elsewhere (another
      // device) is finished here too, whatever this browser saved.
      setSaved(
        ok
          ? { ...ok, restarts: ok.restarts ?? 0, done: ok.done || isFinished }
          : { taps: [], restarts: 0, done: isFinished, elapsed: 0 },
      );
      elapsed.current = ok?.elapsed ?? 0;
    });
    return () => {
      live = false;
    };
  }, [storage, storeKey, puzzle, isFinished]);

  const update = useCallback(
    (fn: (s: Saved) => Saved) =>
      setSaved((s) => {
        if (!s) return s;
        const next = { ...fn(s), elapsed: elapsed.current };
        storage.save(storeKey, next).catch(() => {});
        return next;
      }),
    [storage, storeKey],
  );

  const route: RouteState = useMemo(
    () =>
      saved
        ? (replayRoute(puzzle, saved.taps, saved.restarts) ?? emptyRoute(puzzle, saved.restarts))
        : emptyRoute(puzzle),
    [puzzle, saved],
  );

  const playable = available !== null && puzzle.number <= available;
  const sailing = !!saved && !saved.done && playable;

  // Count time while the voyage is open and the tab is visible.
  useEffect(() => {
    if (!sailing) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") elapsed.current += 1;
    }, 1000);
    return () => window.clearInterval(id);
  }, [sailing]);

  // ── Ship motion ──
  const [motion, setMotion] = useState<Motion | null>(null);
  const [returning, setReturning] = useState(false);
  const heading = useRef(0);
  const busy = !!motion || returning;

  useEffect(() => {
    if (!motion) return;
    if (motion.step >= motion.cells.length - 1) {
      const id = window.setTimeout(() => setMotion(null), 120);
      return () => window.clearTimeout(id);
    }
    // The first step is sailed; the rest are the current carrying the ship.
    const id = window.setTimeout(
      () => setMotion((m) => (m ? { ...m, step: m.step + 1 } : m)),
      motion.step === 0 ? SAIL_MS : DRIFT_MS,
    );
    return () => window.clearTimeout(id);
  }, [motion]);

  const shipCell = motion ? motion.cells[motion.step] : route.position;
  const prevCell = motion && motion.step > 0 ? motion.cells[motion.step - 1] : null;
  if (prevCell !== null && prevCell !== shipCell) {
    const a = angleBetween(board.cols, prevCell, shipCell);
    const delta = ((a - heading.current + 540) % 360) - 180;
    heading.current += delta;
  }

  // ── Moves ──
  const reachable = useMemo(
    () => (sailing && !busy ? reachableNext(puzzle, board, route) : []),
    [sailing, busy, puzzle, board, route],
  );
  const [hover, setHover] = useState<number | null>(null);
  const [aim, setAim] = useState<number | null>(null);
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    setTouch(typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches);
  }, []);

  const day = voyageDay(route);
  const hasStorms = board.storms.length > 0;
  const canAnchor =
    sailing &&
    !busy &&
    hasStorms &&
    !route.complete &&
    !!anchor(board, route.position, day) &&
    route.remaining >= 1;
  const [anchoring, setAnchoring] = useState(false);
  const dropAnchor = () => {
    if (!canAnchor) return;
    setAim(null);
    setAnchoring(true);
    window.setTimeout(() => setAnchoring(false), 650);
    update((s) => ({ ...s, taps: [...s.taps, route.position] }));
  };

  const sailTo = (cell: number) => {
    if (!saved || busy || !reachable.includes(cell)) return;
    const dir = dirBetween(board, route.position, cell);
    const leg = dir ? sail(board, route.position, dir, day) : null;
    if (!leg) return;
    setAim(null);
    setHover(null);
    setMotion({ cells: [route.position, ...leg.path], step: 0 });
    navigator.vibrate?.(8);
    update((s) => ({ ...s, taps: [...s.taps, cell] }));
  };

  const onCellTap = (cell: number, pointerType: string) => {
    const anchorHere = cell === route.position && canAnchor;
    if (pointerType === "touch") {
      // Touch: tap to aim (the cost appears), tap again to commit, anchoring included.
      setTouch(true);
      if (aim === cell) {
        if (anchorHere) dropAnchor();
        else sailTo(cell);
      } else setAim(reachable.includes(cell) || anchorHere ? cell : null);
      return;
    }
    if (anchorHere) dropAnchor();
    else sailTo(cell);
  };

  // Keyboard: the keys around S sail in their direction (Q W·E / A·D / Z·C).
  useEffect(() => {
    if (!sailing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.toLowerCase() === "s" && hasStorms) {
        e.preventDefault();
        dropAnchor();
        return;
      }
      const dir = KEY_DIRS[e.key.toLowerCase()];
      if (!dir) return;
      const to = neighbor(board, route.position, dir);
      if (to >= 0) {
        e.preventDefault();
        sailTo(to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const targetCell = aim ?? hover;
  const target = useMemo(() => {
    if (targetCell !== null && targetCell === route.position && canAnchor)
      return {
        cell: targetCell,
        path: [],
        label: `+1 ${theme.words.day} · drop anchor`,
        aimed: aim === targetCell,
      };
    if (targetCell === null || !reachable.includes(targetCell)) return null;
    const dir = dirBetween(board, route.position, targetCell);
    const leg = dir ? sail(board, route.position, dir, day) : null;
    if (!leg) return null;
    const drift = leg.path.length - 1;
    const parts = [`${leg.days} ${leg.days === 1 ? theme.words.day : theme.words.days}`];
    if (leg.days === 2) parts.push(theme.words.shallowsTag);
    if (drift > 0) parts.push(`${theme.words.currentTag} carries you ${drift}`);
    return {
      cell: targetCell,
      path: leg.path,
      label: `+${parts.join(" · ")}`,
      aimed: aim === targetCell,
    };
  }, [targetCell, aim, reachable, board, route.position, theme, day, canAnchor]);

  // ── Finishing ──
  const stars = starsFor(puzzle, route);
  const finish = useCallback(() => {
    if (!saved || saved.done || submitted.current) return;
    submitted.current = true;
    update((s) => ({ ...s, done: true }));
    // Landfall: a moment over the chart, then the result slides into view.
    setLandfall(
      charter
        ? `Home to ${harborOf(puzzle).name} · ${route.cargo} ${theme.words.cargo}`
        : `Landfall at ${voyageExit(puzzle).name} · ${route.days} ${theme.words.days}`,
    );
    window.setTimeout(() => setLandfall(null), 2600);
    window.setTimeout(
      () => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      900,
    );
    const submission: SeafarerSubmission = {
      packId: pack.id,
      puzzleId: puzzle.id,
      number: puzzle.number,
      taps: saved.taps,
      restarts: saved.restarts,
      stars,
      days: route.days,
      cargo: route.cargo,
      durationSec: elapsed.current,
      shareText: shareLine(pack, puzzle, route, stars),
    };
    Promise.resolve(onSubmit?.(submission)).catch(() => {});
  }, [saved, update, pack, puzzle, stars, route, onSubmit, charter, theme]);

  const [landfall, setLandfall] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Voyages and rounds end the moment the ship arrives.
  useEffect(() => {
    if (sailing && !motion && route.complete && !charter) finish();
  }, [sailing, motion, route.complete, charter, finish]);

  const canRestart =
    sailing && !busy && route.legs.length > 0 && route.restarts + 1 < puzzle.provisions;
  const restart = () => {
    if (!canRestart) return;
    setReturning(true);
    window.setTimeout(() => {
      update((s) => ({ ...s, taps: [], restarts: s.restarts + 1 }));
      heading.current = 0;
      setReturning(false);
    }, 380);
  };

  const stuck = useMemo(
    () => sailing && !busy && route.legs.length > 0 && !route.complete && !canFinish(puzzle, route),
    [sailing, busy, puzzle, route],
  );

  // ── After finishing: the routes the solver found ──
  const finishedNow = !!saved?.done && !motion;
  const references: ReferenceRoute[] = useMemo(
    () => (finishedNow ? (puzzle.routes ?? alternativeRoutes(puzzle, 3)) : []),
    [finishedNow, puzzle],
  );
  const [overlayId, setOverlayId] = useState<number | null>(null);
  const overlay: Overlay | null = useMemo(() => {
    if (overlayId === null) return null;
    const r = references[overlayId];
    const legs = r ? replayRoute({ ...puzzle, provisions: 999 }, r.taps)?.legs : null;
    return legs ? { legs, kind: r.kind } : null;
  }, [overlayId, references, puzzle]);

  // Places reached so far, revealed as the ship actually passes them.
  const visited = useMemo(() => {
    if (!motion) return route.visited;
    const passed = new Set<number>([harbor]);
    for (const l of route.legs.slice(0, -1)) for (const c of l.path) passed.add(c);
    for (const c of motion.cells.slice(0, motion.step + 1)) passed.add(c);
    return puzzle.places.filter((pl) => passed.has(pl.cell)).map((pl) => pl.id);
  }, [motion, route, harbor, puzzle.places]);

  if (!saved)
    return <div className="ag-root sf-root sf-loading" data-game="seafarer" data-accent="cyan" />;

  const hint = !sailing
    ? null
    : route.legs.length === 0
      ? touch
        ? "Tap a glowing hex to aim, then tap it again to sail. Every move is final."
        : "Click a glowing hex beside your ship to sail there. Every move is final."
      : "Sailing back the way you came still costs days. Return to harbor to start over (+1 day).";
  const stormHint = sailing && board.storms.length > 0 ? theme.words.stormHint : null;

  return (
    <div
      className="ag-root sf-root"
      data-game="seafarer"
      data-accent="cyan"
      data-theme={pack.theme}
    >
      <ExpeditionTrack
        pack={pack}
        theme={theme}
        current={puzzle.number}
        available={available}
        finished={finished}
        onSelect={onSelect}
      />

      <section className="sf-panel sf-voyage">
        <header className="sf-head">
          <div className="sf-head-main">
            <span className="sf-chip">Challenge {puzzle.number}</span>
            <h2 className="sf-title">{puzzle.title || pack.title}</h2>
            <p className="sf-objective">{objectiveText(puzzle, theme)}</p>
          </div>
          <div className="sf-head-side">
            <Difficulty level={puzzle.difficulty} />
            <button
              type="button"
              className="ag-btn ag-btn--ghost sf-chart-btn"
              onClick={onShowChart}
            >
              Chart
            </button>
          </div>
        </header>
        {puzzle.tip && !saved.done && <p className="sf-tip">{puzzle.tip}</p>}

        <div className="sf-board" data-returning={returning}>
          {landfall && (
            <div className="sf-landfall" aria-live="polite">
              <span>{landfall}</span>
            </div>
          )}
          <SeafarerMap
            board={board}
            places={puzzle.places}
            visited={visited}
            start={harbor}
            legs={route.legs}
            revealUpTo={motion ? route.legs.length - 1 : undefined}
            ship={{
              cell: shipCell,
              heading: heading.current,
              moving: !!motion,
              hidden: returning,
            }}
            reachable={reachable}
            storm={
              hasStorms
                ? {
                    now: stormAt(board, day),
                    next: stormAt(board, day + 1),
                    drifts: board.storms.map((st) => st.drift),
                  }
                : null
            }
            anchoring={anchoring}
            art={theme.art}
            target={target}
            overlay={overlay}
            interactive={sailing && !busy}
            onCellEnter={(c) => setHover(c !== null && c >= 0 ? c : null)}
            onCellTap={onCellTap}
          />
        </div>
        <Legend puzzle={puzzle} theme={theme} />

        <VoyageLog puzzle={puzzle} route={route} theme={theme} />

        {stuck && (
          <p className="sf-warn" aria-live="polite">
            {theme.words.stuck}
          </p>
        )}

        {sailing && (
          <div className="sf-actions">
            <button
              type="button"
              className={`ag-btn ${stuck ? "ag-btn--primary" : "ag-btn--ghost"}`}
              onClick={restart}
              disabled={!canRestart}
              title="Start over from the harbor. Costs one day."
            >
              ↺ Return to harbor · +1 day
            </button>
            {hasStorms && (
              <button
                type="button"
                className="ag-btn"
                onClick={dropAnchor}
                disabled={!canAnchor}
                title={
                  canAnchor
                    ? "Wait here for a day while the storm moves on."
                    : "The storm reaches this hex tomorrow: you can't wait here."
                }
              >
                ⚓ Drop anchor · +1 day
              </button>
            )}
            {charter && route.complete && !busy && (
              <button type="button" className="ag-btn ag-btn--accent" onClick={finish}>
                Finish voyage · {route.cargo} cargo
              </button>
            )}
          </div>
        )}
        {hint && <p className="sf-hint">{hint}</p>}
        {stormHint && <p className="sf-hint">{stormHint}</p>}

        {!playable && !saved.done && (
          <p className="sf-locked">
            This challenge unlocks on a later day. One new challenge a day.
          </p>
        )}

        <div ref={resultRef} />
        {finishedNow && (
          <ResultCard
            puzzle={puzzle}
            route={saved.taps.length ? route : null}
            prior={prior}
            theme={theme}
            references={references}
            overlayId={overlayId}
            onOverlay={(i) => setOverlayId((cur) => (cur === i ? null : i))}
            share={shareLine(pack, puzzle, route, stars)}
            footnote={footnote}
            onShowChart={onShowChart}
          />
        )}
      </section>
    </div>
  );
}

// ── Pieces ──

function objectiveText(p: SeafarerPuzzle, t: SeafarerTheme): string {
  const ports = p.places.filter((pl) => pl.kind === "port");
  switch (p.objective.type) {
    case "voyage":
      return `Sail to ${ports[0]?.name} in as few days as you can.`;
    case "rounds":
      return `Call at ${ports.length === 2 ? "both" : `all ${ports.length}`} ${t.words.ports}, in any order${
        p.objective.returnHome ? ", then sail home" : ""
      }.`;
    case "charter":
      return `Collect the most ${t.words.cargo} you can and bring it home within ${p.provisions} ${t.words.days}.`;
  }
}

function Difficulty({ level }: { level: number }) {
  return (
    <span className="sf-diff" title={`Difficulty ${level} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} data-on={i <= level} />
      ))}
    </span>
  );
}

function VoyageLog({
  puzzle,
  route,
  theme,
}: { puzzle: SeafarerPuzzle; route: RouteState; theme: SeafarerTheme }) {
  const charter = puzzle.objective.type === "charter";
  const left = Math.max(0, route.remaining);
  return (
    <div className="sf-log">
      <div className="sf-stat">
        <span className="sf-stat-label">Days at sea</span>
        <span className="sf-stat-big sf-bump" key={route.days}>
          {route.days}
        </span>
        <span className="sf-stat-note">
          {route.restarts > 0
            ? `incl. ${route.restarts} in port`
            : route.legs.length === 0
              ? "at anchor"
              : route.complete
                ? "arrived"
                : "under sail"}
        </span>
      </div>
      {charter ? (
        <div className="sf-stat">
          <span className="sf-stat-label">Cargo</span>
          <span className="sf-stat-big">{route.cargo}</span>
          <span className="sf-stat-note">★★★ at {puzzle.best}</span>
        </div>
      ) : (
        <div className="sf-stat">
          <span className="sf-stat-label">Par</span>
          <span className="sf-stat-big">{puzzle.par}</span>
          <span className="sf-stat-note">★★ up to {twoStarDays(puzzle)}</span>
        </div>
      )}
      <div className="sf-stat sf-stat--wide">
        <span className="sf-stat-label">{theme.words.provisions}</span>
        <span className="sf-stat-big">
          {left}
          <small> left</small>
        </span>
        <span className="sf-meter" aria-hidden="true">
          <span style={{ width: `${(left / puzzle.provisions) * 100}%` }} data-low={left <= 2} />
        </span>
      </div>
    </div>
  );
}

function Legend({ puzzle, theme }: { puzzle: SeafarerPuzzle; theme: SeafarerTheme }) {
  const all = puzzle.map.join("");
  const items: Array<[string, string]> = [["sea", "Open sea: 1 day"]];
  if (all.includes(",")) items.push(["shallows", theme.words.shallows]);
  if (/[qeadzc]/.test(all)) items.push(["current", theme.words.current]);
  items.push(["block", theme.words.reef]);
  if (puzzle.storms?.length) items.push(["storm", theme.words.storm]);
  return (
    <ul className="sf-legend">
      {items.map(([k, label]) => (
        <li key={k} data-kind={k}>
          <svg viewBox="-12 -12 24 24" className="sf-swatch" aria-hidden="true">
            <polygon points={hexPoints(0, 0, 11)} />
          </svg>
          {label}
        </li>
      ))}
    </ul>
  );
}

function StarRow({ stars }: { stars: number }) {
  return (
    <span className="sf-stars" aria-label={`${stars} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className="sf-star"
          data-on={i <= stars}
          style={{ animationDelay: `${i * 160}ms` }}
        >
          ★
        </span>
      ))}
    </span>
  );
}

function kindLabel(kind: RouteKind, t: SeafarerTheme): string {
  switch (kind) {
    case "storm":
      return t.words.waitStorm;
    case "current":
      return t.words.rideCurrent;
    case "shallows":
      return t.words.crossShallows;
    case "open":
      return "Open water";
  }
}

function ResultCard({
  puzzle,
  route,
  prior,
  theme,
  references,
  overlayId,
  onOverlay,
  share,
  footnote,
  onShowChart,
}: {
  puzzle: SeafarerPuzzle;
  route: RouteState | null;
  prior?: SeafarerFinish;
  theme: SeafarerTheme;
  references: ReferenceRoute[];
  overlayId: number | null;
  onOverlay: (i: number) => void;
  share: string;
  footnote?: string;
  onShowChart: () => void;
}) {
  const result: SeafarerFinish | null = route
    ? {
        stars: starsFor(puzzle, route),
        days: route.days,
        cargo: route.cargo,
        restarts: route.restarts,
      }
    : (prior ?? null);
  const [copied, setCopied] = useState(false);
  if (!result) return null;
  const charter = puzzle.objective.type === "charter";
  const headline =
    result.stars === 3
      ? charter
        ? "A full hold!"
        : "Masterful navigation!"
      : result.stars === 2
        ? "Fine sailing."
        : "Safe harbor.";
  const restarts = result.restarts ?? 0;
  const detail = charter
    ? `${result.cargo} of ${puzzle.best} cargo · ${result.days} ${theme.words.days} at sea`
    : `${result.days} ${theme.words.days} at sea · par ${puzzle.par} · ★★ up to ${twoStarDays(puzzle)}`;
  const seen = new Map<RouteKind, number>();
  return (
    <section className="sf-result" aria-live="polite">
      <StarRow stars={result.stars} />
      <h3>{headline}</h3>
      <p className="sf-result-detail">
        {detail}
        {restarts > 0 && (
          <>
            <br />
            Includes {restarts} {restarts === 1 ? "day" : "days"} in port from returning to harbor.
          </>
        )}
      </p>
      {references.length > 0 && (
        <div className="sf-routes">
          <span className="sf-stat-label">Routes the navigator found</span>
          <ul>
            {references.map((r, i) => {
              const n = (seen.get(r.kind) ?? 0) + 1;
              seen.set(r.kind, n);
              return (
                <li key={r.taps.join(",")}>
                  <button
                    type="button"
                    className="sf-route-row"
                    data-kind={r.kind}
                    data-on={overlayId === i}
                    onClick={() => onOverlay(i)}
                  >
                    <span className="sf-route-dot" />
                    <span className="sf-route-name">
                      {kindLabel(r.kind, theme)}
                      {n > 1 ? " (another way)" : ""}
                      {i === 0 && <em>Best</em>}
                    </span>
                    <span className="sf-route-days">
                      {r.days} {theme.words.days}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="sf-actions">
        <button type="button" className="ag-btn ag-btn--primary" onClick={onShowChart}>
          View expedition chart
        </button>
        <button
          type="button"
          className="ag-btn ag-btn--accent"
          onClick={() => {
            // Phones get the native share sheet; elsewhere, copy to the clipboard.
            const coarse = window.matchMedia?.("(pointer: coarse)").matches;
            if (coarse && navigator.share) {
              navigator.share({ text: share }).catch(() => {});
              return;
            }
            navigator.clipboard?.writeText(share).then(
              () => setCopied(true),
              () => {},
            );
          }}
        >
          {copied ? "Copied!" : "Share"}
        </button>
      </div>
      {footnote && <p className="sf-foot">{footnote}</p>}
    </section>
  );
}

function shareLine(pack: SeafarerPack, p: SeafarerPuzzle, r: RouteState, stars: number): string {
  const s = "⭐".repeat(stars) + "☆".repeat(3 - stars);
  const what =
    p.objective.type === "charter"
      ? `${r.cargo}/${p.best} cargo`
      : `${r.days} days at sea (par ${p.par})`;
  return `Seafarer · ${pack.title} ${p.number}/${pack.puzzles.length}\n${s} ${what}`;
}

function ExpeditionTrack({
  pack,
  theme,
  current,
  available,
  finished,
  onSelect,
}: {
  pack: SeafarerPack;
  theme: SeafarerTheme;
  current: number;
  available: number | null;
  finished: Record<number, SeafarerFinish>;
  onSelect?: (n: number) => void;
}) {
  const n = pack.puzzles.length;
  const done = Object.keys(finished).length;
  const stars = Object.values(finished).reduce((s, f) => s + f.stars, 0);
  const tiers = pack.badgeTiers;
  const tierAt = (k: number) =>
    k === tiers.gold
      ? "gold"
      : k === tiers.silver
        ? "silver"
        : k === tiers.bronze
          ? "bronze"
          : undefined;
  return (
    <nav className="sf-panel sf-track" aria-label="Expedition progress">
      <div className="sf-track-head">
        <span className="sf-track-title">
          {pack.title}
          <small>{theme.kicker}</small>
        </span>
        <span className="sf-track-count">
          <strong>{done}</strong> / {n} charted · {stars}★
        </span>
      </div>
      <ol className="sf-track-list">
        {pack.puzzles.map((p) => {
          const f = finished[p.number];
          const open = available !== null && p.number <= available;
          return (
            <li key={p.number}>
              <button
                type="button"
                className="sf-node"
                data-state={f ? "done" : open ? "open" : "locked"}
                data-current={p.number === current}
                data-tier={tierAt(p.number)}
                data-stars={f?.stars}
                disabled={!open && !f}
                onClick={() => onSelect?.(p.number)}
                title={`Challenge ${p.number}${f ? ` · ${"★".repeat(f.stars)}` : open ? "" : " · locked"}`}
              >
                <svg viewBox="-12 -12 24 24" aria-hidden="true">
                  <polygon points={hexPoints(0, 0, 11)} />
                </svg>
                <span>{p.number}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type { Board };
