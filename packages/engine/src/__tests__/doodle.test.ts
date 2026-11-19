import { describe, expect, it } from "vitest";
import { addDays, weekday } from "../core/daily.js";
import {
  DOODLE_PRACTICE_SOURCE,
  DOODLE_PRACTICE_VARIANT,
  DOODLE_SCHEDULE_DAYS,
  DOODLE_SOURCE_COOLDOWN,
  type DoodlePath,
  type DoodlePoolItem,
  type DoodleRect,
  type DoodleSource,
  buildDoodlePuzzle,
  clipStrokes,
  cutPaths,
  doodleInventoryLevel,
  doodleMirrorAxis,
  doodleReference,
  doodleShareText,
  drawingReducer,
  emptyDrawing,
  hasInk,
  parseStrokes,
  pickDoodleVariants,
  placeMapLabels,
  planDoodleSchedule,
  scoreDoodle,
  toCanvasUnits,
  trendSource,
  trendTicks,
  validateDoodleSource,
  validateDoodleVariant,
} from "../games/doodle/logic.js";

const W = 1000;

// ── fixtures ──────────────────────────────────────────────────────────────

const circle = (cx: number, cy: number, r: number, n = 64): DoodlePath => {
  const pts: DoodlePath = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  pts[n] = pts[0];
  return pts;
};

const provenance = {
  method: "manual" as const,
  source: "Test fixture",
  license: "Original (ATLAS)",
  checkedBy: "tests",
};

const ring: DoodleSource = {
  id: "ring",
  type: "shape",
  category: "test",
  title: "a circle",
  height: 800,
  paths: [circle(500, 400, 300)],
  provenance,
};

/** An apple-ish outline with a stem: two paths, one closed. */
const apple: DoodleSource = {
  id: "apple-test",
  type: "shape",
  category: "food",
  title: "an apple",
  height: 900,
  paths: [
    [
      [500, 260],
      [580, 220],
      [680, 225],
      [760, 290],
      [800, 400],
      [790, 530],
      [740, 650],
      [660, 740],
      [580, 760],
      [500, 730],
      [420, 760],
      [340, 740],
      [260, 650],
      [210, 530],
      [200, 400],
      [240, 290],
      [320, 225],
      [420, 220],
      [500, 260],
    ],
    [
      [500, 260],
      [505, 200],
      [520, 150],
    ],
  ],
  provenance,
};

const river: DoodleSource = {
  id: "river-test",
  type: "line",
  category: "geography",
  title: "a river",
  height: 900,
  paths: [
    Array.from(
      { length: 40 },
      (_, i) => [500 + 120 * Math.sin(i / 5), 60 + i * 20] as [number, number],
    ),
  ],
  provenance,
};

const trend = trendSource({
  id: "trend-test",
  category: "trends",
  title: "a seasonal series",
  series: {
    measure: "test",
    points: Array.from({ length: 48 }, (_, i) => [
      `${2020 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
      50 + 40 * Math.sin((i / 12) * Math.PI * 2),
    ]),
  },
  provenance,
});

const rightHalf: DoodleRect[] = [{ x: 495, y: 50, w: 360, h: 700 }];
const ref = doodleReference(ring, { mask: { rects: rightHalf, strategy: "side-right" } });

/** Deterministic wobble, like a finger. */
function wobble(paths: DoodlePath[], amp: number): DoodlePath[] {
  let k = 0;
  return paths.map((p) =>
    p.map(([x, y]) => {
      k++;
      return [x + amp * Math.sin(k * 1.7), y + amp * Math.cos(k * 2.3)] as [number, number];
    }),
  );
}
const shift = (paths: DoodlePath[], dx: number, dy: number): DoodlePath[] =>
  paths.map((p) => p.map(([x, y]) => [x + dx, y + dy] as [number, number]));

const score = (strokes: DoodlePath[]) => scoreDoodle(ref, strokes, rightHalf, W, 800).score;

// ── scoring ───────────────────────────────────────────────────────────────

describe("Doodle scoring", () => {
  it("scores a perfect reproduction near 100", () => {
    expect(score(ref)).toBeGreaterThanOrEqual(98);
  });

  it("keeps small, finger-sized wobble competitive", () => {
    expect(score(wobble(ref, 8))).toBeGreaterThanOrEqual(90);
    expect(score(wobble(ref, 18))).toBeGreaterThanOrEqual(80);
  });

  it("loses points for large positional errors", () => {
    // The same half circle drawn too big: 3%, 6% and 10% of the canvas off.
    const off = (dr: number) => [circle(500, 400, 300 + dr, 128).filter(([x]) => x >= 495)];
    const near = score(off(30));
    const far = score(off(60));
    const way = score(off(100));
    expect(near).toBeLessThan(75);
    expect(near).toBeGreaterThan(far);
    expect(far).toBeLessThan(25);
    expect(way).toBeLessThan(20);
    // A whole-shape slide sideways costs too.
    expect(score(shift(ref, 80, 0))).toBeLessThan(60);
  });

  it("doesn't score a partial but accurate drawing near 100", () => {
    const part = [ref[0].slice(0, Math.floor(ref[0].length * 0.3))];
    expect(score(part)).toBeLessThan(60);
    // A tiny correct segment is worth very little.
    const dash = [
      circle(500, 400, 300, 128)
        .filter(([x]) => x >= 495)
        .slice(0, 5),
    ];
    expect(score(dash)).toBeLessThan(30);
  });

  it("can't be exploited by drawing everywhere", () => {
    const scribble: DoodlePath[] = [];
    for (let y = 60; y < 750; y += 18)
      scribble.push([
        [500, y],
        [850, y],
      ]);
    for (let x = 500; x < 850; x += 18)
      scribble.push([
        [x, 60],
        [x, 750],
      ]);
    const s = scoreDoodle(ref, scribble, rightHalf, W, 800);
    expect(s.coverage).toBeGreaterThan(0.95);
    expect(s.score).toBeLessThan(50);
    expect(s.score).toBeLessThan(score(wobble(ref, 18)) - 40);
  });

  it("gives an empty drawing nothing, and it can't be submitted", () => {
    expect(score([])).toBe(0);
    expect(hasInk([], rightHalf)).toBe(false);
    // Ink only outside the region doesn't count as drawing either.
    expect(
      hasInk(
        [
          [
            [100, 100],
            [200, 200],
          ],
        ],
        rightHalf,
      ),
    ).toBe(false);
  });

  it("ignores ink outside the drawing region", () => {
    const outside: DoodlePath = [
      [100, 100],
      [300, 600],
    ];
    expect(score([...ref, outside])).toBe(score(ref));
  });

  it("doesn't care about stroke count or direction", () => {
    const pieces = ref[0].reduce<DoodlePath[]>((acc, p, i) => {
      if (i % 8 === 0) acc.push([]);
      acc[acc.length - 1].push(p);
      return acc;
    }, []);
    const reversed = ref.map((p) => [...p].reverse());
    expect(Math.abs(score(pieces) - score(ref))).toBeLessThanOrEqual(3);
    expect(score(reversed)).toBe(score(ref));
  });

  it("scores the same normalized drawing the same on any screen size", () => {
    const phone = { left: 0, top: 0, width: 360, height: 288 };
    const desk = { left: 200, top: 100, width: 1200, height: 960 };
    const at = (box: typeof phone, fx: number, fy: number) =>
      toCanvasUnits(box.left + fx * box.width, box.top + fy * box.height, box, W, 800);
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.83, 0.2],
      [0.61, 0.97],
    ])
      expect(at(phone, fx, fy)).toEqual(at(desk, fx, fy));
  });

  it("rejects malformed or oversized submissions", () => {
    expect(parseStrokes("nope", W, 800)).toBeNull();
    expect(parseStrokes([[[1, Number.NaN]]], W, 800)).toBeNull();
    expect(parseStrokes([[[5000, 5]]], W, 800)).toBeNull();
    expect(
      parseStrokes(
        Array.from({ length: 400 }, () => [[1, 1]]),
        W,
        800,
      ),
    ).toBeNull();
    expect(
      parseStrokes(
        [
          [
            [1, 2],
            [3, 4],
          ],
        ],
        W,
        800,
      ),
    ).toEqual([
      [
        [1, 2],
        [3, 4],
      ],
    ]);
  });
});

// ── drawing ───────────────────────────────────────────────────────────────

describe("Doodle drawing", () => {
  const region: DoodleRect[] = [{ x: 500, y: 0, w: 500, h: 800 }];

  it("pen adds strokes, and several strokes are allowed", () => {
    let s = drawingReducer(emptyDrawing(), {
      kind: "pen",
      points: [
        [600, 100],
        [700, 200],
      ],
      region,
    });
    s = drawingReducer(s, {
      kind: "pen",
      points: [
        [600, 400],
        [800, 400],
      ],
      region,
    });
    expect(s.strokes).toHaveLength(2);
  });

  it("clips strokes to the drawing region instead of keeping them", () => {
    const s = drawingReducer(emptyDrawing(), {
      kind: "pen",
      points: [
        [300, 100],
        [700, 100],
      ],
      region,
    });
    expect(s.strokes).toHaveLength(1);
    expect(Math.min(...s.strokes[0].map(([x]) => x))).toBeGreaterThanOrEqual(500);
    // Entirely outside: nothing is added (and nothing to undo).
    const out = drawingReducer(emptyDrawing(), {
      kind: "pen",
      points: [
        [100, 100],
        [200, 100],
      ],
      region,
    });
    expect(out.strokes).toHaveLength(0);
    expect(out.undo).toHaveLength(0);
    // A stroke that leaves and re-enters the region becomes two pieces.
    const zig = clipStrokes(
      [
        [
          [600, 100],
          [400, 200],
          [600, 300],
        ],
      ],
      region,
    );
    expect(zig).toHaveLength(2);
  });

  it("eraser removes only the player's ink, splitting strokes", () => {
    let s = drawingReducer(emptyDrawing(), {
      kind: "pen",
      points: [
        [550, 400],
        [950, 400],
      ],
      region,
    });
    s = drawingReducer(s, {
      kind: "erase",
      points: [
        [750, 300],
        [750, 500],
      ],
    });
    expect(s.strokes).toHaveLength(2);
    expect(s.strokes.flat().every(([x]) => Math.abs(x - 750) > 20)).toBe(true);
    // The puzzle itself isn't in the reducer's state, so the eraser can't reach it.
    const puzzle = buildDoodlePuzzle(ring, {
      id: "x",
      sourceId: "ring",
      difficulty: "easy",
      mask: { rects: rightHalf, strategy: "side-right" },
      metrics: { visibility: 0.5, missingLength: 0, detail: 0, missingRuns: 1, regionShare: 0.3 },
    });
    expect(puzzle.visible.length).toBeGreaterThan(0);
    // Erasing nothing changes nothing.
    const same = drawingReducer(s, { kind: "erase", points: [[100, 100]] });
    expect(same).toBe(s);
  });

  it("undo steps back through pen, eraser and clear", () => {
    let s = drawingReducer(emptyDrawing(), {
      kind: "pen",
      points: [
        [550, 400],
        [950, 400],
      ],
      region,
    });
    const one = s.strokes;
    s = drawingReducer(s, {
      kind: "pen",
      points: [
        [550, 600],
        [950, 600],
      ],
      region,
    });
    s = drawingReducer(s, {
      kind: "erase",
      points: [
        [750, 550],
        [750, 650],
      ],
    });
    expect(s.strokes).toHaveLength(3);
    s = drawingReducer(s, { kind: "clear" });
    expect(s.strokes).toHaveLength(0);
    s = drawingReducer(s, { kind: "undo" });
    expect(s.strokes).toHaveLength(3);
    s = drawingReducer(s, { kind: "undo" });
    expect(s.strokes).toHaveLength(2);
    s = drawingReducer(s, { kind: "undo" });
    expect(s.strokes).toEqual(one);
    s = drawingReducer(s, { kind: "undo" });
    expect(s.strokes).toHaveLength(0);
    expect(drawingReducer(s, { kind: "undo" })).toBe(s);
  });

  it("clear empties the board", () => {
    let s = drawingReducer(emptyDrawing(), {
      kind: "pen",
      points: [
        [550, 400],
        [950, 400],
      ],
      region,
    });
    s = drawingReducer(s, { kind: "clear" });
    expect(s.strokes).toEqual([]);
    expect(hasInk(s.strokes, region)).toBe(false);
  });
});

// ── content ───────────────────────────────────────────────────────────────

describe("Doodle content", () => {
  it("accepts well-formed sources and rejects bad ones", () => {
    for (const s of [ring, apple, river, trend])
      expect(validateDoodleSource(s).problems).toEqual([]);
    expect(validateDoodleSource({ ...ring, provenance: { ...provenance, checkedBy: "" } }).ok).toBe(
      false,
    );
    expect(validateDoodleSource({ ...ring, provenance: { ...provenance, license: "" } }).ok).toBe(
      false,
    );
    expect(
      validateDoodleSource({ ...ring, provenance: { ...provenance, method: "open-data" } })
        .problems,
    ).toContain("public-domain and open-data sources need a url or attribution");
    expect(
      validateDoodleSource({
        ...ring,
        paths: [
          [
            [0, 0],
            [2000, 0],
          ],
        ],
      }).ok,
    ).toBe(false);
    const busy = { ...ring, paths: [circle(500, 400, 300, 2000)] };
    expect(validateDoodleSource(busy).ok).toBe(false);
  });

  it("only produces variants with 20–50% visible", () => {
    for (const s of [ring, apple, river, trend]) {
      const vs = pickDoodleVariants(s);
      expect(vs.length).toBeGreaterThan(0);
      for (const v of vs) {
        expect(v.metrics.visibility).toBeGreaterThanOrEqual(0.2);
        expect(v.metrics.visibility).toBeLessThanOrEqual(0.5);
        // The id ties it to its source, and the source still rebuilds it.
        expect(v.id.startsWith(`${s.id}~`)).toBe(true);
        expect(v.sourceId).toBe(s.id);
        const puzzle = buildDoodlePuzzle(s, v);
        expect(Math.abs(puzzle.visibility - v.metrics.visibility)).toBeLessThan(0.01);
        expect(doodleReference(s, v).length).toBe(v.metrics.missingRuns);
      }
      // Never more than one per difficulty, and they differ.
      expect(new Set(vs.map((v) => v.difficulty)).size).toBe(vs.length);
    }
  });

  it("rejects visibility outside 20–50%", () => {
    const tooMuch = validateDoodleVariant(ring, [{ x: 700, y: 50, w: 200, h: 700 }]);
    expect(tooMuch.ok).toBe(false);
    expect(tooMuch.problems.join()).toMatch(/visibility/);
    const tooLittle = validateDoodleVariant(ring, [{ x: 0, y: 0, w: 1000, h: 650 }]);
    expect(tooLittle.ok).toBe(false);
  });

  it("rejects ambiguous and unreasonable cuts", () => {
    // The whole stem hidden, with nothing visible to attach it to, plus a big chunk of outline.
    const stemOnly = validateDoodleVariant(apple, [{ x: 470, y: 100, w: 400, h: 180 }]);
    expect(stemOnly.ok).toBe(false);
    // A sliver region: too narrow for a finger.
    const sliver = validateDoodleVariant(ring, [{ x: 450, y: 0, w: 60, h: 800 }]);
    expect(sliver.problems.join()).toMatch(/narrow|small/);
    // A mask nearly identical to an existing one is too similar.
    const a = [{ x: 495, y: 50, w: 360, h: 700 }];
    const b = [{ x: 500, y: 50, w: 355, h: 700 }];
    expect(validateDoodleVariant(ring, b, [a]).problems).toContain(
      "too similar to another variant of this source",
    );
  });

  it("keeps the source/variant relationship: visible + missing = the source", () => {
    const v = pickDoodleVariants(apple)[0];
    const cut = cutPaths(apple.paths, v.mask.rects);
    const len = (ps: DoodlePath[]) =>
      ps.reduce(
        (n, p) =>
          n + p.slice(1).reduce((m, q, i) => m + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0),
        0,
      );
    expect(
      Math.abs(len(cut.visible) + len(cut.missing) - len(apple.paths)) / len(apple.paths),
    ).toBeLessThan(0.02);
  });

  it("doesn't send the answer in the puzzle", () => {
    const v = pickDoodleVariants(ring)[0];
    const puzzle = buildDoodlePuzzle(ring, v);
    const answer = doodleReference(ring, v);
    const json = JSON.stringify(puzzle);
    // No answer point appears in what the browser gets.
    const leaked = answer.flat().filter(([x, y]) => json.includes(`[${x},${y}]`));
    expect(leaked.length).toBeLessThanOrEqual(2); // shared endpoints at the cut only
    expect(Object.keys(puzzle)).not.toContain("paths");
  });

  it("practice puzzle is valid and easy", () => {
    const v = validateDoodleVariant(DOODLE_PRACTICE_SOURCE, DOODLE_PRACTICE_VARIANT.mask.rects);
    expect(v.problems).toEqual([]);
    expect(v.metrics.visibility).toBeGreaterThan(0.4);
  });

  it("share text names no subject", () => {
    const text = doodleShareText("2026-11-18", "medium", 87);
    expect(text).toContain("87% match");
    expect(text).toContain("Medium");
    expect(text).not.toMatch(/circle|apple/i);
  });
});

// ── scheduling ────────────────────────────────────────────────────────────

const RANK = { easy: 0, medium: 1, hard: 2 } as const;
function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("missing");
  return v;
}

function bank(sources: number, perSource = 3, categories = 6): DoodlePoolItem[] {
  const out: DoodlePoolItem[] = [];
  const diffs = ["easy", "medium", "hard"] as const;
  for (let s = 0; s < sources; s++)
    for (let k = 0; k < perSource; k++)
      out.push({
        id: `src${s}~v${k}`,
        sourceId: `src${s}`,
        difficulty: diffs[(s + k) % 3],
        category: `cat${s % categories}`,
        type: (["shape", "line", "trend"] as const)[s % 3],
        approvedAt: new Date(Date.UTC(2026, 0, 1) + s * 3600_000).toISOString(),
      });
  return out;
}

describe("Doodle scheduling", () => {
  const start = "2026-11-16"; // a Monday

  it("fills the next 14 days", () => {
    const plan = planDoodleSchedule(bank(60), { start });
    expect(plan.added).toHaveLength(DOODLE_SCHEDULE_DAYS);
    for (let i = 0; i < DOODLE_SCHEDULE_DAYS; i++)
      expect(plan.schedule[addDays(start, i)]).toBeTruthy();
    expect(plan.warnings).toEqual([]);
  });

  it("goes from easy on Monday to hard on Sunday", () => {
    const pool = bank(90);
    const byId = new Map(pool.map((v) => [v.id, v]));
    const plan = planDoodleSchedule(pool, { start, days: 28 });
    for (const [date, id] of Object.entries(plan.schedule)) {
      const d = must(byId.get(id)).difficulty;
      const wd = weekday(date);
      if (wd === 1 || wd === 2) expect(d).toBe("easy");
      if (wd === 4 || wd === 5) expect(d).toBe("medium");
      if (wd === 0) expect(d).toBe("hard");
      if (wd === 3) expect(["easy", "medium"]).toContain(d);
      if (wd === 6) expect(["medium", "hard"]).toContain(d);
    }
    const mon = must(byId.get(plan.schedule[start])).difficulty;
    const sun = must(byId.get(plan.schedule[addDays(start, 6)])).difficulty;
    expect(RANK[mon]).toBeLessThan(RANK[sun]);
  });

  it("never repeats a variant and keeps sources 120 days apart", () => {
    const pool = bank(200);
    const byId = new Map(pool.map((v) => [v.id, v]));
    const plan = planDoodleSchedule(pool, { start, days: 150 });
    const ids = Object.values(plan.schedule);
    expect(new Set(ids).size).toBe(ids.length);
    const last = new Map<string, string>();
    for (const [date, id] of Object.entries(plan.schedule)) {
      const src = must(byId.get(id)).sourceId;
      const prev = last.get(src);
      if (prev) {
        const gap = (Date.parse(date) - Date.parse(prev)) / 86_400_000;
        expect(gap).toBeGreaterThanOrEqual(DOODLE_SOURCE_COOLDOWN);
      }
      last.set(src, date);
    }
  });

  it("respects history: kept days stay, past sources and variants aren't reused", () => {
    const pool = bank(60);
    const history = { "2026-11-10": "src0~v0", "2026-11-17": "src5~v2" };
    const plan = planDoodleSchedule(pool, { start, history });
    expect(plan.schedule["2026-11-17"]).toBe("src5~v2");
    const fresh = plan.added.map((d) => plan.schedule[d]);
    expect(fresh.some((id) => id.startsWith("src0~") || id.startsWith("src5~"))).toBe(false);
    // Sources only known from history (since retired) still cool down.
    const retired = planDoodleSchedule(
      pool.filter((v) => v.sourceId !== "src1"),
      {
        start,
        history: { "2026-11-15": "old~x" },
        sourceOf: { "old~x": "src2" },
      },
    );
    expect(Object.values(retired.schedule).filter((id) => id.startsWith("src2~"))).toEqual([]);
  });

  it("spreads categories", () => {
    const pool = bank(120, 3, 8);
    const byId = new Map(pool.map((v) => [v.id, v]));
    const plan = planDoodleSchedule(pool, { start, days: 14 });
    const cats = plan.added.map((d) => must(byId.get(plan.schedule[d])).category);
    for (let i = 1; i < cats.length; i++) expect(cats[i]).not.toBe(cats[i - 1]);
  });

  it("warns instead of failing silently when inventory runs out", () => {
    const plan = planDoodleSchedule(bank(3, 1), { start });
    expect(plan.added.length).toBe(3);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.warnings.join("\n")).toMatch(/no eligible Doodle|instead/);
  });

  it("is deterministic", () => {
    const a = planDoodleSchedule(bank(60), { start });
    const b = planDoodleSchedule(bank(60), { start });
    expect(a.schedule).toEqual(b.schedule);
  });

  it("classifies inventory health", () => {
    expect(doodleInventoryLevel(150)).toBe("healthy");
    expect(doodleInventoryLevel(120)).toBe("healthy");
    expect(doodleInventoryLevel(80)).toBe("generate");
    expect(doodleInventoryLevel(45)).toBe("warning");
    expect(doodleInventoryLevel(10)).toBe("critical");
  });
});

describe("Doodle source cuts", () => {
  it("limits a source to its allowed cuts", () => {
    const mirror = { ...ring, id: "ring-top", cuts: ["side-top", "side-bottom"] };
    const vs = pickDoodleVariants(mirror);
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) expect(["side-top", "side-bottom"]).toContain(v.mask.strategy);
    expect(validateDoodleSource({ ...ring, cuts: ["sideways"] }).ok).toBe(false);
  });
});

describe("Doodle eraser", () => {
  it("takes a larger radius when the board is small on screen", () => {
    const region: DoodleRect[] = [{ x: 0, y: 0, w: 1000, h: 800 }];
    const base = drawingReducer(emptyDrawing(), {
      kind: "pen",
      points: [
        [100, 400],
        [900, 400],
      ],
      region,
    });
    const small = drawingReducer(base, { kind: "erase", points: [[500, 440]] });
    expect(small).toBe(base); // 40 units away: outside the default radius
    const big = drawingReducer(base, { kind: "erase", points: [[500, 440]], radius: 48 });
    expect(big.strokes).toHaveLength(2);
  });
});

describe("Doodle family spacing", () => {
  it("keeps related sources 45 days apart", () => {
    const pool = bank(300);
    // Every third source belongs to the same family (e.g. one country's map, islands and charts).
    const fam = pool.map((v) => ({
      ...v,
      family: Number(v.sourceId.slice(3)) % 3 === 0 ? ["nz"] : undefined,
    }));
    const plan = planDoodleSchedule(fam, { start: "2026-11-16", days: 120 });
    const byId = new Map(fam.map((v) => [v.id, v]));
    const nzDays = Object.entries(plan.schedule)
      .filter(([, id]) => must(byId.get(id)).family?.includes("nz"))
      .map(([d]) => Date.parse(d) / 86_400_000);
    expect(nzDays.length).toBeGreaterThan(1);
    expect(plan.warnings).toEqual([]);
    for (let i = 1; i < nzDays.length; i++)
      expect(nzDays[i] - nzDays[i - 1]).toBeGreaterThanOrEqual(45);
  });

  it("counts families from history (since-retired puzzles too)", () => {
    const pool = bank(30).map((v) => ({
      ...v,
      family: v.sourceId === "src4" ? ["japan"] : undefined,
    }));
    const plan = planDoodleSchedule(pool, {
      start: "2026-11-16",
      days: 14,
      history: { "2026-11-10": "old~x" },
      metaOf: { "old~x": { category: "geo", type: "shape", family: ["japan"] } },
    });
    expect(plan.added.map((d) => plan.schedule[d]).some((id) => id.startsWith("src4~"))).toBe(
      false,
    );
  });

  it("relaxes spacing (with a warning) rather than leaving a day empty", () => {
    const pool = bank(4, 3).map((v) => ({ ...v, family: ["same"] }));
    const plan = planDoodleSchedule(pool, { start: "2026-11-16", days: 3, cooldownDays: 1 });
    expect(plan.added).toHaveLength(3);
    expect(plan.warnings.join()).toMatch(/spacing relaxed/);
  });
});

describe("Doodle: too obvious", () => {
  const square: DoodleSource = {
    ...ring,
    id: "square",
    paths: [
      [
        [200, 150],
        [800, 150],
        [800, 650],
        [200, 650],
        [200, 150],
      ],
    ],
  };
  it("rejects a hidden part that is just a few straight edges", () => {
    const side = validateDoodleVariant(square, [{ x: 440, y: 0, w: 560, h: 800 }]);
    expect(side.problems.join()).toMatch(/too obvious/);
  });
  it("rejects a chart stretch that's nearly straight, keeps one with a turn", () => {
    const line = trendSource({
      id: "steady",
      category: "t",
      title: "steady growth",
      series: {
        measure: "x",
        points: Array.from({ length: 40 }, (_, i) => [`${1980 + i}`, 10 + i]),
      },
      provenance,
    });
    expect(pickDoodleVariants(line)).toEqual([]);
    expect(pickDoodleVariants(trend).length).toBeGreaterThan(0); // the seasonal fixture
  });
  it("keeps curvy outlines", () => {
    expect(pickDoodleVariants(ring).length).toBeGreaterThan(0);
    expect(pickDoodleVariants(apple).length).toBeGreaterThan(0);
  });
});

describe("Doodle: symmetric shapes keep their middle visible", () => {
  // A bell: symmetric about x = 500.
  const right: DoodlePath = [
    [500, 120],
    [560, 130],
    [610, 200],
    [630, 350],
    [650, 520],
    [720, 640],
    [760, 680],
    [500, 680],
  ];
  const outline: DoodlePath = [
    ...right,
    ...right
      .slice(1, -1)
      .reverse()
      .map(([x, y]) => [1000 - x, y] as [number, number]),
    [500, 120],
  ];
  const bell: DoodleSource = { ...ring, id: "bell", height: 800, paths: [outline] };
  it("detects the axis", () => {
    expect(doodleMirrorAxis(bell)).toBe(500);
    expect(
      doodleMirrorAxis({
        ...bell,
        paths: [outline.map(([x, y]) => [x + (y > 400 ? 60 : 0), y] as [number, number])],
      }),
    ).toBeNull();
  });
  it("rejects a side cut past the middle", () => {
    const past = validateDoodleVariant(bell, [{ x: 420, y: 0, w: 580, h: 800 }]);
    expect(past.problems.join()).toMatch(/middle is hidden/);
  });
  it("keeps a cut that leaves some of both sides visible", () => {
    const corner = validateDoodleVariant(bell, [{ x: 520, y: 0, w: 480, h: 450 }]);
    expect(corner.problems.join()).not.toMatch(/middle is hidden/);
    for (const v of pickDoodleVariants(bell))
      expect(validateDoodleVariant(bell, v.mask.rects).ok).toBe(true);
  });
});

describe("Doodle: chart axis ticks", () => {
  const weekly = Array.from({ length: 104 }, (_, i) => {
    const d = new Date(Date.UTC(2023, 0, 2 + 7 * i));
    return d.toISOString().slice(0, 10);
  });
  it("labels a two-year chart by quarter, with the year under each January", () => {
    const ticks = trendTicks(weekly) ?? [];
    expect(ticks.map((t) => t.text)).toEqual([
      "Jan",
      "Apr",
      "Jul",
      "Oct",
      "Jan",
      "Apr",
      "Jul",
      "Oct",
    ]);
    expect(ticks.filter((t) => t.sub).map((t) => t.sub)).toEqual(["2023", "2024"]);
  });
  it("labels a long chart by year, thinned to a readable count", () => {
    const yearly = Array.from({ length: 66 }, (_, i) => String(1960 + i));
    const ticks = trendTicks(yearly) ?? [];
    expect(ticks.length).toBeLessThanOrEqual(9);
    expect(ticks[0].text).toBe("1960");
  });
  it("falls back to evenly spaced labels when periods aren't dates", () => {
    expect(trendTicks(["Q1", "Q2"])).toBeNull();
  });
});

describe("Doodle: map context stops at the drawing area", () => {
  const river: DoodleSource = {
    ...ring,
    id: "river",
    type: "line",
    paths: [
      [
        [100, 300],
        [500, 320],
        [900, 300],
      ],
    ],
    // A border that follows the river: inside the drawing area it would draw the answer.
    guides: [
      [
        [100, 305],
        [500, 325],
        [900, 305],
      ],
    ],
  };
  it("hides guides inside the region for maps, keeps chart axes whole", () => {
    const variant = {
      id: "v",
      sourceId: "river",
      difficulty: "easy" as const,
      mask: { rects: [{ x: 600, y: 0, w: 400, h: 700 }], strategy: "side-right" },
      metrics: { visibility: 0.45, missingLength: 1, detail: 0, missingRuns: 1, regionShare: 0.3 },
    };
    const p = buildDoodlePuzzle(river, variant);
    expect(p.guides.flat().every(([x]) => x < 600)).toBe(true);
    const chart = buildDoodlePuzzle(trend, variant);
    expect(chart.guides.flat().some(([x]) => x > 600)).toBe(true);
  });
});

describe("Doodle: map labels stay out of the drawing area", () => {
  const region = [{ x: 400, y: 0, w: 300, h: 600 }];
  it("uses the first spot outside the region, and drops a label with none", () => {
    const out = placeMapLabels(
      [
        { x: 500, y: 300, text: "Iowa", alt: [[200, 300]] },
        { x: 550, y: 100, text: "MO" },
      ],
      region,
    );
    expect(out).toEqual([{ x: 200, y: 300, text: "Iowa" }]);
  });
  it("keeps labels from overlapping each other", () => {
    const out = placeMapLabels(
      [
        { x: 150, y: 300, text: "Kansas" },
        { x: 160, y: 305, text: "Texas", alt: [[150, 500]] },
      ],
      region,
    );
    expect(out.map((l) => [l.x, l.y])).toEqual([
      [150, 300],
      [150, 500],
    ]);
  });
});
