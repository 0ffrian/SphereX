// Honesty (A11): when any reply came from the dev fixture server, say so on every screen. Fixture
// data is synthetic and must never pass for SPHEREx data.
import { useAppStore } from '@/state/store';

export function FixtureBanner() {
  const seen = useAppStore((s) => s.sky.fixtureSeen);
  if (!seen) return null;
  return (
    <p
      className="rounded-md border border-amber-400 bg-amber-950/60 px-3 py-2 text-sm text-amber-100"
      data-testid="fixture-banner"
    >
      <strong className="font-semibold">Fixture data.</strong> The images and numbers on this page
      are synthetic, made for development. They are not SPHEREx measurements.
    </p>
  );
}
