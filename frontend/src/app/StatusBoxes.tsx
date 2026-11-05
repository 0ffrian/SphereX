// Shared loading and error boxes for the flipbook and the spectrum panel.
import { useEffect, useState } from 'react';

/** Seconds since `startedAt`, ticking once a second while it is set. */
function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1000));
}

/** Show the elapsed time only after this long, so quick replies don't flash a counter. */
const SHOW_ELAPSED_AFTER_S = 5;

export function LoadingBox({ text, startedAt }: { text: string; startedAt: number | null }) {
  const seconds = useElapsedSeconds(startedAt);
  return (
    <div
      className="flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-200"
      data-testid="loading"
    >
      <span
        className="inline-block size-3 animate-pulse rounded-full bg-sky-400"
        aria-hidden="true"
      />
      <span>
        {text}
        {seconds >= SHOW_ELAPSED_AFTER_S && (
          <span className="text-neutral-400"> Still waiting ({seconds} s)…</span>
        )}
      </span>
    </div>
  );
}

export function ErrorBox({
  message,
  detail,
  onRetry,
}: {
  message: string;
  detail: string | null;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-md border border-red-400 bg-red-950/40 px-3 py-2 text-sm text-neutral-100"
      data-testid="error"
    >
      <p>{message}</p>
      {detail && <p className="text-neutral-300">Server says: {detail}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="min-h-11 self-start rounded-md border border-neutral-500 bg-neutral-900 px-3 text-neutral-100 hover:bg-neutral-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-400"
        >
          Try again
        </button>
      )}
    </div>
  );
}
