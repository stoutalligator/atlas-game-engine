# ATLAS Game Engine

`@stoutalligator/engine` — the daily games for [ATLAS](https://www.study-atlas.com), packaged as
React components that already look like ATLAS. The site installs the package and renders one
component per game, and the games' code doesn't live in the main repo.

| Game | What it is | Content |
|---|---|---|
| **Assumption Drift** | One assumption in a pricing/reserving scenario changes. Call the impact. | Exam packs supplied by the host |
| **Risk Pool** | Group neighbouring policyholders into pools whose claims hit the target premium exactly. 5×5 Mon → 7×7 weekend. | Generated daily |
| **Box Plot** | 10×10 picture logic puzzle (nonogram). 110 pictures, all solvable without guessing. | Built-in library |
| **Cube Rush** | Slide cubicles until the analyst can reach the exit. Easy Mon → hard weekend, with par. | Built-in verified library (240 puzzles) |
| **WordWeb** | A crossword that unfolds: one category, no clues; solving a word reveals the words that cross it. Easy Mon → hardest Sun. | Validated puzzles supplied by the host (built-in canonical fallback) |
| **Black Swan** | Five prompts ("Name a loss reserving method."). Any accepted answer counts; the rarer it is among everyone's guesses, the more it scores. | Question pool + guess counts supplied by the host's server |

Every player gets the same puzzle for a date. New puzzles unlock at the player's local midnight.
Progress, streaks, and stats are saved in the browser through a swappable storage adapter.

## Repo layout

```
packages/engine/            @stoutalligator/engine
  src/
    index.ts                client entry ("use client"): components + helpers
    catalog-entry.ts        server-safe entry: game metadata, icons, pack parsing
    AtlasGame.tsx           <AtlasGame game="…" /> — renders any game by id
    catalog.ts              titles, taglines, rules, accent colours
    core/                   daily calendar, seeded RNG, storage, progress hooks, share text
    ui/                     shared shell (top bar, rules, result panel), icons
    games/<game>/           logic.ts (pure, tested) + <Game>.tsx
    styles/atlas-games.css  all styles, `ag-` prefixed, ATLAS palette
  scripts/build-cube-rush-library.ts
apps/playground/            Vite page that mimics the ATLAS exam page
```

## Develop

```bash
pnpm install
pnpm dev          # playground at http://localhost:5173 (?game=risk-pool&date=2026-10-14)
pnpm test         # vitest: rules, generators, every Box Plot / Cube Rush puzzle verified
pnpm typecheck
pnpm lint
pnpm build        # packages/engine/dist
```

## Using it in a host (ATLAS)

```tsx
// Any client component
"use client";
import { AtlasGame } from "@stoutalligator/engine";
import "@stoutalligator/engine/styles.css";

<AtlasGame game="risk-pool" />
<AtlasGame game="assumption-drift" packs={examPacks} onComplete={(r) => console.log(r.shareText)} />
```

```ts
// Server components / admin pages: no hooks, no client bundle
import { GAME_CATALOG, GameIcon, isGameId, parseAssumptionDriftPack } from "@stoutalligator/engine/catalog";
```

`AtlasGame` props (each game component takes the same ones):

| Prop | Default | |
|---|---|---|
| `game` | — | `"assumption-drift" \| "risk-pool" \| "box-plot" \| "cube-rush" \| "black-swan" \| "wordweb"` |
| `date` | player's local date | `"YYYY-MM-DD"` — pin a date for previews |
| `storage` | `localStorageAdapter` | any `{ load, save, remove }` (e.g. API-backed, for cross-device sync) |
| `onComplete` | — | fires with a `GameResult` (stats + share text) when today's puzzle is finished |
| `packs` | `[]` | Assumption Drift: raw pack JSON in rotation order. WordWeb: validated puzzles for the days around today |

The games inherit the host's font. Colours follow the ATLAS Tailwind palette (slate, violet, emerald, cyan,
amber), and the components draw no outer panel, so the host wraps them in its own.

`readDailyStatus(game, date)` and `readStreak(game, date)` from `/catalog` power "✓ Solved" and 🔥 badges on
dashboards.

### Black Swan

Black Swan scores against everyone's answers, so the host keeps the answer lists and the
guesses on its server and passes the component four calls:

```tsx
import { BlackSwan, type BlackSwanApi } from "@stoutalligator/engine";

const api: BlackSwanApi = { load, open, check, lock }; // e.g. server actions
<BlackSwan api={api} onComplete={…} />   // or <AtlasGame game="black-swan" blackSwanApi={api} />
```

The pure logic for the server is in `@stoutalligator/engine/server`:

| Function | |
|---|---|
| `parseBlackSwanQuestions(raw)` | Validates a pool (rejects an alias that matches two answers) |
| `questionsForDate(pool, schedule, date)` | The day's five prompts (planned, or a deterministic fallback) |
| `planSchedule(pool, { start, days, cooldownDays, existing })` | Five categories a day, least-recently-used questions, cooldown |
| `matchGuess(question, input)` | `exact` (lock in) / `suggest` (alias or typo: confirm first) / `null` |
| `buildRarityTable(question, counts)` | Credibility blend `Z = n / (n + 200)` of priors and real counts → tiers |
| `scoreGuess(table, label, input)` | Mode 10 · Expected 25 · Within σ 50 · Tail 100 · Black Swan 200 |
| `summarizeDay(results)` | Day score, mean rarity (tie-break), Black Swan count |

The host should freeze one rarity table per question per day, so every player that day is
scored against the same numbers. The playground uses an in-memory stand-in
(`apps/playground/src/blackSwanMock.ts`).

### WordWeb

A daily crossword that unfolds. The puzzle (layout, unlock tree, starting letters,
alternates) is built and validated before anyone plays; play only changes what's
visible, typed, hinted and solved. Everything is in `src/games/wordweb/`, one concern
per module:

| Module | |
|---|---|
| `types.ts` | Puzzle, record (puzzle + audit report) and queue shapes |
| `normalize.ts` | One normalization for answers and guesses (A–Z only; accents fold; spaces and hyphens drop) |
| `grid.ts`, `construct.ts` | Geometry, and the deterministic seeded builder that proposes layouts |
| `validate.ts` | Every hard rule: matching crossings, one answer per direction per cell, every run of letters is an answer, connected, in bounds; unlock tree single-start, acyclic, reachable, parent crosses child, no hidden word showing early, always completable |
| `graph.ts` | Unlock tree from a layout (wide or deep) and its stats |
| `difficulty.ts` | 15 weighted components → 0–100, weekday bands (`DIFFICULTY_WEIGHTS`, `WEEKDAY_TARGETS`) |
| `safety.ts`, `recurrence.ts` | Deny-lists, brand/proper-noun/abbreviation policy; repeat rules |
| `generator.ts` | The `WordWebGenerator` contract and the local bank generator |
| `pipeline.ts`, `queue.ts` | Generate one date; fill a queue idempotently; serve with fallbacks |
| `schema.ts` | Runtime parsing at every ingestion point |
| `play.ts`, `clock.ts`, `share.ts` | Player state (guesses, hints, cooldowns, restore, replay), active-play clock, share text |
| `fixture.ts` | The canonical HOUSEHOLD PETS puzzle (coordinates adjusted to be legal; see the comment) |
| `WordWeb.tsx` | The component |

The host passes puzzles through `packs`; with none, the canonical puzzle plays. The
pipeline lives in `@stoutalligator/engine/server` (`generateForDate`, `planQueue`,
`recordForDate`, validators…), and `verifyGameResult` replays a finished game's
guess/hint log. In the playground, pick WordWeb and switch **Puzzle** to "Generated for
the date" to run the real pipeline against the test bank.

### Assumption Drift packs

```jsonc
{
  "schemaVersion": 1,
  "gameType": "assumption_drift",
  "gameId": "2026-02-25",
  "packId": "2026-02-25-assumption-drift-easy",
  "title": "Assumption Drift — Duration Sensitivity",
  "meta": { "difficulty": "easy", "tags": ["duration"] },
  "payload": {
    "instructions": "A single assumption changes. Predict the impact.",
    "questions": [{
      "id": "q1",
      "scenario": "…", "drift": "…", "prompt": "…",
      "choices": [{ "id": "inc", "label": "Increase" }, { "id": "dec", "label": "Decrease" }],
      "answer": "inc",
      "solution": { "text": "…" }
    }]
  }
}
```

`parseAssumptionDriftPack` validates a pack and throws a `PackError` that names the bad field. Packs rotate one per
day. Progress is keyed by date, so a pack coming back around is a fresh game.

## Adding a game

1. Add `games/<id>/logic.ts` (pure, deterministic from the date) with tests.
2. Add `games/<id>/<Game>.tsx` using `useDailyProgress`, `useTicker`, `useCompletion`, `GameShell`, and `ResultPanel`.
3. Add the id to `GameId`, an entry to `GAME_CATALOG`, a case to `AtlasGame`, and an icon to `GameIcon`.
4. Release. ATLAS lists the new game on its admin page (on by default).

Regenerate the Cube Rush library (several minutes) after changing its generator:

```bash
pnpm build:cube-rush
```

## Releasing

The package publishes to GitHub Packages when a GitHub release is created with a `vX.Y.Z` tag (see
`.github/workflows/publish.yml`). The tag sets the version. Then in ATLAS:

```bash
npm install @stoutalligator/engine@^X.Y.Z
```

ATLAS's `.npmrc` reads `GH_TOKEN` (a token with `read:packages`) locally and on Vercel.
