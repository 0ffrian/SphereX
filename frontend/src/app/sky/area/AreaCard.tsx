// The Area card (A18.1; interim until P9, Q-406 (7)): a feature card shown while the tool is
// `area`. Before a square: the draw hint, "Use a square in the middle" and "Keep the last square";
// a refused square says why; a square outside every prepared area lists them with "Fly there".
// After a snap: "Area · w° × h°", its frames and visits, the layer switches, the honesty switch, the
// visits and blink, the provenance badges and "Draw again".
import { useContext } from 'react';
import { RefusalList } from '@/app/RefusalList';
import { formatUtcDayRange } from '@/app/format';
import {
  AREA_DRAW_AGAIN,
  AREA_DRAW_HINT,
  AREA_FLY_THERE,
  AREA_INDEX_EMPTY,
  AREA_INDEX_LOADING,
  AREA_KEEP_LAST,
  AREA_LAYERS_LABEL,
  AREA_LOADING,
  AREA_NOT_FOUND,
  AREA_PREPARED_LEAD,
  AREA_TOOL_LABEL,
  AREA_TOO_BIG,
  AREA_TOO_SMALL,
  AREA_TRY_AGAIN,
  AREA_USE_MIDDLE,
  areaIndexErrorMessage,
  areaLoadErrorMessage,
  areaPrecomputedNote,
  areaRowText,
  areaSelectedText,
  areaSubtitle,
  areaTitle,
} from '@/app/messages';
import { groupAreaMissing } from '@/app/refusals';
import { FeatureCard } from '@/app/shell/FeatureCard';
import { useShellStore } from '@/app/shell/shellStore';
import { SkyViewContext } from '@/app/sky/layers';
import { skySafeRect } from '@/app/sky/safeRect';
import { skyFlyTo } from '@/app/sky/skyFlyTo';
import { useAppStore } from '@/state/store';
import { openAreaEntry, type AreaState } from '@/state/area';
import { AREA_TOOL_ENABLED, leaveAreaTool } from './areaTool';
import { AreaBadges } from './AreaBadges';
import { middleSquare } from './drawSquare';
import { HonestySwitch } from './HonestySwitch';
import { VisitControls } from './VisitControls';
import type { SkySquare } from './geometry';

/** Search a square from a card button; a snap ends drawing (A18.1). */
export async function searchSquareFromCard(sq: SkySquare): Promise<void> {
  const snapped = await useAppStore.getState().areaSearchSquare(sq);
  if (snapped) useShellStore.getState().setPointerMode('pan');
}

function focusRailButton(): void {
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>('[data-testid="tool-area"]')?.focus(),
  );
}

function subtitleOf(area: AreaState): string | undefined {
  const s = area.summary.data;
  if (!s) return undefined;
  let first: string | null = null;
  let last: string | null = null;
  for (const f of s.frames) {
    if (first === null || Date.parse(f.time) < Date.parse(first)) first = f.time;
    if (last === null || Date.parse(f.time) > Date.parse(last)) last = f.time;
  }
  const dates = first && last ? formatUtcDayRange(first, last) : '';
  return areaSubtitle(s.n_frames, s.n_visits, dates);
}

export function AreaCard() {
  const tool = useShellStore((s) => s.tool);
  const area = useAppStore((s) => s.area);
  if (!AREA_TOOL_ENABLED || tool !== 'area' || area.card !== 'area') return null;
  const entry = openAreaEntry(area);
  const title = entry ? areaTitle(entry.width_deg, entry.height_deg) : AREA_TOOL_LABEL;
  return (
    <FeatureCard
      title={title}
      subtitle={entry ? subtitleOf(area) : AREA_DRAW_HINT}
      onClose={() => {
        leaveAreaTool();
        focusRailButton();
      }}
      testId="area-card"
    >
      {entry ? <OpenArea area={area} /> : <Drawing area={area} />}
    </FeatureCard>
  );
}

function DrawButtons({ area }: { area: AreaState }) {
  const view = useContext(SkyViewContext);
  return (
    <div className="sx-island-actions">
      <button
        type="button"
        className="sx-btn sx-btn-ghost"
        disabled={!view}
        onClick={() => {
          if (!view) return;
          const { width, height } = view.getSize();
          void searchSquareFromCard(middleSquare(view.getView(), width, height, skySafeRect()));
        }}
        data-testid="area-use-middle"
      >
        {AREA_USE_MIDDLE}
      </button>
      {area.lastSquare && (
        <button
          type="button"
          className="sx-btn sx-btn-ghost"
          onClick={() => area.lastSquare && void searchSquareFromCard(area.lastSquare)}
          data-testid="area-keep-last"
        >
          {AREA_KEEP_LAST}
        </button>
      )}
    </div>
  );
}

function SquareRefusal({ area }: { area: AreaState }) {
  if (area.refusal !== 'square:too_small' && area.refusal !== 'square:too_big') return null;
  return (
    <p className="text-sx-amber" data-testid="area-refusal">
      {area.refusal === 'square:too_small' ? AREA_TOO_SMALL : AREA_TOO_BIG}
    </p>
  );
}

function Drawing({ area }: { area: AreaState }) {
  const index = area.index;
  return (
    <div className="mt-2 text-sm" data-testid="area-drawing">
      <SquareRefusal area={area} />
      {area.refusal === 'area:not_found' && (
        <p role="status" className="text-sx-amber" data-testid="area-refusal">
          {AREA_NOT_FOUND}
        </p>
      )}
      {area.refusal === 'area:not_prepared' && index.data && (
        <div data-testid="area-not-prepared">
          <RefusalList
            groups={groupAreaMissing(['area:not_prepared'])}
            lead={AREA_PREPARED_LEAD}
            testId="area-refusals"
          />
          <p className="mt-1 text-sx-mfg">{AREA_PREPARED_LEAD}</p>
          <ul role="list" className="mt-1 flex list-none flex-col gap-1 p-0">
            {index.data.areas.map((a) => (
              <li key={a.area_id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-all text-sx-fg">{areaRowText(a)}</span>
                <button
                  type="button"
                  className="sx-btn sx-btn-ghost h-9"
                  aria-label={`${AREA_FLY_THERE}: ${a.area_id}`}
                  onClick={() => skyFlyTo({ box: a })}
                  data-testid="area-fly-there"
                  data-area-id={a.area_id}
                >
                  {AREA_FLY_THERE}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {index.status === 'loading' && area.square && (
        <p role="status" className="text-sx-mfg">
          {AREA_INDEX_LOADING}
        </p>
      )}
      {index.status === 'ready' && index.data?.areas.length === 0 && (
        <p className="text-sx-amber" data-testid="area-index-empty">
          {AREA_INDEX_EMPTY}
        </p>
      )}
      {index.status === 'error' && index.error && (
        <div role="alert" data-testid="area-index-error">
          <p className="text-sx-amber">{areaIndexErrorMessage(index.error)}</p>
          <button
            type="button"
            className="sx-btn sx-btn-ghost mt-1"
            onClick={() => void useAppStore.getState().areaLoadIndex()}
          >
            {AREA_TRY_AGAIN}
          </button>
        </div>
      )}
      <DrawButtons area={area} />
    </div>
  );
}

function OpenArea({ area }: { area: AreaState }) {
  const drawing = useShellStore((s) => s.pointerMode === 'draw');
  const store = useAppStore.getState;
  if (area.summary.status === 'loading') {
    return (
      <p role="status" className="mt-2 text-sm text-sx-mfg" data-testid="area-loading">
        {AREA_LOADING}
      </p>
    );
  }
  if (area.summary.status === 'error' && area.summary.error) {
    return (
      <div className="mt-2 text-sm">
        <p role="alert" className="text-sx-amber" data-testid="area-load-error">
          {areaLoadErrorMessage(area.summary.error)}
        </p>
        <DrawButtons area={area} />
      </div>
    );
  }
  const partError = area.dots.error ?? area.tracks.error;
  return (
    <div className="mt-2 text-sm" data-testid="area-open">
      {area.summary.data && (
        <p className="text-sx-mfg" data-testid="area-precomputed">
          {areaPrecomputedNote(area.summary.data.computed_at)}
        </p>
      )}
      {drawing && <p className="text-sx-mfg">{AREA_DRAW_HINT}</p>}
      {drawing && <SquareRefusal area={area} />}
      <fieldset className="flex flex-wrap items-center gap-3 border-0 p-0">
        <legend className="sr-only">{AREA_LAYERS_LABEL}</legend>
        {(['dots', 'tracks'] as const).map((layer) => (
          <label
            key={layer}
            className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-sx-fg"
          >
            <input
              type="checkbox"
              className="size-4 accent-sx-green"
              checked={area.layers[layer]}
              onChange={(e) => store().areaSetLayer(layer, e.currentTarget.checked)}
              data-testid={`area-layer-${layer}`}
            />
            {layer === 'dots' ? 'Dots' : 'Tracks'}
          </label>
        ))}
      </fieldset>
      {partError && (
        <p role="alert" className="text-sx-amber" data-testid="area-part-error">
          {areaLoadErrorMessage(partError)}
        </p>
      )}
      <HonestySwitch />
      <VisitControls />
      {area.selectedResult && (
        <p className="mt-2 text-sx-fg" data-testid="area-selected">
          {areaSelectedText(area.selectedResult)}
        </p>
      )}
      <AreaBadges />
      <div className="sx-island-actions">
        <button
          type="button"
          className="sx-btn sx-btn-ghost"
          aria-pressed={drawing}
          onClick={() => useShellStore.getState().setPointerMode('draw')}
          data-testid="area-draw-again"
        >
          {AREA_DRAW_AGAIN}
        </button>
      </div>
    </div>
  );
}
