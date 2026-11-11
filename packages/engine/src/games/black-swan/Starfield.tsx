import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** Drive the starfield from the game: a warp is a burst of speed that eases out. */
export interface StarfieldHandle {
  /** strength 0–1 (how far the jump goes), lasting `ms`. */
  warp(strength: number, ms: number): void;
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

/**
 * Outlier's backdrop: stars streaming gently toward the viewer, as if drifting
 * out through space. A warp stretches them into streaks for a moment, longer
 * for rarer answers. Static under prefers-reduced-motion.
 */
export const Starfield = forwardRef<StarfieldHandle>(function Starfield(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const warpRef = useRef({ start: 0, ms: 1, strength: 0 });

  useImperativeHandle(ref, () => ({
    warp(strength, ms) {
      warpRef.current = { start: performance.now(), ms: Math.max(1, ms), strength };
    },
  }));

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
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
      const wv = warpRef.current;
      const t = Math.min(1, (now - wv.start) / wv.ms);
      // Ease up fast, then glide back down.
      const boost =
        t < 1 ? wv.strength * Math.sin(Math.PI * Math.min(1, t * 1.6)) ** 2 * (1 - t * 0.4) : 0;
      const speed = reduce ? 0 : (0.012 + boost * 0.25) * dt;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.42;
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
        // Perspective: a star at depth z sits FOCAL/z of the way out from the centre.
        const k = (FOCAL / s.z) * scale;
        const x = cx + s.x * k;
        const y = cy + s.y * k;
        if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
        const near = 1 - s.z / DEPTH;
        const a = Math.min(1, 0.08 + near * near * 1.4);
        const r = 0.4 + near * near * 2;
        const c = colour(s.hue);
        if (boost > 0.05) {
          const pk = (FOCAL / s.pz) * scale;
          const px = cx + s.x * pk;
          const py = cy + s.y * pk;
          ctx.strokeStyle = `rgba(${c},${a})`;
          ctx.lineWidth = r;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        } else {
          ctx.fillStyle = `rgba(${c},${a})`;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
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
