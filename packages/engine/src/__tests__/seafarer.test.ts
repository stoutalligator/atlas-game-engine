import { describe, expect, it } from "vitest";
import { generateCandidate } from "../games/seafarer/generator.js";
import {
  FROZEN_PASSAGES,
  SEAFARER_PACKS,
  SEAFARER_THEMES,
  SHATTERED_ISLES,
  alternativeRoutes,
  canFinish,
  routeKind,
  seafarerPack,
  seafarerPuzzle,
  solve,
} from "../games/seafarer/logic.js";
import { FROZEN_PASSAGES_PACK_PLAN } from "../games/seafarer/packs/frozen-passages.plan.js";
import {
  SHATTERED_ISLES_PACK_PLAN,
  SHATTERED_ISLES_PLAN,
} from "../games/seafarer/packs/shattered-isles.plan.js";
import {
  HEX_DIRS,
  OPPOSITE,
  anchor,
  buildBoard,
  emptyRoute,
  extendRoute,
  harborOf,
  isNavigable,
  neighbor,
  replayRoute,
  sail,
  scoreRoute,
  starsFor,
  stormAt,
  voyageExit,
} from "../games/seafarer/rules.js";
import type { SeafarerPuzzle } from "../games/seafarer/types.js";
import { verifyGameResult } from "../server-entry.js";

// A 6×4 chart. Odd rows are drawn half a cell to the right.
//   row 0   0 H . # . .      H harbor at 1, land at 3
//   row 1    . d d d . .     current flowing east (7–9)
//   row 2   . , # # . A      shallows at 13, port A at 17
//   row 3    . . . * . .     reef at 21
// The east side is a one-way trap: the current carries you east, and land,
// reef and the current itself block every way back west.
const tiny: SeafarerPuzzle = {
  id: "tiny",
  number: 1,
  title: "Tiny",
  cols: 6,
  rows: 4,
  map: ["...#..", ".ddd..", ".,##..", "...*.."],
  places: [
    { id: "H", kind: "harbor", cell: 1, name: "Home" },
    { id: "A", kind: "port", cell: 17, name: "Port" },
  ],
  objective: { type: "voyage" },
  provisions: 10,
  par: 2,
  difficulty: 1,
};

describe("seafarer hex geometry", () => {
  it("neighbours are symmetric on every board size", () => {
    for (const [cols, rows] of [
      [6, 4],
      [9, 10],
      [11, 13],
    ]) {
      for (let i = 0; i < cols * rows; i++)
        for (const d of HEX_DIRS) {
          const j = neighbor({ cols, rows }, i, d);
          if (j >= 0) expect(neighbor({ cols, rows }, j, OPPOSITE[d])).toBe(i);
        }
    }
  });

  it("shifts odd rows right", () => {
    const b = { cols: 6, rows: 4 };
    expect(neighbor(b, 1, "se")).toBe(7); // even row: same column below
    expect(neighbor(b, 1, "sw")).toBe(6);
    expect(neighbor(b, 10, "se")).toBe(17); // odd row: one column right below
    expect(neighbor(b, 0, "w")).toBe(-1);
  });
});

describe("seafarer sailing rules", () => {
  const board = buildBoard(tiny);

  it("blocks land, reef and the chart edge", () => {
    expect(sail(board, 2, "e")).toBeNull(); // land (3)
    expect(sail(board, 0, "w")).toBeNull(); // off the chart
    expect(sail(board, 20, "e")).toBeNull(); // reef (21)
    expect(isNavigable(board.cells[21])).toBe(false);
  });

  it("currents carry the ship for free until the water is calm", () => {
    expect(sail(board, 1, "se")).toEqual({ to: 7, path: [7, 8, 9, 10], days: 1 });
    expect(sail(board, 2, "sw")?.path).toEqual([7, 8, 9, 10]); // from the side is fine
  });

  it("never lets the ship sail straight up a current", () => {
    expect(sail(board, 10, "w")).toBeNull();
  });

  it("charges two days for shallows", () => {
    expect(sail(board, 12, "e")?.days).toBe(2);
  });

  it("replays taps, counts visits and closes the route when the objective is met", () => {
    let s = emptyRoute(tiny);
    for (const t of [7, 17]) {
      const next = extendRoute(tiny, board, s, t);
      expect(next).not.toBeNull();
      s = next as typeof s;
    }
    expect(s.days).toBe(2);
    expect(s.visited).toEqual(["A"]);
    expect(s.complete).toBe(true);
    expect(extendRoute(tiny, board, s, 16)).toBeNull(); // voyages end on arrival
  });

  it("rejects non-adjacent taps and routes beyond the provisions", () => {
    expect(replayRoute(tiny, [17])).toBeNull();
    expect(replayRoute({ ...tiny, provisions: 1 }, [7, 17])).toBeNull();
  });
});

describe("seafarer solver and scoring", () => {
  it("finds par using the current", () => {
    const sol = solve(tiny);
    expect(sol.days).toBe(2);
    expect(replayRoute(tiny, sol.taps)?.complete).toBe(true);
    expect(solve(tiny, { ignoreCurrents: true }).days).toBeGreaterThan(2);
  });

  it("gives 3 stars at par, 2 when close, 1 otherwise", () => {
    expect(scoreRoute(tiny, [7, 17])?.stars).toBe(3);
    // No validated threshold on this chart: two stars up to par + 2.
    const at = (days: number) => starsFor(tiny, { ...emptyRoute(tiny), days });
    expect(at(4)).toBe(2);
    expect(at(5)).toBe(1);
    // A validated threshold (the best different route) takes over.
    expect(starsFor({ ...tiny, twoStar: 3 }, { ...emptyRoute(tiny), days: 4 })).toBe(1);
    expect(scoreRoute(tiny, [7])).toBeNull(); // not there yet
  });

  it("charges a day in port for each return to harbor", () => {
    expect(scoreRoute(tiny, [7, 17], 1)).toMatchObject({ days: 3, restarts: 1, stars: 2 });
    expect(scoreRoute(tiny, [7, 17], 2)).toMatchObject({ days: 4, stars: 2 });
    // Restarts use provisions too.
    expect(scoreRoute({ ...tiny, provisions: 3 }, [7, 17], 2)).toBeNull();
    expect(replayRoute(tiny, [7], -1)).toBeNull();
  });

  it("finds genuinely different routes, best first", () => {
    const wide: SeafarerPuzzle = {
      ...tiny,
      id: "wide",
      cols: 7,
      rows: 5,
      // An island in the middle: round the top or round the bottom.
      map: [".......", ".......", "..###..", ".......", "......."],
      places: [
        { id: "H", kind: "harbor", cell: 14, name: "Home" },
        { id: "A", kind: "port", cell: 20, name: "Port" },
      ],
    };
    const routes = alternativeRoutes(wide, 3);
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes[0].days).toBe(solve(wide).days);
    for (let i = 1; i < routes.length; i++)
      expect(routes[i].days).toBeGreaterThanOrEqual(routes[i - 1].days);
    // The first two share no water away from the harbor and the port.
    const board = buildBoard(wide);
    const nearEnds = new Set<number>([14, 20]);
    for (const c of [14, 20])
      for (const d of HEX_DIRS) if (neighbor(board, c, d) >= 0) nearEnds.add(neighbor(board, c, d));
    const cells = (taps: number[]) =>
      new Set((replayRoute({ ...wide, provisions: 99 }, taps)?.legs ?? []).flatMap((l) => l.path));
    const a = cells(routes[0].taps);
    const b = cells(routes[1].taps);
    expect([...a].filter((c) => b.has(c) && !nearEnds.has(c))).toEqual([]);
    expect(routeKind(tiny, [7, 17])).toBe("current");
  });

  it("solves charters for the most cargo within the provisions", () => {
    const charter: SeafarerPuzzle = {
      ...tiny,
      objective: { type: "charter" },
      places: [
        { id: "H", kind: "harbor", cell: 1, name: "Home" },
        { id: "A", kind: "cargo", cell: 0, name: "Near", value: 2 },
        { id: "B", kind: "cargo", cell: 18, name: "Far", value: 9 },
      ],
      provisions: 4,
    };
    expect(solve(charter).best).toBe(2);
    expect(solve({ ...charter, provisions: 6 })).toMatchObject({ best: 9, days: 6 });
    expect(solve({ ...charter, provisions: 30 }).best).toBe(11);
  });

  it("spots a route that can no longer finish", () => {
    const board = buildBoard(tiny);
    const home = { ...tiny, objective: { type: "rounds", returnHome: true } as const };
    // Riding the current east is fine for a voyage…
    const east = extendRoute(tiny, board, emptyRoute(tiny), 7);
    expect(east && canFinish(tiny, east)).toBe(true);
    // …but a round trip can never get back west past it.
    const trapped = extendRoute(home, board, emptyRoute(home), 7);
    expect(trapped && canFinish(home, trapped)).toBe(false);
    expect(canFinish(home, emptyRoute(home))).toBe(false); // the whole chart is unsolvable
    expect(canFinish({ ...tiny, provisions: 1 }, emptyRoute({ ...tiny, provisions: 1 }))).toBe(
      false,
    );
  });

  it("never counts cargo you can't bring home (one-way currents)", () => {
    const trap: SeafarerPuzzle = {
      ...tiny,
      objective: { type: "charter" },
      places: [
        { id: "H", kind: "harbor", cell: 1, name: "Home" },
        { id: "A", kind: "cargo", cell: 0, name: "Near", value: 2 },
        { id: "B", kind: "cargo", cell: 23, name: "Beyond", value: 9 },
      ],
      provisions: 40,
    };
    expect(solve(trap).best).toBe(2);
  });
});

describe("seafarer storms", () => {
  // One channel (row 2) between solid land. A storm starting at cell 1 drifts
  // south-east: 1 → 6 → 12 (in the channel on day 2) → 17 → off the chart.
  const squall: SeafarerPuzzle = {
    ...tiny,
    id: "squall",
    cols: 5,
    rows: 5,
    map: ["#####", "#####", ".....", "#####", "#####"],
    places: [
      { id: "H", kind: "harbor", cell: 10, name: "Home" },
      { id: "A", kind: "port", cell: 14, name: "Port" },
    ],
    storms: [{ cells: [1], drift: "se" }],
    provisions: 12,
    par: 5,
  };
  const board = buildBoard(squall);

  it("drifts a hex a day", () => {
    expect([...stormAt(board, 0)]).toEqual([1]);
    expect([...stormAt(board, 2)]).toEqual([12]);
    expect([...stormAt(board, 3)]).toEqual([17]);
  });

  it("blocks hexes the storm covers on arrival, and anchoring where it is heading", () => {
    expect(sail(board, 11, "e", 1)).toBeNull(); // would arrive at 12 on day 2
    expect(sail(board, 11, "e", 2)?.to).toBe(12); // a day later it has moved on
    expect(anchor(board, 10, 0)).toMatchObject({ to: 10, days: 1, anchor: true });
    expect(anchor(board, 12, 1)).toBeNull(); // the storm arrives here tomorrow
    expect(anchor(buildBoard(tiny), 1, 0)).toBeNull(); // no anchoring on calm charts
  });

  it("finds that waiting out the storm is best", () => {
    const sol = solve(squall);
    expect(sol.days).toBe(5);
    expect(solve({ ...squall, storms: undefined }).days).toBe(4);
    // Anchoring is tapping your own hex: some tap repeats where the ship already is.
    const r = replayRoute(squall, sol.taps);
    expect(r?.legs.some((l) => l.anchor)).toBe(true);
    expect(scoreRoute(squall, sol.taps)?.stars).toBe(3);
    expect(routeKind(squall, sol.taps)).toBe("storm");
    // Sailing straight on runs into the storm.
    expect(replayRoute(squall, [11, 12])).toBeNull();
  });

  it("restarts the storm clock with each voyage", () => {
    const sol = solve(squall);
    expect(scoreRoute(squall, sol.taps, 1)).toMatchObject({ days: 6, restarts: 1 });
  });
});

describe("seafarer generator", () => {
  it("is deterministic for a seed", () => {
    const recipe = SHATTERED_ISLES_PLAN[3].recipe;
    for (let i = 0; i < 40; i++) {
      const a = generateCandidate(recipe, `det-${i}`);
      const b = generateCandidate(recipe, `det-${i}`);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});

describe.each([
  [SHATTERED_ISLES, SHATTERED_ISLES_PACK_PLAN],
  [FROZEN_PASSAGES, FROZEN_PASSAGES_PACK_PLAN],
] as const)("pack %#", (pack, plan) => {
  const n = plan.days.length;

  it(`${plan.title}: one numbered challenge per planned day, unique ids, badge tiers`, () => {
    expect(pack.id).toBe(plan.id);
    expect(pack.theme).toBe(plan.theme);
    expect(pack.puzzles).toHaveLength(n);
    expect(pack.puzzles.map((p) => p.number)).toEqual(Array.from({ length: n }, (_, i) => i + 1));
    expect(new Set(pack.puzzles.map((p) => p.id)).size).toBe(n);
    expect(pack.badgeTiers).toEqual(plan.badgeTiers);
    // Gold means finishing the whole pack.
    expect(pack.badgeTiers.gold).toBe(n);
    expect(seafarerPack(pack.id)).toBe(pack);
    // A theme exists for the pack, so it never falls back to another pack's look.
    expect(SEAFARER_THEMES[pack.theme]).toBeDefined();
  });

  it("matches its plan (titles and objectives)", () => {
    expect(pack.puzzles.map((p) => p.title)).toEqual(plan.days.map((d) => d.title));
    pack.puzzles.forEach((p, i) => expect(p.objective).toEqual(plan.days[i].recipe.objective));
  });

  it.each(pack.puzzles.map((p) => [p.number, p] as const))(
    "challenge %i: par is exact and the reference route earns 3 stars",
    (n, p) => {
      const board = buildBoard(p);
      for (const pl of p.places) expect(board.cells[pl.cell].terrain).toBe("sea");
      const sol = solve(p);
      expect(sol.days).toBe(p.par);
      expect(p.provisions).toBeGreaterThanOrEqual(p.par);
      if (p.objective.type === "charter") {
        expect(sol.best).toBe(p.best);
        const all = p.places.reduce((s, pl) => s + (pl.value ?? 0), 0);
        expect(p.best).toBeLessThan(all); // there's a real choice
      }
      expect(scoreRoute(p, sol.taps)?.stars).toBe(3);
      if (n > 1) {
        // Today departs from where yesterday's voyage ended.
        const prev = pack.puzzles[n - 2];
        expect(harborOf(p).name).toBe(voyageExit(prev).name);
      }
      if (p.objective.type !== "charter") {
        // Never one obvious route: at least two genuinely different ones earn two stars.
        expect(p.routes?.length).toBeGreaterThanOrEqual(2);
        expect(p.routes?.[0].days).toBe(p.par);
        expect(p.twoStar).toBeGreaterThan(p.par);
        for (const r of p.routes ?? []) {
          expect(r.days).toBeLessThanOrEqual(p.twoStar as number);
          expect(scoreRoute(p, r.taps)?.stars).toBeGreaterThanOrEqual(2);
        }
        // A two-star voyage still fits after one return to harbor.
        expect(p.provisions).toBeGreaterThanOrEqual((p.twoStar as number) + 1);
      }
    },
  );

  it("brings storms in for storm season (days 21–25) and never before", () => {
    for (let n = 1; n <= 20; n++) expect(pack.puzzles[n - 1].storms ?? []).toEqual([]);
    for (let n = 21; n <= 25; n++) {
      const p = pack.puzzles[n - 1];
      expect(p.storms?.length).toBeGreaterThan(0);
      // The storm changes the best plan.
      expect(solve({ ...p, storms: undefined }).days).toBeLessThan(p.par);
    }
  });

  it("introduces mechanics gradually", () => {
    const has = (n: number, re: RegExp) => re.test(pack.puzzles[n - 1].map.join(""));
    for (let n = 1; n <= 5; n++) {
      expect(has(n, /,/)).toBe(false);
      expect(has(n, /[qeadzc]/)).toBe(false);
    }
    for (let n = 6; n <= 10; n++) expect(has(n, /[qeadzc]/)).toBe(false);
    for (let n = 1; n <= 15; n++) expect(pack.puzzles[n - 1].objective.type).toBe("voyage");
    // Mechanic days offer the mechanic as a real choice, alongside a route without it.
    for (let n = 6; n <= 10; n++) {
      const kinds = new Set(pack.puzzles[n - 1].routes?.map((r) => r.kind));
      expect(kinds.has("shallows") && kinds.size >= 2).toBe(true);
    }
    for (let n = 11; n <= 15; n++) {
      const kinds = new Set(pack.puzzles[n - 1].routes?.map((r) => r.kind));
      expect(kinds.has("current") && kinds.size >= 2).toBe(true);
    }
  });

  it("verifies submitted routes on the server", () => {
    const p = pack.puzzles[10];
    const taps = solve(p).taps;
    const ok = verifyGameResult({
      game: "seafarer",
      date: "2026-11-18",
      proof: { puzzleId: p.id, taps },
    });
    expect(ok).toMatchObject({ solved: true, stars: 3, days: p.par, restarts: 0 });
    const again = verifyGameResult({
      game: "seafarer",
      date: "2026-11-18",
      proof: { puzzleId: p.id, taps, restarts: 1 },
    });
    expect(again).toMatchObject({ days: p.par + 1, restarts: 1 });
    const fractional = verifyGameResult({
      game: "seafarer",
      date: "2026-11-18",
      proof: { puzzleId: p.id, taps, restarts: 1.5 },
    });
    expect(fractional).toBeNull();
    expect(
      verifyGameResult({
        game: "seafarer",
        date: "2026-11-18",
        proof: { puzzleId: p.id, taps: taps.slice(0, -1) },
      }),
    ).toBeNull();
    expect(
      verifyGameResult({ game: "seafarer", date: "2026-11-18", proof: { puzzleId: "nope", taps } }),
    ).toBeNull();
    expect(seafarerPuzzle(p.id)).toBe(p);
  });
});

describe("pack registry", () => {
  it("ships both months with ids that never collide", () => {
    expect(SEAFARER_PACKS.map((p) => p.id)).toEqual(["shattered-isles", "frozen-passages"]);
    const ids = SEAFARER_PACKS.flatMap((p) => p.puzzles.map((pz) => pz.id));
    expect(new Set(ids).size).toBe(ids.length);
    // The server finds a challenge in either pack by its id.
    expect(seafarerPuzzle("frozen-passages-31")?.title).toBe("Midwinter Crossing");
  });

  it("keeps December different from November (no reused charts)", () => {
    const maps = new Set(SHATTERED_ISLES.puzzles.map((p) => p.map.join("/")));
    for (const p of FROZEN_PASSAGES.puzzles) expect(maps.has(p.map.join("/"))).toBe(false);
  });
});
