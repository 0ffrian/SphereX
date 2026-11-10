import { describe, expect, it } from 'vitest';
import { closeUpButtonLabel, closeUpCaption, closeUpKindOf } from './CloseUpPane';

describe('close-up pane', () => {
  it('serves every kind: orbit, star, body', () => {
    expect(closeUpKindOf('planet_rocky')).toBe('orbit');
    expect(closeUpKindOf('gas_giant')).toBe('orbit');
    expect(closeUpKindOf('star_mira')).toBe('star');
    expect(closeUpKindOf('comet')).toBe('body');
    expect(closeUpKindOf('nebula')).toBeNull();
  });
  it('captions follow the mock-up wording and never go blank', () => {
    for (const k of ['orbit', 'star', 'body'] as const) expect(closeUpCaption(k, null, false)).toMatch(/^Close-up · /);
    expect(closeUpCaption('star', null, false)).toMatch(/not available yet/);
    expect(closeUpCaption('orbit', { mode: 'text', resolved: null, layout: 'side', refusal: 'The planet is still forming.' }, true)).toMatch(/still forming/);
  });
  it('the button reads in plain words', () => {
    expect(closeUpButtonLabel('orbit')).toBe('Surface view');
  });
});
