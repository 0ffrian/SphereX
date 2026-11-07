// Texture panel of the test page (issue #11): a 2D "feel pad" per synthetic body and the Listen
// sweep (A8). Each body is a synthetic card + render params (textureObjects.ts) built through
// `buildHaptics`, exactly as the viewer will, so its refusals show here too. The pad shows the
// body's equirectangular map (or the coma / cloud seen face-on); dragging feels it, holding still
// for a moment plays the data pulse. The pad is also a keyboard control (arrow keys move the same
// point, R9 / WCAG 2.1.1). Synthetic inputs only: no fixtures, no backend.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buttonClass } from '@/app/ui';
import type { Tag } from '@/contract';
import { deviceVibrates } from '@/haptics/platform';
import { buildHaptics, TouchHaptics, type HapticsBuild } from '@/haptics/profiles';
import { TouchProbe } from '@/haptics/probe';
import {
  GAS_LINES_UM,
  ListenSweep,
  planSweep,
  type GasLine,
  type SweepGas,
} from '@/haptics/sound/listenSweep';
import { createTouchSample, type TouchSample } from '@/haptics/sources/types';
import { buildSpectrumMapping, type SpectrumMappingPoint } from '@/haptics/spectrumMapping';
import { UnlockButton } from '@/haptics/ui/UnlockButton';
import { HONESTY_LABEL, isTagShown, stateThatShows, type HonestyState } from '@/viewer/honesty';
import type { TestPanelProps } from '../panelProps';
import {
  BODY_LABEL,
  PAD_H as H,
  PAD_W as W,
  syntheticObject,
  type BodyKind,
  type SyntheticObject,
} from './textureObjects';

const fieldClass = 'flex w-full min-w-0 flex-col gap-1 sm:w-auto';
const selectClass =
  'min-h-11 w-full max-w-full rounded-md border border-neutral-500 bg-neutral-900 px-2 text-base';
const checkLabelClass = 'flex min-h-11 items-center gap-2';
const checkClass = 'h-6 w-6 shrink-0';
/** Arrow-key step across the pad, in pad px (64 steps across, 32 down). */
const KEY_STEP = W / 64;
/** Pad px → the px the hold-still rule sees: one key step is past HOLD_STILL_TOLERANCE_PX. */
const KEY_PX_SCALE = 2;

/** Ring plane radii felt across the pad in "rings" mode (fieldGenerator RING_INNER..RING_OUTER). */
const RING_FROM = 1.45;
const RING_SPAN = 1.1;

function drawPad(ctx: CanvasRenderingContext2D, obj: SyntheticObject): void {
  const im = obj.image;
  if (im.kind === 'map') {
    const img = ctx.createImageData(W, H);
    for (let r = 0; r < H; r++) {
      for (let c = 0; c < W; c++) {
        const g = Math.max(0, Math.min(255, Math.round(im.value(c, r) * 255)));
        const i = (r * W + c) * 4;
        img.data[i] = g;
        img.data[i + 1] = g;
        img.data[i + 2] = g;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return;
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  const [cx, cy] = faceToPx(0, 0);
  const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, H / (2 * FACE_HALF));
  g.addColorStop(0, `rgba(120, 220, 255, ${0.4 + 0.6 * im.density})`);
  g.addColorStop(1, 'rgba(120, 220, 255, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** Face-on pad: scene x, y in ±1.2 (y up) ↔ canvas px. The pad is 2:1, so x spans ±2.4. */
const FACE_HALF = 1.2;
function faceToPx(x: number, y: number): [number, number] {
  return [W / 2 + (x / (2 * FACE_HALF)) * H, H / 2 - (y / (2 * FACE_HALF)) * H];
}
function pxToFace(px: number, py: number): [number, number] {
  return [((px - W / 2) / H) * 2 * FACE_HALF, ((H / 2 - py) / H) * 2 * FACE_HALF];
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

type Touch = 'idle' | 'moving' | 'holding';

/** "shown only with + Artistic" or "shown from + Estimated": when `tag` is shown (D-21). */
function whenShown(tag: Tag): string {
  const from = stateThatShows(tag);
  return from === 'artistic' ? 'shown only with + Artistic' : `shown from ${HONESTY_LABEL[from]}`;
}

/** What the finger should be feeling right now, honest about the honesty gate (D-21). */
export function touchStatus(touch: Touch, build: HapticsBuild, honesty: HonestyState): string {
  if (touch === 'idle') return 'Not touching.';
  const now = `now ${HONESTY_LABEL[honesty]}`;
  const { texture, data } = build;
  if (touch === 'holding' && data?.trigger === 'hold') {
    return isTagShown(honesty, data.tag)
      ? `Holding still: data pulse (${data.tag}).`
      : `Data pulse silent: ${whenShown(data.tag)} (${now}).`;
  }
  if (texture) {
    if (!isTagShown(honesty, texture.tag)) {
      return `Texture silent: ${whenShown(texture.tag)} (${now}).`;
    }
    return texture.tag === 'artistic'
      ? 'Moving: texture (artist’s impression; plays only in + Artistic).'
      : 'Moving: texture.';
  }
  if (data && data.trigger === 'move') {
    return isTagShown(honesty, data.tag)
      ? `Moving: data field (${data.tag}).`
      : `Data field silent: ${whenShown(data.tag)} (${now}).`;
  }
  return 'Nothing to feel by moving here; hold still for the data pulse.';
}

/** Where on the pad a point is, in words (the keyboard value text). */
export function padRegion(px: number, py: number): string {
  const v = py < H / 3 ? 'upper' : py < (2 * H) / 3 ? 'middle' : 'lower';
  const h = px < W / 3 ? 'left' : px < (2 * W) / 3 ? 'centre' : 'right';
  return v === 'middle' && h === 'centre' ? 'centre' : `${v} ${h}`;
}

export function TexturePanel({ haptics }: TestPanelProps) {
  const { engine } = haptics;
  const [canVibrate] = useState(() => deviceVibrates(haptics.vibrate.supported));
  const [kind, setKind] = useState<BodyKind>('gas');
  const [teqTag, setTeqTag] = useState<Tag>('measured');
  const [epoch, setEpoch] = useState<'2025-08' | '2025-12'>('2025-08');
  const [onRing, setOnRing] = useState(false);
  const [touchState, setTouchState] = useState<Touch>('idle');
  // The honesty select lives in the Engine panel (#9); this panel samples the engine's state on
  // every interaction and keeps it here, so render never reads the engine.
  const [honesty, setHonesty] = useState<HonestyState>(() => engine.honesty);
  /** Keyboard point on the pad (pad px), and its spoken description. */
  const keyPos = useRef<[number, number]>([W / 2, H / 2]);
  const [valueText, setValueText] = useState('Centre. Not touching.');
  const [valueNow, setValueNow] = useState(50);
  const [gases, setGases] = useState<Record<SweepGas, boolean>>({
    h2o: true,
    co2: true,
    co: false,
  });
  const [sweepState, setSweepState] = useState('');
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const obj = useMemo(() => syntheticObject(kind, { teqTag, epoch }), [kind, teqTag, epoch]);
  const build = useMemo(
    () => buildHaptics(engine, obj.params, obj.card, obj.body, obj.options),
    [engine, obj],
  );
  const touch = useMemo(() => new TouchHaptics(build), [build]);
  // Reused per pointermove; refs, so render never mutates them.
  const sampleRef = useRef<TouchSample | null>(null);
  const probe = useMemo(() => new TouchProbe({ bodies: [] }), []);
  const frame = useRef<number | null>(null);
  const sweepRef = useRef<ListenSweep | null>(null);
  const mapping = useMemo(() => buildSpectrumMapping(syntheticSpectrum()), []);

  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) drawPad(ctx, obj);
    return () => touch.release();
  }, [obj, touch]);

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
      setHonesty(engine.honesty);
      if (touch.isHolding) setTouchState('holding');
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
  };
  const endTouch = () => {
    stopPolling();
    touch.release();
    setTouchState('idle');
    setHonesty(engine.honesty);
  };

  /** Feel pad point (px, py) in pad px; (xPx, yPx) is what the hold-still rule measures. */
  const feelAt = (px: number, py: number, xPx: number, yPx: number): Touch => {
    const pan = Math.max(-1, Math.min(1, (px / W) * 2 - 1));
    const now = performance.now();
    sampleRef.current ??= createTouchSample();
    const sample = sampleRef.current;
    if (obj.view === 'map') {
      sample.timeMs = now;
      sample.xPx = xPx;
      sample.yPx = yPx;
      sample.pan = pan;
      fillFromUV(sample, px / W, py / H);
      if (build.rings && onRing) {
        // The ring strip: x across the pad is the ring radius, inner to outer edge.
        sample.bodyId = null;
        sample.ringRadius = RING_FROM + (RING_SPAN * px) / W;
      }
    } else {
      const [x, y] = pxToFace(px, py);
      probe.fromWorldRay([x, y, 5], [0, 0, -1], xPx, yPx, pan, now, sample);
    }
    touch.move(sample);
    const state: Touch = touch.isHolding ? 'holding' : 'moving';
    setTouchState(state);
    setHonesty(engine.honesty);
    return state;
  };

  const feel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const py = ((e.clientY - rect.top) / rect.height) * H;
    keyPos.current = [px, py];
    feelAt(px, py, e.clientX, e.clientY);
  };

  /** Arrow keys move the same point the finger would, and emit the same events. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const step = d[e.key];
    if (!step) return;
    e.preventDefault();
    const [x0, y0] = keyPos.current;
    const px = Math.min(W - 0.5, Math.max(0.5, x0 + step[0]));
    const py = Math.min(H - 0.5, Math.max(0.5, y0 + step[1]));
    keyPos.current = [px, py];
    if (frame.current === null) startPolling();
    const state = feelAt(px, py, px * KEY_PX_SCALE, py * KEY_PX_SCALE);
    const h = engine.honesty;
    setValueText(`${BODY_LABEL[kind]}: ${padRegion(px, py)}. ${touchStatus(state, build, h)}`);
    setValueNow(Math.round((px / W) * 100));
  };

  const listen = () => {
    // Synthetic lines: each chime backed by a measured synthetic Q (D-21 filters by this tag).
    const lines: GasLine[] = (Object.keys(gases) as SweepGas[])
      .filter((g) => gases[g])
      .map((g) => ({ gas: g, lambdaUm: GAS_LINES_UM[g], tag: 'measured' }));
    const plan = planSweep(mapping, lines);
    if (!plan) {
      setSweepState('The spectrum has nothing to play.');
      return;
    }
    // unlock() creates the AudioContext synchronously inside this click (R8.9).
    void engine.unlock().then((running) => {
      if (!running) {
        setSweepState('Sound is not available here.');
        return;
      }
      setSweepState(
        getSweep().play(plan, engine.honesty)
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
        Drag on the pad, or focus it and use the arrow keys, to feel the surface; hold still for a
        moment to feel the data pulse. The surfaces are artist’s impressions: set Honesty to “+
        Artistic” in the Engine panel to feel them.
      </p>
      <p className="text-neutral-400">
        Synthetic test bodies: their values and tags are illustrative, not measurements. Some are
        tagged “measured” only to show what plays in Measured only.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <UnlockButton engine={engine} canVibrate={canVibrate} />
      </div>

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
        {(kind === 'gas' || kind === 'water' || kind === 'rocky') && (
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
              onChange={(e) => setEpoch(e.target.value as '2025-08' | '2025-12')}
            >
              <option value="2025-08">Aug 2025</option>
              <option value="2025-12">Dec 2025 (denser)</option>
            </select>
          </label>
        )}
        {build.rings && (
          <label className={checkLabelClass}>
            <input
              type="checkbox"
              className={checkClass}
              checked={onRing}
              onChange={(e) => setOnRing(e.target.checked)}
            />
            Feel the rings (pad x = ring radius)
          </label>
        )}
      </div>

      <div className="relative">
        <canvas
          ref={canvas}
          width={W}
          height={H}
          tabIndex={0}
          role="slider"
          aria-roledescription="feel pad"
          aria-label={`Feel pad: ${BODY_LABEL[kind]}, an artist’s impression. Arrow keys move; hold still for the data pulse.`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={valueNow}
          aria-valuetext={valueText}
          onKeyDown={onKeyDown}
          onBlur={endTouch}
          className="block w-full touch-none rounded-md border border-neutral-600 [image-rendering:pixelated] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            startPolling();
            feel(e);
          }}
          onPointerMove={(e) => {
            if (e.buttons !== 0 || e.pointerType === 'touch') feel(e);
          }}
          onPointerUp={endTouch}
          onPointerCancel={endTouch}
          onLostPointerCapture={endTouch}
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-2 left-2 rounded bg-neutral-900/80 px-2 py-0.5 text-sm text-neutral-100"
        >
          Artist’s impression
        </span>
      </div>
      {/* Shown always; announced only when a feel state starts (not on every lift). */}
      <p className="text-neutral-300">{touchStatus(touchState, build, honesty)}</p>
      <p aria-live="polite" className="sr-only">
        {touchState === 'idle' ? '' : touchStatus(touchState, build, honesty)}
      </p>
      {build.missing.length > 0 && (
        <p className="text-neutral-400">Not shown: no data for {build.missing.join(', ')}.</p>
      )}

      <fieldset className="flex flex-wrap items-center gap-4">
        <legend className="font-semibold">Listen sweep (synthetic spectrum, dip at 3 µm)</legend>
        {(Object.keys(GAS_LINES_UM) as SweepGas[]).map((g) => (
          <label key={g} className={checkLabelClass}>
            <input
              type="checkbox"
              className={checkClass}
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
