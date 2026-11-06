// R3.1 Tagged value (rendering doc), D-02 provenance tags. The types are generated (D-18).
// JSON Schema has no generics, so the schema has one definition per payload; TV<T> is the generic
// view of them. It is built from TVNumber, and typeParity.test.ts proves it equals each generated
// variant, so it cannot drift from the schema.
import type { TVNumber } from './generated';

export type { Tag } from './generated';
export { TAGS } from './generated';

export type TV<T = number> = {
  [K in keyof TVNumber]: K extends 'value' ? T | null : TVNumber[K];
};
