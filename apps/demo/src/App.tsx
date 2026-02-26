import { DailyGame, GamePackSchema, LocalStorageAdapter } from "@stoutalligator/engine";
import type { GamePack, GameResult, Theme } from "@stoutalligator/engine";
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
        <h1 className={styles.heading}>Assumption Drift</h1>
        <p className={styles.subtitle}>Daily game engine demo</p>
      </header>

      <main className={styles.main}>
        {/* ── Pack + theme selector ── */}
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
                  <option key={i} value={i}>
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

            <button
              type="button"
              className={styles.startButton}
              onClick={handleStart}
            >
              {activePack ? "Restart" : "Start"}
            </button>
          </div>
        </section>

        {/* ── Validation errors ── */}
        {validationErrors.length > 0 && (
          <section className={styles.errorBox}>
            <strong>Pack validation failed:</strong>
            <ul>
              {validationErrors.map((msg, i) => (
                <li key={i}>{msg}</li>
              ))}
            </ul>
          </section>
        )}

        {/* ── Game ── */}
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

        {/* ── Result debug output ── */}
        {result && (
          <section className={styles.resultSection}>
            <h2 className={styles.resultHeading}>GameResult (debug)</h2>
            <pre className={styles.resultPre}>{JSON.stringify(result, null, 2)}</pre>
          </section>
        )}
      </main>
    </div>
  );
}
