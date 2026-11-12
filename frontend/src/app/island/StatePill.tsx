// smoothui's demo pill: a black rounded-full pill with a GridLoader and one word (issue #66).
// The status role makes the word the announcement; the loader itself is decorative.
import GridLoader, { type GridLoaderProps } from './GridLoader';

export function StatePill({ look, word }: { look: GridLoaderProps; word: string }) {
  return (
    <div className="sx-pill" role="status">
      <span aria-hidden="true" className="contents">
        <GridLoader {...look} className="flex-none" />
      </span>
      <span>{word}</span>
    </div>
  );
}
