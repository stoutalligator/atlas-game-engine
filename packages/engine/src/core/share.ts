import { getGameInfo } from "../catalog.js";
import { puzzleNumber } from "./daily.js";
import type { GameId } from "./types.js";

/** Public origin that share text links back to. */
export const SHARE_ORIGIN = "https://study-atlas.com";

/** Link to today's game on Atlas (signed-out visitors can open it). */
export function shareLink(game: GameId): string {
  return `${SHARE_ORIGIN}/games/${game}`;
}

/** Appends the game link as the share text's last line. */
export function withShareLink(game: GameId, text: string): string {
  return `${text}\n\n${shareLink(game)}`;
}

export function shareText(game: GameId, date: string, lines: string[]): string {
  return withShareLink(
    game,
    [`ATLAS ${getGameInfo(game).title} #${puzzleNumber(date)}`, ...lines].join("\n"),
  );
}
