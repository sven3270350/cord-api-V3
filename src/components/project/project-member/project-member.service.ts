import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { RelationDirection } from 'cypher-query-builder/dist/typings/clauses/relation-pattern';
import { difference } from 'lodash';
import { DateTime } from 'luxon';
import {
  DuplicateException,
  generateId,
  InputException,
  MaybeAsync,
  NotFoundException,
  ServerException,
  Session,
  UnauthorizedException,
} from '../../../common';
import {
  ConfigService,
  DatabaseService,
  IEventBus,
  ILogger,
  Logger,
  matchRequestingUser,
  OnIndex,
  property,
} from '../../../core';
import {
  calculateTotalAndPaginateList,
  defaultSorter,
  matchPropListNew,
  permissionsOfNode,
  requestingUser,
} from '../../../core/database/query';
import {
  DbPropsOfDto,
  parseBaseNodeProperties,
  parsePropList,
  parseSecuredPropertiesNew,
  runListQuery,
  StandardReadResult,
} from '../../../core/database/results';
import { AuthorizationService } from '../../authorization/authorization.service';
import { User, UserService } from '../../user';
import {
  CreateProjectMember,
  ProjectMember,
  ProjectMemberListInput,
  ProjectMemberListOutput,
  Role,
  UpdateProjectMember,
} from './dto';
import { DbProjectMember } from './model';

@Injectable()
export class ProjectMemberService {
  private readonly securedProperties = {
    user: true,
    roles: true,
  };

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly eventBus: IEventBus,
    @Logger('project:member:service') private readonly logger: ILogger,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService
  ) {}

  @OnIndex()
  async createIndexes() {
    return [
      'CREATE CONSTRAINT ON (n:ProjectMember) ASSERT EXISTS(n.id)',
      'CREATE CONSTRAINT ON (n:ProjectMember) ASSERT n.id IS UNIQUE',
    ];
  }

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
    session: Session
  ): Promise<ProjectMember> {
    const id = await generateId();
    const createdAt = DateTime.local();

    if (await this.getPMByProjectAndUser(projectId, userId)) {
      throw new DuplicateException(
        'projectMember.userId',
        'User is already a member of this project'
      );
    }

    await this.assertValidRoles(input.roles, () =>
      this.userService.readOne(userId, session)
    );

    try {
      const createProjectMember = this.db
        .query()
        .create([
          [
            node('newProjectMember', 'ProjectMember:BaseNode', {
              createdAt,
              id,
            }),
          ],
          ...property('roles', input.roles, 'newProjectMember'),
          ...property('modifiedAt', createdAt, 'newProjectMember'),
        ])
        .return('newProjectMember.id as id');
      await createProjectMember.first();

      // connect the Project to the ProjectMember
      // and connect ProjectMember to User
      const memberQuery = await this.db
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

      // creating user must be an admin, use role change event
      const dbProjectMember = new DbProjectMember();
      await this.authorizationService.processNewBaseNode(
        dbProjectMember,
        memberQuery?.id,
        session.userId
      );

      // await this.addProjectAdminsToUserSg(projectId, userId);

      return await this.readOne(id, session);
    } catch (exception) {
      throw new ServerException('Could not create project member', exception);
    }
  }

  async readOne(id: string, session: Session): Promise<ProjectMember> {
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
      .call(matchPropListNew)
      .match([node('node'), relation('out', '', 'user'), node('user', 'User')])
      .return('node, propList, user.id as userId')
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
    const permsOfBaseNode = await this.authorizationService.getPermissionsOfBaseNode(
      new DbProjectMember(),
      session
    );
    const securedProps = parseSecuredPropertiesNew(
      props,
      this.securedProperties,
      permsOfBaseNode
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
      canDelete: true, // TODO
    };
  }

  async update(
    input: UpdateProjectMember,
    session: Session
  ): Promise<ProjectMember> {
    const object = await this.readOne(input.id, session);

    await this.assertValidRoles(input.roles, () => {
      const user = object.user.value;
      if (!user) {
        throw new UnauthorizedException(
          'Cannot read user to verify roles available'
        );
      }
      return user;
    });

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

  private async assertValidRoles(
    roles: Role[] | undefined,
    forUser: () => MaybeAsync<User>
  ) {
    if (!roles || roles.length === 0 || this.config.migration) {
      return;
    }
    const user = await forUser();
    const availableRoles = user.roles.value ?? [];
    const forbiddenRoles = difference(roles, availableRoles);
    if (forbiddenRoles.length) {
      const forbiddenRolesStr = forbiddenRoles.join(', ');
      throw new InputException(
        `Role(s) ${forbiddenRolesStr} cannot be assigned to this project member`,
        'input.roles'
      );
    }
  }

  async delete(id: string, session: Session): Promise<void> {
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
    session: Session
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
      .call(
        calculateTotalAndPaginateList,
        input,
        this.securedProperties,
        defaultSorter
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

  // when a new user is added to a project, all the project admins need to have access
  // to some of that user's properties in order to know about that user
  // async addProjectAdminsToUserSg(projectId: string, userId: string) {
  //   // get all admins of a project, then add the role for them to see the user info
  //   const result = await this.db
  //     .query()
  //     .match([
  //       node('admins', 'User'),
  //       relation('in', '', 'member'),
  //       node('sg', 'SecurityGroup', { role: InternalRole.Admin }),
  //       relation('out', '', 'permission'),
  //       node('perms', 'Permission'),
  //       relation('out', '', 'baseNode'),
  //       node('project', 'Project', { id: projectId }),
  //     ])
  //     .raw('return collect(distinct admins.id) as ids')
  //     .first();

  //   for (const id of result?.ids) {
  //     // creating user must be an admin, use role change event
  //     const dbProjectMember = new DbProjectMember();
  //     await this.authorizationService.processNewBaseNode(
  //       InternalAdminViewOfProjectMemberRole,
  //       dbProjectMember,
  //       userId,
  //       id
  //     );
  //   }
  // }
}
