'use client';

import { useEffect, useRef } from 'react';

/* Ordered-dither field in the diamond-dot style: a vertical gradient
   quantized to discrete shade levels through the 8x8 Bayer matrix — proper
   multi-level ordered dithering (floor(gradient * levels + threshold)) — with
   each surviving cell drawn as a small diamond dot with breathing room, like
   classic dot-dither art, instead of packed square pixels. Each dot breathes
   on its own slow sine blink with a random phase and speed, so the field
   twinkles organically instead of animating in lockstep. */
const BAYER8 = [
  [0, 32, 8, 40, 2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44, 4, 36, 14, 46, 6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [3, 35, 11, 43, 1, 33, 9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47, 7, 39, 13, 45, 5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

const CELL_PX = 5; // grid pitch per dot
const DOT_R = 2; // diamond radius — leaves gaps, per the dot-art reference
const ALPHA = 0.7; // solid enough to read crisp; faint dots look blurry
const PEAK_DENSITY = 0.95; // gradient strength at the bottom edge
const SHADE_LEVELS = 3; // quantized opacity levels above transparent
const BLINK_DEPTH = 0.55; // dots breathe down to 45%, never fully vanish
const FRAME_MS = 33; // ~30fps is plenty for a slow breathe
const SPRITE_STEPS = 24; // pre-rendered diamond opacities

// Deterministic per-cell hash, used to give every dot its own blink timing.
function hash(x: number, y: number, seed: number) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return v - Math.floor(v);
}

type Dot = { x: number; y: number; fade: number; phase: number; speed: number };

export type DitherPainter = {
  /** Rebuild the dot field for the canvas's current pixel size. */
  rebuild(): void;
  /** Paint one frame; `now` in ms (performance.now() or equivalent). */
  draw(now: number): void;
};

/* The painter behind <DitherField>, exposed so the same field can be drawn
   into any 2D canvas — e.g. a canvas that feeds a WebGL texture. `scale`
   plays the role of devicePixelRatio: it sets the dot pitch in canvas
   pixels. */
export function createDitherPainter(
  canvas: HTMLCanvasElement,
  { rgb, alpha = ALPHA, scale = 1 }: { rgb: string; alpha?: number; scale?: number },
): DitherPainter {
  const ctx = canvas.getContext('2d')!;
  const pitch = Math.max(2, Math.round(CELL_PX * scale));

  // One sprite per opacity step — drawImage per dot beats path-filling
  // thousands of diamonds every frame. The diamond is built from 1-pixel
  // rect rows (a hard staircase), not an antialiased path — vector diamonds
  // this small are all blur.
  const sprites: HTMLCanvasElement[] = [];
  const r = Math.max(1, Math.round(DOT_R * scale));
  const c = Math.floor(pitch / 2);
  for (let i = 0; i < SPRITE_STEPS; i++) {
    const sprite = document.createElement('canvas');
    sprite.width = pitch;
    sprite.height = pitch;
    const sctx = sprite.getContext('2d')!;
    sctx.fillStyle = `rgba(${rgb}, ${(alpha * (i + 1)) / SPRITE_STEPS})`;
    for (let dy = -r; dy <= r; dy++) {
      const w = 2 * (r - Math.abs(dy)) + 1;
      sctx.fillRect(c - (w >> 1), c + dy, w, 1);
    }
    sprites.push(sprite);
  }

  let dots: Dot[] = [];

  const draw = (now: number) => {
    const t = now / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const dot of dots) {
      const wave = 0.5 - 0.5 * Math.cos((t * dot.speed + dot.phase) * 2 * Math.PI);
      const a = dot.fade * (1 - BLINK_DEPTH * (1 - wave));
      const idx = Math.min(SPRITE_STEPS - 1, Math.floor(a * SPRITE_STEPS));
      ctx.drawImage(sprites[idx], dot.x * pitch, dot.y * pitch);
    }
  };

  const rebuild = () => {
    ctx.imageSmoothingEnabled = false;
    const cols = Math.ceil(canvas.width / pitch);
    const rows = Math.ceil(canvas.height / pitch);

    // Smooth 1D value noise so the gradient's upper edge undulates instead
    // of cutting a straight horizontal line. One broad, slow swell — tight
    // octaves read as ripples.
    const seg = Math.max(6, Math.round(220 / CELL_PX));
    const wob = (x: number, step: number, seed: number) => {
      const i = Math.floor(x / step);
      const f = (x - i * step) / step;
      const u = f * f * (3 - 2 * f);
      return hash(i, 0, seed) * (1 - u) + hash(i + 1, 0, seed) * u;
    };

    // A vertical gradient quantized against the Bayer threshold: each cell
    // lands on a discrete level 0..SHADE_LEVELS, and adjacent bands blend
    // purely through dot density — no continuous fades.
    dots = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const wobble = (wob(x, seg, 3) - 0.5 + (wob(x, seg / 2, 4) - 0.5) * 0.15) * rows * 0.22;
        const yy = Math.min(rows - 1, Math.max(0, y + wobble));
        const ramp = rows < 2 ? 1 : yy / (rows - 1);
        // Gentler curve than ramp^2 — keeps a readable scatter of dots in
        // the upper reaches instead of thinning out too abruptly.
        const gradient = Math.pow(ramp, 1.5) * PEAK_DENSITY;
        const threshold = (BAYER8[y & 7][x & 7] + 0.5) / 64;
        const level = Math.min(SHADE_LEVELS, Math.floor(gradient * SHADE_LEVELS + threshold));
        if (level > 0) {
          dots.push({
            x,
            y,
            fade: level / SHADE_LEVELS,
            phase: hash(x, y, 1),
            speed: 0.25 + 0.4 * hash(x, y, 2), // one blink every ~1.5-4s
          });
        }
      }
    }
    draw(performance.now());
  };

  return { rebuild, draw };
}

export function DitherField({
  className,
  rgb = '255, 103, 0',
  alpha = ALPHA,
}: {
  className?: string;
  /** Dot color as an "r, g, b" triple. Defaults to brand orange. */
  rgb?: string;
  /** Peak dot opacity. */
  alpha?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Render at device resolution — a 1x canvas stretched by CSS on a retina
    // display blurs every dot. Everything works in integer DEVICE pixels with
    // no context transform, so nothing is ever resampled.
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const painter = createDitherPainter(canvas, { rgb, alpha, scale: dpr });

    let raf = 0;
    let last = 0;
    const rebuild = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      painter.rebuild();
    };
    const tick = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        painter.draw(now);
      }
      raf = requestAnimationFrame(tick);
    };

    rebuild();
    const observer = new ResizeObserver(rebuild);
    observer.observe(canvas);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [rgb, alpha]);

  return (
    <canvas ref={canvasRef} aria-hidden className={`pointer-events-none ${className ?? ''}`} />
  );
}
