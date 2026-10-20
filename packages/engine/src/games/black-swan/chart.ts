// Canvas drawing for Black Swan. The chart is the same picture for every
// prompt: a fixed long-tail density f(x) ∝ e^(−kx) on [0, 1], drawn as columns
// of ~1000 falling dots. x is rarity; the area left of x is the share of
// guesses more common than x, so a player's answer at percentile p lands at
// x = F⁻¹(p). Colours come from CSS custom properties on the canvas.

import { BLACK_SWAN_TIERS, type BlackSwanTierKey, tierFor } from "./logic.js";

const DOTS = 1000;
const K = 3.2;
const Fcdf = (x: number) => (1 - Math.exp(-K * x)) / (1 - Math.exp(-K));
export const rarityToX = (p: number) => -Math.log(1 - Math.min(0.9999, p) * (1 - Math.exp(-K))) / K;

const TIER_VAR: Record<BlackSwanTierKey, string> = {
  mode: "--ag-bs-mode",
  expected: "--ag-bs-expected",
  sigma: "--ag-bs-sigma",
  tail: "--ag-bs-tail",
  swan: "--ag-bs-swan",
};

type Ctx = CanvasRenderingContext2D;

interface Palette {
  get: (name: string) => string;
  tier: (key: BlackSwanTierKey) => string;
  font: string;
}

function palette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const get = (name: string) => cs.getPropertyValue(name).trim() || "#64748b";
  return { get, tier: (k) => get(TIER_VAR[k]), font: cs.fontFamily || "system-ui, sans-serif" };
}

function setup(cv: HTMLCanvasElement, h: number) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || cv.parentElement?.clientWidth || 600;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.height = `${h}px`;
  const ctx = cv.getContext("2d") as Ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

const caps = (s: string) => s.toUpperCase().replace("Σ", "σ");

function dot(ctx: Ctx, x: number, y: number, r: number, fill: string, ring?: string) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (ring) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = ring;
    ctx.stroke();
  }
}

interface Column {
  x: number;
  w: number;
  count: number;
  share: number;
  tier: BlackSwanTierKey;
  lo: number;
  hi: number;
}

interface Layout {
  cols: Column[];
  top: number;
  base: number;
  padX: number;
  gap: number;
  d: number;
  perRow: number;
  slot: (col: Column, k: number) => { x: number; y: number };
  colFor: (p: number) => Column;
}

function layout(w: number, h: number): Layout {
  const COLS = w < 520 ? 16 : 30;
  const padX = 12;
  const top = 24;
  const axis = 34;
  const gap = 2;
  const plotH = h - top - axis;
  const colW = (w - padX * 2 - gap * (COLS - 1)) / COLS;
  const raw = Array.from({ length: COLS }, (_, i) => {
    const xc = (i + 0.5) / COLS;
    return {
      share: Math.exp(-K * xc),
      tier: tierFor(Fcdf(xc)).key,
      lo: i / COLS,
      hi: (i + 1) / COLS,
    };
  });
  const totalShare = raw.reduce((t, c) => t + c.share, 0);
  const tallest = (DOTS * raw[0].share) / totalShare;
  // Same dot budget every time; dot size flexes so the tallest column fills the height.
  const d = Math.max(2.5, Math.min(11, colW / 2, Math.sqrt((plotH * colW) / tallest)));
  const perRow = Math.max(1, Math.floor(colW / d));
  const N = Math.min(DOTS / totalShare, (((plotH - d) / d) * perRow) / raw[0].share);
  const cols = raw.map((c, i) => ({
    ...c,
    x: padX + i * (colW + gap),
    w: colW,
    count: Math.round(c.share * N),
  }));
  const base = top + plotH;
  return {
    cols,
    top,
    base,
    padX,
    gap,
    d,
    perRow,
    slot: (col, k) => {
      const r = Math.floor(k / perRow);
      const c = k % perRow;
      const off = (col.w - perRow * d) / 2;
      return { x: col.x + off + c * d + d / 2, y: base - r * d - d / 2 };
    },
    colFor: (p) => cols[Math.min(COLS - 1, Math.floor(rarityToX(p) * COLS))],
  };
}

function drawFrame(
  ctx: Ctx,
  pal: Palette,
  L: Layout,
  w: number,
  highlight: BlackSwanTierKey | null,
  faint: boolean,
) {
  ctx.clearRect(0, 0, w, L.base + 40);
  let i = 0;
  while (i < L.cols.length) {
    const t = L.cols[i].tier;
    let j = i;
    while (j + 1 < L.cols.length && L.cols[j + 1].tier === t) j++;
    const x0 = L.cols[i].x - L.gap / 2;
    const x1 = L.cols[j].x + L.cols[j].w + L.gap / 2;
    ctx.globalAlpha = faint ? 0.05 : highlight === t ? 0.2 : 0.08;
    ctx.fillStyle = pal.tier(t);
    ctx.fillRect(x0, L.top - 18, x1 - x0, L.base - L.top + 18);
    ctx.globalAlpha = 1;
    const name = caps(BLACK_SWAN_TIERS.find((x) => x.key === t)?.name ?? "");
    ctx.fillStyle = highlight === t ? pal.get("--ag-ink") : pal.get("--ag-muted");
    ctx.font = `900 ${x1 - x0 > 70 ? 10 : 8}px ${pal.font}`;
    ctx.textAlign = "center";
    if (ctx.measureText(name).width < x1 - x0 + 6) ctx.fillText(name, (x0 + x1) / 2, L.base + 26);
    i = j + 1;
  }
  for (const c of L.cols) {
    ctx.fillStyle = pal.get(faint ? "--ag-sunken-2" : "--ag-sunken");
    ctx.fillRect(c.x, L.top, c.w, L.base - L.top);
  }
  ctx.fillStyle = pal.get("--ag-ink");
  ctx.fillRect(L.padX - 4, L.base, w - 2 * L.padX + 8, 2);
  ctx.fillStyle = pal.get("--ag-muted");
  ctx.font = `700 9px ${pal.font}`;
  ctx.textAlign = "left";
  ctx.fillText("COMMON", L.padX, L.base + 12);
  ctx.textAlign = "right";
  ctx.fillText("RARE →", w - L.padX, L.base + 12);
}

/** The empty chart shown while a prompt is open. */
export function drawGhost(cv: HTMLCanvasElement, caption: string) {
  const pal = palette(cv);
  const { ctx, w, h } = setup(cv, 120);
  const L = layout(w, h);
  drawFrame(ctx, pal, L, w, null, true);
  ctx.fillStyle = pal.get("--ag-muted");
  ctx.font = `800 11px ${pal.font}`;
  ctx.textAlign = "center";
  ctx.fillText(caption, w / 2, L.top + 22);
}

export interface RevealOptions {
  /** Rarity percentile of the player's answer, or null for a miss. */
  p: number | null;
  label: string | null;
  tier: BlackSwanTierKey | null;
  reduceMotion: boolean;
  /** Fires once the player's dot lands (or falls off the chart for a miss). */
  onLand: (at: { x: number; y: number } | null) => void;
}

/** Dots rain into the chart, then the player's gold dot drops in. Returns a cancel function. */
export function runReveal(cv: HTMLCanvasElement, opts: RevealOptions): () => void {
  const pal = palette(cv);
  const { ctx, w, h } = setup(cv, 280);
  const L = layout(w, h);
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const crowd: Array<{ col: Column; k: number; t0: number; jx: number }> = [];
  for (const col of L.cols)
    for (let k = 0; k < col.count; k++) crowd.push({ col, k, t0: 0, jx: 0 });
  crowd.sort((a, b) => a.k - b.k || rand() - 0.5);
  const spread = 2100;
  crowd.forEach((c, i) => {
    c.t0 = (i / crowd.length) * spread + rand() * 120;
    c.jx = (rand() - 0.5) * 18;
  });
  const myCol = opts.p === null ? null : L.colFor(opts.p);
  const meT0 = spread + 450;
  const g = 0.0016;
  let start: number | null = null;
  let landed = false;
  let raf = 0;
  const colorOf = (t: BlackSwanTierKey) => pal.tier(t);

  const frame = (ts: number) => {
    if (start === null) start = ts;
    const t = opts.reduceMotion ? 1e9 : ts - start;
    drawFrame(ctx, pal, L, w, t > meT0 + 600 && opts.tier ? opts.tier : null, false);
    for (const p of crowd) {
      if (t < p.t0) continue;
      const s = L.slot(p.col, p.k);
      const dt = t - p.t0;
      const y = Math.min(s.y, -10 + 2 * g * dt * dt);
      const down = y >= s.y;
      const x = down ? s.x : s.x + p.jx * (1 - y / s.y);
      ctx.globalAlpha = down ? 1 : 0.6;
      dot(ctx, x, y, L.d / 2 - 0.4, down ? colorOf(p.col.tier) : pal.get("--ag-muted"));
      ctx.globalAlpha = 1;
    }
    for (const c of L.cols)
      if (c.count === 0) {
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = colorOf(c.tier);
        ctx.fillRect(c.x, L.base - 2, c.w, 2);
        ctx.globalAlpha = 1;
      }
    if (t >= meT0) {
      const dt = t - meT0;
      if (myCol) {
        const s = L.slot(myCol, myCol.count);
        const y = Math.min(s.y, -14 + 1.5 * g * dt * dt);
        const down = y >= s.y;
        if (down) {
          const pulse = opts.reduceMotion ? 0 : Math.max(0, 1 - (dt - 450) / 900);
          ctx.globalAlpha = 0.35 * pulse + 0.15;
          dot(ctx, s.x, s.y, L.d * 1.9 + 6 * pulse, pal.get("--ag-bs-gold"));
          ctx.globalAlpha = 1;
        }
        dot(ctx, s.x, y, L.d / 2 + 2.2, pal.get("--ag-bs-gold"), pal.get("--ag-ink"));
        if (down && opts.label) {
          ctx.font = `900 11px ${pal.font}`;
          const full = `YOU · ${opts.label}`;
          const label = full.length > 30 && w < 520 ? `${full.slice(0, 28)}…` : full;
          const tw = ctx.measureText(label).width;
          const lx = Math.min(Math.max(s.x, tw / 2 + 6), w - tw / 2 - 6);
          const ly = Math.max(14, s.y - L.d - 10);
          ctx.fillStyle = "rgba(255,255,255,0.92)";
          ctx.fillRect(lx - tw / 2 - 5, ly - 11, tw + 10, 15);
          ctx.fillStyle = pal.get("--ag-ink");
          ctx.textAlign = "center";
          ctx.fillText(label, lx, ly);
        }
        if (down && !landed) {
          landed = true;
          opts.onLand({ x: s.x, y: s.y });
        }
      } else {
        // A miss falls past the chart and off the edge.
        const x = w - 18;
        const y = -14 + 1.5 * g * dt * dt;
        dot(ctx, x, Math.min(y, h + 20), L.d / 2 + 2.2, pal.get("--ag-bad"), pal.get("--ag-ink"));
        if (y > L.base - 40) {
          ctx.fillStyle = pal.get("--ag-bad");
          ctx.font = `900 11px ${pal.font}`;
          ctx.textAlign = "right";
          ctx.fillText("NOT ON THE LIST", w - 32, L.top + 4);
        }
        if (y > h && !landed) {
          landed = true;
          opts.onLand(null);
        }
      }
    }
    if (!landed || (t < meT0 + 1500 && !opts.reduceMotion)) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

/** A burst of sparks from the player's dot; bigger tiers get more. */
export function burst(
  cv: HTMLCanvasElement,
  at: { x: number; y: number },
  count: number,
  colors: string[],
) {
  if (!count) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  const ctx = cv.getContext("2d") as Ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const parts = Array.from({ length: count }, (_, k) => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.5;
    const v = 1.5 + Math.random() * (count > 40 ? 6 : 4);
    return {
      x: at.x,
      y: at.y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      r: 1.5 + Math.random() * 2.5,
      c: colors[k % colors.length],
      life: 1,
    };
  });
  const step = () => {
    ctx.clearRect(0, 0, w, h);
    let alive = 0;
    for (const p of parts) {
      if (p.life <= 0) continue;
      alive++;
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.12;
      p.life -= 0.016;
      ctx.globalAlpha = Math.max(0, p.life);
      dot(ctx, p.x, p.y, p.r, p.c);
    }
    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, w, h);
  };
  requestAnimationFrame(step);
}

/** Summary chart: the same curve with the day's answers marked 1–5. */
export function drawDayChart(cv: HTMLCanvasElement, ps: ReadonlyArray<number | null>) {
  const pal = palette(cv);
  const { ctx, w } = setup(cv, 150);
  const padX = 14;
  const y0 = 100;
  const x = (v: number) => padX + v * (w - padX * 2);
  const curve = (v: number) => y0 - 62 * Math.exp(-K * v);
  let lo = 0;
  for (const t of BLACK_SWAN_TIERS) {
    const hi = Math.min(1, t.upTo);
    const x0 = x(rarityToX(lo));
    const x1 = x(lo === hi ? 1 : rarityToX(hi));
    ctx.fillStyle = pal.tier(t.key);
    ctx.globalAlpha = 0.12;
    ctx.fillRect(x0, 14, x1 - x0, y0 - 14);
    ctx.globalAlpha = 1;
    ctx.fillStyle = pal.get("--ag-muted");
    ctx.font = `900 9px ${pal.font}`;
    ctx.textAlign = "center";
    if (x1 - x0 > 44) ctx.fillText(caps(t.name), (x0 + x1) / 2, y0 + 28);
    lo = hi;
  }
  ctx.beginPath();
  ctx.moveTo(x(0), y0);
  for (let i = 0; i <= 100; i++) ctx.lineTo(x(i / 100), curve(i / 100));
  ctx.lineTo(x(1), y0);
  ctx.closePath();
  ctx.fillStyle = pal.get("--ag-line-soft");
  ctx.fill();
  ctx.strokeStyle = pal.get("--ag-ink");
  ctx.lineWidth = 2;
  ctx.stroke();
  const placed: Array<{ x: number; y: number }> = [];
  ps.forEach((p, i) => {
    if (p === null) return;
    const xr = rarityToX(p);
    const px = Math.min(x(xr), w - padX - 8);
    let py = curve(xr);
    while (placed.some((q) => Math.abs(q.x - px) < 16 && Math.abs(q.y - py) < 16)) py -= 17;
    placed.push({ x: px, y: py });
    ctx.strokeStyle = pal.get("--ag-ink");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px, y0);
    ctx.stroke();
    dot(ctx, px, py - 2, 7, pal.get("--ag-bs-gold"), pal.get("--ag-ink"));
    ctx.fillStyle = pal.get("--ag-ink");
    ctx.font = `900 9px ${pal.font}`;
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), px, py + 1);
  });
}
