// A4.1 / Q-161: the demo search list, in the order the search bar shows it (issue #68, 7b).
//
// GENERATED LATER: Track F (issue #68, 7c) makes `scripts/bake_demo_pack.py` write this file from
// the pre-built cards, which fills `classLabel` ("brown dwarf · T1": the type name from
// altText.ts::TYPE_NAME plus the card's spectral class). Until then every `classLabel` is null and
// a row shows its name only. Never hand-write a class label, and never put a physical value in a
// row: the file holds names and search texts only (D-19: the backend resolves them).
//
// `backend/targets.toml` lists the same objects (group = "demo") with the same aliases; the
// aliases there are what the backend resolver accepts, the ones here only filter the list.

export interface DemoTarget {
  /** Display name, also the text sent to the resolver when the row is picked. */
  name: string;
  /** Extra search texts the list filter matches (the name is always matched). */
  aliases: readonly string[];
  /** What `/v1/resolve` is given for this row (backend/targets.toml `query`). */
  query: string;
  /** From the pre-built card, never hand-written. null: the row shows its name only. */
  classLabel: string | null;
}

export const DEMO_TARGETS: readonly DemoTarget[] = [
  {
    name: "Barnard's Star",
    aliases: ['barnard', 'barnards'],
    query: "Barnard's star",
    classLabel: null,
  },
  {
    name: 'Epsilon Indi B',
    aliases: ['eps indi b', 'epsilon indi'],
    query: 'eps Ind B',
    classLabel: null,
  },
  {
    name: 'WISE 0855-0714',
    aliases: ['wise 0855', 'w0855'],
    query: 'WISE J085510.83-071442.5',
    classLabel: null,
  },
  { name: 'RW Aurigae', aliases: ['rw aur'], query: 'RW Aur', classLabel: null },
  { name: 'R Draconis', aliases: ['r dra'], query: 'R Dra', classLabel: null },
  {
    name: 'TRAPPIST-1 f',
    aliases: ['trappist-1f', 'trappist 1 f'],
    query: 'TRAPPIST-1 f',
    classLabel: null,
  },
  {
    name: 'Kepler-186 f',
    aliases: ['kepler-186f', 'kepler 186 f'],
    query: 'Kepler-186 f',
    classLabel: null,
  },
  { name: 'Bennu', aliases: ['bennu', '101955'], query: '101955 Bennu', classLabel: null },
  {
    name: "'Oumuamua",
    aliases: ['oumuamua', "'oumuamua", '1i'],
    query: '1I/2017 U1',
    classLabel: null,
  },
  { name: '3I/ATLAS', aliases: ['3i', 'atlas'], query: '3I/ATLAS', classLabel: null },
  {
    name: 'HD 189733 b',
    aliases: ['hd 189733', 'hd189733b'],
    query: 'HD 189733 b',
    classLabel: null,
  },
  { name: 'TRAPPIST-1 e', aliases: ['trappist-1e'], query: 'TRAPPIST-1 e', classLabel: null },
  { name: 'K2-18 b', aliases: ['k2-18', 'k218'], query: 'K2-18 b', classLabel: null },
  {
    name: 'Comet 67P',
    aliases: ['67p', 'churyumov', 'gerasimenko'],
    query: '67P/Churyumov-Gerasimenko',
    classLabel: null,
  },
  { name: 'Orion Nebula', aliases: ['orion', 'm42'], query: 'M 42', classLabel: null },
  { name: 'Crab Nebula', aliases: ['crab', 'm1'], query: 'M 1', classLabel: null },
];

/** The five A1.1 targets (rows 1 to 5): the sky view marks these when they are cached. */
export const TEST_TARGETS: readonly string[] = DEMO_TARGETS.slice(0, 5).map((t) => t.name);

/** Lower case, without apostrophes or spaces: how the filter compares texts (7a). */
export function squash(text: string): string {
  return text.toLowerCase().replace(/[’'\s]/g, '');
}

/** Rows whose name or any alias contains the typed text. Empty text keeps every row. */
export function filterTargets(targets: readonly DemoTarget[], text: string): readonly DemoTarget[] {
  const k = squash(text);
  if (k === '') return targets;
  return targets.filter(
    (t) => squash(t.name).includes(k) || t.aliases.some((a) => squash(a).includes(k)),
  );
}
