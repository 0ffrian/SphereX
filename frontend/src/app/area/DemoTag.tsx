// The honesty tag of the area flows (D-02, design-language tags): the results are a fixed demo, not
// a search of the drawn area (areaService.ts, Q-205 pending).
export const DEMO_NOTE =
  'Demo data: this is not a search of the area you drew. Eros’s frames and path are real SPHEREx data shown as an example; where they sit here, the dots and the other movers are made up.';

/** Eros card on real frames and path (issue #130): only the pictures and the brightness are demo. */
export const DEMO_CUTOUT_NOTE =
  'Demo data: the frame list and the sky path come from the backend, but the cutouts, the bright-peak masks and the brightness chart are a demo extraction of Eros’s frames (the frames it has no demo cutout for are listed without one).';

export function DemoTag({
  testId = 'demo-tag',
  note = DEMO_NOTE,
  label = 'Demo data',
}: {
  testId?: string;
  note?: string;
  label?: string;
}) {
  return (
    <span
      className="sx-tagbadge"
      style={{ ['--dot' as string]: 'var(--p-asm)' }}
      title={note}
      data-testid={testId}
    >
      {label}
    </span>
  );
}
