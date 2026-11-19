// The month as one journey: every region of the pack laid out as a winding
// archipelago on a single chart, joined by sea lanes from each day's
// destination to the next day's harbor. Finished regions show the player's
// inked route; future ones sit under fog. On arrival the camera glides from
// the whole chart down to today's region, then hands over to the puzzle.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  HEX,
  PlaceMarker,
  Terrain,
  cellCenter,
  chartSize,
  hexPoints,
  routeSegments,
} from "./SeafarerMap.js";
import { type Board, buildBoard, harborOf, replayRoute, voyageExit } from "./rules.js";
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

const COLS = 5;
/** Each region sits in a block of the world hex lattice (largest chart + a channel). */
const BLOCK_COLS = 12;
const BLOCK_ROWS = 14;
/** Rows of open sea above the regions, for the title. */
const TITLE_ROWS = 6;
const SQ3 = Math.sqrt(3);
const PAD = 10;

interface Tile {
  puzzle: SeafarerPuzzle;
  board: Board;
  /** Offset in world units; regions keep their real scale, aligned to one lattice. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Snake layout on one world hex lattice: every region keeps its own hexes,
 * placed at whole-hex offsets (even rows, so odd-row shifts line up), and the
 * channels between regions are the same sea. The chart reads as one map.
 */
function layout(pack: SeafarerPack): { tiles: Tile[]; w: number; h: number } {
  const tiles = pack.puzzles.map((puzzle, i) => {
    const row = Math.floor(i / COLS);
    const k = i % COLS;
    const col = row % 2 === 0 ? k : COLS - 1 - k;
    const oc = col * BLOCK_COLS + Math.floor((BLOCK_COLS - 1 - puzzle.cols) / 2);
    let orow = TITLE_ROWS + row * BLOCK_ROWS + Math.floor((BLOCK_ROWS - 1 - puzzle.rows) / 2);
    orow -= orow % 2;
    const size = chartSize(puzzle.cols, puzzle.rows);
    return {
      puzzle,
      board: buildBoard(puzzle),
      x: oc * HEX * SQ3,
      y: orow * HEX * 1.5,
      w: size.w,
      h: size.h,
    };
  });
  const rows = Math.ceil(pack.puzzles.length / COLS);
  const world = chartSize(COLS * BLOCK_COLS, TITLE_ROWS + rows * BLOCK_ROWS);
  return { tiles, w: world.w, h: world.h };
}

function worldPoint(t: Tile, cell: number): [number, number] {
  const [x, y] = cellCenter(t.puzzle.cols, cell);
  return [t.x + x, t.y + y];
}

/** The open-sea hex lattice as one repeating pattern (two rows per tile). */
function SeaPattern() {
  const w = HEX * SQ3;
  const pts = (cx: number, cy: number) => hexPoints(cx, cy, HEX - 0.7);
  return (
    <pattern
      id="sf-sea-lattice"
      width={w}
      height={HEX * 3}
      patternUnits="userSpaceOnUse"
      x={PAD}
      y={PAD}
    >
      <rect width={w} height={HEX * 3} className="sf-lattice-gap" />
      {/* Row 0 centred in the tile; row 1 shifted half a hex, wrapping top and bottom. */}
      <polygon points={pts(w / 2, HEX)} className="sf-tile sf-tile--sea1" />
      <polygon points={pts(0, HEX * 2.5)} className="sf-tile sf-tile--sea0" />
      <polygon points={pts(w, HEX * 2.5)} className="sf-tile sf-tile--sea0" />
      <polygon points={pts(0, -HEX * 0.5)} className="sf-tile sf-tile--sea0" />
      <polygon points={pts(w, -HEX * 0.5)} className="sf-tile sf-tile--sea0" />
    </pattern>
  );
}

type Box = [number, number, number, number];
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function ExpeditionChart({
  pack,
  finished,
  available,
  focus,
  intro,
  onOpen,
}: ExpeditionChartProps) {
  const { tiles, w, h } = useMemo(() => layout(pack), [pack]);
  const art = themeFor(pack.theme).art;
  const world: Box = [0, 0, w, h];
  const tileBox = (n: number): Box => {
    const t = tiles[n - 1];
    // Pad the region, then widen or heighten it to the chart's shape.
    let bw = t.w * 1.25;
    let bh = t.h * 1.25;
    if (bw / bh > w / h) bh = (bw * h) / w;
    else bw = (bh * w) / h;
    return [t.x + t.w / 2 - bw / 2, t.y + t.h / 2 - bh / 2, bw, bh];
  };

  const [box, setBox] = useState<Box>(world);
  const [flying, setFlying] = useState(false);
  const raf = useRef(0);

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

  // Arrival: a beat on the whole chart, then glide down to today's region.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once on arrival
  useEffect(() => {
    if (!intro) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      onOpen(focus);
      return;
    }
    const id = window.setTimeout(
      () => flyTo(tileBox(focus), 1500, () => window.setTimeout(() => onOpen(focus), 250)),
      700,
    );
    return () => {
      window.clearTimeout(id);
      cancelAnimationFrame(raf.current);
    };
  }, []);

  /** Fly into a region, then open its puzzle. */
  const openRegion = (n: number) => {
    if (flying) return;
    flyTo(tileBox(n), 900, () => onOpen(n));
  };

  // The world layer is memoised, so the fly-in only changes the viewBox each
  // frame; region clicks go through a ref to stay current without re-rendering it.
  const openRef = useRef(openRegion);
  openRef.current = openRegion;
  const onRegion = useCallback((n: number) => openRef.current(n), []);
  const charted = Object.keys(finished).length;

  return (
    <section className="sf-panel sf-expedition">
      <div className="sf-expedition-frame" style={{ aspectRatio: `${w} / ${h}` }}>
        <svg
          className="sf-expedition-map"
          viewBox={box.map((v) => v.toFixed(1)).join(" ")}
          role="img"
          aria-label={`${pack.title}: ${charted} of ${pack.puzzles.length} regions charted`}
        >
          <defs>
            <filter id="sf-erode" x="-10%" y="-10%" width="120%" height="120%">
              <feMorphology operator="erode" radius="5.5" />
            </filter>
            <SeaPattern />
            <filter id="sf-mist" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="16" />
            </filter>
          </defs>
          <WorldLayer
            pack={pack}
            tiles={tiles}
            w={w}
            h={h}
            finished={finished}
            available={available}
            focus={focus}
            art={art}
            onRegion={onRegion}
          />
        </svg>
      </div>
      <div className="sf-expedition-foot">
        {intro ? (
          <span className="sf-expedition-status">Charting a course to day {focus}…</span>
        ) : (
          <button
            type="button"
            className="ag-btn ag-btn--accent"
            disabled={flying || available === null}
            onClick={() => openRegion(focus)}
          >
            {finished[focus] ? `Revisit day ${focus}` : `Set sail · Day ${focus}`}
          </button>
        )}
      </div>
    </section>
  );
}

interface WorldLayerProps {
  pack: SeafarerPack;
  tiles: Tile[];
  w: number;
  h: number;
  finished: Record<number, ChartFinish>;
  available: number | null;
  focus: number;
  art: SeafarerArt;
  onRegion: (n: number) => void;
}

/** Everything on the chart except the camera: memoised so the fly-in stays smooth. */
const WorldLayer = memo(function WorldLayer({
  pack,
  tiles,
  w,
  h,
  finished,
  available,
  focus,
  art,
  onRegion,
}: WorldLayerProps) {
  const openRegion = onRegion;
  const charted = Object.keys(finished).length;
  const stars = Object.values(finished).reduce((s, f) => s + f.stars, 0);
  const focusTile = tiles[focus - 1];
  const shipAt = focusTile ? worldPoint(focusTile, harborOf(focusTile.puzzle).cell) : null;
  return (
    <g>
      <rect x={-w} y={-h} width={w * 3} height={h * 3} className="sf-ocean" />
      <rect x={0} y={0} width={w} height={h} fill="url(#sf-sea-lattice)" />

      <g className="sf-cartouche">
        <text x={w / 2} y={120} textAnchor="middle" className="sf-cartouche-title">
          {pack.title}
        </text>
        <text x={w / 2} y={172} textAnchor="middle" className="sf-cartouche-sub">
          {charted} of {pack.puzzles.length} regions charted · {stars}★
        </text>
      </g>

      {/* Sea lanes: yesterday's destination → today's harbor */}
      {tiles.slice(1).map((t, i) => {
        const prev = tiles[i];
        const [x1, y1] = worldPoint(prev, voyageExit(prev.puzzle).cell);
        const [x2, y2] = worldPoint(t, harborOf(t.puzzle).cell);
        const mx = (x1 + x2) / 2 + (y2 - y1) * 0.15;
        const my = (y1 + y2) / 2 - (x2 - x1) * 0.15;
        const done = !!finished[t.puzzle.number - 1] && !!finished[t.puzzle.number];
        return (
          <path
            key={t.puzzle.id}
            d={`M${x1.toFixed(0)} ${y1.toFixed(0)} Q${mx.toFixed(0)} ${my.toFixed(0)} ${x2.toFixed(0)} ${y2.toFixed(0)}`}
            className="sf-lane"
            data-done={done}
          />
        );
      })}

      {tiles.map((t) => {
        const n = t.puzzle.number;
        const f = finished[n];
        const unlocked = available !== null && n <= available;
        const state = f ? "done" : unlocked ? "open" : "fog";
        const inked = f?.taps
          ? replayRoute({ ...t.puzzle, provisions: 999 }, f.taps, 0)?.legs
          : null;
        const ink = inked ? routeSegments(t.puzzle.cols, harborOf(t.puzzle).cell, inked) : null;
        return (
          <g
            key={t.puzzle.id}
            className="sf-region"
            data-state={state}
            data-focus={n === focus}
            transform={`translate(${t.x.toFixed(1)} ${t.y.toFixed(1)})`}
            onClick={state === "fog" ? undefined : () => openRegion(n)}
            onKeyDown={(e) => {
              if (state !== "fog" && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                openRegion(n);
              }
            }}
            tabIndex={state === "fog" ? undefined : 0}
            aria-label={state === "fog" ? undefined : `Day ${n}: ${t.puzzle.title}`}
          >
            <g>
              <Terrain board={t.board} art={art} />
              {ink && (
                <g className="sf-ink">
                  <path d={ink.sailed} />
                  <path d={ink.drift} />
                </g>
              )}
              {t.puzzle.places.map((pl) => {
                const [x, y] = cellCenter(t.puzzle.cols, pl.cell);
                return <PlaceMarker key={pl.id} place={pl} x={x} y={y} done={!!f} />;
              })}
            </g>
            {state === "fog" && (
              <g className="sf-fog" filter="url(#sf-mist)">
                <rect x={14} y={14} width={t.w - 28} height={t.h - 28} rx="40" />
                <circle cx={t.w * 0.3} cy={t.h * 0.35} r={t.w * 0.24} />
                <circle cx={t.w * 0.68} cy={t.h * 0.5} r={t.w * 0.27} />
                <circle cx={t.w * 0.42} cy={t.h * 0.74} r={t.w * 0.22} />
              </g>
            )}
            <rect
              x={4}
              y={4}
              width={t.w - 8}
              height={t.h - 8}
              rx="14"
              className="sf-region-frame"
            />
            <g transform={`translate(${t.w / 2} 6)`} className="sf-region-label">
              <rect x={-120} y={-24} width={240} height={40} rx="5" />
              <text y={1} textAnchor="middle">
                {state === "fog" ? `Day ${n}` : `${n} · ${t.puzzle.title}`}
              </text>
            </g>
            {f && (
              <text x={t.w / 2} y={t.h + 30} textAnchor="middle" className="sf-region-stars">
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
