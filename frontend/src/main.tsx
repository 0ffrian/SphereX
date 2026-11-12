import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dev only: the engine parity hooks (parity/CONTRACT.md C), on ?parity=1. Never part of a production build.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('parity') === '1') {
  void import('@/engine/parity/install').then((m) => m.installParity());
}
