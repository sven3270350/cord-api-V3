import { Injectable } from '@nestjs/common';
import { node } from 'cypher-query-builder';
import { ISession, NotFoundException, ServerException } from '../../../common';
import {
  ConfigService,
  createBaseNode,
  DatabaseService,
  ILogger,
  Logger,
  matchRequestingUser,
  matchSession,
} from '../../../core';
import {
  CreateUnavailability,
  Unavailability,
  UnavailabilityListInput,
  UnavailabilityListOutput,
  UpdateUnavailability,
} from './dto';

@Injectable()
export class UnavailabilityService {
  constructor(
    @Logger('unavailability:service') private readonly logger: ILogger,
    private readonly db: DatabaseService,
    private readonly config: ConfigService
  ) {}

  async create(
    { userId, ...input }: CreateUnavailability,
    session: ISession
  ): Promise<Unavailability> {
    const secureProps = [
      {
        key: 'description',
        value: input.description,
        addToAdminSg: true,
        addToWriterSg: true,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'start',
        value: input.start,
        addToAdminSg: true,
        addToWriterSg: true,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'end',
        value: input.end,
        addToAdminSg: true,
        addToWriterSg: true,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
    ];

    try {
      const createUnavailability = this.db
        .query()
        .call(matchRequestingUser, session)
        .match([
          node('root', 'User', {
            id: this.config.rootAdmin.id,
          }),
        ])
        .call(
          createBaseNode,
          'Unavailability',
          secureProps,
          {},
          [],
          session.userId === this.config.rootAdmin.id
        )
        .return('node.id as id')
        .asResult<{ id: string }>();

      const createUnavailabilityResult = await createUnavailability.first();

      if (!createUnavailabilityResult) {
        this.logger.error(`Could not create unavailability`, {
          userId,
        });
        throw new ServerException('Could not create unavailability');
      }

      this.logger.debug(`Created user unavailability`, {
        id: createUnavailabilityResult.id,
        userId,
      });

      // connect the Unavailability to the User.

      const query = `
        MATCH (user: User {id: $userId}),
        (unavailability:Unavailability {id: $id})
        CREATE (user)-[:unavailability {active: true, createdAt: datetime()}]->(unavailability)
        RETURN  unavailability.id as id
        `;
      await this.db
        .query()
        .raw(query, {
          userId,
          id: createUnavailabilityResult.id,
        })
        .run();

      return await this.readOne(createUnavailabilityResult.id, session);
    } catch {
      this.logger.error(`Could not create unavailability`, {
        userId,
      });
      throw new ServerException('Could not create unavailability');
    }
  }

  async readOne(id: string, session: ISession): Promise<Unavailability> {
    const result = await this.db
      .query()
      .raw(
        `
        MATCH
        (token:Token {
          active: true,
          value: $token
        })
          <-[:token {active: true}]-
        (requestingUser:User {
          
          id: $requestingUserId
        }),
        (unavailability:Unavailability { id: $id})
        WITH * OPTIONAL MATCH (requestingUser)<-[:member]-(acl1:ACL {canReadDescription: true})-[:toNode]->(unavailability)-[:description {active: true}]->(description:Property )
        WITH * OPTIONAL MATCH (requestingUser)<-[:member]-(acl2:ACL {canEditDescription: true})-[:toNode]->(unavailability)
        WITH * OPTIONAL MATCH (requestingUser)<-[:member]-(acl3:ACL {canReadStart: true})-[:toNode]->(unavailability)-[:start {active: true}]->(start:Property )
        WITH * OPTIONAL MATCH (requestingUser)<-[:member]-(acl4:ACL {canEditStart: true})-[:toNode]->(unavailability)
        WITH * OPTIONAL MATCH (requestingUser)<-[:member]-(acl5:ACL {canReadEnd: true})-[:toNode]->(unavailability)-[:end {active: true}]->(end:Property )
        WITH * OPTIONAL MATCH (requestingUser)<-[:member]-(acl6:ACL {canEditEnd: true})-[:toNode]->(unavailability)
        RETURN
          unavailability.id as id,
          unavailability.createdAt as createdAt,
          description.value as description,
          acl1.canReadDescription as canReadDescription,
          acl2.canEditDescription as canEditDescription,
          start.value as start,
          acl3.canReadStart as canReadStart,
          acl4.canEditStart as canEditStart,
          end.value as end,
          acl5.canReadEnd as canReadEnd,
          acl6.canEditEnd as canEditEnd
        `,
        {
          token: session.token,
          requestingUserId: session.userId,

          id,
        }
      )
      .first();
    if (!result) {
      throw new NotFoundException(
        'Could not find unavailability',
        'unavailability.id'
      );
    }

    return {
      id,
      createdAt: result.createdAt,
      description: {
        value: result.description,
        canRead:
          result.canReadDescription !== null
            ? result.canReadDescription
            : false,
        canEdit:
          result.canEditDescription !== null
            ? result.canEditDescription
            : false,
      },
      start: {
        value: result.start,
        canRead: result.canReadStart !== null ? result.canReadStart : false,
        canEdit: result.canEditStart !== null ? result.canEditStart : false,
      },
      end: {
        value: result.end,
        canRead: result.canReadEnd !== null ? result.canReadEnd : false,
        canEdit: result.canEditEnd !== null ? result.canEditEnd : false,
      },
    };
  }

  async update(
    input: UpdateUnavailability,
    session: ISession
  ): Promise<Unavailability> {
    const unavailability = await this.readOne(input.id, session);

    return await this.db.sgUpdateProperties({
      session,
      object: unavailability,
      props: ['description', 'start', 'end'],
      changes: input,
      nodevar: 'unavailability',
    });
  }

  async delete(id: string, session: ISession): Promise<void> {
    this.logger.debug(`mutation delete unavailability`);
    const ua = await this.readOne(id, session);
    if (!ua) {
      throw new NotFoundException(
        'Unavailability not found',
        'unavailability.id'
      );
    }
    await this.db.deleteNode({
      session,
      object: ua,
      aclEditProp: 'canDeleteOwnUser',
    });
  }

  async list(
    { page, count, sort, order, filter }: UnavailabilityListInput,
    session: ISession
  ): Promise<UnavailabilityListOutput> {
    const result = await this.db.list<Unavailability>({
      session,
      nodevar: 'unavailability',
      aclReadProp: 'canReadUnavailabilityList',
      aclEditProp: 'canCreateUnavailability',
      props: ['description', 'start', 'end'],
      input: {
        page,
        count,
        sort,
        order,
        filter,
      },
    });

    return {
      items: result.items,
      hasMore: result.hasMore,
      total: result.total,
    };
  }
  async checkUnavailabilityConsistency(session: ISession): Promise<boolean> {
    const unavailabilities = await this.db
      .query()
      .match([
        matchSession(session),
        [node('unavailability', 'Unavailability')],
      ])
      .return('unavailability.id as id')
      .run();

    return (
      (
        await Promise.all(
          unavailabilities.map(async (unavailability) => {
            return await this.db.hasProperties({
              session,
              id: unavailability.id,
              props: ['description', 'start', 'end'],
              nodevar: 'unavailability',
            });
          })
        )
      ).every((n) => n) &&
      (
        await Promise.all(
          unavailabilities.map(async (unavailability) => {
            return await this.db.isUniqueProperties({
              session,
              id: unavailability.id,
              props: ['description', 'start', 'end'],
              nodevar: 'unavailability',
            });
          })
        )
      ).every((n) => n)
    );
  }
}
