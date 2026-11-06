// R7.3 `comet` (3I/ATLAS). Pure plan; renderers/build.ts draws it.
//   Nucleus: dark sphere at nucleus_radius_km_max, labelled "upper size limit"; a point if missing.
//   Gas shells: one additive point cloud per gas, density ~ 1/r^2 out to the coma radius, point
//   count and brightness proportional to Q of the selected epoch. False colours with a legend.
//   Dust: Sun-pointing, December only. Tail: none in August; drawn in December only if a
//   published result shows one, and the card holds no such field, so it is never drawn.
//   Epoch toggle: Aug 2025 / Dec 2025.
import type { CometEpoch, GasQ, ObjectCard } from '@/contract';
import { isPresent, litBody, numberField, PlanBuilder, type PlanInput } from '../planCommon';
import type { RenderPlan, ShellPlan, Vec3 } from '../planTypes';

export const COMET_EPOCHS: readonly CometEpoch[] = ['2025-08', '2025-12'];

export const EPOCH_LABEL: Readonly<Record<CometEpoch, string>> = {
  '2025-08': 'Aug 2025',
  '2025-12': 'Dec 2025',
};

/** Display budget: R5.5 allows up to 60k points, shared by three gases. All values here are artistic. */
export const MAX_SHELL_POINTS = 20_000;
/** Inner edge of the 1/r^2 profile, as a fraction of the coma radius (avoids the r = 0 singularity). */
export const SHELL_INNER_FRACTION = 0.03;
/** Smallest nucleus radius drawn, in scene units (coma radius = 1), so it stays visible. */
export const MIN_NUCLEUS_SCENE_RADIUS = 0.02;
/** Nucleus radius in scene units when the coma radius is unknown, so there is no ratio to use. */
const NUCLEUS_ALONE_SCENE_RADIUS = 0.5;
export const DUST_POINTS = 6000;
/** Dark nucleus colour: a display default, not a measured albedo. */
const NUCLEUS_TINT: [number, number, number] = [0.06, 0.06, 0.06];

/** R7.3: fixed false colours with a legend. CO2 cyan, H2O blue, CO magenta (artistic). */
export const GAS_STYLE = [
  { key: 'co2', label: 'CO₂', css: '#00ffff' },
  { key: 'h2o', label: 'H₂O', css: '#3377ff' },
  { key: 'co', label: 'CO', css: '#ff00ff' },
] as const;

/** The card shape Q-42 proposes: Q keyed by epoch. Read if present, in addition to the R3.2 shape. */
type EpochKeyedGasQ = Partial<Record<CometEpoch, GasQ>>;

/**
 * Q of the selected epoch. ASSUMPTION (Q-42 is open): a card either keys `gas_Q` by epoch (the
 * Q-42 proposal) or holds one epoch's Q in the R3.2 shape, which then applies only to the epochs
 * listed in `epochs`. Anything else gives null: no Q is guessed for an epoch.
 */
export function gasQForEpoch(card: ObjectCard, epoch: CometEpoch): GasQ | null {
  const q = card.gas_Q;
  if (!q) return null;
  const keyed = q as EpochKeyedGasQ;
  if (COMET_EPOCHS.some((e) => e in keyed)) return keyed[epoch] ?? null;
  return card.epochs?.includes(epoch) ? q : null;
}

function qValue(q: GasQ | null, key: 'co2' | 'h2o' | 'co'): number | null {
  const v = q?.[key]?.value;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/** Epochs for which the card has at least one usable Q. */
export function epochsWithQ(card: ObjectCard): CometEpoch[] {
  return COMET_EPOCHS.filter((e) =>
    GAS_STYLE.some((g) => qValue(gasQForEpoch(card, e), g.key) !== null),
  );
}

/**
 * Shell sizes. Point count and brightness are proportional to Q, normalised by the largest Q of
 * any gas in any epoch of the card, so switching epoch changes the shells.
 */
export function planShells(card: ObjectCard, epoch: CometEpoch, seed: number): ShellPlan[] {
  let qMax = 0;
  for (const e of COMET_EPOCHS)
    for (const g of GAS_STYLE) qMax = Math.max(qMax, qValue(gasQForEpoch(card, e), g.key) ?? 0);
  if (qMax === 0) return [];
  const q = gasQForEpoch(card, epoch);
  const shells: ShellPlan[] = [];
  GAS_STYLE.forEach((g, i) => {
    const v = qValue(q, g.key);
    if (v === null) return;
    const brightness = v / qMax;
    shells.push({
      id: g.key,
      label: g.label,
      css: g.css,
      count: Math.max(1, Math.round(MAX_SHELL_POINTS * brightness)),
      innerRadius: SHELL_INNER_FRACTION,
      outerRadius: 1,
      brightness,
      seed: (seed * 8 + i) >>> 0,
    });
  });
  return shells;
}

export function planComet(input: PlanInput): RenderPlan {
  const { card, params, ctx } = input;
  const b = new PlanBuilder(input);
  b.tintLegend = false; // the nucleus is a fixed dark colour; the mode colours the dust only
  const epoch = ctx.epoch;
  const epochs = epochsWithQ(card);

  // Gas shells. If the card has Q but not for this epoch, say so instead of guessing.
  const q = gasQForEpoch(card, epoch);
  const hasQ = GAS_STYLE.some((g) => qValue(q, g.key) !== null);
  let shells: ShellPlan[] = [];
  const layer = params.layers.find((l) => l.id === 'gas_shells');
  if (layer && b.ready('gas_shells') && isPresent(card.gas_Q) && !hasQ) {
    b.refuseForEpoch('gas_shells', epoch);
  } else if (
    b.draw('gas_shells', { swatches: GAS_STYLE.map((g) => ({ label: g.label, css: g.css })) })
  ) {
    shells = planShells(card, epoch, params.seed);
  }
  const comaDrawn = shells.length > 0;

  // Nucleus: a dark sphere at the upper size limit; a point if the value is missing.
  const nucleusKm = numberField(card, 'nucleus_radius_km_max');
  const comaKm = numberField(card, 'coma_radius_km');
  const nucleusDrawn = b.draw('nucleus');
  let nucleusScene = MIN_NUCLEUS_SCENE_RADIUS;
  if (nucleusDrawn && nucleusKm !== null) {
    if (comaDrawn && comaKm !== null && comaKm > 0) {
      const ratio = nucleusKm / comaKm;
      nucleusScene = Math.max(ratio, MIN_NUCLEUS_SCENE_RADIUS);
      if (ratio < MIN_NUCLEUS_SCENE_RADIUS)
        b.notes.push(
          'The nucleus is drawn larger than its size relative to the coma so that it stays visible.',
        );
    } else {
      nucleusScene = NUCLEUS_ALONE_SCENE_RADIUS;
    }
    b.notes.push('The nucleus size is an upper limit.');
  } else {
    b.notes.push('The nucleus size is not known, so it is drawn as a point.');
  }

  // Dust: December only. Sun-pointing. Never invented for August.
  let dust: RenderPlan['dust'] = null;
  if (epoch !== '2025-12') b.refuseForEpoch('dust', epoch);
  else if (b.draw('dust')) {
    const dir: Vec3 = b.lighting.direction ?? [1, 0, 0];
    dust = {
      id: 'dust',
      direction: dir,
      count: DUST_POINTS,
      seed: (params.seed * 8 + 7) >>> 0,
      tint: b.tint.rgb,
    };
  }

  // Tail: R7.3 allows one only if a published December result shows it. The card has no field
  // for such a result, so a tail is never drawn.
  if (b.has('tail')) {
    b.reject({ id: 'tail', reason: 'data', detail: 'No published tail result is on the card.' });
  }
  b.notes.push('No tail is drawn: the card holds no published tail result.');

  const nucleus = litBody('nucleus', [nucleusScene, nucleusScene, nucleusScene], NUCLEUS_TINT, {
    segments: [32, 16],
    // The nucleus is dark and lit like a solar-system body.
  });
  // The plan has a body even when the nucleus layer was refused: a point (R7.3), tinted dark.
  return b.build({
    bodies: [nucleus],
    shells,
    dust,
    epoch,
    epochs,
    sizeTag: nucleusDrawn ? (card.nucleus_radius_km_max?.tag ?? null) : null,
    relief: 'illustrative',
  });
}
