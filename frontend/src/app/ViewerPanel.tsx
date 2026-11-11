// R4 level 3 (Sky Sculptor) panel: mounts the ViewerApp canvas, draws the loaded ObjectCard +
// RenderParams (renderer chosen by type, R7), and holds the controls and labels that make the
// picture honest: the 3-state honesty control (R5.3, D-21), view modes (R5.2), the comet epoch
// toggle (R7.3), the scale bar (R5.4), a legend with a provenance badge per layer (D-02), and the
// plain-words list of layers that are not drawn. Rotate/zoom buttons are the WCAG 2.5.7
// alternative to dragging (R5.6). R9: canvas aria-label follows the view; a polite live region
// announces mode, epoch and honesty changes.
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAppStore } from '@/state/store';
import { prefersReducedMotion, ViewerApp } from '@/viewer/ViewerApp';
import { showsBody } from '@/viewer/planCommon';
import {
  canvasLabel,
  epochAnnouncement,
  formatMjdDate,
  honestyAnnouncement,
  modeAnnouncement,
  nothingDrawnReason,
} from '@/viewer/altText';
import {
  effectiveHonesty,
  HONESTY_LABEL,
  HONESTY_STATES,
  isTagShown,
  type HonestyState,
} from '@/viewer/honesty';
import type { PlanContext, RenderPlan, ViewModeId } from '@/viewer/planTypes';
import { defaultContext, planRender } from '@/viewer/renderPlan';
import { COMET_EPOCHS, epochsWithQ, EPOCH_LABEL } from '@/viewer/renderers/Comet';
import {
  closeUpTarget,
  starCaption,
  starReadouts,
  type StarColourView,
  type StarScale,
} from '@/physics/stellar';
import { AT_AGE_MAX_PHRASE, scaleBarFor, shownSize } from '@/viewer/scaleBar';
import { SLIDER_REGISTRY } from '@/viewer/sliders';
import type { CometEpoch, ObjectCard, RenderParams } from '@/contract';
import { ProvenanceBadge } from './Badge';
import { EmissionsPanel } from './EmissionsPanel';
import { EPOCH_JD, timeRange } from '@/physics/cometGas';
import { ConfidenceChip, ConfidenceDetails } from './ConfidencePanel';
import { FeelPanel, HearPanel } from './build/Senses';
import { BuildControls, BuildKeyNumbers, BuildSummaryRows } from './build/BuildControls';
import GridLoader, { type GridLoaderProps } from './island/GridLoader';
import { ConfidencePopover } from './ConfidencePopover';
import { displayName } from './displayName';
import { Row, Rows, SwitchRow, ToggleGroup } from './PanelControls';
import { timeLapsesOf } from '@/viewer/motion/planMotion';
import { describeRefusal, layerName, timeLapseText } from './messages';
import { buttonClass } from './ui';
import { closeUpKindOf } from './CloseUpPane';
import { useCloseUpStore } from './closeUpStore';
import { StarEngineDetails, StarFlarePanel } from './StarFlarePanel';
import { RockStage } from './build/RockStage';
import { StarGlobeStage, useEngineStar } from './StarEngineStage';
import { WorldGlobeStage, useEngineWorld } from './WorldEngineStage';
import { engineKey, useWorldStore } from './worldStore';
import { MouldStrip, type StripHandle } from './build/MouldStrip';
import { useMould, type MouldPhase } from './build/useMould';
import { usesBrowserSeed } from '@/viewer/mould/mouldSteps';

const NO_FAILED: readonly string[] = [];
const AGE_SLIDER = SLIDER_REGISTRY.age_yr;

/** The age slider runs on log10(years): one key press is the same relative change everywhere. */
const AGE_LOG_MIN = Math.log10(AGE_SLIDER.min);
const AGE_LOG_MAX = Math.log10(AGE_SLIDER.max);
const AGE_LOG_STEP = 0.01;
/** Years from a slider position, rounded to 3 significant digits and kept inside the range. */
export function ageFromLog(pos: number): number {
  const raw = Math.pow(10, pos);
  // Whole years below 1,000 ("10 years", not "10.2 years"); 3 significant digits above.
  const years = raw < 1000 ? Math.round(raw) : Number(raw.toPrecision(3));
  return Math.min(AGE_SLIDER.max, Math.max(AGE_SLIDER.min, years));
}

/** "1,200 years", "10 years". */
/** Short Colour labels for the narrow Details pane. */
function shortModeLabel(label: string): string {
  if (/infrared/i.test(label)) return 'Infrared';
  if (/^visible/i.test(label)) return 'Visible';
  return label;
}

function formatYears(n: number): string {
  const w = n < 1000 ? Math.round(n) : n;
  return `${w.toLocaleString('en')} ${w === 1 ? 'year' : 'years'}`;
}

/** `prefers-reduced-motion`, kept current when the setting changes while the page is open. */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    onChange();
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** The viewer choices that belong to one object; a new object starts from the defaults. */
interface Choices {
  key: string;
  mode: ViewModeId | null;
  epoch: CometEpoch | null;
  scrub: number;
  /** Issue #71 stream C: a star's colour view and scale; null = the default (true colour, enlarged; Q-290). */
  starColour?: StarColourView | null;
  starScale?: StarScale | null;
}

/** What a provenance tier (D-32) means, in words for a non-astronomer. */
const TIER_WORDS: Record<number, string> = {
  1: 'measured',
  2: 'worked out from measurements',
  3: 'worked out with a typical value',
  4: 'typical for this kind of object',
  5: 'the artist\u2019s choice',
};
export function tierText(tier: number): string {
  const words = TIER_WORDS[tier];
  return words ? `tier ${tier} of 5, ${words}` : `tier ${tier} of 5`;
}

const STAR_COLOUR_LABEL: Record<StarColourView, string> = {
  observatory: 'Observatory view',
  enhanced: 'Enhanced colour',
  true: 'True colour',
};
const STAR_COLOUR_OPTIONS: { value: StarColourView; label: string }[] = [
  { value: 'true', label: 'True colour' },
  { value: 'enhanced', label: 'Enhanced' },
  { value: 'observatory', label: 'Observatory' },
];
const STAR_SCALE_OPTIONS: { value: StarScale; label: string }[] = [
  { value: 'enlarged', label: 'Larger detail' },
  { value: 'true', label: 'True scale' },
  { value: 'close', label: 'Close-up' },
];
const STAR_SCALE_LABEL: Record<StarScale, string> = {
  enlarged: 'Whole star, larger detail',
  true: 'Whole star, true scale',
  close: 'Close-up',
};

/** Said when a build starts and the level goes up so the whole body can be built (issue #60). */
export const LEVEL_RAISED_ANNOUNCEMENT =
  "Showing artist's impression so the whole body can be built";

/** Said (live region) when the governor lowers the render quality. */
export const QUALITY_DROP_ANNOUNCEMENT = 'Lowered render quality to keep motion smooth';

/** Said when a brown dwarf is in the infrared view, which is a plain disc, and the visible view moves. */
export const IR_JETS_HINT =
  'Switch to "Visible colour" to see the jets move. This motion is an artist\u2019s impression.';

/** The mock-up's build loader sequence (`loading("bLoad")`). */
const BUILD_LOADER_LOOK: GridLoaderProps = {
  mode: 'sequence',
  sequence: ['spiral-cw', 'ripple-out', 'plus-full', 'frame', 'ripple-in', 'spiral-ccw'],
  speed: 'normal',
};

/** The id of the build pane's popover (the header buttons' `aria-controls`). */
export const BUILD_POP_ID = 'bp-pop';
const POP_LABEL: Record<PopId, string> = {
  acc: 'Accuracy',
  feel: 'Feel it',
  hear: 'Hear it',
  details: 'Details',
};
/** The mock-up's words for a kind it has no score for (`renderAcc`, no rows). */
export const NO_SCORE_TEXT =
  'No score is set for this kind of object. It has no measurement that could stand for a key measurement, so the viewer shows what it can and says what it leaves out.';

const PLACEHOLDER_LABEL = 'Viewer placeholder: no object loaded';

/** Issue #71 stream U: the panels the build pane's header buttons open (mock-up `bpPop`, one at a time). */
export type PopId = 'acc' | 'feel' | 'hear' | 'details';

/** Issue #60: the panel inside the build pane (canvas fills the stage, controls behind Details). */
export interface PaneOptions {
  /** Which popover is open under the header buttons (null = none). */
  pop?: PopId | null;
  /** Closes (null) or switches the open popover (the Accuracy panel's own close, Escape). */
  onPop?(pop: PopId | null): void;
  /** The build actions (Replay, New seed, close-up toggle): the top of Details. */
  actions?: ReactNode;
  /** The honesty caption under the body (the level it is shown at); `extra` is added at its end. */
  caption?(extra: ReactNode): ReactNode;
  /** Changes start a new build (open, Replay, New seed). */
  seq: number;
  animate: boolean;
  /** "New seed": added to the render params' seed (0 = the params' own seed). */
  seedOffset: number;
  /**
   * The store's card and params are not the selected object's (still loading, or another object's):
   * the panel shows its loading state and hands nothing to the viewer.
   */
  blocked?: boolean;
  onPhase?(phase: MouldPhase): void;
  /** Whether the plan on screen has something generated from the seed (else "New seed" is moot). */
  onUsesSeed?(usesSeed: boolean): void;
  /** Called with the viewer once it exists (null when it goes). */
  onViewer?(viewer: ViewerApp | null): void;
}

/** Issue #71 stream E: the two speeds of a simulated gas world (the slider `gas_pacing`: 0 or 1). */
export const GAS_PACING_CHOICES = [
  { value: 0, label: '5 minutes per second' },
  { value: 1, label: '1 day per second' },
] as const;

export function gasPacingStatus(value: 0 | 1): string {
  return value === 1
    ? 'One second here is one Earth day. The view stays above the turning planet, so you can watch storms drift.'
    : 'One second here is 5 minutes, so the planet turns slowly and its clouds barely change.';
}

export function ViewerPanel({ pane }: { pane?: PaneOptions } = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewer, setViewer] = useState<ViewerApp | null>(null);
  const setRendererStatus = useAppStore((s) => s.setRendererStatus);
  const rendererStatus = useAppStore((s) => s.rendererStatus);
  const blocked = pane?.blocked === true;
  const storeCard = useAppStore((s) => s.card);
  const storeParams = useAppStore((s) => s.params);
  const card = blocked ? null : storeCard;
  // Issue #71 stream X (D-37): the prototype's star engine draws star cards in the build pane; null keeps the TSL path.
  const engineStarCard = useEngineStar();
  // Issue #71 stream Y (D-37): the prototype's world engine draws planets and gas giants; null keeps the old path.
  const engineWorldCard = useEngineWorld();
  const worldFailedId = useWorldStore((s) => s.failedId);
  const starFailedId = useWorldStore((s) => s.starFailedId);
  // A rock engine draws the body: reported by RockStage once its canvas is attached.
  const [rockOwns, setRockOwns] = useState(false);
  const storedParams = blocked ? null : storeParams;
  const seedOffset = pane?.seedOffset ?? 0;
  // "New seed" (issue #60): the same params with another seed; the same card + seed always give
  // the same body (determinism).
  const params = useMemo(
    () =>
      storedParams && seedOffset
        ? { ...storedParams, seed: (storedParams.seed + seedOffset) >>> 0 }
        : storedParams,
    [storedParams, seedOffset],
  );
  const storedHonesty = useAppStore((s) => s.honesty);
  const setHonesty = useAppStore((s) => s.setHonesty);
  const honesty = effectiveHonesty(storedHonesty);

  // Viewer choices that belong to this panel, not to the data. Keyed by object so that a new
  // object starts from its defaults (the comet opens on its latest epoch with gas data).
  const objectKey = params ? `${params.id}|${params.generator_version}|${params.seed}` : '';
  const [stored, setChoices] = useState<Choices>({
    key: '',
    mode: null,
    epoch: null,
    scrub: 0,
  });
  const choices: Choices =
    stored.key === objectKey ? stored : { key: objectKey, mode: null, epoch: null, scrub: 0 };
  const modeChoice = choices.mode;
  // The remnant age is a D-02 override in the store, so the store's reset clears it.
  const overrides = useAppStore((s) => s.overrides);
  const setOverride = useAppStore((s) => s.setOverride);
  const ageChoice = typeof overrides.age_yr === 'number' ? overrides.age_yr : null;
  const scrubIndex = choices.scrub;
  const epochsWithData = useMemo(
    () => (card && params?.type === 'comet' ? epochsWithQ(card) : []),
    [card, params],
  );
  const epoch: CometEpoch = choices.epoch ?? epochsWithData.at(-1) ?? defaultContext().epoch;
  // Issue #71 F: the emissions view (comets with gas in both epochs) and its time. A new object closes it.
  const [emissions, setEmissions] = useState<{ key: string; jd: number } | null>(null);
  const emissionsRange = card && params?.type === 'comet' ? timeRange(card) : null;
  const emissionsJd =
    emissions && emissions.key === objectKey && emissionsRange ? emissions.jd : null;
  // Layers whose mesh or texture failed to load, per object. Keyed so a new object starts clean.
  const [failedState, setFailedState] = useState<{ key: string; ids: string[] }>({
    key: '',
    ids: [],
  });
  const failed = failedState.key === objectKey ? failedState.ids : NO_FAILED;
  const reducedMotion = useReducedMotion();
  const [spinPaused] = useState(false); // the Pause button is gone from Details (Moon); kept for the engine hook
  // Under reduced motion the scene starts paused; this is the user's choice to play it anyway.
  const [playAnyway, setPlayAnyway] = useState(false);
  // The choice ends when the preference is switched off (adjusted while rendering, not in an effect).
  const [prevReduced, setPrevReduced] = useState(reducedMotion);
  if (prevReduced !== reducedMotion) {
    setPrevReduced(reducedMotion);
    if (!reducedMotion) setPlayAnyway(false);
  }
  // R5.7: a phone pauses the clock after a minute without input; said here, lifted by the button.
  const [idlePaused, setIdlePaused] = useState(false);
  useEffect(() => {
    if (!viewer) return; // a new viewer starts not idle; the handler reports every change
    viewer.setIdleChangeHandler?.(setIdlePaused);
    return () => viewer.setIdleChangeHandler?.(null);
  }, [viewer]);
  const [whyOpen, setWhyOpen] = useState(false);
  const [formulaOpen, setFormulaOpen] = useState(false);
  const detailsId = useId();
  const whyId = useId();
  const fixture = useAppStore((s) => s.sky.fixture);
  const [announcement, setAnnouncement] = useState('');

  // The viewer's quality level (R5.7): the plan lists a layer that level does not draw as refused
  // (Q-117). Read when the viewer appears, then kept by the quality-change handler below.
  // A change reported by the viewer wins; until then the level it started on.
  const [tierChange, setTierChange] = useState<{
    viewer: ViewerApp;
    tier: NonNullable<PlanContext['qualityTier']>;
  } | null>(null);
  const startTier = viewer?.renderStats?.().tier;
  const qualityTier: PlanContext['qualityTier'] =
    tierChange && tierChange.viewer === viewer
      ? tierChange.tier
      : startTier === 'high' || startTier === 'medium' || startTier === 'low'
        ? startTier
        : undefined;

  const ctx: PlanContext = useMemo(
    () =>
      defaultContext({
        honesty,
        mode: modeChoice,
        epoch,
        cometJd: emissionsJd,
        scrubIndex,
        failed,
        overrides,
        qualityTier,
        starColour: choices.starColour ?? undefined,
        starScale: choices.starScale ?? undefined,
      }),
    [
      honesty,
      modeChoice,
      epoch,
      emissionsJd,
      scrubIndex,
      failed,
      overrides,
      qualityTier,
      choices.starColour,
      choices.starScale,
    ],
  );
  const plan = useMemo(
    () => (card && params ? planRender(card, params, ctx) : null),
    [card, params, ctx],
  );
  // Issue #43: a loaded shape model carries its own size in metres (glTF units, Q-61), which is the
  // measured size, so the scale bar shows it instead of the catalogue diameter (Eros at real size).
  const [meshSize, setMeshSize] = useState<{ key: string; radiusM: number } | null>(null);
  const meshRadiusM = meshSize?.key === objectKey ? meshSize.radiusM : null;
  const remnantShown = plan?.type === 'nova' && plan.drawn.some((l) => l.id === 'point_cloud');
  // The age slider shrinks the drawn shell (to 3%), so the card's size is the shell at the
  // slider maximum: say so in the bar, the label and the announcements (Q-103). Used for the
  // plan on screen and for the plan an honesty toggle is about to show.
  const sizeOf = (p: RenderPlan, state: HonestyState) => {
    const s = shownSize(p, meshRadiusM, state);
    const remnant = p.type === 'nova' && p.drawn.some((l) => l.id === 'point_cloud');
    return remnant ? { ...s, atSliderMax: true } : s;
  };
  const size = useMemo(
    () => (plan ? sizeOf(plan, honesty) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sizeOf` only reads `meshRadiusM`
    [plan, meshRadiusM, honesty],
  );
  const bar = useMemo(() => (size ? scaleBarFor(size.radiusM, size.qualifier) : null), [size]);

  // Mount the renderer once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // The canvas is created per mount, so a StrictMode re-mount never shares a GPU context
    // with a renderer that is still being disposed.
    const canvas = document.createElement('canvas');
    // The canvas takes keyboard focus (arrows, +/−, R), so it needs a visible focus ring. The
    // negative offset keeps the ring inside the rounded, overflow-hidden frame.
    canvas.className =
      'block h-full w-full touch-none focus-visible:outline-2 focus-visible:-outline-offset-4 ' +
      'focus-visible:outline-sky-400';
    canvas.tabIndex = 0;
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', canvasLabel(null));
    host.appendChild(canvas);
    canvasRef.current = canvas;

    let cancelled = false;
    let app: ViewerApp | null = null;
    setRendererStatus('starting');

    ViewerApp.create(canvas).then(
      (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        app = created;
        canvas.dataset.backend = created.backend;
        console.info(`[viewer] three r187 WebGPURenderer backend: ${created.backend}`);
        setRendererStatus(created.backend);
        // Test hook for e2e/shaderKinds.spec.ts; dead-code-eliminated from production builds.
        if (import.meta.env.MODE === 'fixtures') {
          const w = window as unknown as {
            __sxViewer?: ViewerApp;
            __sxShow?: (
              card: ObjectCard,
              params: RenderParams,
              honesty: HonestyState,
              mode?: 'visible' | 'spherex_ir',
            ) => RenderPlan;
          };
          w.__sxViewer = created;
          void import('@/perf/fixturesPerf').then((m) => m.installPerfHooks());
          // Plans and draws like the panel does, for a given honesty state.
          w.__sxShow = (c, p, honesty, mode) => {
            // The epoch the panel itself opens on (a comet: its latest epoch with gas data), so a
            // fixture card is drawn at its own epoch and not at the default one.
            const epoch = epochsWithQ(c).at(-1) ?? defaultContext().epoch;
            // The viewer's quality level, as the panel passes it (PR #63 nit), so a low-tier run
            // lists the layers that level does not draw as refused (`quality`, Q-117).
            const tier = created.renderStats?.().tier;
            const qualityTier =
              tier === 'high' || tier === 'medium' || tier === 'low' ? tier : undefined;
            const shown = planRender(
              c,
              p,
              defaultContext({ honesty, epoch, mode: mode ?? null, qualityTier }),
            );
            created.showPlan(shown);
            return shown;
          };
        }
        setViewer(created);
      },
      (err: unknown) => {
        if (cancelled) return;
        canvas.dataset.backend = 'unavailable';
        console.warn('[viewer] no WebGPU or WebGL2 backend available', err);
        setRendererStatus('unavailable');
      },
    );

    return () => {
      cancelled = true;
      app?.dispose();
      app = null;
      canvasRef.current = null;
      setViewer(null);
      canvas.remove();
    };
  }, [setRendererStatus]);

  // A failed mesh or texture refuses that layer; the plan is redone without it.
  useEffect(() => {
    if (!viewer) return;
    viewer.setLoadFailedHandler((layerId) =>
      setFailedState((prev) => {
        const ids = prev.key === objectKey ? prev.ids : [];
        return ids.includes(layerId) ? prev : { key: objectKey, ids: [...ids, layerId] };
      }),
    );
    return () => {
      viewer.setLoadFailedHandler(null);
    };
  }, [viewer, objectKey]);

  useEffect(() => {
    if (!viewer) return;
    viewer.setMeshMeasuredHandler?.((m) => setMeshSize({ key: objectKey, radiusM: m.radiusM }));
    return () => viewer.setMeshMeasuredHandler?.(null);
  }, [viewer, objectKey]);

  // A tier drop from the frame-time governor is said in plain words and shown (R9, never silent).
  const [qualityLowered, setQualityLowered] = useState(false);
  useEffect(() => {
    if (!viewer) return;
    viewer.setQualityChangeHandler((e) => {
      setTierChange({ viewer, tier: e.to });
      if (!e.auto) return;
      setAnnouncement(QUALITY_DROP_ANNOUNCEMENT);
      setQualityLowered(true);
    });
    return () => viewer.setQualityChangeHandler(null);
  }, [viewer]);

  // The remnant age slider (D-27): moves the drawn shell without a rebuild, and is kept for the
  // next build. Before the plan effect below, so a new object starts from its own value.
  useEffect(() => {
    viewer?.setOverrides?.(overrides);
  }, [viewer, overrides]);

  // The pause choice is the user's; the viewer keeps it across rebuilds.
  useEffect(() => {
    viewer?.setSpinPaused(spinPaused);
  }, [viewer, spinPaused]);
  useEffect(() => {
    viewer?.setMotionOverride?.(playAnyway);
  }, [viewer, playAnyway]);

  // Draw the plan. Not keyed on the measured size: a size report for the same plan must not
  // re-run showPlan (it would reallocate the shadow map, rebuild lit pipelines and reset TAA).
  // In the build pane the moulding driver draws instead (it shows the stages, then this plan).
  const inPane = pane !== undefined;
  useEffect(() => {
    if (!viewer || inPane) return;
    if (plan) viewer.showPlan(plan);
    else viewer.clearObject();
  }, [viewer, plan, inPane]);

  const stripRef = useRef<StripHandle>(null);
  const onUsesSeed = pane?.onUsesSeed;
  useEffect(() => {
    onUsesSeed?.(plan ? usesBrowserSeed(plan) : true);
  }, [plan, onUsesSeed]);
  const onPaneViewer = pane?.onViewer;
  useEffect(() => {
    onPaneViewer?.(viewer);
  }, [viewer, onPaneViewer]);
  useEffect(() => {
    if (!viewer || !inPane) return;
    viewer.setDragTurnsBody(true);
    return () => viewer.setDragTurnsBody(false);
  }, [viewer, inPane]);
  // Issue #60: a build from the card or Replay shows the whole plan. If the plan has layers the
  // honesty level hides (the generated world is `artistic`, D-21), the level goes up to
  // "+ Artistic" first and says so; the Show control stays, so the user can drop back at any time.
  // The build waits for this (`waitForLevel`), so it never starts on the plan of the old level.
  const [levelSeq, setLevelSeq] = useState(-1);
  const paneSeq = pane?.seq ?? 0;
  const waitForLevel = inPane && pane.animate && levelSeq !== paneSeq;
  useEffect(() => {
    if (!waitForLevel || !plan) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- ends the wait, in one batch with the store write
    setLevelSeq(paneSeq);
    if (plan.threeD && plan.missing.some((m) => m.reason === 'honesty') && honesty !== 'artistic') {
      setHonesty('artistic');
      setAnnouncement(LEVEL_RAISED_ANNOUNCEMENT);
    }
  }, [waitForLevel, plan, paneSeq, honesty, setHonesty]);
  const mould = useMould({
    wait: waitForLevel,
    viewer: inPane ? viewer : null,
    card,
    params,
    ctx,
    plan,
    seq: pane?.seq ?? 0,
    animate: pane?.animate ?? false,
    reducedMotion,
    onProgress: (p) => stripRef.current?.update(p),
    onPhase: (phase) => pane?.onPhase?.(phase),
  });

  // The canvas label (R9) reads the same size as the scale bar (the model's own size for a shape
  // model). Also after `viewer` is set, since that is when the canvas exists.
  useEffect(() => {
    canvasRef.current?.setAttribute('aria-label', canvasLabel(plan, size));
  }, [viewer, plan, size]);

  const announce = useCallback((text: string) => setAnnouncement(text), []);
  const planWith = (patch: Partial<PlanContext>) =>
    card && params ? planRender(card, params, { ...ctx, ...patch }) : null;

  const onHonesty = (state: HonestyState) => {
    setHonesty(state);
    const next = planWith({ honesty: state });
    // The size can change with the level (a shape model's own size swaps with the card's): say so.
    announce(
      next ? honestyAnnouncement(state, next, sizeOf(next, state), size) : HONESTY_LABEL[state],
    );
  };
  const onMode = (mode: ViewModeId) => {
    setChoices({ ...choices, mode });
    const next = planWith({ mode });
    if (next) announce(modeAnnouncement(mode, next));
  };
  const onEpoch = (e: CometEpoch) => {
    setChoices({ ...choices, epoch: e });
    const next = planWith({ epoch: e });
    if (next) announce(epochAnnouncement(e, next));
  };
  // Issue #71 stream C: colour view and scale of a star. Cells do not show in the Observatory view,
  // so choosing Close-up from it moves to Enhanced colour (and the reverse leaves Close-up).
  const starColour: StarColourView = plan?.star?.colourView ?? 'true';
  const starScale: StarScale = plan?.star?.scale ?? 'enlarged';
  const setStarView = (colour: StarColourView, scale: StarScale) => {
    let c = colour;
    const sc = scale;
    let moved = '';
    if (sc === 'close' && c === 'observatory') {
      c = 'enhanced';
      moved =
        ' Colour changed to Enhanced colour, because cells do not show in the Observatory view.';
    }
    setChoices({ ...choices, starColour: c, starScale: sc });
    const next = planWith({ starColour: c, starScale: sc });
    if (sc === 'close' && next?.star?.physics)
      viewer?.setStarCloseUp(closeUpTarget(next.star.physics));
    else if (starScale === 'close') viewer?.setStarCloseUp(null);
    announce(
      `${STAR_COLOUR_LABEL[c]}, ${STAR_SCALE_LABEL[sc]}.${moved} ${next?.star?.physics ? starCaption(next.star.physics, sc) : ''}`.trim(),
    );
  };
  // Not announced here: the slider's own value text is read by screen readers when it moves.
  const onScrub = (i: number) => setChoices({ ...choices, scrub: i });
  const gasPacing = overrides.gas_pacing === 1 ? 1 : 0;
  const onGasPacing = (value: 0 | 1) => {
    setOverride('gas_pacing', value);
    announce(gasPacingStatus(value));
  };
  const onAge = (pos: number) => setOverride('age_yr', ageFromLog(pos));

  // The age slider shows only while the remnant is drawn (it is an artist's impression).
  const age = ageChoice ?? AGE_SLIDER.max;

  const nothingDrawn = plan && plan.threeD && !showsBody(plan) ? nothingDrawnReason(plan) : null;
  const defaultsShown = plan?.missing.filter((m) => m.defaultShown) ?? [];
  const notDrawn = plan?.missing.filter((m) => !m.defaultShown) ?? [];
  // The close-up pane (issue #71 stream H, Q-275) fills the left half of the app, over the sky, while
  // this viewer stays in the build pane: it opens with the build (mock-up `cuOpen`) and closes with
  // it (`cuClose`). The viewer and plan go to a small store the pane reads. The toggle next to Feel
  // hides or shows it.
  const closeKind = pane ? closeUpKindOf(params?.type) : null;
  const engineStar =
    pane && honesty !== 'measured' && plan?.threeD && card && !blocked && engineStarCard && starFailedId !== engineKey(card.id, engineStarCard.preset.id)
      ? engineStarCard
      : null;
  const engineWorld =
    pane && honesty !== 'measured' && plan?.threeD && card && !blocked && engineWorldCard && worldFailedId !== engineKey(card.id, engineWorldCard.preset.id)
      ? engineWorldCard
      : null;
  // D-37: while an engine draws the body the three.js viewer builds and draws nothing under it.
  const engineOwns = engineStar !== null || engineWorld !== null || rockOwns;
  useEffect(() => {
    viewer?.setEngineOwned?.(engineOwns);
  }, [viewer, engineOwns]);
  const tintTag = plan?.tint.tag ?? null;
  const tintKey = plan?.tint.rgb.join(',') ?? '';
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tintKey stands for the rgb values
  const rockTint = useMemo<[number, number, number] | null>(() => (tintTag && plan ? [plan.tint.rgb[0]!, plan.tint.rgb[1]!, plan.tint.rgb[2]!] : null), [tintTag, tintKey]);
  // Hidden by the user, or held back until the build has shifted to the right half (stream U).
  const closeHidden = useCloseUpStore((s) => s.hidden || s.held);
  const closeInfo = useCloseUpStore((s) => s.info);
  const shaderKey = plan?.shader?.key ?? '';
  const pubFixture = fixture || (card?.id.startsWith('fixture:') ?? false);
  useEffect(() => {
    useCloseUpStore.getState().publish({ viewer, plan, type: params?.type ?? null, fixture: pubFixture, reducedMotion, engineStar, engineWorld });
  }, [viewer, plan, params?.type, reducedMotion, pubFixture, engineStar, engineWorld]);
  useEffect(() => () => useCloseUpStore.getState().reset(), []);
  useEffect(() => {
    if (!viewer) return;
    viewer.setCloseUpHandler((info) => useCloseUpStore.getState().setInfo(info));
    return () => viewer.setCloseUpHandler(null);
  }, [viewer]);
  const artisticShown = honesty === 'artistic';
  useEffect(() => {
    if (!viewer) return;
    if (!pane || !closeKind || !plan?.threeD || closeHidden || blocked) {
      viewer.closeUpOff(true);
      return;
    }
    // The orbit view is an artist's impression (heights, clouds, detail): shown at "+ Artistic" like the globe's surface.
    const gate =
      closeKind === 'orbit' && !artisticShown
        ? "Close-up · the surface from orbit is an artist's impression: choose + Artistic to see it"
        : null;
    // A star the engine draws has its own close-up in the pane (the flare close-up), so the viewer's is off.
    if (closeKind === 'star' && engineStar) {
      viewer.closeUpOff(true);
      return;
    }
    // A planet the world engine draws has its own surface view in the pane (stream Y), so the viewer's is off.
    if (closeKind === 'orbit' && engineWorld) {
      viewer.closeUpOff(true);
      return;
    }
    viewer.openCloseUp(closeKind === 'body', closeKind === 'star', gate);
    return () => viewer.closeUpOff(true);
  }, [viewer, pane, closeKind, closeHidden, blocked, plan?.threeD, objectKey, shaderKey, artisticShown, engineStar, engineWorld]);
  // A gas giant that is still forming opens when it has settled.
  useEffect(() => {
    if (!viewer || !closeInfo?.refusal || !/forming/.test(closeInfo.refusal) || closeHidden) return;
    const id = window.setTimeout(() => viewer.openCloseUp(false, false), 1000);
    return () => window.clearTimeout(id);
  }, [viewer, closeInfo, closeHidden]);
  const objectIsFixture = fixture || (card?.id.startsWith('fixture:') ?? false);
  // Read from the plan, not from the viewer, so it is never a frame behind (what the clock runs).
  const lapses = plan ? timeLapsesOf(plan) : [];
  // The infrared view leaves the jets out only because their colours are the visible palette
  // (`drawBaked`, reason 'mode'); a jets layer refused for missing data or honesty has another
  // reason and gets no hint, since the visible view would not draw it either.
  const irHidesJets =
    plan?.mode === 'spherex_ir' &&
    plan.bodies.length > 0 &&
    plan.modes.some((m) => m.id === 'visible' && m.available) &&
    plan.missing.some((m) => m.id === 'jets' && m.reason === 'mode');
  // One pause control for everything that moves (WCAG 2.2.2, R9). Under reduced motion the scene
  // starts paused and the button starts it.
  const motionPaused = (reducedMotion && !playAnyway) || spinPaused || idlePaused;
  const hiddenCount = plan?.missing.filter((m) => m.reason === 'honesty').length ?? 0;

  // In the build pane, an engine-drawn body shows its notes as "Assumed values" lines, not as a paragraph list.
  const assumedLines = plan && engineOwns
    ? [
        ...plan.notes.filter((n) => !/no motion data/i.test(n)),
        ...lapses.map((t) => timeLapseText(t)),
      ]
    : [];
  const honestyGroup = plan ? (
    <ToggleGroup
      label="Show"
      options={HONESTY_STATES.map((state) => ({ value: state, label: HONESTY_LABEL[state] }))}
      value={honesty}
      onChange={onHonesty}
    />
  ) : null;
  // Issue #71 stream U: in the build pane the Accuracy, Feel, Hear it and Details panels share one
  // popover under the header buttons, one at a time (mock-up `bpPop`). Outside the pane the details
  // are plain content, as before.
  const popRef = useRef<HTMLDivElement>(null);
  const pop = pane?.pop ?? null;
  useEffect(() => {
    if (pop) popRef.current?.focus({ preventScroll: true });
  }, [pop]);
  const wrapPop = (details: ReactNode): ReactNode =>
    pane ? (
      <div
        ref={popRef}
        id={BUILD_POP_ID}
        className="sx-bp-pop"
        data-w={pop ?? ''}
        hidden={pop === null}
        tabIndex={-1}
        role="group"
        aria-label={pop ? POP_LABEL[pop] : 'Senses'}
        data-testid="build-pop"
      >
        <section hidden={pop !== 'acc'} data-testid="build-pop-acc">
          {pop === 'acc' &&
            (params?.confidence ? (
              <ConfidencePopover inline isShown={(t) => t === 'missing' || isTagShown(honesty, t)} params={params} name={displayName(plan?.name)} onClose={() => pane.onPop?.(null)} />
            ) : (
              <>
                <div className="sx-pop-h">
                  <b>Accuracy</b>
                  <span>{displayName(plan?.name)}</span>
                </div>
                <p className="sx-acc-rules">{NO_SCORE_TEXT}</p>
              </>
            ))}
        </section>
        <section hidden={pop !== 'feel'} data-testid="build-pop-feel">
          <FeelPanel />
        </section>
        <section hidden={pop !== 'hear'} data-testid="build-pop-hear">
          <HearPanel active={pop === 'hear'} name={displayName(plan?.name)} />
        </section>
        {details}
      </div>
    ) : (
      details
    );
  const loadingBody =
    pane &&
    (blocked || mould.phase === 'loading' || (viewer === null && rendererStatus !== 'unavailable'));

  return (
    <section
      aria-labelledby="viewer-heading"
      className={pane ? 'sx-bp-body' : 'flex flex-col gap-3'}
    >
      <h2 id="viewer-heading" className={pane ? 'sr-only' : 'text-lg font-medium'}>
        3D view
      </h2>
      <div className={emissionsJd !== null ? 'flex flex-col gap-3 lg:flex-row' : 'contents'}>
        {card && emissionsJd !== null && (
          <EmissionsPanel
            card={card}
            jd={emissionsJd}
            onJd={(jd) => setEmissions({ key: objectKey, jd })}
            fixture={objectIsFixture}
          />
        )}
        <div
          className={
            pane
              ? 'sx-bp-stage'
              : 'relative aspect-square w-full max-w-xl overflow-hidden rounded-lg border border-neutral-800 bg-black sm:aspect-[4/3]'
          }
          data-testid="viewer-stage"
        >
          <div ref={hostRef} className="absolute inset-0" />
          {/* D-37: the prototype rock engine draws asteroids and comet nuclei over the viewer. */}
          <RockStage
            card={card}
            params={params}
            plan={plan}
            honesty={honesty}
            tint={rockTint}
            reducedMotion={reducedMotion}
            onEngine={setRockOwns}
          />
          {engineStar && (
            <StarGlobeStage key={engineStar.preset.id} star={engineStar} onFail={() => useWorldStore.getState().failStar(engineKey(card?.id, engineStar.preset.id))} />
          )}
          {engineWorld && (
            <WorldGlobeStage
              key={engineWorld.preset.id}
              world={engineWorld}
              onFail={() => useWorldStore.getState().fail(engineKey(card?.id, engineWorld.preset.id))}
            />
          )}
          {!pane && params && plan?.threeD && (
            <ConfidenceChip
              params={params}
              onOpen={() => setFormulaOpen(true)}
            />
          )}
          {!pane && params && formulaOpen && (
            <ConfidencePopover params={params} name={displayName(plan?.name)} onClose={() => setFormulaOpen(false)} />
          )}
          {loadingBody && (
            <div className="sx-bp-loading" data-testid="build-loading" role="status">
              {/* The mock-up's `loading("bLoad")`: its grid loader, size 44, the long sequence. */}
              <span aria-hidden="true">
                <GridLoader
                  color="green"
                  rounded
                  size={44}
                  gap={2}
                  blur={0.3}
                  {...(reducedMotion ? { pattern: 'heartbeat', static: true } : BUILD_LOADER_LOOK)}
                />
              </span>
              <span>Loading the 3D view</span>
            </div>
          )}
          <p
            data-testid="viewer-label"
            className={
              pane
                ? 'sr-only'
                : 'pointer-events-none absolute left-3 top-3 max-w-[85%] rounded bg-neutral-900/80 px-2 py-1 text-xs text-neutral-300'
            }
          >
            {plan ? `${displayName(plan.name)}${plan.threeD ? '' : ' (no 3D model)'}` : PLACEHOLDER_LABEL}
          </p>
          {plan && !plan.threeD && plan.message && (
            <p
              className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 rounded bg-neutral-900/90 px-3 py-2 text-center text-sm text-neutral-100"
              data-testid="viewer-message"
            >
              {plan.message}
            </p>
          )}
          {plan && plan.threeD && !showsBody(plan) && (
            <p
              className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 rounded bg-neutral-900/90 px-3 py-2 text-center text-sm text-neutral-100"
              data-testid="viewer-nothing"
            >
              {nothingDrawn
                ? `Nothing is drawn. ${nothingDrawn.text}${
                    nothingDrawn.needs
                      ? ` Switch to “${HONESTY_LABEL[nothingDrawn.needs]}” to see it.`
                      : ''
                  } ${pane ? 'Open Details for the list.' : 'See the list below.'}`
                : ''}
            </p>
          )}
          {rendererStatus === 'unavailable' && (
            // Not a live region: the status line already announces this change.
            <p className="absolute inset-x-3 bottom-3 rounded bg-neutral-900/90 px-3 py-2 text-sm text-neutral-100">
              The 3D view can&rsquo;t start in this browser. Try the latest Chrome, Edge or Firefox,
              and check that hardware acceleration is turned on.
            </p>
          )}
        </div>
      </div>

      {pane && <MouldStrip ref={stripRef} script={mould.script} phase={mould.phase} />}
      {pane?.caption?.(
        hiddenCount > 0 ? (
          <button
            type="button"
            className="sx-tag-btn"
            onClick={() => onHonesty('artistic')}
            data-testid="build-show-hidden"
          >
            {hiddenCount} hidden at this level. Show them
          </button>
        ) : null,
      )}
      {wrapPop(
      <div
        id={detailsId}
        className={pane ? 'sx-bp-details' : 'contents'}
        hidden={pane ? pane.pop !== 'details' : undefined}
        data-testid={pane ? 'build-details-panel' : undefined}
      >
        {pane && (
          <>
            <div className="sx-pop-h">
              <b>Details</b>
              <span>{displayName(plan?.name)}</span>
            </div>
          </>
        )}
        {params && (!pane || params.confidence?.gate.passed === false) && (
          <ConfidenceDetails params={params} />
        )}
        {plan && (
          <>
            {honestyGroup}

            {plan.threeD && plan.modes.length > 0 && (
              <>
                <ToggleGroup
                  label="Colour"
                  value={plan.mode ?? null}
                  options={plan.modes.map((m) => ({
                    value: m.id,
                    label: pane ? shortModeLabel(m.label) : m.label,
                    disabled: !m.available,
                    title: m.available ? m.badge : 'Not available for this object. See the list below.',
                  }))}
                  onChange={onMode}
                />
                {plan.mode && !pane && (
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {plan.modes.find((m) => m.id === plan.mode)?.badge}
                  </span>
                )}
              </>
            )}

            {/* Sits under the mode buttons it refers to. The region stays mounted while an object is
              shown, so a change of mode or level is announced politely when the text appears. */}
            {plan.threeD && plan.modes.length > 0 && (
              <div
                id="ir-jets-hint"
                role="status"
                aria-live="polite"
                className="empty:hidden"
                data-testid="ir-jets-hint"
              >
                {irHidesJets && <p className="text-sm text-neutral-200">{IR_JETS_HINT}</p>}
              </div>
            )}

            {plan.type === 'comet' && (
              <ToggleGroup
                label="Epoch"
                value={epoch}
                options={COMET_EPOCHS.map((e) => ({
                  value: e,
                  label: `${EPOCH_LABEL[e]}${plan.epochs.includes(e) ? '' : ' (no gas data)'}`,
                }))}
                onChange={onEpoch}
              />
            )}

            {pane && <BuildControls />}

            {plan.star && !engineStar && (
              <div className="flex flex-col gap-2" data-testid="star-views">
                <ToggleGroup
                  label="Star colour"
                  value={starColour}
                  options={STAR_COLOUR_OPTIONS}
                  onChange={(c) =>
                    setStarView(
                      c,
                      c === 'observatory' && starScale === 'close' ? 'enlarged' : starScale,
                    )
                  }
                />
                <ToggleGroup
                  label="View"
                  value={starScale}
                  options={STAR_SCALE_OPTIONS.map((o) => ({
                    ...o,
                    disabled: o.value === 'close' && !plan.star?.physics,
                    title:
                      o.value === 'close' && !plan.star?.physics
                        ? 'Needs the star\u2019s temperature.'
                        : undefined,
                  }))}
                  onChange={(sc) => setStarView(starColour, sc)}
                />
                {plan.star.physics && (
                  <p className="text-sm text-neutral-200" data-testid="star-caption">
                    {starCaption(plan.star.physics, starScale)}
                    {starColour === 'observatory' &&
                      ' This is false colour (ultraviolet, as solar observatories show it), not the star\u2019s real colour.'}
                  </p>
                )}
                {plan.star.plasma && (
                  <StarFlarePanel
                    viewer={viewer}
                    paused={motionPaused}
                    fixture={objectIsFixture}
                  />
                )}
              </div>
            )}

            {plan.star?.physics && !engineStar && (
              <dl
                className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm"
                data-testid="star-readouts"
              >
                {starReadouts(plan.star.physics).map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="text-neutral-300">{r.label}</dt>
                    <dd className="text-neutral-100">
                      {r.value} {r.tag && <ProvenanceBadge tag={r.tag} fixture={objectIsFixture} />}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {plan.type === 'comet' && emissionsRange && (
              <SwitchRow
                label="View emissions"
                checked={emissionsJd !== null}
                onChange={() =>
                  setEmissions(
                    emissionsJd === null ? { key: objectKey, jd: EPOCH_JD[epoch] } : null,
                  )
                }
                testId="emissions-toggle"
              />
            )}

            {plan.scrub && (
              <label className="flex flex-col gap-1 text-sm text-neutral-300">
                Light curve: point {plan.scrub.index + 1} of {plan.scrub.count}
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, plan.scrub.count - 1)}
                  value={plan.scrub.index}
                  className="min-h-11 w-full max-w-xl"
                  aria-valuetext={`Point ${plan.scrub.index + 1} of ${plan.scrub.count}, ${formatMjdDate(plan.scrub.tMjd)}, brightness ${Math.round(plan.scrub.brightness * 100)}% of the maximum`}
                  onChange={(e) => onScrub(Number(e.target.value))}
                />
                <span className="text-xs text-neutral-400">
                  {formatMjdDate(plan.scrub.tMjd)}, brightness{' '}
                  {Math.round(plan.scrub.brightness * 100)}% of the maximum
                  {plan.scrub.flagged > 0
                    ? `; ${plan.scrub.flagged} flagged points are left out`
                    : ''}
                </span>
              </label>
            )}

            {remnantShown && (
              <div className="flex flex-col gap-1 text-sm text-neutral-300">
                <span className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`${whyId}-age-input`} id={`${whyId}-age`}>
                    Age of the remnant
                  </label>
                  <output aria-hidden="true" className="tabular-nums text-neutral-100">
                    {formatYears(age)}
                  </output>
                  <ProvenanceBadge tag="artistic" fixture={objectIsFixture} />
                </span>
                <input
                  id={`${whyId}-age-input`}
                  type="range"
                  min={AGE_LOG_MIN}
                  max={AGE_LOG_MAX}
                  step={AGE_LOG_STEP}
                  value={Math.log10(age)}
                  className="min-h-11 w-full max-w-xl"
                  aria-labelledby={`${whyId}-age`}
                  aria-describedby={`${whyId}-age-hint`}
                  aria-valuetext={`${formatYears(age)} old`}
                  onChange={(e) => onAge(Number(e.target.value))}
                />
                <span id={`${whyId}-age-hint`} className="text-xs text-neutral-400">
                  Your choice, not a measurement. The shell is drawn smaller when it is younger, so
                  the size shown is the shell{AT_AGE_MAX_PHRASE}.
                </span>
              </div>
            )}

            {bar && !engineOwns && (
              <figure className="flex max-w-xl flex-col gap-1" data-testid="scale-bar">
                <div className="flex flex-col gap-1" aria-hidden="true">
                  <div
                    className="h-1.5 rounded bg-sky-400"
                    style={{ width: `${bar.bodyFraction * 100}%` }}
                  />
                  <div
                    className="h-1.5 rounded bg-neutral-400"
                    style={{ width: `${bar.comparisonFraction * 100}%` }}
                  />
                </div>
                <figcaption className="text-sm text-neutral-200">
                  {bar.headline}
                  {size?.atSliderMax && AT_AGE_MAX_PHRASE}
                  {bar.qualifier === 'upper_limit' && ' (upper limit)'}
                  {size?.tag && (
                    <>
                      {' '}
                      <ProvenanceBadge
                        tag={size.tag}
                        tooltip={size.why ?? undefined}
                        srText
                        fixture={objectIsFixture}
                      />
                    </>
                  )}
                  , {bar.comparison.text}.
                </figcaption>
                {size?.why && (
                  <div className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      className={buttonClass}
                      aria-expanded={whyOpen}
                      aria-controls={whyId}
                      onClick={() => setWhyOpen((o) => !o)}
                    >
                      Why this size?
                    </button>
                    {whyOpen && (
                      <p id={whyId} className="text-sm text-neutral-300" data-testid="size-why">
                        {size.why}
                      </p>
                    )}
                  </div>
                )}
              </figure>
            )}

            {lapses.length > 0 && !engineWorld && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-neutral-200" data-testid="motion-status">
                  {reducedMotion && !playAnyway
                    ? 'Motion is off because your device asks for reduced motion.'
                    : spinPaused
                      ? 'Motion is paused.'
                      : idlePaused
                        ? 'Motion paused after a minute without input. Tap the view to resume.'
                        : 'Motion is playing.'}
                </p>
              </div>
            )}

            {/* Issue #71 stream E: pacing of a simulated gas world; shown only for one. */}
            {plan.type === 'gas_giant' && !engineWorld && lapses.some((t) => t.id === 'winds') && (
              <div className="flex flex-col gap-1" data-testid="gas-pacing">
                <ToggleGroup
                  label="Time speed of the winds"
                  value={String(gasPacing) as '0' | '1'}
                  options={GAS_PACING_CHOICES.map((c) => ({ value: String(c.value) as '0' | '1', label: c.label }))}
                  onChange={(v) => onGasPacing(Number(v) as 0 | 1)}
                />
                <p className="text-sm text-neutral-200" data-testid="gas-pacing-status">
                  {gasPacingStatus(gasPacing)}
                </p>
              </div>
            )}

            {qualityLowered && (
              <p className="text-sm text-neutral-200" data-testid="quality-note">
                {QUALITY_DROP_ANNOUNCEMENT}.
              </p>
            )}

            {/* Every time-lapse says where its rate comes from and its speed-up (R5.7, D-32). */}
            {(engineOwns && pane ? [] : lapses).map((t) => (
              <p key={t.id} className="text-sm text-neutral-200" data-testid="time-lapse-note">
                {timeLapseText(t)}
              </p>
            ))}

            {pane && <BuildKeyNumbers fixture={objectIsFixture} />}

            <Rows>
            {pane && (
              <BuildSummaryRows
                fixture={objectIsFixture}
                flareChart={engineStar ? <StarEngineDetails fixture={objectIsFixture} /> : undefined}
                extraAssumed={assumedLines}
              />
            )}
            <Row title="What is drawn" count={plan.drawn.length} testId="legend-row">
              <p className="text-xs text-neutral-400">
                Measured: from observations. Estimated: worked out from data with a stated method.
                Default: the artist&rsquo;s choice.
              </p>
              {plan.drawn.length === 0 ? (
                <p className="text-sm text-neutral-400">Nothing yet.</p>
              ) : (
                <ul className="flex flex-col gap-1" data-testid="legend">
                  {plan.drawn.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-center gap-2 text-sm text-neutral-200"
                    >
                      <ProvenanceBadge tag={l.tag} fixture={objectIsFixture} />
                      <span>{layerName(l.id)}</span>
                      {l.tier ? (
                        <span className="text-xs text-neutral-400" data-testid="layer-tier">
                          {tierText(l.tier)}
                        </span>
                      ) : null}
                      {l.swatches?.map((s) => (
                        <span
                          key={s.label}
                          className="inline-flex items-center gap-1 text-xs text-neutral-300"
                        >
                          <span
                            aria-hidden="true"
                            className="inline-block h-3 w-3 rounded-sm border border-neutral-500"
                            style={{ backgroundColor: s.css }}
                          />
                          {s.label}
                        </span>
                      ))}
                      {l.description && (
                        <details className="w-full text-xs text-neutral-300">
                          <summary className="min-h-11 cursor-pointer py-2 focus-visible:outline-2 focus-visible:outline-sky-400">
                            How it is made
                          </summary>
                          <p className="pb-1">{l.description}</p>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Row>

            {defaultsShown.length > 0 && (
              <Row title="Shown as a default" count={defaultsShown.length}>
                <ul
                  className="flex flex-col gap-1 text-sm text-neutral-300"
                  data-testid="default-list"
                >
                  {defaultsShown.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2">
                      <ProvenanceBadge tag="artistic" />
                      <span>{describeRefusal(m)}</span>
                    </li>
                  ))}
                </ul>
              </Row>
            )}

            {notDrawn.length > 0 && (
              <Row title="Not drawn" count={notDrawn.length}>
                <ul className="list-disc pl-5 text-sm text-neutral-300" data-testid="missing-list">
                  {notDrawn.map((m) => (
                    <li key={m.id}>{describeRefusal(m)}</li>
                  ))}
                </ul>
              </Row>
            )}
            </Rows>

            {plan.notes.length > 0 && !(engineOwns && pane) && (
              <ul className="list-disc pl-5 text-xs text-neutral-400" data-testid="notes">
                {plan.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="viewer-announcer">
        {announcement}
      </div>
    </section>
  );
}
