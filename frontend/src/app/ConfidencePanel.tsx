// D-36, Q-220 to Q-222: the data-confidence chip on the 3D stage and the breakdown at the top of
// Details. The score says how much of the picture rests on data; it is not the probability that
// the picture is correct, and it does not change the three badges (D-02). It does not depend on
// the Show level. The weights are placeholders until a sensitivity sweep exists.
import type { RenderParams } from '@/contract';
import { BAND_WORDS, inputBadge, percent, type Confidence } from '@/viewer/confidenceGate';

function Bar({ c }: { c: Confidence }) {
  const m = percent(c.measured_share);
  const e = percent(c.estimated_share);
  return (
    <span
      aria-hidden="true"
      className="flex h-1.5 w-full overflow-hidden rounded bg-neutral-700"
      data-testid="confidence-bar"
    >
      <span className="bg-sky-400" style={{ width: `${m}%` }} />
      <span className="bg-amber-400" style={{ width: `${e}%` }} />
    </span>
  );
}

/** Chip on the stage. A button that opens Details; 44px touch target. */
export function ConfidenceChip({ params, onOpen }: { params: RenderParams; onOpen: () => void }) {
  const c = params.confidence;
  if (!c || !c.gate.passed) return null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="absolute bottom-3 left-3 z-10 flex min-h-11 min-w-44 flex-col justify-center gap-1 rounded bg-neutral-900/90 px-3 py-1 text-left text-xs text-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-400"
      data-testid="confidence-chip"
      aria-label={`Data confidence ${percent(c.score)} percent. ${BAND_WORDS[c.band]}. Show the breakdown.`}
    >
      <span>
        Data confidence <b>{percent(c.score)}%</b>
      </span>
      <Bar c={c} />
    </button>
  );
}

/** Top of Details: the breakdown, or why there is no 3D model. */
export function ConfidenceDetails({ params }: { params: RenderParams }) {
  const c = params.confidence;
  if (!c) return null;
  if (!c.gate.passed) {
    const yes = (b: boolean) => (b ? 'Yes' : 'No');
    return (
      <section
        aria-labelledby="confidence-h"
        className="flex flex-col gap-2 text-xs text-neutral-300"
        data-testid="confidence-details"
      >
        <h3 id="confidence-h" className="text-sm font-semibold text-neutral-100">
          Why there is no 3D model
        </h3>
        <ul className="flex flex-col gap-1">
          <li>
            <b>{yes(c.gate.class_known)}</b>: we know what kind of object it is
          </li>
          <li>
            <b>{yes(c.gate.key_measurement)}</b>: it has a key measurement for its kind
          </li>
          <li>
            <b>{yes(c.gate.score_ok)}</b>: data confidence is at least {percent(c.threshold)}% (now{' '}
            {percent(c.score)}%)
          </li>
        </ul>
        <p>Found: {c.found}</p>
        <p>Needed: {c.needed}</p>
        <p className="text-neutral-400">{c.note}</p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="confidence-h"
      className="flex flex-col gap-2 text-xs text-neutral-300"
      data-testid="confidence-details"
    >
      <h3 id="confidence-h" className="text-sm font-semibold text-neutral-100">
        Data confidence
      </h3>
      <p className="text-neutral-100">
        <b className="text-base">{percent(c.score)}%</b> {BAND_WORDS[c.band]}
      </p>
      <Bar c={c} />
      <p>
        Measured {percent(c.measured_share)}%, estimated {percent(c.estimated_share)}%, assumed or
        missing {percent(c.assumed_share)}%.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <caption className="sr-only">What the score is made of</caption>
          <thead>
            <tr>
              <th scope="col">Quantity</th>
              <th scope="col">Source</th>
              <th scope="col">Points</th>
            </tr>
          </thead>
          <tbody>
            {c.inputs.map((i) => (
              <tr key={i.id}>
                <td>{i.label}</td>
                <td>{inputBadge(i.tag)}</td>
                <td>{Math.round(i.points * 10) / 10}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {c.raise && <p>What would raise it: {c.raise}</p>}
      <p className="text-neutral-400">{c.note}</p>
      <p className="text-neutral-400">{c.weights_note}</p>
    </section>
  );
}
