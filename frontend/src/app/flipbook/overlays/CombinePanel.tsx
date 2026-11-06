// "Combine frames" (issue #12): the backend adds or subtracts two frames on frame A's grid and
// returns a grey PNG. The result is `derived` (Estimated badge, formula as tooltip). The warning
// that the frames are at different wavelengths is always shown: a sum or difference of two SPHEREx
// frames mixes the spectrum's shape with change over time.
import { useEffect, useId } from 'react';
import type { CombineOp, Frame } from '@/app/api/types';
import { formatWavelength } from '@/app/format';
import { combineErrorMessage } from '@/app/messages';
import { ErrorBox, LoadingBox } from '@/app/StatusBoxes';
import { buttonClass } from '@/app/ui';
import { useAppStore, type SkyState } from '@/state/store';
import { ProvenanceBadge } from './ProvenanceBadge';
import { combineWarning, stretchText } from './text';

const selectClass =
  'min-h-11 rounded-md border border-neutral-500 bg-neutral-900 px-2 text-neutral-100 ' +
  'focus-visible:outline-2 focus-visible:outline-sky-400 max-w-full';

const OP_LABEL: Readonly<Record<CombineOp, string>> = {
  add: 'Add (A + B)',
  sub: 'Subtract (A − B)',
};

export function CombinePanel({ sky, frames }: { sky: SkyState; frames: readonly Frame[] }) {
  const setOpen = useAppStore((s) => s.skyCombineOpen);
  const setChoice = useAppStore((s) => s.skyCombineSet);
  const show = useAppStore((s) => s.skyCombineShow);
  const clear = useAppStore((s) => s.skyCombineClear);
  const id = useId();
  const c = sky.combine;

  // Free the image's object URL when the panel goes away (new search, no frames).
  useEffect(() => () => clear(), [clear]);

  const indexOf = (frameId: string | null) => frames.findIndex((f) => f.frame_id === frameId);
  const ia = indexOf(c.a);
  const ib = indexOf(c.b);
  const fa = frames[ia];
  const fb = frames[ib];
  const same = c.a !== null && c.a === c.b;
  const info = c.result?.info;
  const warning = info
    ? combineWarning(info.wavelength_a_um, info.wavelength_b_um)
    : fa && fb && !same
      ? combineWarning(fa.wavelength_um, fb.wavelength_um)
      : null;

  const frameOption = (f: Frame, i: number) => (
    <option key={f.frame_id} value={f.frame_id}>
      Frame {i + 1} · {formatWavelength(f.wavelength_um)}
    </option>
  );

  return (
    <details
      open={c.open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="rounded-md border border-neutral-800 px-3"
      data-testid="combine"
    >
      <summary className="min-h-11 cursor-pointer py-2 font-medium focus-visible:outline-2 focus-visible:outline-sky-400">
        Combine frames
      </summary>
      {c.open && (
        <div className="flex flex-col gap-3 pb-3 text-sm">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              Frame A
              <select
                className={selectClass}
                value={c.a ?? ''}
                onChange={(e) => setChoice({ a: e.target.value })}
                data-testid="combine-a"
              >
                {frames.map(frameOption)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Operation
              <select
                className={selectClass}
                value={c.op}
                onChange={(e) => setChoice({ op: e.target.value as CombineOp })}
                data-testid="combine-op"
              >
                {(['add', 'sub'] as const).map((op) => (
                  <option key={op} value={op}>
                    {OP_LABEL[op]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              Frame B
              <select
                className={selectClass}
                value={c.b ?? ''}
                onChange={(e) => setChoice({ b: e.target.value })}
                data-testid="combine-b"
              >
                {frames.map(frameOption)}
              </select>
            </label>
            <button
              type="button"
              className={buttonClass}
              onClick={() => void show()}
              disabled={!fa || !fb || same || c.status === 'loading'}
              aria-describedby={same ? `${id}-same` : undefined}
              data-testid="combine-show"
            >
              Show
            </button>
          </div>
          {same && (
            <p id={`${id}-same`} className="text-neutral-400" data-testid="combine-same">
              Pick two different frames.
            </p>
          )}
          {warning && (
            <p className="text-amber-200" data-testid="combine-warning">
              {warning}
            </p>
          )}
          {c.status === 'loading' && <LoadingBox text="Combining the frames…" startedAt={null} />}
          {c.status === 'error' && c.error && (
            <ErrorBox
              message={combineErrorMessage(c.error)}
              detail={c.error.detail}
              onRetry={() => void show()}
            />
          )}
          {c.status === 'ready' && c.result && info && (
            <figure className="flex flex-col gap-2" data-testid="combine-result">
              <div className="relative w-full max-w-md overflow-hidden rounded-lg border border-neutral-800 bg-black">
                <img
                  src={c.result.objectUrl}
                  alt={`Frame ${ia + 1} ${info.op === 'add' ? 'plus' : 'minus'} frame ${ib + 1}, combined on frame ${ia + 1}’s grid.`}
                  className="block h-auto w-full"
                  style={{ imageRendering: 'pixelated' }}
                  draggable={false}
                  data-testid="combine-image"
                />
                {sky.fixture && (
                  <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-amber-400 px-1 text-[10px] font-bold tracking-wide text-black">
                    SYNTHETIC
                  </span>
                )}
              </div>
              <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1 text-neutral-300">
                <span data-testid="combine-caption">
                  {OP_LABEL[info.op]}, on frame A’s grid. Unit {info.unit}.{' '}
                  {stretchText(info.stretch.kind)}
                </span>
                {/* The badge reads the reply's own tag (D-02); the parameters are in its formula. */}
                <ProvenanceBadge
                  entry={{ tag: info.tag, formula: info.formula }}
                  fixture={sky.fixture}
                />
                {sky.fixture && <span className="text-neutral-400">Formula: {info.formula}</span>}
              </figcaption>
            </figure>
          )}
        </div>
      )}
    </details>
  );
}
