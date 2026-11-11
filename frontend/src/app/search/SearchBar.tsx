// A4.1 input (UML 08 step 1): an object name or RA, Dec in decimal degrees, plus the demo list as
// an ARIA combobox (issue #68, 7a; R9). Shown as the mock-up's search pill (bottom right); the
// list, the help and any problem float above it. "/" focuses the field (shell/shortcuts.ts).
// Focus stays in the input: ArrowUp and ArrowDown move `aria-activedescendant`, Enter picks the
// highlighted row (without one, Enter searches the typed text through parseQuery), Escape closes
// the list and keeps the text. The list is a shortcut, not a limit: any SIMBAD or SBDB name works.
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { Icon } from '@/app/shell/icons';
import { useAppStore } from '@/state/store';
import { parseQuery } from './parseQuery';
import { DEMO_TARGETS, filterTargets, type DemoTarget } from './demoTargets';
import { REFERENCE_TARGETS } from './referenceTargets';

export const NO_MATCH_HINT = 'No demo object matches. Press Enter to search the catalogues.';
// parseQuery accepts both examples (a name, and RA, Dec in decimal degrees).
export const CLOSING_HINT = 'Try "WISE 0855" or "269.452, 4.693"';

/** A focus counts as the user's when Tab or "/" is held down (until its keyup), within this many ms. */
const USER_FOCUS_WINDOW_MS = 1000;

export function SearchBar() {
  const search = useAppStore((s) => s.skySearch);
  const linkProblems = useAppStore((s) => s.sky.linkProblems);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rows = useMemo(() => filterTargets([...DEMO_TARGETS, ...REFERENCE_TARGETS], text), [text]);
  const listId = useId();
  const inputId = useId();
  const helpId = useId();
  const problemId = useId();
  const linkProblemId = useId();
  // The list opens on a focus the user made: a pointer press, Tab, or the "/" shortcut. A refocus by
  // code (a card that returns focus here when it closes) must not pop the list open (WCAG 3.2.1).
  const lastKey = useRef<{ key: string; at: number } | null>(null);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      lastKey.current = { key: e.key, at: performance.now() };
    };
    const clear = () => {
      lastKey.current = null;
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', clear, true);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', clear, true);
      window.removeEventListener('blur', clear);
    };
  }, []);
  const userFocus = () => {
    const k = lastKey.current;
    return (
      k !== null &&
      (k.key === 'Tab' || k.key === '/') &&
      performance.now() - k.at < USER_FOCUS_WINDOW_MS
    );
  };

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
          setActive(-1);
        } else if (q === null) {
          setText('');
          setProblem(null);
          setActive(-1);
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
    setOpen(false);
    void search({ q: parsed.q, kind: parsed.kind, origin: 'input' });
  };

  const pick = (row: DemoTarget) => {
    setText(row.name);
    setProblem(null);
    setOpen(false);
    setActive(-1);
    void search({ q: row.name, kind: 'name', origin: 'input' });
  };

  const optionId = (i: number) => `${listId}-opt-${i}`;
  const listShown = open && rows.length > 0;
  const announcement = !open
    ? ''
    : rows.length === 0
      ? NO_MATCH_HINT
      : `${rows.length} demo ${rows.length === 1 ? 'object' : 'objects'}. Use up and down arrows.`;

  const move = (to: number) => {
    setActive(to);
    document.getElementById(optionId(to))?.scrollIntoView?.({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (!open) return;
      e.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (rows.length === 0) return;
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(e.key === 'ArrowDown' ? 0 : rows.length - 1);
        return;
      }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      move(
        active < 0 ? (step > 0 ? 0 : rows.length - 1) : (active + step + rows.length) % rows.length,
      );
    } else if (e.key === 'Enter') {
      // Enter that confirms an IME composition must not pick a row (keyCode 229: browsers that
      // report the composition's last key with `isComposing` already false).
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
      const row = listShown ? rows[active] : undefined;
      if (row) {
        e.preventDefault();
        pick(row);
      }
    }
  };

  const onChange = (value: string) => {
    setText(value);
    setActive(-1);
    setOpen(true);
  };

  return (
    <div className="group sx-search" data-list-open={open ? 'true' : undefined}>
      <form
        role="search"
        aria-label="Find an object"
        onSubmit={onSubmit}
        className="sx-search-form"
        noValidate
      >
        <label htmlFor={inputId} className="sr-only">
          Object name, or RA, Dec in degrees
        </label>
        <Icon name="search" className="sx-search-icon" />
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => {
            if (userFocus()) setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setOpen(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          role="combobox"
          aria-expanded={listShown}
          aria-controls={listShown ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            listShown && active >= 0 && active < rows.length ? optionId(active) : undefined
          }
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
      {/* Always mounted, so a screen reader hears each change (WCAG 4.1.3). The text changes only
          while the list is open. */}
      <div role="status" aria-live="polite" className="sr-only" data-testid="search-status">
        {announcement}
      </div>
      <div className="sx-search-pop">
        {/* Help sits on top, so showing it never moves the chips under the pointer. */}
        <p
          id={helpId}
          className="sx-search-note sr-only text-sx-mfg group-has-[input:focus]:not-sr-only"
        >
          Decimal degrees only, for example 269.452, 4.693. Search by name for moving objects.
        </p>
        {open && (
          // A press anywhere in the list (a row, the scrollbar, the hint) must not blur the input,
          // or the list would close before the click lands.
          <div
            className="sx-suggest"
            data-testid="search-list"
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => e.preventDefault()}
          >
            <ul
              id={listId}
              role="listbox"
              aria-label="Demo objects"
              className="sx-suggest-list"
              hidden={rows.length === 0}
            >
              {rows.map((row, i) => (
                <li
                  key={row.name}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === active}
                  data-active={i === active ? 'true' : undefined}
                  className="sx-suggest-row"
                  onClick={() => pick(row)}
                >
                  <span className="sx-suggest-name">{row.name}</span>
                  {row.classLabel !== null && (
                    <>
                      {/* A separator for screen readers, which would run the two together. */}
                      <span className="sr-only">, </span>
                      <span className="sx-suggest-label">{row.classLabel}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <div>
              {rows.length === 0 && <p className="sx-suggest-hint">{NO_MATCH_HINT}</p>}
              <p className="sx-suggest-hint">{CLOSING_HINT}</p>
            </div>
          </div>
        )}
        {linkProblems.length > 0 && (
          <p
            id={linkProblemId}
            role="alert"
            className="sx-search-note border-red-400/70 text-red-200"
            data-testid="link-problem"
          >
            {linkProblems.join(' ')}
          </p>
        )}
        {problem && (
          <p
            id={problemId}
            role="alert"
            className="sx-search-note border-red-400/70 text-red-200"
            data-testid="search-problem"
          >
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}
