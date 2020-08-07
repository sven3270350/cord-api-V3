import {
  Injectable,
  InternalServerErrorException as ServerException,
} from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { RelationDirection } from 'cypher-query-builder/dist/typings/clauses/relation-pattern';
import { flatMap, upperFirst } from 'lodash';
import { DateTime } from 'luxon';
import { generate } from 'shortid';
import { fiscalYears, ISession, NotFoundException } from '../../common';
import {
  addAllMetaPropertiesOfChildBaseNodes,
  addAllSecureProperties,
  addBaseNodeMetaPropsWithClause,
  addPropertyCoalesceWithClause,
  addShapeForBaseNodeMetaProperty,
  addShapeForChildBaseNodeMetaProperty,
  ChildBaseNodeMetaProperty,
  ConfigService,
  DatabaseService,
  IEventBus,
  ILogger,
  listWithSecureObject,
  Logger,
  matchRequestingUser,
  matchSession,
  matchUserPermissions,
  runListQuery,
} from '../../core';
import { BudgetService } from '../budget';
import { FileService } from '../file';
import { OrganizationService } from '../organization';
import { ProjectService } from '../project/project.service';
import {
  CreatePartnership,
  Partnership,
  PartnershipListInput,
  PartnershipListOutput,
  PartnershipType,
  UpdatePartnership,
} from './dto';
import {
  PartnershipCreatedEvent,
  PartnershipDeletedEvent,
  PartnershipUpdatedEvent,
} from './events';

@Injectable()
export class PartnershipService {
  constructor(
    private readonly files: FileService,
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly budgetService: BudgetService,
    private readonly orgService: OrganizationService,
    private readonly projectService: ProjectService,
    private readonly eventBus: IEventBus,
    @Logger('partnership:service') private readonly logger: ILogger
  ) {}

  // helper method for defining properties
  property = (prop: string, value: any) => {
    if (!value) {
      value = null;
    }
    const createdAt = DateTime.local();
    const propLabel = 'Property';
    return [
      [
        node('newPartnership'),
        relation('out', '', prop, {
          active: true,
          createdAt,
        }),
        node(prop, propLabel, {
          active: true,
          value,
        }),
      ],
    ];
  };

  // helper method for defining properties
  permission = (property: string) => {
    const createdAt = DateTime.local();
    return [
      [
        node('adminSG'),
        relation('out', '', 'permission', {
          active: true,
          createdAt,
        }),
        node('', 'Permission', {
          property,
          active: true,
          read: true,
          edit: true,
          admin: true,
        }),
        relation('out', '', 'baseNode', {
          active: true,
          createdAt,
        }),
        node('newPartnership'),
      ],
      [
        node('readerSG'),
        relation('out', '', 'permission', {
          active: true,
          createdAt,
        }),
        node('', 'Permission', {
          property,
          active: true,
          read: true,
          edit: false,
          admin: false,
        }),
        relation('out', '', 'baseNode', {
          active: true,
          createdAt,
        }),
        node('newPartnership'),
      ],
    ];
  };

  propMatch = (query: Query, property: string) => {
    const readPerm = 'canRead' + upperFirst(property);
    const editPerm = 'canEdit' + upperFirst(property);
    query.optionalMatch([
      [
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node(editPerm, 'Permission', {
          property,
          active: true,
          edit: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('partnership'),
        relation('out', '', property, { active: true }),
        node(property, 'Property', { active: true }),
      ],
    ]);
    query.optionalMatch([
      [
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node(readPerm, 'Permission', {
          property,
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('partnership'),
        relation('out', '', property, { active: true }),
        node(property, 'Property', { active: true }),
      ],
    ]);
  };

  async create(
    { organizationId, projectId, ...input }: CreatePartnership,
    session: ISession
  ): Promise<Partnership> {
    const id = generate();
    const createdAt = DateTime.local();

    try {
      await this.orgService.readOne(organizationId, session);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e.withField('partnership.organizationId');
      }
      throw e;
    }

    try {
      await this.projectService.readOne(projectId, session);
    } catch (e) {
      if (e instanceof NotFoundException) {
        throw e.withField('partnership.projectId');
      }
      throw e;
    }

    const mou = await this.files.createDefinedFile(
      `MOU`,
      session,
      input.mou,
      'partnership.mou'
    );
    const agreement = await this.files.createDefinedFile(
      `Partner Agreement`,
      session,
      input.agreement,
      'partnership.agreement'
    );

    try {
      const createPartnership = this.db
        .query()
        .match(matchSession(session, { withAclEdit: 'canCreatePartnership' }))
        .match([
          node('rootuser', 'User', {
            active: true,
            id: this.config.rootAdmin.id,
          }),
        ])
        .create([
          [
            node('newPartnership', ['Partnership', 'BaseNode'], {
              active: true,
              createdAt,
              id,
              owningOrgId: session.owningOrgId,
            }),
          ],
          ...this.property('agreementStatus', input.agreementStatus),
          ...this.property('agreement', agreement),
          ...this.property('mou', mou),
          ...this.property('mouStatus', input.mouStatus),
          ...this.property('mouStartOverride', input.mouStartOverride),
          ...this.property('mouEndOverride', input.mouEndOverride),
          ...this.property('types', input.types),
          [
            node('adminSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: `partnership ${id} admin`,
            }),
            relation('out', '', 'member', { active: true, createdAt }),
            node('requestingUser'),
          ],
          [
            node('readerSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: `partnership ${id} users`,
            }),
            relation('out', '', 'member', { active: true, createdAt }),
            node('requestingUser'),
          ],
          [
            node('adminSG'),
            relation('out', '', 'member', { active: true, createdAt }),
            node('rootuser'),
          ],
          [
            node('readerSG'),
            relation('out', '', 'member', { active: true, createdAt }),
            node('rootuser'),
          ],
          ...this.permission('agreementStatus'),
          ...this.permission('mouStatus'),
          ...this.permission('types'),
          ...this.permission('organization'),
          ...this.permission('mouStartOverride'),
          ...this.permission('mouEndOverride'),
          ...this.permission('mou'),
          ...this.permission('agreement'),
        ])
        .return('newPartnership.id as id');

      try {
        await createPartnership.first();
      } catch (e) {
        this.logger.error('e :>> ', e);
      }

      // connect the Organization to the Partnership
      // and connect Partnership to Project
      const query = `
        MATCH (organization:Organization {id: $organizationId, active: true}),
          (partnership:Partnership {id: $id, active: true}),
          (project:Project {id: $projectId, active: true})
        CREATE (project)-[:partnership {active: true, createdAt: datetime()}]->(partnership)
                  -[:organization {active: true, createdAt: datetime()}]->(organization)
        RETURN partnership.id as id
      `;
      await this.db
        .query()
        .raw(query, {
          organizationId,
          id,
          projectId,
        })
        .first();

      const partnership = await this.readOne(id, session);

      if (!input.types) {
        return partnership;
      }

      await this.eventBus.publish(
        new PartnershipCreatedEvent(partnership, session)
      );

      // TODO move to event handler
      const fiscalRange = fiscalYears(
        partnership.mouStart.value,
        partnership.mouEnd.value
      ); // calculate the fiscalYears covered by this date range
      if (
        input.types?.includes(PartnershipType.Funding) &&
        fiscalRange.length > 0
      ) {
        const budget = await this.budgetService.create({ projectId }, session);

        const inputRecords = flatMap(fiscalRange, (fiscalYear) => ({
          budgetId: budget.id,
          organizationId,
          fiscalYear,
        }));

        await Promise.all(
          inputRecords.map((record) =>
            this.budgetService.createRecord(record, session)
          )
        );
      }

      return partnership;
    } catch (e) {
      this.logger.warning('Failed to create partnership', {
        exception: e,
      });

      throw new ServerException('Failed to create partnership');
    }
  }

  async readOne(id: string, session: ISession): Promise<Partnership> {
    this.logger.debug('readOne', { id, userId: session.userId });

    if (!session.userId) {
      this.logger.info('using anon user id');
      session.userId = this.config.anonUser.id;
    }

    const props = [
      'agreementStatus',
      'mouStatus',
      'mouStart',
      'mouEnd',
      'mouStartOverride',
      'mouEndOverride',
      'types',
      'mou',
      'agreement',
    ];

    const baseNodeMetaProps = ['id', 'createdAt'];

    const childBaseNodeMetaProps: ChildBaseNodeMetaProperty[] = [
      {
        parentBaseNodePropertyKey: 'organization',
        parentRelationDirection: 'out',
        childBaseNodeLabel: 'Organization',
        childBaseNodeMetaPropertyKey: 'id',
        returnIdentifier: 'organizationId',
      },
    ];

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .call(matchUserPermissions, 'Partnership', id)
      .call(addAllSecureProperties, ...props)
      .call(addAllMetaPropertiesOfChildBaseNodes, ...childBaseNodeMetaProps)
      .with([
        ...props.map(addPropertyCoalesceWithClause),
        ...childBaseNodeMetaProps.map(addShapeForChildBaseNodeMetaProperty),
        ...baseNodeMetaProps.map(addShapeForBaseNodeMetaProperty),
        'node',
      ])
      .returnDistinct([
        ...props,
        ...baseNodeMetaProps,
        ...childBaseNodeMetaProps.map((x) => x.returnIdentifier),
        'labels(node) as labels',
      ]);

    let result;
    try {
      result = await query.first();
    } catch (error) {
      this.logger.error('could not read partnership', error);
    }
    if (!result || !result.id) {
      throw new NotFoundException('could not find Partnership');
    }

    //Get Projects mapped with the Partnership
    const projectQuery = this.db
      .query()
      .match(matchSession(session, { withAclRead: 'canReadPartnerships' }))
      .match([
        node('partnership', 'Partnership', { active: true, id }),
        relation('in', '', 'partnership', { active: true }),
        node('project', 'Project', {
          active: true,
        }),
      ]);
    projectQuery.return({
      project: [{ id: 'id' }],
    });

    const getProject = await projectQuery.first();

    const readProject = await this.projectService.readOne(
      getProject?.id,
      session
    );

    let mouStart = null;
    let mouEnd = null;

    // if user has access to project mou and there is no partnership override
    if (readProject.mouStart.canRead && result.mouStartOverride.canRead) {
      mouStart = result.mouStartOverride.value ?? readProject.mouStart.value;
    }
    if (readProject.mouEnd.canRead && result.mouEndOverride.canRead) {
      mouEnd = result.mouEndOverride.value ?? readProject.mouEnd.value;
    }

    const canReadMouStart =
      readProject.mouStart.canRead && result.mouStartOverride.canRead;
    const canReadMouEnd =
      readProject.mouEnd.canRead && result.mouEndOverride.canRead;

    const response: any = {
      ...result,
      types: {
        value: result.types.value ? result.types.value : [],
        canRead: !!result.types.canRead,
        canEdit: !!result.types.canEdit,
      },
      mouStart: {
        value: mouStart,
        canRead: canReadMouStart,
        canEdit: false, // edit the project mou or edit the partnerhsip mou override
      },
      mouEnd: {
        value: mouEnd,
        canRead: canReadMouEnd,
        canEdit: false, // edit the project mou or edit the partnerhsip mou override
      },
      organization: this.orgService.readOne(result.organizationId, session),
    };

    return (response as unknown) as Partnership;
  }

  async update(input: UpdatePartnership, session: ISession) {
    // mou start and end are now computed fields and do not get updated directly
    const object = await this.readOne(input.id, session);

    const { mou, agreement, ...rest } = input;
    await this.db.sgUpdateProperties({
      session,
      object,
      props: [
        'agreementStatus',
        'mouStatus',
        'types',
        'mouStartOverride',
        'mouEndOverride',
      ],
      changes: rest,
      nodevar: 'partnership',
    });
    await this.files.updateDefinedFile(
      object.mou,
      'partnership.mou',
      mou,
      session
    );
    await this.files.updateDefinedFile(
      object.agreement,
      'partnership.agreement',
      agreement,
      session
    );

    const partnership = await this.readOne(input.id, session);
    await this.eventBus.publish(
      new PartnershipUpdatedEvent(partnership, input, session)
    );
    return partnership;
  }

  async delete(id: string, session: ISession): Promise<void> {
    const object = await this.readOne(id, session);

    if (!object) {
      throw new NotFoundException('Could not find partnership');
    }

    try {
      await this.db.deleteNode({
        session,
        object,
        aclEditProp: 'canDeleteOwnUser',
      });
    } catch (e) {
      this.logger.warning('Failed to delete partnership', {
        exception: e,
      });

      throw new ServerException('Failed to delete partnership');
    }

    await this.eventBus.publish(new PartnershipDeletedEvent(object, session));
  }

  async list(
    input: Partial<PartnershipListInput>,
    session: ISession
  ): Promise<PartnershipListOutput> {
    const { sort, filter } = {
      ...PartnershipListInput.defaultVal,
      ...input,
    };

    const label = 'Partnership';
    const baseNodeMetaProps = ['id', 'createdAt'];
    // const unsecureProps = [''];
    const secureProps = [
      'agreementStatus',
      'mouStatus',
      'mouStart',
      'mouEnd',
      'mouStartOverride',
      'mouEndOverride',
      'types',
      'mou',
      'agreement',
    ];

    const childBaseNodeMetaProps: ChildBaseNodeMetaProperty[] = [
      {
        parentBaseNodePropertyKey: 'organization',
        parentRelationDirection: 'out',
        childBaseNodeLabel: 'Organization',
        childBaseNodeMetaPropertyKey: 'id',
        returnIdentifier: 'organizationId',
      },
    ];

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .call(matchUserPermissions, 'Partnership');

    if (filter.projectId) {
      this.filterByProject(
        query,
        filter.projectId,
        'partnership',
        'out',
        label
      );
    }

    // match on the rest of the properties of the object requested
    query
      .call(
        addAllSecureProperties,
        ...secureProps
        //...unsecureProps
      )
      .call(addAllMetaPropertiesOfChildBaseNodes, ...childBaseNodeMetaProps)
      // form return object
      // ${listWithUnsecureObject(unsecureProps)}, // removed from a few lines down
      .with(
        `
          {
            ${addBaseNodeMetaPropsWithClause(baseNodeMetaProps)},
            ${listWithSecureObject(secureProps)},
            ${childBaseNodeMetaProps
              .map(
                (x) =>
                  `${x.returnIdentifier}: ${x.parentBaseNodePropertyKey}.${x.childBaseNodeMetaPropertyKey}`
              )
              .join(', ')}
          } as node
        `
      );

    const result: PartnershipListOutput = await runListQuery(
      query,
      input as PartnershipListInput,
      secureProps.includes(sort)
    );
    const items = await Promise.all(
      result.items.map(async (item) => {
        const resultOne = await this.readOne(item.id, session);

        return {
          ...item,
          types: {
            value: item.types.value ? item.types.value : [],
            canRead: !!item.types.canRead,
            canEdit: !!item.types.canEdit,
          },
          mouStart: {
            value: resultOne.mouStart.value,
            canRead: resultOne.mouStart.canRead,
            canEdit: false, // edit the project mou or edit the partnerhsip mou override
          },
          mouEnd: {
            value: resultOne.mouEnd.value,
            canRead: resultOne.mouEnd.canRead,
            canEdit: false, // edit the project mou or edit the partnerhsip mou override
          },
          organization: await this.orgService.readOne(
            (item as any).organizationId,
            session
          ),
        };
      })
    );

    return {
      items,
      hasMore: result.hasMore,
      total: result.total,
    };
  }

  async checkPartnershipConsistency(session: ISession): Promise<boolean> {
    const partnerships = await this.db
      .query()
      .match([
        matchSession(session),
        [
          node('partnership', 'Partnership', {
            active: true,
          }),
        ],
      ])
      .return('partnership.id as id')
      .run();

    return (
      (
        await Promise.all(
          partnerships.map(async (partnership) => {
            return this.db.hasProperties({
              session,
              id: partnership.id,
              props: [
                'agreementStatus',
                'mouStatus',
                'mouStart',
                'mouEnd',
                'types',
              ],
              nodevar: 'partnership',
            });
          })
        )
      ).every((n) => n) &&
      (
        await Promise.all(
          partnerships.map(async (partnership) => {
            return this.db.isUniqueProperties({
              session,
              id: partnership.id,
              props: [
                'agreementStatus',
                'mouStatus',
                'mouStart',
                'mouEnd',
                'types',
              ],
              nodevar: 'partnership',
            });
          })
        )
      ).every((n) => n)
    );
  }

  protected filterByProject(
    query: Query,
    projectId: string,
    relationshipType: string,
    relationshipDirection: RelationDirection,
    label: string
  ) {
    query.match([
      node('project', 'Project', { active: true, id: projectId }),
      relation(relationshipDirection, '', relationshipType, { active: true }),
      node('node', label, { active: true }),
    ]);
  }
}
