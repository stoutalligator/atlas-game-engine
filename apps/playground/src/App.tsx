import {
  AtlasGame,
  GAME_CATALOG,
  GameIcon,
  type GameId,
  type GameResult,
  getGameInfo,
  localDateKey,
} from "@stoutalligator/engine";
import { useEffect, useState } from "react";
import { blackSwanMock, resetBlackSwanMock } from "./blackSwanMock";
import pack1 from "./packs/sample_pack_1.json";
import pack2 from "./packs/sample_pack_2.json";
import pack3 from "./packs/sample_pack_3.json";
import { generatedWordWeb } from "./wordwebMock";

const PACKS = [pack1, pack2, pack3];

/** Mimics the ATLAS exam page so games can be checked in context. */
export function App() {
  const params = new URLSearchParams(window.location.search);
  const [game, setGame] = useState<GameId>((params.get("game") as GameId) ?? "risk-pool");
  const [date, setDate] = useState(params.get("date") ?? localDateKey());
  const [nonce, setNonce] = useState(0);
  const [last, setLast] = useState<GameResult | null>(null);
  const info = getGameInfo(game);
  // WordWeb: the canonical HOUSEHOLD PETS fixture, or a puzzle generated for the date.
  const [wwSource, setWwSource] = useState(params.get("ww") ?? "canonical");
  const [wwPuzzles, setWwPuzzles] = useState<unknown[] | null>([]);
  useEffect(() => {
    if (game !== "wordweb" || wwSource === "canonical") {
      setWwPuzzles([]);
      return;
    }
    setWwPuzzles(null);
    let live = true;
    generatedWordWeb(date).then((p) => live && setWwPuzzles(p));
    return () => {
      live = false;
    };
  }, [game, date, wwSource]);

  const resetDay = () => {
    for (const key of Object.keys(localStorage))
      if (key.startsWith(`atlas-games:v2:${game}:`) && !key.endsWith(":help-seen"))
        localStorage.removeItem(key);
    if (game === "black-swan") resetBlackSwanMock(date);
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
          {game === "wordweb" && (
            <label>
              Puzzle{" "}
              <select value={wwSource} onChange={(e) => setWwSource(e.target.value)}>
                <option value="canonical">Canonical (Household pets)</option>
                <option value="generated">Generated for the date</option>
              </select>
            </label>
          )}
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
        {game === "wordweb" && wwPuzzles === null ? (
          <p className="pg-desc">Generating…</p>
        ) : (
          <AtlasGame
            // WordWeb fixes its puzzle when it mounts, so a new puzzle needs a new mount.
            key={`${game}-${date}-${nonce}-${wwSource}-${(wwPuzzles ?? []).map((p) => (p as { id: string }).id).join()}`}
            game={game}
            date={date}
            packs={game === "wordweb" ? (wwPuzzles ?? []) : PACKS}
            blackSwanApi={blackSwanMock}
            onComplete={setLast}
          />
        )}
      </section>

      {last && <pre className="pg-log">{JSON.stringify(last, null, 2)}</pre>}
    </main>
  );
}
