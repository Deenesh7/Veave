import React, { useEffect, useRef, useSyncExternalStore } from 'react';
import { cn } from '../../lib/utils';

const STATES = ['idle', 'listening', 'thinking'];

const LABELS = {
  idle: 'Idle',
  listening: 'Listening',
  thinking: 'Thinking',
};

const SCALE = {
  idle: 0.88,
  listening: 1,
  thinking: 0.92,
};

const STIFFNESS = 180;
const DAMPING = 26;
const ATTACK = 0.22;
const RELEASE = 0.08;
const BLEND = 0.16;

const ORBITERS = [
  { radius: 0.62, speed: 2.2, phase: 0, spread: 0.42 },
  { radius: 0.4, speed: -1.7, phase: 2.1, spread: 0.36 },
  { radius: 0.8, speed: 1.15, phase: 4, spread: 0.34 },
];

function envelope(t) {
  const slow = 0.5 + 0.5 * Math.sin(t * 0.62 + 0.4);
  const fast = 0.5 + 0.5 * Math.sin(t * 1.9 + 1.1);
  return 0.22 + 0.78 * (0.45 + 0.55 * slow) * fast;
}

function intensityOf(state, d, nx, ny, t, amplitude) {
  if (state === 'listening') {
    const ripple = 0.5 + 0.5 * Math.sin(d * 4.2 - t * 3);
    return 0.32 + amplitude * (0.34 + 0.38 * ripple);
  }

  if (state === 'thinking') {
    let heat = 0;
    for (const o of ORBITERS) {
      const a = t * o.speed + o.phase;
      const dx = nx - Math.cos(a) * o.radius;
      const dy = ny - Math.sin(a) * o.radius;
      heat += Math.exp(-(dx * dx + dy * dy) / (o.spread * o.spread));
    }
    return 0.26 + 0.8 * Math.min(1, heat);
  }

  return 0.62 + 0.12 * Math.sin(t * 1.05 - d * 2.4);
}

function subscribeToZoom(onChange) {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
}

function useDevicePixelRatio() {
  return useSyncExternalStore(
    subscribeToZoom,
    () => Math.min(window.devicePixelRatio || 1, 4),
    () => 1,
  );
}

export function MatrixOrb({
  state = 'idle',
  level,
  size = 240,
  color = '#18181B',
  dots = 11,
  labels,
  className,
  ...props
}) {
  const canvasRef = useRef(null);
  const stateRef = useRef(state);
  const levelRef = useRef(level);
  const dpr = useDevicePixelRatio();

  useEffect(() => {
    stateRef.current = state;
    levelRef.current = level;
  }, [state, level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const buffer = Math.round(size * dpr);
    canvas.width = canvas.height = buffer;
    ctx.scale(buffer / size, buffer / size);
    ctx.fillStyle = color;

    const grid = Math.max(3, Math.round(dots));
    const half = (grid - 1) / 2;
    const spacing = (size * 0.74) / (grid - 1);
    const maxRadius = spacing * 0.6;

    const weights = { idle: 0, listening: 0, thinking: 0 };
    weights[stateRef.current] = 1;

    const levelAt = (t) => {
      const v = levelRef.current;
      return v === undefined || !Number.isFinite(v)
        ? envelope(t)
        : Math.min(1, Math.max(0, v));
    };

    let raf = 0;
    const start = performance.now();

    const draw = (t, amplitude, scale) => {
      ctx.clearRect(0, 0, size, size);

      for (let iy = 0; iy < grid; iy++) {
        for (let ix = 0; ix < grid; ix++) {
          const nx = (ix - half) / half;
          const ny = (iy - half) / half;
          const d = Math.hypot(nx, ny);
          if (d > 1.12) continue;

          let blended = 0;
          for (const s of STATES) {
            if (weights[s] < 0.001) continue;
            blended += weights[s] * intensityOf(s, d, nx, ny, t, amplitude);
          }

          const intensity = Math.min(1, Math.max(0, blended));
          const radius = maxRadius * Math.exp(-d * d * 1.7) * intensity * scale;

          if (radius <= 0.2) continue;

          const cx = size / 2 + nx * half * spacing;
          const cy = size / 2 + ny * half * spacing;

          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const loop = (now) => {
      const t = (now - start) / 1000;
      const amp = levelAt(t);
      const sc = SCALE[stateRef.current] || 1;
      draw(t, amp, sc);
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
    };
  }, [size, color, dots, dpr]);

  return (
    <div
      data-slot="matrix-orb"
      className={cn('relative flex flex-col items-center justify-center', className)}
      style={{ width: size, height: size }}
      {...props}
    >
      <canvas ref={canvasRef} className="h-full w-full pointer-events-none" />
    </div>
  );
}

export default MatrixOrb;
