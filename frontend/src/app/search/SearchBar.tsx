// A4.1 input (UML 08 step 1): an object name or RA, Dec in decimal degrees, plus quick picks for
// the five A1.1 test targets.
import { useEffect, useId, useState, type FormEvent } from 'react';
import { buttonClass } from '@/app/ui';
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
        if (q?.origin === 'hash') {
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
    <section aria-label="Find an object" className="flex flex-col gap-2">
      <form role="search" onSubmit={onSubmit} className="flex flex-col gap-2" noValidate>
        <label htmlFor={inputId} className="text-sm font-medium">
          Object name, or RA, Dec in degrees
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={inputId}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="R Draconis or 269.452, 4.693"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={problem !== null}
            aria-describedby={describedBy}
            className="min-h-11 min-w-0 flex-1 rounded-md border border-neutral-500 bg-neutral-900 px-3 text-base text-neutral-100 placeholder:text-neutral-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400 aria-invalid:border-red-400"
            data-testid="search-input"
          />
          <button type="submit" className={buttonClass}>
            Search
          </button>
        </div>
        {linkProblems.length > 0 && (
          <p id={linkProblemId} className="text-sm text-red-300" data-testid="link-problem">
            {linkProblems.join(' ')}
          </p>
        )}
        {problem && (
          <p id={problemId} className="text-sm text-red-300" data-testid="search-problem">
            {problem}
          </p>
        )}
        <p id={helpId} className="text-sm text-neutral-400">
          Decimal degrees only, for example 269.452, 4.693. Search by name for moving objects.
        </p>
      </form>
      <div role="group" aria-label="Test targets" className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-neutral-400">Try:</span>
        {TEST_TARGETS.map((name) => (
          <button
            key={name}
            type="button"
            className={`${buttonClass} text-sm`}
            onClick={() => pick(name)}
          >
            {name}
          </button>
        ))}
      </div>
    </section>
  );
}
