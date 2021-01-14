import { FactoryProvider } from '@nestjs/common/interfaces';
import { AsyncLocalStorage } from 'async_hooks';
import { stripIndent } from 'common-tags';
import { Connection } from 'cypher-query-builder';
import { Session, Transaction } from 'neo4j-driver';
import QueryRunner from 'neo4j-driver/types/query-runner';
import { Merge } from 'type-fest';
import { ConfigService } from '..';
import { jestSkipFileInExceptionSource } from '../jest-skip-source-file';
import { ILogger, LoggerToken, LogLevel } from '../logger';
import { createBetterError, isNeo4jError } from './errors';
import { ParameterTransformer } from './parameter-transformer.service';
import { MyTransformer } from './transformer';
import './transaction'; // import our transaction augmentation
import './query.overrides'; // import our query augmentation

export type PatchedConnection = Merge<
  Connection,
  {
    transactionStorage: AsyncLocalStorage<Transaction>;
    logger: ILogger;
    transformer: MyTransformer;
  }
>;

export const CypherFactory: FactoryProvider<Connection> = {
  provide: Connection,
  useFactory: (
    config: ConfigService,
    parameterTransformer: ParameterTransformer,
    logger: ILogger,
    driverLogger: ILogger
  ) => {
    const { url, username, password, driverConfig } = config.neo4j;
    // @ts-expect-error yes we are patching the connection object
    const conn: PatchedConnection = new Connection(
      url,
      { username, password },
      {
        driverConfig: {
          ...driverConfig,
          logging: {
            level: 'debug', // log everything, we'll filter out in our logger
            logger: (neoLevel, message) => {
              const level =
                neoLevel === 'warn' ? LogLevel.WARNING : (neoLevel as LogLevel);
              driverLogger.log(level, message);
            },
          },
        },
      }
    );

    // Holder for the current transaction using native async storage context.
    conn.transactionStorage = new AsyncLocalStorage();

    // Wrap session call to apply:
    // - transparent transaction handling
    // - query logging
    // - parameter transformation
    // - error transformation
    const origSession = conn.session.bind(conn);
    conn.session = function (this: PatchedConnection) {
      const currentTransaction = this.transactionStorage.getStore();
      if (currentTransaction) {
        // Fake a "session", which is really only used as a QueryRunner,
        // in order to forward methods to the current transaction.
        // @ts-expect-error yes we are only supporting these two methods
        const txSession: Session = {
          run: wrapQueryRun(currentTransaction, logger, parameterTransformer),
          close: async () => {
            // No need to close anything when finishing the query inside of the
            // transaction. The close will happen when the transaction work finishes.
          },
        };
        return txSession;
      }

      const session: Session | null = origSession();
      if (!session) {
        return null;
      }

      session.run = wrapQueryRun(session, logger, parameterTransformer);

      return session;
    };

    // Also tear down transaction storage on close.
    const origClose = conn.close.bind(conn);
    conn.close = async () => {
      await origClose();
      conn.transactionStorage.disable();
    };

    // inject logger so transactions can use it
    conn.logger = logger;

    // Replace transformer with our own
    conn.transformer = new MyTransformer();

    // @ts-expect-error yes we are patching it back
    return conn as Connection;
  },
  inject: [
    ConfigService,
    ParameterTransformer,
    LoggerToken('database:query'),
    LoggerToken('database:driver'),
  ],
};

const wrapQueryRun = (
  runner: QueryRunner,
  logger: ILogger,
  parameterTransformer: ParameterTransformer
): QueryRunner['run'] => {
  const origRun = runner.run.bind(runner);
  return (origStatement, parameters) => {
    const statement = stripIndent(origStatement.slice(0, -1)) + ';';
    logger.log(
      (parameters?.logIt as LogLevel | undefined) ?? LogLevel.DEBUG,
      'Executing query',
      {
        statement,
        ...parameters,
      }
    );

    const params = parameters
      ? parameterTransformer.transform(parameters)
      : undefined;
    const result = origRun(statement, params);

    const origSubscribe = result.subscribe.bind(result);
    result.subscribe = function (this: never, observer) {
      const onError = observer.onError?.bind(observer);
      observer.onError = (e) => {
        const patched = jestSkipFileInExceptionSource(e, __filename);
        const mapped = createBetterError(patched);
        if (isNeo4jError(mapped) && mapped.logProps) {
          logger.log(mapped.logProps);
        }
        onError?.(mapped);
      };
      origSubscribe(observer);
    };

    return result;
  };
};
