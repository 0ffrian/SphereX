import { describe, expect, it } from 'vitest';
import { displayName } from './displayName';

describe('displayName', () => {
  it('strips the SIMBAD NAME and * prefixes', () => {
    expect(displayName("NAME Barnard's Star")).toBe("Barnard's Star");
    expect(displayName('* 61 Cyg')).toBe('61 Cyg');
  });
  it('leaves other names alone', () => {
    expect(displayName('3I/ATLAS')).toBe('3I/ATLAS');
    expect(displayName(undefined)).toBe('');
  });
});
