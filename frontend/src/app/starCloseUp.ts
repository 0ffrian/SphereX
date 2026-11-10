// Issue #71 stream G: what the star close-up needs from a plan. Stream H's split-pane host calls
// `closeUpFor(plan)` (or the hook) and mounts `<StarCloseUp {...props} />` in the left pane.
import { useMemo } from 'react';
import type { RenderPlan } from '@/viewer/planTypes';
import { LIMB_DARKENING_U } from '@/viewer/renderers/Star';
import type { StarCloseUpProps } from '@/viewer/renderers/starCloseUpScene';

/** The honesty line the mock-up shows over the close-up (cuTag). */
export const STAR_CLOSEUP_TAG =
  'Close-up · a flare on the star’s surface · illustrative (Default), not a measurement';

/**
 * Props for the star close-up, or null when the plan has no star with surface physics (a Mira, a
 * star with no temperature, or a body that is not drawn): then the host shows its usual fallback.
 * `flare` is the flare to show (the globe's latest event); null shows the default, open and class X.
 */
export function closeUpFor(
  plan: RenderPlan,
  flare: StarCloseUpProps['flare'] = null,
): StarCloseUpProps | null {
  const star = plan.star;
  const body = plan.bodies[0];
  if (!star?.physics || !body) return null;
  return {
    physics: star.physics,
    tint: body.tint,
    emissive: body.emissive,
    limbU: body.limbDarkening ? LIMB_DARKENING_U : null,
    seed: star.seed,
    flare,
  };
}

/** `closeUpFor` memoised on the plan and the flare. */
export function useStarCloseUp(
  plan: RenderPlan | null,
  flare: StarCloseUpProps['flare'] = null,
): StarCloseUpProps | null {
  const open = flare?.open;
  const energy = flare?.energyErg;
  return useMemo(
    () =>
      plan ? closeUpFor(plan, open === undefined ? null : { open, energyErg: energy ?? 0 }) : null,
    [plan, open, energy],
  );
}
