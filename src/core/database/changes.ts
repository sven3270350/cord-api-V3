import { difference, isEmpty, omit, pickBy } from 'lodash';
import { DateTime } from 'luxon';
import { ConditionalKeys } from 'type-fest';
import {
  ID,
  Resource,
  ResourceShape,
  Secured,
  unwrapSecured,
  UnwrapSecured,
} from '../../common';
import { CreateDefinedFileVersionInput, FileId } from '../../components/file';
import { NativeDbValue } from './results';

/**
 * Specify this on a property to override the key & value type for ChangesOf on
 * the object.
 *
 * @example
 * class Foo {
 *   color: string & SetChangeType<'hexColor', number>
 * }
 * const changes: ChangesOf<Foo> = {
 *   hexColor: 0xFFFFFF,
 * };
 */
export interface SetChangeType<Key, Value> {
  // eslint-disable-next-line @typescript-eslint/naming-convention -- shush we are hiding this. It's only for TS types.
  __update_type__?: { key: Key; value: Value };
}

export type ChangesOf<T extends { id: string }> = {
  [Key in keyof T & string as ChangeKey<
    Exclude<Key, keyof Resource>,
    T
  >]?: ChangeOf<T[Key]>;
} & {
  // allow id to be passed in and removed from changes as it's what we are doing
  // all over the app.
  id?: ID;
};

type ChangeKey<
  Key extends keyof T & string,
  T extends { id: string }
> = T[Key] extends SetChangeType<infer Override, any>
  ? Override extends string
    ? Override
    : never
  : UnwrapSecured<T[Key]> extends FileId
  ? Key
  : UnwrapSecured<T[Key]> extends ID
  ? `${Key}Id` // our convention for relationships
  : Key;

type ChangeOf<Val> = Val extends SetChangeType<any, infer Override>
  ? Override
  : UnwrapSecured<Val> extends FileId
  ? CreateDefinedFileVersionInput
  : UnwrapSecured<Val>;

/**
 * Only props of T that can be written directly to DB
 */
export type DbChanges<T> = DbAllowableChanges<T> &
  Partial<Record<Exclude<keyof T, keyof DbAllowableChanges<T>>, never>>;

type DbAllowableChanges<T> = {
  [K in Exclude<
    ConditionalKeys<Required<T>, NativeDbValue | Secured<NativeDbValue>>,
    keyof Resource
  >]?: UnwrapSecured<T[K]>;
};

/**
 * Given the existing object and proposed changes, return only the changes
 * that are actually different from the current values.
 *
 * Note that while ID properties to change a relationship can be passed in they
 * are assumed to always be different.
 */
export function getChanges<
  TResourceStatic extends ResourceShape<any>,
  TResource extends TResourceStatic['prototype'],
  Changes extends ChangesOf<TResource>
>(
  resource: TResourceStatic,
  existingObject: TResource,
  changes: Changes &
    // Ensure there are no extra props not in ChangesOf<TResource>
    // This is needed because changes is a generic.
    // It's a generic to ensure that if only a subset of the changes
    // are passed in we don't declare the return type having those omitted
    // properties.
    Record<Exclude<keyof Changes, keyof ChangesOf<TResource>>, never>
): Partial<Omit<Changes, keyof Resource>> {
  return pickBy(omit(changes, Resource.Props), (change, prop) => {
    const key = isRelation(prop, existingObject) ? prop.slice(0, -2) : prop;
    const existing = unwrapSecured(existingObject[key]);
    return !isSame(change, existing);
  }) as any;
}

/**
 * If prop ends with `Id` and existing object has `x` instead of `xId`, assume
 * it is a relation and the current value is the ID of the relation.
 * This is our convention in order to lazily hydrate them.
 */
export const isRelation = (prop: string, existingObject: Record<string, any>) =>
  !(prop in existingObject) &&
  prop.endsWith('Id') &&
  prop.slice(0, -2) in existingObject;

const isSame = (a: unknown, b: unknown) => {
  if (a == null && b == null) {
    return true;
  }
  if ((a == null && b) || (a && b == null)) {
    return false;
  }
  if (DateTime.isDateTime(a) || DateTime.isDateTime(b)) {
    return +(a as number) === +(b as number);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return isEmpty(difference(a, b)) && isEmpty(difference(b, a));
  }
  return a === b;
};
