// Compile-time proof (checked by `npm run typecheck`) that the hand-written generic TV<T> equals
// each generated variant and that every generated tagged value fits assertTagged.
import { describe, expectTypeOf, it } from 'vitest';
import { AREA_VERDICTS } from '@/contract';
import type {
  AreaDot,
  AreaMatch,
  AreaPlantedDot,
  AreaSed,
  AreaSkybotAnswer,
  AreaTag,
  AreaTrack,
  AreaVerdict,
  IRMode,
  ObjectCard,
  Tag,
  Tagged,
  TV,
  TVNumber,
  TVPair,
  TVRgb,
  TVString,
  TVVec3,
  VisibleMode,
} from '@/contract';

describe('TV<T> and the generated variants', () => {
  it('are the same types', () => {
    expectTypeOf<TV>().toEqualTypeOf<TVNumber>();
    expectTypeOf<TV<number>>().toEqualTypeOf<TVNumber>();
    expectTypeOf<TV<string>>().toEqualTypeOf<TVString>();
    expectTypeOf<TV<[number, number, number]>>().toEqualTypeOf<TVRgb>();
    expectTypeOf<TV<[number, number, number]>>().toEqualTypeOf<TVVec3>();
    expectTypeOf<TV<[number, number]>>().toEqualTypeOf<TVPair>();
  });

  it('fit the card fields and assertTagged', () => {
    expectTypeOf<ObjectCard['albedo']>().toEqualTypeOf<TV | undefined>();
    expectTypeOf<ObjectCard['gaia_rgb']>().toEqualTypeOf<
      TV<[number, number, number]> | undefined
    >();
    expectTypeOf<VisibleMode['rgb']>().toEqualTypeOf<TV<[number, number, number]> | null>();
    expectTypeOf<IRMode>().toEqualTypeOf<VisibleMode>();
    expectTypeOf<TVRgb>().toExtend<Tagged>();
  });
});

describe('the Area search types (A17.8)', () => {
  it('keep the area tags inside the card tags, with nothing artistic', () => {
    expectTypeOf<AreaTag>().toExtend<Tag>();
    expectTypeOf<'artistic'>().not.toExtend<AreaTag>();
    expectTypeOf<'inferred_from_analog'>().not.toExtend<AreaTag>();
  });

  it('give a planted dot the fields of a dot minus its id and label', () => {
    expectTypeOf<AreaPlantedDot>().toEqualTypeOf<Omit<AreaDot, 'dot_id' | 'label'>>();
  });

  it('type the enum lists and the nullable fields', () => {
    expectTypeOf(AREA_VERDICTS).toEqualTypeOf<readonly AreaVerdict[]>();
    expectTypeOf<AreaTrack['match']>().toEqualTypeOf<AreaMatch | null>();
    expectTypeOf<AreaTrack['sed']>().toEqualTypeOf<AreaSed | undefined>();
    expectTypeOf<AreaSkybotAnswer['fetched_at']>().toEqualTypeOf<string | null>();
  });
});
