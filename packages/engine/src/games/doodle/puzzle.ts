// Turning a source + variant into what the player sees, the hidden answer,
// and share text.

import { getGameInfo } from "../../catalog.js";
import { puzzleNumber } from "../../core/daily.js";
import { withShareLink } from "../../core/share.js";
import { clampRects, cutPaths, inRects, roundPath, simplify, splitRuns } from "./geometry.js";
import type {
  DoodleDifficulty,
  DoodleLabel,
  DoodlePath,
  DoodlePuzzle,
  DoodleRect,
  DoodleSource,
  DoodleVariant,
} from "./types.js";
import { DOODLE_WIDTH } from "./types.js";

/** The prompt for a source: its own, or one built from its type and title. */
export function doodlePrompt(source: Pick<DoodleSource, "type" | "title" | "prompt">): string {
  if (source.prompt) return source.prompt;
  switch (source.type) {
    case "shape":
      return `Complete the outline of ${source.title}.`;
    case "line":
      return `Draw the missing part of ${source.title}.`;
    case "trend":
      return `Finish the chart: ${source.title}.`;
  }
}

/** Visible geometry is simplified a little: small payload, same look. */
const compact = (paths: DoodlePath[]) =>
  paths.map((p) => roundPath(simplify(p, 0.6))).filter((p) => p.length > 1);

export function maskRects(
  source: DoodleSource,
  variant: Pick<DoodleVariant, "mask">,
): DoodleRect[] {
  return clampRects(variant.mask.rects, DOODLE_WIDTH, source.height);
}

/** A label's box in canvas units (34px bold text: ~19 units a character, baseline at y). */
export function labelBox(
  text: string,
  x: number,
  y: number,
  anchor: DoodleLabel["anchor"] = "middle",
): DoodleRect {
  const w = text.length * 19;
  const x0 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2;
  return { x: x0, y: y - 28, w, h: 36 };
}

const overlaps = (a: DoodleRect, b: DoodleRect, gap: number) =>
  a.x < b.x + b.w + gap && a.x + a.w + gap > b.x && a.y < b.y + b.h + gap && a.y + a.h + gap > b.y;

/**
 * Map labels never sit in the drawing area: each takes its first spot that
 * stays out of the region and clear of labels already placed, or is left out.
 * At most `max` are shown (the first ones, which are the most useful).
 */
export function placeMapLabels(
  labels: readonly DoodleLabel[],
  region: readonly DoodleRect[],
  max = 6,
): DoodleLabel[] {
  const placed: DoodleRect[] = [];
  const out: DoodleLabel[] = [];
  for (const l of labels) {
    if (out.length >= max) break;
    for (const [x, y] of [[l.x, l.y] as [number, number], ...(l.alt ?? [])]) {
      const box = labelBox(l.text, x, y, l.anchor);
      if (region.some((r) => overlaps(box, r, 6)) || placed.some((p) => overlaps(box, p, 10)))
        continue;
      placed.push(box);
      out.push({ x, y, text: l.text, ...(l.anchor ? { anchor: l.anchor } : {}) });
      break;
    }
  }
  return out;
}

/** The puzzle as the browser gets it: the visible part, context and the drawing region. */
export function buildDoodlePuzzle(source: DoodleSource, variant: DoodleVariant): DoodlePuzzle {
  const region = maskRects(source, variant);
  const cut = cutPaths(source.paths, region);
  return {
    id: variant.id,
    type: source.type,
    category: source.category,
    difficulty: variant.difficulty,
    prompt: doodlePrompt(source),
    width: DOODLE_WIDTH,
    height: source.height,
    visible: compact(cut.visible),
    // Map context (borders around a river or lake) stops at the drawing area: a
    // border that follows the hidden river would otherwise draw the answer.
    // Chart axes stay whole.
    guides: compact(
      source.type === "trend"
        ? (source.guides ?? [])
        : (source.guides ?? []).flatMap((g) => splitRuns(g, (p) => !inRects(p, region))),
    ),
    labels:
      source.type === "trend" ? (source.labels ?? []) : placeMapLabels(source.labels ?? [], region),
    region,
    visibility: Math.round(cut.visibility * 1000) / 1000,
  };
}

/**
 * The answer: the hidden geometry, in reveal order (source path order, then
 * along each path). Server-side only until the player has submitted.
 */
export function doodleReference(
  source: DoodleSource,
  variant: Pick<DoodleVariant, "mask">,
): DoodlePath[] {
  return compact(cutPaths(source.paths, maskRects(source, variant)).missing);
}

/** One-line credit for the reveal, e.g. "Natural Earth (public domain)". */
export function doodleCredit(source: DoodleSource): string {
  const p = source.provenance;
  return p.attribution ?? `${p.source} (${p.license})`;
}

const DIFFICULTY_LABEL: Record<DoodleDifficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};
export const doodleDifficultyLabel = (d: DoodleDifficulty) => DIFFICULTY_LABEL[d];

/** "🟩🟩🟩🟩🟩🟩🟩🟨⬜⬜" — one square per 10%. */
export function doodleBar(score: number): string {
  const full = Math.floor(score / 10);
  const half = score % 10 >= 5 ? 1 : 0;
  return "🟩".repeat(full) + "🟨".repeat(half) + "⬜".repeat(10 - full - half);
}

/** Share text (no spoilers: the subject isn't named). */
export function doodleShareText(date: string, difficulty: DoodleDifficulty, score: number): string {
  return withShareLink(
    "doodle",
    [
      `ATLAS ${getGameInfo("doodle").title} #${puzzleNumber(date)} · ${DIFFICULTY_LABEL[difficulty]}`,
      `✏️ ${score}% match`,
      doodleBar(score),
    ].join("\n"),
  );
}
