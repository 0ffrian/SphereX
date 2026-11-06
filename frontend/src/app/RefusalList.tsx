// Refused items (`missing`) as grouped plain-English lines (A11): one line per reason with a
// count, the frame IDs behind a disclosure. Used by the flipbook and the spectrum panel.
import { useId, useState } from 'react';
import { describeRefusalGroup, refusalShortLabel } from './messages';
import type { RefusalGroup } from './refusals';

export function RefusalList({
  groups,
  lead,
  testId,
}: {
  groups: readonly RefusalGroup[];
  /** Lead line, shown only when at least one frame group exists ("Frames not shown:"). */
  lead: string;
  testId: string;
}) {
  const leadId = useId();
  if (groups.length === 0) return null;
  const hasFrames = groups.some((g) => g.kind === 'frames');
  return (
    <div className="flex flex-col gap-1 text-sm text-neutral-300" data-testid={testId}>
      {hasFrames && (
        <p id={leadId} className="font-medium text-neutral-200">
          {lead}
        </p>
      )}
      {/* role="list": Safari drops list semantics from list-none lists. */}
      <ul role="list" className="flex flex-col" aria-labelledby={hasFrames ? leadId : undefined}>
        {groups.map((g) =>
          g.kind === 'frames' ? (
            <li key={g.key} className="list-none">
              <FrameGroup group={g} lead={lead} />
            </li>
          ) : (
            <li key={g.key} className="list-none py-1" data-testid="refusal-note">
              {describeRefusalGroup(g)}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function FrameGroup({ group, lead }: { group: RefusalGroup; lead: string }) {
  // The IDs are rendered only while open: R Dra lists about 530 of them.
  const [open, setOpen] = useState(false);
  return (
    <details
      data-testid="refusal-group"
      data-reason={group.reason}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="min-h-11 cursor-pointer py-2 focus-visible:outline-2 focus-visible:outline-sky-400">
        {describeRefusalGroup(group)}{' '}
        <span className="text-neutral-400">({open ? 'hide' : 'show'} frame IDs)</span>
      </summary>
      {open && (
        <div
          tabIndex={0}
          role="region"
          aria-label={`${lead.replace(/:$/, '')}, frame IDs: ${refusalShortLabel(group.reason)}`}
          // The flipbook's keys (Space, Home, End, arrows) stay with this scroll box (R9).
          data-own-keys=""
          className="max-h-60 overflow-y-auto rounded-md border border-neutral-800 px-2 py-1 focus-visible:outline-2 focus-visible:outline-sky-400"
          data-testid="refusal-ids"
        >
          <ul role="list" className="flex flex-wrap gap-x-3 font-mono text-sm">
            {group.frameIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
