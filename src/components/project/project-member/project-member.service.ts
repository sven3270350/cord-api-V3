import { Injectable } from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { RelationDirection } from 'cypher-query-builder/dist/typings/clauses/relation-pattern';
import { difference } from 'lodash';
import { DateTime } from 'luxon';
import { generate } from 'shortid';
import {
  DuplicateException,
  InputException,
  ISession,
  NotFoundException,
  ServerException,
} from '../../../common';
import {
  ConfigService,
  DatabaseService,
  permission as dbPermission,
  getPermList,
  getPropList,
  ILogger,
  Logger,
  matchRequestingUser,
  matchSession,
} from '../../../core';
import {
  calculateTotalAndPaginateList,
  permissionsOfNode,
  requestingUser,
} from '../../../core/database/query';
import {
  DbPropsOfDto,
  parseBaseNodeProperties,
  parsePropList,
  parseSecuredProperties,
  runListQuery,
  StandardReadResult,
} from '../../../core/database/results';
import { UserService } from '../../user';
import {
  CreateProjectMember,
  ProjectMember,
  ProjectMemberListInput,
  ProjectMemberListOutput,
  Role,
  UpdateProjectMember,
} from './dto';

@Injectable()
export class ProjectMemberService {
  private readonly securedProperties = {
    user: true,
    roles: true,
  };

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    private readonly userService: UserService,
    @Logger('project:member:service') private readonly logger: ILogger
  ) {}

  // helper method for defining properties
  property = (prop: string, value: any) => {
    const createdAt = DateTime.local();
    return [
      [
        node('newProjectMember'),
        relation('out', '', prop, {
          active: true,
          createdAt,
        }),
        node(prop, 'Property', {
          value,
        }),
      ],
    ];
  };

  // helper method for defining properties
  permission = dbPermission;

  protected async getPMByProjectAndUser(
    projectId: string,
    userId: string
  ): Promise<boolean> {
    const result = await this.db
      .query()
      .match([node('user', 'User', { id: userId })])
      .match([node('project', 'Project', { id: projectId })])
      .match([
        node('project'),
        relation('out', '', 'member'),
        node('projectMember', 'ProjectMember'),
        relation('out', '', 'user'),
        node('user'),
      ])
      .return('projectMember.id as id')
      .first();

    return result ? true : false;
  }

  async create(
    { userId, projectId, ...input }: CreateProjectMember,
    session: ISession
  ): Promise<ProjectMember> {
    const id = generate();
    const createdAt = DateTime.local();

    if (await this.getPMByProjectAndUser(projectId, userId)) {
      throw new DuplicateException(
        'projectMember.userId',
        'User is already a member of this project'
      );
    }

    const user = await this.userService.readOne(userId, session);
    this.assertValidRoles(input.roles, user.roles.value);

    try {
      const createProjectMember = this.db
        .query()
        .match(matchSession(session, { withAclEdit: 'canCreateProjectMember' }))
        .match([
          node('rootuser', 'User', {
            id: this.config.rootAdmin.id,
          }),
        ])
        .create([
          [
            node('newProjectMember', 'ProjectMember:BaseNode', {
              createdAt,
              id,
            }),
          ],
          ...this.property('roles', input.roles),
          ...this.property('modifiedAt', createdAt),
          [
            node('adminSG', 'SecurityGroup', {
              id: generate(),
              name: `projectmember-SG admin`,
            }),
            relation('out', '', 'member'),
            node('requestingUser'),
          ],
          [
            node('readerSG', 'SecurityGroup', {
              id: generate(),
              name: `projectmember-SG users`,
            }),
            relation('out', '', 'member'),
            node('requestingUser'),
          ],
          [node('adminSG'), relation('out', '', 'member'), node('rootuser')],
          [node('readerSG'), relation('out', '', 'member'), node('rootuser')],
          ...this.permission('roles', 'newProjectMember'),
          ...this.permission('modifiedAt', 'newProjectMember'),
          ...this.permission('user', 'newProjectMember'),
        ])
        .return('newProjectMember.id as id');
      await createProjectMember.first();

      // connect the Project to the ProjectMember
      // and connect ProjectMember to User
      await this.db
        .query()
        .match([
          [node('user', 'User', { id: userId })],
          [node('project', 'Project', { id: projectId })],
          [node('projectMember', 'ProjectMember', { id })],
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
    } catch (exception) {
      this.logger.warning('Failed to create project member', {
        exception,
      });

      throw new ServerException('Could not create project member', exception);
    }
  }

  async readOne(id: string, session: ISession): Promise<ProjectMember> {
    this.logger.debug(`read one`, {
      id,
      userId: session.userId,
    });
    if (!id) {
      throw new NotFoundException(
        'No project member id to search for',
        'projectMember.id'
      );
    }

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .match([node('node', 'ProjectMember', { id })])
      .call(getPermList, 'requestingUser')
      .call(getPropList, 'permList')
      .match([node('node'), relation('out', '', 'user'), node('user', 'User')])
      .return('node, permList, propList, user.id as userId')
      .asResult<
        StandardReadResult<DbPropsOfDto<ProjectMember>> & {
          userId: string;
        }
      >();

    const result = await query.first();
    if (!result) {
      throw new NotFoundException(
        'Could not find project member',
        'projectMember.id'
      );
    }

    const props = parsePropList(result.propList);
    const securedProps = parseSecuredProperties(
      props,
      result.permList,
      this.securedProperties
    );

    return {
      ...parseBaseNodeProperties(result.node),
      ...securedProps,
      user: {
        ...securedProps.user,
        value: await this.userService.readOne(result.userId, session),
      },
      modifiedAt: props.modifiedAt,
      roles: {
        ...securedProps.roles,
        value: securedProps.roles.value ?? [],
      },
    };
  }

  async update(
    input: UpdateProjectMember,
    session: ISession
  ): Promise<ProjectMember> {
    const object = await this.readOne(input.id, session);

    this.assertValidRoles(input.roles, object.user.value?.roles.value);

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
    return await this.readOne(input.id, session);
  }

  private assertValidRoles(
    roles: Role[] | undefined,
    availableRoles: Role[] | undefined
  ) {
    if (!roles) {
      return;
    }
    const forbiddenRoles = difference(roles, availableRoles ?? []);
    if (forbiddenRoles.length) {
      const forbiddenRolesStr = forbiddenRoles.join(', ');
      throw new InputException(
        `Role(s) ${forbiddenRolesStr} cannot be assigned to this project member`,
        'input.roles'
      );
    }
  }

  async delete(id: string, session: ISession): Promise<void> {
    const object = await this.readOne(id, session);

    if (!object) {
      throw new NotFoundException(
        'Could not find project member',
        'projectMember.id'
      );
    }

    try {
      await this.db.deleteNode({
        session,
        object,
        aclEditProp: 'canDeleteOwnUser',
      });
    } catch (exception) {
      this.logger.warning('Failed to delete project member', {
        exception,
      });

      throw new ServerException('Failed to delete project member', exception);
    }
  }

  async list(
    { filter, ...input }: ProjectMemberListInput,
    session: ISession
  ): Promise<ProjectMemberListOutput> {
    const label = 'ProjectMember';

    const query = this.db
      .query()
      .match([
        requestingUser(session),
        ...permissionsOfNode(label),
        ...(filter.projectId
          ? [
              relation('in', '', 'member'),
              node('project', 'Project', {
                id: filter.projectId,
              }),
            ]
          : []),
      ])
      .call(calculateTotalAndPaginateList, input, (q, sort, order) =>
        sort in this.securedProperties
          ? q
              .match([
                node('node'),
                relation('out', '', sort),
                node('prop', 'Property'),
              ])
              .with('*')
              .orderBy('prop.value', order)
          : q.with('*').orderBy(`node.${sort}`, order)
      );

    return await runListQuery(query, input, (id) => this.readOne(id, session));
  }

  protected filterByProject(
    query: Query,
    projectId: string,
    relationshipType: string,
    relationshipDirection: RelationDirection,
    label: string
  ) {
    query.match([
      node('project', 'Project', { id: projectId }),
      relation(relationshipDirection, '', relationshipType, { active: true }),
      node('node', label),
    ]);
  }
}
