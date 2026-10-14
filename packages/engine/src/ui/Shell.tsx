import { type ButtonHTMLAttributes, type ReactNode, useEffect, useState } from "react";
import { getGameInfo } from "../catalog.js";
import { formatClock, formatDateLabel, msUntilLocalMidnight, puzzleNumber } from "../core/daily.js";
import type { GameId, GameStat, GameStats } from "../core/types.js";

type Variant = "default" | "primary" | "accent" | "ghost";

export function Button({
  variant = "default",
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`ag-btn ag-btn--${variant}${className ? ` ${className}` : ""}`}
      {...rest}
    />
  );
}

const helpSeenKey = (game: GameId) => `atlas-games:v2:${game}:help-seen`;

interface GameShellProps {
  game: GameId;
  date: string;
  /** Live numbers shown in the top bar (time, moves…). */
  chips?: GameStat[];
  /** Extra buttons, e.g. Undo / Reset. */
  actions?: ReactNode;
  /** Line under the bar, e.g. "Target premium 12". */
  banner?: ReactNode;
  children: ReactNode;
}

export function GameShell({ game, date, chips = [], actions, banner, children }: GameShellProps) {
  const info = getGameInfo(game);
  const [helpOpen, setHelpOpen] = useState(false);

  // First visit: open the rules once.
  useEffect(() => {
    try {
      if (!localStorage.getItem(helpSeenKey(game))) {
        setHelpOpen(true);
        localStorage.setItem(helpSeenKey(game), "1");
      }
    } catch {
      // storage unavailable
    }
  }, [game]);

  return (
    <div className="ag-root" data-accent={info.accent}>
      <div className="ag-bar">
        <div className="ag-bar__id">
          <span className="ag-tag">#{puzzleNumber(date)}</span>
          <span className="ag-bar__date">{formatDateLabel(date)}</span>
        </div>
        {chips.length > 0 && (
          <div className="ag-chips">
            {chips.map((c) => (
              <span key={c.label} className="ag-chip">
                <span className="ag-chip__label">{c.label}</span>
                <span className="ag-chip__value">{c.value}</span>
              </span>
            ))}
          </div>
        )}
        <div className="ag-bar__actions">
          {actions}
          <Button variant="ghost" aria-expanded={helpOpen} onClick={() => setHelpOpen((v) => !v)}>
            {helpOpen ? "Hide rules" : "How to play"}
          </Button>
        </div>
      </div>

      {helpOpen && (
        <div className="ag-help">
          <div className="ag-help__title">How to play</div>
          <ol className="ag-help__list">
            {info.howToPlay.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
        </div>
      )}

      {banner && <div className="ag-banner">{banner}</div>}

      <div className="ag-stage">{children}</div>
    </div>
  );
}

export function GameLoading() {
  return (
    <div className="ag-root ag-loading" aria-busy="true">
      <div className="ag-loading__bar" />
      <div className="ag-loading__board" />
    </div>
  );
}

export function Countdown() {
  const [ms, setMs] = useState(() => msUntilLocalMidnight());
  useEffect(() => {
    const id = window.setInterval(() => setMs(msUntilLocalMidnight()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return (
    <span className="ag-countdown">
      {hh}:{mm}:{ss}
    </span>
  );
}

interface ResultPanelProps {
  solved: boolean;
  headline: string;
  detail?: ReactNode;
  stats: GameStat[];
  shareText: string;
  history: GameStats;
  children?: ReactNode;
}

export function ResultPanel({
  solved,
  headline,
  detail,
  stats,
  shareText,
  history,
  children,
}: ResultPanelProps) {
  const [copied, setCopied] = useState(false);

  const share = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy your result:", shareText);
    }
  };

  return (
    <section className="ag-result" data-solved={solved} aria-live="polite">
      <div className="ag-result__tab">{solved ? "CLEARED" : "DONE FOR TODAY"}</div>
      <div className="ag-result__head">
        <div>
          <div className="ag-result__headline">{headline}</div>
          {detail && <div className="ag-result__detail">{detail}</div>}
        </div>
        <Button variant="primary" onClick={share}>
          {copied ? "Copied ✓" : "Share result"}
        </Button>
      </div>

      {stats.length > 0 && (
        <div className="ag-result__stats">
          {stats.map((s) => (
            <div key={s.label} className="ag-stat">
              <div className="ag-stat__value">{s.value}</div>
              <div className="ag-stat__label">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {children}

      <div className="ag-result__foot">
        <div className="ag-streaks">
          <Streak label="Played" value={history.played} />
          <Streak label="Solve %" value={history.solveRate} />
          <Streak label="Streak" value={history.currentStreak} />
          <Streak label="Best" value={history.maxStreak} />
        </div>
        <div className="ag-next">
          <span className="ag-next__label">Next puzzle in</span>
          <Countdown />
        </div>
      </div>
    </section>
  );
}

function Streak({ label, value }: { label: string; value: number }) {
  return (
    <div className="ag-streak">
      <div className="ag-streak__value">{value}</div>
      <div className="ag-streak__label">{label}</div>
    </div>
  );
}

export { formatClock };
