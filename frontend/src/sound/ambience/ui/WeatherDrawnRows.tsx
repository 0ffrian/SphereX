// §8.5 "What is drawn": the weather layers with their tags, from #116's weatherRows (one list for "What is drawn" and
// "What you hear"). Exported for the fly panel (SHOW_FLY_BAR) and for #116's panel.
import { ProvenanceBadge } from '@/app/Badge';
import { useWeatherSnapshot, weatherRows } from '../weatherBus';

export function WeatherDrawnRows() {
  const rows = weatherRows(useWeatherSnapshot());
  return (
    <>
      {rows.map((r) => (
        <li key={r.text} className="flex flex-wrap items-center gap-2" data-testid="weather-row">
          <ProvenanceBadge tag={r.tag} />
          <span>{r.text}</span>
        </li>
      ))}
    </>
  );
}
