import { dayIndex, weekday } from "../../core/daily.js";
import { seededRng, shuffle } from "../../core/rng.js";
import { SIZE_5 } from "./art/size5.js";
import { SIZE_7 } from "./art/size7.js";
import { SIZE_8 } from "./art/size8.js";
import { SIZE_10 } from "./art/size10.js";
import { SIZE_12 } from "./art/size12.js";

// The Box Plot library: square pictures whose rows also carry their colours.
// "." is an empty cell; every other character is a palette key, so one
// string gives both the shape (what the player solves) and the colours the
// picture flips to once it's solved.
//
//   { name: "Flame", palette: { R: "#dc2626", O: "#f97316", Y: "#facc15" },
//     rows: ["...R....", "..RR....", …] }

export interface ColorPicture {
  name: string;
  /** Palette key → CSS colour. Keys are single characters other than ".". */
  palette: Record<string, string>;
  /** One string per row, each as long as there are rows. */
  rows: string[];
}

/** Grid sizes the player view supports. */
export const BOX_PLOT_SIZES = [5, 7, 8, 10, 12] as const;
export type BoxPlotSize = (typeof BOX_PLOT_SIZES)[number];

export interface BoxPlotDay {
  size: BoxPlotSize;
  /**
   * Harder days at a size share its pool with an easier day: the easier day
   * takes the smoother half (long runs like "7"), this day the choppier half
   * (broken runs like "1 3 1").
   */
  choppy: boolean;
}

/** Index = weekday (0 Sunday … 6 Saturday). Easy Monday → hardest Sunday. */
export const BOX_PLOT_DAYS: Record<number, BoxPlotDay> = {
  1: { size: 5, choppy: false },
  2: { size: 7, choppy: false },
  3: { size: 8, choppy: false },
  4: { size: 10, choppy: false },
  5: { size: 10, choppy: true },
  6: { size: 12, choppy: false },
  0: { size: 12, choppy: true },
};

/** Weekdays drawing on each size: one, or an easier and a choppier day. */
const daysForSize = (size: number) =>
  Object.entries(BOX_PLOT_DAYS)
    .filter(([, d]) => d.size === size)
    .map(([wd, d]) => ({ wd: Number(wd), ...d }));

/** Whether a picture cell is filled. */
export const isFilledChar = (ch: string) => ch !== ".";

/**
 * How broken up a picture's clues are: the average number of runs per row
 * and column. A solid block scores 1; a checkerboard scores about size / 2.
 */
export function choppiness(rows: readonly string[]): number {
  const n = rows.length;
  const lines = [...rows, ...Array.from({ length: n }, (_, c) => rows.map((r) => r[c]).join(""))];
  const runs = lines.reduce((t, line) => t + (line.match(/[^.]+/g)?.length ?? 0), 0);
  return runs / lines.length;
}

/** Every picture, any size. */
export const LIBRARY: ColorPicture[] = [...SIZE_5, ...SIZE_7, ...SIZE_8, ...SIZE_10, ...SIZE_12];

/**
 * The pictures a weekday draws from: its size, then — when two days share
 * the size — its half by choppiness. Ties keep library order.
 */
export function poolFor(wd: number, library: ColorPicture[] = LIBRARY): ColorPicture[] {
  const day = BOX_PLOT_DAYS[wd];
  const sized = library.filter((p) => p.rows.length === day.size);
  const sharing = daysForSize(day.size);
  if (sharing.length < 2) return sized;
  const ranked = [...sized].sort((a, b) => choppiness(a.rows) - choppiness(b.rows));
  const half = Math.ceil(ranked.length / 2);
  return day.choppy ? ranked.slice(half) : ranked.slice(0, half);
}

/**
 * Today's picture: each weekday walks its own fixed shuffle of its pool, one
 * step a week, so a picture doesn't repeat until the pool has been used.
 * Falls back to the whole library if a pool is empty.
 */
export function pictureForDate(date: string, library: ColorPicture[] = LIBRARY): ColorPicture {
  const wd = weekday(date);
  const pool = poolFor(wd, library);
  const list = pool.length ? pool : library;
  const order = shuffle(
    seededRng(`box-plot:order:${wd}`),
    list.map((_, i) => i),
  );
  const week = Math.floor(dayIndex(date) / 7);
  return list[order[((week % order.length) + order.length) % order.length]];
}
