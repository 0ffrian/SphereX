// R8.7 first-use calibration, three short steps, only on phones that vibrate (D-08, D-09, D-10):
//   1. faintest pulse: 5 / 10 / 20 ms probes → `minMs`
//   2. distinct levels: whisper, soft, medium, firm → 3 or 4 levels (the whisper is kept only when
//      it is felt and weaker than soft)
//   3. tap-along: a vibration-only beat, then a sound-only beat → `avOffsetMs` (Q-75)
// Every step can be skipped, and a skipped step keeps what this device already has saved (or the
// R8.3 default). Cancel leaves at any point without saving and stops anything still playing. The
// result is saved under the one localStorage key and applied to the drivers.
// Accessibility (R9, WCAG 3.3.1): focus moves to each step's heading (and on open to the intro,
// scrolled into view), then to the next action; status and failure messages are visible in a
// role="status" line (step titles are not repeated there, the focused heading says them); the
// tap-along takes Space or Enter as well as touch; closing returns focus to `returnFocusRef`.
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { buttonClass } from '@/app/ui';
import {
  CALIBRATION_VERSION,
  FOUR_LEVELS,
  applyCalibration,
  beatPlan,
  calibrationAvailable,
  computeAvOffset,
  defaultCalibration,
  levelSetFromAnswers,
  levelsToVibrate,
  loadCalibration,
  minMsFromAnswer,
  saveCalibration,
  sequencePattern,
  soundBeatWindow,
  tapLag,
  vibrationBeatPattern,
  type Calibration,
  type CalibrationLevel,
  type TapLag,
} from '../calibration';
import type { VibrateFn } from '../drivers/webVibrate';
import type { HapticOutputs } from '../haptics';
import { platformEnv, type PlatformEnv } from '../platform';
import { ensureLoaded, useHapticSettings } from '../settings';
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
  /** Android + touch screen (R8.7 "phones that vibrate"). Default: read from the browser. */
  platform?: PlatformEnv;
  /** Called when the user finishes: the calibration in force, and whether it was saved. */
  onDone?: (cal: Calibration, saved: boolean) => void;
  /** Leave (Cancel at any step, or Close at the end). Nothing is saved by cancelling. */
  onCancel?: () => void;
  /** Where focus goes when the wizard closes (the button that opened it). */
  returnFocusRef?: RefObject<HTMLElement | null>;
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
const headingClass = 'text-lg font-semibold';
const NBSP = '\u00a0';

function defaultNow(): number {
  return performance.now();
}

function failure(r: TapLag): string {
  return !r.ok && r.reason === 'irregular'
    ? 'The taps were too uneven to measure. Try again, or skip this step.'
    : 'Not enough taps on the beat. Try again, or skip this step.';
}

function PlainButton({
  label,
  onClick,
  buttonRef,
  disabled,
}: {
  label: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  disabled?: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      className={buttonClass}
      onClick={onClick}
      disabled={disabled}
    >
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
  platform,
  onDone,
  onCancel,
  returnFocusRef,
}: CalibrationWizardProps) {
  const [vibrateFn] = useState<VibrateFn | null>(() =>
    vibrate !== undefined ? vibrate : browserVibrate(),
  );
  const [env] = useState<PlatformEnv>(() => platform ?? platformEnv());
  const supported = vibrateFn !== null && calibrationAvailable(haptics.vibrate.supported, env);
  const id = useId();

  // What this device has now: a skipped step keeps it.
  const [stored] = useState<Calibration | null>(loadCalibration);
  const [base] = useState<Calibration>(() => stored ?? defaultCalibration());
  const [step, setStep] = useState<Step>('intro');
  const [status, setStatus] = useState({ text: '', seq: 0 });
  const [minMs, setMinMs] = useState(base.minMs);
  const [levels, setLevels] = useState<CalibrationLevel[]>(() => [...base.levels]);
  const [avOffsetMs, setAvOffsetMs] = useState(base.avOffsetMs);
  const [measured, setMeasured] = useState({ minMs: false, levels: false, offset: false });
  const [noneFelt, setNoneFelt] = useState(false);
  const [played, setPlayed] = useState({ probes: false, levels: false });
  const [tapPhase, setTapPhase] = useState<TapPhase>('ready-vibration');
  const [tapCount, setTapCount] = useState(0);
  const [beatNo, setBeatNo] = useState(0);
  const [result, setResult] = useState<{ cal: Calibration; saved: boolean } | null>(null);

  // Tap-along and playback bookkeeping, touched only in handlers, timers and effects.
  const taps = useRef<number[]>([]);
  const beats = useRef<number[]>([]);
  const vibrationLag = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const beatTicker = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The audio offset in force before a running sound beat zeroed it; null when none runs. */
  const savedOffset = useRef<number | null>(null);
  /** A raw vibrate pattern / a sound beat was sent and may still be playing. */
  const rawSent = useRef(false);
  const soundSent = useRef(false);
  /** A sound beat is waiting for the AudioContext to resume. */
  const soundPending = useRef(false);
  const mounted = useRef(true);
  /** Focus is inside the wizard: when it unmounts, focus goes back to `returnFocusRef`. */
  const focusInside = useRef(false);
  /** The latest `returnFocusRef`, read when the wizard unmounts. */
  const returnTarget = useRef(returnFocusRef);
  const tapButton = useRef<HTMLButtonElement>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  const clock = now ?? defaultNow;

  // Leaving (unmount) mid-step: stop the timers, the raw pattern and any scheduled sound, give
  // the audio driver its offset back, and return focus if it was in here.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
      if (beatTicker.current !== null) clearInterval(beatTicker.current);
      timer.current = null;
      beatTicker.current = null;
      if (rawSent.current) vibrateFn?.(0);
      if (soundSent.current) haptics.audio.stop();
      rawSent.current = false;
      soundSent.current = false;
      if (savedOffset.current !== null) haptics.audio.setOffsetMs(savedOffset.current);
      savedOffset.current = null;
      if (focusInside.current) returnTarget.current?.current?.focus();
    };
  }, [haptics, vibrateFn]);

  useEffect(() => {
    returnTarget.current = returnFocusRef;
  }, [returnFocusRef]);

  // Focus follows the step: its heading (on open too, scrolled into view, so a tap on a button
  // far below visibly opens the wizard), then in the tap-along the next thing to press.
  useEffect(() => {
    const h = heading.current;
    if (!h) return;
    h.focus();
    h.scrollIntoView?.({ block: 'nearest' });
  }, [step]);

  useEffect(() => {
    if (tapPhase === 'vibration' || tapPhase === 'sound') tapButton.current?.focus();
    else actionButton.current?.focus();
  }, [tapPhase]);

  /** The visible status line; the same sentence twice is still announced (it alternates a space). */
  const announce = (text: string) => setStatus((s) => ({ text, seq: s.seq + 1 }));

  /** Change step. The focused heading says the step; the status line only says `text`. */
  const go = (next: Step, text = '') => {
    setStep(next);
    announce(text);
  };

  const close = () => {
    onCancel?.();
    returnFocusRef?.current?.focus();
  };

  const restoreOffset = () => {
    if (savedOffset.current !== null) haptics.audio.setOffsetMs(savedOffset.current);
    savedOffset.current = null;
  };

  const stopBeatTicker = () => {
    if (beatTicker.current !== null) clearInterval(beatTicker.current);
    beatTicker.current = null;
  };

  /**
   * Stop everything this wizard may have started: the beat timers, a raw vibrate pattern (the
   * driver's own stop does not cancel it) and a scheduled sound beat. Other output is left alone.
   */
  const stopAll = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    stopBeatTicker();
    soundPending.current = false;
    if (rawSent.current) vibrateFn?.(0);
    if (soundSent.current) haptics.audio.stop();
    rawSent.current = false;
    soundSent.current = false;
    restoreOffset();
  };

  const play = (pattern: number[]) => {
    haptics.engine.stop();
    if (!vibrateFn) return;
    vibrateFn(pattern);
    rawSent.current = true;
  };

  const cancel = () => {
    stopAll();
    if (onCancel) close();
    else {
      setTapPhase('ready-vibration');
      go('intro', 'Calibration cancelled. Nothing was saved.');
    }
  };

  // ------------------------------------------------------------ step 1

  const playProbes = () => {
    play(sequencePattern(CALIBRATION_PROBE_MS));
    setPlayed((p) => ({ ...p, probes: true }));
  };
  const pickFaintest = (index: number | null) => {
    if (index === null) {
      // Nothing felt is not a measurement: keep this device's value (Q-74).
      setNoneFelt(true);
      setMinMs(base.minMs);
      setMeasured((m) => ({ ...m, minMs: false }));
    } else {
      setNoneFelt(false);
      setMinMs(minMsFromAnswer(index));
      setMeasured((m) => ({ ...m, minMs: true }));
    }
    go('levels');
  };

  // ------------------------------------------------------------ step 2

  const playLevels = () => {
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
    setPlayed((p) => ({ ...p, levels: true }));
  };
  const answerLevels = (whisperFelt: boolean, whisperWeaker: boolean) => {
    setLevels(levelSetFromAnswers({ whisperFelt, whisperWeaker }));
    setMeasured((m) => ({ ...m, levels: true }));
    go('tap');
  };

  // ------------------------------------------------------------ done (used by step 3)

  const finish = (offset: number, offsetMeasured: boolean) => {
    stopAll();
    const m = { ...measured, offset: offsetMeasured };
    const cal: Calibration = { version: CALIBRATION_VERSION, minMs, levels, avOffsetMs: offset };
    const changed = m.minMs || m.levels || m.offset;
    // Nothing measured: keep what is saved (or nothing) rather than write the same values again.
    const saved = changed ? saveCalibration(cal) : false;
    applyCalibration(haptics, cal);
    setMeasured(m);
    setResult({ cal, saved });
    go('done');
    onDone?.(cal, saved);
  };

  // ------------------------------------------------------------ step 3

  const plan = beatPlan();
  const beatLengthMs = plan.count * plan.periodMs + plan.periodMs;

  const finishBeat = (channel: 'vibration' | 'sound') => {
    timer.current = null;
    stopBeatTicker();
    rawSent.current = false;
    soundSent.current = false;
    const r = tapLag(taps.current, beats.current, plan.periodMs);
    if (channel === 'vibration') {
      vibrationLag.current = r.ok ? r.lagMs : null;
      if (!r.ok) {
        setTapPhase('vibration-failed');
        announce(failure(r));
      } else {
        setTapPhase('ready-sound');
        announce('Got it. Now the same with sound only.');
      }
      return;
    }
    restoreOffset();
    const off = r.ok ? computeAvOffset(vibrationLag.current, r.lagMs) : null;
    if (off === null) {
      setTapPhase('sound-failed');
      announce(
        r.ok ? 'The two beats were too far apart to trust. Try the sound beat again.' : failure(r),
      );
      return;
    }
    setAvOffsetMs(off);
    setTapPhase('measured');
    announce(`Offset measured: ${describeOffset(off)}`);
  };

  const startBeat = (channel: 'vibration' | 'sound') => {
    if (tapPhase === 'vibration' || tapPhase === 'sound' || soundPending.current) return;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    haptics.engine.stop();
    taps.current = [];
    setTapCount(0);
    const begin = () => {
      if (timer.current !== null) clearTimeout(timer.current);
      stopBeatTicker();
      const t0 = clock();
      beats.current = plan.offsetsMs.map((o) => t0 + o);
      if (channel === 'vibration') {
        play(vibrationBeatPattern(plan));
      } else {
        // Measure with no offset applied, through the audio driver's own scheduling.
        haptics.audio.stop();
        savedOffset.current ??= haptics.audio.offsetMs;
        haptics.audio.setOffsetMs(0);
        haptics.audio.playTrain(soundBeatWindow(plan, t0));
        soundSent.current = true;
      }
      // The Tap button (focused next) names the beat; the visible counter follows it.
      setTapPhase(channel);
      announce('');
      setBeatNo(1);
      beatTicker.current = setInterval(
        () => setBeatNo((n) => Math.min(plan.count, n + 1)),
        plan.periodMs,
      );
      timer.current = setTimeout(() => finishBeat(channel), beatLengthMs);
    };
    if (channel === 'vibration') {
      begin();
      return;
    }
    // The sound beat plays only when sound is on and audible (R8.7 settings).
    ensureLoaded();
    const settings = useHapticSettings.getState();
    if (!settings.soundOn || !(settings.volume > 0)) {
      setTapPhase('no-sound');
      announce(
        'Sound is off or the volume is 0 in the settings. Turn it up to measure the offset, or save without it.',
      );
      return;
    }
    // The sound needs a running AudioContext; this click is the user gesture that resumes it.
    soundPending.current = true;
    void haptics.engine.unlock().then((running) => {
      if (!mounted.current || !soundPending.current) return;
      soundPending.current = false;
      if (running && haptics.audio.supported) begin();
      else {
        setTapPhase('no-sound');
        announce('Sound is not available here, so the offset cannot be measured.');
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

  /** Skip the tap-along: keep the offset this device already has. */
  const skipTap = () => finish(base.avOffsetMs, false);

  const measureAgain = () => {
    vibrationLag.current = null;
    setAvOffsetMs(base.avOffsetMs);
    setTapPhase('ready-vibration');
    announce('Measure again: start with the vibration beat.');
  };

  // ------------------------------------------------------------ render

  const titleId = `${id}-title`;
  const cancelButton = <PlainButton label="Cancel" onClick={cancel} />;
  const title = (text: string) => (
    <h3 id={titleId} ref={heading} tabIndex={-1} className={headingClass}>
      {text}
    </h3>
  );

  // Each step is its heading and text (`head`), then the status line, then its controls. The
  // status line keeps its place in the tree, so it stays one live region across steps.
  let head: ReactNode;
  let controls: ReactNode;
  if (!supported) {
    head = (
      <>
        {title('Vibration calibration')}
        <p>
          Calibration is for phones that vibrate, and this device is not one, so there is nothing to
          calibrate here.
        </p>
      </>
    );
    controls = onCancel && <PlainButton label="Close" onClick={close} />;
  } else if (step === 'intro') {
    head = (
      <>
        {title('Calibrate vibration for this phone')}
        <p>
          Three short steps, about a minute. You can skip any of them; a skipped step keeps what
          this phone already has. Turn off battery saver first: it can stop the phone vibrating.
        </p>
      </>
    );
    controls = (
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
        {onCancel && <PlainButton label="Not now" onClick={close} />}
      </div>
    );
  } else if (step === 'faintest') {
    head = (
      <>
        {title(STEP_TITLE.faintest)}
        <p>Play three pulses, from weakest to strongest. Then pick the faintest one you felt.</p>
      </>
    );
    controls = (
      <>
        <div className="flex flex-wrap gap-2">
          <PlainButton label="Play the three pulses" onClick={playProbes} />
        </div>
        <div
          role="group"
          aria-label={
            played.probes ? 'Faintest pulse you felt' : 'Faintest pulse you felt (play them first)'
          }
          className="flex flex-wrap gap-2"
        >
          {CALIBRATION_PROBE_MS.map((ms, i) => (
            <PlainButton
              key={ms}
              label={`${PROBE_NAMES[i] ?? `Pulse ${i + 1}`} (${ms} ms)`}
              onClick={() => pickFaintest(i)}
              disabled={!played.probes}
            />
          ))}
          <PlainButton
            label="I felt none"
            onClick={() => pickFaintest(null)}
            disabled={!played.probes}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <PlainButton label="Skip this step" onClick={() => go('levels')} />
          {cancelButton}
        </div>
      </>
    );
  } else if (step === 'levels') {
    head = (
      <>
        {title(STEP_TITLE.levels)}
        <p>
          Play four buzzes, meant to go from weakest to strongest. Was the first buzz weaker than
          the second?
        </p>
      </>
    );
    controls = (
      <>
        <div className="flex flex-wrap gap-2">
          <PlainButton label="Play the four buzzes" onClick={playLevels} />
        </div>
        <div
          role="group"
          aria-label={played.levels ? 'The first buzz' : 'The first buzz (play them first)'}
          className="flex flex-wrap gap-2"
        >
          <PlainButton
            label="Yes, it was weaker"
            onClick={() => answerLevels(true, true)}
            disabled={!played.levels}
          />
          <PlainButton
            label="No, the same or stronger"
            onClick={() => answerLevels(true, false)}
            disabled={!played.levels}
          />
          <PlainButton
            label="I did not feel the first one"
            onClick={() => answerLevels(false, false)}
            disabled={!played.levels}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <PlainButton label="Skip this step" onClick={() => go('tap')} />
          {cancelButton}
        </div>
      </>
    );
  } else if (step === 'tap') {
    const collecting = tapPhase === 'vibration' || tapPhase === 'sound';
    head = (
      <>
        {title(STEP_TITLE.tap)}
        <p>
          A steady beat plays twice: first as vibration only, then as sound only. Tap the button
          below (or press Space) in time with each beat. Turn the phone&apos;s media volume up and
          silent mode off.
        </p>
      </>
    );
    controls = (
      <>
        <div className="flex flex-wrap gap-2">
          {(tapPhase === 'ready-vibration' || tapPhase === 'vibration-failed') && (
            <PlainButton
              buttonRef={actionButton}
              label={tapPhase === 'ready-vibration' ? 'Start the vibration beat' : 'Try again'}
              onClick={() => startBeat('vibration')}
            />
          )}
          {(tapPhase === 'ready-sound' ||
            tapPhase === 'sound-failed' ||
            tapPhase === 'no-sound') && (
            <PlainButton
              buttonRef={actionButton}
              label={
                tapPhase === 'ready-sound' ? 'Start the sound beat' : 'Try the sound beat again'
              }
              onClick={() => startBeat('sound')}
            />
          )}
          {tapPhase === 'measured' && (
            <>
              <PlainButton
                buttonRef={actionButton}
                label="Save calibration"
                onClick={() => finish(avOffsetMs, true)}
              />
              <PlainButton label="Measure again" onClick={measureAgain} />
            </>
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
            {tapPhase === 'vibration'
              ? 'Vibration beat: tap with each buzz'
              : 'Sound beat: tap with each beep'}
          </button>
        )}
        {collecting && (
          <p id={`${id}-taps`} className="text-sm text-neutral-300">
            Beat {beatNo} of {plan.count} · {tapCount} {tapCount === 1 ? 'tap' : 'taps'}
          </p>
        )}
        {tapPhase === 'measured' && <p>Offset: {describeOffset(avOffsetMs)}</p>}
        <div className="flex flex-wrap gap-2">
          {tapPhase !== 'measured' && (
            <PlainButton
              label={tapPhase === 'no-sound' ? 'Save without the offset' : 'Skip this step'}
              onClick={skipTap}
            />
          )}
          {cancelButton}
        </div>
      </>
    );
  } else {
    const cal = result?.cal;
    const changed = measured.minMs || measured.levels || measured.offset;
    const minMsNote = measured.minMs
      ? ''
      : noneFelt
        ? stored
          ? ' (kept: no pulse felt)'
          : ' (default: no pulse felt)'
        : ' (kept)';
    head = (
      <>
        {title('Calibration done')}
        {cal && (
          <ul className="list-disc pl-5">
            <li>
              Faintest pulse: {cal.minMs} ms{minMsNote}
            </li>
            <li>
              Strength levels: {cal.levels.length} ({cal.levels.join(', ')})
              {measured.levels ? '' : ' (kept)'}
            </li>
            <li>
              Sound and vibration offset: {describeOffset(cal.avOffsetMs)}
              {measured.offset ? '' : ' (kept)'}
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
          {!changed
            ? 'Nothing was measured, so nothing changed.'
            : result?.saved
              ? 'Saved on this device. You can calibrate again from the settings.'
              : 'Could not save on this device; it applies until you close the page.'}
        </p>
      </>
    );
    controls = onCancel && <PlainButton label="Close" onClick={close} />;
  }

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3"
      onFocus={() => (focusInside.current = true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) focusInside.current = false;
      }}
    >
      {head}
      <p role="status" className="min-h-6 text-sky-200">
        {status.text}
        {status.seq % 2 === 1 ? NBSP : ''}
      </p>
      {controls}
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
