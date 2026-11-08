// A4.1 input (UML 08 step 1): an object name or RA, Dec in decimal degrees, plus quick picks for
// the five A1.1 test targets. Shown as the mock-up's search pill (bottom right); the quick picks,
// the help and any problem float above it. "/" focuses the field (shell/shortcuts.ts).
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Icon } from '@/app/shell/icons';
import { useAppStore } from '@/state/store';
import { parseQuery } from './parseQuery';
import { TEST_TARGETS } from './testTargets';

export function SearchBar() {
  const search = useAppStore((s) => s.skySearch);
  const linkProblems = useAppStore((s) => s.sky.linkProblems);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const inputId = useId();
  const helpId = useId();
  const problemId = useId();
  const linkProblemId = useId();

  // A search started from a shared link shows its text in the field; clearing the link (Back to
  // the page without a hash) clears the field.
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        const q = s.sky.query;
        if (q === prev.sky.query) return;
        // A link or a pick on the sky view shows what is being searched.
        if (q?.origin === 'hash' || q?.origin === 'sky') {
          setText(q.q);
          setProblem(null);
        } else if (q === null) {
          setText('');
          setProblem(null);
        }
      }),
    [],
  );

  const describedBy = [
    problem ? problemId : null,
    linkProblems.length > 0 ? linkProblemId : null,
    helpId,
  ]
    .filter((id) => id !== null)
    .join(' ');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseQuery(text);
    if (parsed.kind === 'invalid') {
      setProblem(parsed.message);
      return;
    }
    setProblem(null);
    void search({ q: parsed.q, kind: parsed.kind, origin: 'input' });
  };

  const pick = (name: string) => {
    setText(name);
    setProblem(null);
    void search({ q: name, kind: 'name', origin: 'input' });
  };

  return (
    <section aria-label="Find an object" className="group sx-search">
      <form role="search" onSubmit={onSubmit} className="sx-search-form" noValidate>
        <label htmlFor={inputId} className="sr-only">
          Object name, or RA, Dec in degrees
        </label>
        <Icon name="search" className="sx-search-icon" />
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search a name or RA Dec"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-invalid={problem !== null}
          aria-describedby={describedBy}
          aria-keyshortcuts="/"
          className="sx-search-input"
          data-testid="search-input"
        />
        <kbd className="sx-kbd" aria-hidden="true">
          /
        </kbd>
        <button type="submit" className="sx-search-go" aria-label="Search" title="Search">
          <Icon name="search" className="size-4" />
        </button>
      </form>
      <div className="sx-search-pop">
        {/* Help sits on top, so showing it never moves the chips under the pointer. */}
        <p
          id={helpId}
          className="sx-search-note sr-only text-sx-mfg group-has-[input:focus]:not-sr-only"
        >
          Decimal degrees only, for example 269.452, 4.693. Search by name for moving objects.
        </p>
        <div role="group" aria-label="Test targets" className="sx-chips">
          <span className="sx-chips-lead">Try:</span>
          {TEST_TARGETS.map((name) => (
            <button key={name} type="button" className="sx-chip" onClick={() => pick(name)}>
              {name}
            </button>
          ))}
        </div>
        {linkProblems.length > 0 && (
          <p
            id={linkProblemId}
            className="sx-search-note border-red-400/70 text-red-200"
            data-testid="link-problem"
          >
            {linkProblems.join(' ')}
          </p>
        )}
        {problem && (
          <p
            id={problemId}
            className="sx-search-note border-red-400/70 text-red-200"
            data-testid="search-problem"
          >
            {problem}
          </p>
        )}
      </div>
    </section>
  );
}
