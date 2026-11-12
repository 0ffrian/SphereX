// Q-456: the build view's Ambience dropdown holds this body's atmosphere (or why there is none) and
// the sound settings that used to sit in the sky's top bar.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAudioContext } from '@/test/fakeAudio';
import { setAudioContextFactory } from '@/sound/audioContext';
import { createAppSound } from '@/sound/appSound';
import { SoundProvider } from '@/sound/SoundProvider';
import { initialAppData, useAppStore } from '@/state/store';
import { fixture } from '@/test/sharedFixtures';
import { AmbiencePanel } from './AmbiencePanel';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  useAppStore.setState(initialAppData);
  setAudioContextFactory(() => new FakeAudioContext({ state: 'suspended' }).asAudioContext());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setAudioContextFactory(null);
});

describe('AmbiencePanel', () => {
  it('a star has no atmosphere to hear: it says why, and the sound settings are there', async () => {
    const { card, params } = fixture('star');
    useAppStore.getState().setObject(card, params);
    const sound = createAppSound({ engine: { debugTarget: null } });
    await act(async () =>
      root.render(
        <SoundProvider sound={sound}>
          <AmbiencePanel name={card.name} />
        </SoundProvider>,
      ),
    );
    expect(host.textContent).toContain('Ambience');
    expect(host.querySelector('[data-testid="build-ambience-none"]')?.textContent).toBeTruthy();
    expect(host.querySelector('[data-testid="build-ambience-atmo"]')).toBeNull();
    expect(host.querySelector('[data-testid="sound-settings"]')).not.toBeNull();
  });
});
