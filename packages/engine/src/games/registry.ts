import type { ComponentType } from "react";
import type { GamePack, GameResult, StorageAdapter } from "../types.js";

/**
 * Props passed to every game-type implementation component.
 * Add new game types by registering a component that accepts these props.
 */
export interface GameComponentProps {
  pack: GamePack;
  storage: StorageAdapter;
  onComplete: (result: GameResult) => void;
}

export type GameComponent = ComponentType<GameComponentProps>;

/**
 * Registry map: gameType string → React component.
 *
 * To add a new game type:
 *   1. Create a component in `./your-game-type/YourGame.tsx`
 *   2. Add an entry below: `your_game_type: YourGameComponent`
 */
const registry = new Map<string, GameComponent>();

export function registerGame(gameType: string, component: GameComponent): void {
  registry.set(gameType, component);
}

export function getGame(gameType: string): GameComponent | undefined {
  return registry.get(gameType);
}
