// Trend sources are drawn from their numbers, never from a screenshot: the
// series is stored with the source and the chart geometry is built here.

import type {
  DoodleLabel,
  DoodlePath,
  DoodleProvenance,
  DoodleSeries,
  DoodleSource,
} from "./types.js";

export interface TrendSourceInput {
  id: string;
  category: string;
  title: string;
  prompt?: string;
  series: DoodleSeries;
  provenance: DoodleProvenance;
  height?: number;
  /** Lowest value on the y axis (default: 0 when every value is ≥ 0, else the minimum). */
  yMin?: number;
  /** Highest value on the y axis (default: the maximum). */
  yMax?: number;
  /** How many x-axis labels (default 4). */
  xLabels?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** "2019-01" → "2019", "2019-07" stays; anything else is shown as given. */
const shortPeriod = (p: string) => (/^\d{4}-01(-01)?$/.test(p) ? p.slice(0, 4) : p);

const fmt = (n: number) =>
  Math.abs(n) >= 1000 ? n.toLocaleString("en-US", { maximumFractionDigits: 0 }) : String(round1(n));

/** Builds a trend Doodle source: a line chart with axes and a few labels. */
export function trendSource(input: TrendSourceInput): DoodleSource {
  const height = input.height ?? 620;
  const pts = input.series.points;
  if (pts.length < 2) throw new Error(`${input.id}: a trend needs at least 2 points`);
  const values = pts.map(([, v]) => v);
  const lo = input.yMin ?? (Math.min(...values) >= 0 ? 0 : Math.min(...values));
  const hi = input.yMax ?? Math.max(...values);
  const span = hi - lo || 1;
  const left = 90;
  const right = 960;
  const top = 50;
  const bottom = height - 80;
  const x = (i: number) => left + ((right - left) * i) / (pts.length - 1);
  const y = (v: number) => bottom - ((bottom - top) * (v - lo)) / span;
  const line: DoodlePath = pts.map(([, v], i) => [round1(x(i)), round1(y(v))]);
  const guides: DoodlePath[] = [
    [
      [left - 20, top - 10],
      [left - 20, bottom + 15],
      [right + 20, bottom + 15],
    ],
  ];
  const n = Math.max(2, input.xLabels ?? 4);
  const labels: DoodleLabel[] = [];
  for (let k = 0; k < n; k++) {
    const i = Math.round((k * (pts.length - 1)) / (n - 1));
    labels.push({
      x: round1(x(i)),
      y: bottom + 50,
      text: shortPeriod(pts[i][0]),
      anchor: k === 0 ? "start" : k === n - 1 ? "end" : "middle",
    });
  }
  labels.push({ x: left - 30, y: top + 6, text: fmt(hi), anchor: "end" });
  labels.push({ x: left - 30, y: bottom + 6, text: fmt(lo), anchor: "end" });
  return {
    id: input.id,
    type: "trend",
    category: input.category,
    title: input.title,
    prompt: input.prompt,
    height,
    paths: [line],
    guides,
    labels,
    series: input.series,
    provenance: input.provenance,
  };
}
