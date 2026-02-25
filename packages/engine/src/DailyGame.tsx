import { AssumptionDrift } from "./games/assumption-drift/AssumptionDrift.js";
import { getGame, registerGame } from "./games/registry.js";
import type { GamePack, GameResult, StorageAdapter } from "./types.js";

// ---------------------------------------------------------------------------
// Register all built-in game types
// ---------------------------------------------------------------------------
// To add a new game type: import its component and call registerGame().
registerGame("assumption_drift", AssumptionDrift);

// ---------------------------------------------------------------------------
// DailyGame component
// ---------------------------------------------------------------------------

interface DailyGameProps {
  pack: GamePack;
  storage: StorageAdapter;
  onComplete: (result: GameResult) => void;
}

export function DailyGame({ pack, storage, onComplete }: DailyGameProps) {
  const GameComponent = getGame(pack.gameType);

  if (!GameComponent) {
    return (
      <div style={{ color: "red", padding: "1rem" }}>
        Unknown game type: <code>{pack.gameType}</code>
      </div>
    );
  }

  return <GameComponent pack={pack} storage={storage} onComplete={onComplete} />;
}
