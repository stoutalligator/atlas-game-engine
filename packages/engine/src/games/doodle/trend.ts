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
  /** How many x-axis labels when the periods aren't dates (default 4); dated series get ticks from their span. */
  xLabels?: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Axis label for a period: "2019" for January (or a bare year), "Jul 2019" otherwise. */
export function shortPeriod(p: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(p);
  if (!m) return p;
  return m[2] === "01" ? m[1] : `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** A period as fractional years ("2019" → 2019, "2019-07" → 2019.5), or null when it isn't a date. */
export function periodYears(p: string): number | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(p);
  if (!m) return null;
  return Number(m[1]) + ((m[2] ? Number(m[2]) - 1 : 0) + (m[3] ? (Number(m[3]) - 1) / 31 : 0)) / 12;
}

/** Rough label width in canvas units at the board's label size (34px bold). */
const textWidth = (t: string) => t.length * 19;

interface Tick {
  /** Fractional index into the points. */
  at: number;
  text: string;
  /** Second row (the year under a month). */
  sub?: string;
}

/**
 * X-axis ticks from the series' time span: every month or quarter (with the
 * year underneath) for short charts, every year (or every few) for long ones.
 * Null when the periods aren't dates.
 */
export function trendTicks(periods: readonly string[]): Tick[] | null {
  const ts = periods.map(periodYears);
  if (ts.some((t) => t === null) || ts.length < 2) return null;
  const t = ts as number[];
  const t0 = t[0];
  const t1 = t[t.length - 1];
  const yearly = periods.every((p) => /^\d{4}$/.test(p));
  // Fractional index of time `v` (the series is in order).
  const indexOf = (v: number) => {
    if (v <= t[0]) return 0;
    for (let i = 1; i < t.length; i++)
      if (v <= t[i]) return i - 1 + (v - t[i - 1]) / (t[i] - t[i - 1] || 1);
    return t.length - 1;
  };
  const span = t1 - t0;
  const ticks: Tick[] = [];
  if (!yearly && span <= 3.2) {
    const step = span <= 0.8 ? 1 : span <= 1.4 ? 2 : 3; // months
    let first = true;
    for (let y = Math.floor(t0); y <= Math.ceil(t1); y++)
      for (let m = 0; m < 12; m += step) {
        const v = y + m / 12;
        // A few weeks of slack: a series of weekly sums starting Jan 2 still gets its "Jan".
        if (v < t0 - 0.06 || v > t1 + 0.02) continue;
        ticks.push({
          at: indexOf(v),
          text: MONTHS[m],
          sub: m === 0 || first ? String(y) : undefined,
        });
        first = false;
      }
  } else {
    const years = Math.ceil(span);
    const step = [1, 2, 5, 10, 20, 50].find((s) => years / s <= 9) ?? 50;
    for (let y = Math.ceil(t0 - 0.06); y <= t1 + 0.02; y++)
      if (y % step === 0) ticks.push({ at: indexOf(y), text: String(y) });
  }
  return ticks;
}

/** Short axis labels: 1,313 → "1.3k", 12,500,000 → "12.5M". */
const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${round1(n / 1e6)}M`;
  if (a >= 1e3) return `${round1(n / 1e3)}k`;
  return String(round1(n));
};

/** Builds a trend Doodle source: a line chart with axes and a few labels. */
export function trendSource(input: TrendSourceInput): DoodleSource {
  const height = input.height ?? 620;
  const pts = input.series.points;
  if (pts.length < 2) throw new Error(`${input.id}: a trend needs at least 2 points`);
  const values = pts.map(([, v]) => v);
  const lo = input.yMin ?? (Math.min(...values) >= 0 ? 0 : Math.min(...values));
  const hi = input.yMax ?? Math.max(...values);
  const span = hi - lo || 1;
  const ticks = trendTicks(pts.map(([p]) => p));
  const twoRows = !!ticks?.some((t) => t.sub);
  // Room for the y-axis labels (up to ~5 characters at the board's label size).
  const left = 130;
  const right = 960;
  const top = 50;
  const bottom = height - (twoRows ? 118 : 80);
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
  const labels: DoodleLabel[] = [];
  // A label centred on x, kept on the canvas; null when it would crowd the previous one.
  const place = (cx: number, yy: number, text: string, last: { right: number }) => {
    const w = textWidth(text);
    const l = Math.max(8, Math.min(992 - w, cx - w / 2));
    if (l < last.right + 14) return false;
    last.right = l + w;
    labels.push({ x: round1(l), y: yy, text, anchor: "start" });
    return true;
  };
  if (ticks) {
    const row1 = { right: Number.NEGATIVE_INFINITY };
    const row2 = { right: Number.NEGATIVE_INFINITY };
    for (const tk of ticks) {
      const cx = x(tk.at);
      if (!place(cx, bottom + 52, tk.text, row1)) continue;
      guides.push([
        [round1(cx), bottom + 15],
        [round1(cx), bottom + 27],
      ]);
      if (tk.sub) place(cx, bottom + 92, tk.sub, row2);
    }
  } else {
    const n = Math.max(2, input.xLabels ?? 4);
    for (let k = 0; k < n; k++) {
      const i = Math.round((k * (pts.length - 1)) / (n - 1));
      labels.push({
        x: round1(x(i)),
        y: bottom + 50,
        text: shortPeriod(pts[i][0]),
        anchor: k === 0 ? "start" : k === n - 1 ? "end" : "middle",
      });
    }
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
