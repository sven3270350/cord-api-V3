import { Injectable } from '@nestjs/common';
import { node, relation } from 'cypher-query-builder';
import {
  DuplicateException,
  ISession,
  NotFoundException,
  ServerException,
} from '../../common';
import {
  addAllSecureProperties,
  addBaseNodeMetaPropsWithClause,
  addUserToSG,
  ConfigService,
  createBaseNode,
  createSG,
  DatabaseService,
  filterByBaseNodeId,
  filterByString,
  ILogger,
  listWithSecureObject,
  Logger,
  matchRequestingUser,
  matchSession,
  matchUserPermissions,
  OnIndex,
  Property,
  runListQuery,
} from '../../core';
import {
  CreateOrganization,
  Organization,
  OrganizationListInput,
  OrganizationListOutput,
  UpdateOrganization,
} from './dto';

@Injectable()
export class OrganizationService {
  constructor(
    @Logger('org:service') private readonly logger: ILogger,
    private readonly config: ConfigService,
    private readonly db: DatabaseService
  ) {}

  @OnIndex()
  async createIndexes() {
    const constraints = [
      'CREATE CONSTRAINT ON (n:Organization) ASSERT EXISTS(n.id)',
      'CREATE CONSTRAINT ON (n:Organization) ASSERT n.id IS UNIQUE',
      'CREATE CONSTRAINT ON (n:Organization) ASSERT EXISTS(n.active)',
      'CREATE CONSTRAINT ON (n:Organization) ASSERT EXISTS(n.createdAt)',
      // 'CREATE CONSTRAINT ON (n:Organization) ASSERT EXISTS(n.owningOrgId)',

      'CREATE CONSTRAINT ON ()-[r:name]-() ASSERT EXISTS(r.active)',
      'CREATE CONSTRAINT ON ()-[r:name]-() ASSERT EXISTS(r.createdAt)',

      'CREATE CONSTRAINT ON (n:OrgName) ASSERT EXISTS(n.value)',
      'CREATE CONSTRAINT ON (n:OrgName) ASSERT n.value IS UNIQUE',
    ];
    for (const query of constraints) {
      await this.db.query().raw(query).run();
    }
  }

  async create(
    input: CreateOrganization,
    session: ISession
  ): Promise<Organization> {
    const checkOrg = await this.db
      .query()
      .raw(`MATCH(org:OrgName {value: $name, active: true}) return org`, {
        name: input.name,
      })
      .first();

    if (checkOrg) {
      throw new DuplicateException(
        'organization.name',
        'Organization with this name already exists'
      );
    }

    // create org
    const secureProps: Property[] = [
      {
        key: 'name',
        value: input.name,
        addToAdminSg: true,
        addToWriterSg: true,
        addToReaderSg: true,
        isPublic: true,
        isOrgPublic: true,
        label: 'OrgName',
      },
    ];
    // const baseMetaProps = [];

    const query = this.db
      .query()
      .match([
        node('root', 'User', { active: true, id: this.config.rootAdmin.id }),
      ])
      .match([
        node('publicSG', 'PublicSecurityGroup', {
          active: true,
          id: this.config.publicSecurityGroup.id,
        }),
      ])
      .call(matchRequestingUser, session)
      .call(createSG, 'orgSG', 'OrgPublicSecurityGroup')
      .call(createBaseNode, 'Organization', secureProps)
      .call(addUserToSG, 'requestingUser', 'adminSG') // must come after base node creation
      .return('node.id as id');

    const result = await query.first();

    if (!result) {
      throw new ServerException('failed to create default org');
    }

    const id = result.id;

    // add root admin to new org as an admin
    await this.db.addRootAdminToBaseNodeAsAdmin(id, 'Organization');

    this.logger.debug(`organization created, id ${id}`);

    return this.readOne(id, session);
  }

  async readOne(orgId: string, session: ISession): Promise<Organization> {
    if (!session.userId) {
      session.userId = this.config.anonUser.id;
    }

    const props = ['name'];
    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .match([node('node', 'Organization', { active: true, id: orgId })])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member*1..'),
        node('', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission'),
        node('perms', 'Permission', { active: true }),
        relation('out', '', 'baseNode'),
        node('node'),
      ])
      .with('collect(distinct perms) as permList, node')
      .match([
        node('node'),
        relation('out', 'r', { active: true }),
        node('props', 'Property', { active: true }),
      ])
      .with('{value: props.value, property: type(r)} as prop, permList, node')
      .with('collect(prop) as propList, permList, node')
      .return('propList, permList, node');

    const result = await query.first();

    if (!result) {
      throw new NotFoundException(
        'Could not find organization',
        'organization.id'
      );
    }

    const organization: any = {
      id: result.node.properties.id,
      createdAt: result.node.properties.createdAt,
    };

    const perms: any = {};

    for (const {
      properties: { property, read, edit },
    } of result.permList) {
      const currentPermission = perms[property];
      if (!currentPermission) {
        perms[property] = {
          canRead: Boolean(read),
          canEdit: Boolean(edit),
        };
      } else {
        currentPermission.canRead = currentPermission.canRead || read;
        currentPermission.canEdit = currentPermission.canEdit || edit;
      }
    }

    for (const propertyObj of result.propList) {
      const canRead = Boolean(perms[propertyObj.property]?.canRead);
      const canEdit = Boolean(perms[propertyObj.property]?.canEdit);
      const value = (canRead && propertyObj.value) || null;
      organization[propertyObj.property] = {
        value,
        canRead,
        canEdit,
      };
    }

    for (const prop of props) {
      if (!organization[prop]) {
        organization[prop] = {
          value: null,
          canRead: false,
          canEdit: false,
        };
      }
    }

    return organization;
  }

  async update(
    input: UpdateOrganization,
    session: ISession
  ): Promise<Organization> {
    const organization = await this.readOne(input.id, session);
    return this.db.sgUpdateProperties({
      session,
      object: organization,
      props: ['name'],
      changes: input,
      nodevar: 'organization',
    });
  }

  async delete(id: string, session: ISession): Promise<void> {
    const ed = await this.readOne(id, session);
    try {
      await this.db.deleteNode({
        session,
        object: ed,
        aclEditProp: 'canDeleteOwnUser',
      });
    } catch (e) {
      this.logger.error('Failed to delete', { id, exception: e });
      throw new ServerException('Failed to delete');
    }

    this.logger.info(`deleted organization with id`, { id });
  }

  async list(
    { filter, ...input }: OrganizationListInput,
    session: ISession
  ): Promise<OrganizationListOutput> {
    const label = 'Organization';
    const baseNodeMetaProps = ['id', 'createdAt'];
    // const unsecureProps = [''];
    const secureProps = ['name'];

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .call(matchUserPermissions, 'Organization');

    if (filter.name) {
      query.call(filterByString, label, 'name', filter.name);
    } else if (filter.userId && session.userId) {
      query.call(
        filterByBaseNodeId,
        filter.userId,
        'organization',
        'in',
        'User',
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

      // form return object
      // ${listWithUnsecureObject(unsecureProps)}, // removed from a few lines down
      .with(
        `
          {
            ${addBaseNodeMetaPropsWithClause(baseNodeMetaProps)},
            ${listWithSecureObject(secureProps)}
          } as node
        `
      );

    return runListQuery(query, input, secureProps.includes(input.sort));
  }

  async checkAllOrgs(session: ISession): Promise<boolean> {
    try {
      const result = await this.db
        .query()
        .raw(
          `
          MATCH
          (token:Token {active: true, value: $token})
          <-[:token {active: true}]-
          (user:User {
            isAdmin: true
          }),
            (org:Organization {
              active: true
            })
          RETURN
            count(org) as orgCount
          `,
          {
            token: session.token,
          }
        )
        .first();

      const orgCount = result?.orgCount;

      for (let i = 0; i < orgCount; i++) {
        const isGood = await this.pullOrg(i);
        if (!isGood) {
          return false;
        }
      }
    } catch (e) {
      this.logger.error('Checks failed', { exception: e });
    }

    return true;
  }

  private async pullOrg(id: number): Promise<boolean> {
    const result = await this.db
      .query()
      .raw(
        `
        MATCH
          (org:Organization {
            active: true
          })
          -[:name {active: true}]->
          (name:Property {active: true})
        RETURN
          org.id as id,
          org.createdAt as createdAt,
          name.value as name
        ORDER BY
          createdAt
        SKIP
          ${id}
        LIMIT
          1
        `,
        {
          id,
        }
      )
      .first();

    const isGood = this.validateOrg({
      id: result?.id,
      createdAt: result?.createdAt,
      name: {
        value: result?.name,
        canRead: false,
        canEdit: false,
      },
    });

    return isGood;
  }

  private validateOrg(org: Organization): boolean {
    // org has an id
    if (org.id === undefined || org.id === null) {
      this.logger.error('bad org id', org);
      return false;
    }
    // org has a name
    if (org.name.value === undefined || org.name.value === null) {
      this.logger.error('org has a bad name', org);
      return false;
    }
    // created after 1990
    if (org.createdAt.year <= 1990) {
      this.logger.error('org has a bad createdAt: ', org);
      return false;
    }

    return true;
  }

  async checkOrganizationConsistency(session: ISession): Promise<boolean> {
    const organizations = await this.db
      .query()
      .match([
        matchSession(session),
        [
          node('organization', 'Organization', {
            active: true,
          }),
        ],
      ])
      .return('organization.id as id')
      .run();

    return (
      (
        await Promise.all(
          organizations.map(async (organization) => {
            return this.db.hasProperties({
              session,
              id: organization.id,
              props: ['name'],
              nodevar: 'organization',
            });
          })
        )
      ).every((n) => n) &&
      (
        await Promise.all(
          organizations.map(async (organization) => {
            return this.db.isUniqueProperties({
              session,
              id: organization.id,
              props: ['name'],
              nodevar: 'organization',
            });
          })
        )
      ).every((n) => n)
    );
  }
}
