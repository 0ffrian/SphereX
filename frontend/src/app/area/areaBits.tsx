// Small pieces the area cards share (issue #145): the message (a status dot, a short title and one
// muted line, never a tinted box) and the two action icons of the mock-up (Lucide `route` for
// Track it, `box` for Build it).
import type { AreaRefusal } from '@/app/shell/areaStore';

/** A message: a status dot (warn or fail), a short title and one muted line. */
export function Alert({
  tone = 'fail',
  title,
  line,
  testId,
  code,
}: {
  tone?: 'warn' | 'fail';
  title: string;
  line: string;
  testId?: string;
  code?: string;
}) {
  return (
    <div
      className="sx-live-alert"
      data-tone={tone}
      role="status"
      data-testid={testId}
      data-code={code}
    >
      <b>{title}</b>
      <span>{line}</span>
    </div>
  );
}

/**
 * A refusal in words, with a way forward (held UI issue 6): "No prepared data" said nothing about
 * what to do. With live areas (#141) a box anywhere is offered for computing; this shows only when
 * the server cannot compute new areas, or a stored area failed to load.
 */
export function refusalText(r: AreaRefusal): { title: string; line: string } {
  if (r.code === 'area:not_prepared')
    return {
      title: 'No data for this area here',
      line: 'This server cannot compute new areas. Draw again over a prepared area.',
    };
  return { title: 'Could not load this area', line: r.message };
}

export function AreaAlert({ refusal }: { refusal: AreaRefusal }) {
  const t = refusalText(refusal);
  return <Alert title={t.title} line={t.line} testId="area-refused" code={refusal.code} />;
}

const svg = { viewBox: '0 0 24 24', 'aria-hidden': true, className: 'sx-btn-ico' } as const;

/** Lucide `route` (Track it). */
export function RouteIcon() {
  return (
    <svg {...svg}>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </svg>
  );
}

/** Lucide `box` (Build it). */
export function BoxIcon() {
  return (
    <svg {...svg}>
      <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
      <path d="m3.3 7 8.7 5 8.7-5" />
      <path d="M12 22V12" />
    </svg>
  );
}
