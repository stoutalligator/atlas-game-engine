import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { LANDMARKS, type Landmark } from "./journey.js";

/** Drive the sky from the game. Positions are log10(light-years) from Earth. */
export interface StarfieldHandle {
  /** Jump the camera to `toLog`: stars streak (harder for bigger `strength`, 0–1) and landmarks fly past. */
  travel(toLog: number, strength: number, ms: number): void;
  /** Put the camera somewhere without animating (e.g. resuming a day). */
  place(log: number): void;
}

interface Star {
  x: number;
  y: number;
  z: number;
  pz: number;
  hue: number;
}

const COUNT = 520;
const DEPTH = 1000;
/** Depth at which a star at x = 1 sits one scale-width from the centre. */
const FOCAL = 140;
/** How far ahead (in decades of distance) a landmark starts to show, and how long it lingers once passed. */
const AHEAD = 3.2;
const BEHIND = 0.45;
/** Spread landmarks around the sky on the golden angle so they never stack. */
const GOLDEN = 2.39996;

/**
 * Outlier's sky. Between answers it holds still (stars only twinkle); a jump streaks them and
 * moves the camera out along the real distance scale, so the Moon, the planets,
 * stars and galaxies appear ahead as small labelled objects, grow as you near
 * them and fly past. Static (no streaming) under prefers-reduced-motion.
 */
export const Starfield = forwardRef<StarfieldHandle, { startLog: number }>(function Starfield(
  { startLog },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ from: startLog, to: startLog, start: 0, ms: 1, strength: 0 });

  /** The camera's position right now (eased between jumps). */
  const current = (now: number) => {
    const c = cam.current;
    const t = Math.min(1, (now - c.start) / c.ms);
    const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2; // ease in-out
    return c.from + (c.to - c.from) * e;
  };
  const currentRef = useRef(current);
  currentRef.current = current;

  useImperativeHandle(ref, () => ({
    travel(toLog, strength, ms) {
      const now = performance.now();
      cam.current = {
        from: currentRef.current(now),
        to: toLog,
        start: now,
        ms: Math.max(1, ms),
        strength,
      };
    },
    place(log) {
      cam.current = { from: log, to: log, start: 0, ms: 1, strength: 0 };
    },
  }));

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const font = getComputedStyle(cv).fontFamily || "system-ui, sans-serif";
    const stars: Star[] = Array.from({ length: COUNT }, () => {
      const z = Math.random() * DEPTH;
      return {
        x: (Math.random() - 0.5) * 2,
        y: (Math.random() - 0.5) * 2,
        z,
        pz: z,
        hue: Math.random(),
      };
    });
    const marks = LANDMARKS.map((l, i) => ({ l, log: Math.log10(l.ly), angle: i * GOLDEN + 0.6 }));
    let w = 0;
    let h = 0;
    const size = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth;
      h = cv.clientHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(cv);

    const colour = (hue: number) =>
      hue < 0.12
        ? "255,196,150"
        : hue < 0.28
          ? "170,200,255"
          : hue < 0.34
            ? "255,170,220"
            : "235,240,255";

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      const c = cam.current;
      const t = Math.min(1, (now - c.start) / c.ms);
      const boost = t < 1 ? c.strength * Math.sin(Math.PI * t) ** 2 : 0;
      // Still between answers (so the labelled objects can be read); it only flies on a jump.
      const speed = reduce ? 0 : boost * 0.21 * dt;
      const camLog = reduce ? c.to : currentRef.current(now);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.46;
      const scale = Math.max(w, h) * 0.6;

      for (const s of stars) {
        s.pz = s.z;
        // Capped so even a full warp streaks the stars instead of resetting them all at once.
        s.z -= Math.min(speed * DEPTH * 0.05, DEPTH * 0.06);
        if (s.z < 1) {
          s.z = DEPTH;
          s.pz = DEPTH;
          s.x = (Math.random() - 0.5) * 2;
          s.y = (Math.random() - 0.5) * 2;
        }
        const k = (FOCAL / s.z) * scale;
        const x = cx + s.x * k;
        const y = cy + s.y * k;
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
        const near = 1 - s.z / DEPTH;
        // A faint twinkle keeps a still sky alive.
        const twinkle = reduce ? 1 : 0.75 + 0.25 * Math.sin(now / 900 + s.hue * 40);
        const a = Math.min(1, (0.08 + near * near * 1.4) * twinkle);
        const r = 0.4 + near * near * 2;
        const col = colour(s.hue);
        if (boost > 0.05) {
          const pk = (FOCAL / s.pz) * scale;
          ctx.strokeStyle = `rgba(${col},${a})`;
          ctx.lineWidth = r;
          ctx.beginPath();
          ctx.moveTo(cx + s.x * pk, cy + s.y * pk);
          ctx.lineTo(x, y);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${col},${a})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Landmarks: far ones sit small near the centre, near ones large and out to the side.
      const R = Math.min(w, h) * 0.46;
      for (const m of marks) {
        const d = m.log - camLog;
        if (d > AHEAD || d < -BEHIND) continue;
        const k = 0.28 / (Math.max(d, -0.27) + 0.28); // 1 at d = 0, growing fast as it passes
        // Far objects wait on a ring around the edge (the middle is for the question);
        // as you near one it swells and sweeps outward past you.
        const r = R * (0.72 + 0.45 * Math.min(k, 1) + Math.max(0, k - 1) * 0.9);
        const x = cx + Math.cos(m.angle) * r * 1.25;
        const y = cy + Math.sin(m.angle) * r * 0.82;
        const fadeIn = Math.min(1, (AHEAD - d) / 0.8);
        const fadeOut = d < 0 ? Math.max(0, 1 + d / BEHIND) : 1;
        const alpha = Math.min(fadeIn, fadeOut);
        if (alpha <= 0.01) continue;
        const sz = Math.min(160, BASE[m.l.kind] * k ** 0.85);
        ctx.globalAlpha = alpha;
        drawLandmark(ctx, m.l, x, y, sz);
        if (d > -0.15 && sz > 3) {
          ctx.globalAlpha = alpha * Math.max(0, Math.min(1, (AHEAD - 0.3 - d) / 0.6));
          ctx.textAlign = "center";
          ctx.fillStyle = "rgba(235,240,255,0.92)";
          ctx.font = `600 ${Math.round(Math.min(15, 10 + sz / 14))}px ${font}`;
          ctx.fillText(m.l.name, x, y + sz / 2 + 15);
          ctx.fillStyle = "rgba(160,175,220,0.85)";
          ctx.font = `500 ${Math.round(Math.min(12, 9 + sz / 20))}px ${font}`;
          ctx.fillText(m.l.distance, x, y + sz / 2 + 29);
        }
        ctx.globalAlpha = 1;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // biome-ignore lint/a11y/noAriaHiddenOnFocusable: a canvas without tabIndex is not focusable; this one is pure decoration
  return <canvas ref={canvasRef} className="ag-bs__stars" aria-hidden="true" />;
});

/** Size (px) of each kind of object when it is level with the camera. */
const BASE: Record<Landmark["kind"], number> = {
  moon: 46,
  planet: 42,
  belt: 70,
  craft: 22,
  cloud: 90,
  star: 34,
  nebula: 80,
  galaxy: 96,
};

function drawLandmark(ctx: CanvasRenderingContext2D, l: Landmark, x: number, y: number, s: number) {
  const r = s / 2;
  const glow = (radius: number, inner: string, a = 0.35) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, hexA(inner, a));
    g.addColorStop(1, hexA(inner, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  };
  switch (l.kind) {
    case "moon":
    case "planet": {
      glow(r * 1.8, l.color, 0.25);
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, l.color);
      g.addColorStop(1, shade(l.color, 0.25));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (l.id === "saturn") {
        ctx.strokeStyle = hexA(l.color, 0.8);
        ctx.lineWidth = Math.max(1, r * 0.12);
        ctx.beginPath();
        ctx.ellipse(x, y, r * 1.9, r * 0.55, -0.35, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case "star": {
      glow(r * 2.2, l.color, 0.5);
      glow(r * 0.7, "#ffffff", 0.95);
      ctx.strokeStyle = hexA("#ffffff", 0.7);
      ctx.lineWidth = Math.max(0.8, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(x - r * 1.6, y);
      ctx.lineTo(x + r * 1.6, y);
      ctx.moveTo(x, y - r * 1.6);
      ctx.lineTo(x, y + r * 1.6);
      ctx.stroke();
      break;
    }
    case "nebula": {
      const blobs: Array<[number, number, number, string]> = [
        [-0.3, -0.1, 0.9, l.color],
        [0.35, 0.2, 0.75, "#7d8cff"],
        [0, 0.3, 0.6, "#c56bff"],
      ];
      for (const [dx, dy, k, col] of blobs) {
        const g = ctx.createRadialGradient(
          x + dx * r,
          y + dy * r,
          0,
          x + dx * r,
          y + dy * r,
          r * k,
        );
        g.addColorStop(0, hexA(col, 0.45));
        g.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x + dx * r, y + dy * r, r * k, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case "galaxy": {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.5);
      ctx.scale(1, 0.42);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
      g.addColorStop(0, "rgba(255,255,255,0.95)");
      g.addColorStop(0.18, hexA(l.color, 0.75));
      g.addColorStop(0.55, hexA(l.color, 0.2));
      g.addColorStop(1, hexA(l.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case "belt":
    case "cloud": {
      glow(r, l.color, 0.12);
      ctx.fillStyle = hexA(l.color, 0.85);
      for (let i = 0; i < 26; i++) {
        const a = i * 0.9;
        const rr = r * (0.55 + ((i * 37) % 10) / 25);
        ctx.beginPath();
        ctx.arc(
          x + Math.cos(a) * rr,
          y + Math.sin(a) * rr * 0.5,
          Math.max(0.6, r * 0.035),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    }
    case "craft": {
      ctx.strokeStyle = hexA(l.color, 0.95);
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(x - r, y);
      ctx.lineTo(x + r, y);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + r * 0.8);
      ctx.stroke();
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(x, y - r * 0.15, r * 0.45, Math.PI, 0);
      ctx.fill();
      break;
    }
  }
}

function hexA(hex: string, a: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function shade(hex: string, f: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.round(v * f);
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
