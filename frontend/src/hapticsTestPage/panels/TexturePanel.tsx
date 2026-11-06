// Texture panel of the test page (issue #11): a 2D "feel pad" per synthetic body, built from the
// same sources the viewer will use (R8.4, R8.5, D-12), and the Listen sweep (A8). The pad shows the
// body's equirectangular map (or the coma / cloud seen face-on); dragging feels it, holding still
// for a moment plays the data pulse. Synthetic inputs only: no fixtures, no backend.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass } from '@/app/ui';
import type { Tag } from '@/contract';
import { TouchHaptics, type HapticsBuild } from '@/haptics/profiles';
import { TouchProbe } from '@/haptics/probe';
import { GAS_LINES_UM, ListenSweep, planSweep, type SweepGas } from '@/haptics/sound/listenSweep';
import { HoldPulseSource, normaliseTeq, pulseRateHz } from '@/haptics/sources/dataPulse';
import { CometFieldSource, PointDensitySource } from '@/haptics/sources/field';
import { FlowSource } from '@/haptics/sources/flow';
import { HeightGrid, HeightMapSource } from '@/haptics/sources/heightMap';
import { TerrainSource } from '@/haptics/sources/terrain';
import { createTouchSample, type TouchSample } from '@/haptics/sources/types';
import { buildSpectrumMapping, type SpectrumMappingPoint } from '@/haptics/spectrumMapping';
import {
  FieldSampler,
  generateField,
  type FieldData,
  type FieldParams,
} from '@/viewer/fields/fieldGenerator';
import { generateNebula, type PointSet } from '@/viewer/renderers/pointClouds';
import type { TestPanelProps } from '../panelProps';

const W = 256;
const H = 128;
const SEED = 1234;
const fieldClass = 'flex flex-col gap-1';
const selectClass = 'min-h-11 rounded-md border border-neutral-500 bg-neutral-900 px-2 text-base';

type BodyKind = 'gas' | 'water' | 'rocky' | 'asteroid' | 'comet' | 'nebula';

const BODY_LABEL: Record<BodyKind, string> = {
  gas: 'Gas giant with rings (flow, Teq pulse)',
  water: 'Water world (terrain, Teq pulse)',
  rocky: 'Hot rocky world (terrain with lava cracks)',
  asteroid: 'Procedural asteroid (height map)',
  comet: 'Comet coma (field)',
  nebula: 'Nebula (point density)',
};

const TERRAIN = { kind: 'terrain', seed: SEED, bands: 0, turbulence: 0, storms: 0 } as const;
const FIELDS: Record<'gas' | 'water' | 'rocky', FieldParams> = {
  gas: {
    ...TERRAIN,
    kind: 'gas',
    freq: 0,
    seaLevel: 0,
    iceExtent: 0,
    heat: 0,
    bands: 12,
    turbulence: 0.5,
    storms: 5,
  },
  water: { ...TERRAIN, freq: 2, seaLevel: 0.4, iceExtent: 0.22, heat: 0 },
  rocky: { ...TERRAIN, freq: 1.6, seaLevel: 0, iceExtent: 0, heat: 1 },
};
const RINGS = 0.8;

interface Pad {
  build: HapticsBuild;
  /** 'map': equirectangular pad; 'face': the body seen face-on, ±1.2 units across. */
  view: 'map' | 'face';
  draw(ctx: CanvasRenderingContext2D): void;
}

function drawMap(ctx: CanvasRenderingContext2D, value: (c: number, r: number) => number): void {
  const img = ctx.createImageData(W, H);
  for (let r = 0; r < H; r++) {
    for (let c = 0; c < W; c++) {
      const g = Math.max(0, Math.min(255, Math.round(value(c, r) * 255)));
      const i = (r * W + c) * 4;
      img.data[i] = g;
      img.data[i + 1] = g;
      img.data[i + 2] = g;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawPoints(ctx: CanvasRenderingContext2D, sets: readonly PointSet[]): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(200, 220, 255, 0.35)';
  for (const s of sets) {
    for (let i = 0; i < s.count; i++) {
      const [x, y] = faceToPx(s.positions[3 * i]!, s.positions[3 * i + 1]!);
      ctx.fillRect(x, y, 1, 1);
    }
  }
}

/** Face-on pad: scene x, y in ±1.2 (y up) ↔ canvas px. The pad is 2:1, so x spans ±2.4. */
const FACE_HALF = 1.2;
function faceToPx(x: number, y: number): [number, number] {
  return [W / 2 + (x / (2 * FACE_HALF)) * H, H / 2 - (y / (2 * FACE_HALF)) * H];
}
function pxToFace(px: number, py: number): [number, number] {
  return [((px - W / 2) / H) * 2 * FACE_HALF, ((H / 2 - py) / H) * 2 * FACE_HALF];
}

function makePad(
  kind: BodyKind,
  engine: TestPanelProps['haptics']['engine'],
  teqTag: Tag,
  epoch: 'aug' | 'dec',
): Pad {
  const none: HapticsBuild = { texture: null, data: null, rings: false, missing: [] };
  const teq = (teqK: number) =>
    new HoldPulseSource(engine, 'teq_pulse', teqTag, pulseRateHz(normaliseTeq(teqK)));
  const texel = (f: FieldData, c: number, r: number, ch: number, b = false) =>
    (b ? f.b : f.a)[(r * f.width + c) * 4 + ch]!;

  if (kind === 'gas' || kind === 'water' || kind === 'rocky') {
    const p = FIELDS[kind];
    const data = generateField(p, W, H);
    const field = new FieldSampler(data);
    if (kind === 'gas') {
      return {
        view: 'map',
        build: {
          ...none,
          rings: true,
          texture: new FlowSource(engine, field, p, 'artistic', { rings: RINGS }),
          data: teq(1100),
        },
        draw: (ctx) =>
          drawMap(
            ctx,
            (c, r) => 0.2 + 0.6 * texel(data, c, r, 0) + (texel(data, c, r, 2) > 0 ? 0.2 : 0),
          ),
      };
    }
    return {
      view: 'map',
      build: {
        ...none,
        texture: new TerrainSource(engine, field, 'artistic', { lava: kind === 'rocky' }),
        data: kind === 'water' ? teq(300) : null,
      },
      draw: (ctx) =>
        drawMap(ctx, (c, r) =>
          texel(data, c, r, 0, true) >= 0.5
            ? 0.15
            : texel(data, c, r, 1, true) >= 0.5
              ? 0.95
              : texel(data, c, r, 2, true) >= 0.5
                ? 1
                : 0.3 + 0.6 * texel(data, c, r, 0),
        ),
    };
  }
  if (kind === 'asteroid') {
    // A synthetic relief: the terrain function's height, as a baked height map would hold it.
    const data = generateField({ ...FIELDS.rocky, heat: 0, freq: 3 }, W, H);
    const heights = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) heights[i] = data.a[i * 4]!;
    const grid = new HeightGrid(W, H, heights);
    return {
      view: 'map',
      build: { ...none, texture: new HeightMapSource(engine, grid, 'artistic') },
      draw: (ctx) => drawMap(ctx, (c, r) => grid.texel(c, r)),
    };
  }
  if (kind === 'comet') {
    // December denser than August (synthetic Q, normalised as the drawn shells).
    const qNorm = epoch === 'dec' ? 1 : 0.25;
    return {
      view: 'face',
      build: {
        ...none,
        data: new CometFieldSource(engine, 'model_dependent', { qNorm, nucleusRadius: 0.04 }),
      },
      draw: (ctx) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, W, H);
        const [cx, cy] = faceToPx(0, 0);
        const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, H / (2 * FACE_HALF));
        g.addColorStop(0, `rgba(120, 220, 255, ${0.4 + 0.6 * qNorm})`);
        g.addColorStop(1, 'rgba(120, 220, 255, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      },
    };
  }
  const points = generateNebula(SEED);
  const sets = { glow: points.glow, dust: points.dust, stars: points.stars };
  return {
    view: 'face',
    build: { ...none, data: new PointDensitySource(engine, sets, 'artistic') },
    draw: (ctx) => drawPoints(ctx, Object.values(sets)),
  };
}

/** Fill `s` from equirectangular pad coordinates (u, v) on a unit sphere. */
function fillFromUV(s: TouchSample, u: number, v: number): void {
  const theta = v * Math.PI;
  const phi = u * 2 * Math.PI;
  s.dir[0] = -Math.cos(phi) * Math.sin(theta);
  s.dir[1] = Math.cos(theta);
  s.dir[2] = Math.sin(phi) * Math.sin(theta);
  s.normal[0] = s.dir[0];
  s.normal[1] = s.dir[1];
  s.normal[2] = s.dir[2];
  s.u = u;
  s.v = v;
  s.bodyId = 'body';
  s.ringRadius = NaN;
}

/** Synthetic spectrum, 0.75–5 µm: a gentle slope with an absorption dip at 3 µm. */
function syntheticSpectrum(): SpectrumMappingPoint[] {
  const pts: SpectrumMappingPoint[] = [];
  for (let i = 0; i <= 120; i++) {
    const l = 0.75 + (4.25 * i) / 120;
    const dip = Math.exp(-(((l - 3) / 0.12) ** 2));
    pts.push({
      wavelength_um: l,
      flux: (1 - 0.1 * l) * (1 - 0.95 * dip),
      error: 0.01,
      flagged: false,
    });
  }
  return pts;
}

export function TexturePanel({ haptics }: TestPanelProps) {
  const { engine } = haptics;
  const [kind, setKind] = useState<BodyKind>('gas');
  const [teqTag, setTeqTag] = useState<Tag>('measured');
  const [epoch, setEpoch] = useState<'aug' | 'dec'>('aug');
  const [onRing, setOnRing] = useState(false);
  const [holding, setHolding] = useState(false);
  const [gases, setGases] = useState<Record<SweepGas, boolean>>({
    h2o: true,
    co2: true,
    co: false,
  });
  const [sweepState, setSweepState] = useState('');
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const pad = useMemo(() => makePad(kind, engine, teqTag, epoch), [kind, engine, teqTag, epoch]);
  const touch = useMemo(() => new TouchHaptics(pad.build), [pad]);
  // Reused per pointermove (no allocation in the hot path); refs, so render never mutates them.
  const sampleRef = useRef<TouchSample | null>(null);
  const probe = useMemo(() => new TouchProbe({ bodies: [] }), []);
  const frame = useRef<number | null>(null);
  const sweepRef = useRef<ListenSweep | null>(null);
  const mapping = useMemo(() => buildSpectrumMapping(syntheticSpectrum()), []);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) pad.draw(ctx);
    return () => touch.release();
  }, [pad, touch]);

  // Unmount: stop the sweep and the hold-still polling loop.
  useEffect(
    () => () => {
      sweepRef.current?.stop();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  const getSweep = (): ListenSweep => {
    if (!sweepRef.current) {
      const sw = new ListenSweep();
      sw.onEnd = () => setSweepState('Finished.');
      sweepRef.current = sw;
    }
    return sweepRef.current;
  };

  const stopPolling = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  };
  const startPolling = () => {
    stopPolling();
    const loop = () => {
      touch.poll(performance.now());
      setHolding(touch.isHolding);
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
  };

  const feel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    const pan = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1));
    const now = performance.now();
    sampleRef.current ??= createTouchSample();
    const sample = sampleRef.current;
    if (pad.view === 'map') {
      sample.timeMs = now;
      sample.xPx = e.clientX;
      sample.yPx = e.clientY;
      sample.pan = pan;
      fillFromUV(sample, px / W, py / H);
      if (kind === 'gas' && onRing) {
        // The ring strip: x across the pad is the ring radius, inner to outer edge.
        sample.bodyId = null;
        sample.ringRadius = 1.45 + (1.1 * px) / W;
      }
    } else {
      const [x, y] = pxToFace(px, py);
      probe.fromWorldRay([x, y, 5], [0, 0, -1], e.clientX, e.clientY, pan, now, sample);
    }
    touch.move(sample);
  };

  const listen = () => {
    const lines = (Object.keys(gases) as SweepGas[])
      .filter((g) => gases[g])
      .map((g) => ({ gas: g, lambdaUm: GAS_LINES_UM[g] }));
    const plan = planSweep(mapping, lines);
    // unlock() creates the AudioContext synchronously inside this click (R8.9).
    if (!plan) {
      setSweepState('The spectrum has nothing to play.');
      return;
    }
    void engine.unlock().then((running) => {
      if (!running) {
        setSweepState('Sound is not available here.');
        return;
      }
      setSweepState(
        getSweep().play(plan)
          ? 'Playing: short to long wavelength, left to right.'
          : 'Not played: sound is switched off in the Engine panel.',
      );
    });
  };

  return (
    <section
      aria-labelledby="texture-panel"
      className="flex flex-col gap-4 rounded-md border border-neutral-700 p-4"
    >
      <h2 id="texture-panel" className="text-lg font-semibold">
        Texture haptics and sound
      </h2>
      <p className="text-neutral-400">
        Turn on haptics and sound in the Engine panel first. Drag on the pad to feel the surface;
        hold still for a moment to feel the data pulse. Set Honesty to “+ Artistic” to feel the
        artist’s-impression textures.
      </p>

      <div className="flex flex-wrap gap-4">
        <label className={fieldClass}>
          Body
          <select
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as BodyKind)}
          >
            {(Object.keys(BODY_LABEL) as BodyKind[]).map((k) => (
              <option key={k} value={k}>
                {BODY_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        {(kind === 'gas' || kind === 'water') && (
          <label className={fieldClass}>
            Teq tag
            <select
              className={selectClass}
              value={teqTag}
              onChange={(e) => setTeqTag(e.target.value as Tag)}
            >
              <option value="measured">measured (pl_eqt)</option>
              <option value="derived">derived (A7.1)</option>
            </select>
          </label>
        )}
        {kind === 'comet' && (
          <label className={fieldClass}>
            Epoch
            <select
              className={selectClass}
              value={epoch}
              onChange={(e) => setEpoch(e.target.value as 'aug' | 'dec')}
            >
              <option value="aug">Aug 2025</option>
              <option value="dec">Dec 2025 (denser)</option>
            </select>
          </label>
        )}
        {kind === 'gas' && (
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={onRing} onChange={(e) => setOnRing(e.target.checked)} />
            Feel the rings (pad x = ring radius)
          </label>
        )}
      </div>

      <canvas
        ref={canvas}
        width={W}
        height={H}
        aria-label={`Feel pad: ${BODY_LABEL[kind]}. Drag to feel; hold still for the data pulse.`}
        className="w-full touch-none rounded-md border border-neutral-600 [image-rendering:pixelated]"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          startPolling();
          feel(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 0 || e.pointerType === 'touch') feel(e);
        }}
        onPointerUp={() => {
          stopPolling();
          touch.release();
          setHolding(false);
        }}
        onPointerCancel={() => {
          stopPolling();
          touch.release();
          setHolding(false);
        }}
        onLostPointerCapture={() => {
          stopPolling();
          touch.release();
          setHolding(false);
        }}
      />
      <p aria-live="polite" className="text-neutral-400">
        {holding ? 'Holding still: data pulse.' : 'Moving: texture.'}
      </p>

      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="font-semibold">Listen sweep (synthetic spectrum, dip at 3 µm)</legend>
        {(Object.keys(GAS_LINES_UM) as SweepGas[]).map((g) => (
          <label key={g} className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={gases[g]}
              onChange={(e) => setGases((s) => ({ ...s, [g]: e.target.checked }))}
            />
            {g === 'h2o' ? 'H₂O' : g === 'co2' ? 'CO₂' : 'CO'} chime ({GAS_LINES_UM[g]} µm)
          </label>
        ))}
        <button type="button" className={buttonClass} onClick={listen}>
          Listen
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            sweepRef.current?.stop();
            setSweepState('Stopped.');
          }}
        >
          Stop
        </button>
        <span aria-live="polite">{sweepState}</span>
      </fieldset>
    </section>
  );
}
