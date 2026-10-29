import { type Placed, boundsOf, cellKey, cellsOf, crossingsBetween, letterMap } from "./grid.js";
import type { ValidatorResult } from "./types.js";

// Hard rules. Every published puzzle passes all of them; the builder
// (construct.ts) proposes layouts and these decide. Each rule reports on its
// own so a rejection says exactly what broke.

export const LAYOUT_LIMITS = {
  minAnswers: 4,
  maxAnswers: 7,
  minLength: 3,
  maxLength: 10,
  /** Largest board the player view supports (phone width at a readable cell size). */
  maxRows: 11,
  maxCols: 11,
};

export type LayoutLimits = typeof LAYOUT_LIMITS;

export interface UnlockNode extends Placed {
  parent: string | null;
  requires?: string[];
}

const ok = (rule: string): ValidatorResult => ({ rule, ok: true });
const fail = (rule: string, detail: string): ValidatorResult => ({ rule, ok: false, detail });
const check = (rule: string, problems: string[]): ValidatorResult =>
  problems.length ? fail(rule, problems.join("; ")) : ok(rule);

/** Geometry rules (1–19, 27): the completed grid is one legal crossword. */
export function validateLayout(
  answers: Placed[],
  size?: { rows: number; cols: number },
  limits: LayoutLimits = LAYOUT_LIMITS,
): ValidatorResult[] {
  const results: ValidatorResult[] = [];

  results.push(
    answers.length >= limits.minAnswers && answers.length <= limits.maxAnswers
      ? ok("answer-count")
      : fail(
          "answer-count",
          `${answers.length} answers (need ${limits.minAnswers}–${limits.maxAnswers})`,
        ),
  );

  results.push(
    check(
      "answer-letters",
      answers
        .filter(
          (a) =>
            !/^[A-Z]+$/.test(a.grid) ||
            a.grid.length < limits.minLength ||
            a.grid.length > limits.maxLength,
        )
        .map(
          (a) => `${a.id} "${a.grid}" must be ${limits.minLength}–${limits.maxLength} letters A–Z`,
        ),
    ),
  );

  const ids = new Set<string>();
  const grids = new Set<string>();
  const dupes: string[] = [];
  for (const a of answers) {
    if (ids.has(a.id)) dupes.push(`id ${a.id} repeats`);
    if (grids.has(a.grid)) dupes.push(`${a.grid} appears twice`);
    ids.add(a.id);
    grids.add(a.grid);
  }
  results.push(check("unique-answers", dupes));

  // Rules 4, 8: shared cells agree. Rules 5, 6, 9, 10: at most one answer per
  // direction in a cell (so no overlap or embedding in the same direction),
  // which caps a cell at two answers.
  const letters = letterMap(answers);
  const conflicts = [...letters].filter(([, l]) => l === "!").map(([k]) => `cell ${k}`);
  results.push(check("matching-intersections", conflicts));

  const owners = new Map<string, { across: string[]; down: string[] }>();
  for (const a of answers)
    for (const [r, c] of cellsOf(a)) {
      const k = cellKey(r, c);
      const o = owners.get(k) ?? { across: [], down: [] };
      o[a.direction].push(a.id);
      owners.set(k, o);
    }
  const stacked = [...owners]
    .filter(([, o]) => o.across.length > 1 || o.down.length > 1)
    .map(([k, o]) => `cell ${k} holds ${[...o.across, ...o.down].join(", ")}`);
  results.push(check("one-answer-per-direction", stacked));

  // Rule 7: a pair crosses at most once.
  const twice: string[] = [];
  for (let i = 0; i < answers.length; i++)
    for (let j = i + 1; j < answers.length; j++)
      if (crossingsBetween(answers[i], answers[j]).length > 1)
        twice.push(`${answers[i].id}/${answers[j].id}`);
  results.push(check("cross-at-most-once", twice));

  // Rules 11–17: every maximal run of 2+ letters, in either direction, is
  // exactly one registered answer — no extensions, no side-by-side strings.
  results.push(check("runs-are-answers", strayRuns(answers, letters)));

  // Rules 1, 2, 18: one connected crossword.
  results.push(check("connected", disconnected(answers)));

  // Rule 19: every filled cell belongs to an answer (true by construction, but
  // checked so malformed input can't sneak through).
  const orphan = [...letters.keys()].filter((k) => !owners.has(k));
  results.push(
    check(
      "no-orphan-cells",
      orphan.map((k) => `cell ${k}`),
    ),
  );

  // Rule 27: fits the board, anchored at (0, 0).
  const b = boundsOf(answers.flatMap(cellsOf));
  const bounds: string[] = [];
  if (b.minRow !== 0 || b.minCol !== 0) bounds.push(`layout starts at ${b.minRow},${b.minCol}`);
  if (b.rows > limits.maxRows || b.cols > limits.maxCols)
    bounds.push(`${b.rows}×${b.cols} is larger than ${limits.maxRows}×${limits.maxCols}`);
  if (size && (size.rows !== b.rows || size.cols !== b.cols))
    bounds.push(`declared ${size.rows}×${size.cols} but answers span ${b.rows}×${b.cols}`);
  results.push(check("within-bounds", bounds));

  return results;
}

function strayRuns(answers: Placed[], letters: Map<string, string>): string[] {
  const problems: string[] = [];
  const spans = new Set(answers.map((a) => `${a.direction}:${a.row},${a.col}:${a.grid.length}`));
  const filled = (r: number, c: number) => letters.has(cellKey(r, c));
  const b = boundsOf(answers.flatMap(cellsOf));
  for (const dir of ["across", "down"] as const) {
    const outer = dir === "across" ? b.rows : b.cols;
    const inner = dir === "across" ? b.cols : b.rows;
    for (let o = 0; o < outer; o++) {
      let len = 0;
      for (let i = 0; i <= inner; i++) {
        const r = b.minRow + (dir === "across" ? o : i);
        const c = b.minCol + (dir === "across" ? i : o);
        if (i < inner && filled(r, c)) {
          len++;
          continue;
        }
        if (len >= 2) {
          const sr = dir === "across" ? r : r - len;
          const sc = dir === "across" ? c - len : c;
          if (!spans.has(`${dir}:${sr},${sc}:${len}`)) {
            const word = Array.from({ length: len }, (_, k) =>
              letters.get(cellKey(dir === "across" ? sr : sr + k, dir === "across" ? sc + k : sc)),
            ).join("");
            problems.push(`unregistered ${dir} run "${word}" at ${sr},${sc}`);
          }
        }
        len = 0;
      }
    }
  }
  return problems;
}

function disconnected(answers: Placed[]): string[] {
  if (answers.length === 0) return ["no answers"];
  const seen = new Set([answers[0].id]);
  const queue = [answers[0]];
  while (queue.length) {
    const a = queue.shift() as Placed;
    for (const b of answers)
      if (!seen.has(b.id) && crossingsBetween(a, b).length > 0) {
        seen.add(b.id);
        queue.push(b);
      }
  }
  return answers.filter((a) => !seen.has(a.id)).map((a) => `${a.id} is not connected`);
}

/** Which answers show for a set of solved ids: the start, solved ones, and children of solved ones. */
export function visibleIds(nodes: UnlockNode[], solved: ReadonlySet<string>): Set<string> {
  const visible = new Set<string>();
  for (const n of nodes) {
    if (n.parent === null || solved.has(n.id)) visible.add(n.id);
    else if (solved.has(n.parent) && (n.requires ?? []).every((id) => solved.has(id)))
      visible.add(n.id);
  }
  return visible;
}

/** Unlock-graph rules (20–26). */
export function validateUnlockGraph(nodes: UnlockNode[], start: string): ValidatorResult[] {
  const results: ValidatorResult[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const roots = nodes.filter((n) => n.parent === null).map((n) => n.id);
  results.push(
    roots.length === 1 && roots[0] === start
      ? ok("single-start")
      : fail("single-start", `roots [${roots.join(", ")}], start ${start}`),
  );

  const badParent = nodes
    .filter((n) => n.parent !== null && (!byId.has(n.parent) || n.parent === n.id))
    .map((n) => `${n.id} → ${n.parent}`);
  results.push(check("parents-exist", badParent));

  // Rule 21: the parent the player solves shares a cell with the child.
  const noCross = nodes
    .filter((n) => {
      const p = n.parent && byId.get(n.parent);
      return p && crossingsBetween(p, n).length === 0;
    })
    .map((n) => `${n.id} doesn't cross its parent ${n.parent}`);
  results.push(check("parent-intersects", noCross));

  // Rules 24, 25: acyclic. Rule 22: everything reachable from the start.
  const cyclic: string[] = [];
  const unreachable: string[] = [];
  for (const n of nodes) {
    const path = new Set<string>();
    let cur: UnlockNode | undefined = n;
    while (cur && cur.parent !== null) {
      if (path.has(cur.id)) {
        cyclic.push(n.id);
        break;
      }
      path.add(cur.id);
      cur = byId.get(cur.parent);
    }
    if (!cur || (cur.parent === null && cur.id !== start)) unreachable.push(n.id);
  }
  results.push(
    check(
      "acyclic",
      cyclic.map((id) => `${id} is in a cycle`),
    ),
  );
  results.push(
    check(
      "reachable",
      unreachable.filter((id) => !cyclic.includes(id)).map((id) => `${id} can't be reached`),
    ),
  );

  const extra = nodes
    .filter((n) => (n.requires ?? []).length > 0)
    .map((n) => `${n.id} has extra prerequisites (not supported yet)`);
  results.push(check("single-prerequisite", extra));

  if (results.some((r) => !r.ok)) return results;

  // Rules 20, 26: walk every reachable solved set (≤ 2^7). No hidden answer
  // may show two adjacent cells through its visible neighbours (that would
  // expose its geometry), and play can always continue until all are solved.
  const leaks = new Set<string>();
  const stuck = new Set<string>();
  const states = new Set<string>();
  const walk = (solved: Set<string>) => {
    const key = [...solved].sort().join(",");
    if (states.has(key)) return;
    states.add(key);
    const visible = visibleIds(nodes, solved);
    const shown = new Set(
      nodes
        .filter((n) => visible.has(n.id))
        .flatMap((n) => cellsOf(n).map(([r, c]) => cellKey(r, c))),
    );
    for (const h of nodes) {
      if (visible.has(h.id)) continue;
      const on = cellsOf(h).map(([r, c]) => shown.has(cellKey(r, c)));
      if (on.some((v, i) => v && on[i + 1]))
        leaks.add(`${h.id} (after solving ${key || "nothing"})`);
    }
    const open = [...visible].filter((id) => !solved.has(id));
    if (open.length === 0 && solved.size < nodes.length) stuck.add(key || "start");
    for (const id of open) walk(new Set([...solved, id]));
  };
  walk(new Set());
  results.push(
    check(
      "no-premature-reveal",
      [...leaks].map((l) => `${l} partly shows`),
    ),
  );
  results.push(
    check(
      "always-completable",
      [...stuck].map((s) => `stuck after ${s}`),
    ),
  );
  return results;
}

/** Rule 23 plus the starting letters: they sit inside the starting answer. */
export function validateStart(start: Placed | undefined, revealed: number[]): ValidatorResult {
  if (!start) return fail("start-visible", "starting answer missing");
  const bad = revealed.filter((i) => !Number.isInteger(i) || i < 0 || i >= start.grid.length);
  if (bad.length)
    return fail("start-visible", `revealed index ${bad.join(", ")} is outside ${start.id}`);
  if (revealed.length < 1 || revealed.length >= start.grid.length - 1)
    return fail("start-visible", `${revealed.length} starting letters`);
  if (new Set(revealed).size !== revealed.length) return fail("start-visible", "revealed repeats");
  return ok("start-visible");
}

export const allPass = (results: ValidatorResult[]) => results.every((r) => r.ok);
export const failures = (results: ValidatorResult[]) =>
  results.filter((r) => !r.ok).map((r) => `${r.rule}: ${r.detail}`);
