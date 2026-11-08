// Honesty (A11): when any reply came from the dev fixture server, say so on every screen. Fixture
// data is synthetic and must never pass for SPHEREx data.
import { useAppStore } from '@/state/store';

export function FixtureBanner() {
  const seen = useAppStore((s) => s.sky.fixtureSeen);
  if (!seen) return null;
  return (
    <p
      className="min-w-0 flex-1 basis-64 rounded-lg border border-amber-400/80 bg-amber-950/70 px-2.5 py-1 text-xs leading-4 text-amber-100"
      data-testid="fixture-banner"
    >
      <strong className="font-semibold">Fixture data.</strong> The images and numbers on this page
      are synthetic, made for development. They are not SPHEREx measurements.
    </p>
  );
}
