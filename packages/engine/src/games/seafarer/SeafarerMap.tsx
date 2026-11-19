// The sea chart: hex tiles in one SVG, with HTML overlays for text (so labels
// stay legible on phones). Pure presentation + pointer → cell mapping; the
// parent owns the voyage.

import { type CSSProperties, type PointerEvent, memo, useMemo, useRef } from "react";
import { type Board, HEX_DIRS, type Leg, neighbor } from "./rules.js";
import type { SeafarerArt } from "./theme.js";
import type { HexDir, Place, RouteKind } from "./types.js";

export const HEX = 26;
const SQ3 = Math.sqrt(3);
const PAD = 10;

export function chartSize(cols: number, rows: number): { w: number; h: number } {
  return { w: PAD * 2 + HEX * SQ3 * (cols + 0.5), h: PAD * 2 + HEX * (1.5 * (rows - 1) + 2) };
}

export function cellCenter(cols: number, idx: number): [number, number] {
  const row = Math.floor(idx / cols);
  const col = idx % cols;
  return [PAD + HEX * SQ3 * (col + 0.5 + 0.5 * (row & 1)), PAD + HEX + HEX * 1.5 * row];
}

export function hexPoints(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ((60 * i - 90) * Math.PI) / 180;
    pts.push(`${(x + r * Math.cos(a)).toFixed(1)},${(y + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

export const DIR_ANGLE: Record<HexDir, number> = {
  e: 0,
  se: 60,
  sw: 120,
  w: 180,
  nw: 240,
  ne: 300,
};

/** Small deterministic hash for decoration (tints, palms, coral), stable per cell. */
function h(idx: number, salt: number): number {
  let x = (idx + 1) * 374761393 + salt * 668265263;
  x = (x ^ (x >>> 13)) * 1274126177;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// ── Static terrain (memoised: it never changes during a voyage) ──────────

export const Terrain = memo(function Terrain({
  board,
  art = "tropical",
}: { board: Board; art?: SeafarerArt }) {
  const { cols, cells } = board;
  // Cell ids, never reordered, so they make stable keys.
  const ids = cells.map((_, i) => i);
  const of = (t: string) => ids.filter((i) => cells[i].terrain === t);
  const land = of("land");
  const reef = of("reef");
  const currents = of("current");
  const c = (i: number) => cellCenter(cols, i);
  const landHexes = (r: number, dy = 0) =>
    land.map((i) => {
      const [x, y] = c(i);
      return <polygon key={i} points={hexPoints(x, y + dy, r)} />;
    });
  const landNeighbors = (i: number) =>
    HEX_DIRS.filter((d) => {
      const j = neighbor(board, i, d);
      return j >= 0 && cells[j].terrain === "land";
    }).length;

  return (
    <g>
      {/* Water tiles: every hex is a tile, so the grid is part of the chart */}
      <g className="sf-tiles">
        {ids.map((i) => {
          const cell = cells[i];
          const [x, y] = c(i);
          const kind =
            cell.terrain === "sea" || cell.terrain === "land"
              ? `sea${Math.floor(h(i, 1) * 3)}`
              : cell.terrain;
          return (
            <polygon
              key={i}
              points={hexPoints(x, y, HEX - 0.7)}
              className={`sf-tile sf-tile--${kind}`}
            />
          );
        })}
      </g>
      <g className="sf-ripples">
        {ids.map((i) => {
          const t = cells[i].terrain;
          if (t !== "sea" && t !== "shallows") return null;
          if (t === "sea" && h(i, 2) > 0.35) return null;
          const [x, y] = c(i);
          const dx = (h(i, 5) - 0.5) * 12;
          const dy = (h(i, 6) - 0.5) * 10;
          return (
            <path
              key={i}
              d={`M${(x + dx - 7).toFixed(1)} ${(y + dy).toFixed(1)} q3.5 -3 7 0 t7 0`}
              className={t === "shallows" ? "sf-ripple sf-ripple--sand" : "sf-ripple"}
            />
          );
        })}
      </g>

      {/* Currents: a ribbon into the next cell, and chevrons that flow */}
      <g className="sf-stream">
        {currents.map((i) => {
          const j = neighbor(board, i, cells[i].flow as HexDir);
          const [x1, y1] = c(i);
          const [x2, y2] =
            j >= 0 && cells[j].terrain !== "land" && cells[j].terrain !== "reef" ? c(j) : [x1, y1];
          return <line key={i} x1={x1} y1={y1} x2={(x1 + x2) / 2} y2={(y1 + y2) / 2} />;
        })}
      </g>
      {currents.map((i) => {
        const [x, y] = c(i);
        return (
          <g
            key={i}
            transform={`translate(${x} ${y}) rotate(${DIR_ANGLE[cells[i].flow as HexDir]})`}
            className="sf-flow"
          >
            <path d="M-15 0 H15" className="sf-flow-line" />
            <path d="M2 -7 L10 0 L2 7" className="sf-flow-head" />
          </g>
        );
      })}

      {/* Reefs: coral heads and breaking surf (polar: icebergs) */}
      {reef.map((i) => {
        const [x, y] = c(i);
        if (art === "polar") {
          // A faceted berg, its shaded side and a waterline; shapes vary per hex.
          const lean = (h(i, 11) - 0.5) * 6;
          const tall = 10 + h(i, 12) * 6;
          return (
            <g key={i} className="sf-berg">
              <ellipse cx={x} cy={y + 8} rx={HEX * 0.62} ry={HEX * 0.22} className="sf-berg-wake" />
              <path
                d={`M${x - 14} ${y + 8} L${x - 8 + lean} ${y - tall} L${x + 2 + lean} ${y - tall - 4} L${x + 13} ${y - 2} L${x + 15} ${y + 8} Z`}
                className="sf-berg-ice"
              />
              <path
                d={`M${x + 2 + lean} ${y - tall - 4} L${x + 13} ${y - 2} L${x + 15} ${y + 8} L${x + 3} ${y + 8} Z`}
                className="sf-berg-shade"
              />
            </g>
          );
        }
        return (
          <g key={i} className="sf-coral">
            <circle cx={x} cy={y} r={HEX * 0.62} className="sf-surf" />
            {[0, 1, 2, 3, 4, 5].map((k) => {
              const a = h(i, k) * Math.PI * 2;
              const d = 3 + h(i, k + 9) * 10;
              return (
                <circle
                  key={k}
                  cx={x + Math.cos(a) * d}
                  cy={y + Math.sin(a) * d}
                  r={2.2 + h(i, k + 20) * 2.8}
                  className={`sf-coral-${k % 3}`}
                />
              );
            })}
          </g>
        );
      })}

      {/* Islands: raised hex tiles. Shadow, beach, then grass eroded inward. */}
      <g className="sf-land-shadow">{landHexes(HEX + 0.8, 3.5)}</g>
      <g className="sf-sand">{landHexes(HEX + 0.8)}</g>
      <g className="sf-grass" filter="url(#sf-erode)">
        {landHexes(HEX + 0.8)}
      </g>
      {land.map((i) => {
        const [x, y] = c(i);
        const n = landNeighbors(i);
        const r = h(i, 3);
        if (art === "polar") {
          if (n >= 4 && r < 0.5)
            return (
              <g key={i} className="sf-peak">
                <path
                  d={`M${x - 12} ${y + 7} L${x - 3} ${y - 10} L${x + 2} ${y - 4} L${x + 6} ${y - 9} L${x + 13} ${y + 7} Z`}
                />
                <path
                  d={`M${x - 6.5} ${y - 3.5} L${x - 3} ${y - 10} L${x + 0.5} ${y - 5.5} L${x - 2} ${y - 3} Z`}
                  className="sf-peak-snow"
                />
              </g>
            );
          if (r < 0.55)
            return (
              <g
                key={i}
                className="sf-pine"
                transform={`translate(${x + (h(i, 4) - 0.5) * 8} ${y + 2})`}
              >
                <path d="M0 -11 L5 -3 L2.5 -3 L6.5 3 L-6.5 3 L-2.5 -3 L-5 -3 Z" />
                <path d="M0 -11 L2.5 -7 L-2.5 -7 Z" className="sf-pine-snow" />
                <path d="M0 3 V6" className="sf-pine-trunk" />
              </g>
            );
          return null;
        }
        if (n >= 4 && r < 0.5)
          return (
            <g key={i} className="sf-hill">
              <path
                d={`M${x - 11} ${y + 6} L${x - 2} ${y - 9} L${x + 3} ${y - 3} L${x + 6} ${y - 7} L${x + 12} ${y + 6} Z`}
              />
              <path
                d={`M${x - 5} ${y - 4} L${x - 2} ${y - 9} L${x + 1} ${y - 5}`}
                className="sf-hill-snow"
              />
            </g>
          );
        if (r < 0.5)
          return (
            <g
              key={i}
              className="sf-palm"
              transform={`translate(${x + (h(i, 4) - 0.5) * 8} ${y + 3})`}
            >
              <path d="M0 6 Q1 -2 -1 -8" className="sf-palm-trunk" />
              <path
                d="M-1 -8 q-7 -2 -10 3 M-1 -8 q6 -3 10 2 M-1 -8 q-3 -6 -8 -6 M-1 -8 q3 -6 8 -5"
                className="sf-palm-leaf"
              />
            </g>
          );
        return null;
      })}
    </g>
  );
});

export function PlaceMarker({
  place,
  x,
  y,
  done,
}: { place: Place; x: number; y: number; done: boolean }) {
  if (place.kind === "harbor")
    return (
      <g className="sf-place sf-harbor" transform={`translate(${x} ${y})`}>
        <polygon points={hexPoints(0, 0, HEX - 3)} className="sf-place-ring" />
        <path d="M-4 9 L-3 -7 L3 -7 L4 9 Z" className="sf-lh-body" />
        <path d="M-3.4 -1 H3.4 M-3.8 4 H3.8" className="sf-lh-stripe" />
        <path d="M-4.5 -7 L0 -12.5 L4.5 -7 Z" className="sf-lh-top" />
        <circle cy="-9" r="1.6" className="sf-lh-light" />
      </g>
    );
  if (place.kind === "cargo")
    return (
      <g className="sf-place sf-cargo" data-done={done} transform={`translate(${x} ${y})`}>
        <polygon points={hexPoints(0, 0, HEX - 3)} className="sf-place-ring" />
        <rect x="-8" y="-6" width="16" height="13" rx="2" className="sf-crate" />
        <path d="M-8 0 H8 M0 -6 V7" className="sf-crate-band" />
        <g transform="translate(9 -9)">
          <circle r="7.5" className="sf-value" />
          <text y="3.2" textAnchor="middle" className="sf-value-text">
            {done ? "✓" : place.value}
          </text>
        </g>
      </g>
    );
  return (
    <g className="sf-place sf-port" data-done={done} transform={`translate(${x} ${y})`}>
      <polygon points={hexPoints(0, 0, HEX - 3)} className="sf-place-ring sf-target" />
      <path d="M-3 10 V-11" className="sf-flag-pole" />
      <path d="M-3 -11 L10 -7 L-3 -3 Z" className="sf-flag" />
      <rect x="-9" y="4" width="13" height="5" rx="1" className="sf-pier" />
    </g>
  );
}

/** A top-down ship pointing along +x; the parent rotates it to its heading. */
function ShipShape() {
  return (
    <g className="sf-ship-shape">
      <path d="M-15 0 q-6 -5 -12 -6 M-15 0 q-6 5 -12 6" className="sf-wake" />
      <ellipse cx="0" cy="1.5" rx="15" ry="7" className="sf-ship-shadow" />
      <path d="M15 0 C9 -7 -8 -7 -13 -5 L-13 5 C-8 7 9 7 15 0 Z" className="sf-hull" />
      <path d="M11 0 C7 -4.5 -6 -4.5 -10 -3 L-10 3 C-6 4.5 7 4.5 11 0 Z" className="sf-deck" />
      <path d="M3 -9 Q8 0 3 9 L1 9 Q5 0 1 -9 Z" className="sf-sail" />
      <path d="M-5 -7 Q-1 0 -5 7 L-6.5 7 Q-3 0 -6.5 -7 Z" className="sf-sail" />
      <path d="M2 0 L-12 0" className="sf-boom" />
      <path d="M-12 -1.5 L-17 -3 L-17 0 Z" className="sf-pennant" />
    </g>
  );
}

/**
 * Storm clouds over today's stormy hexes (rain, the odd flash of lightning),
 * and a dashed forecast of where the fronts will be tomorrow.
 */
function StormLayer({
  storm,
  centers,
}: {
  storm: { now: ReadonlySet<number>; next: ReadonlySet<number>; drifts: HexDir[] };
  centers: Array<[number, number]>;
}) {
  const now = [...storm.now];
  const next = [...storm.next].filter((c) => !storm.now.has(c));
  // One drift arrow at the middle of today's clouds (fronts usually share a wind).
  const mid = now.length
    ? now
        .reduce(([sx, sy], c) => [sx + centers[c][0], sy + centers[c][1]], [0, 0])
        .map((v) => v / now.length)
    : null;
  return (
    <g className="sf-storm">
      {next.map((c) => {
        const [x, y] = centers[c];
        return <polygon key={`f${c}`} points={hexPoints(x, y, HEX - 3)} className="sf-forecast" />;
      })}
      {now.map((c) => {
        const [x, y] = centers[c];
        return (
          <g key={c} className="sf-cloud" transform={`translate(${x} ${y})`}>
            <polygon points={hexPoints(0, 0, HEX - 0.7)} className="sf-cloud-hex" />
            <g className="sf-rain" style={{ animationDelay: `${-(h(c, 7) * 0.8).toFixed(2)}s` }}>
              <path d="M-9 -6 l-3 7 M-1 -9 l-3 7 M7 -5 l-3 7 M-5 4 l-3 7 M4 5 l-3 7" />
            </g>
            <path
              d="M-6 -10 C-10 -10 -11 -4 -7 -3 L7 -3 C11 -3 11 -9 6 -9 C5 -13 -2 -14 -6 -10 Z"
              className="sf-cloud-puff"
            />
            {h(c, 8) < 0.35 && (
              <path
                d="M1 -3 L-3 4 L1 4 L-2 11"
                className="sf-bolt"
                style={{ animationDelay: `${(h(c, 9) * 4).toFixed(2)}s` }}
              />
            )}
          </g>
        );
      })}
      {mid && storm.drifts[0] && (
        <g
          className="sf-storm-drift"
          transform={`translate(${mid[0]} ${mid[1]}) rotate(${DIR_ANGLE[storm.drifts[0]]})`}
        >
          <path d="M14 0 H30 M24 -6 L31 0 L24 6" />
        </g>
      )}
    </g>
  );
}

export interface Overlay {
  legs: readonly Leg[];
  kind: RouteKind | "mine";
}

export interface SeafarerMapProps {
  board: Board;
  places: Place[];
  visited: readonly string[];
  /** Where the voyage starts. */
  start: number;
  /** The current voyage's legs (drawn up to `revealUpTo` while the ship moves). */
  legs: readonly Leg[];
  revealUpTo?: number;
  /** Ship position and heading in degrees (unwrapped, so turns animate the short way). */
  ship: { cell: number; heading: number; moving: boolean; hidden?: boolean };
  /** Cells the ship can sail into next. */
  reachable: readonly number[];
  /** Hovered or aimed cell, the cells the move would pass through, and its cost. */
  target: { cell: number; path: readonly number[]; label: string; aimed: boolean } | null;
  overlay?: Overlay | null;
  /** Stormy cells today and tomorrow (the forecast), and which way each front drifts. */
  storm?: { now: ReadonlySet<number>; next: ReadonlySet<number>; drifts: HexDir[] } | null;
  /** The ship just dropped anchor (plays a small animation). */
  anchoring?: boolean;
  /** Decoration style for the pack's setting. */
  art?: SeafarerArt;
  interactive: boolean;
  onCellEnter?: (cell: number | null) => void;
  onCellTap?: (cell: number, pointerType: string) => void;
}

function pathD(cols: number, cells: readonly number[]): string {
  return cells
    .map((cell, i) => {
      const [x, y] = cellCenter(cols, cell);
      return `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

/** Route as path data: the first step of each leg is sailed, the rest drifts. */
export function routeSegments(cols: number, start: number, legs: readonly Leg[]) {
  const sailed: string[] = [];
  const drift: string[] = [];
  let at = start;
  for (const leg of legs) {
    sailed.push(pathD(cols, [at, leg.path[0]]));
    if (leg.path.length > 1) drift.push(pathD(cols, leg.path));
    at = leg.path[leg.path.length - 1];
  }
  return { sailed: sailed.join(" "), drift: drift.join(" ") };
}

export function SeafarerMap(props: SeafarerMapProps) {
  const { board, places, visited, start, legs, ship, reachable, target, overlay } = props;
  const { cols, rows } = board;
  const { w, h: hgt } = chartSize(cols, rows);
  const svgRef = useRef<SVGSVGElement>(null);
  const centers = useMemo(() => board.cells.map((_, i) => cellCenter(cols, i)), [board, cols]);

  const shown = props.revealUpTo === undefined ? legs : legs.slice(0, props.revealUpTo);
  const route = routeSegments(cols, start, shown);
  const crossed = new Set<number>([start]);
  for (const l of shown) for (const c of l.path) crossed.add(c);
  const ref = overlay ? routeSegments(cols, start, overlay.legs) : null;
  const [sx, sy] = centers[ship.cell];
  const pct = (x: number, y: number): CSSProperties => ({
    left: `${(x / w) * 100}%`,
    top: `${(y / hgt) * 100}%`,
  });

  const cellAt = (e: PointerEvent<SVGSVGElement>): number => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return -1;
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best = -1;
    let bestD = HEX * HEX * 0.9;
    centers.forEach(([x, y], i) => {
      const d = (x - pt.x) ** 2 + (y - pt.y) ** 2;
      if (d < bestD) [bestD, best] = [d, i];
    });
    return best;
  };

  return (
    <div className="sf-chart" style={{ aspectRatio: `${w.toFixed(0)} / ${hgt.toFixed(0)}` }}>
      <svg
        ref={svgRef}
        className="sf-map"
        viewBox={`0 0 ${w.toFixed(0)} ${hgt.toFixed(0)}`}
        role="img"
        aria-label="Sea chart"
        data-interactive={props.interactive}
        onPointerMove={(e) => {
          if (props.interactive && e.pointerType === "mouse") props.onCellEnter?.(cellAt(e));
        }}
        onPointerLeave={() => props.onCellEnter?.(null)}
        onPointerUp={(e) => {
          if (!props.interactive) return;
          const c = cellAt(e);
          if (c >= 0) props.onCellTap?.(c, e.pointerType);
        }}
      >
        <defs>
          <filter id="sf-erode" x="-10%" y="-10%" width="120%" height="120%">
            <feMorphology operator="erode" radius="5.5" />
          </filter>
        </defs>

        <Terrain board={board} art={props.art} />

        {/* Waters this voyage has crossed */}
        <g className="sf-wakecells">
          {[...crossed].map((c) => {
            const [x, y] = centers[c];
            return <polygon key={c} points={hexPoints(x, y, HEX - 2)} />;
          })}
        </g>

        {/* Where the ship can go next */}
        {props.interactive &&
          reachable.map((c) => {
            const [x, y] = centers[c];
            return (
              <polygon
                key={c}
                points={hexPoints(x, y, HEX - 2.5)}
                className="sf-reach"
                data-target={target?.cell === c}
              />
            );
          })}

        {props.storm && <StormLayer storm={props.storm} centers={centers} />}

        {ref && (
          <g className="sf-overlay" data-kind={overlay?.kind}>
            <path d={ref.sailed} />
            <path d={ref.drift} />
          </g>
        )}

        <g className="sf-route">
          <path d={route.sailed} className="sf-route-glow" />
          <path d={route.drift} className="sf-route-glow" />
          <path d={route.sailed} className="sf-route-sail" />
          <path d={route.drift} className="sf-route-drift" />
        </g>

        {target && target.path.length > 0 && (
          <path d={pathD(cols, [ship.cell, ...target.path])} className="sf-preview" />
        )}

        {places.map((pl) => {
          const [x, y] = centers[pl.cell];
          return <PlaceMarker key={pl.id} place={pl} x={x} y={y} done={visited.includes(pl.id)} />;
        })}

        <g
          className="sf-ship"
          data-anchoring={!!props.anchoring}
          data-moving={ship.moving}
          data-hidden={!!ship.hidden}
          style={{ transform: `translate(${sx}px, ${sy}px)` }}
        >
          <g className="sf-ship-turn" style={{ transform: `rotate(${ship.heading}deg)` }}>
            <ShipShape />
          </g>
          <g className="sf-anchor-mark">
            <circle r="9" />
            <path d="M0 -5 V5 M-4 2 Q0 7 4 2 M-2.5 -3 H2.5" />
          </g>
        </g>
      </svg>

      {/* Text overlays in real pixels, legible at any size */}
      {places.map((pl) => {
        const [x, y] = centers[pl.cell];
        return (
          <span
            key={pl.id}
            className="sf-tag"
            data-kind={pl.kind}
            data-done={visited.includes(pl.id)}
            style={pct(x, y + HEX * 0.95)}
          >
            {pl.kind === "harbor" ? "Start" : pl.name}
          </span>
        );
      })}
      {target && (
        <span
          className="sf-cost"
          data-aimed={target.aimed}
          style={pct(centers[target.cell][0], centers[target.cell][1] - HEX * 1.05)}
        >
          {target.label}
          {target.aimed && <em>Tap again to sail</em>}
        </span>
      )}
    </div>
  );
}
