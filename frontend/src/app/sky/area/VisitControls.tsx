// Visits and blink (A18.3; Q-408): one option per visit, "Visit 1 · 15 Jan 03:00 UTC", and
// "Blink the n visits" (aria-pressed) that steps the visits every 750 ms with a visible stop. Under
// reduced motion the button reads "Next visit" and each press steps one visit. An area with fewer
// than two visits says so and offers no blink. P9 moves these into the Discovery card.
import { Segmented } from '@/app/Segmented';
import { formatVisitTime } from '@/app/format';
import {
  AREA_BLINK_STOP_HINT,
  AREA_NEEDS_TWO_VISITS,
  AREA_NEXT_VISIT,
  blinkLabel,
  visitLabel,
} from '@/app/messages';
import { useAppStore } from '@/state/store';
import { visitNumbers, visitTimes } from './blink';
import { useReducedMotion } from './useAreaLifecycle';

export function VisitControls() {
  const summary = useAppStore((s) => s.area.summary.data);
  const dots = useAppStore((s) => s.area.dots.data);
  const visit = useAppStore((s) => s.area.visit);
  const blink = useAppStore((s) => s.area.blink);
  const reduced = useReducedMotion();
  const visits = visitNumbers(summary, dots);
  if (visits.length < 2) {
    return (
      <p className="mt-2 text-sm text-sx-mfg" data-testid="area-needs-two-visits">
        {AREA_NEEDS_TWO_VISITS}
      </p>
    );
  }
  const times = visitTimes(summary);
  const options = visits.map((v) => {
    const t = times.get(v);
    return {
      value: String(v),
      label: visitLabel(v, t ? formatVisitTime(t) : null),
      testId: `area-visit-${v}`,
    };
  });
  const store = useAppStore.getState;
  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="area-visit-controls">
      <Segmented
        label="Visit"
        options={options}
        value={String(visit)}
        onChange={(v) => store().areaSetVisit(Number(v))}
        testId="area-visits"
      />
      {reduced ? (
        <button
          type="button"
          className="sx-btn sx-btn-ghost self-start"
          onClick={() => store().areaStepVisit(true)}
          data-testid="area-next-visit"
        >
          {AREA_NEXT_VISIT}
        </button>
      ) : (
        <button
          type="button"
          className="sx-btn sx-btn-ghost self-start aria-pressed:ring-2 aria-pressed:ring-sx-green"
          aria-pressed={blink}
          aria-label={blinkLabel(visits.length)}
          onClick={() => store().areaSetBlink(!blink)}
          data-testid="area-blink"
        >
          {blinkLabel(visits.length)}
          {blink && (
            // R9: a visible stop that is not only colour.
            <span className="ml-1.5 font-normal" data-testid="area-blink-stop">
              {AREA_BLINK_STOP_HINT}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
