import type { DailyGameProps, GameId } from "./core/types.js";
import { AssumptionDrift } from "./games/assumption-drift/AssumptionDrift.js";
import { BlackSwan, type BlackSwanApi } from "./games/black-swan/BlackSwan.js";
import { BoxPlot } from "./games/box-plot/BoxPlot.js";
import { CubeRush } from "./games/cube-rush/CubeRush.js";
import { RiskPool } from "./games/risk-pool/RiskPool.js";

export interface AtlasGameProps extends DailyGameProps {
  game: GameId;
  /** Assumption Drift packs (raw JSON) for the current exam. Ignored by other games. */
  packs?: readonly unknown[];
  /** Black Swan only: the host's server calls (answers and rarity stay server-side). */
  blackSwanApi?: BlackSwanApi;
}

/** Renders any ATLAS daily game by id — the one component a host needs. */
export function AtlasGame({ game, packs = [], blackSwanApi, ...props }: AtlasGameProps) {
  switch (game) {
    case "assumption-drift":
      return <AssumptionDrift packs={packs} {...props} />;
    case "box-plot":
      return <BoxPlot {...props} />;
    case "cube-rush":
      return <CubeRush {...props} />;
    case "risk-pool":
      return <RiskPool {...props} />;
    case "black-swan":
      return blackSwanApi ? (
        <BlackSwan api={blackSwanApi} {...props} />
      ) : (
        <div className="ag-root ag-error">Black Swan needs a blackSwanApi from the host.</div>
      );
  }
}
