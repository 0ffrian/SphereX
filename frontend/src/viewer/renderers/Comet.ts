// R7.3 `comet` (3I/ATLAS). Pure plan; renderers/build.ts draws it.
//   Nucleus: dark sphere at nucleus_radius_km_max, labelled "upper size limit"; a point if missing.
//   With a registered shape model (67P, Q-162) the radius is the mesh's own bounding-sphere radius
//   used for scaling (Q-43), not a limit.
//   Gas shells: one additive point cloud per gas, density ~ 1/r^2 out to the coma radius, point
//   count and brightness proportional to Q of the selected epoch. False colours with a legend.
//   Dust: Sun-pointing, December only. Tail: none in August; drawn in December only if a
//   published result shows one, and the card holds no such field, so it is never drawn.
//   Epoch toggle: Aug 2025 / Dec 2025.
import type { CometEpoch, GasQ, ObjectCard } from '@/contract';
import { isTagShown, weakerOf } from '../honesty';
import { isPresent, litBody, numberField, PlanBuilder, type PlanInput } from '../planCommon';
import type { RenderPlan, ShellPlan, Vec3, VolumePlan } from '../planTypes';
import { isLoadableMeshUrl, planShapeLayers } from './AsteroidMesh';
import { comaVolume, dustConeVolume, dustTailVolume, ionTailVolume } from '../volume/volumeSpecs';

export const COMET_EPOCHS: readonly CometEpoch[] = ['2025-08', '2025-12'];

export const EPOCH_LABEL: Readonly<Record<CometEpoch, string>> = {
  '2025-08': 'Aug 2025',
  '2025-12': 'Dec 2025',
};

/**
 * Display budget. R5.5 allows at most 60k points in total: three gas shells plus the dust cloud.
 * 3 x 18,000 + 6,000 = 60,000. All values here are artistic.
 */
export const MAX_SHELL_POINTS = 18_000;
export const DUST_POINTS = 6000;
/** R5.5: points <= 60k, for every gas at its maximum plus the dust. */
export const MAX_TOTAL_POINTS = 60_000;
/** Inner edge of the 1/r^2 profile, as a fraction of the coma radius (avoids the r = 0 singularity). */
export const SHELL_INNER_FRACTION = 0.03;
/** Smallest nucleus radius drawn, in scene units (coma radius = 1), so it stays visible. */
export const MIN_NUCLEUS_SCENE_RADIUS = 0.02;
/** Nucleus radius in scene units when the coma radius is unknown, so there is no ratio to use. */
const NUCLEUS_ALONE_SCENE_RADIUS = 0.5;
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
 * Q-42 proposal) or holds one epoch's Q in the R3.2 shape. The R3.2 shape belongs to an epoch
 * only when `epochs` has exactly one entry and it is that epoch. With both epochs listed, one
 * set of values cannot be assigned to either, so the result is null: no Q is guessed (R7.3).
 */
export function gasQForEpoch(card: ObjectCard, epoch: CometEpoch): GasQ | null {
  const q = card.gas_Q;
  if (!q) return null;
  const keyed = q as EpochKeyedGasQ;
  if (COMET_EPOCHS.some((e) => e in keyed)) return keyed[epoch] ?? null;
  return card.epochs?.length === 1 && card.epochs[0] === epoch ? q : null;
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
    // R3.2 shape with both epochs listed: one set of values, two epochs. Never guessed (R7.3).
    const ambiguous =
      !COMET_EPOCHS.some((e) => e in (card.gas_Q as object)) && (card.epochs?.length ?? 0) > 1;
    b.refuseForEpoch(
      'gas_shells',
      epoch,
      ambiguous
        ? 'The card lists both epochs but holds one set of gas values, so they cannot be assigned to an epoch.'
        : 'The card has no gas measurements for this epoch.',
    );
  } else if (
    b.draw('gas_shells', { swatches: GAS_STYLE.map((g) => ({ label: g.label, css: g.css })) })
  ) {
    shells = planShells(card, epoch, params.seed);
  }

  // Nucleus: a dark sphere at the upper size limit; a point if the value is missing or hidden.
  // With a loadable shape model the value is that model's bounding-sphere radius, used for scaling
  // (Q-43, Q-162), so it is not called a limit.
  const meshSized = isLoadableMeshUrl(card.shape_source?.value ?? null) && b.has('mesh');
  const nucleusKm = numberField(card, 'nucleus_radius_km_max');
  const comaKm = numberField(card, 'coma_radius_km');
  const nucleusDrawn = b.draw('nucleus');
  const nucleusTv = card.nucleus_radius_km_max;
  let nucleusScene = MIN_NUCLEUS_SCENE_RADIUS;
  // The size value has its own tag; a size the honesty state hides is not shown anywhere.
  const sizeShown =
    nucleusDrawn &&
    nucleusKm !== null &&
    nucleusTv !== undefined &&
    isTagShown(ctx.honesty, nucleusTv.tag);
  if (sizeShown) {
    if (comaKm !== null && comaKm > 0) {
      // Sized against the coma radius whether or not the gas shells are drawn, so the nucleus
      // does not change size when the epoch or honesty level changes.
      const ratio = nucleusKm / comaKm;
      nucleusScene = Math.max(ratio, MIN_NUCLEUS_SCENE_RADIUS);
      if (ratio < MIN_NUCLEUS_SCENE_RADIUS)
        b.notes.push(
          'The nucleus is drawn larger than its size relative to the coma so that it stays visible.',
        );
    } else {
      nucleusScene = NUCLEUS_ALONE_SCENE_RADIUS;
      b.notes.push('The nucleus is not drawn to scale: the coma size is not known.');
    }
    b.notes.push(
      meshSized
        ? "The nucleus is scaled to its shape model's own bounding sphere, not to a measured radius."
        : 'The nucleus size is an upper limit.',
    );
  } else if (
    (nucleusDrawn && nucleusKm !== null) ||
    b.missing.find((m) => m.id === 'nucleus')?.reason === 'honesty'
  ) {
    b.notes.push('The nucleus size is hidden at this level, so the nucleus is drawn as a point.');
  } else {
    b.notes.push('The nucleus size is not known, so it is drawn as a point.');
  }

  // Dust: December only. Sun-pointing. Never invented for August.
  let dust: RenderPlan['dust'] = null;
  if (epoch !== '2025-12') b.refuseForEpoch('dust', epoch, 'Dust is drawn for December 2025 only.');
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

  // Tails (issue #43). R7.3 allows a tail only if a published December result shows one, so the
  // tail layers exist only when the backend offers them (ion_tail, dust_tail). Both also need the
  // Sun direction (phase angle or Sun vector); without it they are refused, not guessed.
  const volumes: VolumePlan[] = [];
  const comaLayerTag = layer?.tag ?? 'artistic';
  if (shells.length > 0) {
    const coma = comaVolume(shells, comaLayerTag, params.seed);
    if (coma) {
      volumes.push(coma);
      // The streaks are noise added for looks (artistic) on top of the gas amounts (the layer's tag).
      b.notes.push(
        'Faint streaks in the coma are added for looks. The gas amounts are not changed.',
      );
    }
  }
  if (dust) volumes.push(dustConeVolume(dust, b.layers.get('dust')?.tag ?? 'artistic'));
  const sunKnown = b.lighting.source === 'phase_angle' || b.lighting.source === 'sun_dir';
  let tailDrawn = false;
  for (const [id, make] of [
    [
      'ion_tail',
      () => ionTailVolume(b.lighting.direction ?? [0, 0, 1], (params.seed * 8 + 5) >>> 0),
    ],
    [
      'dust_tail',
      () => dustTailVolume(b.lighting.direction ?? [0, 0, 1], (params.seed * 8 + 6) >>> 0),
    ],
  ] as const) {
    if (!b.has(id)) continue;
    if (!sunKnown) {
      b.reject({
        id,
        reason: 'data',
        fields: ['phase_angle_deg'],
        detail: 'The Sun direction is not known.',
      });
      continue;
    }
    const v = make();
    if (!v) continue;
    // The tail rests on the backend layer (that it exists) and on the viewer's own shape (a
    // display value). It claims no more than the weaker of the two, so a dust tail whose bend is
    // a display choice is never shown as better than that (D-02).
    // Only a phase angle fixes the Sun direction; the `sun_dir` hint is in an unspecified frame
    // (lighting.ts), so a tail aimed by it alone is artistic.
    const sunTag = b.lighting.source === 'phase_angle' ? v.tag : 'artistic';
    const tag = weakerOf(weakerOf(v.tag, b.layers.get(id)!.tag), sunTag);
    if (b.ready(id) && !isTagShown(b.ctx.honesty, tag)) {
      b.reject({ id, reason: 'honesty', tag });
    } else if (b.draw(id)) {
      const entry = b.drawn.find((d) => d.id === id);
      if (entry) entry.tag = tag;
      volumes.push({ ...v, tag });
      tailDrawn = true;
    }
  }
  // The R7.3 layer `tail` (published result) is still never drawn from a card without one.
  if (b.has('tail')) {
    b.reject({ id: 'tail', reason: 'data', detail: 'No published tail result is on the card.' });
  }
  if (!tailDrawn) b.notes.push('No tail is drawn. The list of layers not drawn says why.');
  else b.notes.push('Tails are not to scale. The ion tail points away from the Sun.');

  // Nucleus from a shape model when one exists (67P): the same path as an asteroid shape (R7.1).
  const nucleusUrl = card.shape_source?.value ?? null;
  const meshDrawn = b.draw('mesh', { asset: isLoadableMeshUrl(nucleusUrl) ? nucleusUrl : null });
  const shape = meshDrawn ? planShapeLayers(b) : null;

  const nucleus = litBody('nucleus', [nucleusScene, nucleusScene, nucleusScene], NUCLEUS_TINT, {
    segments: [32, 16],
    meshUrl: meshDrawn ? nucleusUrl : null,
    // The nucleus is dark and lit like a solar-system body.
  });
  // The plan has a body even when the nucleus layer was refused: a point (R7.3), tinted dark.
  return b.build({
    bodies: [nucleus],
    shells,
    dust,
    volumes,
    shape,
    epoch,
    epochs,
    sizeTag: sizeShown ? (nucleusTv?.tag ?? null) : null,
    // R7.3: the size is an upper limit, never a measured radius. A shape model's own bounding
    // radius is a scale, not a limit (Q-162).
    sizeQualifier: sizeShown && !meshSized ? 'upper_limit' : null,
    sizeWhy: nucleusTv
      ? (nucleusTv.formula ?? nucleusTv.assumption ?? nucleusTv.source ?? null)
      : null,
    tintUsed: dust !== null,
    relief: 'illustrative',
  });
}
