import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Parity harness (issue #71, parity/CONTRACT.md C): dev only, behind ?parity=1.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('parity'))
  void import('@/engine/stars/parityHook').then((m) => m.installParityHook());
