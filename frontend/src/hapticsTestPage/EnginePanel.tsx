// Engine panel of the test page (issue #9): every kind, level and tag, trains at 1–20 Hz, the
// driver switches, latency readout and the pulse indicator. Synthetic events only.
import { useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { buttonClass } from '@/app/ui';
import { TAGS, type HapticEvent, type HapticVoice, type Tag } from '@/contract';
import { HAPTIC_DEBUG_EVENT } from '@/haptics/haptics';
import { deviceVibrates } from '@/haptics/platform';
import { useHapticSettings } from '@/haptics/settings';
import { PulseIndicator } from '@/haptics/ui/PulseIndicator';
import { UnlockButton } from '@/haptics/ui/UnlockButton';
import { HONESTY_LABEL, HONESTY_STATES, type HonestyState } from '@/viewer/honesty';
import type { TestPanelProps } from './panelProps';

const STRENGTHS = [0.1, 0.4, 0.6, 0.9] as const;
const TRAIN_RATES = [1, 2, 4, 12, 20] as const;
const VOICES: (HapticVoice | 'none')[] = ['none', 'tone', 'click', 'surf', 'chime'];
const TRAIN_ID = 'test-page';
const LOG_SIZE = 10;

const fieldClass = 'flex w-full min-w-0 flex-col gap-1 sm:w-48';
const selectClass =
  'min-h-11 w-full max-w-full rounded-md border border-neutral-500 bg-neutral-900 px-2 text-base';
// 24 px targets (R9, WCAG 2.5.8).
const checkboxClass = 'h-6 w-6 shrink-0 accent-sky-400';
const rangeClass = 'h-6 w-full max-w-full accent-sky-400';

function describeEvent(e: HapticEvent): string {
  const parts = [e.kind, `strength ${e.strength.toFixed(2)}`, e.tag];
  if (e.rateHz !== undefined) parts.push(`${e.rateHz} Hz`);
  if (e.voice) parts.push(`voice ${e.voice}`);
  return parts.join(' · ');
}

export function EnginePanel({ haptics }: TestPanelProps) {
  const { engine, vibrate, audio } = haptics;
  // navigator.vibrate exists in desktop Chrome too; only an Android phone really vibrates.
  const [canVibrate] = useState(() => deviceVibrates(vibrate.supported));
  const settings = useHapticSettings(
    useShallow((s) => ({
      hapticsOn: s.hapticsOn,
      soundOn: s.soundOn,
      volume: s.volume,
      strengthMultiplier: s.strengthMultiplier,
      update: s.update,
    })),
  );
  const [honesty, setHonesty] = useState<HonestyState>(engine.honesty);
  const [tag, setTag] = useState<Tag>('measured');
  const [voice, setVoice] = useState<HapticVoice | 'none'>('none');
  const [pitch, setPitch] = useState(0.5);
  const [pan, setPan] = useState(0);
  const [latency, setLatency] = useState('not read yet');
  const [log, setLog] = useState<string[]>([]);
  const [result, setResult] = useState('');

  useEffect(() => {
    const onHaptic = (ev: Event) => {
      const line = describeEvent((ev as CustomEvent<HapticEvent>).detail);
      setLog((l) => [line, ...l].slice(0, LOG_SIZE));
    };
    window.addEventListener(HAPTIC_DEBUG_EVENT, onHaptic);
    return () => window.removeEventListener(HAPTIC_DEBUG_EVENT, onHaptic);
  }, []);

  const extras = { pitch, pan, ...(voice === 'none' ? {} : { voice }) };

  const play = (kind: HapticEvent['kind'], strength: number) => {
    const played = engine.emit({ kind, strength, tag, ...extras });
    setResult(
      played ? `${kind} played` : `${kind} not played (hidden by honesty, or rate-limited)`,
    );
  };

  const startTrain = (rateHz: number) => {
    const ok = engine.startTrain(TRAIN_ID, { rateHz, strength: 0.6, tag, ...extras });
    setResult(
      ok ? `${rateHz} Hz train playing` : 'Train not started: hidden by the honesty setting',
    );
  };

  const readLatency = () => {
    const l = audio.outputLatency();
    setLatency(
      l === null
        ? 'outputLatency not reported (audio not on yet, or not supported)'
        : `${Math.round(l * 1000)} ms${audio.isHighLatency() ? ': high, try the phone speaker or wired earphones' : ''}`,
    );
  };

  return (
    <section
      aria-labelledby="engine-panel"
      className="flex flex-col gap-4 rounded-md border border-neutral-700 p-4"
    >
      <div className="flex items-center gap-3">
        <h2 id="engine-panel" className="text-lg font-semibold">
          Engine
        </h2>
        <PulseIndicator />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <UnlockButton engine={engine} canVibrate={canVibrate} />
        <span>Vibration: {canVibrate ? 'available' : 'not available on this device'}</span>
      </div>

      <fieldset className="flex flex-wrap gap-4">
        <legend className="font-semibold">Outputs</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={settings.hapticsOn}
            onChange={(e) => settings.update({ hapticsOn: e.target.checked })}
          />
          Vibration
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            className={checkboxClass}
            checked={settings.soundOn}
            onChange={(e) => settings.update({ soundOn: e.target.checked })}
          />
          Sound
        </label>
        <label className={fieldClass}>
          Volume {Math.round(settings.volume * 100)}%
          <input
            type="range"
            className={rangeClass}
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(e) => settings.update({ volume: Number(e.target.value) })}
          />
        </label>
        <label className={fieldClass}>
          Strength × {settings.strengthMultiplier.toFixed(2)}
          <input
            type="range"
            className={rangeClass}
            min={0.5}
            max={1.5}
            step={0.05}
            value={settings.strengthMultiplier}
            onChange={(e) => settings.update({ strengthMultiplier: Number(e.target.value) })}
          />
        </label>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <label className={fieldClass}>
          Honesty
          <select
            className={selectClass}
            value={honesty}
            onChange={(e) => {
              const s = e.target.value as HonestyState;
              engine.setHonesty(s);
              setHonesty(s);
            }}
          >
            {HONESTY_STATES.map((s) => (
              <option key={s} value={s}>
                {HONESTY_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldClass}>
          Event tag
          <select
            className={selectClass}
            value={tag}
            onChange={(e) => setTag(e.target.value as Tag)}
          >
            {TAGS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldClass}>
          Voice
          <select
            className={selectClass}
            value={voice}
            onChange={(e) => setVoice(e.target.value as HapticVoice | 'none')}
          >
            {VOICES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className={fieldClass}>
          Pitch {pitch.toFixed(2)}
          <input
            type="range"
            className={rangeClass}
            min={0}
            max={1}
            step={0.05}
            value={pitch}
            onChange={(e) => setPitch(Number(e.target.value))}
          />
        </label>
        <label className={fieldClass}>
          Pan {pan.toFixed(2)}
          <input
            type="range"
            className={rangeClass}
            min={-1}
            max={1}
            step={0.1}
            value={pan}
            onChange={(e) => setPan(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">
          Ticks by strength (level = bin of {vibrate.levels.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {STRENGTHS.map((s) => (
            <button key={s} type="button" className={buttonClass} onClick={() => play('tick', s)}>
              Tick {s} (level {vibrate.levelIndex(s * settings.strengthMultiplier) + 1})
            </button>
          ))}
          <button type="button" className={buttonClass} onClick={() => play('double', 1)}>
            Double
          </button>
          <button type="button" className={buttonClass} onClick={() => play('heartbeat', 1)}>
            Heartbeat
          </button>
          <button type="button" className={buttonClass} onClick={() => play('stop', 0)}>
            Stop all
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="font-semibold">Pulse trains</h3>
        <div className="flex flex-wrap gap-2">
          {TRAIN_RATES.map((r) => (
            <button key={r} type="button" className={buttonClass} onClick={() => startTrain(r)}>
              {r} Hz
            </button>
          ))}
          <button type="button" className={buttonClass} onClick={() => engine.stopTrain(TRAIN_ID)}>
            Stop train
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={buttonClass} onClick={readLatency}>
          Read audio latency
        </button>
        <span>{latency}</span>
      </div>

      <p aria-live="polite">{result}</p>

      <div>
        <h3 className="font-semibold">Last events played</h3>
        <ol className="font-mono text-sm text-neutral-300">
          {log.map((line, i) => (
            <li key={`${i}-${line}`}>{line}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
