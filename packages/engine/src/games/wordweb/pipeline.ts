import { weekday as weekdayOf } from "../../core/daily.js";
import { type Rng, hashString, mulberry32, shuffle } from "../../core/rng.js";
import { constructLayouts, extraCrossings } from "./construct.js";
import {
  DIFFICULTY_WEIGHTS,
  type DifficultyWeights,
  WEEKDAY_TARGETS,
  type WeekdayTarget,
  inTarget,
  letterInformation,
  scoreDifficulty,
} from "./difficulty.js";
import type { ContentProposal, ProposedAnswer, WordWebGenerator } from "./generator.js";
import {
  type TreeShape,
  buildUnlockTree,
  crossingIndexes,
  orderForSelection,
  startIndexes,
  unfurlIndexes,
} from "./graph.js";
import type { Placed } from "./grid.js";
import { normalizeWord } from "./normalize.js";
import {
  type HistoryItem,
  RECURRENCE_RULES,
  type RecurrenceRules,
  blockedFor,
  categoryAllowed,
  checkRecurrence,
  recentAnswers,
} from "./recurrence.js";
import {
  type SafetyOptions,
  answerPolicyProblem,
  checkCategorySafety,
  nearDuplicates,
} from "./safety.js";
import {
  type AnswerMeta,
  type ValidatorResult,
  WORDWEB_SCHEMA_VERSION,
  type Weekday,
  type WordWebPuzzle,
  type WordWebRecord,
} from "./types.js";
import {
  LAYOUT_LIMITS,
  type UnlockNode,
  allPass,
  failures,
  validateLayout,
  validateStart,
  validateUnlockGraph,
} from "./validate.js";

// The generation pipeline for one date: propose → normalize → safety →
// category fit → alternates → construct → unlock tree → starting letters →
// difficulty → hard validators → recurrence. Only a candidate that passes
// every step becomes a record; anything else is logged and retried.

export const PIPELINE_VERSION = "wordweb-pipeline/1";

export interface PipelineOptions {
  date: string;
  generator: WordWebGenerator;
  history: HistoryItem[];
  /** Proposals to request before giving up on the date. */
  maxAttempts?: number;
  /** Answer subsets to try per proposal. */
  subsetsPerProposal?: number;
  weights?: DifficultyWeights;
  targets?: Record<Weekday, WeekdayTarget>;
  recurrence?: RecurrenceRules;
  safety?: SafetyOptions;
  /** ISO time stamped on the record (pass one for reproducible output). */
  now?: string;
}

export interface PipelineResult {
  record: WordWebRecord | null;
  rejected: { attempt: number; reasons: string[] }[];
}

interface Candidate {
  /** How far the start is from the day's start style (startMiss); 0 = a match. */
  startMiss: number;
  puzzle: WordWebPuzzle;
  meta: AnswerMeta[];
  validation: WordWebRecord["validation"];
}

interface CleanAnswer extends ProposedAnswer {
  grid: string;
}

/** Steps 4–6: normalize, drop unsafe or unfit answers. Returns survivors and why others went. */
function cleanAnswers(
  proposal: ContentProposal,
  avoid: Set<string>,
  safety: SafetyOptions,
): { answers: CleanAnswer[]; dropped: string[] } {
  const dropped: string[] = [];
  const seen = new Set<string>();
  const answers: CleanAnswer[] = [];
  for (const a of proposal.answers) {
    const grid = normalizeWord(a.display);
    const problem =
      (!grid && `"${a.display}" isn't letters`) ||
      answerPolicyProblem(a, proposal.actuarial, safety) ||
      (grid &&
        (grid.length < LAYOUT_LIMITS.minLength || grid.length > LAYOUT_LIMITS.maxLength) &&
        `${grid} length ${grid.length}`) ||
      (grid && seen.has(grid) && `${grid} listed twice`) ||
      (grid && avoid.has(grid) && `${grid} used recently`) ||
      ((!a.fit || a.fit.trim().length < 10) && `${a.display} has no category-fit rationale`) ||
      ((!Number.isInteger(a.familiarity) || a.familiarity < 1 || a.familiarity > 5) &&
        `${a.display} familiarity out of range`) ||
      null;
    if (problem || !grid) {
      dropped.push(problem || a.display);
      continue;
    }
    seen.add(grid);
    answers.push({ ...a, grid });
  }
  return { answers, dropped };
}

/**
 * Step 7: other category members that fit the same space — same length and
 * the same letters wherever the player will already see one when the space
 * appears (the parent crossing and the unfurl letters, or the starting reveal).
 */
export function alternatesFor(grid: string, members: string[], known: number[]): string[] {
  return members
    .filter((m) => m.length === grid.length && m !== grid && known.every((i) => m[i] === grid[i]))
    .sort();
}

/** Which word a day's puzzle prefers to start from; rotates day by day. */
export type StartStyle = "longest" | "shortest" | "middle";
const START_STYLES: StartStyle[] = ["longest", "shortest", "middle"];

/**
 * Longest, shortest, middle, repeating by date. Seven days don't divide by
 * three, so every weekday gets each style over three weeks.
 */
export function startStyle(date: string): StartStyle {
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return START_STYLES[((day % 3) + 3) % 3];
}

/**
 * The words to try as the starting answer, best first for the day's style:
 * any word, across or down. Easy days (Monday, Tuesday) never start on a
 * 3-letter word. Ties go to the more familiar word, then reading order. The
 * rest of the list is the fallback when the preferred start fails a check or
 * misses the day's difficulty band.
 */
export function startOrder(
  layout: readonly Placed[],
  chosen: readonly { grid: string; familiarity: number }[],
  style: StartStyle,
  wd: Weekday,
): string[] {
  const rank = styleRank(layout, style);
  const fam = (grid: string) => chosen.find((c) => c.grid === grid)?.familiarity ?? 0;
  return startable(layout, wd)
    .map((a, i) => ({ id: a.id, grid: a.grid, i }))
    .sort(
      (a, b) => rank(a.grid.length) - rank(b.grid.length) || fam(b.grid) - fam(a.grid) || a.i - b.i,
    )
    .map((a) => a.id);
}

/**
 * How far `root` is from the best start for the style, in letters (0 when its
 * length is the best one available). Candidates with a smaller miss win, so the
 * generator tries other answer sets before giving up on the day's style.
 */
export function startMiss(
  layout: readonly Placed[],
  root: string,
  style: StartStyle,
  wd: Weekday,
): number {
  const rank = styleRank(layout, style);
  const best = Math.min(...startable(layout, wd).map((a) => rank(a.grid.length)));
  const len = layout.find((a) => a.id === root)?.grid.length ?? 0;
  return rank(len) - best;
}

/** Words that may start the puzzle, in reading order: any, but no 3-letter start on easy days. */
function startable(layout: readonly Placed[], wd: Weekday): Placed[] {
  const easy = wd === 1 || wd === 2;
  return orderForSelection([...layout]).filter((a) => !easy || a.grid.length > 3);
}

/** Lower is better for the style: longest first, shortest first, or nearest the median length. */
function styleRank(layout: readonly Placed[], style: StartStyle): (len: number) => number {
  const lengths = layout.map((a) => a.grid.length).sort((x, y) => x - y);
  const median = lengths[Math.floor((lengths.length - 1) / 2)];
  return (len) =>
    style === "longest" ? -len : style === "shortest" ? len : Math.abs(len - median);
}

/**
 * Step 10: starting letters. Easy days get two informative letters spread
 * apart; harder days one plainer letter. Never all-but-one, rarely the first.
 */
export function chooseRevealed(
  word: string,
  count: 1 | 2,
  crossings: number[],
  rng: Rng,
): number[] {
  const idx = Array.from(word, (_, i) => i).filter((i) => i > 0 && !crossings.includes(i));
  const pool = idx.length >= count ? idx : Array.from(word, (_, i) => i).filter((i) => i > 0);
  const ranked = shuffle(rng, pool).sort((a, b) =>
    count === 2
      ? letterInformation(word[b]) - letterInformation(word[a])
      : letterInformation(word[a]) - letterInformation(word[b]),
  );
  if (count === 1) return [ranked[Math.min(ranked.length - 1, Math.floor(rng() * 2))]];
  const first = ranked[0];
  const second = ranked.find((i) => Math.abs(i - first) > 1) ?? ranked[1];
  return [first, second].sort((a, b) => a - b);
}

/**
 * Answer pools to try in order. With `genericPool`, the first N answers (the
 * most generic), then a few more, then all; otherwise just all.
 */
export function genericPools<T>(answers: T[], target: WeekdayTarget): T[][] {
  const n = target.genericPool;
  if (!n) return [answers];
  const sizes = [Math.max(n, target.answers[1]), n + 3]
    .filter((k) => k < answers.length)
    .filter((k, i, all) => all.indexOf(k) === i);
  return [...sizes.map((k) => answers.slice(0, k)), answers];
}

function subsets(
  rng: Rng,
  answers: CleanAnswer[],
  sizes: [number, number],
  tries: number,
): CleanAnswer[][] {
  const out: CleanAnswer[][] = [];
  const seen = new Set<string>();
  for (let t = 0; t < tries * 4 && out.length < tries; t++) {
    const size = sizes[0] + Math.floor(rng() * (sizes[1] - sizes[0] + 1));
    if (answers.length < size) continue;
    const pick = shuffle(rng, answers).slice(0, size);
    const key = pick
      .map((a) => a.grid)
      .sort()
      .join(",");
    if (seen.has(key) || nearDuplicates(pick.map((a) => a.grid)).length) continue;
    seen.add(key);
    out.push(pick);
  }
  return out;
}

function buildCandidate(
  proposal: ContentProposal,
  chosen: CleanAnswer[],
  members: string[],
  startGrid: string,
  shape: TreeShape,
  date: string,
  wd: Weekday,
  target: WeekdayTarget,
  rng: Rng,
  layoutSeed: number,
  opts: Required<Pick<PipelineOptions, "weights" | "targets">>,
): { candidate: Candidate | null; reasons: string[]; steps: number } {
  const { layouts, steps } = constructLayouts(
    chosen.map((a) => ({ id: a.grid, grid: a.grid })),
    { seed: layoutSeed, start: startGrid, maxLayouts: 3, runs: 8 },
  );
  if (!layouts.length)
    return {
      candidate: null,
      reasons: [`no legal layout for ${chosen.map((a) => a.grid).join(" ")}`],
      steps,
    };
  const reasons: string[] = [];
  const style = startStyle(date);
  for (const layout of layouts) {
    // The grid is built around a long anchor; the puzzle can start from any of its words.
    for (const root of startOrder(layout, chosen, style, wd)) {
      const tree = buildUnlockTree(layout, root, shape, rng);
      // Stable ids in reading order.
      const ordered = orderForSelection(tree);
      const idOf = new Map(ordered.map((a, i) => [a.id, `a${i + 1}`]));
      const nodes: (UnlockNode & { familiarity: number; alternates: string[] })[] = ordered.map(
        (a) => {
          const src = chosen.find((c) => c.grid === a.grid) as CleanAnswer;
          return {
            ...a,
            id: idOf.get(a.id) as string,
            parent: a.parent ? (idOf.get(a.parent) as string) : null,
            familiarity: src.familiarity,
            alternates: [] as string[],
          };
        },
      );
      const startNode = nodes.find((n) => n.parent === null) as UnlockNode;
      const revealed = chooseRevealed(
        startNode.grid,
        target.revealed,
        crossingIndexes(startNode, nodes),
        rng,
      );
      for (const n of nodes) {
        const parent = nodes.find((p) => p.id === n.parent);
        const known = parent
          ? [...crossingIndexes(n, [parent]), ...unfurlIndexes(nodes, n.id)]
          : startIndexes(n.grid, revealed);
        n.alternates = alternatesFor(n.grid, members, known);
      }

      const layoutResults = validateLayout(nodes);
      const graphResults = [
        ...validateUnlockGraph(nodes, startNode.id),
        validateStart(startNode, revealed),
      ];
      if (!allPass(layoutResults) || !allPass(graphResults)) {
        reasons.push(...failures([...layoutResults, ...graphResults]));
        continue;
      }
      const difficulty = scoreDifficulty(
        {
          answers: nodes,
          start: startNode.id,
          revealed,
          breadth: proposal.breadth,
          ambiguity: proposal.ambiguity,
          actuarial: proposal.actuarial,
        },
        wd,
        opts.weights,
        opts.targets,
      );
      if (!inTarget(difficulty)) {
        reasons.push(`difficulty ${difficulty.score} outside ${difficulty.target.join("–")}`);
        continue;
      }
      const rows = Math.max(
        ...nodes.map((n) => (n.direction === "down" ? n.row + n.grid.length : n.row + 1)),
      );
      const cols = Math.max(
        ...nodes.map((n) => (n.direction === "across" ? n.col + n.grid.length : n.col + 1)),
      );
      const puzzle: WordWebPuzzle = {
        schemaVersion: WORDWEB_SCHEMA_VERSION,
        gameType: "wordweb",
        id: `ww-${date}-${proposal.categoryId}`,
        date,
        category: proposal.category,
        weekday: wd,
        difficulty: target.label,
        difficultyScore: difficulty.score,
        rows,
        cols,
        start: startNode.id,
        revealed,
        answers: nodes.map((n) => {
          const src = chosen.find((c) => c.grid === n.grid) as CleanAnswer;
          return {
            id: n.id,
            display: src.display,
            grid: n.grid,
            row: n.row,
            col: n.col,
            direction: n.direction,
            parent: n.parent,
            alternates: n.alternates,
            familiarity: n.familiarity,
          };
        }),
      };
      const meta: AnswerMeta[] = puzzle.answers.map((a) => {
        const src = chosen.find((c) => c.grid === a.grid) as CleanAnswer;
        const kind = src.kind ?? (/[\s-]/.test(src.display.trim()) ? "multiword" : "noun");
        return { id: a.id, display: src.display, fit: src.fit, familiarity: src.familiarity, kind };
      });
      return {
        candidate: {
          startMiss: startMiss(layout, root, style, wd),
          puzzle,
          meta,
          validation: {
            layout: layoutResults,
            graph: graphResults,
            safety: [],
            recurrence: [],
            difficulty,
          },
        },
        reasons,
        steps,
      };
    }
  }
  return { candidate: null, reasons, steps };
}

/** Runs the whole pipeline for one date. Deterministic for the same inputs. */
export async function generateForDate(options: PipelineOptions): Promise<PipelineResult> {
  const {
    date,
    generator,
    history,
    maxAttempts = 12,
    subsetsPerProposal = 10,
    weights = DIFFICULTY_WEIGHTS,
    targets = WEEKDAY_TARGETS,
    recurrence = RECURRENCE_RULES,
    safety = {},
  } = options;
  const wd = weekdayOf(date) as Weekday;
  const target = targets[wd];
  const seed = hashString(`wordweb:${date}`);
  const rejected: PipelineResult["rejected"] = [];
  const avoidAnswers = recentAnswers(date, history, recurrence);
  const avoidCategories = new Set<string>();
  const avoidGroups = new Set<string>();
  let constructionAttempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const reasons: string[] = [];
    const reject = () => rejected.push({ attempt, reasons: reasons.slice(0, 12) });

    // Steps 1–3: target, history, proposal.
    const blocked = blockedFor(date, history, recurrence);
    const proposal = await generator.propose({
      date,
      weekday: wd,
      target,
      attempt,
      seed,
      avoidCategories: [...new Set([...blocked.categories, ...avoidCategories])],
      avoidGroups: [...new Set([...blocked.groups, ...avoidGroups])],
      avoidAnswers: [...avoidAnswers],
      allowActuarial: !blocked.actuarial,
    });
    if (!proposal) {
      reasons.push("generator had no proposal");
      reject();
      break;
    }

    // Step 2/14: category recurrence before spending time on layouts.
    const catProblems = categoryAllowed({ date, ...proposal }, history, recurrence);
    if (catProblems.length) {
      reasons.push(...catProblems);
      avoidCategories.add(proposal.categoryId);
      for (const p of catProblems) if (p.startsWith("related")) avoidGroups.add(proposal.group);
      reject();
      continue;
    }

    // Step 5: category safety.
    const catSafety = checkCategorySafety(proposal.category, safety);
    if (!catSafety.ok) {
      reasons.push(catSafety.detail as string);
      avoidCategories.add(proposal.categoryId);
      reject();
      continue;
    }

    // Steps 4–6.
    const { answers, dropped } = cleanAnswers(proposal, avoidAnswers, safety);
    if (answers.length < target.answers[0]) {
      reasons.push(`only ${answers.length} usable answers`, ...dropped);
      avoidCategories.add(proposal.categoryId);
      reject();
      continue;
    }

    // Step 7: alternates come from every safe member of the category.
    const members = [
      ...new Set([
        ...answers.map((a) => a.grid),
        ...proposal.alsoValid.map((m) => normalizeWord(m) ?? ""),
      ]),
    ].filter((m) => m && !answerPolicyProblem({ display: m }, proposal.actuarial, safety));

    // Steps 8–13 over a few answer subsets; keep the best-centred candidate.
    // Easy days draw from the most generic answers (the top of the list) and
    // widen only when nothing fits.
    const rng = mulberry32(seed + attempt * 31337);
    const found: Candidate[] = [];
    // Enough to choose from: four, one of them interlocking — or eight — with
    // at least one starting the day's way; failing that, keep looking up to 16.
    const enough = () =>
      found.length >= 16 ||
      (found.some((c) => c.startMiss === 0) &&
        (found.length >= 8 ||
          (found.length >= 4 && found.some((c) => extraCrossings(c.puzzle.answers) > 0))));
    const collect = (pool: CleanAnswer[]) => {
      for (const chosen of subsets(rng, pool, target.answers, subsetsPerProposal)) {
        const starts = [...chosen]
          .filter((a) => a.grid.length >= 5)
          .sort((a, b) => b.familiarity - a.familiarity || b.grid.length - a.grid.length)
          .slice(0, 2);
        for (const start of starts.length ? starts : chosen.slice(0, 1)) {
          for (const shape of [
            target.shape,
            target.shape === "wide" ? "deep" : "wide",
          ] as TreeShape[]) {
            const res = buildCandidate(
              proposal,
              chosen,
              members,
              start.grid,
              shape,
              date,
              wd,
              target,
              rng,
              seed + attempt,
              { weights, targets },
            );
            constructionAttempts += res.steps;
            if (res.candidate) found.push(res.candidate);
            else reasons.push(...res.reasons.slice(0, 2));
            if (enough()) break;
          }
          if (enough()) break;
        }
        if (enough()) break;
      }
    };
    for (const pool of genericPools(answers, target)) {
      collect(pool);
      if (found.length) break;
    }
    if (!found.length) {
      reject();
      continue;
    }
    // The day's start style first, then crossword-style: the most interlocking
    // candidate wins, then the one nearest the middle of the day's difficulty band.
    const mid = (target.range[0] + target.range[1]) / 2;
    found.sort(
      (a, b) =>
        a.startMiss - b.startMiss ||
        extraCrossings(b.puzzle.answers) - extraCrossings(a.puzzle.answers) ||
        Math.abs(a.puzzle.difficultyScore - mid) - Math.abs(b.puzzle.difficultyScore - mid),
    );

    for (const cand of found) {
      // Step 5 again on what's actually in the grid, plus near-duplicates.
      const answerSafety: ValidatorResult[] = [
        catSafety,
        ...cand.meta.map((m): ValidatorResult => {
          const problem = answerPolicyProblem(m, proposal.actuarial, safety);
          return problem
            ? { rule: "safe-answer", ok: false, detail: problem }
            : { rule: "safe-answer", ok: true, detail: m.display };
        }),
      ];
      const dupes = nearDuplicates(cand.puzzle.answers.map((a) => a.grid));
      answerSafety.push(
        dupes.length
          ? { rule: "no-near-duplicates", ok: false, detail: dupes.join("; ") }
          : { rule: "no-near-duplicates", ok: true },
      );
      const recurrenceResults = checkRecurrence(
        {
          date,
          categoryId: proposal.categoryId,
          group: proposal.group,
          actuarial: proposal.actuarial,
          answers: cand.puzzle.answers.map((a) => a.grid),
        },
        history,
        recurrence,
      );
      if (!allPass(answerSafety) || !allPass(recurrenceResults)) {
        reasons.push(...failures([...answerSafety, ...recurrenceResults]));
        continue;
      }
      // Steps 15–17.
      return {
        record: {
          puzzle: cand.puzzle,
          status: "published",
          categoryId: proposal.categoryId,
          categoryGroup: proposal.group,
          actuarial: proposal.actuarial,
          answers: cand.meta,
          generation: {
            generator: generator.name,
            generatorVersion: generator.version,
            pipelineVersion: PIPELINE_VERSION,
            generatedAt: options.now ?? new Date().toISOString(),
            seed,
            attempts: attempt,
            constructionAttempts,
            rejected: [...rejected],
          },
          validation: { ...cand.validation, safety: answerSafety, recurrence: recurrenceResults },
        },
        rejected,
      };
    }
    reject();
  }
  // Step 19: the caller falls back (queue.ts).
  return { record: null, rejected };
}
