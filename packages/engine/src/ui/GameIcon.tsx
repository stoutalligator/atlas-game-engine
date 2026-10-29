import type { GameId } from "../core/types.js";

const PATHS: Record<GameId, React.ReactNode> = {
  "assumption-drift": (
    <>
      <path d="M3 15c3-5 5-5 8 0s5 5 8 0" />
      <path d="M3 9c3-5 5-5 8 0s5 5 8 0" opacity="0.4" />
      <path d="M19 5l2 2-2 2" />
    </>
  ),
  "risk-pool": (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="18" height="8" rx="1" />
      <path d="M7 7h0M17 7h0M12 17h0" strokeWidth="3" />
    </>
  ),
  "box-plot": (
    <>
      <path d="M12 2v4M12 18v4M9 2h6M9 22h6" />
      <rect x="5" y="6" width="14" height="12" rx="1" />
      <path d="M5 11h14" />
    </>
  ),
  "black-swan": (
    <>
      <path d="M3 18c4 0 5-3 9-3s5 3 9 3" />
      <path d="M12 15c-1-3 0-7 3-9 1.5-1 3-.5 3 1s-1.5 2-3 2" />
    </>
  ),
  "cube-rush": (
    <>
      <rect x="3" y="3" width="11" height="5" rx="1" />
      <rect x="3" y="10" width="5" height="11" rx="1" />
      <rect x="10" y="12" width="4" height="4" rx="1" fill="currentColor" />
      <path d="M17 14h4M19 12l2 2-2 2" />
    </>
  ),
  wordweb: (
    <>
      <rect x="3" y="9" width="5" height="5" rx="1" />
      <rect x="8" y="9" width="5" height="5" rx="1" />
      <rect x="13" y="9" width="5" height="5" rx="1" />
      <rect x="8" y="4" width="5" height="5" rx="1" opacity="0.5" />
      <rect x="8" y="14" width="5" height="5" rx="1" opacity="0.5" />
      <path d="M18 11.5h3M10.5 19v2" strokeDasharray="1 2" />
    </>
  ),
};

/** Line icons in the same 24px / 2px-stroke style as the ATLAS dashboard tiles. */
export function GameIcon({ game, className }: { game: GameId; className?: string }) {
  return (
    <svg
      className={className}
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[game]}
    </svg>
  );
}
