import { Injectable } from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { union } from 'lodash';
import { generate } from 'shortid';
import { ServerException, UnauthorizedException } from '../../common';
import { ConfigService, DatabaseService, ILogger, Logger } from '../../core';
import { Powers } from './dto/powers';
import { DbRole, OneBaseNode } from './model';
import { InternalAdminRole } from './roles';

/**
 * powers can exist on a security group or a user node
 */

@Injectable()
export class AuthorizationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Logger('authorization:service') private readonly logger: ILogger
  ) {}

  async addUsersToBaseNodeByRole(
    role: DbRole,
    baseNodeObj: OneBaseNode,
    baseNodeId: string,
    userId: string
  ) {
    // get or create the role's SG for this base node
    const existingGroupId = await this.mergeSecurityGroupForRole(
      baseNodeObj,
      baseNodeId,
      role
    );
    if (existingGroupId) {
      // merge member to it
      await this.db
        .query()
        .match([node('sg', 'SecurityGroup', { id: existingGroupId })])
        .match([node('user', 'User', { id: userId })])
        .merge([node('sg'), relation('out', '', 'member'), node('user')])
        .call(this.addRootUserForAdminRole, role)
        .run();
      this.logger.debug('Added user to existing security group', {
        securityGroup: existingGroupId,
        userId,
      });

      return true;
    } else {
      throw new ServerException('failed to create SG for role');
    }
  }

  private async mergeSecurityGroupForRole(
    baseNodeObj: OneBaseNode,
    baseNodeId: string,
    role: DbRole
  ): Promise<string | undefined> {
    const checkSg = await this.db
      .query()
      .match([
        node('sg', 'SecurityGroup', { role }),
        relation('out', '', 'baseNode'),
        node('baseNode', 'BaseNode', { id: baseNodeId }),
      ])
      .raw('return sg.id as id')
      .asResult<{ id: string }>()
      .first();

    if (checkSg?.id) {
      return checkSg.id;
    }

    // create SG with all role's perms
    const createSgQuery = this.db
      .query()
      .match([node('baseNode', 'BaseNode', { id: baseNodeId })])
      .merge([
        node('sg', 'SecurityGroup', {
          id: generate(),
          role: role.name,
        }),
        relation('out', '', 'baseNode'),
        node('baseNode'),
      ]);

    // iterate through the key of the base node and get the permission object for each from the role object
    for (const key of Object.keys(baseNodeObj)) {
      const perms = role.getPermissionsOnProperty<typeof baseNodeObj>(
        baseNodeObj.__className,
        key as keyof OneBaseNode
      );

      // write the permission to the db if any of its perms are true
      createSgQuery.merge([
        node('sg'),
        relation('out', '', 'permission'),
        node('', 'Permission', {
          read: perms?.read ? perms.read : false,
          edit: perms?.write ? perms.write : false,
          property: key,
        }),
        relation('out', '', 'baseNode'),
        node('baseNode'),
      ]);
    }

    const result = await createSgQuery
      .raw('return sg.id as id')
      .asResult<{ id: string }>()
      .first();

    return result?.id;
  }

  async addAllUsersToSgByRole(sgId: string, userRole: string) {
    // grab all users who have a given user-role and add them as members to the new sg
    const result = await this.db
      .query()
      .match([node('sg', 'SecurityGroup', { id: sgId })])
      .match([
        node('users', 'User'),
        relation('out', '', 'roles', { active: true }),
        node('roles', 'Property', { role: userRole }),
      ])
      .merge([node('users'), relation('in', '', 'member'), node('sg')])
      .run();
  }

  // if this is an admin role, ensure the root user is attached
  private readonly addRootUserForAdminRole = (query: Query, role: DbRole) => {
    if (role.name === InternalAdminRole.name) {
      query
        .with('*')
        .match([node('root', 'User', { id: this.config.rootAdmin.id })])
        .merge([node('sg'), relation('out', '', 'member'), node('root')]);
    }
  };

  async checkPower(power: Powers, id?: string): Promise<boolean> {
    // if no id is given we check the public sg for public powers
    let hasPower = false;

    if (id === undefined) {
      const result = await this.db
        .query()
        .match([
          node('sg', 'PublicSecurityGroup', {
            id: this.config.publicSecurityGroup.id,
          }),
        ])
        .raw(`where '${power}' IN sg.powers`)
        .raw(`return "${power}" IN sg.powers as hasPower`)
        .union()
        .match([
          node('user', 'User', {
            id: this.config.anonUser.id,
          }),
        ])
        .raw(`where '${power}' IN user.powers`)
        .raw(`return "${power}" IN user.powers as hasPower`)
        .first();
      hasPower = result?.hasPower ?? false;
    } else {
      const query = this.db
        .query()
        .match([
          node('user', 'User', { id }),
          relation('in', '', 'member'),
          node('sg', 'SecurityGroup'),
        ])
        .raw(`where '${power}' IN sg.powers`)
        .raw(`return "${power}" IN sg.powers as hasPower`)
        .union()
        .match([node('user', 'User', { id })])
        .raw(`where '${power}' IN user.powers`)
        .raw(`return "${power}" IN user.powers as hasPower`);

      const result = await query.first();

      hasPower = result?.hasPower ?? false;
    }

    if (!hasPower) {
      throw new UnauthorizedException(
        `user ${id ? id : 'anon'} does not have the requested power: ${power}`
      );
    }

    return hasPower;
  }

  async grantPower(power: Powers, id: string): Promise<boolean> {
    // get power set
    const powerSet = await this.db
      .query()
      .match([node('user', 'User', { id })])
      .raw('return user.powers as powers')
      .unionAll()
      .match([node('sg', 'SecurityGroup', { id })])
      .raw('return sg.powers as powers')
      .first();

    if (powerSet === undefined) {
      throw new UnauthorizedException('user not found');
    } else {
      const newPowers = union(powerSet.powers, [power]);

      const result = await this.db
        .query()
        .optionalMatch([node('userOrSg', 'User', { id })])
        .setValues({ 'userOrSg.powers': newPowers })
        .with('*')
        .optionalMatch([node('userOrSg', 'SecurityGroup', { id })])
        .setValues({ 'userOrSg.powers': newPowers })
        .run();

      if (result) {
        return true;
      } else {
        throw new ServerException('failed to grant power');
      }
    }
  }
}
