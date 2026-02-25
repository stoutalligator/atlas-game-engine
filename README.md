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

- **Node >= 20**
- **pnpm >= 9** — install via `npm i -g pnpm` if needed

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

## Engine API (`@atlas/engine`)

### Types

```ts
import type {
  GamePack,             // discriminated union of all pack types
  AssumptionDriftPack,  // specific pack shape
  GameResult,           // what onComplete emits
  StorageAdapter,       // interface for persistence
} from "@atlas/engine";
```

### Zod schemas

```ts
import { GamePackSchema, AssumptionDriftPackSchema } from "@atlas/engine";

const result = GamePackSchema.safeParse(rawJson);
if (!result.success) console.error(result.error.issues);
```

### `<DailyGame>` component

```tsx
import { DailyGame, LocalStorageAdapter } from "@atlas/engine";
import type { GameResult } from "@atlas/engine";

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
import type { StorageAdapter } from "@atlas/engine";

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
