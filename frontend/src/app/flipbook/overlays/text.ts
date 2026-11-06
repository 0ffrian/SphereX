// Plain-language wording for the overlays (issue #12): catalogue names, contamination lines, the
// flag legend and the combine warning. No numbers are made here; they come from the reply.
import type {
  CatalogSource,
  Contamination,
  FlagGroupName,
  OverlayCatalog,
  OverlayCatalogName,
  OverlaysResponse,
} from '@/app/api/types';
import { formatWavelength } from '@/app/format';

export const CATALOG_LABEL: Readonly<Record<OverlayCatalogName, string>> = {
  gaia: 'Gaia',
  wise: 'WISE',
};

/** "star"/"stars" for Gaia, "source"/"sources" for WISE. */
export function sourceNoun(catalog: OverlayCatalogName, n: number): string {
  const one = catalog === 'gaia' ? 'star' : 'source';
  return n === 1 ? one : `${one}s`;
}

export const FLAG_GROUP_LABEL: Readonly<Record<FlagGroupName, string>> = {
  saturation: 'Saturated',
  bad_pixel: 'Bad pixel',
  artefact: 'Artefact',
  source: 'Source',
};

export function findCatalog(
  data: OverlaysResponse,
  name: OverlayCatalogName,
): OverlayCatalog | undefined {
  return data.catalogs.find((c) => c.catalog === name);
}

/** Why a catalogue's toggle is disabled, or null when it can be shown. */
export function catalogUnavailableReason(
  data: OverlaysResponse,
  name: OverlayCatalogName,
): string | null {
  const c = findCatalog(data, name);
  if (c?.available) return null;
  return name === 'gaia'
    ? 'Gaia stars are not available for this object.'
    : 'WISE sources are not available for this object.';
}

/** "G 14.2" or "G magnitude unknown". */
export function formatMag(band: string, mag: number | null): string {
  return mag === null ? `${band} magnitude unknown` : `${band} ${mag.toFixed(1)}`;
}

/** "Table gaiadr3.gaia_source, epoch J2016.0, G to 19.0" */
export function describeCatalog(c: OverlayCatalog): string {
  const epoch = c.epoch === null ? 'epoch not stated' : `epoch ${c.epoch}`;
  const limit = c.mag_limit === null ? '' : `, ${c.mag_band} to ${c.mag_limit.toFixed(1)}`;
  return `Table ${c.table}, ${epoch}${limit}`;
}

const ZONE_TEXT: Readonly<Record<Contamination['zone'], string>> = {
  aperture: 'inside the photometry aperture',
  annulus: 'in the background annulus',
};

/**
 * One line per catalogue and zone, aperture first:
 * "1 Gaia star inside the photometry aperture (G 14.2, 1.8 px away)".
 */
export function contaminationLines(
  entries: readonly Contamination[],
  data: OverlaysResponse,
): string[] {
  const lines: string[] = [];
  for (const zone of ['aperture', 'annulus'] as const) {
    for (const catalog of ['gaia', 'wise'] as const) {
      const hits = entries
        .filter((e) => e.zone === zone && e.catalog === catalog)
        .sort((a, b) => a.sep_px - b.sep_px);
      if (hits.length === 0) continue;
      const band = findCatalog(data, catalog)?.mag_band ?? CATALOG_LABEL[catalog];
      const details = hits
        .map((e) => `${formatMag(band, e.mag)}, ${e.sep_px.toFixed(1)} px away`)
        .join('; ');
      lines.push(
        `${hits.length} ${CATALOG_LABEL[catalog]} ${sourceNoun(catalog, hits.length)} ${ZONE_TEXT[zone]} (${details})`,
      );
    }
  }
  return lines;
}

/** Catalogue sources by id, for the marker list's magnitudes. */
export function sourcesById(data: OverlaysResponse): Map<string, CatalogSource> {
  const map = new Map<string, CatalogSource>();
  for (const c of data.catalogs) for (const s of c.sources) map.set(`${c.catalog}:${s.id}`, s);
  return map;
}

/**
 * The combine warning. Two SPHEREx frames are usually at different wavelengths, so a sum or a
 * difference mixes the spectrum's shape with any change over time. Both wavelengths are named.
 */
export function combineWarning(aUm: number, bUm: number): string {
  const a = formatWavelength(aUm);
  const b = formatWavelength(bUm);
  // ASSUMPTION (wording): when both print the same, "different" would be wrong, so it says so.
  if (a === b) {
    return `Frames A and B are both at ${a}, so the result shows change over time, not spectral shape.`;
  }
  return `Frames are at different wavelengths (${a} and ${b}); the result mixes spectral shape with change over time.`;
}
