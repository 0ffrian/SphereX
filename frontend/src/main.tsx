import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import { ErrorBoundary, installGlobalErrorLogging } from '@/app/ErrorBoundary';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

// Issue #102: log what escapes React, and never leave a blank page on a throw during render.
installGlobalErrorLogging();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary area="The app" className="m-4">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Dev only: the engine parity hooks (parity/CONTRACT.md C), on ?parity=1. Never part of a production build.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('parity') === '1') {
  void import('@/engine/parity/install').then((m) => m.installParity());
}
