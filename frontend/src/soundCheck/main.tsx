// R13.9 sound-check page entry (dev only; `npm run dev`, then /sound-check.html). Never an input of the build.
import { createRoot } from 'react-dom/client';
import { SoundCheck } from './SoundCheck';
import './marker';

const el = document.getElementById('root');
if (el) createRoot(el).render(<SoundCheck />);
