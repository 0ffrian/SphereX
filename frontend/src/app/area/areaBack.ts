// Where a card's ← goes (issue #173, approved "Discovery Journey" mock-up): one level at a time.
//   a track or a known object   → its list (Discovery or Known), the row it came from in focus
//   the Track view (or its job) → the track or list it was opened from, or the scan
//   the list of a scan square   → the scan card, with the whole grid on the sky
//   the list of a single square → your patch: the card folds into the island, the sky frames it
// The first card of a branch (the offer, a scan, the live card) has none: × gives the sky back.
// Escape steps back like ← when there is one (AreaCard, PanelCard); × closes everything.
import { useAreaStore, type AreaState } from '@/app/shell/areaStore';
import { backToScan } from '@/app/sky/areaDraw';

export interface AreaBack {
  /** The button's name, saying where it goes. */
  label: string;
  go(): void;
}

type Where = Pick<
  AreaState,
  'screen' | 'trackBack' | 'fromScan' | 'flow' | 'step' | 'running' | 'disc' | 'known' | 'refusal'
>;

const toList = (s: Where): AreaBack | null =>
  s.fromScan
    ? { label: 'Back to the scan', go: backToScan }
    : {
        label: 'Back to your patch',
        go: () => {
          useAreaStore.getState().backToPatch();
          // Focus goes to the island's pill, which names the folded card ("Discovery, minimised").
          requestAnimationFrame(() =>
            document
              .querySelector<HTMLElement>('[data-testid="island-mini"]')
              ?.focus({ preventScroll: true }),
          );
        },
      };

/** The ← of the card on screen now, or null when it is the first card of its branch. Pure but `go`. */
export function areaBackOf(s: Where): AreaBack | null {
  const st = () => useAreaStore.getState();
  switch (s.screen) {
    case 'mover':
      return {
        label: 'Back to the Discovery list',
        go: () => {
          st().openDisc();
          useAreaStore.setState((x) => ({ fitSeq: x.fitSeq + 1 }));
        },
      };
    case 'eros':
    case 'track':
      if (s.trackBack === 'mover')
        return { label: 'Back to the track', go: () => st().openMover(st().sel) };
      if (s.trackBack === 'scan') return { label: 'Back to the scan', go: backToScan };
      return s.flow === 'discovery'
        ? { label: 'Back to the Discovery list', go: () => st().openDisc() }
        : { label: 'Back to the Known list', go: () => st().openList() };
    case 'disc':
      // While the steps still run there is nothing to go back to but the sky.
      if (!s.fromScan && (s.running || s.step < 0) && !s.refusal) return null;
      return toList(s);
    case 'list':
      return toList(s);
    default:
      return null;
  }
}

/** The ← of the open area card, kept up to date. */
export function useAreaBack(): AreaBack | null {
  const screen = useAreaStore((s) => s.screen);
  const trackBack = useAreaStore((s) => s.trackBack);
  const fromScan = useAreaStore((s) => s.fromScan);
  const flow = useAreaStore((s) => s.flow);
  const step = useAreaStore((s) => s.step);
  const running = useAreaStore((s) => s.running);
  const disc = useAreaStore((s) => s.disc);
  const known = useAreaStore((s) => s.known);
  const refusal = useAreaStore((s) => s.refusal);
  return areaBackOf({ screen, trackBack, fromScan, flow, step, running, disc, known, refusal });
}
