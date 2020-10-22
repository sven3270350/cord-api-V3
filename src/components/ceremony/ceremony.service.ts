import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { node, relation } from 'cypher-query-builder';
import {
  generateId,
  InputException,
  ISession,
  NotFoundException,
  ServerException,
  UnauthenticatedException,
} from '../../common';
import {
  ConfigService,
  createBaseNode,
  DatabaseService,
  ILogger,
  Logger,
  matchRequestingUser,
  matchSession,
  Property,
} from '../../core';
import {
  calculateTotalAndPaginateList,
  defaultSorter,
  matchPermList,
  matchPropList,
  permissionsOfNode,
  requestingUser,
} from '../../core/database/query';
import {
  DbPropsOfDto,
  parseBaseNodeProperties,
  parsePropList,
  parseSecuredProperties,
  runListQuery,
  StandardReadResult,
} from '../../core/database/results';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  Ceremony,
  CeremonyListInput,
  CeremonyListOutput,
  CreateCeremony,
  UpdateCeremony,
} from './dto';
import { DbCeremony } from './model';

@Injectable()
export class CeremonyService {
  private readonly securedProperties = {
    type: true,
    planned: true,
    estimatedDate: true,
    actualDate: true,
  };

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService,
    @Logger('ceremony:service') private readonly logger: ILogger
  ) {}

  async create(input: CreateCeremony, session: ISession): Promise<Ceremony> {
    const secureProps: Property[] = [
      {
        key: 'type',
        value: input.type,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'planned',
        value: input.planned,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'estimatedDate',
        value: input.estimatedDate,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'actualDate',
        value: input.actualDate,
        isPublic: false,
        isOrgPublic: false,
      },
    ];

    try {
      const query = this.db
        .query()
        .call(matchRequestingUser, session)
        .call(createBaseNode, await generateId(), 'Ceremony', secureProps)
        .return('node.id as id');

      const result = await query.first();

      if (!result) {
        throw new ServerException('failed to create a budget');
      }

      const dbCeremony = new DbCeremony();
      await this.authorizationService.processNewBaseNode(
        dbCeremony,
        result.id,
        session.userId as string
      );

      return await this.readOne(result.id, session);
    } catch (exception) {
      this.logger.warning('Failed to create ceremony', {
        exception,
      });

      throw exception;
    }
  }

  async readOne(id: string, session: ISession): Promise<Ceremony> {
    this.logger.debug(`Query readOne Ceremony`, { id, userId: session.userId });
    if (!id) {
      throw new InputException('No ceremony id to search for', 'ceremony.id');
    }
    const readCeremony = this.db
      .query()
      .call(matchRequestingUser, session)
      .match([node('node', 'Ceremony', { id })])
      .call(matchPermList)
      .call(matchPropList, 'permList')
      .return('node, permList, propList')
      .asResult<StandardReadResult<DbPropsOfDto<Ceremony>>>();

    const result = await readCeremony.first();

    if (!result) {
      throw new NotFoundException('Could not find ceremony', 'ceremony.id');
    }

    const parsedProps = parsePropList(result.propList);
    const securedProps = parseSecuredProperties(
      parsedProps,
      result.permList,
      this.securedProperties
    );

    return {
      ...parseBaseNodeProperties(result.node),
      ...securedProps,
      type: parsedProps.type,
    };
  }

  async update(input: UpdateCeremony, session: ISession): Promise<Ceremony> {
    if (!session.userId) {
      throw new UnauthenticatedException('user not logged in');
    }
    const object = await this.readOne(input.id, session);

    return await this.db.sgUpdateProperties({
      session,
      object,
      props: ['planned', 'estimatedDate', 'actualDate'],
      changes: input,
      nodevar: 'ceremony',
    });
  }

  async delete(id: string, session: ISession): Promise<void> {
    const object = await this.readOne(id, session);

    if (!object) {
      throw new NotFoundException('Could not find ceremony', 'ceremony.id');
    }

    try {
      await this.db.deleteNode({
        session,
        object,
        aclEditProp: 'canDeleteOwnUser',
      });
    } catch (exception) {
      this.logger.warning('Failed to delete ceremony', {
        exception,
      });
      throw exception;
    }
  }

  async list(
    { filter, ...input }: CeremonyListInput,
    session: ISession
  ): Promise<CeremonyListOutput> {
    const label = 'Ceremony';
    const query = this.db
      .query()
      .match([
        requestingUser(session),
        ...permissionsOfNode(label),
        ...(filter.type
          ? [
              relation('out', '', 'type', { active: true }),
              node('name', 'Property', { value: filter.type }),
            ]
          : []),
      ])
      .call(
        calculateTotalAndPaginateList,
        input,
        this.securedProperties,
        defaultSorter
      );

    return await runListQuery(query, input, (id) => this.readOne(id, session));
  }

  async checkCeremonyConsistency(session: ISession): Promise<boolean> {
    const ceremonies = await this.db
      .query()
      .match([matchSession(session), [node('ceremony', 'Ceremony')]])
      .return('ceremony.id as id')
      .run();

    return (
      await Promise.all(
        ceremonies.map(async (ceremony) => {
          return await this.db.hasProperties({
            session,
            id: ceremony.id,
            props: ['type'],
            nodevar: 'ceremony',
          });
        })
      )
    ).every((n) => n);
  }
}
