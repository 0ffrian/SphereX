// Dev-only haptics and sound test page (issue #9): /haptics-test.html on the dev server. It lives
// outside src/haptics so the R10 layout test never imports it, and it is not a build input.
// Synthetic inputs only. Open it on a phone with `npm run dev:phone` and debug via chrome://inspect.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TestPage } from './TestPage';
import '../index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from haptics-test.html');

createRoot(root).render(
  <StrictMode>
    <TestPage />
  </StrictMode>,
);
