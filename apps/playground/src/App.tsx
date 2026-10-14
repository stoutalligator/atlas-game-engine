import {
  AtlasGame,
  GAME_CATALOG,
  GameIcon,
  type GameId,
  type GameResult,
  getGameInfo,
  localDateKey,
} from "@stoutalligator/engine";
import { useState } from "react";
import pack1 from "./packs/sample_pack_1.json";
import pack2 from "./packs/sample_pack_2.json";
import pack3 from "./packs/sample_pack_3.json";

const PACKS = [pack1, pack2, pack3];

/** Mimics the ATLAS exam page so games can be checked in context. */
export function App() {
  const params = new URLSearchParams(window.location.search);
  const [game, setGame] = useState<GameId>((params.get("game") as GameId) ?? "risk-pool");
  const [date, setDate] = useState(params.get("date") ?? localDateKey());
  const [nonce, setNonce] = useState(0);
  const [last, setLast] = useState<GameResult | null>(null);
  const info = getGameInfo(game);

  const resetDay = () => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`atlas-games:v2:${game}:`) && !key.endsWith(":help-seen"))
        localStorage.removeItem(key);
    setLast(null);
    setNonce((n) => n + 1);
  };

  return (
    <main className="pg">
      <header className="pg-panel pg-panel--slate">
        <div className="pg-tab pg-tab--center">ATLAS GAMES PLAYGROUND</div>
        <div className="pg-controls">
          <label>
            Date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <button type="button" className="pg-btn" onClick={resetDay}>
            Reset {info.title} progress
          </button>
        </div>
        <nav className="pg-games">
          {GAME_CATALOG.map((g) => (
            <button
              key={g.id}
              type="button"
              className="pg-game"
              data-accent={g.accent}
              data-active={g.id === game}
              onClick={() => setGame(g.id)}
            >
              <GameIcon game={g.id} />
              <span>
                <strong>{g.title}</strong>
                <small>{g.tagline}</small>
              </span>
            </button>
          ))}
        </nav>
      </header>

      <section className="pg-panel" data-accent={info.accent}>
        <div className="pg-tab">{info.title.toUpperCase()}</div>
        <p className="pg-desc">{info.description}</p>
        <AtlasGame
          key={`${game}-${date}-${nonce}`}
          game={game}
          date={date}
          packs={PACKS}
          onComplete={setLast}
        />
      </section>

      {last && <pre className="pg-log">{JSON.stringify(last, null, 2)}</pre>}
    </main>
  );
}
