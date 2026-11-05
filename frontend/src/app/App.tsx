// App shell: header, search, the SPHEREx flipbook and spectrum (M1, A1.1 P0), the 3D viewer
// panel and the renderer status line.
import { Flipbook } from './flipbook/Flipbook';
import { FixtureBanner } from './FixtureBanner';
import { LiveAnnouncer } from './LiveAnnouncer';
import { SearchBar } from './search/SearchBar';
import { SpectrumPanel } from './spectrum/SpectrumPanel';
import { StatusLine } from './StatusLine';
import { useHashSync } from './useHashSync';
import { ViewerPanel } from './ViewerPanel';

export function App() {
  useHashSync();
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Shift &amp; Spectrum</h1>
        <FixtureBanner />
      </header>
      <main className="flex flex-1 flex-col gap-8">
        <SearchBar />
        <Flipbook />
        <SpectrumPanel />
        <ViewerPanel />
      </main>
      <footer>
        <StatusLine />
      </footer>
      <LiveAnnouncer />
    </div>
  );
}
