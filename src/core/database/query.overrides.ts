import { Query } from 'cypher-query-builder';
import { Except } from 'type-fest';
import { LogLevel } from '../logger';

/* eslint-disable @typescript-eslint/method-signature-style -- this is enforced
   to treat functions arguments as contravariant instead of bivariant. this
   doesn't matter here as this class won't be overridden. Declaring them as
   methods keeps their color the same as the rest of the query methods. */

// Work around `Dictionary` return type
export type QueryWithResult<R> = Except<Query, 'run' | 'first'> & {
  run: () => Promise<R[]>;
  first: () => Promise<R | undefined>;
};

declare module 'cypher-query-builder/dist/typings/query' {
  interface Query {
    /**
     * Apply custom query modifications while maintaining the fluent chain.
     *
     * @deprecated Use {@link apply}() instead.
     *
     * In the future this could be changed to utilize native neo4j call logic.
     */
    call<A extends any[], R extends this | QueryWithResult<any> | void>(
      fn: (query: this, ...args: A) => R,
      ...args: A
    ): R extends void ? this : R;

    /**
     * Apply custom query modifications while maintaining the fluent chain.
     *
     * Note: Unlike call() this does not have varargs that forward to the given
     * function. This not necessary as helpers can just be written as higher-order
     * functions, see second example. It also made generics on the function
     * impossible to be applied.
     *
     * @example Using an if condition
     * await this.db.query()
     *   .raw(`
     *     ...
     *   `)
     *   .apply(q => {
     *     if (addTheThing) {
     *       q.raw('...');
     *     }
     *   })
     *   .first();
     *
     * @example Abstracting a query fragment with args
     * const matchFoo = (label: string) => (query: Query) =>
     *   query.matchNode('', label, ...)...
     *
     * db.query().apply(matchFoo('Movie'));
     */
    apply<R extends this | QueryWithResult<any> | void>(
      fn: (query: this) => R
    ): R extends void ? this : R;

    /**
     * Defines the result type of the query.
     * Only useful for TypeScript.
     * Must be called directly before run()/first().
     */
    asResult<R>(): QueryWithResult<R>;

    logIt(level?: LogLevel): this;
  }
}

Query.prototype.call = function call<
  A extends any[],
  R extends Query | QueryWithResult<any> | void
>(
  this: Query,
  fn: (q: Query, ...args: A) => R,
  ...args: A
): R extends void ? Query : R {
  return (fn(this, ...args) || this) as Exclude<R, void>;
};

Query.prototype.apply = function apply<
  R extends Query | QueryWithResult<any> | void
>(fn: (q: Query) => R): R extends void ? Query : R {
  return (fn(this) || this) as Exclude<R, void>;
};

Query.prototype.asResult = function asResult<R>(this: Query) {
  return (this as unknown) as QueryWithResult<R>;
};

Query.prototype.logIt = function logIt(this: Query, level = LogLevel.NOTICE) {
  const orig = this.buildQueryObject.bind(this);
  this.buildQueryObject = function buildQueryObject() {
    const result = orig();
    Object.defineProperty(result.params, 'logIt', {
      value: level,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    return result;
  };

  return this;
};
