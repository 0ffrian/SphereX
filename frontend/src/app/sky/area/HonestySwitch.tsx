// Honesty on the sky for Area search (D-21, A16.5, A18.2; Q-407): "Measured only | + Estimated".
// It writes the global honesty state (the same one the 3D view uses). "Measured only" keeps the
// dots in one colour and hides track lines, labels, verdicts and Known positions; "+ Estimated"
// shows them. Nothing in Area search is `artistic`: with "+ Artistic" set in the 3D view the switch
// reads "+ Estimated" and says so (red-team M14), and choosing "+ Estimated" leaves it as it is.
import { Segmented } from '@/app/Segmented';
import {
  AREA_ARTISTIC_NOTE,
  AREA_MEASURED_NOTE,
  AREA_SHOW_LABEL,
  areaHonestyAnnouncement,
} from '@/app/messages';
import { useAppStore } from '@/state/store';
import { HONESTY_LABEL, effectiveHonesty } from '@/viewer/honesty';

type AreaHonesty = 'measured' | 'derived';

export function HonestySwitch() {
  const honesty = effectiveHonesty(useAppStore((s) => s.honesty));
  const value: AreaHonesty = honesty === 'measured' ? 'measured' : 'derived';
  const choose = (v: AreaHonesty) => {
    const store = useAppStore.getState();
    const now = effectiveHonesty(store.honesty);
    if (v === 'measured' && now !== 'measured') store.setHonesty('measured');
    else if (v === 'derived' && now === 'measured') store.setHonesty('derived');
    else return;
    useAppStore.setState((s) => ({
      sky: { ...s.sky, announcement: areaHonestyAnnouncement(v === 'measured') },
    }));
  };
  return (
    <div className="mt-2 flex flex-col gap-1" data-testid="area-honesty">
      <Segmented<AreaHonesty>
        label={AREA_SHOW_LABEL}
        options={[
          { value: 'measured', label: HONESTY_LABEL.measured, testId: 'area-honesty-measured' },
          { value: 'derived', label: HONESTY_LABEL.derived, testId: 'area-honesty-derived' },
        ]}
        value={value}
        onChange={choose}
      />
      {honesty === 'measured' && (
        <p className="text-sm text-sx-amber" data-testid="area-measured-note">
          {AREA_MEASURED_NOTE}
        </p>
      )}
      {honesty === 'artistic' && (
        <p className="text-sm text-sx-mfg" data-testid="area-artistic-note">
          {AREA_ARTISTIC_NOTE}
        </p>
      )}
    </div>
  );
}
