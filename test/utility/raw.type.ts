import { DateTime } from 'luxon';

export type Raw<T> = T extends DateTime
  ? string
  : T extends Array<infer U>
  ? ReadonlyArray<Raw<U>>
  : T extends object
  ? { readonly [K in keyof T]: Raw<T[K]> }
  : T;
