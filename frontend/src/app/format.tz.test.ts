// formatUtc must give the same text whatever the machine's time zone. This file runs with the
// process time zone set to Indian/Mauritius (UTC+4, no daylight saving).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { formatUtc, TIME_WITHOUT_ZONE } from './format';

describe('formatUtc under a non-UTC time zone', () => {
  beforeAll(() => {
    vi.stubEnv('TZ', 'Indian/Mauritius');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('really runs in UTC+4', () => {
    expect(new Date(Date.UTC(2025, 4, 3)).getTimezoneOffset()).toBe(-240);
  });

  it('formats Z and offset times as UTC', () => {
    expect(formatUtc('2025-05-03T14:22:10Z')).toBe('2025-05-03 14:22:10 UTC');
    expect(formatUtc('2025-05-03T18:22:10+04:00')).toBe('2025-05-03 14:22:10 UTC');
    expect(formatUtc('2025-05-03T23:30:00-02:00')).toBe('2025-05-04 01:30:00 UTC');
  });

  it('refuses a zone-less time instead of reading it as Mauritius time', () => {
    expect(formatUtc('2025-05-03T14:22:10')).toBe(TIME_WITHOUT_ZONE);
  });
});
