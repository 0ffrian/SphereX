// R4 level 3 (Sky Sculptor) panel: mounts the ViewerApp canvas, draws the loaded ObjectCard +
// RenderParams (renderer chosen by type, R7), and holds the controls and labels that make the
// picture honest: the 3-state honesty control (R5.3, D-21), view modes (R5.2), the comet epoch
// toggle (R7.3), the scale bar (R5.4), a legend with a provenance badge per layer (D-02), and the
// plain-words list of layers that are not drawn. Rotate/zoom buttons are the WCAG 2.5.7
// alternative to dragging (R5.6). R9: canvas aria-label follows the view; a polite live region
// announces mode, epoch and honesty changes.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
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
  type HonestyState,
} from '@/viewer/honesty';
import type { PlanContext, RenderPlan, ViewModeId } from '@/viewer/planTypes';
import { defaultContext, planRender } from '@/viewer/renderPlan';
import { COMET_EPOCHS, epochsWithQ, EPOCH_LABEL } from '@/viewer/renderers/Comet';
import { scaleBarFor, shownSize } from '@/viewer/scaleBar';
import { SLIDER_REGISTRY } from '@/viewer/sliders';
import type { CometEpoch, ObjectCard, RenderParams } from '@/contract';
import { ProvenanceBadge } from './Badge';
import { describeRefusal, layerName } from './messages';
import { buttonClass, pressedClass } from './ui';

const NO_FAILED: readonly string[] = [];
const AGE_SLIDER = SLIDER_REGISTRY.age_yr;

/** The age slider runs on log10(years): one key press is the same relative change everywhere. */
const AGE_LOG_MIN = Math.log10(AGE_SLIDER.min);
const AGE_LOG_MAX = Math.log10(AGE_SLIDER.max);
const AGE_LOG_STEP = 0.01;
/** Years from a slider position, rounded to 3 significant digits and kept inside the range. */
export function ageFromLog(pos: number): number {
  const years = Number(Math.pow(10, pos).toPrecision(3));
  return Math.min(AGE_SLIDER.max, Math.max(AGE_SLIDER.min, years));
}

/** "1,200 years", "10 years". */
function formatYears(n: number): string {
  return `${n.toLocaleString('en')} ${n === 1 ? 'year' : 'years'}`;
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
}

/** Said (live region) when the governor lowers the render quality. */
export const QUALITY_DROP_ANNOUNCEMENT = 'Lowered render quality to keep motion smooth';

const PLACEHOLDER_LABEL = 'Viewer placeholder: no object loaded';

const ROTATE_BUTTONS: { dir: 'left' | 'right' | 'up' | 'down'; label: string; glyph: string }[] = [
  { dir: 'left', label: 'Rotate left', glyph: '←' },
  { dir: 'up', label: 'Rotate up', glyph: '↑' },
  { dir: 'down', label: 'Rotate down', glyph: '↓' },
  { dir: 'right', label: 'Rotate right', glyph: '→' },
];

export function ViewerPanel() {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewer, setViewer] = useState<ViewerApp | null>(null);
  const setRendererStatus = useAppStore((s) => s.setRendererStatus);
  const rendererStatus = useAppStore((s) => s.rendererStatus);
  const card = useAppStore((s) => s.card);
  const params = useAppStore((s) => s.params);
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
  // Layers whose mesh or texture failed to load, per object. Keyed so a new object starts clean.
  const [failedState, setFailedState] = useState<{ key: string; ids: string[] }>({
    key: '',
    ids: [],
  });
  const failed = failedState.key === objectKey ? failedState.ids : NO_FAILED;
  const reducedMotion = useReducedMotion();
  const [spinPaused, setSpinPaused] = useState(false);
  // R5.7: a phone pauses the clock after a minute without input; said here, lifted by the button.
  const [idlePaused, setIdlePaused] = useState(false);
  useEffect(() => {
    if (!viewer) return; // a new viewer starts not idle; the handler reports every change
    viewer.setIdleChangeHandler?.(setIdlePaused);
    return () => viewer.setIdleChangeHandler?.(null);
  }, [viewer]);
  const [whyOpen, setWhyOpen] = useState(false);
  const whyId = useId();
  const fixture = useAppStore((s) => s.sky.fixture);
  const [announcement, setAnnouncement] = useState('');

  const ctx: PlanContext = useMemo(
    () => defaultContext({ honesty, mode: modeChoice, epoch, scrubIndex, failed }),
    [honesty, modeChoice, epoch, scrubIndex, failed],
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
  const size = useMemo(() => {
    if (!plan) return null;
    const s = shownSize(plan, meshRadiusM, honesty);
    // The age slider shrinks the drawn shell (to 3%), so the card's size is the shell at the
    // slider maximum: say so in the bar, the label and the announcements (Q-103).
    return remnantShown ? { ...s, atSliderMax: true } : s;
  }, [plan, meshRadiusM, honesty, remnantShown]);
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
            ) => RenderPlan;
          };
          w.__sxViewer = created;
          // Plans and draws like the panel does, for a given honesty state.
          w.__sxShow = (c, p, honesty) => {
            // The epoch the panel itself opens on (a comet: its latest epoch with gas data), so a
            // fixture card is drawn at its own epoch and not at the default one.
            const epoch = epochsWithQ(c).at(-1) ?? defaultContext().epoch;
            const shown = planRender(c, p, defaultContext({ honesty, epoch }));
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

  // Draw the plan. Not keyed on the measured size: a size report for the same plan must not
  // re-run showPlan (it would reallocate the shadow map, rebuild lit pipelines and reset TAA).
  useEffect(() => {
    if (!viewer) return;
    if (plan) viewer.showPlan(plan);
    else viewer.clearObject();
  }, [viewer, plan]);

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
      next
        ? honestyAnnouncement(state, next, shownSize(next, meshRadiusM, state), size)
        : HONESTY_LABEL[state],
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
  // Not announced here: the slider's own value text is read by screen readers when it moves.
  const onScrub = (i: number) => setChoices({ ...choices, scrub: i });
  const onAge = (pos: number) => setOverride('age_yr', ageFromLog(pos));

  // The age slider shows only while the remnant is drawn (it is an artist's impression).
  const age = ageChoice ?? AGE_SLIDER.max;

  const nothingDrawn = plan && plan.threeD && !showsBody(plan) ? nothingDrawnReason(plan) : null;
  const defaultsShown = plan?.missing.filter((m) => m.defaultShown) ?? [];
  const notDrawn = plan?.missing.filter((m) => !m.defaultShown) ?? [];
  const disabled = viewer === null;
  const objectIsFixture = fixture || (card?.id.startsWith('fixture:') ?? false);
  const hiddenCount = plan?.missing.filter((m) => m.reason === 'honesty').length ?? 0;

  return (
    <section aria-labelledby="viewer-heading" className="flex flex-col gap-3">
      <h2 id="viewer-heading" className="text-lg font-medium">
        3D view
      </h2>
      <div className="relative aspect-square w-full max-w-xl overflow-hidden rounded-lg border border-neutral-800 bg-black sm:aspect-[4/3]">
        <div ref={hostRef} className="absolute inset-0" />
        <p
          data-testid="viewer-label"
          className="pointer-events-none absolute left-3 top-3 max-w-[85%] rounded bg-neutral-900/80 px-2 py-1 text-xs text-neutral-300"
        >
          {plan ? `${plan.name}${plan.threeD ? '' : ' (no 3D model)'}` : PLACEHOLDER_LABEL}
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
                } See the list below.`
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

      {plan?.threeD && (
        <p className="text-xs text-neutral-400" data-testid="impression-note">
          Artist&apos;s impression, drawn from the data listed under &ldquo;What is drawn&rdquo;.
        </p>
      )}

      <div role="group" aria-label="View controls" className="flex flex-wrap gap-2">
        {ROTATE_BUTTONS.map(({ dir, label, glyph }) => (
          <button
            key={dir}
            type="button"
            className={buttonClass}
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => viewer?.rotate(dir)}
          >
            <span aria-hidden="true">{glyph}</span>
          </button>
        ))}
        <button
          type="button"
          className={buttonClass}
          aria-label="Zoom in"
          title="Zoom in"
          disabled={disabled}
          onClick={() => viewer?.zoom('in')}
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label="Zoom out"
          title="Zoom out"
          disabled={disabled}
          onClick={() => viewer?.zoom('out')}
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={disabled}
          onClick={() => viewer?.resetView()}
        >
          Reset view
        </button>
      </div>

      {plan && (
        <>
          <div
            role="group"
            aria-label="Honesty level"
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-sm text-neutral-300">Show:</span>
            {HONESTY_STATES.map((state) => (
              <button
                key={state}
                type="button"
                className={`${buttonClass} ${pressedClass}`}
                aria-pressed={honesty === state}
                onClick={() => onHonesty(state)}
              >
                {HONESTY_LABEL[state]}
              </button>
            ))}
            {hiddenCount > 0 && (
              <span className="text-xs text-neutral-400">{hiddenCount} hidden at this level</span>
            )}
          </div>

          {plan.threeD && plan.modes.length > 0 && (
            <div role="group" aria-label="View mode" className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-neutral-300">Colour:</span>
              {plan.modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`${buttonClass} ${pressedClass}`}
                  aria-pressed={plan.mode === m.id}
                  disabled={!m.available}
                  title={
                    m.available ? m.badge : 'Not available for this object. See the list below.'
                  }
                  onClick={() => onMode(m.id)}
                >
                  {m.label}
                </button>
              ))}
              {plan.mode && (
                <span className="text-xs text-neutral-400">
                  {plan.modes.find((m) => m.id === plan.mode)?.badge}
                </span>
              )}
            </div>
          )}

          {plan.type === 'comet' && (
            <div
              role="group"
              aria-label="Comet epoch"
              className="flex flex-wrap items-center gap-2"
            >
              <span className="text-sm text-neutral-300">Epoch:</span>
              {COMET_EPOCHS.map((e) => (
                <button
                  key={e}
                  type="button"
                  className={`${buttonClass} ${pressedClass}`}
                  aria-pressed={epoch === e}
                  onClick={() => onEpoch(e)}
                >
                  {EPOCH_LABEL[e]}
                  {!plan.epochs.includes(e) && (
                    <span className="ml-1 text-xs text-neutral-400">(no gas data)</span>
                  )}
                </button>
              ))}
            </div>
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
                <span id={`${whyId}-age`}>Age of the remnant</span>
                <ProvenanceBadge tag="artistic" fixture={objectIsFixture} />
              </span>
              <input
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
                the size shown is the shell at the slider maximum.
              </span>
            </div>
          )}

          {bar && (
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
                {size?.atSliderMax && ' at the slider maximum'}
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

          {plan.spin && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-neutral-200" data-testid="spin-note">
                Spin sped up ×{plan.spin.speedup}
                {reducedMotion
                  ? '. Auto-spin is off because your device asks for reduced motion.'
                  : spinPaused
                    ? '. Auto-spin is paused.'
                    : idlePaused
                      ? '. Auto-spin paused after a minute without input. Tap the view or press Resume spin.'
                      : '.'}
              </p>
              {!reducedMotion && (
                <button
                  type="button"
                  className={buttonClass}
                  aria-pressed={spinPaused || idlePaused}
                  onClick={() => {
                    if (idlePaused && !spinPaused) viewer?.resumeFromIdle?.();
                    else setSpinPaused((p) => !p);
                  }}
                >
                  {spinPaused || idlePaused ? 'Resume spin' : 'Pause spin'}
                </button>
              )}
            </div>
          )}

          {qualityLowered && (
            <p className="text-sm text-neutral-200" data-testid="quality-note">
              {QUALITY_DROP_ANNOUNCEMENT}.
            </p>
          )}

          {/* Every time-lapse states its speed-up (R5.7). The spin has its own note above. */}
          {viewer
            ?.timeLapses?.()
            .filter((t) => t.id !== 'spin')
            .map((t) => (
              <p key={t.id} className="text-sm text-neutral-200" data-testid="time-lapse-note">
                {t.label} sped up ×{t.speedup}.
              </p>
            ))}

          <section aria-labelledby="legend-heading" className="flex flex-col gap-1">
            <h3 id="legend-heading" className="text-sm font-medium text-neutral-200">
              What is drawn
            </h3>
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
          </section>

          {defaultsShown.length > 0 && (
            <section aria-labelledby="defaults-heading" className="flex flex-col gap-1">
              <h3 id="defaults-heading" className="text-sm font-medium text-neutral-200">
                Shown as a default
              </h3>
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
            </section>
          )}

          {notDrawn.length > 0 && (
            <section aria-labelledby="missing-heading" className="flex flex-col gap-1">
              <h3 id="missing-heading" className="text-sm font-medium text-neutral-200">
                Not drawn
              </h3>
              <ul className="list-disc pl-5 text-sm text-neutral-300" data-testid="missing-list">
                {notDrawn.map((m) => (
                  <li key={m.id}>{describeRefusal(m)}</li>
                ))}
              </ul>
            </section>
          )}

          {plan.notes.length > 0 && (
            <ul className="list-disc pl-5 text-xs text-neutral-400" data-testid="notes">
              {plan.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only" data-testid="viewer-announcer">
        {announcement}
      </div>
    </section>
  );
}
