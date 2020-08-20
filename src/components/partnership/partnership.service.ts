import {
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException as ServerException,
} from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { RelationDirection } from 'cypher-query-builder/dist/typings/clauses/relation-pattern';
import { upperFirst } from 'lodash';
import { DateTime } from 'luxon';
import { InputException, ISession, NotFoundException } from '../../common';
import {
  addAllMetaPropertiesOfChildBaseNodes,
  addAllSecureProperties,
  addBaseNodeMetaPropsWithClause,
  ChildBaseNodeMetaProperty,
  ConfigService,
  createBaseNode,
  DatabaseService,
  getPermList,
  getPropList,
  IEventBus,
  ILogger,
  listWithSecureObject,
  Logger,
  matchRequestingUser,
  matchSession,
  matchUserPermissions,
  runListQuery,
} from '../../core';
import {
  DbPropsOfDto,
  parseBaseNodeProperties,
  parseSecuredProperties,
  StandardReadResult,
} from '../../core/database/results';
import { BudgetService } from '../budget';
import { FileService } from '../file';
import { OrganizationService } from '../organization';
import { ProjectService } from '../project/project.service';
import {
  CreatePartnership,
  Partnership,
  PartnershipFundingType,
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
    @Inject(forwardRef(() => ProjectService))
    private readonly projectService: ProjectService,
    private readonly eventBus: IEventBus,
    @Logger('partnership:service') private readonly logger: ILogger
  ) {}

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
        node('node'),
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
        node('node'),
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

    this.verifyFundingType(input.fundingType, input.types);

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

    const secureProps = [
      {
        key: 'agreementStatus',
        value: input.agreementStatus,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'agreement',
        value: agreement,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mou',
        value: mou,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mouStatus',
        value: input.mouStatus,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mouStartOverride',
        value: input.mouStartOverride,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mouEndOverride',
        value: input.mouEndOverride,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'types',
        value: input.types,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'fundingType',
        value: input.fundingType,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
    ];
    let result;
    try {
      const createPartnership = this.db
        .query()
        .call(matchRequestingUser, session)
        .match([
          node('root', 'User', {
            active: true,
            id: this.config.rootAdmin.id,
          }),
        ])
        .call(
          createBaseNode,
          'Partnership',
          secureProps,
          {
            owningOrgId: session.owningOrgId,
          },
          [],
          session.userId === this.config.rootAdmin.id
        )
        .create([...this.permission('organization')])
        .return('node.id as id');

      try {
        result = await createPartnership.first();
      } catch (e) {
        this.logger.error('e :>> ', e);
      }

      if (!result) {
        throw new ServerException('failed to create partnership');
      }

      // connect the Organization to the Partnership
      // and connect Partnership to Project
      await this.db
        .query()
        .match([
          [
            node('organization', 'Organization', {
              id: organizationId,
              active: true,
            }),
          ],
          [
            node('partnership', 'Partnership', {
              id: result.id,
              active: true,
            }),
          ],
          [node('project', 'Project', { id: projectId, active: true })],
        ])
        .create([
          node('project'),
          relation('out', '', 'partnership', { active: true, createdAt }),
          node('partnership'),
          relation('out', '', 'organization', { active: true, createdAt }),
          node('organization'),
        ])
        .return('partnership.id as id')
        .first();

      const partnership = await this.readOne(result.id, session);

      await this.eventBus.publish(
        new PartnershipCreatedEvent(partnership, session)
      );

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

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .match([node('node', 'Partnership', { active: true, id })])
      .call(getPermList, 'requestingUser')
      .call(getPropList, 'permList')
      .match([
        node('node'),
        relation('in', '', 'partnership'),
        node('project', 'Project', { active: true }),
      ])
      .match([
        node('node'),
        relation('out', '', 'organization'),
        node('organization', 'Organization', { active: true }),
      ])
      .return(
        'propList, permList, node, project.id as projectId, organization.id as organizationId'
      )
      .asResult<
        StandardReadResult<DbPropsOfDto<Partnership>> & {
          projectId: string;
          organizationId: string;
        }
      >();

    const result = await query.first();

    if (!result) {
      throw new NotFoundException('could not find Partnership');
    }

    const readProject = await this.projectService.readOne(
      result.projectId,
      session
    );

    const securedProps = parseSecuredProperties(
      result.propList,
      result.permList,
      {
        agreementStatus: true,
        mouStatus: true,
        mouStart: true,
        mouEnd: true,
        mouStartOverride: true,
        mouEndOverride: true,
        types: true,
        fundingType: true,
        mou: true,
        agreement: true,
      }
    );
    const canReadMouStart =
      readProject.mouStart.canRead && securedProps.mouStartOverride.canRead;
    const canReadMouEnd =
      readProject.mouEnd.canRead && securedProps.mouEndOverride.canRead;

    const mouStart =
      (canReadMouStart && securedProps.mouStartOverride.value) || null;
    const mouEnd = (canReadMouEnd && securedProps.mouEndOverride.value) || null;

    return {
      ...parseBaseNodeProperties(result.node),
      ...securedProps,
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
      types: {
        ...securedProps.types,
        value: securedProps.types.value || [],
      },
      organization: result.organizationId,
    };
  }

  async update(input: UpdatePartnership, session: ISession) {
    // mou start and end are now computed fields and do not get updated directly
    const object = await this.readOne(input.id, session);
    let changes = input;
    if (
      !this.validateFundingType(
        input.fundingType ?? object.fundingType.value,
        input.types ?? object.types.value
      )
    ) {
      if (input.fundingType && input.types) {
        throw new InputException(
          'Funding type can only be applied to managing partners',
          'partnership.fundingType'
        );
      }
      changes = {
        ...input,
        fundingType: null,
      };
    }

    const { mou, agreement, ...rest } = changes;
    await this.db.sgUpdateProperties({
      session,
      object,
      props: [
        'agreementStatus',
        'mouStatus',
        'types',
        'fundingType',
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
      'fundingType',
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
            return await this.db.hasProperties({
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
            return await this.db.isUniqueProperties({
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

  protected verifyFundingType(
    fundingType: PartnershipFundingType | null | undefined,
    types: PartnershipType[] | undefined
  ) {
    if (!this.validateFundingType(fundingType, types)) {
      throw new InputException(
        'Funding type can only be applied to managing partners',
        'partnership.fundingType'
      );
    }
  }

  protected validateFundingType(
    fundingType: PartnershipFundingType | null | undefined,
    types: PartnershipType[] | undefined
  ) {
    return fundingType && !types?.includes(PartnershipType.Managing)
      ? false
      : true;
  }
}
