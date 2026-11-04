import type { DailyGameProps, GameId } from "./core/types.js";
import { AssumptionDrift } from "./games/assumption-drift/AssumptionDrift.js";
import { BlackSwan, type BlackSwanApi } from "./games/black-swan/BlackSwan.js";
import { BoxPlot } from "./games/box-plot/BoxPlot.js";
import { CubeRush } from "./games/cube-rush/CubeRush.js";
import { RiskPool } from "./games/risk-pool/RiskPool.js";
import { WordWeb } from "./games/wordweb/WordWeb.js";
import { ResultTagsContext } from "./ui/Shell.js";

export interface AtlasGameProps extends DailyGameProps {
  game: GameId;
  /**
   * Host content (raw JSON): Assumption Drift packs in rotation order, or
   * Word Web puzzles for today and nearby days. Ignored by other games.
   */
  packs?: readonly unknown[];
  /** Black Swan only: the host's server calls (answers and rarity stay server-side). */
  blackSwanApi?: BlackSwanApi;
  /**
   * Tags for today's finish, from the host's records ("Personal best!",
   * "No hints!", "🔥 5-day streak"). Shown in the result panel once the
   * puzzle is done; pass them after the host has saved the result.
   */
  resultTags?: readonly string[];
}

/** Renders any ATLAS daily game by id — the one component a host needs. */
export function AtlasGame({ resultTags = [], ...props }: AtlasGameProps) {
  return (
    <ResultTagsContext.Provider value={resultTags}>
      <Game {...props} />
    </ResultTagsContext.Provider>
  );
}

function Game({ game, packs = [], blackSwanApi, ...props }: Omit<AtlasGameProps, "resultTags">) {
  switch (game) {
    case "assumption-drift":
      return <AssumptionDrift packs={packs} {...props} />;
    case "box-plot":
      return <BoxPlot {...props} />;
    case "cube-rush":
      return <CubeRush {...props} />;
    case "risk-pool":
      return <RiskPool {...props} />;
    case "wordweb":
      return <WordWeb puzzles={packs} {...props} />;
    case "black-swan":
      return blackSwanApi ? (
        <BlackSwan api={blackSwanApi} {...props} />
      ) : (
        <div className="ag-root ag-error">Black Swan needs a blackSwanApi from the host.</div>
      );
  }
}
