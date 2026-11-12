// R13.12, A8 (Q-446): the sky tool's Spectrum panel sound. Sweep | Chord: the Sweep is the Listen sweep
// (ListenSweep through AppSound.listen: pitch.ts, the honesty filter, no gas chimes because this panel
// has no epoch); the Chord is ChordPlayer. One spectrum sound at a time (spectrumExclusive.ts).
import { useEffect, useState } from 'react';
import { ToggleGroup } from '@/app/PanelControls';
import type { ListenOutcome, SpectrumReply } from '@/sound/appSound';
import { useOptionalSound, useOptionalSoundStatus } from '@/sound/SoundProvider';
import { CHORD_CAPTION, CHORD_NO_SOUND, ChordPlayer, KIND_HINT } from './ChordPlayer';

type Kind = 'sweep' | 'chord';

export const SWEEP_MAPPING =
  'Short wavelengths sound high, long wavelengths low. Brighter is louder.';

const KIND_OPTIONS = [
  { value: 'sweep', label: 'Sweep', title: KIND_HINT.sweep, testId: 'sky-kind-sweep' },
  { value: 'chord', label: 'Chord', title: KIND_HINT.chord, testId: 'sky-kind-chord' },
] as const;

const LISTEN_LINE: Partial<Record<ListenOutcome, string>> = {
  'nothing-to-play': 'No usable points to play.',
  'sound-off': 'Sound is off. Turn it on in Sound.',
  'no-audio': 'This browser could not start the sound.',
  hidden: 'This spectrum is hidden at the current honesty level.',
};

export function SpectrumSound({ reply }: { reply: SpectrumReply }) {
  const sound = useOptionalSound();
  const status = useOptionalSoundStatus();
  const [kind, setKindState] = useState<Kind>('sweep');
  const [line, setLine] = useState<string | null>(null);

  // Another spectrum, or the panel goes away: stop the sweep it started.
  useEffect(() => {
    if (!sound) return;
    return () => sound.stopListen();
  }, [sound, reply]);

  if (!sound) return <p className="sx-hr-hint">{CHORD_NO_SOUND}</p>;

  const listening = !!status?.listening;
  const setKind = (k: Kind) => {
    if (k === kind) return;
    sound.stopListen();
    sound.stopChord('sky');
    setLine(null);
    setKindState(k);
  };
  const toggleSweep = () => {
    if (listening) {
      sound.stopListen();
      return;
    }
    setLine(null);
    // Called inside the click: `listen` unlocks audio before any await (Q-73).
    void sound.listen(reply).then((o) => setLine(LISTEN_LINE[o] ?? null));
  };

  return (
    <div className="flex flex-col gap-3" data-testid="sky-sound">
      <ToggleGroup<Kind>
        label="Spectrum sound"
        hideLabel
        options={KIND_OPTIONS}
        value={kind}
        onChange={setKind}
        testId="sky-kind"
      />
      <p className="sx-hr-hint" data-testid="sky-kind-hint">
        {KIND_HINT[kind]}
      </p>
      {kind === 'chord' ? (
        <ChordPlayer reply={reply} owner="sky" testId="sky-chord" />
      ) : (
        <>
          <div className="sx-hr-player">
            <button
              type="button"
              className="sx-hr-play"
              aria-pressed={listening}
              aria-label="Sweep"
              title={listening ? 'Stop the sweep' : 'Play the sweep'}
              onClick={toggleSweep}
              data-testid="sky-sweep-play"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d={listening ? 'M6 4h4v16H6zM14 4h4v16h-4z' : 'M7 4v16l13-8z'} />
              </svg>
            </button>
            <span className="sx-hr-hint">{SWEEP_MAPPING}</span>
          </div>
          <p className="sx-hr-hint">{CHORD_CAPTION}</p>
          {line && (
            <p className="sx-hr-hint" role="status" data-testid="sky-sweep-reason">
              {line}
            </p>
          )}
        </>
      )}
    </div>
  );
}
