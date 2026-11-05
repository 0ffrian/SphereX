// Compile-time proof (checked by `npm run typecheck`) that the hand-written generic TV<T> equals
// each generated variant and that every generated tagged value fits assertTagged.
import { describe, expectTypeOf, it } from 'vitest';
import type {
  IRMode,
  ObjectCard,
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
