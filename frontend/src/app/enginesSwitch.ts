// Issue #93 C4: the kill switch for the D-37 prototype engines (world, star, rock). `?engines=0` in the page's
// query string turns them off and the three.js path draws every body at every level; `?engines=1` turns them back
// on. The choice is kept in localStorage so a reload without the query keeps it. The query string, not the hash:
// useHashSync owns the hash. Default: on.
//
// Every storage access is wrapped: storage can be missing or throw (private window, blocked site data).

/** The localStorage key that keeps the last `?engines=` choice. */
export const ENGINES_KEY = 'sx.engines';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** `true` / `false` for `1` / `0`; `null` for anything else (absent or unrecognised). */
function parse(v: string | null | undefined): boolean | null {
  if (v === '1') return true;
  if (v === '0') return false;
  return null;
}

/** Whether the prototype engines may draw. The query wins and is remembered; else the stored choice; else true. */
export function enginesEnabled(search: string = currentSearch()): boolean {
  const fromQuery = parse(new URLSearchParams(search).get('engines'));
  const s = storage();
  if (fromQuery !== null) {
    try {
      const v = fromQuery ? '1' : '0';
      if (s && s.getItem(ENGINES_KEY) !== v) s.setItem(ENGINES_KEY, v);
    } catch {
      // not persisted: the query still applies to this page
    }
    return fromQuery;
  }
  try {
    return parse(s?.getItem(ENGINES_KEY)) ?? true;
  } catch {
    return true;
  }
}

function currentSearch(): string {
  return typeof location === 'undefined' ? '' : location.search;
}
