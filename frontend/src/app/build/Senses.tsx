// Issue #71 stream U (Q-294, Q-296): the build pane's "Feel it" and "Hear it" panels, laid out as the
// mock-up's `#popFeel` and `#popHear` (heading, plain sentence, one control). Never a fake:
//   Feel: the touch haptics (src/haptics/profiles.ts) are not wired to the 3D view until the phone
//   build (M5, see the TODO that was in BuildPane), so the panel says so and the vibration meter
//   stays empty. Nothing buzzes and nothing is drawn as if it did.
//   Hear it: the existing Listen sweep (src/haptics/sound/listenSweep.ts) over the object's own
//   SPHEREx spectrum (measured), under the honesty level (D-21). No spectrum, no sound.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/state/store';
import { ListenSweep, gasLinesForEpoch, planSweep } from '@/haptics/sound/listenSweep';
import { buildSpectrumMapping } from '@/haptics/spectrumMapping';
import { unlockAudio } from '@/haptics/audioContext';
import { getHapticSettings } from '@/haptics/settings';
import { effectiveHonesty } from '@/viewer/honesty';
import { epochsWithQ } from '@/viewer/renderers/Comet';
import { defaultContext } from '@/viewer/renderPlan';

export const FEEL_TEXT =
  'Bumps buzz and smooth ground stays quiet. On a phone it vibrates. Here you also hear it.';
export const FEEL_UNAVAILABLE =
  'Not available yet: the touch feedback is not switched on in this build, so nothing is felt or heard here.';

export function FeelPanel() {
  return (
    <>
      <div className="sx-pop-h">
        <b>Feel it</b>
        <span>Not available yet</span>
      </div>
      <p>{FEEL_TEXT}</p>
      <p className="sx-pop-note" data-testid="feel-unavailable">
        {FEEL_UNAVAILABLE}
      </p>
      <div className="sx-bw-head" aria-hidden="true">
        <span>Vibration</span>
        <b>&mdash;</b>
      </div>
    </>
  );
}

export const HEAR_NOTE_LOADING = 'Loading the spectrum of this object…';
export const HEAR_NOTE_NONE =
  'No SPHEREx spectrum for this object yet, so there is nothing to play.';
export const HEAR_NOTE_SOUND_OFF = 'Sound is switched off in the settings.';
export const HEAR_NOTE_NO_SOUND = 'This browser could not start sound.';

/** Plays a sweep along the object's measured spectrum; the canvas draws it with a moving marker. */
export function HearPanel({ active, name }: { active: boolean; name: string | undefined }) {
  const spectrum = useAppStore((s) => s.sky.spectrum);
  const resolved = useAppStore((s) => s.sky.resolved);
  const card = useAppStore((s) => s.card);
  const honesty = effectiveHonesty(useAppStore((s) => s.honesty));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sweepRef = useRef<ListenSweep | null>(null);
  const raf = useRef(0);
  const [state, setState] = useState<'idle' | 'playing' | 'ended' | 'failed'>('idle');

  // The spectrum is asked for when this panel is first opened (the sky session loads it the same
  // way for the spectrum tool); a request already made is not repeated.
  useEffect(() => {
    if (!active || !resolved) return;
    if (spectrum.status === 'idle') void useAppStore.getState().skyLoadSpectrum({ quiet: true });
  }, [active, resolved, spectrum.status]);

  const points = spectrum.status === 'ready' ? (spectrum.data?.spectrum ?? null) : null;
  const mapping = useMemo(() => (points ? buildSpectrumMapping(points) : null), [points]);
  const lines = useMemo(() => {
    if (!card) return [];
    const epoch = epochsWithQ(card).at(-1) ?? defaultContext().epoch;
    return gasLinesForEpoch(card, epoch);
  }, [card]);
  const plan = useMemo(() => (mapping ? planSweep(mapping, lines) : null), [mapping, lines]);

  const draw = (progress: number | null) => {
    const c = canvasRef.current;
    if (!c || !plan) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const n = plan.steps.length;
    const X = (i: number) => 8 + (i / (n - 1)) * (w - 16);
    const Y = (v: number) => h - 18 - Math.max(0, Math.min(1, v)) * (h - 36);
    g.strokeStyle = '#4ade80';
    g.lineWidth = 1.8;
    g.lineJoin = 'round';
    g.beginPath();
    plan.steps.forEach((s, i) => g.lineTo(X(i), Y(s.level)));
    g.stroke();
    g.fillStyle = '#9aa4a9';
    g.font = '10px ui-monospace,monospace';
    g.textAlign = 'left';
    g.fillText(`${plan.steps[0]!.lambdaUm.toFixed(2)} µm`, 8, h - 5);
    g.textAlign = 'right';
    g.fillText(`${plan.steps[n - 1]!.lambdaUm.toFixed(2)} µm`, w - 8, h - 5);
    if (progress !== null) {
      const i = Math.min(n - 1, Math.round(progress * (n - 1)));
      const px = X(i);
      g.strokeStyle = '#fafafa99';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px, 6);
      g.lineTo(px, h - 18);
      g.stroke();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(px, Y(plan.steps[i]!.level), 3.5, 0, 6.3);
      g.fill();
    }
  };

  useEffect(() => {
    if (active) draw(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draws when the plan or visibility changes
  }, [plan, active]);

  // Leaving the panel (another sense, or closing) stops the sound.
  useEffect(() => {
    if (active) return;
    sweepRef.current?.stop();
    cancelAnimationFrame(raf.current);
  }, [active]);
  useEffect(
    () => () => {
      sweepRef.current?.stop();
      cancelAnimationFrame(raf.current);
    },
    [],
  );
  useEffect(() => {
    sweepRef.current?.setHonesty(honesty);
  }, [honesty]);

  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  const play = async () => {
    if (!plan) return;
    const sweep = (sweepRef.current ??= new ListenSweep());
    if (sweep.playing) {
      sweep.stop();
      return;
    }
    if (!getHapticSettings().soundOn) {
      setState('failed');
      return;
    }
    // The click is the user activation the audio context needs (Q-73): created and resumed here.
    await unlockAudio();
    // The panel may have been left while the audio context woke: do not start a sound nobody asked for now.
    if (!activeRef.current) return;
    sweep.onEnd = () => {
      cancelAnimationFrame(raf.current);
      setState('ended');
      draw(null);
    };
    if (!sweep.play(plan, honesty)) {
      setState('failed');
      return;
    }
    setState('playing');
    const tick = () => {
      const p = sweep.progress();
      if (p === null) return;
      draw(p);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };

  const soundOff = !getHapticSettings().soundOn;
  const note = !resolved
    ? HEAR_NOTE_NONE
    : spectrum.status === 'idle' || spectrum.status === 'waiting' || spectrum.status === 'loading'
      ? HEAR_NOTE_LOADING
      : !plan
        ? HEAR_NOTE_NONE
        : state === 'failed'
          ? soundOff
            ? HEAR_NOTE_SOUND_OFF
            : HEAR_NOTE_NO_SOUND
          : `The measured SPHEREx spectrum of ${name ?? 'this object'}, not an example.`;
  const label = state === 'playing' ? 'Stop' : state === 'ended' ? 'Play again' : 'Play';
  const range = plan
    ? `${plan.steps[0]!.lambdaUm.toFixed(2)} to ${plan.steps[plan.steps.length - 1]!.lambdaUm.toFixed(2)} µm`
    : '0.75 to 5 µm';

  return (
    <>
      <div className="sx-pop-h">
        <b>Hear it</b>
        <span>Brightness becomes pitch</span>
      </div>
      <p>
        A sweep across the object&rsquo;s infrared fingerprint, {range}. Higher pitch is brighter.
        {lines.length > 0 ? ' Bells mark gases and dips.' : ' Quiet dips stay silent.'}
      </p>
      {plan ? (
        <canvas
          ref={canvasRef}
          className="sx-hear-canvas"
          role="img"
          aria-label={`The spectrum of ${name ?? 'this object'}, ${range}, brightness against colour`}
          data-testid="hear-canvas"
        />
      ) : (
        <div className="sx-hear-canvas sx-hear-empty" aria-hidden="true" />
      )}
      <div className="sx-pop-row">
        <button
          type="button"
          className="sx-btn-sm"
          disabled={!plan}
          onClick={() => void play()}
          data-testid="hear-play"
        >
          {label}
        </button>
        <span className="sx-pop-note" role="status" data-testid="hear-note">
          {note}
        </span>
      </div>
    </>
  );
}
