# Seafarer — design

Daily expedition game: route-planning puzzles on an illustrated hex sea chart, released as
monthly packs of 30 challenges. First pack: **The Shattered Isles** (November).

Status (2026-11-19): engine prototype is playable in the playground (`pnpm dev`, then
`?game=seafarer`). The atlas host (progress, unlocks, badges, pack leaderboard) is planned below
and not built yet. The gameplay should be playtested first.

## Decisions so far

| Question | Decision |
|---|---|
| Objective | Tiered: **Voyage** (reach the port in the fewest days) → **Rounds** (call at every port, sometimes returning home) → **Charter** (too few provisions for all the cargo: choose, and get home). |
| Grid | Hex sea chart (pointy-top, odd rows shifted right). |
| Pack window | A pack is open only during its month; the next pack starts on the 1st. Late joiners may not finish, and that's fine. The month is host config, so this pack can ship as December's without engine changes. |
| Leaderboard | One board per pack: how far along each player is (challenges charted, then stars). |
| Badge | One per pack, tiers Bronze 10 / Silver 20 / Gold 30 challenges completed. |
| Play style (2026-11-18, round 2) | **Live voyage**: there's no plan-then-set-sail step. Each move sails at once and counts. **Return to harbor** starts over and costs one day in port, so a restart usually costs a star. |
| Backtracking | No extra rule. Every move already costs a day, so sailing back is its own penalty. |
| Charters | Kept (cargo-scored), alongside the days-scored voyages and rounds. |
| Storms (round 3) | A moving storm front with a forecast. Stormy hexes can't be entered, and **Drop anchor** waits a day. Storm season is days 21–25, plus Storm Coast and the finale. |
| Daily progression (round 3) | **Expedition chart**: the month is one stitched map. Regions sit on one world hex lattice, linked by sea lanes, and each day departs from where yesterday ended. Opening the game flies from the whole chart into today's region. |
| Playtest round (2026-11-19) | Every day must earn its place: the day's mechanic changes the answer, and the obvious plan-by-eye route **costs stars** (it looks right and is too slow). Gentle days stay winnable by that route; later days may trap it. Storms show a 3-day forecast. The expedition chart is **one stitched map** with no gaps; each harbor faces yesterday's region; a port name is never reused in a month. |
| Look | ATLAS frame (slate panels, 2px borders, 4px corners, pressed shadows, uppercase labels, cyan accents) around an illustrated hex-tile chart. |

## Rules

- The ship starts at the harbor. Each move sails immediately and is final. With a mouse, hover
  a glowing hex to see its cost (and where a current will carry you), then click. On touch, tap
  once to aim (the cost appears) and tap again to sail. Keys Q W E / A D / Z C sail in the six
  directions.
- Each move costs 1 day; **shallows** cost 2. **Islands** and **reefs** block.
- **Currents**: after entering a current hex, the ship drifts along the flow for free until it
  reaches calm water (or the next hex is blocked). You can't enter a current head-on against its
  flow. Currents can be one-way traps; the game warns as soon as a voyage can no longer finish
  (`canFinish`).
- **Return to harbor** restarts the voyage and costs one day in port. That day counts toward
  days at sea and uses a day of provisions.
- **Storms** cover a few hexes and drift one hex a day in a fixed direction. The forecast shows
  tomorrow as dashed hexes and the two days after as fainter ones marked +2 and +3, so a route
  can be planned around a front instead of guessed. The ship can't arrive in (or drift into) a hex that's stormy on the day
  it would get there. **Drop anchor** (tap your own ship, the button, or S) waits a day, unless
  the storm will be on that hex tomorrow. The storm clock restarts with each voyage. The solver
  stays exact by searching over (hex, ports visited, day), with anchoring as a move.
- A port or cargo counts as soon as the ship passes it, drifting included.
- **Provisions** cap days at sea. Voyages and rounds end on arrival. Charters end when the
  player presses **Finish voyage** at the harbor with cargo aboard.

### Scoring

- Voyage / Rounds, by days at sea (port days included):
  - ★★★ at par, the solver's exact optimum.
  - ★★ up to `twoStar`, the slowest of the genuinely different viable routes the generator
    found. So any sensible strategy earns two stars, and the optimal one earns three.
  - ★ for any finished voyage.
- Charter: ★★★ for the best possible cargo, ★★ for ≥ 75% of it, ★ otherwise.
- There's no failure state. The result lists the routes the solver found ("Ride the current
  · 11 days · Best", "Open water · 13 days"), and each can be drawn on the chart.

## Expedition chart

The month is one journey on **one hex map** (`expedition.ts` lays it out; `ExpeditionChart.tsx`
draws it):

- Every region sits in a block of the same size (the pack's largest chart) on one world
  lattice, in a snake of 5 per row: west to east, then east to west, turning south at the end
  of each row (`regionSides`). Blocks touch, so there are no channels or frames. The hexes
  around a smaller region are **filler** sea with the odd island, generated from the pack id
  and kept a hex clear of every region. The whole month is rendered as a single `Terrain`.
- **Continuity**: the build places each day's harbor within two hexes of the side facing
  yesterday's region (`entrySide`), and prefers charts whose voyage ends near the side facing
  tomorrow's (`exitSide`, a ranking term). The harbor takes the name of where yesterday ended
  (`voyageExit`: the port; home for round trips and charters; for rounds that end away from
  home, the last port of the **best route**). A dotted sea lane follows real water between them
  (`seaLane`).
- **Names**: `linkVoyages` gives every port a name not used before in the pack (pools of 65
  per setting); the build fails if a pool runs out.
- **Arrival**: the game opens on the whole chart, holds a beat, then glides the camera (an
  eased viewBox animation) down to today's region and hands over to the puzzle. "Chart" (in the
  header) and "View expedition chart" (after a voyage) step back out.
- Finished regions show the player's inked route and stars (the host passes the final taps in
  `finished`). Today's region has a gold dashed outline and the ship. Everything still ahead,
  including blocks past the month's last day, sits under **one bank of fog** (one blurred
  layer, so neighbouring regions merge).

## Engine layout (`packages/engine/src/games/seafarer/`)

| File | |
|---|---|
| `types.ts` | Puzzle, pack, place, objective types. Theme-free. |
| `rules.ts` | Hex geometry, `sail` (moves + drift), `extendRoute`, `replayRoute`, `starsFor`, `scoreRoute`. Pure. |
| `solver.ts` | Exact Dijkstra (bucket queue) over (cell, places-visited mask): `solve` (par, charter best, reference taps), `canFinish`. |
| `generator.ts` | Seeded charts → solve → metrics → reject → rank (`generateCandidates`). |
| `packs/shattered-isles.plan.ts` | One recipe per day (mechanics, size, par range, minimum metrics, title, tip). |
| `packs/shattered-isles.ts` | **Generated** pack data. Don't edit by hand. |
| `theme.ts` + `styles/seafarer.css` | Words and palette for a pack (`data-theme`). |
| `expedition.ts` | The stitched map: region sides, world layout, filler, sea lanes. Pure. |
| `ExpeditionChart.tsx` | Draws the stitched chart; the fly-in. |
| `SeafarerMap.tsx`, `Seafarer.tsx` | The chart (one SVG) and the game screen (track, header, provisions, result). |

Server side, `verifyGameResult({ game: "seafarer", proof: { puzzleId, taps } })` replays the taps
against the built-in pack and returns `{ stars, days, cargo, moves }`, or null.

## Content pipeline

```bash
pnpm --filter @stoutalligator/engine exec tsx scripts/build-seafarer-pack.ts --review
```

1. For each day, the plan's recipe draws candidate charts from deterministic seeds: islands grown
   as blobs, reef chains, current streams, shallows on coasts (never on a dock), and places on
   coastal water.
2. Each candidate is solved exactly and measured:
   - **detour**: par ÷ straight-line distance (obstacles matter).
   - **currentGain**: days the currents save (current days require them).
   - **shallowCost**: days the shallows add (shallows days require them).
   - **greedyGap**: how much the obvious nearest-first plan loses (99 = it can't finish at all).
   - **lureGap**: days the **naive sailor** loses to par (99 = never arrives). `naiveDays`
     simulates a player who plans by eye: fewest hexes to the nearest port left, aiming
     straight, not pricing shallows, not riding currents on purpose, not reading the forecast.
     When the sea pushes back they adapt: re-plan after drifting, wait at anchor for a storm or
     back away from one, and plan around a current they can't sail up.
   - **stormCost**: days the storms add to par.
   - **exitDistance**: hexes from where the voyage ends to the side facing tomorrow's region.
   - **openings**: first moves that stay within a day of par.
   - **openness**: share of open sea.
   - **routes / kinds**: genuinely different viable routes, and how many kinds they cover
     (current, shallows, open water). `alternativeRoutes` finds the optimal route, bans every
     hex it used (except next to the harbor and ports), solves again, and repeats. A route is
     viable within `par + max(2, ⌈15% of par⌉)` days.
3. Charts outside the recipe's par range or minimums are rejected. Every voyage/rounds chart
   needs ≥ 2 viable routes (≥ 3 on the hardest days). Mechanic days need a viable route that
   uses the mechanic **and** one that doesn't (`requireKinds` + `minKinds: 2`), so riding the
   current or cutting through the shallows is a choice, not the only way. Charters must make a real choice
   (best < all the cargo, and all cargo is reachable).
   Per-day `TUNING` in the plan adds: `minLureGap` (the obvious route must cost that many days,
   so not thinking costs a star), mechanic minimums (`minShallowCost`, `minCurrentGain`,
   `minStormCost`: the day's mechanic must change the answer, not just decorate), and
   `naiveFinishes` (on gentler days the obvious route still arrives within the provisions, so no
   day is hopeless). A day with no passing chart is reported at the end of the build, and
   nothing is written.
4. Survivors are ranked by an interest score (a bigger lure ranks higher; a long lane to
   tomorrow's region ranks lower); the top one is used unless a reviewer pinned a
   seed with `pick`. `--review` writes the top 6 per day for the playground's **Review
   candidates** page, which shows each chart with its optimal route and metrics.
5. Tests re-prove every challenge: places on open sea, par = solver optimum, charter best is exact
   and less than all the cargo, the reference route scores ★★★ through the server path, the
   day's recipe still holds (lure, mechanics), harbors face yesterday's region, port names are
   unique, and every sea lane on the stitched map connects.

Second lesson: requiring currents to save 3+ days made them *dominate*, leaving one obvious
route. The fix was the kinds requirement above, plus *guided* currents that start near one
place and flow roughly toward another.

Lesson from building it: with two ports and no return trip, nearest-first is always optimal
(both orders share the A↔B leg), so ordering puzzles need three or more ports, or currents to
break the symmetry.

### November progression

| Days | Focus |
|---|---|
| 1–5 | Voyages with the **base mechanic, shallows, from day 1** (user decision 2026-11-19: no day is trivial). Shallows add 1–3 days to the best route; the obvious route loses 1–2 days (at most 2 on days 1–3) and always arrives. Every pack does the same on its first days. |
| 6–10 | Shallows in the way (they add 1–2 days to the best route); cutting straight through is the lure (+2–3). |
| 11–15 | Currents save 1–2 days; the wrong one carries you off (+1–3). Days 14–15 may trap the obvious route. |
| 16–20 | Rounds: 2 then 3 ports, a round trip; nearest-first is a trap (+2–4). |
| 21–25 | Storm season: the storm adds days to the best route, and sailing blind into it costs more (+2–3). |
| 26–29 | Charters (greedy cargo choice loses) mixed with the hardest rounds (+4). |
| 30 | **The Shattered Crown**: four ports and home, every mechanic. |

## Packs

| Pack | Month | Challenges | Setting |
|---|---|---|---|
| `shattered-isles` | November | 30 (Gold at 30) | Tropical archipelago: palms, coral reefs, shallows, currents, storms. |
| `frozen-passages` | December | 31 (Gold at 31) | Polar sea: snowy islands and pines, icebergs, slush ice, the polar drift, blizzards. |
| `lantern-sea` | January | 31 (Gold at 31) | Night voyage (`night` art): lighthouses, lantern-lit cottages, glowing rocks and shallows, night currents, squalls, and **tides** (tidal flats). |

December uses **the same mechanics and difficulty curve**: day N reuses November's day-N recipe
(same validation), with its own seeds, polar names, titles and tips, and slightly larger ice
islands. Day 31 is a second finale with two blizzards. Every challenge id carries its pack
(`frozen-passages-07`), so the server's `seafarerPuzzle` finds it in either pack.

### January: The Lantern Sea (built 2026-11-19, engine 3.10.0)

The third pack adds **one new mechanic** (December re-skinned November; by month 3 the rhythm
needs something new). Decisions:

- **Setting**: a night voyage. Deep navy water, lighthouses on the islands, glowing shallows,
  a moon. New `night` art style (lighthouses, bioluminescent shallows, moonlit palette). Pack id
  `lantern-sea`, 31 challenges, Gold at 31. Tile: night sky, stars and moon glow; icon a
  sailboat under a crescent moon; tagline "Chart the best course by lantern light."
- **Mechanic: tides.** Tidal flats (`~`) can be crossed at high tide and are blocked at low tide,
  on a regular cycle (`tide: { period, high, offset }`; for example high 2 days, low 2). Rules mirror
  storms: the ship can't *arrive* on flats at low tide, and can't anchor on flats if the tide
  drops tomorrow; sailing off is always fine. The tide clock follows the voyage day (it restarts
  with each voyage, like storms). The solver plans by day whenever a chart has tides or storms,
  so it stays exact, and **Drop anchor** doubles as "wait for the tide".
- **Forecast**: tides are regular, so the header shows a tide clock (today and the next days,
  high or low) and the chart marks flats open or closed.
- **Generator**: flats on coasts and narrow channels; metric `tideCost` (days the tide adds to
  par); recipe `minTideCost` on tide days. The naive sailor reads flats as open sea and
  finds out at low tide (waits, or goes around), so the lure is built in.
- **Difficulty**: every month starts gentle (late joiners start at day 1) and gets harder.

| Days | Focus |
|---|---|
| 1–3 | Voyages, a refresher (day 1 rewards the obvious route) |
| 4–8 | Tides introduced: open/closed flats, then racing the tide |
| 9–12 | Tides with shallows |
| 13–16 | Tides with currents |
| 17–21 | Rounds: nearest-first and ignoring the tide are both traps |
| 22–26 | Storm season (squalls) on top of the tides |
| 27–30 | Charters and the hardest rounds |
| 31 | Finale: everything |

Built: tides in the rules, solver (time-aware like storms), generator (`placeFlats`, `tideCost`,
`minTideCost`), naive sailor and UI (tide clock, flats drawn open or dry, "Ride the high tide"
routes); the `night` art; the plan (`packs/lantern-sea.plan.ts`, pinned); theme words count nights
and lamp oil. The finale needed par up to 36 and lure/greedy ≥ 3 (tides make finale charts longer).
Original work list: engine rules/solver/generator/UI for tides, the `night` art style, the plan (31 days,
~65 names, titles, tips), catalog tagline + icon; atlas `SEAFARER_SEASONS["2027-01"]`, three
badges (definitions, migration, emblem art) and a tile skin. Content built and QA'd by about
December 20 for a January 1 launch (a month later if November's pack slips to December).

### Adding a pack

1. Write `packs/<id>.plan.ts` exporting a `PackPlan`: id, title, description, theme, badge
   tiers, place names and one `PlannedDay` per day. Deriving from an existing plan, as December
   does, keeps the difficulty curve.
2. Add a theme to `theme.ts`: words for every mechanic (legend, route names, hints) and an
   `art` style (`tropical` or `polar`; a new style means new shapes in `Terrain`). Add a palette
   block in `seafarer.css` under `.sf-root[data-theme="<id>"]`.
3. Register the plan in `scripts/build-seafarer-pack.ts`, then run
   `tsx scripts/build-seafarer-pack.ts <id> --review`. Review it in the playground (the Pack
   picker, then Review candidates), pin each day's chart with `pick`, and rebuild (seconds).
4. Add the pack to `packs/index.ts`. The pack tests run over every pack.
5. In atlas: map the month to the pack id, and create the pack's three badges.

## Atlas integration (planned, not built)

- **Table** `SeafarerProgress`: `userId, packId, number, localDate (YYYY-MM-DD, player's
  calendar), stars, days, cargo, durationSec, taps Json, completedAt`, unique on
  `(userId, packId, number)`.
- **Season config** in atlas code: `{ "2026-11": "shattered-isles" }`. Slipping to December is a
  one-line change.
- **Unlock rule** (server): the pack is open if the player's local month maps to it. `next =
  charted + 1` (max 30). It's playable unless the player already charted one on that local date.
  Earlier challenges stay viewable. Missing days just pauses progress; there are no streaks.
- **Submit action**: verify with `verifyGameResult`. Check that the number is `next`, the pack is
  open, nothing was charted today, and the local date is within a day of the server's date.
  Then insert the row and award badges.
- **Badges**: three `Badge` rows per pack (`seafarer_<pack>_bronze|silver|gold`, tiers
  BRONZE/SILVER/GOLD, group "Expeditions", 256 px art per docs/BADGE_ART_SPEC.md), created on
  develop and promoted like other content. They're awarded by counting the player's rows for the
  pack, and they stay on the profile after the month ends.
- **Pack leaderboard**: charted desc, stars desc, total days asc. Global and friends views reuse the
  existing board UI and the `hideFromLeaderboards` opt-out.
