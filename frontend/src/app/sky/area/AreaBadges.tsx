// Provenance of what the Area layers draw (D-02, A16.5, A18.2): one row per kind of value, each with
// its badge from the reply's own provenance entry (the formula or assumption in the tooltip and for
// screen readers). Synthetic fixture data never wears the Measured badge (A11).
import type { AreaProvenanceEntry } from '@/contract';
import { ProvenanceBadge } from '@/app/Badge';
import { WAVELENGTH_COLOR_FORMULA, WAVELENGTH_COLOR_TAG } from '@/app/flipbook/wavelengthColor';
import { useAppStore } from '@/state/store';

function Row({
  name,
  entry,
  fixture,
}: {
  name: string;
  entry: AreaProvenanceEntry;
  fixture: boolean;
}) {
  const tip = entry.formula ?? entry.assumption ?? entry.source;
  return (
    <li className="flex flex-wrap items-center gap-1.5" data-testid="area-badge-row">
      <span className="text-sx-mfg">{name}</span>
      <ProvenanceBadge tag={entry.tag} tooltip={tip} srText fixture={fixture} />
    </li>
  );
}

export function AreaBadges() {
  const dots = useAppStore((s) => s.area.dots.data);
  const tracks = useAppStore((s) => s.area.tracks.data);
  const known = useAppStore((s) => s.area.known.data);
  const showKnown = useAppStore((s) => s.area.layers.known);
  const fixture = useAppStore((s) => s.area.fixture);
  const measured = useAppStore((s) => s.honesty === 'measured');
  if (!dots) return null;
  return (
    <ul
      role="list"
      className="mt-2 flex list-none flex-col gap-1 p-0 text-xs"
      aria-label="Where the values come from"
      data-testid="area-badges"
    >
      <Row name="Dot positions" entry={dots.provenance.position} fixture={fixture} />
      <Row name="Brightness" entry={dots.provenance.photometry} fixture={fixture} />
      <Row name="Wavelength" entry={dots.provenance.wavelength} fixture={fixture} />
      {!measured && <Row name="Dot labels" entry={dots.provenance.label} fixture={fixture} />}
      {!measured && (
        <Row
          name="Wavelength colour"
          entry={{
            tag: WAVELENGTH_COLOR_TAG as AreaProvenanceEntry['tag'],
            formula: WAVELENGTH_COLOR_FORMULA,
          }}
          fixture={fixture}
        />
      )}
      {!measured && tracks && (
        <Row name="Tracks and labels" entry={tracks.provenance.tracks} fixture={fixture} />
      )}
      {!measured && tracks && (
        <Row name="Known-object match" entry={tracks.provenance.match} fixture={fixture} />
      )}
      {!measured && showKnown && known && (
        <Row name="Known positions" entry={known.provenance.positions} fixture={fixture} />
      )}
    </ul>
  );
}
