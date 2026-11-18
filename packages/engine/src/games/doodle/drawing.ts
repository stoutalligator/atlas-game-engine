// The drawing board's state, as a pure reducer: pen strokes, eraser, undo
// and clear. The component feeds it pointer input already converted to
// canvas units; everything here is testable without a DOM.

import { clipStrokes, densify, eraseStrokes, roundPath, simplify } from "./geometry.js";
import type { DoodlePath, DoodlePoint, DoodleRect } from "./types.js";

/** Eraser radius in canvas units (~a fingertip on a phone). */
export const DOODLE_ERASER_RADIUS = 22;
/** Pen and eraser strokes are resampled to at most this spacing. */
const STEP = 3;

export interface DrawingState {
  strokes: DoodlePath[];
  /** Previous stroke lists, newest last (each pen or eraser action, and Clear, is one step). */
  undo: DoodlePath[][];
}

export const emptyDrawing = (): DrawingState => ({ strokes: [], undo: [] });

export type DrawingAction =
  | { kind: "pen"; points: DoodlePath; region: readonly DoodleRect[] }
  | {
      kind: "erase";
      points: DoodlePath /** Canvas units; defaults to DOODLE_ERASER_RADIUS. */;
      radius?: number;
    }
  | { kind: "undo" }
  | { kind: "clear" };

const MAX_UNDO = 100;
const push = (undo: DoodlePath[][], prev: DoodlePath[]) => [...undo, prev].slice(-MAX_UNDO);

/** Smooths raw pointer samples into a stored stroke (still freehand: no straightening). */
export function finishStroke(points: DoodlePath): DoodlePath {
  if (points.length === 1) return [points[0], points[0]];
  return roundPath(simplify(densify(points, STEP), 0.8));
}

export function drawingReducer(state: DrawingState, action: DrawingAction): DrawingState {
  switch (action.kind) {
    case "pen": {
      if (action.points.length === 0) return state;
      // Anything outside the drawing region is discarded, not just penalized.
      const pieces = clipStrokes([densify(action.points, STEP)], action.region, 1.5).map(
        finishStroke,
      );
      if (pieces.length === 0) return state;
      return { strokes: [...state.strokes, ...pieces], undo: push(state.undo, state.strokes) };
    }
    case "erase": {
      if (action.points.length === 0 || state.strokes.length === 0) return state;
      const dense = state.strokes.map((s) => densify(s, STEP));
      const next = eraseStrokes(
        dense,
        densify(action.points, STEP),
        Math.max(DOODLE_ERASER_RADIUS, action.radius ?? 0),
      );
      const changed =
        next.length !== state.strokes.length ||
        next.reduce((n, s) => n + s.length, 0) !== dense.reduce((n, s) => n + s.length, 0);
      if (!changed) return state;
      return { strokes: next.map(finishStroke), undo: push(state.undo, state.strokes) };
    }
    case "undo": {
      if (state.undo.length === 0) return state;
      return { strokes: state.undo[state.undo.length - 1], undo: state.undo.slice(0, -1) };
    }
    case "clear": {
      if (state.strokes.length === 0) return state;
      return { strokes: [], undo: push(state.undo, state.strokes) };
    }
  }
}

/** Strokes ready to submit: rounded to a decimal place and lightly simplified. */
export function strokesForSubmit(strokes: readonly DoodlePath[]): DoodlePath[] {
  return strokes.map((s) => roundPath(simplify(s, 0.8))).filter((s) => s.length > 0);
}

/** Point helper for tests and the component. */
export const pt = (x: number, y: number): DoodlePoint => [x, y];

/**
 * Converts a pointer position on the rendered canvas (CSS pixels) to canvas
 * units. The board keeps its aspect ratio, so the same spot on a phone and a
 * desktop gives the same numbers.
 */
export function toCanvasUnits(
  clientX: number,
  clientY: number,
  box: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): DoodlePoint {
  return [
    Math.round(((clientX - box.left) / box.width) * width * 10) / 10,
    Math.round(((clientY - box.top) / box.height) * height * 10) / 10,
  ];
}
