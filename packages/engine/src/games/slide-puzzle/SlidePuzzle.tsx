import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./SlidePuzzle.module.css";

// ── Types ──────────────────────────────────────────────────────────────────

type PieceColor = "person" | "orange" | "blue" | "green" | "purple" | "black";
type Direction = "up" | "down" | "left" | "right";
type GateSide = "top" | "bottom" | "left" | "right";

interface Piece {
  id: string;
  color: PieceColor;
  col: number; // top-left column
  row: number; // top-left row
  width: number; // cells wide
  height: number; // cells tall
  immovable: boolean;
}

interface Gate {
  side: GateSide;
  /** Column index for top/bottom gates; row index for left/right gates */
  index: number;
}

interface PuzzleConfig {
  gridWidth: number;
  gridHeight: number;
  /** Set of "row,col" strings representing valid grid cells */
  validCells: Set<string>;
  pieces: Piece[];
  gate: Gate;
}

// ── Constants ──────────────────────────────────────────────────────────────

const CELL = 68; // px per cell
const GAP = 4; // px gap between cells
const BORDER = 5; // px border thickness

// Scramble tuning constants
const MIN_SCRAMBLE_MOVES = 40; // minimum random moves applied when generating a puzzle
const SCRAMBLE_MOVES_RANGE = 30; // random extra moves added on top of the minimum
const MAX_MOVE_ATTEMPTS = 50; // retry limit when searching for a valid scramble move

// ── Utility helpers ────────────────────────────────────────────────────────

let _uid = 0;
const nextId = (prefix: string) => `${prefix}-${++_uid}`;

const ck = (r: number, c: number) => `${r},${c}`;

function makeRectGrid(w: number, h: number): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) s.add(ck(r, c));
  return s;
}

/**
 * L-shape: full w×h minus top-right corner of size (cutW × cutH).
 */
function makeLGrid(w: number, h: number, cutW: number, cutH: number): Set<string> {
  const s = new Set<string>();
  for (let r = 0; r < h; r++)
    for (let c = 0; c < w; c++) if (!(r < cutH && c >= w - cutW)) s.add(ck(r, c));
  return s;
}

function isGateExit(gate: Gate, gw: number, gh: number, r: number, c: number): boolean {
  switch (gate.side) {
    case "top":
      return r === -1 && c === gate.index;
    case "bottom":
      return r === gh && c === gate.index;
    case "left":
      return c === -1 && r === gate.index;
    case "right":
      return c === gw && r === gate.index;
  }
}

function buildOccupancy(pieces: Piece[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of pieces)
    for (let c = p.col; c < p.col + p.width; c++)
      for (let r = p.row; r < p.row + p.height; r++) m.set(ck(r, c), p.id);
  return m;
}

// ── Movement logic ─────────────────────────────────────────────────────────

function canMove(cfg: PuzzleConfig, pieceId: string, dir: Direction): boolean {
  const piece = cfg.pieces.find((p) => p.id === pieceId);
  if (!piece || piece.immovable) return false;

  const dx = dir === "right" ? 1 : dir === "left" ? -1 : 0;
  const dy = dir === "down" ? 1 : dir === "up" ? -1 : 0;

  const nr = piece.row + dy;
  const nc = piece.col + dx;
  const isPerson = piece.color === "person";
  const occ = buildOccupancy(cfg.pieces);

  for (let c = nc; c < nc + piece.width; c++) {
    for (let r = nr; r < nr + piece.height; r++) {
      // This cell was already occupied by the current piece — OK
      if (
        c >= piece.col &&
        c < piece.col + piece.width &&
        r >= piece.row &&
        r < piece.row + piece.height
      )
        continue;

      // Gate exit cell: only the person may enter
      if (isGateExit(cfg.gate, cfg.gridWidth, cfg.gridHeight, r, c)) {
        if (!isPerson) return false;
        continue;
      }

      // Must be a valid grid cell
      if (!cfg.validCells.has(ck(r, c))) return false;

      // Must not be occupied by another piece
      const occupant = occ.get(ck(r, c));
      if (occupant && occupant !== pieceId) return false;
    }
  }

  return true;
}

function applyMove(cfg: PuzzleConfig, pieceId: string, dir: Direction): PuzzleConfig {
  const dx = dir === "right" ? 1 : dir === "left" ? -1 : 0;
  const dy = dir === "down" ? 1 : dir === "up" ? -1 : 0;
  return {
    ...cfg,
    pieces: cfg.pieces.map((p) =>
      p.id === pieceId ? { ...p, col: p.col + dx, row: p.row + dy } : p,
    ),
  };
}

function hasWon(cfg: PuzzleConfig): boolean {
  const person = cfg.pieces.find((p) => p.color === "person");
  if (!person) return false;
  return isGateExit(cfg.gate, cfg.gridWidth, cfg.gridHeight, person.row, person.col);
}

// ── Puzzle generator ───────────────────────────────────────────────────────

interface PieceDef {
  color: PieceColor;
  w: number;
  h: number;
  immovable?: boolean;
}

interface Template {
  gw: number;
  gh: number;
  cells: Set<string>;
  gate: Gate;
  pieces: PieceDef[];
}

function makeTemplates(): Template[] {
  return [
    // 7×7, gate right
    {
      gw: 7,
      gh: 7,
      cells: makeRectGrid(7, 7),
      gate: { side: "right", index: 6 },
      pieces: [
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "blue", w: 1, h: 2 },
        { color: "blue", w: 2, h: 1 },
        { color: "green", w: 1, h: 3 },
        { color: "purple", w: 3, h: 3 },
        { color: "black", w: 1, h: 1, immovable: true },
        { color: "black", w: 2, h: 1, immovable: true },
      ],
    },
    // 7×7, gate bottom
    {
      gw: 7,
      gh: 7,
      cells: makeRectGrid(7, 7),
      gate: { side: "bottom", index: 3 },
      pieces: [
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "blue", w: 1, h: 2 },
        { color: "blue", w: 2, h: 1 },
        { color: "green", w: 3, h: 1 },
        { color: "green", w: 1, h: 3 },
        { color: "purple", w: 3, h: 3 },
        { color: "black", w: 1, h: 1, immovable: true },
        { color: "black", w: 1, h: 2, immovable: true },
      ],
    },
    // 5×5, gate right
    {
      gw: 5,
      gh: 5,
      cells: makeRectGrid(5, 5),
      gate: { side: "right", index: 2 },
      pieces: [
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "blue", w: 1, h: 2 },
        { color: "green", w: 1, h: 3 },
        { color: "black", w: 1, h: 1, immovable: true },
      ],
    },
    // 8×6, gate bottom
    {
      gw: 8,
      gh: 6,
      cells: makeRectGrid(8, 6),
      gate: { side: "bottom", index: 5 },
      pieces: [
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "blue", w: 2, h: 1 },
        { color: "blue", w: 1, h: 2 },
        { color: "green", w: 3, h: 1 },
        { color: "purple", w: 3, h: 3 },
        { color: "black", w: 1, h: 1, immovable: true },
        { color: "black", w: 2, h: 1, immovable: true },
      ],
    },
    // 7×7 L-shape (cut top-right 3×3), gate right
    {
      gw: 7,
      gh: 7,
      cells: makeLGrid(7, 7, 3, 3),
      gate: { side: "right", index: 5 },
      pieces: [
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "blue", w: 1, h: 2 },
        { color: "blue", w: 2, h: 1 },
        { color: "green", w: 1, h: 3 },
        { color: "black", w: 1, h: 1, immovable: true },
      ],
    },
    // 6×6, gate left
    {
      gw: 6,
      gh: 6,
      cells: makeRectGrid(6, 6),
      gate: { side: "left", index: 3 },
      pieces: [
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "blue", w: 2, h: 1 },
        { color: "blue", w: 1, h: 2 },
        { color: "green", w: 1, h: 3 },
        { color: "purple", w: 3, h: 3 },
        { color: "black", w: 1, h: 1, immovable: true },
      ],
    },
    // 7×7, gate top
    {
      gw: 7,
      gh: 7,
      cells: makeRectGrid(7, 7),
      gate: { side: "top", index: 2 },
      pieces: [
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "orange", w: 1, h: 1 },
        { color: "blue", w: 2, h: 1 },
        { color: "blue", w: 1, h: 2 },
        { color: "green", w: 3, h: 1 },
        { color: "green", w: 1, h: 3 },
        { color: "purple", w: 3, h: 3 },
        { color: "black", w: 1, h: 1, immovable: true },
        { color: "black", w: 1, h: 2, immovable: true },
      ],
    },
  ];
}

/**
 * Try to find a valid top-left position (col, row) for a piece of size w×h
 * within validCells, avoiding already-occupied cells.
 */
function tryPlace(
  cells: Set<string>,
  occupied: Set<string>,
  w: number,
  h: number,
): { col: number; row: number } | null {
  const candidates: { row: number; col: number }[] = [];

  for (const k of cells) {
    const [r, c] = k.split(",").map(Number);
    let fits = true;
    for (let dc = 0; dc < w && fits; dc++)
      for (let dr = 0; dr < h && fits; dr++)
        if (!cells.has(ck(r + dr, c + dc)) || occupied.has(ck(r + dr, c + dc))) fits = false;
    if (fits) candidates.push({ row: r, col: c });
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Generate a solvable puzzle by:
 * 1. Placing pieces (person adjacent to gate, others randomly).
 * 2. Scrambling via N random valid moves (guarantees solvability by reversal).
 */
export function generatePuzzle(): PuzzleConfig {
  const TEMPLATES = makeTemplates();
  const tmpl = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const { gw, gh, cells, gate, pieces: defs } = tmpl;

  const pieces: Piece[] = [];
  const occupied = new Set<string>();

  // Place person adjacent to the gate (one step inside the grid)
  let pCol = 0;
  let pRow = 0;
  switch (gate.side) {
    case "right":
      pCol = gw - 1;
      pRow = gate.index;
      break;
    case "left":
      pCol = 0;
      pRow = gate.index;
      break;
    case "top":
      pCol = gate.index;
      pRow = 0;
      break;
    case "bottom":
      pCol = gate.index;
      pRow = gh - 1;
      break;
  }

  pieces.push({
    id: "person",
    color: "person",
    col: pCol,
    row: pRow,
    width: 1,
    height: 1,
    immovable: false,
  });
  occupied.add(ck(pRow, pCol));

  // Place remaining pieces
  for (const def of defs) {
    const pos = tryPlace(cells, occupied, def.w, def.h);
    if (!pos) continue;

    pieces.push({
      id: nextId(def.color),
      color: def.color,
      col: pos.col,
      row: pos.row,
      width: def.w,
      height: def.h,
      immovable: def.immovable ?? false,
    });
    for (let dc = 0; dc < def.w; dc++)
      for (let dr = 0; dr < def.h; dr++) occupied.add(ck(pos.row + dr, pos.col + dc));
  }

  let cfg: PuzzleConfig = { gridWidth: gw, gridHeight: gh, validCells: cells, pieces, gate };

  // Scramble: random valid moves (guarantees solvability)
  const nMoves = MIN_SCRAMBLE_MOVES + Math.floor(Math.random() * SCRAMBLE_MOVES_RANGE);
  const DIRS: Direction[] = ["up", "down", "left", "right"];
  let lastId: string | null = null;

  for (let i = 0; i < nMoves; i++) {
    const movable = cfg.pieces.filter((p) => !p.immovable);

    for (let attempt = 0; attempt < MAX_MOVE_ATTEMPTS; attempt++) {
      const p = movable[Math.floor(Math.random() * movable.length)];
      const dir = DIRS[Math.floor(Math.random() * DIRS.length)];

      if (p.id === lastId) continue;
      if (!canMove(cfg, p.id, dir)) continue;

      // Do not let the person exit through the gate during scrambling
      if (p.color === "person") {
        const dx = dir === "right" ? 1 : dir === "left" ? -1 : 0;
        const dy = dir === "down" ? 1 : dir === "up" ? -1 : 0;
        if (isGateExit(gate, gw, gh, p.row + dy, p.col + dx)) continue;
      }

      cfg = applyMove(cfg, p.id, dir);
      lastId = p.id;
      break;
    }
  }

  return cfg;
}

// ── Rendering helpers ──────────────────────────────────────────────────────

function cellToXY(c: number, r: number): { left: number; top: number } {
  return { left: c * (CELL + GAP), top: r * (CELL + GAP) };
}

function pieceCSS(p: Piece): React.CSSProperties {
  return {
    left: p.col * (CELL + GAP),
    top: p.row * (CELL + GAP),
    width: p.width * CELL + (p.width - 1) * GAP,
    height: p.height * CELL + (p.height - 1) * GAP,
  };
}

type Seg = { key: string; style: React.CSSProperties };

/** Render four border strips with a gap at the gate position. */
function borderSegments(cfg: PuzzleConfig): Seg[] {
  const { gate, gridWidth: gw, gridHeight: gh } = cfg;
  const step = CELL + GAP;
  const totalW = gw * step - GAP;
  const totalH = gh * step - GAP;
  const gateStart = gate.index * step;
  const gateEnd = gateStart + CELL;
  const B = BORDER;

  const base: React.CSSProperties = { position: "absolute", background: "#1a1a2e" };

  const seg = (key: string, style: React.CSSProperties): Seg => ({
    key,
    style: { ...base, ...style },
  });

  const segs: Seg[] = [];

  // Top
  if (gate.side === "top") {
    if (gateStart > 0) segs.push(seg("t1", { top: -B, left: -B, width: gateStart + B, height: B }));
    if (gateEnd < totalW) segs.push(seg("t2", { top: -B, left: gateEnd, right: -B, height: B }));
  } else {
    segs.push(seg("t", { top: -B, left: -B, width: totalW + 2 * B, height: B }));
  }

  // Bottom
  if (gate.side === "bottom") {
    if (gateStart > 0)
      segs.push(seg("b1", { bottom: -B, left: -B, width: gateStart + B, height: B }));
    if (gateEnd < totalW) segs.push(seg("b2", { bottom: -B, left: gateEnd, right: -B, height: B }));
  } else {
    segs.push(seg("b", { bottom: -B, left: -B, width: totalW + 2 * B, height: B }));
  }

  // Left
  if (gate.side === "left") {
    if (gateStart > 0) segs.push(seg("l1", { top: 0, left: -B, width: B, height: gateStart }));
    if (gateEnd < totalH)
      segs.push(seg("l2", { top: gateEnd, left: -B, width: B, height: totalH - gateEnd }));
  } else {
    segs.push(seg("l", { top: 0, left: -B, width: B, height: totalH }));
  }

  // Right
  if (gate.side === "right") {
    if (gateStart > 0) segs.push(seg("r1", { top: 0, right: -B, width: B, height: gateStart }));
    if (gateEnd < totalH)
      segs.push(seg("r2", { top: gateEnd, right: -B, width: B, height: totalH - gateEnd }));
  } else {
    segs.push(seg("r", { top: 0, right: -B, width: B, height: totalH }));
  }

  return segs;
}

/** Position and text for the gate exit arrow. */
function gateArrowStyle(cfg: PuzzleConfig): React.CSSProperties {
  const { gate } = cfg;
  const step = CELL + GAP;
  const pos = gate.index * step + CELL / 2 - 12; // center on gate cell

  switch (gate.side) {
    case "right":
      return { right: -(BORDER + 32), top: pos };
    case "left":
      return { left: -(BORDER + 32), top: pos };
    case "top":
      return { top: -(BORDER + 32), left: pos };
    case "bottom":
      return { bottom: -(BORDER + 32), left: pos };
    default: {
      // TypeScript doesn't narrow exhaustive unions in all cases; this is unreachable at runtime.
      const _exhaustive: never = gate.side;
      throw new Error(`Unhandled gate side: ${_exhaustive}`);
    }
  }
}

const ARROW_CHAR: Record<GateSide, string> = { top: "↑", bottom: "↓", left: "←", right: "→" };

// ── Component ──────────────────────────────────────────────────────────────

/** Standalone slide-puzzle game — no external pack or storage required. */
export function SlidePuzzle() {
  const [cfg, setCfg] = useState<PuzzleConfig>(() => generatePuzzle());
  const [selected, setSelected] = useState<string | null>(null);
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [won, setWon] = useState(false);

  // Refs for stable callbacks
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const wonRef = useRef(won);
  wonRef.current = won;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // Timer
  useEffect(() => {
    if (won) return;
    const id = setInterval(() => setElapsed((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [won]);

  // ── Stable move handler (uses refs to avoid stale closures) ───────────────
  const move = useCallback((pieceId: string, dir: Direction) => {
    if (wonRef.current) return;
    const current = cfgRef.current;
    if (!canMove(current, pieceId, dir)) return;
    const next = applyMove(current, pieceId, dir);
    setCfg(next);
    setMoves((m) => m + 1);
    if (hasWon(next)) setWon(true);
  }, []);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const sel = selectedRef.current;
      if (!sel) return;
      const dirMap: Record<string, Direction> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
      };
      const dir = dirMap[e.key];
      if (dir) {
        e.preventDefault();
        move(sel, dir);
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [move]);

  // ── Drag handling ─────────────────────────────────────────────────────────
  const drag = useRef<{ id: string; sx: number; sy: number } | null>(null);

  useEffect(() => {
    const STEP = CELL + GAP;

    const handleMouseMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const { id, sx, sy } = drag.current;
      const dx = e.clientX - sx;
      const dy = e.clientY - sy;

      if (Math.abs(dx) >= STEP || Math.abs(dy) >= STEP) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          const steps = Math.trunc(dx / STEP);
          const dir: Direction = steps > 0 ? "right" : "left";
          const n = Math.abs(steps);
          for (let i = 0; i < n; i++) move(id, dir);
          drag.current = { id, sx: e.clientX - (dx % STEP), sy: e.clientY };
        } else {
          const steps = Math.trunc(dy / STEP);
          const dir: Direction = steps > 0 ? "down" : "up";
          const n = Math.abs(steps);
          for (let i = 0; i < n; i++) move(id, dir);
          drag.current = { id, sx: e.clientX, sy: e.clientY - (dy % STEP) };
        }
      }
    };

    const handleMouseUp = () => {
      drag.current = null;
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [move]);

  // ── New puzzle ────────────────────────────────────────────────────────────
  const handleNew = () => {
    setCfg(generatePuzzle());
    setSelected(null);
    setMoves(0);
    setElapsed(0);
    setWon(false);
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const boardW = cfg.gridWidth * (CELL + GAP) - GAP;
  const boardH = cfg.gridHeight * (CELL + GAP) - GAP;
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const segs = borderSegments(cfg);
  const arrowSt = gateArrowStyle(cfg);
  const arrowChar = ARROW_CHAR[cfg.gate.side];

  return (
    <div className={styles.container}>
      {/* ── Header ── */}
      <div className={styles.header}>
        <h1 className={styles.title}>Slide Puzzle</h1>

        <div className={styles.statsRow}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Time</span>
            <span className={styles.statValue}>
              {mm}:{ss}
            </span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Moves</span>
            <span className={styles.statValue}>{moves}</span>
          </div>
        </div>

        <button type="button" className={styles.newBtn} onClick={handleNew}>
          Generate New Puzzle
        </button>
      </div>

      {/* ── Status messages ── */}
      {won ? (
        <div className={styles.winBanner}>🎉 Puzzle Solved! {moves} moves</div>
      ) : selected ? (
        <p className={styles.hint}>Arrow keys or drag to move · click again to deselect</p>
      ) : (
        <p className={styles.hint}>Click a piece to select it</p>
      )}

      {/* ── Board ── */}
      <div className={styles.boardOuter}>
        <div
          className={styles.board}
          style={{ width: boardW, height: boardH }}
          // Deselect when clicking empty board area
          onClick={() => setSelected(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSelected(null);
          }}
          role="application"
          aria-label="Slide puzzle board"
          tabIndex={-1}
        >
          {/* Manual border segments with gate gap */}
          {segs.map((s) => (
            <div key={s.key} style={s.style} />
          ))}

          {/* Gate exit arrow */}
          <div className={styles.gateArrow} style={arrowSt}>
            {arrowChar}
          </div>

          {/* Background grid cells */}
          {[...cfg.validCells].map((k) => {
            const [r, c] = k.split(",").map(Number);
            const pos = cellToXY(c, r);
            return (
              <div key={k} className={styles.cell} style={{ ...pos, width: CELL, height: CELL }} />
            );
          })}

          {/* Pieces */}
          {cfg.pieces.map((p) => {
            const colorClass = styles[`piece${p.color.charAt(0).toUpperCase()}${p.color.slice(1)}`];
            const isSelected = p.id === selected;
            const cls = [
              styles.piece,
              colorClass,
              isSelected ? styles.pieceSelected : "",
              p.immovable ? styles.pieceImmovable : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={p.id}
                className={cls}
                style={pieceCSS(p)}
                role={p.immovable ? undefined : "button"}
                tabIndex={p.immovable ? undefined : 0}
                aria-label={`${p.color} piece`}
                aria-pressed={p.id === selected}
                onClick={(e) => {
                  e.stopPropagation();
                  if (p.immovable || won) return;
                  setSelected((prev) => (prev === p.id ? null : p.id));
                }}
                onKeyDown={(e) => {
                  if (p.immovable || won) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelected((prev) => (prev === p.id ? null : p.id));
                  }
                }}
                onMouseDown={(e) => {
                  if (p.immovable || won) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(p.id);
                  drag.current = { id: p.id, sx: e.clientX, sy: e.clientY };
                }}
              >
                {p.color === "person" && (
                  <svg
                    viewBox="0 0 32 32"
                    className={styles.personSvg}
                    role="img"
                    aria-label="Person"
                  >
                    <title>Person</title>
                    <circle cx="16" cy="9" r="6" fill="#2d2d2d" />
                    <path
                      d="M6 28 C6 20 26 20 26 28"
                      fill="#2d2d2d"
                      stroke="#2d2d2d"
                      strokeWidth="1"
                    />
                    <rect x="13" y="14" width="6" height="8" rx="1" fill="#444" />
                    <line x1="13" y1="16" x2="13" y2="22" stroke="#666" strokeWidth="1.5" />
                    <line x1="19" y1="16" x2="19" y2="22" stroke="#666" strokeWidth="1.5" />
                    <line x1="16" y1="17" x2="16" y2="19" stroke="#888" strokeWidth="1" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: "#e8e8f0" }} />
          Person
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: "#f4a261" }} />
          Movable box
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} style={{ background: "#2d2d2d" }} />
          Immovable
        </span>
        <span className={styles.legendItem}>
          <span
            className={styles.legendSwatch}
            style={{ background: "#4ade80", border: "2px solid #16a34a" }}
          />
          Gate (exit)
        </span>
      </p>
    </div>
  );
}
