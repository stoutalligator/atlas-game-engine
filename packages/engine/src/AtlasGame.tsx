import type { DailyGameProps, GameId } from "./core/types.js";
import { AssumptionDrift } from "./games/assumption-drift/AssumptionDrift.js";
import { BoxPlot } from "./games/box-plot/BoxPlot.js";
import { CubeRush } from "./games/cube-rush/CubeRush.js";
import { RiskPool } from "./games/risk-pool/RiskPool.js";

export interface AtlasGameProps extends DailyGameProps {
  game: GameId;
  /** Assumption Drift packs (raw JSON) for the current exam. Ignored by other games. */
  packs?: readonly unknown[];
}

/** Renders any ATLAS daily game by id — the one component a host needs. */
export function AtlasGame({ game, packs = [], ...props }: AtlasGameProps) {
  switch (game) {
    case "assumption-drift":
      return <AssumptionDrift packs={packs} {...props} />;
    case "box-plot":
      return <BoxPlot {...props} />;
    case "cube-rush":
      return <CubeRush {...props} />;
    case "risk-pool":
      return <RiskPool {...props} />;
  }
}
