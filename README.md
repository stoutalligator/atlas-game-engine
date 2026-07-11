# Atlas Game Engine — Assumption Drift

A minimal, reusable **daily game engine** monorepo built with TypeScript, React, Vite, and Zod.

---

## Repo layout

```
atlas-game-engine/
├── packs/                        # Canonical game packs (JSON, source of truth)
│   ├── sample_pack_1.json        # Easy
│   ├── sample_pack_2.json        # Medium
│   └── sample_pack_3.json        # Hard
├── packages/
│   └── engine/                   # @atlas/engine — reusable library
│       └── src/
│           ├── schemas.ts        # Zod validation schemas
│           ├── types.ts          # TypeScript types + interfaces
│           ├── storage.ts        # LocalStorageAdapter
│           ├── DailyGame.tsx     # Top-level React component
│           └── games/
│               ├── registry.ts                      # Game-type registry
│               └── assumption-drift/
│                   └── AssumptionDrift.tsx           # Game implementation
└── apps/
    └── demo/                     # Vite + React demo app
```

---

## Requirements

- **Node >= 22**
- **pnpm >= 11**

---

## Install & run

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Start the demo app (hot-reload dev server at http://localhost:5173)
pnpm dev
# or explicitly:
pnpm --filter apps/demo dev
```

---

## Other scripts

| Command | Description |
|---|---|
| `pnpm build` | Build engine + demo app |
| `pnpm test` | Run engine vitest unit tests |
| `pnpm lint` | Biome lint |
| `pnpm format` | Biome format (write) |
| `pnpm --filter packages/engine build` | Build engine library only |
| `pnpm --filter apps/demo build` | Build demo app only |
| `pnpm --filter apps/demo preview` | Preview production build |

---

---

## SlidePuzzle API

`SlidePuzzle` is a fully standalone slide-puzzle game component. It requires no pack, storage adapter, or server — just import and render.

### `<SlidePuzzle>` component

```tsx
import { SlidePuzzle } from "@stoutalligator/engine";

// Random puzzle (default — "Generate New Puzzle" regenerates on click)
<SlidePuzzle />

// Harder random puzzles with 8-bit theme
<SlidePuzzle difficulty="hard" theme="8bit" />

// Daily puzzle: same date → same puzzle for every user (deterministic)
<SlidePuzzle date="2026-03-06" difficulty="hard" theme="terminal" />
```

**Props:**

| Prop | Type | Default | Description |
|---|---|---|---|
| `date` | `string` | — | ISO date string (e.g. `"2026-03-06"`). Seeds the puzzle so all users see the same layout for that date. |
| `difficulty` | `"easy" \| "medium" \| "hard"` | `"medium"` | Controls grid size and number of scramble moves (easy: ~15–30, medium: ~40–70, hard: ~80–120). |
| `theme` | `"modern" \| "8bit" \| "terminal"` | `"modern"` | Visual theme. |

**Themes:**

| Theme | Description |
|---|---|
| `modern` | Clean rounded UI, soft colours, system font (default) |
| `8bit` | Retro pixel style — square tiles, bold primary colours, chunky borders, monospace font |
| `terminal` | Dark hacker aesthetic — black background, green-on-black monospace, minimal decoration |

---

### `generatePuzzle(options?)` function

Generates a `PuzzleConfig` without rendering any UI. Useful for server-side seeding, custom renderers, or testing.

```ts
import { generatePuzzle } from "@stoutalligator/engine";
import type { PuzzleConfig, SlidePuzzleOptions } from "@stoutalligator/engine";

// Random puzzle (medium difficulty)
const puzzle: PuzzleConfig = generatePuzzle();

// Deterministic daily puzzle — same output every time for the same date+difficulty
const daily = generatePuzzle({ date: "2026-03-06", difficulty: "hard" });

// PuzzleConfig shape
interface PuzzleConfig {
  gridWidth: number;
  gridHeight: number;
  validCells: Set<string>;  // "row,col" strings
  pieces: Piece[];
  gate: Gate;
}
```

**Options (`SlidePuzzleOptions`):**

| Option | Type | Default | Description |
|---|---|---|---|
| `date` | `string` | — | ISO date string. When set, output is deterministic (seeded PRNG). |
| `difficulty` | `"easy" \| "medium" \| "hard"` | `"medium"` | Difficulty preset. |

---

### Full TypeScript types

```ts
import type {
  PuzzleConfig,          // full puzzle state
  Piece,                 // individual piece
  Gate,                  // gate position
  PieceColor,            // "person" | "orange" | "blue" | "green" | "purple" | "black"
  SlidePuzzleDifficulty, // "easy" | "medium" | "hard"
  SlidePuzzleTheme,      // "modern" | "8bit" | "terminal"
  SlidePuzzleOptions,    // generatePuzzle() options
  SlidePuzzleProps,      // <SlidePuzzle> props
} from "@stoutalligator/engine";
```

---

## Assumption Drift Engine API (`@stoutalligator/engine`)

### Types

```ts
import type {
  GamePack,             // discriminated union of all pack types
  AssumptionDriftPack,  // specific pack shape
  GameResult,           // what onComplete emits
  StorageAdapter,       // interface for persistence
} from "@stoutalligator/engine";
```

### Zod schemas

```ts
import { GamePackSchema, AssumptionDriftPackSchema } from "@stoutalligator/engine";

const result = GamePackSchema.safeParse(rawJson);
if (!result.success) console.error(result.error.issues);
```

### `<DailyGame>` component

```tsx
import { DailyGame, LocalStorageAdapter } from "@stoutalligator/engine";
import type { GameResult } from "@stoutalligator/engine";

const storage = new LocalStorageAdapter();

function MyApp({ pack }) {
  const handleComplete = (result: GameResult) => {
    console.log(result.shareText);
  };
  return (
    <DailyGame
      pack={pack}
      storage={storage}
      onComplete={handleComplete}
    />
  );
}
```

**Props:**

| Prop | Type | Description |
|---|---|---|
| `pack` | `GamePack` | Validated pack object |
| `storage` | `StorageAdapter` | Persistence adapter (localStorage, remote, etc.) |
| `onComplete` | `(result: GameResult) => void` | Called on game completion (and on load if already completed) |

### `GameResult` shape

```ts
interface GameResult {
  schemaVersion: 1;
  gameType: string;
  gameId: string;
  packId: string;
  startedAt: string;      // ISO-8601
  completedAt: string;    // ISO-8601
  durationSec: number;
  responses: { questionId: string; choiceId: string; correct: boolean }[];
  score: number;
  maxScore: number;
  isPerfect: boolean;
  shareText: string;      // Copy-pasteable grid (🟩/🟥)
}
```

---

## Adding a new game type

1. Create `packages/engine/src/games/your-type/YourGame.tsx` with `GameComponentProps`.
2. Add a new Zod schema to `schemas.ts` and extend the `GamePackSchema` discriminated union.
3. Register in `DailyGame.tsx`:
   ```ts
   import { YourGame } from "./games/your-type/YourGame.js";
   registerGame("your_type", YourGame);
   ```

---

## Custom `StorageAdapter`

```ts
import type { StorageAdapter } from "@stoutalligator/engine";

const remoteAdapter: StorageAdapter = {
  async load(key) { /* fetch from API */ },
  async save(key, value) { /* POST to API */ },
  async clear(key) { /* DELETE from API */ },
};
```

---

## Pack format

```jsonc
{
  "schemaVersion": 1,
  "gameType": "assumption_drift",
  "gameId": "YYYY-MM-DD",
  "packId": "YYYY-MM-DD-assumption-drift-<difficulty>",
  "title": "Human readable title",
  "meta": { "difficulty": "easy|medium|hard", "tags": ["..."] },
  "payload": {
    "instructions": "...",
    "questions": [
      {
        "id": "q1",
        "scenario": "...",
        "drift": "...",
        "prompt": "...",
        "choiceStyle": "directional|conceptual",
        "choices": [           // 3–6 items
          { "id": "a", "label": "..." }
        ],
        "answer": "a",         // must match a choice id
        "solution": { "text": "..." }
      }
    ]
  }
}
```

---

## Using the engine in another repo

### 1. Create a GitHub PAT

1. GitHub → **Settings → Developer Settings → Personal Access Tokens → Fine-grained tokens**
2. **Generate new token** — Repository access: `atlas-game-engine` only, Permission: `Contents: Read-only`
3. Copy the token (you only see it once)

### 2. Add the dependency

In your host repo's `package.json`:

```json
{
  "dependencies": {
    "@stoutalligator/engine": "github:YOUR_GITHUB_USERNAME/atlas-game-engine#v1.0.0"
  }
}
```

### 3. Add `.npmrc` to your host repo root

```ini
//github.com:_authToken=${GH_TOKEN}
```

Commit this file. The token value is never committed — it comes from your environment.

### 4. Set `GH_TOKEN`

**Locally** — add to your shell or `.env.local` (gitignored):
```bash
GH_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
```

**On Vercel** — Settings → Environment Variables → add `GH_TOKEN` for all environments.

### 5. Install and use

```bash
pnpm install
```

```tsx
import { DailyGame, LocalStorageAdapter } from "@stoutalligator/engine";
import type { GamePack } from "@stoutalligator/engine";
import myPack from "./packs/my-pack.json";

const storage = new LocalStorageAdapter();

<DailyGame
  pack={myPack as GamePack}
  storage={storage}
  theme="8bit"
  onComplete={(result) => console.log(result)}
/>
```

Packs are plain JSON files that live in your host repo — load them via static import or `fetch()`.

### 6. Tagging new releases

```bash
# in this repo after changes land on main
git tag v1.0.1
git push origin v1.0.1
```

Then bump the `#v1.0.0` reference in your host repo and run `pnpm install`.
