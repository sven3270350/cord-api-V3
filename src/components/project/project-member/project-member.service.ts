import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  InternalServerErrorException as ServerException,
} from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { upperFirst } from 'lodash';
import { DateTime } from 'luxon';
import { generate } from 'shortid';
import { ISession } from '../../../common';
import {
  ConfigService,
  DatabaseService,
  ILogger,
  Logger,
  matchSession,
} from '../../../core';
import { RedactedUser, User, UserService } from '../../user';
import {
  CreateProjectMember,
  ProjectMember,
  ProjectMemberListInput,
  ProjectMemberListOutput,
  UpdateProjectMember,
} from './dto';

@Injectable()
export class ProjectMemberService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    @Logger('project:member:service') private readonly logger: ILogger
  ) {}

  // helper method for defining properties
  property = (prop: string, value: any) => {
    if (!value) {
      return [];
    }
    const createdAt = DateTime.local();
    return [
      [
        node('newProjectMember'),
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
        node('newProjectMember'),
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
        node('newProjectMember'),
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
        node('projectMember'),
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
        node('projectMember'),
        relation('out', '', property, { active: true }),
        node(property, 'Property', { active: true }),
      ],
    ]);
  };

  async readOne(id: string, session: ISession): Promise<ProjectMember> {
    const readProjectMember = this.db
      .query()
      .match(matchSession(session, { withAclRead: 'canReadProjectMembers' }))
      .match([node('projectMember', 'ProjectMember', { active: true, id })]);
    readProjectMember.optionalMatch([
      node('requestingUser'),
      relation('in', '', 'member', { active: true }),
      node('', 'SecurityGroup', { active: true }),
      relation('out', '', 'permission', { active: true }),
      node('canEditUser', 'Permission', {
        property: 'user',
        active: true,
        edit: true,
      }),
      relation('out', '', 'baseNode', { active: true }),
      node('projectMember'),
      relation('out', '', 'user', { active: true }),
      node('user', 'User', { active: true }),
    ]);
    readProjectMember.optionalMatch([
      node('requestingUser'),
      relation('in', '', 'member', { active: true }),
      node('', 'SecurityGroup', { active: true }),
      relation('out', '', 'permission', { active: true }),
      node('canReadUser', 'Permission', {
        property: 'user',
        active: true,
        read: true,
      }),
      relation('out', '', 'baseNode', { active: true }),
      node('projectMember'),
      relation('out', '', 'user', { active: true }),
      node('user', 'User', { active: true }),
    ]);
    this.propMatch(readProjectMember, 'roles');
    this.propMatch(readProjectMember, 'modifiedAt');

    readProjectMember.return({
      projectMember: [{ id: 'id', createdAt: 'createdAt' }],
      roles: [{ value: 'roles' }],
      canReadRoles: [
        {
          read: 'canReadRoles',
        },
      ],
      canEditRoles: [
        {
          edit: 'canEditRoles',
        },
      ],
      modifiedAt: [{ value: 'modifiedAt' }],
      canReadModifiedAt: [
        {
          read: 'canReadModifiedAt',
        },
      ],
      canEditModifiedAt: [
        {
          edit: 'canEditModifiedAt',
        },
      ],
      user: [{ id: 'userId' }],
      canReadUser: [
        {
          read: 'canReadUser',
        },
      ],
      canEditUser: [
        {
          edit: 'canEditUser',
        },
      ],
    });

    let result;
    try {
      result = await readProjectMember.first();
    } catch (e) {
      this.logger.error('e :>> ', e);
      return await Promise.reject(e);
    }

    if (!result) {
      throw new NotFoundException('Could not find project member');
    }

    let user: User = RedactedUser;
    if (result.canReadUser) {
      user = await this.userService.readOne(result.userId, session);
    }

    return {
      id: id,
      createdAt: result.createdAt,
      modifiedAt: result.modifiedAt,
      user: {
        value: {
          ...user,
        },
        canRead: true,
        canEdit: true,
      },
      roles: {
        value: result.roles || [],
        canEdit: true,
        canRead: true,
      },
    };
  }

  async create(
    { userId, projectId, ...input }: CreateProjectMember,
    session: ISession
  ): Promise<ProjectMember> {
    const id = generate();
    const createdAt = DateTime.local();

    try {
      const createProjectMember = this.db
        .query()
        .match(matchSession(session, { withAclEdit: 'canCreateProjectMember' }))
        .match([
          node('rootuser', 'User', {
            active: true,
            id: this.config.rootAdmin.id,
          }),
        ])
        .create([
          [
            node('newProjectMember', 'ProjectMember:BaseNode', {
              active: true,
              createdAt,
              id,
              owningOrgId: session.owningOrgId,
            }),
          ],
          ...this.property('roles', input.roles),
          ...this.property('modifiedAt', createdAt),
          [
            node('adminSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: `projectmember-SG admin`,
            }),
            relation('out', '', 'member', { active: true, createdAt }),
            node('requestingUser'),
          ],
          [
            node('readerSG', 'SecurityGroup', {
              id: generate(),
              active: true,
              createdAt,
              name: `projectmember-SG users`,
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
          ...this.permission('roles'),
          ...this.permission('modifiedAt'),
          ...this.permission('user'),
        ])
        .return('newProjectMember.id as id');
      await createProjectMember.first();

      // connect the Project to the ProjectMember
      // and connect ProjectMember to User
      await this.db
        .query()
        .match([
          [node('user', 'User', { id: userId, active: true })],
          [node('project', 'Project', { id: projectId, active: true })],
          [node('projectMember', 'ProjectMember', { id, active: true })],
        ])
        .create([
          node('project'),
          relation('out', '', 'member', {
            active: true,
            createdAt: DateTime.local(),
          }),
          node('projectMember'),
          relation('out', '', 'user', {
            active: true,
            createdAt: DateTime.local(),
          }),
          node('user'),
        ])
        .return('projectMember.id as id')
        .first();

      return await this.readOne(id, session);
    } catch (e) {
      this.logger.warning('Failed to create project member', {
        exception: e,
      });

      throw new InternalServerErrorException('Could not create project member');
    }
  }

  async list(
    input: Partial<ProjectMemberListInput>,
    session: ISession
  ): Promise<ProjectMemberListOutput> {
    const { page, count, sort, order, filter } = {
      ...ProjectMemberListInput.defaultVal,
      ...input,
    };

    const { projectId } = filter;
    let result: {
      items: ProjectMember[];
      hasMore: boolean;
      total: number;
    } = { items: [], hasMore: false, total: 0 };

    if (projectId) {
      const qry = `
        MATCH
          (token:Token {active: true, value: $token})
          <-[:token {active: true}]-
          (requestingUser:User {
            active: true,
            id: $requestingUserId
          }),
          (project:Project {id: $projectId, active: true, owningOrgId: $owningOrgId})
          -[:member]->(projectMember:ProjectMember {active:true})
        WITH COUNT(projectMember) as total, project, projectMember
            MATCH(projectMember {active: true})-[:roles {active:true}]->(roles:Property {active: true})
            RETURN total, projectMember.id as id, projectMember.createdAt as createdAt
            ORDER BY ${sort} ${order}
            SKIP $skip LIMIT $count
      `;
      const projectMemQuery = this.db.query().raw(qry, {
        token: session.token,
        requestingUserId: session.userId,
        owningOrgId: session.owningOrgId,
        projectId,
        skip: (page - 1) * count,
        count,
      });

      const projectMembers = await projectMemQuery.run();

      result.items = await Promise.all(
        projectMembers.map(async (projectMember) =>
          this.readOne(projectMember.id, session)
        )
      );
      result.total = result.items.length;
    } else {
      result = await this.db.list<ProjectMember>({
        session,
        nodevar: 'projectMember',
        aclReadProp: 'canReadProjectMembers',
        aclEditProp: 'canCreateProjectMember',
        props: [
          { name: 'roles', secure: true, list: true },
          { name: 'user', secure: true },
          { name: 'modifiedAt', secure: false },
        ],
        input: {
          page,
          count,
          sort,
          order,
          filter,
        },
      });
    }

    return {
      items: result.items,
      hasMore: result.hasMore,
      total: result.total,
    };
  }

  async update(
    input: UpdateProjectMember,
    session: ISession
  ): Promise<ProjectMember> {
    const object = await this.readOne(input.id, session);

    await this.db.sgUpdateProperties({
      session,
      object,
      props: ['roles', 'modifiedAt'],
      changes: {
        ...input,
        roles: (input.roles ? input.roles : undefined) as any,
        modifiedAt: DateTime.local(),
      },
      nodevar: 'projectMember',
    });
    return this.readOne(input.id, session);
  }

  async delete(id: string, session: ISession): Promise<void> {
    const object = await this.readOne(id, session);

    if (!object) {
      throw new NotFoundException('Could not find project member');
    }

    try {
      await this.db.deleteNode({
        session,
        object,
        aclEditProp: 'canDeleteOwnUser',
      });
    } catch (e) {
      this.logger.warning('Failed to delete project member', {
        exception: e,
      });

      throw new ServerException('Failed to delete project member');
    }
  }
}
