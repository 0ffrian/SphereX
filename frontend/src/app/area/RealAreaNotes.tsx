// What a prepared area's answer carries in the cards (Q-205, A17.8): that it is precomputed and
// when it ran, a "Test data" tag for synthetic fixtures, and the list of what is missing (refuse
// rather than invent: a part that is not there is named, never drawn as if it were).
import { missingText, precomputedNote } from './realArea';

export const TEST_DATA_NOTE =
  'Test data: a synthetic fixture area made to test the tool, not SPHEREx measurements.';

export function RealAreaNotes({
  computedAt,
  synthetic,
  missing,
}: {
  computedAt: string;
  synthetic: boolean;
  missing: readonly string[];
}) {
  return (
    <>
      <div className="sx-kn-foot">
        <span className="fb-muted" data-testid="area-precomputed">
          {precomputedNote(computedAt)}
        </span>
        {synthetic && (
          <span
            className="sx-tagbadge"
            style={{ ['--dot' as string]: 'var(--p-asm)' }}
            title={TEST_DATA_NOTE}
            data-testid="area-test-data"
          >
            Test data
          </span>
        )}
      </div>
      {missing.length > 0 && (
        <details className="fb-muted" data-testid="area-missing">
          <summary>Not shown ({missing.length})</summary>
          <ul>
            {missing.map((code) => (
              <li key={code} data-code={code}>
                {missingText(code)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
