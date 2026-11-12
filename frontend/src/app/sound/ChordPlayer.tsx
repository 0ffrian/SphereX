// R13.12 (Q-443, Q-446): the spectrum chord's controls, shared by the Hear it panel and the sky tool's
// Spectrum panel. One button toggles the drone; Data | Smooth is the A/B switch (Smooth is smoothed
// data, `derived`, so it is unavailable at Measured only, with the reason shown). The caption says it
// is a data mapping, the loudness correction is labelled, and a 12-note strip shows which notes sound.
// No copy here claims a band or dip can be heard (R13.12 item 8). Escape stops the chord while focus
// is in the player. Outside a SoundProvider (some tests) it says sound is not available.
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { ProvenanceBadge } from '@/app/Badge';
import { ToggleGroup } from '@/app/PanelControls';
import { useAppStore } from '@/state/store';
import { effectiveHonesty, HONESTY_LABEL, isTagShown, stateThatShows } from '@/viewer/honesty';
import type { ChordOutcome, SpectrumReply } from '@/sound/appSound';
import type { ChordMode, ChordPlan } from '@/sound/spectrumChord';
import { useOptionalSound, useOptionalSoundStatus } from '@/sound/SoundProvider';

export const CHORD_CAPTION = 'Data mapping, not a recording.';
export const CHORD_LOUDNESS_LABEL = 'Loudness-corrected (ISO 226, 60 phon)';
export const CHORD_MAPPING =
  'The whole spectrum at once as 12 notes: short wavelengths high, long wavelengths low. Brighter is louder.';
export const CHORD_NOTHING = 'No usable points to play as a chord.';
export const CHORD_NO_SOUND = 'Sound is not available here.';
/** The two spectrum sounds, told apart for non-experts: one at a time against all at once. */
export const KIND_HINT = {
  sweep: 'Sweep: one wavelength at a time, from short to long.',
  chord: 'Chord: the whole spectrum all at once, as 12 notes.',
} as const;

const OUTCOME_LINE: Partial<Record<ChordOutcome, string>> = {
  'nothing-to-play': CHORD_NOTHING,
  'sound-off': 'Sound is off. Turn it on in Sound.',
  'no-audio': 'This browser could not start the sound.',
  hidden: 'This spectrum is hidden at the current honesty level.',
};

/** Notes whose level differs by at least this between Data and Smooth are marked on the strip. */
export const AB_MARK_DB = 1;

/**
 * What the A/B changes for this spectrum (shown on screen, so a subtle difference is not mistaken for
 * none, and none for a hidden one). Never says a band is audible.
 */
export function abSummary(plan: ChordPlan): string {
  const changed = plan.bins.filter((b) => b.abDiffDb !== null && b.abDiffDb >= AB_MARK_DB).length;
  if (changed === 0) {
    return 'Data and Smooth are almost the same for this spectrum: no note changes by 1 dB or more.';
  }
  return `${changed} of 12 notes change between Data and Smooth by 1 dB or more (marked on the strip): narrow features in the data.`;
}

/** The summary of what the chord plays in `mode` (visible and live). Never says a band is audible. */
export function chordSummary(plan: ChordPlan, mode: ChordMode): string {
  const quiet = (i: number) =>
    mode === 'smooth' ? plan.bins[i]!.smoothQuiet : plan.bins[i]!.quiet;
  const sounding = plan.bins.filter((b) => !quiet(b.index)).length;
  const silent = 12 - sounding;
  const noisy = plan.bins.filter((b) => b.noisy && !quiet(b.index)).length;
  let s = `${sounding} of 12 notes sound.`;
  if (silent > 0) s += ` ${silent} silent: under 20% of the peak, or no data.`;
  if (noisy > 0) s += ` ${noisy} wobble (marked ~): noisy data.`;
  return s;
}

export function ChordPlayer({
  reply,
  owner,
  onBeforePlay,
  testId = 'chord',
}: {
  /** The `/spectrum` reply (points and tag), or null while there is none. */
  reply: SpectrumReply | null;
  /** Which panel this is ('hear', 'sky'): only its own chord shows as playing. */
  owner: string;
  /** Stop the panel's other sounds first (Hear it: its Atmosphere). */
  onBeforePlay?: () => void;
  testId?: string;
}) {
  const sound = useOptionalSound();
  const status = useOptionalSoundStatus();
  const honesty = useAppStore((s) => effectiveHonesty(s.honesty));
  const id = useId();
  const plan = useMemo(() => (sound && reply ? sound.chordPlan(reply) : null), [sound, reply]);
  const [chosen, setChosen] = useState<ChordMode>('data');
  const [line, setLine] = useState<string | null>(null);
  const mine = status?.chord?.owner === owner ? status.chord : null;
  const smoothShown = plan ? isTagShown(honesty, plan.smoothTag) : false;
  const mode: ChordMode = mine ? mine.mode : chosen === 'smooth' && !smoothShown ? 'data' : chosen;

  // Another spectrum, or the panel goes away: stop this panel's chord.
  useEffect(() => {
    if (!sound) return;
    return () => sound.stopChord(owner);
  }, [sound, reply, owner]);

  if (!sound) {
    return (
      <p className="sx-hr-hint" data-testid={`${testId}-none`}>
        {CHORD_NO_SOUND}
      </p>
    );
  }
  if (!plan || !reply) {
    return (
      <p className="sx-hr-hint" data-testid={`${testId}-none`}>
        {CHORD_NOTHING}
      </p>
    );
  }

  const toggle = () => {
    if (mine) {
      sound.stopChord(owner);
      return;
    }
    onBeforePlay?.();
    setLine(null);
    // Called inside the click: `chord` unlocks audio before any await (Q-73).
    void sound.chord(reply, { owner, mode }).then((o) => setLine(OUTCOME_LINE[o] ?? null));
  };
  const setMode = (m: ChordMode) => {
    setChosen(m);
    if (mine) sound.setChordMode(m);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !mine) return;
    e.preventDefault();
    e.stopPropagation(); // consumed: the shell's own Escape handlers skip it (A21.10)
    sound.stopChord(owner);
  };
  const reasonId = `${id}-smooth-why`;
  const levels = plan.bins.map((b) => {
    const db = mode === 'smooth' ? b.smoothLevelDb : b.levelDb;
    return db === null ? null : 10 ** (db / 20);
  });

  return (
    <div className="flex flex-col gap-3" onKeyDown={onKeyDown} data-testid={testId}>
      <div className="sx-hr-player">
        <button
          type="button"
          className="sx-hr-play"
          aria-pressed={!!mine}
          aria-label="Chord"
          title={mine ? 'Stop the chord' : 'Play the chord'}
          onClick={toggle}
          data-testid={`${testId}-play`}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={mine ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4v16l13-8z'} />
          </svg>
        </button>
        <div className="sx-hr-grow">
          <ToggleGroup<ChordMode>
            label="Chord mode"
            hideLabel
            options={[
              { value: 'data', label: 'Data', testId: `${testId}-mode-data` },
              {
                value: 'smooth',
                label: 'Smooth',
                disabled: !smoothShown,
                title: `Smoothed data: ${plan.smoothFormula} (Estimated)`,
                describedBy: smoothShown ? undefined : reasonId,
                testId: `${testId}-mode-smooth`,
              },
            ]}
            value={mode}
            onChange={setMode}
            testId={`${testId}-mode`}
          />
        </div>
      </div>
      {!smoothShown && (
        <p className="sx-hr-hint" id={reasonId} data-testid={`${testId}-smooth-why`}>
          Smooth is an estimate (smoothed data). Set honesty to{' '}
          {HONESTY_LABEL[stateThatShows(plan.smoothTag)]} to use it.
        </p>
      )}
      <div className="sx-chord-strip" aria-hidden="true" data-testid={`${testId}-strip`}>
        {plan.bins.map((bin, i) => {
          const v = levels[i]!;
          const other = mode === 'smooth' ? bin.levelDb : bin.smoothLevelDb;
          const marked = bin.abDiffDb !== null && bin.abDiffDb >= AB_MARK_DB;
          return (
            <span key={i} className="sx-chord-note" data-changed={marked} data-noisy={bin.noisy}>
              <span className="sx-chord-bar">
                {/* A silent note is a short empty box, never a tall one. */}
                <i
                  data-silent={v === null}
                  style={{ height: v === null ? '12%' : `${Math.max(8, v * 100)}%` }}
                />
                {marked && (
                  <b
                    data-testid={`${testId}-ab-mark`}
                    style={{
                      bottom: other === null ? '0%' : `${Math.max(8, 10 ** (other / 20) * 100)}%`,
                    }}
                  />
                )}
              </span>
              <span className="sx-chord-noise">{bin.noisy ? '~' : ''}</span>
            </span>
          );
        })}
      </div>
      <div className="sx-chord-ax" aria-hidden="true">
        <span>0.75 µm</span>
        <span>5 µm</span>
      </div>
      <p className="sx-hr-hint" aria-live="polite" data-testid={`${testId}-summary`}>
        {chordSummary(plan, mode)} {abSummary(plan)}
      </p>
      <p className="sx-hr-hint" data-testid={`${testId}-mapping`}>
        {CHORD_MAPPING}
      </p>
      <p className="sx-hr-hint" data-testid={`${testId}-caption`}>
        {CHORD_CAPTION}{' '}
        {mode === 'smooth' ? (
          <>
            Smooth: smoothed data{' '}
            <ProvenanceBadge tag={plan.smoothTag} tooltip={plan.smoothFormula} srText />{' '}
          </>
        ) : null}
        <span data-testid={`${testId}-loudness`}>{CHORD_LOUDNESS_LABEL}.</span>
      </p>
      {line && (
        <p className="sx-hr-hint" role="status" data-testid={`${testId}-reason`}>
          {line}
        </p>
      )}
    </div>
  );
}
