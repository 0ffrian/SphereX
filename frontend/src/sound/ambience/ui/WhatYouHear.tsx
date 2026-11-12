// R13.10 §12.3-12.4: the "What you hear" panel. Heard now (true levels, never the stage-windowed ones), what is still
// being prepared, Not heard here (each refusal with its reason; hidden while the world forms, R12), the weather rows
// (shared with #117's "What is drawn"), Air facts (derived), the physics inputs with their tags, the mapping legend
// and "How this works" (exact copy), and the "Read changes aloud" setting. Escape closes it (consumed, A21.10) and
// focus goes back to the toggle.
import { useEffect, useId, useRef } from 'react';
import { ProvenanceBadge } from '@/app/Badge';
import { useSoundSettings } from '../../settings';
import { useAmbienceStore } from '../ambienceStore';
import { useWeatherSnapshot, weatherRows } from '../weatherBus';

export const LEGEND_TEXT =
  "Imagined from the simulated world's physics. Not a recording: no microphone has been here.";
export const HOW_TEXT =
  'You hear the place under the camera as if you were hovering there. The camera flies far faster than sound, so its own motion is silent and there is no Doppler shift.';

const fmtDb = (x: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(Math.round(x))} dB`;

export function WhatYouHear({ id, onClose }: { id: string; onClose: () => void }) {
  const ui = useAmbienceStore((s) => s.ui);
  const readCaptions = useSoundSettings((s) => s.readCaptions);
  const update = useSoundSettings((s) => s.update);
  const weather = weatherRows(useWeatherSnapshot());
  const titleId = useId();
  const readId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const preparing = ui.selected > ui.ready && (ui.status === 'baking' || ui.status === 'playing');
  return (
    <section id={id} className="sx-amb-panel" role="region" aria-labelledby={titleId} data-testid="what-you-hear">
      <h2 id={titleId} className="sx-amb-h">
        What you hear
      </h2>

      <h3 className="sx-amb-eyebrow">Heard now</h3>
      {ui.heard.length ? (
        <ul className="sx-amb-list">
          {ui.heard.map((h) => (
            <li key={`${h.id}`}>
              <span>{h.phrase}</span>
              <span className="sx-amb-num">{h.relDb === 0 ? 'loudest' : fmtDb(h.relDb)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sx-amb-muted">Nothing is playing here now.</p>
      )}
      {preparing && (
        <p className="sx-amb-muted">
          Preparing sounds ({ui.ready} of {ui.selected})
        </p>
      )}

      {ui.notHeard.length > 0 && (
        <>
          <h3 className="sx-amb-eyebrow">Not heard here</h3>
          <ul className="sx-amb-list">
            {ui.notHeard.map((r, i) => (
              <li key={i}>{r.reason}</li>
            ))}
          </ul>
        </>
      )}

      {weather.length > 0 && (
        <>
          <h3 className="sx-amb-eyebrow">Weather</h3>
          <ul className="sx-amb-list">
            {weather.map((r, i) => (
              <li key={i}>
                <ProvenanceBadge tag={r.tag} variant="tag" srText />
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {ui.airFacts.length > 0 && (
        <>
          <h3 className="sx-amb-eyebrow">Air here</h3>
          <ul className="sx-amb-list">
            {ui.airFacts.map((f) => (
              <li key={f.label}>
                <ProvenanceBadge tag="derived" variant="tag" srText />
                <span>
                  {f.label}: <span className="sx-amb-num">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {ui.inputs.length > 0 && (
        <>
          <h3 className="sx-amb-eyebrow">From the world</h3>
          <ul className="sx-amb-list">
            {ui.inputs.map((x) => (
              <li key={`${x.label}-${x.source}`}>
                <ProvenanceBadge tag={x.tag} variant="tag" srText />
                <span>
                  {x.label}{' '}
                  <span className="sx-amb-num">
                    {typeof x.value === 'number' ? Number(x.value.toPrecision(3)) : x.value}
                    {x.unit ? ` ${x.unit}` : ''}
                  </span>{' '}
                  <span className="sx-amb-muted">({x.source})</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="sx-amb-legend">{LEGEND_TEXT}</p>
      <h3 className="sx-amb-eyebrow">How this works</h3>
      <p>{HOW_TEXT}</p>

      <label className="sx-amb-check" htmlFor={readId}>
        <input id={readId} type="checkbox" checked={readCaptions} onChange={() => update({ readCaptions: !readCaptions })} />
        Read changes aloud
      </label>
    </section>
  );
}
