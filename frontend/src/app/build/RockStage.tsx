// Issue #71, D-37 (stream V3): the prototype rock engine in the build pane's globe stage. Draws any
// asteroid or comet nucleus from its card (cardToRock), a shape model as a radial height map
// (meshRadial), on its own WebGL2 canvas over the three.js viewer. It renders nothing, and the
// three.js body stays, when: WebGL2 is missing, the card has no size, "Measured only" is on (a
// generated surface is not measured), or the plan did not draw the body (D-32). Pause, Surface age
// and the "How each part is worked out" notes go in the BuildControls slot.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ObjectCard, RenderParams, Tag } from '@/contract';
import { cardToRock, type RockFromCard } from '@/engine/rocks/cardToRock';
import { RockView, type RockStats } from '@/engine/rocks/RockView';
import { radialHeights, type RadialMap } from '@/engine/rocks/meshRadial';
import { useRockStore } from '@/app/rockStore';
import { useBuildControls, type BuildControl, type BuildControlsSpec } from './BuildControls';
import { isTagShown } from '@/viewer/honesty';
import type { HonestyState } from '@/state/store';
import type { RenderPlan } from '@/viewer/planTypes';
import { loadMeshTriangles } from '@/engine/rocks/loadMesh';

const KINDS = ['asteroid_procedural', 'asteroid_shape', 'comet'];

/** Whether the engine draws this object at all (cheap, no WebGL). */
export function rockEngineWanted(
  params: RenderParams | null,
  plan: RenderPlan | null,
  honesty: HonestyState,
): boolean {
  if (!params || !plan || !plan.threeD) return false;
  if (!KINDS.includes(params.type)) return false;
  // A generated surface is model-dependent at best: "Measured only" hides it (R5.3).
  return isTagShown(honesty, 'model_dependent');
}

const fmt = (x: number, d = 0) => x.toLocaleString('en', { maximumFractionDigits: d });

function ageWord(age: number): string {
  return age < 35 ? 'young' : age < 75 ? 'old' : 'ancient, close to saturated';
}

export function rockNotes(rock: RockFromCard) {
  const i = rock.inputs;
  return [
    {
      title: 'How each part is worked out',
      lines: [
        'Lumps: gravity at the surface is g = (4/3)πGρR. Rock can hold relief up to about h/R ≈ Y/(ρgR), so small bodies are lumpy and large ones are round.',
        'Craters: sizes follow N(>D) ∝ D⁻², up to saturation. Depth is about 0.2 of the width, and each crater erodes the older ones.',
        'Boulders: rubble piles get far more. A body spinning faster than the limit P = √(3π/Gρ) has to be solid rock.',
        'Light: airless surfaces use the Lommel–Seeliger law, which gives a flat-looking disc, with real cast shadows and brighter fresh craters.',
        rock.preset.comet
          ? 'Comets: two lobes, very dark, with gas jets strongest on the sunlit side.'
          : 'Rough and rocky is the default for every asteroid. Only data (radar or thermal) can make one smooth, and no card carries that yet.',
        `Size: ${i.size.value} (${i.size.why}). Shape: ${i.shape.value} (${i.shape.why}). Spin: ${i.spin.value}. Reflectivity: ${i.albedo.value} (${i.albedo.why}). Density: ${i.density.value} (${i.density.why}). Rock strength: ${i.strength.value} (${i.strength.why}). Surface age: ${i.age.why}.`,
      ],
      placeholder:
        'Rock strength and bulk density are typical values, and craters are placed by a seed. They are badged Estimated and Default.',
    },
  ];
}

export function RockStage({
  card,
  params,
  plan,
  honesty,
  tint,
  reducedMotion,
}: {
  card: ObjectCard | null;
  params: RenderParams | null;
  plan: RenderPlan | null;
  honesty: HonestyState;
  tint: [number, number, number] | null;
  reducedMotion: boolean;
}) {
  const wanted = rockEngineWanted(params, plan, honesty);
  const rock = useMemo(() => {
    if (!wanted || !card || !params) return null;
    const r = cardToRock(card, { seed: params.seed, tint });
    if ('refused' in r) return null;
    // `?rockmesh=off` draws the generated body even when the card has a shape model (used to compare
    // with the artifact's presets, which have no mesh).
    return typeof location !== 'undefined' && /[?&](rockmesh=off|parity=1)/.test(location.search)
      ? { ...r, meshUrl: null }
      : r;
  }, [wanted, card, params, tint]);
  const live = rock !== null;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<RockView | null>(null);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(reducedMotion);
  const [age, setAge] = useState(70);
  const [stats, setStats] = useState<RockStats | null>(null);
  const [meshNote, setMeshNote] = useState<string | null>(null);
  const setStore = useRockStore((s) => s.set);

  // One engine for the life of the stage, one canvas.
  useEffect(() => {
    const host = hostRef.current;
    if (!live || !host || !RockView.supported()) return;
    const canvas = document.createElement('canvas');
    // The prototype frames the body for a landscape stage (8:5): the canvas keeps that shape.
    canvas.className = 'block w-full touch-none';
    canvas.style.aspectRatio = '8 / 5';
    canvas.style.maxHeight = '100%';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.dataset.testid = 'rock-canvas';
    host.appendChild(canvas);
    const view = new RockView(reducedMotion);
    let off: (() => void) | null = null;
    try {
      off = view.attach(canvas);
    } catch {
      view.dispose();
      canvas.remove();
      return;
    }
    view.onChange(setStats);
    viewRef.current = view;
    setStore(view);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the engine now exists
    setReady(true);
    return () => {
      setReady(false);
      off?.();
      view.dispose();
      canvas.remove();
      viewRef.current = null;
      setStore(null);
    };
  }, [live, reducedMotion, setStore]);

  // The body: generated, or from a shape model (loaded after the generated body is already drawn).
  const key = rock ? `${rock.preset.id}|${rock.preset.seed}|${rock.meshUrl ?? ''}` : '';
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !rock || !ready) return;
    let cancelled = false;
    setMeshNote(null);
    view.setBody(rock, null);
    if (rock.meshUrl) {
      loadMeshTriangles(rock.meshUrl).then(
        (tris) => {
          if (cancelled || !tris) return;
          const map: RadialMap = radialHeights(tris);
          view.setBody(rock, map);
        },
        () =>
          !cancelled &&
          setMeshNote('The shape model did not load, so a generated surface is shown.'),
      );
    }
    return () => {
      cancelled = true;
    };
    // `key` stands for the rock's content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  useEffect(() => {
    viewRef.current?.setPlaying(!paused);
  }, [paused, ready]);

  const spec: BuildControlsSpec | null = useMemo(() => {
    if (!rock || !ready) return null;
    const i = rock.inputs;
    const row = (id: string, label: string, v: { value: string; tag: Tag }): BuildControl => ({
      kind: 'readout',
      id,
      label,
      value: v.value,
      tag: v.tag,
    });
    const controls: BuildControl[] = [
      { kind: 'toggle', id: 'rock-pause', label: 'Pause', pressed: paused, onChange: setPaused },
      {
        kind: 'slider',
        id: 'rock-age',
        label: 'Surface age',
        min: 0,
        max: 100,
        step: 1,
        value: age,
        valueText: ageWord(age),
        tag: 'artistic',
        onChange: (v) => {
          setAge(v);
          useRockStore.getState().view?.setAge(v);
        },
      },
      row('rock-size', 'Size', i.size),
      row('rock-shape', 'Shape', i.shape),
      row('rock-spin', 'Spin period', i.spin),
      row('rock-albedo', 'Reflectivity', i.albedo),
      row('rock-density', 'Bulk density', i.density),
      row('rock-strength', 'Rock strength', i.strength),
    ];
    if (stats) {
      controls.push(
        {
          kind: 'readout',
          id: 'rock-g',
          label: 'Surface gravity',
          value:
            stats.gravity < 0.01
              ? `${fmt(stats.gravity * 1000, 2)} mm/s²`
              : `${fmt(stats.gravity, 3)} m/s²`,
          tag: 'derived',
        },
        {
          kind: 'readout',
          id: 'rock-lump',
          label: 'Relief it can hold',
          value: `${fmt(stats.lump * 100)}% of its radius`,
          tag: 'artistic',
        },
        {
          kind: 'readout',
          id: 'rock-craters',
          label: 'Craters generated',
          value: fmt(stats.craters),
          tag: 'artistic',
        },
        {
          kind: 'readout',
          id: 'rock-struct',
          label: 'Likely structure',
          value: stats.kind,
          tag: 'inferred_from_analog',
        },
      );
    }
    return {
      title: rock.preset.comet ? 'Nucleus surface' : 'Asteroid surface',
      controls,
      notes: [
        ...rockNotes(rock),
        ...(meshNote ? [{ title: 'Shape model', lines: [meshNote] }] : []),
      ],
    };
  }, [rock, ready, paused, age, stats, meshNote]);
  useBuildControls('rocks', spec);

  if (!rock) return null;
  return (
    <div
      ref={hostRef}
      className="absolute inset-0 z-[1] flex items-center justify-center bg-black"
      data-testid="rock-stage"
      aria-label={`${rock.preset.label}, generated surface. Drag or use the arrow keys to turn it.`}
    />
  );
}
