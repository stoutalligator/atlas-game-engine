import {
  DailyGame,
  GamePackSchema,
  LocalStorageAdapter,
  SlidePuzzle,
} from "@stoutalligator/engine";
import type {
  GamePack,
  GameResult,
  SlidePuzzleDifficulty,
  SlidePuzzleTheme,
  Theme,
} from "@stoutalligator/engine";
import { useState } from "react";

// ── Static imports of the canonical packs (single source of truth) ──────────
// Vite resolves JSON imports natively; TypeScript resolveJsonModule handles types.
import pack1Raw from "../../../packs/sample_pack_1.json";
import pack2Raw from "../../../packs/sample_pack_2.json";
import pack3Raw from "../../../packs/sample_pack_3.json";

import styles from "./App.module.css";

// ---------------------------------------------------------------------------
// Pack registry for the selector
// ---------------------------------------------------------------------------
const PACK_OPTIONS = [
  { label: "Easy — Duration Sensitivity (2026-03-01)", raw: pack1Raw },
  { label: "Medium — Frequency vs Severity (2026-03-02)", raw: pack2Raw },
  { label: "Hard — Benefit Design Shift (2026-03-03)", raw: pack3Raw },
];

// One shared storage adapter (key is scoped per packId inside the engine)
const storage = new LocalStorageAdapter();

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
export function App() {
  const [activeTab, setActiveTab] = useState<"assumption" | "slide" | "nonogram">("slide");

  // ── Nonogram controls ──
  const [nonogramDate, setNonogramDate] = useState<string>("");

  // ── Slide Puzzle controls ──
  const [slideDifficulty, setSlideDifficulty] = useState<SlidePuzzleDifficulty>("medium");
  const [slideTheme, setSlideTheme] = useState<SlidePuzzleTheme>("modern");
  const [slideDate, setSlideDate] = useState<string>("");

  // ── Assumption Drift controls ──
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [theme, setTheme] = useState<Theme>("modern");
  const [activePack, setActivePack] = useState<GamePack | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [result, setResult] = useState<GameResult | null>(null);

  const handleStart = () => {
    setResult(null);
    setValidationErrors([]);
    setActivePack(null);

    const raw = PACK_OPTIONS[selectedIndex]?.raw;
    const parseResult = GamePackSchema.safeParse(raw);

    if (!parseResult.success) {
      const messages = parseResult.error.issues.map(
        (issue: { path: (string | number)[]; message: string }) =>
          `[${issue.path.join(".")}] ${issue.message}`,
      );
      setValidationErrors(messages);
      return;
    }

    setActivePack(parseResult.data);
  };

  const handleComplete = (gameResult: GameResult) => {
    setResult(gameResult);
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.heading}>Atlas Game Engine Demo</h1>
        <p className={styles.subtitle}>Interactive game demos</p>
      </header>

      {/* ── Tab navigation ── */}
      <nav className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "slide" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("slide")}
        >
          🎯 Slide Puzzle
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "assumption" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("assumption")}
        >
          📊 Assumption Drift
        </button>
        <button
          type="button"
          className={`${styles.tab} ${activeTab === "nonogram" ? styles.tabActive : ""}`}
          onClick={() => setActiveTab("nonogram")}
        >
          🟫 Nonogram
        </button>
      </nav>

      <main className={styles.main}>
        {/* ── Slide Puzzle tab ── */}
        {activeTab === "slide" && (
          <section className={styles.gameWrapper}>
            {/* Controls */}
            <section className={styles.selector}>
              <div className={styles.selectorRow}>
                <div className={styles.selectorField}>
                  <label className={styles.selectLabel} htmlFor="slide-difficulty">
                    Difficulty
                  </label>
                  <select
                    id="slide-difficulty"
                    className={styles.select}
                    value={slideDifficulty}
                    onChange={(e) => setSlideDifficulty(e.target.value as SlidePuzzleDifficulty)}
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>

                <div className={styles.selectorField}>
                  <label className={styles.selectLabel} htmlFor="slide-theme">
                    Theme
                  </label>
                  <select
                    id="slide-theme"
                    className={styles.select}
                    value={slideTheme}
                    onChange={(e) => setSlideTheme(e.target.value as SlidePuzzleTheme)}
                  >
                    <option value="modern">Modern</option>
                    <option value="8bit">8-Bit</option>
                    <option value="terminal">Terminal</option>
                  </select>
                </div>

                <div className={styles.selectorField}>
                  <label className={styles.selectLabel} htmlFor="slide-date">
                    Date (daily puzzle)
                  </label>
                  <input
                    id="slide-date"
                    type="date"
                    className={styles.select}
                    value={slideDate}
                    onChange={(e) => setSlideDate(e.target.value)}
                    placeholder="optional"
                  />
                </div>
              </div>
            </section>

            {/* Game — key forces remount when difficulty or date changes */}
            <SlidePuzzle
              key={`${slideDate}-${slideDifficulty}`}
              difficulty={slideDifficulty}
              theme={slideTheme}
              date={slideDate || undefined}
            />
          </section>
        )}

        {/* ── Assumption Drift tab ── */}
        {activeTab === "assumption" && (
          <>
            {/* Pack + theme selector */}
            <section className={styles.selector}>
              <div className={styles.selectorRow}>
                <div className={styles.selectorField}>
                  <label className={styles.selectLabel} htmlFor="pack-select">
                    Pack
                  </label>
                  <select
                    id="pack-select"
                    className={styles.select}
                    value={selectedIndex}
                    onChange={(e) => {
                      setSelectedIndex(Number(e.target.value));
                      setActivePack(null);
                      setValidationErrors([]);
                      setResult(null);
                    }}
                  >
                    {PACK_OPTIONS.map((opt, i) => (
                      <option key={opt.label} value={i}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.selectorField}>
                  <label className={styles.selectLabel} htmlFor="theme-select">
                    Theme
                  </label>
                  <select
                    id="theme-select"
                    className={styles.select}
                    value={theme}
                    onChange={(e) => setTheme(e.target.value as Theme)}
                  >
                    <option value="modern">Modern</option>
                    <option value="8bit">8-Bit</option>
                    <option value="terminal">Terminal</option>
                  </select>
                </div>

                <button type="button" className={styles.startButton} onClick={handleStart}>
                  {activePack ? "Restart" : "Start"}
                </button>
              </div>
            </section>

            {/* Validation errors */}
            {validationErrors.length > 0 && (
              <section className={styles.errorBox}>
                <strong>Pack validation failed:</strong>
                <ul>
                  {validationErrors.map((msg) => (
                    <li key={msg}>{msg}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Game */}
            {activePack && (
              <section className={styles.gameWrapper}>
                <DailyGame
                  key={`${activePack.packId}-${theme}`}
                  pack={activePack}
                  storage={storage}
                  onComplete={handleComplete}
                  theme={theme}
                />
              </section>
            )}

            {/* Result debug output */}
            {result && (
              <section className={styles.resultSection}>
                <h2 className={styles.resultHeading}>GameResult (debug)</h2>
                <pre className={styles.resultPre}>{JSON.stringify(result, null, 2)}</pre>
              </section>
            )}
          </>
        )}
        {/* ── Nonogram tab ── */}
        {activeTab === "nonogram" && (
          <>
            <section className={styles.selector}>
              <div className={styles.selectorRow}>
                <div className={styles.selectorField}>
                  <label className={styles.selectLabel} htmlFor="nonogram-date">
                    Date (daily puzzle)
                  </label>
                  <input
                    id="nonogram-date"
                    type="date"
                    className={styles.select}
                    value={nonogramDate}
                    onChange={(e) => setNonogramDate(e.target.value)}
                    placeholder="optional"
                  />
                </div>
              </div>
            </section>
            <iframe
              key={nonogramDate}
              src={nonogramDate ? `/nonogram?date=${nonogramDate}` : "/nonogram"}
              title="Nonogram Puzzle"
              className={styles.nonogramFrame}
            />
          </>
        )}
      </main>
    </div>
  );
}
