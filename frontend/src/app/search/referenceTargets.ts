// Issue #71 stream E (Q-258): reference objects in the search list, after the demo rows. Kept out of
// the generated `demoTargets.ts` (bake_demo_pack.py rewrites that file). The values live in
// backend/assets/reference_objects.toml; a row here holds only a name and an id, never a number.
import type { DemoTarget } from './demoTargets';

export const REFERENCE_TARGETS: readonly DemoTarget[] = [
  { name: 'Jupiter', aliases: ['jupiter', 'jove'], query: 'Jupiter', id: 'ref-jupiter', classLabel: 'gas giant · reference planet' },
  { name: 'Saturn', aliases: ['saturn', 'rings'], query: 'Saturn', id: 'ref-saturn', classLabel: 'gas giant · reference planet' },
  { name: 'Titan', aliases: ['titan', 'saturn vi', 'moon of saturn'], query: 'Titan', id: 'ref-titan', classLabel: 'rocky world · moon of Saturn' },
];
