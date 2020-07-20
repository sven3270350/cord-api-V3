import {
  BadRequestException,
  Injectable,
  NotFoundException,
  InternalServerErrorException as ServerException,
} from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { upperFirst } from 'lodash';
import { DateTime } from 'luxon';
import { generate } from 'shortid';
import { ISession, Order } from '../../common';
import {
  addAllSecureProperties,
  ConfigService,
  DatabaseService,
  ILogger,
  Logger,
  matchSession,
  matchUserPermissions,
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

    const id = generate();
    const createdAt = DateTime.local();
    const status = BudgetStatus.Pending;

    try {
      const createBudget = this.db
        .query()
        .match(matchSession(session, { withAclEdit: 'canCreateBudget' }))
        .match([
          node('rootuser', 'User', {
            active: true,
            id: this.config.rootAdmin.id,
          }),
        ])
        .create([
          [
            node('budget', 'Budget:BaseNode', {
              active: true,
              createdAt,
              id,
              owningOrgId: session.owningOrgId,
            }),
          ],
          ...this.property('status', status, 'budget'),
          [
            node('adminSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: projectId + ' admin',
            }),
            relation('out', '', 'member', { active: true, createdAt }),
            node('requestingUser'),
          ],
          [
            node('readerSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: projectId + ' users',
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
          ...this.permission('status', 'budget'),
        ])
        .return('budget.id as id');

      await createBudget.first();

      // connect budget to project
      await this.db
        .query()
        .matchNode('project', 'Project', { id: projectId, active: true })
        .matchNode('budget', 'Budget', { id, active: true })
        .create([
          node('project'),
          relation('out', '', 'budget', {
            active: true,
            createdAt: DateTime.local(),
          }),
          node('budget'),
        ])
        .run();

      this.logger.info(`Created Budget`, {
        id,
        userId: session.userId,
      });
    } catch (e) {
      this.logger.error(`Could not create budget`, {
        id,
        userId: session.userId,
        exception: e,
      });
      throw new ServerException('Could not create budget');
    }

    return this.readOne(id, session);
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
    const id = generate();
    const createdAt = DateTime.local();

    try {
      const createBudgetRecord = this.db
        .query()
        .match(matchSession(session, { withAclEdit: 'canCreateBudget' }))
        .match([
          node('rootuser', 'User', {
            active: true,
            id: this.config.rootAdmin.id,
          }),
        ])
        .create([
          [
            node('budgetRecord', 'BudgetRecord:BaseNode', {
              active: true,
              createdAt,
              id,
              owningOrgId: session.owningOrgId,
            }),
          ],
          ...this.property('fiscalYear', input.fiscalYear, 'budgetRecord'),
          ...this.property('amount', '0', 'budgetRecord'),
          [
            node('adminSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: input.fiscalYear.toString() + ' admin',
            }),
            relation('out', '', 'member', { active: true, createdAt }),
            node('requestingUser'),
          ],
          [
            node('readerSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: input.fiscalYear.toString() + ' users',
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
          ...this.permission('fiscalYear', 'budgetRecord'),
          ...this.permission('amount', 'budgetRecord'),
          ...this.permission('organization', 'budgetRecord'),
        ])
        .return('budgetRecord.id as id');

      await createBudgetRecord.first();

      this.logger.info(`Created Budget Record`, {
        id,
        userId: session.userId,
      });

      // connect to budget
      const query = `
      MATCH
        (budget:Budget {id: $budgetId, active: true}),
        (br:BudgetRecord {id: $id, active: true})
      CREATE (budget)-[:record {active: true, createdAt: datetime()}]->(br)
    `;
      await this.db
        .query()
        .raw(query, {
          budgetId,
          id,
        })
        .first();

      // connect budget record to org
      const orgQuery = `
        MATCH
        (organization:Organization {id: $organizationId, active: true}),
        (br:BudgetRecord {id: $id, active: true})
      CREATE (br)-[:organization {active: true, createdAt: datetime()}]->(organization)
    `;
      await this.db
        .query()
        .raw(orgQuery, {
          organizationId,
          id,
        })
        .first();

      const result = await this.readOneRecord(id, session);

      return result;
    } catch (exception) {
      this.logger.error(`Could not create Budget Record`, {
        id,
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

    const props = ['status'];
    const readBudget = this.db
      .query()
      .match(matchSession(session, { withAclRead: 'canReadBudgets' }))
      .call(matchUserPermissions, 'Budget', id)
      .call(addAllSecureProperties, ...props);
    readBudget.return({
      node: [{ id: 'id', createdAt: 'createdAt' }],
      status: [{ value: 'status' }],
      statusReadPerm: [
        {
          read: 'canReadStatus',
        },
      ],
      statusEditPerm: [
        {
          edit: 'canEditStatus',
        },
      ],
    });

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
      id: result.id,
      createdAt: result.createdAt,
      status: result.canReadStatus ? result.status : undefined,
      records: records.items,
    };
  }

  async readOneRecord(id: string, session: ISession): Promise<BudgetRecord> {
    this.logger.info(`Query readOne Budget Record: `, {
      id,
      userId: session.userId,
    });

    const readBudgetRecord = this.db
      .query()
      .match(matchSession(session, { withAclRead: 'canReadBudgets' }))
      .match([node('budgetRecord', 'BudgetRecord', { active: true, id })]);
    this.propMatch(readBudgetRecord, 'amount', 'budgetRecord');
    this.propMatch(readBudgetRecord, 'fiscalYear', 'budgetRecord');
    readBudgetRecord.optionalMatch([
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
      node('budgetRecord'),
      relation('out', '', 'organization', { active: true }),
      node('organization', 'Organization', { active: true }),
      relation('out', '', 'name', { active: true }),
      node('organizationName', 'Property', { active: true }),
    ]);
    readBudgetRecord.optionalMatch([
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
      node('budgetRecord'),
      relation('out', '', 'organization', { active: true }),
      node('organization', 'Organization', { active: true }),
      relation('out', '', 'name', { active: true }),
      node('organizationName', 'Property', { active: true }),
    ]);
    readBudgetRecord.return({
      budgetRecord: [{ id: 'id', createdAt: 'createdAt' }],
      amount: [{ value: 'amount' }],
      canReadAmount: [{ read: 'canReadAmount' }],
      canEditAmount: [{ edit: 'canEditAmount' }],
      fiscalYear: [{ value: 'fiscalYear' }],
      canReadFiscalYear: [{ read: 'canReadFiscalYear' }],
      canEditFiscalYear: [{ edit: 'canEditFiscalYear' }],
      organization: [
        { id: 'organizationId', createdAt: 'organizationCreatedAt' },
      ],
      organizationName: [{ value: 'organizationName' }],
      canReadOrganization: [
        {
          read: 'canReadOrganization',
        },
      ],
      canEditOrganization: [
        {
          edit: 'canEditOrganization',
        },
      ],
    });

    let result;
    try {
      result = await readBudgetRecord.first();
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
      createdAt: result.createdAt,
      organizationId: {
        value: result.organizationId,
        canRead: !!result.canReadOrganization,
        canEdit: !!result.canEditOrganization,
      },
      fiscalYear: {
        value: result.fiscalYear,
        canRead: !!result.canReadFiscalYear,
        canEdit: !!result.canEditFiscalYear,
      },
      amount: {
        value: result.amount,
        canRead: !!result.canReadAmount,
        canEdit: !!result.canEditAmount,
      },
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
    const { page, count, sort, order, filter } = {
      ...BudgetListInput.defaultVal,
      ...input,
    };

    let result: {
      items: Budget[];
      hasMore: boolean;
      total: number;
    } = { items: [], hasMore: false, total: 0 };

    let listResult: {
      items: Array<{
        identity: string;
        labels: string[];
        properties: Budget;
      }>;
      hasMore: boolean;
      total: number;
    };

    let items = [];

    const { projectId } = filter;
    this.logger.info('Listing budgets on projectId ', {
      projectId,
      userId: session.userId,
    });
    const secureProps = ['status'];

    if (projectId) {
      const query = this.db
        .query()
        .match(matchSession(session))
        .match([
          node('project', 'Project', {
            id: projectId,
            active: true,
            owningOrgId: session.owningOrgId,
          }),
          relation('out', '', 'budget'),
          node('node', 'Budget', { active: true }),
        ]);
      this.propMatch(query, 'status', 'node');
      listResult = await runListQuery(
        query,
        {
          ...BudgetListInput.defaultVal,
          ...input,
        },
        secureProps.includes(sort)
      );

      items = await Promise.all(
        listResult.items.map((item) => {
          return this.readOne(item.properties.id, session);
        })
      );
    } else {
      result = await this.db.list<Budget>({
        session,
        nodevar: 'budget',
        aclReadProp: 'canReadBudgets',
        aclEditProp: 'canCreateBudget',
        props: [{ name: 'status', secure: false }],
        input: {
          page,
          count,
          sort,
          order,
          filter,
        },
      });

      items = await Promise.all(
        result.items.map(async (item) => {
          const records = await this.listRecords(
            {
              sort: 'fiscalYear',
              order: Order.ASC,
              page: 1,
              count: 75,
              filter: { budgetId: item.id },
            },
            session
          );
          return {
            ...item,
            records: records.items,
          };
        })
      );
    }

    return {
      items,
      hasMore: result.hasMore,
      total: result.total,
    };
  }

  async listRecords(
    { page, count, sort, order, filter }: BudgetRecordListInput,
    session: ISession
  ): Promise<BudgetRecordListOutput> {
    const { budgetId } = filter;
    this.logger.info('Listing budget records on budgetId ', {
      budgetId,
      userId: session.userId,
    });

    const query = `
      MATCH
        (token:Token {active: true, value: $token})
        <-[:token {active: true}]-
        (requestingUser:User {
          active: true,
          id: $requestingUserId
        }),
        (budget:Budget {id: $budgetId, active: true, owningOrgId: $owningOrgId})
        -[:record]->(budgetRecord:BudgetRecord {active:true})
      WITH COUNT(budgetRecord) as total, budgetRecord
          MATCH (budgetRecord {active: true})-[:amount {active:true }]->(amount:Property {active: true}),
          (budgetRecord)-[:organization { active: true }]->(org:Organization {active:true}),
          (budgetRecord)-[:fiscalYear {active: true}]->(fiscalYear {active: true})
          RETURN DISTINCT total, budgetRecord.id as budgetRecordId, fiscalYear.value as fiscalYear, org.id as orgId
          ORDER BY ${sort} ${order}
          SKIP $skip LIMIT $count
      `;
    const brs = await this.db
      .query()
      .raw(query, {
        token: session.token,
        requestingUserId: session.userId,
        owningOrgId: session.owningOrgId,
        budgetId,
        skip: (page - 1) * count,
        count,
      })
      .run();

    const items = await Promise.all(
      brs.map((br) => this.readOneRecord(br.budgetRecordId, session))
    );

    return {
      items,
      hasMore: false, // TODO
      total: items.length,
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
