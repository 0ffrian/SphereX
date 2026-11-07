import { describe, expect, it } from 'vitest';
import {
  describeRefusal,
  describeRefusalGroup,
  layerName,
  pluralFrames,
  refusalShortLabel,
  spectrumAnnouncement,
  spectrumCoverageMessage,
  spectrumEmptyMessage,
} from './messages';
import { FRAME_REASONS, groupMissing, summarizeSpectrum, WHOLE_RESULT_CODES } from './refusals';

// Test data only, not physical claims.
const many = (reason: string, n: number, prefix = reason) =>
  Array.from({ length: n }, (_, i) => `${reason}:${prefix}-${i}`);
const one = (codes: string[]) => {
  const groups = groupMissing(codes);
  expect(groups).toHaveLength(1);
  return describeRefusalGroup(groups[0]!);
};

describe('refusal wording', () => {
  it('says "1 frame" and "2 frames"', () => {
    expect(pluralFrames(1)).toBe('1 frame');
    expect(pluralFrames(2)).toBe('2 frames');
    expect(one(['saturated:a'])).toMatch(/^1 frame where the detector flagged/);
    expect(one(['saturated:a', 'saturated:b'])).toMatch(/^2 frames where the detector flagged/);
  });

  it.each(FRAME_REASONS)('%s has its own plain line, without codes or IDs', (reason) => {
    const line = one([`${reason}:2026W17_1B_0634_4_D3`, `${reason}:2026W17_1B_0634_4_D4`]);
    expect(line).toMatch(/^2 frames /);
    expect(line).not.toContain('reason code');
    expect(line).not.toContain('Not available');
    expect(line).not.toContain('_');
    expect(line).not.toContain(':2026');
    expect(line).not.toContain('2026W17');
    expect(refusalShortLabel(reason)).not.toContain('_');
  });

  it.each(WHOLE_RESULT_CODES)('%s has its own plain line', (code) => {
    const line = one([code]);
    expect(line).not.toContain('Not available');
    expect(line).not.toContain('_');
    expect(line).not.toContain(code);
  });

  it('has no redundant "so not measured" or "left out" tails', () => {
    for (const reason of FRAME_REASONS) {
      expect(one([`${reason}:a`])).not.toMatch(/so not measured|not measured\.|left out/);
    }
  });

  it('words deferred cutouts with the count, and no "Try again"', () => {
    expect(one(['cutouts:deferred:7'])).toBe(
      '7 more frames are not downloaded yet. Search again in a moment to load them.',
    );
    expect(one(['cutouts:deferred:1'])).toBe(
      '1 more frame is not downloaded yet. Search again in a moment to load it.',
    );
  });

  it('never says the object is too bright: `saturated` may be a blank, flagged centre pixel', () => {
    for (const code of ['saturated:a', 'spectrum:saturated']) {
      expect(one([code])).toContain('flagged the object’s centre as saturated or unusable');
      expect(one([code])).not.toMatch(/bright/);
    }
    expect(one(['spectrum:saturated'])).toBe(
      'The detector flagged the object’s centre as saturated or unusable in every frame found, so this tool can’t measure a spectrum.',
    );
  });

  it('words a mismatched-layer refusal too (extension)', () => {
    expect(one(['extension:a'])).toBe(
      '1 frame missing the image, flag or uncertainty layer, or with layers that don’t match.',
    );
  });

  it('does not read inherited properties as note wording', () => {
    expect(one(['toString'])).toBe('Not available: toString');
    expect(one(['constructor'])).toBe('Not available: constructor');
  });

  it('shows unknown codes as they are (fallbacks may contain the code)', () => {
    expect(one(['zzz_new:abc', 'zzz_new:abd'])).toBe('2 frames not used (reason code “zzz_new”).');
    expect(refusalShortLabel('zzz_new')).toBe('reason code “zzz_new”');
    expect(one(['spectrum:new_thing'])).toBe('Not available: spectrum:new_thing');
    expect(one(['cutouts:deferred:x'])).toBe('Not available: cutouts:deferred:x');
  });

  it('uses typographic apostrophes', () => {
    for (const reason of FRAME_REASONS) expect(one([`${reason}:a`])).not.toContain("'");
  });
});

describe('spectrum empty state', () => {
  const name = 'Test star';

  it('saturated in every frame (with the backend flag)', () => {
    const o = summarizeSpectrum([], [...many('saturated', 5), 'spectrum:saturated']);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: this tool could not measure any of the 5 frames found, because in every one the detector flagged the object’s centre as saturated or unusable.',
    );
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: the detector flagged the object’s centre as saturated or unusable in all 5 frames.',
    );
  });

  it('a single saturated frame', () => {
    const o = summarizeSpectrum([], ['saturated:a']);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: this tool could not measure the only frame found, because the detector flagged the object’s centre as saturated or unusable.',
    );
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: the detector flagged the object’s centre as saturated or unusable in its only frame.',
    );
  });

  it('never says "every one" when an unlisted frame was refused for another reason', () => {
    const o = summarizeSpectrum(
      [],
      [...many('saturated', 5), 'outside_cutout:z', 'spectrum:saturated'],
    );
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: this tool could not measure any of the 6 frames found. In 5 of them, the detector flagged the object’s centre as saturated or unusable; the reason for the other frame is below.',
    );
  });

  it('saturated is the largest group', () => {
    const o = summarizeSpectrum([], [...many('saturated', 530), ...many('aperture_edge', 7)]);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: this tool could not measure any of the 537 frames found. In 530 of them, the detector flagged the object’s centre as saturated or unusable; the reasons for the other 7 frames are below.',
    );
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: the detector flagged the object’s centre as saturated or unusable in 530 of 537 frames.',
    );
  });

  it('the announcement names saturation only when it covers most frames', () => {
    const o = summarizeSpectrum(
      [],
      [...many('saturated', 4), ...many('aperture_edge', 3), ...many('background', 3)],
    );
    expect(o.largestReason).toBe('saturated');
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: none of the 10 frames could be measured.',
    );
  });

  it('other refusals', () => {
    const o = summarizeSpectrum([], [...many('aperture_edge', 3), 'saturated:a']);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: this tool could not measure any of the 4 frames found. The reasons are below.',
    );
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: none of the 4 frames could be measured.',
    );
  });

  it('a single frame refused for another reason', () => {
    const o = summarizeSpectrum([], ['aperture_edge:a']);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: this tool could not measure the only frame found. The reason is below.',
    );
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: its only frame could not be measured.',
    );
  });

  it('no frames at all', () => {
    const o = summarizeSpectrum([], ['spectrum:moving_object_search']);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: no frames of this object were available to measure.',
    );
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: no frames were available to measure.',
    );
  });

  it('no frames, more not checked yet', () => {
    const o = summarizeSpectrum([], ['cutouts:deferred:3']);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: no frames of this object were available to measure. More frames have not been checked yet.',
    );
  });

  it('says when more frames were not checked yet (deferred or truncated)', () => {
    const o = summarizeSpectrum([], [...many('saturated', 4), 'cutouts:deferred:9']);
    expect(spectrumEmptyMessage(o)).toBe(
      'There is no spectrum: this tool could not measure any of the 4 frames checked so far, because in every one the detector flagged the object’s centre as saturated or unusable. More frames have not been checked yet.',
    );
    expect(spectrumAnnouncement(o, name)).toBe(
      'No spectrum for Test star: the detector flagged the object’s centre as saturated or unusable in all 4 frames checked so far. More frames have not been checked yet.',
    );
    const one1 = summarizeSpectrum([], ['saturated:a', 'frames:truncated']);
    expect(spectrumEmptyMessage(one1)).toContain('the only frame checked so far');
    expect(spectrumAnnouncement(one1, name)).toContain('in its only frame checked so far.');
    const mixed = summarizeSpectrum([], [...many('aperture_edge', 2), 'frames:truncated']);
    expect(spectrumAnnouncement(mixed, name)).toBe(
      'No spectrum for Test star: none of the 2 frames could be measured. More frames have not been checked yet.',
    );
  });
});

describe('spectrum coverage and announcement', () => {
  const pt = (wl: number, flagged = false) => ({
    wavelength_um: wl,
    flux: 1,
    error: 0.1,
    flagged,
    frame_id: `p${wl}`,
  });
  const fr = (wl: number) => ({
    frame_id: `f${wl}`,
    time: '2025-05-03T00:00:00Z',
    wavelength_um: wl,
    x: 1,
    y: 1,
    cutout_url: '/c.png',
    flags: [],
  });

  // Evenly spaced measured wavelengths, no large gap.
  const dense = (lo: number, hi: number, n: number) =>
    Array.from({ length: n }, (_, i) => pt(Number((lo + ((hi - lo) * i) / (n - 1)).toFixed(3))));

  it('partial: where the points lie against the frames span', () => {
    const o = summarizeSpectrum(
      dense(0.74, 1.09, 5),
      [...many('saturated', 3)],
      [fr(0.75), fr(4.98)],
    );
    expect(spectrumCoverageMessage(o)).toBe(
      'This tool could measure 5 of the 8 frames found. The measured points lie between 0.740 µm and 1.090 µm; the frames found span 0.750 µm to 4.980 µm.',
    );
    expect(spectrumAnnouncement(o, 'X')).toBe(
      'Spectrum loaded: 5 points, 0 flagged, 0.740 µm to 1.090 µm. 3 frames not measured.',
    );
  });

  it('leaves out the frames span when it is about the measured range', () => {
    const o = summarizeSpectrum(
      dense(0.75, 4.98, 30),
      [...many('aperture_flags', 2)],
      [fr(0.75), fr(4.98)],
    );
    expect(spectrumCoverageMessage(o)).toBe(
      'This tool could measure 30 of the 32 frames found. The measured points lie between 0.750 µm and 4.980 µm.',
    );
    // Within 5 % of the frames' span: not worth a second range.
    const near = summarizeSpectrum(
      dense(0.76, 4.9, 30),
      ['aperture_flags:a'],
      [fr(0.75), fr(4.98)],
    );
    expect(spectrumCoverageMessage(near)).toBe(
      'This tool could measure 30 of the 31 frames found. The measured points lie between 0.760 µm and 4.900 µm.',
    );
  });

  it('names a large gap between measured points (more than 5 % of the frames span)', () => {
    const points = [...dense(0.75, 1.5, 10), ...dense(4.0, 4.98, 10)];
    const o = summarizeSpectrum(points, [...many('saturated', 5)], [fr(0.75), fr(4.98)]);
    expect(o.largestGap).toEqual([1.5, 4.0]);
    expect(spectrumCoverageMessage(o)).toBe(
      'This tool could measure 20 of the 25 frames found. The measured points lie between 0.750 µm and 4.980 µm, with none from 1.500 µm to 4.000 µm.',
    );
    // A gap of 0.2 µm in a 4.23 µm span (4.7 %) is not named.
    const small = summarizeSpectrum(
      [...dense(0.75, 2.0, 20), ...dense(2.2, 4.98, 40)],
      ['saturated:a'],
      [fr(0.75), fr(4.98)],
    );
    expect(spectrumCoverageMessage(small)).not.toContain('with none from');
  });

  it('a single measured point: "at", never "1.000 µm to 1.000 µm"', () => {
    const o = summarizeSpectrum([pt(1)], ['saturated:a', 'cutouts:deferred:2'], [fr(1)]);
    expect(spectrumCoverageMessage(o)).toBe(
      'This tool could measure 1 of the 2 frames checked so far, at 1.000 µm. More frames have not been checked yet.',
    );
    expect(spectrumAnnouncement(o, 'X')).toBe(
      'Spectrum loaded: 1 point, 0 flagged, at 1.000 µm. 1 frame not measured. More frames have not been checked yet.',
    );
    const wide = summarizeSpectrum([pt(1)], ['saturated:a', 'saturated:b'], [fr(0.75), fr(4.98)]);
    expect(spectrumCoverageMessage(wide)).toBe(
      'This tool could measure 1 of the 3 frames found, at 1.000 µm; the frames found span 0.750 µm to 4.980 µm.',
    );
    const two = summarizeSpectrum([pt(1), { ...pt(1), frame_id: 'q' }], ['saturated:a'], [fr(1)]);
    expect(spectrumCoverageMessage(two)).toBe(
      'This tool could measure 2 of the 3 frames found, all at 1.000 µm.',
    );
  });

  it('full: the announcement is unchanged', () => {
    const o = summarizeSpectrum([pt(1, true), pt(2)], []);
    expect(spectrumAnnouncement(o, 'X')).toBe('Spectrum loaded: 2 points, 1 flagged.');
  });
});

describe('motion refusals (R3.4 dynamics)', () => {
  it('names a refused rate in plain words, without the key', () => {
    const line = describeRefusal({ id: 'dynamics:spin_period_h', reason: 'backend' });
    expect(line).toBe('Spin (motion): not animated. No measured or typical value is known for it.');
    expect(line).not.toContain('dynamics:');
    expect(layerName('dynamics:flare_rate_per_d')).toBe('Flares (motion)');
  });

  it('keeps the layer wording for other backend refusals', () => {
    expect(describeRefusal({ id: 'mesh', reason: 'backend' })).toBe(
      'Shape model: not drawn. The data pipeline left it out.',
    );
  });
});
