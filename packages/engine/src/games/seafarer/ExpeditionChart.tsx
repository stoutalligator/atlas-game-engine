// The month as one journey: every region of the pack stitched into one hex
// map (expedition.ts), with sea lanes from each day's destination to the
// next day's harbor. Finished regions show the player's inked route; regions
// still ahead sit under one bank of fog. On arrival the camera glides from
// the whole chart down to today's region, then hands over to the puzzle.

import { type PointerEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HEX, PlaceMarker, Terrain, cellCenter, chartSize, routeSegments } from "./SeafarerMap.js";
import { EXPEDITION_COLS, type ExpeditionWorld, expeditionWorld, seaLane } from "./expedition.js";
import { harborOf, replayRoute, voyageExit } from "./rules.js";
import { type SeafarerArt, themeFor } from "./theme.js";
import type { SeafarerPack, SeafarerPuzzle } from "./types.js";

/** What the chart needs to know about a finished region. */
export interface ChartFinish {
  stars: 1 | 2 | 3;
  /** The final voyage's taps, for inking the route. */
  taps?: number[];
  restarts?: number;
}

export interface ExpeditionChartProps {
  pack: SeafarerPack;
  finished: Record<number, ChartFinish>;
  /** Newest challenge open to the player (null: none today). */
  available: number | null;
  /** The region to fly to (today's challenge). */
  focus: number;
  /** Fly in to `focus` on its own, then open it. */
  intro: boolean;
  onOpen: (n: number) => void;
}

type Box = [number, number, number, number];
const SQ3 = Math.sqrt(3);

interface Region {
  puzzle: SeafarerPuzzle;
  /** Pixel offset and size of the region's own hexes (world units). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pixel bounds of its block (the region plus the filler around it). */
  block: Box;
}

/** Pixel offset of a world hex offset (whole hexes, even rows). */
const px = (col: number, row: number): [number, number] => [col * HEX * SQ3, row * HEX * 1.5];

/** The month as one board (see expedition.ts), with each region's place on it. */
function layout(pack: SeafarerPack) {
  const world = expeditionWorld(pack.id, pack.puzzles);
  const blockBox = (b: { col: number; row: number; cols: number; rows: number }): Box => {
    const [x, y] = px(b.col, b.row);
    const size = chartSize(b.cols, b.rows);
    return [x, y, size.w, size.h];
  };
  const regions: Region[] = pack.puzzles.map((puzzle, i) => {
    const s = world.slots[i];
    const [x, y] = px(s.col, s.row);
    const size = chartSize(puzzle.cols, puzzle.rows);
    return { puzzle, x, y, w: size.w, h: size.h, block: blockBox(s.block) };
  });
  // Blocks past the month's last day (a short final row) stay under fog.
  const empty: Box[] = [];
  const last = world.slots[world.slots.length - 1].block;
  const used = pack.puzzles.length % EXPEDITION_COLS;
  if (used) {
    const rowIdx = Math.floor((pack.puzzles.length - 1) / EXPEDITION_COLS);
    for (let k = used; k < EXPEDITION_COLS; k++) {
      const c = rowIdx % 2 === 0 ? k : EXPEDITION_COLS - 1 - k;
      empty.push(blockBox({ ...last, col: c * last.cols }));
    }
  }
  const { w, h } = chartSize(world.cols, world.rows);
  return { world, regions, empty, w, h };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The window onto the month: never the whole chart (too small to read on a
 * phone), but today's neighbourhood. `blocks` is how many regions wide it is.
 */
const VIEW = {
  wide: { blocks: 2.6, aspect: 4 / 3 },
  narrow: { blocks: 1.5, aspect: 4 / 5 },
} as const;
const NARROW = "(max-width: 640px)";

/** Keeps a view box inside the chart (shifting it, never changing its size). */
function clampBox([x, y, bw, bh]: Box, w: number, h: number): Box {
  return [Math.max(0, Math.min(x, w - bw)), Math.max(0, Math.min(y, h - bh)), bw, bh];
}

export function ExpeditionChart({
  pack,
  finished,
  available,
  focus,
  intro,
  onOpen,
}: ExpeditionChartProps) {
  const { world, regions, empty, w, h } = useMemo(() => layout(pack), [pack]);
  const art = themeFor(pack.theme).art;
  const [narrow, setNarrow] = useState(() => !!window.matchMedia?.(NARROW).matches);
  const view = narrow ? VIEW.narrow : VIEW.wide;

  /** Today's neighbourhood: a few regions around day `n`, kept on the chart. */
  const aroundBox = (n: number): Box => {
    const [bx, by, bbw, bbh] = regions[n - 1].block;
    const vw = Math.min(bbw * view.blocks, w);
    const vh = Math.min(vw / view.aspect, h);
    return clampBox([bx + bbw / 2 - vw / 2, by + bbh / 2 - vh / 2, vw, vh], w, h);
  };
  /** Day `n`'s region, padded, in the frame's shape. */
  const regionBox = (n: number): Box => {
    const r = regions[n - 1];
    let bw = r.w * 1.2;
    let bh = r.h * 1.2;
    if (bw / bh > view.aspect) bh = bw / view.aspect;
    else bw = bh * view.aspect;
    return [r.x + r.w / 2 - bw / 2, r.y + r.h / 2 - bh / 2, bw, bh];
  };

  const [box, setBox] = useState<Box>(() => aroundBox(focus));
  const [flying, setFlying] = useState(false);
  const raf = useRef(0);

  // Phone <-> desktop: re-frame today's neighbourhood in the new shape.
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW);
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the frame's shape changes
  useEffect(() => {
    if (!flying) setBox(aroundBox(focus));
  }, [narrow]);

  const flyTo = (to: Box, ms: number, then?: () => void) => {
    cancelAnimationFrame(raf.current);
    const from = box;
    const t0 = performance.now();
    setFlying(true);
    const step = (now: number) => {
      const k = ease(Math.min(1, (now - t0) / ms));
      setBox(from.map((v, i) => v + (to[i] - v) * k) as Box);
      if (k < 1) raf.current = requestAnimationFrame(step);
      else {
        setFlying(false);
        then?.();
      }
    };
    raf.current = requestAnimationFrame(step);
  };

  // Arrival: a beat on today's neighbourhood, then glide down into today's region.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on arrival
  useEffect(() => {
    if (!intro) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      onOpen(focus);
      return;
    }
    const id = window.setTimeout(
      () => flyTo(regionBox(focus), 1300, () => window.setTimeout(() => onOpen(focus), 250)),
      700,
    );
    return () => {
      window.clearTimeout(id);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  // Drag to explore the rest of the chart (fog still hides the days ahead).
  // The pointer is captured only once it has really moved, so a tap still
  // reaches the region under it, and a drag never opens one.
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; from: Box; id: number } | null>(null);
  const dragged = useRef(false);
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (flying || intro) return;
    drag.current = { x: e.clientX, y: e.clientY, from: box, id: e.pointerId };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    const el = svgRef.current;
    if (!d || !el || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!dragged.current && Math.hypot(dx, dy) < 6) return;
    if (!dragged.current) {
      dragged.current = true;
      setDragging(true);
      el.setPointerCapture(e.pointerId);
    }
    const scale = d.from[2] / el.clientWidth;
    setBox(clampBox([d.from[0] - dx * scale, d.from[1] - dy * scale, d.from[2], d.from[3]], w, h));
  };
  const onPointerEnd = (e: PointerEvent<SVGSVGElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (svgRef.current?.hasPointerCapture(e.pointerId))
      svgRef.current.releasePointerCapture(e.pointerId);
  };

  /** Fly into a region, then open its puzzle. */
  const openRegion = (n: number) => {
    if (flying) return;
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    flyTo(regionBox(n), 900, () => onOpen(n));
  };

  // The world layer is memoised, so the fly-in only changes the viewBox each
  // frame; region clicks go through a ref to stay current without re-rendering it.
  const openRef = useRef(openRegion);
  openRef.current = openRegion;
  const onRegion = useCallback((n: number) => openRef.current(n), []);
  const charted = Object.keys(finished).length;
  const stars = Object.values(finished).reduce((sum, f) => sum + f.stars, 0);
  const home = aroundBox(focus);
  const away = !flying && !intro && box.some((v, i) => Math.abs(v - home[i]) > 1);

  return (
    <section className="sf-panel sf-expedition">
      <header className="sf-expedition-head">
        <strong>{pack.title}</strong>
        <span>
          {charted} of {pack.puzzles.length} charted · {stars}★
        </span>
      </header>
      <div className="sf-expedition-frame" style={{ aspectRatio: `${view.aspect}` }}>
        <svg
          ref={svgRef}
          className="sf-expedition-map"
          viewBox={box.map((v) => v.toFixed(1)).join(" ")}
          role="img"
          aria-label={`${pack.title}: ${charted} of ${pack.puzzles.length} regions charted`}
          data-dragging={dragging}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <defs>
            <filter id="sf-mist" x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="22" />
            </filter>
          </defs>
          <WorldLayer
            world={world}
            regions={regions}
            empty={empty}
            w={w}
            h={h}
            finished={finished}
            available={available}
            focus={focus}
            art={art}
            onRegion={onRegion}
          />
        </svg>
        {away && (
          <button
            type="button"
            className="ag-btn ag-btn--ghost sf-expedition-recenter"
            onClick={() => flyTo(home, 600)}
          >
            Back to day {focus}
          </button>
        )}
      </div>
      <div className="sf-expedition-foot">
        {intro ? (
          <span className="sf-expedition-status">Charting a course to day {focus}…</span>
        ) : (
          <>
            <span className="sf-expedition-hint">Drag to explore</span>
            <button
              type="button"
              className="ag-btn ag-btn--accent"
              disabled={flying || available === null}
              onClick={() => openRegion(focus)}
            >
              {finished[focus] ? `Revisit day ${focus}` : `Set sail · Day ${focus}`}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

interface WorldLayerProps {
  world: ExpeditionWorld;
  regions: Region[];
  empty: Box[];
  w: number;
  h: number;
  finished: Record<number, ChartFinish>;
  available: number | null;
  focus: number;
  art: SeafarerArt;
  onRegion: (n: number) => void;
}

/** Path data through world cells. */
function cellsPath(cols: number, cells: readonly number[]): string {
  return cells
    .map((c, i) => {
      const [x, y] = cellCenter(cols, c);
      return `${i ? "L" : "M"}${x.toFixed(0)} ${y.toFixed(0)}`;
    })
    .join(" ");
}

/** Fog over one block, drawn into a single blurred bank so neighbouring patches merge. */
function FogPatch({ box: [x, y, bw, bh] }: { box: Box }) {
  const m = HEX * 0.6;
  return (
    <>
      <rect x={x - m} y={y - m} width={bw + 2 * m} height={bh + 2 * m} />
      <circle cx={x + bw * 0.3} cy={y + bh * 0.35} r={bw * 0.28} className="sf-fog-puff" />
      <circle cx={x + bw * 0.7} cy={y + bh * 0.6} r={bw * 0.3} className="sf-fog-puff" />
    </>
  );
}

/** Everything on the chart except the camera: memoised so the fly-in stays smooth. */
const WorldLayer = memo(function WorldLayer({
  world,
  regions,
  empty,
  w,
  h,
  finished,
  available,
  focus,
  art,
  onRegion,
}: WorldLayerProps) {
  const wc = world.cols;
  const stateOf = (n: number) =>
    finished[n] ? "done" : available !== null && n <= available ? "open" : "fog";
  const focusRegion = regions[focus - 1];
  const shipAt = focusRegion
    ? cellCenter(wc, world.toWorld(focus - 1, harborOf(focusRegion.puzzle).cell))
    : null;
  // Lanes depend only on the world: from each day's exit to the next day's harbor.
  const lanes = useMemo(
    () =>
      regions.slice(1).map((r, i) => {
        const from = world.toWorld(i, voyageExit(regions[i].puzzle).cell);
        const to = world.toWorld(i + 1, harborOf(r.puzzle).cell);
        return { n: r.puzzle.number, d: cellsPath(world.cols, seaLane(world.board, from, to)) };
      }),
    [world, regions],
  );

  return (
    <g>
      <rect x={-w} y={-h} width={w * 3} height={h * 3} className="sf-ocean" />
      <Terrain board={world.board} art={art} />

      {/* Sea lanes: yesterday's destination → today's harbor */}
      {lanes.map((l) =>
        stateOf(l.n) === "fog" ? null : (
          <path
            key={l.n}
            d={l.d}
            className="sf-lane"
            data-done={!!finished[l.n - 1] && !!finished[l.n]}
          />
        ),
      )}

      {/* Inked routes and places of the regions already open */}
      {regions.map((r, i) => {
        const n = r.puzzle.number;
        const f = finished[n];
        if (stateOf(n) === "fog") return null;
        const toW = (c: number) => world.toWorld(i, c);
        const legs = f?.taps
          ? replayRoute({ ...r.puzzle, provisions: 999 }, f.taps, 0)?.legs
          : null;
        const ink = legs
          ? routeSegments(
              wc,
              toW(harborOf(r.puzzle).cell),
              legs.map((l) => ({ ...l, to: toW(l.to), path: l.path.map(toW) })),
            )
          : null;
        return (
          <g key={r.puzzle.id}>
            {ink && (
              <g className="sf-ink">
                <path d={ink.sailed} />
                <path d={ink.drift} />
              </g>
            )}
            {r.puzzle.places.map((pl) => {
              const [x, y] = cellCenter(wc, toW(pl.cell));
              return <PlaceMarker key={pl.id} place={pl} x={x} y={y} done={!!f} />;
            })}
          </g>
        );
      })}

      {/* One bank of fog over everything still ahead */}
      <g className="sf-fog" filter="url(#sf-mist)">
        {regions.map((r) =>
          stateOf(r.puzzle.number) === "fog" ? <FogPatch key={r.puzzle.id} box={r.block} /> : null,
        )}
        {empty.map((b) => (
          <FogPatch key={`e${b[0]}-${b[1]}`} box={b} />
        ))}
      </g>

      {regions.map((r) => {
        const n = r.puzzle.number;
        const f = finished[n];
        const state = stateOf(n);
        const open = state !== "fog";
        return (
          <g
            key={r.puzzle.id}
            className="sf-region"
            data-state={state}
            data-focus={n === focus}
            onClick={open ? () => onRegion(n) : undefined}
            onKeyDown={(e) => {
              if (open && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                onRegion(n);
              }
            }}
            tabIndex={open ? 0 : undefined}
            aria-label={open ? `Day ${n}: ${r.puzzle.title}` : undefined}
          >
            {/* Hit area, and an outline only for today: the chart stays one map. */}
            <rect
              x={r.x + 4}
              y={r.y + 4}
              width={r.w - 8}
              height={r.h - 8}
              rx="14"
              className="sf-region-frame"
            />
            <g transform={`translate(${r.x + r.w / 2} ${r.y + 6})`} className="sf-region-label">
              <rect x={-120} y={-24} width={240} height={40} rx="5" />
              <text y={1} textAnchor="middle">
                {open ? `${n} · ${r.puzzle.title}` : `Day ${n}`}
              </text>
            </g>
            {f && (
              <text
                x={r.x + r.w / 2}
                y={r.y + r.h + 30}
                textAnchor="middle"
                className="sf-region-stars"
              >
                {"★".repeat(f.stars)}
                {"☆".repeat(3 - f.stars)}
              </text>
            )}
          </g>
        );
      })}

      {shipAt && (
        <g className="sf-chart-ship" transform={`translate(${shipAt[0]} ${shipAt[1]}) scale(1.3)`}>
          <circle r="16" className="sf-chart-ship-halo" />
          <path d="M15 0 C9 -7 -8 -7 -13 -5 L-13 5 C-8 7 9 7 15 0 Z" className="sf-hull" />
          <path d="M3 -9 Q8 0 3 9 L1 9 Q5 0 1 -9 Z" className="sf-sail" />
          <path d="M-5 -7 Q-1 0 -5 7 L-6.5 7 Q-3 0 -6.5 -7 Z" className="sf-sail" />
        </g>
      )}
    </g>
  );
});
