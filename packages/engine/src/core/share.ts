import { getGameInfo } from "../catalog.js";
import { puzzleNumber } from "./daily.js";
import type { GameId } from "./types.js";

export function shareText(game: GameId, date: string, lines: string[]): string {
  return [`ATLAS ${getGameInfo(game).title} #${puzzleNumber(date)}`, ...lines].join("\n");
}
