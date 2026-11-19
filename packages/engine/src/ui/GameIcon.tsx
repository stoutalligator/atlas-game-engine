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
  // Outlier: a shooting star streaking out into the dark.
  "black-swan": (
    <>
      <path d="M16 3l1.23 3.3 3.53.15-2.76 2.2.94 3.4L16 10.1l-2.94 1.95.94-3.4-2.76-2.2 3.53-.15z" />
      <path d="M11.5 13.5L4 21" />
      <path d="M9 10.5l-4.5 4.5" opacity="0.6" />
      <path d="M14.5 16l-3.5 3.5" opacity="0.6" />
      <circle cx="5" cy="5" r="0.6" fill="currentColor" />
      <circle cx="21" cy="17" r="0.6" fill="currentColor" />
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
  // Doodle: a pencil finishing a dashed curve.
  doodle: (
    <>
      <path d="M3 17c2-6 5-9 9-9" />
      <path d="M12 8c2 0 3.5.6 4.6 1.6" strokeDasharray="1.5 2.5" />
      <path d="M14.5 19.5l6-6-2-2-6 6-.8 2.8z" />
    </>
  ),
  // Seafarer: a sailboat on a dotted course.
  seafarer: (
    <>
      <path d="M11 3v11" />
      <path d="M11 4c3.5 2 5.5 5 6 9h-6" />
      <path d="M9 6c-2 2-3 4.5-3 7h3" />
      <path d="M4 16h14l-2 3H6z" />
      <path d="M3 22h2M9 22h2M15 22h2" />
    </>
  ),
};

/**
 * Seafarer's icon changes with the month's pack (variant = the pack's theme):
 * the same little sailboat, in that month's waters.
 */
const SEAFARER_VARIANTS: Record<string, React.ReactNode> = {
  // January, the Lantern Sea: sailing by night, under a crescent moon, past a lighthouse.
  "lantern-sea": (
    <>
      <path d="M4.6 1.8a3 3 0 1 0 2.9 4.3 2.4 2.4 0 1 1-2.9-4.3z" />
      <path d="M9 7v7" />
      <path d="M9 8c2.2 1.3 3.4 3.4 3.8 6H9" />
      <path d="M3.5 15.5h10.5l-1.6 2.5H5.1z" />
      <path d="M15.8 21l1.3-8.5h2.8l1.3 8.5" />
      <path d="M17.4 12.5v-2.2h2.2v2.2M16.9 10.3l1.6-1.8 1.6 1.8" />
      <path d="M22.8 8.6l-1.4.8M14.2 8.6l1.4.8" />
      <path d="M2 21.5c1.7-1 3.3-1 5 0s3.3 1 5 0" />
    </>
  ),
  // November, the Shattered Isles: sailing past a palm island.
  "shattered-isles": (
    <>
      <path d="M7 3v10" />
      <path d="M7 4c2.6 1.6 4.2 4.4 4.6 8H7" />
      <path d="M2.5 15h10l-1.6 2.5H4.1z" />
      <path d="M18.5 20.5c0-3-.4-5.2-1.4-7.3" />
      <path d="M17.1 13.2c-.9-1.6-2.7-2.2-4.4-1.7" />
      <path d="M17.1 13.2c.2-1.9 1.6-3.2 3.4-3.3" />
      <path d="M17.1 13.2c1.6-.5 3.2.1 4 1.6" />
      <path d="M2 21.5c1.7-1 3.3-1 5 0s3.3 1 5 0 3.3-1 5 0 3.3 1 5 0" />
    </>
  ),
  // December, the Frozen Passages: an iceberg and falling snow.
  "frozen-passages": (
    <>
      <path d="M7 3v10" />
      <path d="M7 4c2.6 1.6 4.2 4.4 4.6 8H7" />
      <path d="M2.5 15h10l-1.6 2.5H4.1z" />
      <path d="M13 19l3-8 2.2 2.6 1.8-3.6 3 9z" />
      <path d="M19.5 1.8v4.4M17.6 2.9l3.8 2.2M21.4 2.9l-3.8 2.2" />
      <path d="M2 21.5c1.7-1 3.3-1 5 0s3.3 1 5 0 3.3-1 5 0 3.3 1 5 0" />
    </>
  ),
};

/**
 * Line icons in the same 24px / 2px-stroke style as the ATLAS dashboard tiles.
 * `variant` picks a seasonal version where a game has one (Seafarer: the
 * running pack's theme); unknown variants fall back to the standard icon.
 */
export function GameIcon({
  game,
  className,
  variant,
}: { game: GameId; className?: string; variant?: string | null }) {
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
      {(game === "seafarer" && variant && SEAFARER_VARIANTS[variant]) || PATHS[game]}
    </svg>
  );
}
