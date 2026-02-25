import { AssumptionDrift } from "./games/assumption-drift/AssumptionDrift.js";
import { getGame, registerGame } from "./games/registry.js";
import "./themes/tokens.css";
import "./themes/theme-8bit.css";
import "./themes/theme-terminal.css";
import type { GamePack, GameResult, StorageAdapter } from "./types.js";

// ---------------------------------------------------------------------------
// Register all built-in game types
// ---------------------------------------------------------------------------
// To add a new game type: import its component and call registerGame().
registerGame("assumption_drift", AssumptionDrift);

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export type Theme = "modern" | "8bit" | "terminal";

// ---------------------------------------------------------------------------
// DailyGame component
// ---------------------------------------------------------------------------

interface DailyGameProps {
  pack: GamePack;
  storage: StorageAdapter;
  onComplete: (result: GameResult) => void;
  /** Visual theme applied to the game wrapper. Defaults to "modern". */
  theme?: Theme;
}

export function DailyGame({ pack, storage, onComplete, theme = "modern" }: DailyGameProps) {
  const GameComponent = getGame(pack.gameType);

  if (!GameComponent) {
    return (
      <div data-ad-theme={theme} style={{ color: "red", padding: "1rem" }}>
        Unknown game type: <code>{pack.gameType}</code>
      </div>
    );
  }

  return (
    <div data-ad-theme={theme}>
      <GameComponent pack={pack} storage={storage} onComplete={onComplete} />
    </div>
  );
}
