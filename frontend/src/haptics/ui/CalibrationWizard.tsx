// R8.7 first-use calibration, three short steps, only on devices that vibrate (D-08, D-09, D-10):
//   1. faintest pulse: 5 / 10 / 20 ms probes → `minMs`
//   2. distinct levels: whisper, soft, medium, firm → 3 or 4 levels (whisper dropped if not distinct)
//   3. tap-along: a vibration-only beat, then a sound-only beat → `avOffsetMs` (Q-63)
// Every step can be skipped (it keeps the R8.3 default). The result is saved under the one
// localStorage key and applied to the drivers. Step changes are announced (aria-live); the
// tap-along takes the Space or Enter key as well as touch (R9).
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { buttonClass } from '@/app/ui';
import {
  CALIBRATION_VERSION,
  FOUR_LEVELS,
  THREE_LEVELS,
  applyCalibration,
  beatPlan,
  computeAvOffset,
  defaultCalibration,
  levelSetFromAnswers,
  levelsToVibrate,
  meanTapLag,
  minMsFromAnswer,
  saveCalibration,
  sequencePattern,
  soundBeatWindow,
  vibrationBeatPattern,
  type Calibration,
  type CalibrationLevel,
} from '../calibration';
import type { VibrateFn } from '../drivers/webVibrate';
import type { HapticOutputs } from '../haptics';
import { CALIBRATION_PROBE_MS } from '../tuning';

export interface CalibrationWizardProps {
  haptics: HapticOutputs;
  /**
   * The raw `navigator.vibrate` for the probe and beat patterns (they bypass the levels and the
   * delay being calibrated). Default: the browser's, when it exists. Tests inject a recorder.
   */
  vibrate?: VibrateFn | null;
  /** Clock for the tap-along (ms). Default: event time stamps and `performance.now`. */
  now?: () => number;
  /** Called with the saved calibration when the user finishes. */
  onDone?: (cal: Calibration, saved: boolean) => void;
  /** Close without saving. */
  onCancel?: () => void;
}

type Step = 'intro' | 'faintest' | 'levels' | 'tap' | 'done';
type TapPhase =
  | 'ready-vibration'
  | 'vibration'
  | 'vibration-failed'
  | 'ready-sound'
  | 'sound'
  | 'sound-failed'
  | 'no-sound'
  | 'measured';

const PROBE_NAMES = ['First', 'Second', 'Third'] as const;
const STEP_TITLE: Record<Exclude<Step, 'intro' | 'done'>, string> = {
  faintest: 'Step 1 of 3: the faintest pulse',
  levels: 'Step 2 of 3: how many strengths you can tell apart',
  tap: 'Step 3 of 3: tap along',
};

function defaultNow(): number {
  return performance.now();
}

function PlainButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={buttonClass} onClick={onClick}>
      {label}
    </button>
  );
}

function browserVibrate(): VibrateFn | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (p) => navigator.vibrate(p);
}

export function CalibrationWizard({
  haptics,
  vibrate,
  now,
  onDone,
  onCancel,
}: CalibrationWizardProps) {
  const [vibrateFn] = useState<VibrateFn | null>(() =>
    vibrate !== undefined ? vibrate : browserVibrate(),
  );
  const supported = haptics.vibrate.supported && vibrateFn !== null;
  const id = useId();

  const [step, setStep] = useState<Step>('intro');
  const [status, setStatus] = useState('');
  const [minMs, setMinMs] = useState(() => defaultCalibration().minMs);
  const [noneFelt, setNoneFelt] = useState(false);
  const [levels, setLevels] = useState<CalibrationLevel[]>(() => [...THREE_LEVELS]);
  const [avOffsetMs, setAvOffsetMs] = useState(0);
  const [offsetMeasured, setOffsetMeasured] = useState(false);
  const [tapPhase, setTapPhase] = useState<TapPhase>('ready-vibration');
  const [tapCount, setTapCount] = useState(0);
  const [result, setResult] = useState<{ cal: Calibration; saved: boolean } | null>(null);

  // Tap-along bookkeeping, touched only in handlers and timers.
  const taps = useRef<number[]>([]);
  const beats = useRef<number[]>([]);
  const vibrationLag = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The audio offset in force before a running sound beat zeroed it; null when none runs. */
  const savedOffset = useRef<number | null>(null);
  const tapButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const clock = now ?? defaultNow;

  // Leaving mid-beat: stop the timer and give the audio driver its offset back.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
      if (savedOffset.current !== null) haptics.audio.setOffsetMs(savedOffset.current);
      savedOffset.current = null;
    },
    [haptics],
  );

  // Move focus to the new step's heading so keyboard and screen reader users follow along.
  useEffect(() => {
    if (step !== 'intro') heading.current?.focus();
  }, [step]);

  useEffect(() => {
    if (tapPhase === 'vibration' || tapPhase === 'sound') tapButton.current?.focus();
  }, [tapPhase]);

  const go = (next: Step, announce?: string) => {
    setStep(next);
    setStatus(announce ?? (next === 'done' || next === 'intro' ? '' : STEP_TITLE[next]));
  };

  const restoreOffset = () => {
    if (savedOffset.current !== null) haptics.audio.setOffsetMs(savedOffset.current);
    savedOffset.current = null;
  };

  const play = (pattern: number[]) => {
    haptics.engine.stop();
    vibrateFn?.(pattern);
  };

  // ------------------------------------------------------------ step 1

  const playProbes = () => play(sequencePattern(CALIBRATION_PROBE_MS));
  const pickFaintest = (index: number | null) => {
    setMinMs(minMsFromAnswer(index));
    setNoneFelt(index === null);
    go('levels');
  };

  // ------------------------------------------------------------ step 2

  const playLevels = () =>
    play(
      sequencePattern(
        levelsToVibrate({
          version: CALIBRATION_VERSION,
          minMs,
          levels: [...FOUR_LEVELS],
          avOffsetMs: 0,
        }),
      ),
    );
  const answerLevels = (whisperFelt: boolean, whisperDistinct: boolean) => {
    setLevels(levelSetFromAnswers({ whisperFelt, whisperDistinct }));
    go('tap');
  };

  // ------------------------------------------------------------ done (used by step 3)

  const finish = (offset: number = avOffsetMs) => {
    const cal: Calibration = { version: CALIBRATION_VERSION, minMs, levels, avOffsetMs: offset };
    const saved = saveCalibration(cal);
    applyCalibration(haptics, cal);
    setResult({ cal, saved });
    go('done', saved ? 'Calibration saved on this device.' : 'Calibration applied, not saved.');
    onDone?.(cal, saved);
  };

  // ------------------------------------------------------------ step 3

  const plan = beatPlan();
  const beatLengthMs = plan.count * plan.periodMs + plan.periodMs;

  const finishBeat = (channel: 'vibration' | 'sound') => {
    timer.current = null;
    const lag = meanTapLag(taps.current, beats.current, plan.periodMs);
    if (channel === 'vibration') {
      vibrationLag.current = lag;
      if (lag === null) {
        setTapPhase('vibration-failed');
        setStatus('Not enough taps on the beat. Try again, or skip this step.');
      } else {
        setTapPhase('ready-sound');
        setStatus('Got it. Now the same with sound only.');
      }
      return;
    }
    restoreOffset();
    const off = computeAvOffset(vibrationLag.current, lag);
    if (off === null) {
      setTapPhase('sound-failed');
      setStatus('Not enough taps on the beat. Try again, or skip this step.');
      return;
    }
    setAvOffsetMs(off);
    setOffsetMeasured(true);
    setTapPhase('measured');
    setStatus(`Offset measured: ${describeOffset(off)}`);
  };

  const startBeat = (channel: 'vibration' | 'sound') => {
    if (timer.current !== null) clearTimeout(timer.current);
    haptics.engine.stop();
    taps.current = [];
    setTapCount(0);
    const begin = () => {
      const t0 = clock();
      beats.current = plan.offsetsMs.map((o) => t0 + o);
      if (channel === 'vibration') {
        vibrateFn?.(vibrationBeatPattern(plan));
      } else {
        // Measure with no offset applied, through the audio driver's own scheduling.
        savedOffset.current ??= haptics.audio.offsetMs;
        haptics.audio.setOffsetMs(0);
        haptics.audio.playTrain(soundBeatWindow(plan));
      }
      setTapPhase(channel);
      setStatus(
        channel === 'vibration'
          ? 'Vibration beat playing. Tap along.'
          : 'Sound beat playing. Tap along.',
      );
      timer.current = setTimeout(() => finishBeat(channel), beatLengthMs);
    };
    if (channel === 'vibration') {
      begin();
      return;
    }
    // The sound needs a running AudioContext; this click is the user gesture that resumes it.
    void haptics.engine.unlock().then((running) => {
      if (running && haptics.audio.supported) begin();
      else {
        setTapPhase('no-sound');
        setStatus('Sound is not available here, so the offset cannot be measured.');
      }
    });
  };

  const recordTap = (t: number) => {
    if (tapPhase !== 'vibration' && tapPhase !== 'sound') return;
    taps.current.push(t);
    setTapCount(taps.current.length);
  };
  const onTapPointer = (e: PointerEvent<HTMLButtonElement>) => recordTap(now ? now() : e.timeStamp);
  const onTapKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault(); // no click, no page scroll
    if (!e.repeat) recordTap(now ? now() : e.timeStamp);
  };

  const skipTap = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    haptics.engine.stop();
    restoreOffset();
    setAvOffsetMs(0);
    setOffsetMeasured(false);
    finish(0);
  };

  // ------------------------------------------------------------ render

  const titleId = `${id}-title`;

  let body: ReactNode;
  if (!supported) {
    body = (
      <>
        <h3 id={titleId} className="text-lg font-semibold">
          Vibration calibration
        </h3>
        <p>
          This device cannot vibrate, so there is nothing to calibrate. Everything you would feel
          also plays as sound.
        </p>
        {onCancel && <PlainButton label="Close" onClick={onCancel} />}
      </>
    );
  } else if (step === 'intro') {
    body = (
      <>
        <h3 id={titleId} className="text-lg font-semibold">
          Calibrate vibration for this phone
        </h3>
        <p>
          Three short steps, about a minute. You can skip any of them. Turn off battery saver first:
          it can stop the phone vibrating.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              void haptics.engine.unlock();
              go('faintest');
            }}
          >
            Start
          </button>
          {onCancel && <PlainButton label="Not now" onClick={onCancel} />}
        </div>
      </>
    );
  } else if (step === 'faintest') {
    body = (
      <>
        <h3 id={titleId} ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {STEP_TITLE.faintest}
        </h3>
        <p>Play three pulses, from weakest to strongest. Then pick the faintest one you felt.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={playProbes}>
            Play the three pulses
          </button>
        </div>
        <div role="group" aria-label="Faintest pulse you felt" className="flex flex-wrap gap-2">
          {CALIBRATION_PROBE_MS.map((ms, i) => (
            <button key={ms} type="button" className={buttonClass} onClick={() => pickFaintest(i)}>
              {PROBE_NAMES[i] ?? `Pulse ${i + 1}`} ({ms} ms)
            </button>
          ))}
          <button type="button" className={buttonClass} onClick={() => pickFaintest(null)}>
            I felt none
          </button>
        </div>
        <PlainButton label="Skip this step" onClick={() => go('levels')} />
      </>
    );
  } else if (step === 'levels') {
    body = (
      <>
        <h3 id={titleId} ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {STEP_TITLE.levels}
        </h3>
        <p>
          Play four buzzes, from weakest to strongest. Was the first, faintest one different from
          the second?
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={playLevels}>
            Play the four buzzes
          </button>
        </div>
        <div role="group" aria-label="The first buzz" className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => answerLevels(true, true)}>
            Yes, it was different
          </button>
          <button type="button" className={buttonClass} onClick={() => answerLevels(true, false)}>
            No, they felt the same
          </button>
          <button type="button" className={buttonClass} onClick={() => answerLevels(false, false)}>
            I did not feel the first one
          </button>
        </div>
        <PlainButton label="Skip this step" onClick={() => answerLevels(false, false)} />
      </>
    );
  } else if (step === 'tap') {
    const collecting = tapPhase === 'vibration' || tapPhase === 'sound';
    body = (
      <>
        <h3 id={titleId} ref={heading} tabIndex={-1} className="text-lg font-semibold">
          {STEP_TITLE.tap}
        </h3>
        <p>
          A steady beat plays twice: first as vibration only, then as sound only. Tap the button
          below (or press Space) in time with each beat.
        </p>
        <div className="flex flex-wrap gap-2">
          {(tapPhase === 'ready-vibration' || tapPhase === 'vibration-failed') && (
            <button type="button" className={buttonClass} onClick={() => startBeat('vibration')}>
              {tapPhase === 'ready-vibration' ? 'Start the vibration beat' : 'Try again'}
            </button>
          )}
          {(tapPhase === 'ready-sound' || tapPhase === 'sound-failed') && (
            <button type="button" className={buttonClass} onClick={() => startBeat('sound')}>
              {tapPhase === 'ready-sound' ? 'Start the sound beat' : 'Try the sound beat again'}
            </button>
          )}
          {tapPhase === 'measured' && (
            <button type="button" className={buttonClass} onClick={() => finish()}>
              Save calibration
            </button>
          )}
        </div>
        {collecting && (
          <button
            ref={tapButton}
            type="button"
            className={`${buttonClass} min-h-24 w-full text-lg`}
            onPointerDown={onTapPointer}
            onKeyDown={onTapKey}
            aria-describedby={`${id}-taps`}
          >
            Tap
          </button>
        )}
        {collecting && (
          <p id={`${id}-taps`} className="text-sm text-neutral-400">
            {tapCount} {tapCount === 1 ? 'tap' : 'taps'}
          </p>
        )}
        {tapPhase === 'measured' && <p>Offset: {describeOffset(avOffsetMs)}</p>}
        {tapPhase !== 'measured' && (
          <PlainButton
            label={tapPhase === 'no-sound' ? 'Save without the offset' : 'Skip this step'}
            onClick={skipTap}
          />
        )}
      </>
    );
  } else {
    const cal = result?.cal;
    body = (
      <>
        <h3 id={titleId} ref={heading} tabIndex={-1} className="text-lg font-semibold">
          Calibration done
        </h3>
        {cal && (
          <ul className="list-disc pl-5">
            <li>Faintest pulse: {cal.minMs} ms</li>
            <li>
              Strength levels: {cal.levels.length} ({cal.levels.join(', ')})
            </li>
            <li>
              Sound and vibration offset:{' '}
              {offsetMeasured ? describeOffset(cal.avOffsetMs) : 'not measured (0 ms)'}
            </li>
          </ul>
        )}
        {noneFelt && (
          <p>
            No pulse was felt. Check that vibration is on in the phone settings and battery saver is
            off, then calibrate again.
          </p>
        )}
        <p>
          {result?.saved
            ? 'Saved on this device. You can calibrate again from the settings.'
            : 'Could not save on this device; it applies until you close the page.'}
        </p>
        {onCancel && <PlainButton label="Close" onClick={onCancel} />}
      </>
    );
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-3">
      {body}
      <p aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}

/** A human sentence for an offset (R8.9 sign rule). */
export function describeOffset(ms: number): string {
  if (ms === 0) return '0 ms, in step';
  return ms > 0
    ? `${ms} ms; vibration is felt later, so sound will wait ${ms} ms`
    : `${-ms} ms; sound is heard later, so vibration will wait ${-ms} ms`;
}
