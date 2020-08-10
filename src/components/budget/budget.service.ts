import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException as ServerException,
} from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { upperFirst } from 'lodash';
import { DateTime } from 'luxon';
import { ISession, Order } from '../../common';
import {
  addAllSecureProperties,
  addBaseNodeMetaPropsWithClause,
  ConfigService,
  createBaseNode,
  DatabaseService,
  ILogger,
  listWithSecureObject,
  Logger,
  matchRequestingUser,
  matchSession,
  matchUserPermissions,
  Property,
  runListQuery,
} from '../../core';
import {
  Budget,
  BudgetListInput,
  BudgetListOutput,
  BudgetRecord,
  BudgetRecordListInput,
  BudgetRecordListOutput,
  BudgetStatus,
  CreateBudget,
  CreateBudgetRecord,
  UpdateBudget,
  UpdateBudgetRecord,
} from './dto';

@Injectable()
export class BudgetService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Logger('budget:service') private readonly logger: ILogger
  ) {}

  // helper method for defining properties
  property = (prop: string, value: any, baseNode: string) => {
    if (!value) {
      return [];
    }
    const createdAt = DateTime.local();
    return [
      [
        node(baseNode),
        relation('out', '', prop, {
          active: true,
          createdAt,
        }),
        node(prop, 'Property', {
          active: true,
          value,
        }),
      ],
    ];
  };

  // helper method for defining permissions
  permission = (property: string, baseNode: string) => {
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
        node(baseNode),
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
        node(baseNode),
      ],
    ];
  };

  propMatch = (query: Query, property: string, baseNode: string) => {
    const readPerm = 'canRead' + upperFirst(property);
    const editPerm = 'canEdit' + upperFirst(property);
    query.optionalMatch([
      [
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('g', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node(editPerm, 'Permission', {
          property,
          active: true,
          edit: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node(baseNode),
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
        node(baseNode),
        relation('out', '', property, { active: true }),
        node(property, 'Property', { active: true }),
      ],
    ]);
  };

  async create(
    { projectId }: CreateBudget,
    session: ISession
  ): Promise<Budget> {
    this.logger.info('Creating budget', { projectId });

    const readProject = this.db
      .query()
      .match(matchSession(session, { withAclRead: 'canReadProjects' }))
      .match([node('project', 'Project', { active: true, id: projectId })]);
    readProject.return({
      project: [{ id: 'id', createdAt: 'createdAt' }],
      requestingUser: [
        {
          canReadProjects: 'canReadProjects',
          canCreateProject: 'canCreateProject',
        },
      ],
    });

    const result = await readProject.first();
    if (!result) {
      throw new NotFoundException('project does not exist');
    }

    const secureProps: Property[] = [
      {
        key: 'status',
        value: BudgetStatus.Pending,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
        label: 'BudgetStatus',
      },
    ];

    try {
      const createBudget = this.db
        .query()
        .call(matchRequestingUser, session)
        .match([
          node('root', 'User', {
            active: true,
            id: this.config.rootAdmin.id,
          }),
        ])
        .call(createBaseNode, 'Budget', secureProps, {
          owningOrgId: session.owningOrgId,
        })
        .return('node.id as id');

      const result = await createBudget.first();

      if (!result) {
        throw new ServerException('failed to create a budget');
      }

      // connect budget to project
      await this.db
        .query()
        .matchNode('project', 'Project', { id: projectId, active: true })
        .matchNode('budget', 'Budget', { id: result.id, active: true })
        .create([
          node('project'),
          relation('out', '', 'budget', {
            active: true,
            createdAt: DateTime.local().toString(),
          }),
          node('budget'),
        ])
        .run();

      this.logger.info(`Created Budget`, {
        id: result.id,
        userId: session.userId,
      });

      return await this.readOne(result.id, session);
    } catch (e) {
      this.logger.error(`Could not create budget`, {
        userId: session.userId,
        exception: e,
      });
      throw new ServerException('Could not create budget');
    }
  }

  async createRecord(
    { budgetId, organizationId, ...input }: CreateBudgetRecord,
    session: ISession
  ): Promise<BudgetRecord> {
    if (!input.fiscalYear || !organizationId) {
      throw new BadRequestException();
    }

    this.logger.info('Creating BudgetRecord', input);
    // on Init, create a budget will create a budget record for each org and each fiscal year in the project input.projectId
    const createdAt = DateTime.local();

    const secureProps: Property[] = [
      {
        key: 'fiscalYear',
        value: input.fiscalYear,
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'amount',
        value: '0',
        addToAdminSg: true,
        addToWriterSg: false,
        addToReaderSg: true,
        isPublic: false,
        isOrgPublic: false,
      },
    ];

    try {
      const createBudgetRecord = this.db
        .query()
        .call(matchRequestingUser, session)
        .match([
          node('root', 'User', {
            active: true,
            id: this.config.rootAdmin.id,
          }),
        ]);
      createBudgetRecord.call(createBaseNode, 'BudgetRecord', secureProps, {
        owningOrgId: session.owningOrgId,
      });
      createBudgetRecord
        .create([...this.permission('organization', 'node')])
        .return('node.id as id');

      const result = await createBudgetRecord.first();

      if (!result) {
        throw new ServerException('failed to create a budget record');
      }

      this.logger.info(`Created Budget Record`, {
        id: result.id,
        userId: session.userId,
      });

      // connect to budget
      const query = this.db
        .query()
        .match([node('budget', 'Budget', { id: budgetId, active: true })])
        .match([node('br', 'BudgetRecord', { id: result.id, active: true })])
        .create([
          node('budget'),
          relation('out', '', 'record', { active: true, createdAt }),
          node('br'),
        ])
        .return('br');
      await query.first();

      // connect budget record to org
      const orgQuery = this.db
        .query()
        .match([
          node('organization', 'Organization', {
            id: organizationId,
            active: true,
          }),
        ])
        .match([node('br', 'BudgetRecord', { id: result.id, active: true })])
        .create([
          node('br'),
          relation('out', '', 'organization', { active: true, createdAt }),
          node('organization'),
        ])
        .return('br');
      await orgQuery.first();

      const bugetRecord = await this.readOneRecord(result.id, session);

      return bugetRecord;
    } catch (exception) {
      this.logger.error(`Could not create Budget Record`, {
        userId: session.userId,
        exception,
      });
      throw new ServerException('Could not create Budget Record');
    }
  }

  async readOne(id: string, session: ISession): Promise<Budget> {
    this.logger.info(`Query readOne Budget: `, {
      id,
      userId: session.userId,
    });

    const baseNodeMetaProps = ['id', 'createdAt', 'type'];
    const secureProps = ['status'];
    const readBudget = this.db
      .query()
      .call(matchRequestingUser, session)
      .call(matchUserPermissions, 'Budget', id)
      .call(addAllSecureProperties, ...secureProps)
      .return(
        `
          {
            ${addBaseNodeMetaPropsWithClause(baseNodeMetaProps)},
            ${listWithSecureObject(secureProps)}
          } as budget
        `
      );

    let result;
    try {
      result = await readBudget.first();
    } catch (e) {
      this.logger.error('e :>> ', e);
    }

    if (!result) {
      throw new NotFoundException('Could not find budget');
    }

    const records = await this.listRecords(
      {
        sort: 'fiscalYear',
        order: Order.ASC,
        page: 1,
        count: 25,
        filter: { budgetId: id },
      },
      session
    );

    return {
      id,
      createdAt: result.budget.createdAt,
      status: result.budget.status.canRead
        ? result.budget.status.value
        : undefined,
      records: records.items,
    };
  }

  async readOneRecord(id: string, session: ISession): Promise<BudgetRecord> {
    this.logger.info(`Query readOne Budget Record: `, {
      id,
      userId: session.userId,
    });

    const baseNodeMetaProps = ['id', 'createdAt'];
    const secureProps = ['amount', 'fiscalYear'];
    const readQuery = this.db
      .query()
      .call(matchRequestingUser, session)
      .call(matchUserPermissions, 'BudgetRecord', id)
      .call(addAllSecureProperties, ...secureProps);
    readQuery.optionalMatch([
      node('requestingUser'),
      relation('in', '', 'member', { active: true }),
      node('', 'SecurityGroup', { active: true }),
      relation('out', '', 'permission', { active: true }),
      node('canEditOrganization', 'Permission', {
        property: 'organization',
        active: true,
        edit: true,
      }),
      relation('out', '', 'baseNode', { active: true }),
      node('node'),
      relation('out', '', 'organization', { active: true }),
      node('organization', 'Organization', { active: true }),
      relation('out', '', 'name', { active: true }),
      node('organizationName', 'Property', { active: true }),
    ]);
    readQuery
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('canReadOrganization', 'Permission', {
          property: 'organization',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('node'),
        relation('out', '', 'organization', { active: true }),
        node('organization', 'Organization', { active: true }),
        relation('out', '', 'name', { active: true }),
        node('organizationName', 'Property', { active: true }),
      ])
      .return(
        `
          {
            ${addBaseNodeMetaPropsWithClause(baseNodeMetaProps)},
            ${listWithSecureObject(secureProps)},
            organizationId: organization.id,
            organizationCreatedAt: organization.createdAt,
            organizationName: organizationName.value,
            canReadOrganization: canReadOrganization.read,
            canEditOrganization: canEditOrganization.edit
          } as budgetRecord
        `
      );

    let result;
    try {
      result = await readQuery.first();
    } catch (e) {
      this.logger.error('e :>> ', e);
    }

    if (!result) {
      this.logger.error(`Could not find budgetRecord:  `, {
        id,
        userId: session.userId,
      });
      throw new NotFoundException('Could not find budgetRecord');
    }

    return {
      id,
      createdAt: result.budgetRecord.createdAt,
      organizationId: {
        value: result.budgetRecord.organizationId,
        canRead: !!result.budgetRecord.canReadOrganization,
        canEdit: !!result.budgetRecord.canEditOrganization,
      },
      fiscalYear: result.budgetRecord.fiscalYear,
      amount: result.budgetRecord.amount,
    };
  }

  async update(input: UpdateBudget, session: ISession): Promise<Budget> {
    const budget = await this.readOne(input.id, session);

    return this.db.sgUpdateProperties({
      session,
      object: budget,
      props: ['status'],
      changes: input,
      nodevar: 'budget',
    });
  }

  async updateRecord(
    { id, ...input }: UpdateBudgetRecord,
    session: ISession
  ): Promise<BudgetRecord> {
    this.logger.info('Update budget Record, ', { id, userId: session.userId });

    // 574 - Budget records are only editable if the budget is pending
    // Get budget status
    const budgetStatusQuery = this.db
      .query()
      .match(matchSession(session, { withAclRead: 'canReadBudgets' }))
      .match([
        node('budgetRecord', 'BudgetRecord', { active: true, id }),
        relation('in', '', 'record', {
          active: true,
        }),
        node('budget', 'Budget', { active: true }),
        relation('out', '', 'status', { active: true }),
        node('status', 'Property', { active: true }),
      ]);
    budgetStatusQuery.return([
      {
        budget: [{ id: 'id' }],
        status: [{ value: 'status' }],
      },
    ]);

    const readBudget = await budgetStatusQuery.first();
    if (!readBudget?.status.includes(BudgetStatus.Pending)) {
      throw new BadRequestException('budget records can not be modified');
    }

    const br = await this.readOneRecord(id, session);

    try {
      const result = await this.db.sgUpdateProperties({
        session,
        object: br,
        props: ['amount'],
        changes: { id, ...input },
        nodevar: 'budgetRecord',
      });
      return result;
    } catch (e) {
      this.logger.error('Could not update budget Record ', {
        id,
        userId: session.userId,
      });
      throw e;
    }
  }

  async delete(id: string, session: ISession): Promise<void> {
    const budget = await this.readOne(id, session);

    // cascade delete each budget record in this budget
    await Promise.all(
      budget.records.map((br) => this.deleteRecord(br.id, session))
    );
    await this.db.deleteNode({
      session,
      object: budget,
      aclEditProp: 'canCreateBudget',
    });
  }

  async deleteRecord(id: string, session: ISession): Promise<void> {
    const br = await this.readOneRecord(id, session);
    await this.db.deleteNode({
      session,
      object: br,
      aclEditProp: 'canCreateBudget',
    });
  }

  async list(
    input: Partial<BudgetListInput>,
    session: ISession
  ): Promise<BudgetListOutput> {
    const { sort, filter } = {
      ...BudgetListInput.defaultVal,
      ...input,
    };

    const { projectId } = filter;
    this.logger.info('Listing budgets on projectId ', {
      projectId,
      userId: session.userId,
    });
    const secureProps = ['status'];

    const query = this.db.query().call(matchRequestingUser, session);
    if (projectId) {
      query.match([
        node('project', 'Project', {
          id: projectId,
          active: true,
          owningOrgId: session.owningOrgId,
        }),
        relation('out', '', 'budget'),
        node('node', 'Budget', { active: true }),
      ]);
    } else {
      query.match([node('node', 'Budget', { active: true })]);
    }
    this.propMatch(query, 'status', 'node');

    const listResult: {
      items: Array<{
        identity: string;
        labels: string[];
        properties: Budget;
      }>;
      hasMore: boolean;
      total: number;
    } = await runListQuery(
      query,
      {
        ...BudgetListInput.defaultVal,
        ...input,
      },
      secureProps.includes(sort)
    );

    const items = await Promise.all(
      listResult.items.map((item) => {
        return this.readOne(item.properties.id, session);
      })
    );

    return {
      items,
      hasMore: listResult.hasMore,
      total: listResult.total,
    };
  }

  async listRecords(
    { filter, ...input }: BudgetRecordListInput,
    session: ISession
  ): Promise<BudgetRecordListOutput> {
    const { budgetId } = filter;
    this.logger.info('Listing budget records on budgetId ', {
      budgetId,
      userId: session.userId,
    });

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .match([
        node('budget', 'Budget', {
          id: budgetId,
          active: true,
          owningOrgId: session.owningOrgId,
        }),
        relation('out', '', 'record'),
        node('node', 'BudgetRecord', { active: true }),
      ]);

    const listResult: {
      items: Array<{
        identity: string;
        labels: string[];
        properties: BudgetRecord;
      }>;
      hasMore: boolean;
      total: number;
    } = await runListQuery(query, input);

    const items = await Promise.all(
      listResult.items.map((item) => {
        return this.readOneRecord(item.properties.id, session);
      })
    );

    return {
      items,
      hasMore: listResult.hasMore,
      total: listResult.total,
    };
  }

  async checkBudgetConsistency(session: ISession): Promise<boolean> {
    const budgets = await this.db
      .query()
      .match([
        matchSession(session),
        [
          node('budget', 'Budget', {
            active: true,
          }),
        ],
      ])
      .return('budget.id as id')
      .run();

    return (
      (
        await Promise.all(
          budgets.map(async (budget) => {
            return this.db.hasProperties({
              session,
              id: budget.id,
              props: ['status'],
              nodevar: 'budget',
            });
          })
        )
      ).every((n) => n) &&
      (
        await Promise.all(
          budgets.map(async (budget) => {
            return this.db.isUniqueProperties({
              session,
              id: budget.id,
              props: ['status'],
              nodevar: 'budget',
            });
          })
        )
      ).every((n) => n)
    );
  }
}
