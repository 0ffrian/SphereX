// The test page shell: one engine for every panel, kept in step with the haptics settings.
import { useEffect, useState } from 'react';
import { createHaptics } from '@/haptics/haptics';
import { bindEngine } from '@/haptics/settings';
import { EnginePanel } from './EnginePanel';
import { SpectrumPanel } from './panels/SpectrumPanel';
import { TexturePanel } from './panels/TexturePanel';

export function TestPage() {
  const [haptics] = useState(() => createHaptics());

  useEffect(() => {
    const unbind = bindEngine(haptics);
    return () => {
      unbind();
      haptics.engine.dispose();
    };
  }, [haptics]);

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Vibration and sound test</h1>
        <p className="text-neutral-400">
          Developer page with synthetic inputs only. Not part of the app.
        </p>
      </header>
      <EnginePanel haptics={haptics} />
      <SpectrumPanel haptics={haptics} />
      <TexturePanel haptics={haptics} />
    </main>
  );
}
