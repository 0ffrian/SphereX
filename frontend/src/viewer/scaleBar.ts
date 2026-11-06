// R5.4 scale bar: the physical size plus one familiar comparison. Pure functions.

export interface Comparison {
  id: string;
  name: string;
  /** What the length is, shown in the text: "556 m tall". */
  detail: string;
  /** null = value not confirmed [verify]; the comparison is then never offered. */
  lengthM: number | null;
}

/**
 * R5.4 table. Mauritius is "~65 km long [verify]": the value is not confirmed, so it is `null`
 * and the comparison is not offered until someone checks it (set `lengthM` to 65_000 then).
 */
export const COMPARISONS: readonly Comparison[] = [
  { id: 'le_morne', name: 'Le Morne Brabant', detail: '556 m tall', lengthM: 556 },
  { id: 'mauritius', name: 'Mauritius', detail: 'about 65 km long', lengthM: null },
  { id: 'earth', name: 'Earth', detail: '12,742 km across', lengthM: 12_742_000 },
  { id: 'jupiter', name: 'Jupiter', detail: '139,820 km across', lengthM: 139_820_000 },
  { id: 'sun', name: 'the Sun', detail: '1.39 million km across', lengthM: 1.39e9 },
];

export interface ScaleBar {
  /** Diameter of the body in metres (2 x scale_m). */
  diameterM: number;
  diameterText: string;
  comparison: { id: string; name: string; detail: string; lengthM: number; text: string };
  /** Bar lengths as fractions of the longer of the two (0 to 1], so both fit on screen. */
  bodyFraction: number;
  comparisonFraction: number;
}

function sig(n: number): string {
  if (n >= 100) return Math.round(n).toLocaleString('en');
  if (n >= 10) return String(Math.round(n * 10) / 10);
  return String(Math.round(n * 100) / 100);
}

export function formatLength(m: number): string {
  if (m < 1000) return `${sig(m)} m`;
  const km = m / 1000;
  if (km < 1e6) return `${sig(km)} km`;
  return `${sig(km / 1e6)} million km`;
}

type Offered = Comparison & { lengthM: number };

export function pickComparison(diameterM: number): Offered {
  const offered = COMPARISONS.filter((c): c is Offered => c.lengthM !== null);
  let best = offered[0]!;
  let bestDist = Infinity;
  for (const c of offered) {
    const dist = Math.abs(Math.log10(diameterM / c.lengthM));
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/** `scaleM` is RenderParams.scale_m, the physical radius in metres; null = unknown, no bar. */
export function scaleBarFor(scaleM: number | null): ScaleBar | null {
  if (scaleM === null || !Number.isFinite(scaleM) || scaleM <= 0) return null;
  const diameterM = 2 * scaleM;
  const c = pickComparison(diameterM);
  const ratio = diameterM / c.lengthM;
  let text: string;
  if (ratio >= 0.95 && ratio <= 1.05) text = `about the same size as ${c.name} (${c.detail})`;
  else if (ratio > 1) text = `about ${sig(ratio)} times ${c.name} (${c.detail})`;
  else text = `about 1/${sig(1 / ratio)} of ${c.name} (${c.detail})`;
  const longest = Math.max(diameterM, c.lengthM);
  return {
    diameterM,
    diameterText: formatLength(diameterM),
    comparison: { id: c.id, name: c.name, detail: c.detail, lengthM: c.lengthM, text },
    bodyFraction: diameterM / longest,
    comparisonFraction: c.lengthM / longest,
  };
}
