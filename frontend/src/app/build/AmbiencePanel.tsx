// The build view's Ambience dropdown (Moon, 13 Nov 2026, Q-456): the header's Ambience button opens
// it, in the same popover as Accuracy and Details (one at a time). It holds this body's Atmosphere
// (the imagined wind, local synthesis, Q-416; refused with its reason when the card has no
// atmosphere to hear) and the sound settings that used to sit in the sky's top bar (R13.9).
import { useMemo } from 'react';
import { SwitchRow } from '@/app/PanelControls';
import { useAmbienceStore } from '@/app/sound/ambienceStore';
import { displayName } from '@/app/displayName';
import { useAppStore } from '@/state/store';
import { SoundControls } from '@/sound/ui/SoundSettings';
import { atmosphereOf } from './hearModel';

export function AmbiencePanel({ name }: { name: string | undefined }) {
  const card = useAppStore((s) => s.card);
  const atmo = useMemo(() => atmosphereOf(card), [card]);
  const atmoOn = useAmbienceStore((s) => s.ambience && s.playing && s.key === (card?.id ?? ''));
  return (
    <>
      <div className="sx-pop-h">
        <b>Ambience</b>
        <span>{displayName(name)}</span>
      </div>
      {atmo.ok ? (
        <SwitchRow
          label="Atmosphere (M stops it)"
          checked={atmoOn}
          onChange={(on) => card && useAmbienceStore.getState().setAmbience(on, atmo.model, card.id)}
          testId="build-ambience-atmo"
        />
      ) : (
        <p className="sx-snd-hint" data-testid="build-ambience-none">
          {atmo.line}
        </p>
      )}
      <SoundControls />
    </>
  );
}
