// Test helper: shared synthetic fixtures (shared/fixtures) by type. Test code only.
import type { ObjectCard, RenderParams } from '@/contract';

const load = (files: Record<string, unknown>) =>
  new Map(
    Object.entries(files).map(([path, data]) => [
      path.replace(/^.*\//, '').replace(/\.json$/, ''),
      data,
    ]),
  );
const cards = load(
  import.meta.glob('../../../../shared/fixtures/cards/*.json', { eager: true, import: 'default' }),
);
const params = load(
  import.meta.glob('../../../../shared/fixtures/params/*.json', { eager: true, import: 'default' }),
);

export function fixture(name: string): { card: ObjectCard; params: RenderParams } {
  const card = cards.get(name) as ObjectCard | undefined;
  const p = params.get(name) as RenderParams | undefined;
  if (!card || !p) throw new Error(`no fixture ${name}`);
  return { card: structuredClone(card), params: structuredClone(p) };
}
