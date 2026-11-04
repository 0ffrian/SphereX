// App shell: header, the 3D viewer panel and the renderer status line.
import { StatusLine } from './StatusLine';
import { ViewerPanel } from './ViewerPanel';

export function App() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Shift &amp; Spectrum</h1>
      </header>
      <main className="flex flex-1 flex-col gap-4">
        <ViewerPanel />
      </main>
      <footer>
        <StatusLine />
      </footer>
    </div>
  );
}
