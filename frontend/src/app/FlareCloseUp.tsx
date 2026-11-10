// Issue #71 stream G, D-36: the close-up flare view. One flare on a side-on bipole, open (eruptive)
// or closed (confined), class C, M or X, with a timeline of five named stages and the soft and hard
// X-ray light curve (Neupert effect) with a draggable playhead. A schematic of a standard flare
// model, not an image of a real flare: the arch shape is `model_dependent`, the wisps are `artistic`.
// Every frame is a pure function of (kind, class, t), so scrubbing is exact. Reduced motion: no
// autoplay; the person scrubs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CLASS_LABEL,
  CLASS_STRENGTH,
  STAGES,
  STAGE_TEXT,
  StreakSink,
  emitStage,
  lightCurves,
  stageIndex,
  type Mapper,
} from '@/physics/flares';
import { ProvenanceBadge } from './Badge';
import { buttonClass, pressedClass } from './ui';

type Cls = keyof typeof CLASS_STRENGTH;
const MINUTES = 60;
/** View window and viewing angles of the schematic (artistic). */
const VIEW_H = 0.17;
const OFF_Y = 1.085;
const B0 = (12 * Math.PI) / 180;
const PSI = (25 * Math.PI) / 180;
const SINK_CAP = 24000;
/** Seconds of real time the autoplay takes for the 60 minutes shown (display choice). */
const PLAY_SECONDS = 22;
const CH = { x0: 44, x1: 512, y0: 124, y1: 12 };

const reduced = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function FlareCloseUp() {
  const [open, setOpen] = useState(true);
  const [cls, setCls] = useState<Cls>('x');
  const [t, setT] = useState(0.36);
  const [playing, setPlaying] = useState(() => !reduced());
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const sink = useMemo(() => new StreakSink(SINK_CAP), []);
  const curves = useMemo(() => lightCurves(open), [open]);

  // Draw one frame: plasma streaks, the limb and the star below.
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const W = Math.round(c.clientWidth * dpr) || 600;
    const H = Math.round(c.clientHeight * dpr) || 300;
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const cb = Math.cos(B0);
    const sb = Math.sin(B0);
    const cp = Math.cos(PSI);
    const sp = Math.sin(PSI);
    const at: Mapper = (a, l, h) => {
      const ex = a * cp - l * sp;
      const de = a * sp + l * cp;
      const y = (1 + h) * cb - de * sb;
      return [W / 2 + (ex / VIEW_H) * (H / 2), H / 2 - ((y - OFF_Y) / VIEW_H) * (H / 2), 0];
    };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, W, H);
    // The star below: a disc whose limb is at the bottom of the window.
    const cy = H / 2 + (OFF_Y / VIEW_H) * (H / 2);
    const R = (1 / VIEW_H) * (H / 2);
    const g = ctx.createRadialGradient(W / 2, cy, R * 0.9, W / 2, cy, R * 1.002);
    g.addColorStop(0, '#9a3d08');
    g.addColorStop(1, '#e6781c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(W / 2, cy, R, 0, Math.PI * 2);
    ctx.fill();
    sink.reset();
    emitStage(sink, at, t, { open, strength: CLASS_STRENGTH[cls], q: 1 });
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, (H / 620) * 1.6);
    for (let i = 0; i < sink.n; i++) {
      const o = i * 6;
      const r = Math.min(255, sink.col[o]! * 255);
      const gg = Math.min(255, sink.col[o + 1]! * 255);
      const b = Math.min(255, sink.col[o + 2]! * 255);
      ctx.strokeStyle = `rgb(${r | 0},${gg | 0},${b | 0})`;
      ctx.beginPath();
      ctx.moveTo(sink.pos[o]!, sink.pos[o + 1]!);
      ctx.lineTo(sink.pos[o + 3]!, sink.pos[o + 4]!);
      ctx.stroke();
    }
  }, [open, cls, t, sink]);

  // Autoplay: advances the scrub position only (never a simulation state).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.06, (now - last) / 1000);
      last = now;
      setT((x) => (x + dt / PLAY_SECONDS > 1 ? 0 : x + dt / PLAY_SECONDS));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const scrub = useCallback((v: number) => {
    setPlaying(false);
    setT(Math.min(1, Math.max(0, v)));
  }, []);

  const stage = stageIndex(t);
  const X = (v: number) => CH.x0 + (CH.x1 - CH.x0) * v;
  const Y = (v: number) => CH.y0 + (CH.y1 - CH.y0) * v;
  const path = (a: number[]) =>
    a.map((v, i) => `${i ? 'L' : 'M'}${X(i / 240).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const idx = Math.round(t * 240);

  return (
    <div className="flex flex-col gap-3 rounded border border-neutral-700 p-3" data-testid="flare-closeup">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-300">Field:</span>
        {[true, false].map((o) => (
          <button
            key={String(o)}
            type="button"
            className={`${buttonClass} ${pressedClass}`}
            aria-pressed={open === o}
            onClick={() => setOpen(o)}
          >
            {o ? 'Open (eruptive)' : 'Closed (confined)'}
          </button>
        ))}
        <span className="ml-2 text-sm text-neutral-300">Class:</span>
        {(Object.keys(CLASS_STRENGTH) as Cls[]).map((c) => (
          <button
            key={c}
            type="button"
            className={`${buttonClass} ${pressedClass}`}
            aria-pressed={cls === c}
            onClick={() => setCls(c)}
          >
            {c.toUpperCase()}
          </button>
        ))}
        <button
          type="button"
          className={buttonClass}
          aria-pressed={playing}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
      </div>
      <canvas
        ref={canvas}
        className="h-64 w-full rounded bg-black"
        role="img"
        aria-label={`Side view of a ${open ? 'open, eruptive' : 'closed, confined'} class ${cls.toUpperCase()} flare at ${Math.round(t * MINUTES)} minutes: ${STAGES[stage]!.label}.`}
      />
      <div role="group" aria-label="Flare stages" className="flex flex-wrap gap-2">
        {STAGES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`${buttonClass} ${pressedClass}`}
            aria-pressed={stage === i}
            onClick={() => scrub(s.at)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 text-sm text-neutral-300">
        Time
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(t * 1000)}
          className="h-11 flex-1"
          aria-valuetext={`${Math.round(t * MINUTES)} minutes, ${STAGES[stage]!.label}`}
          onChange={(e) => scrub(Number(e.target.value) / 1000)}
        />
        <span className="w-24 text-right text-neutral-100">{Math.round(t * MINUTES)} minutes</span>
      </label>
      <p className="text-sm text-neutral-200" data-testid="flare-stage-text" aria-live="polite">
        {STAGE_TEXT[STAGES[stage]!.id][open ? 'open' : 'closed']}
      </p>
      <svg
        viewBox="0 0 524 164"
        className="w-full touch-none"
        role="img"
        aria-label="Example flare light curve. Hard X-rays peak in short bursts while the soft X-rays rise, then the soft X-rays fade slowly."
        onPointerDown={(e) => {
          (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
          const b = e.currentTarget.getBoundingClientRect();
          scrub((((e.clientX - b.left) / b.width) * 524 - CH.x0) / (CH.x1 - CH.x0));
        }}
        onPointerMove={(e) => {
          if (!e.buttons) return;
          const b = e.currentTarget.getBoundingClientRect();
          scrub((((e.clientX - b.left) / b.width) * 524 - CH.x0) / (CH.x1 - CH.x0));
        }}
      >
        <title>Example flare brightness over 60 minutes</title>
        {[0, 0.5, 1].map((v) => (
          <g key={v}>
            <line x1={CH.x0} x2={CH.x1} y1={Y(v)} y2={Y(v)} stroke="#2a2a30" />
            <text x={CH.x0 - 8} y={Y(v) + 4} textAnchor="end" fill="#a1a1aa" fontSize="11">
              {v}
            </text>
          </g>
        ))}
        {[0, 15, 30, 45, 60].map((m) => (
          <text key={m} x={X(m / 60)} y={CH.y0 + 18} textAnchor="middle" fill="#a1a1aa" fontSize="11">
            {m}
          </text>
        ))}
        <text x={CH.x1} y={CH.y0 + 34} textAnchor="end" fill="#a1a1aa" fontSize="11">
          minutes
        </text>
        <path d={path(curves.hard)} fill="none" stroke="#2f9bd4" strokeWidth="2" />
        <path d={path(curves.soft)} fill="none" stroke="#c98a08" strokeWidth="2" />
        <line x1={X(t)} x2={X(t)} y1={CH.y1} y2={CH.y0} stroke="#fafafa" strokeWidth="1.5" />
        <circle cx={X(t)} cy={Y(curves.soft[idx]!)} r="4.5" fill="#c98a08" stroke="#111114" strokeWidth="2" />
      </svg>
      <p className="text-sm text-neutral-300">
        <span className="text-[#c98a08]">Gold</span>: soft X-rays. <span className="text-[#2f9bd4]">Blue</span>: hard
        X-rays, which follow how fast the soft ones rise (the Neupert effect). Class {cls.toUpperCase()}:{' '}
        {CLASS_LABEL[cls]}. A schematic of a standard flare model, not a real flare.{' '}
        <ProvenanceBadge tag="model_dependent" />
      </p>
    </div>
  );
}
