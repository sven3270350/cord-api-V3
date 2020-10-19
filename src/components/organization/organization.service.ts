import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { range } from 'lodash';
import { DateTime } from 'luxon';
import {
  DuplicateException,
  generateId,
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
  OnIndex,
  Property,
} from '../../core';
import {
  calculateTotalAndPaginateList,
  defaultSorter,
  permissionsOfNode,
  requestingUser,
} from '../../core/database/query';
import {
  DbPropsOfDto,
  parseBaseNodeProperties,
  parseSecuredProperties,
  runListQuery,
  StandardReadResult,
} from '../../core/database/results';
import { AuthorizationService } from '../authorization/authorization.service';
import { Powers } from '../authorization/dto/powers';
import {
  Location,
  LocationListInput,
  LocationService,
  SecuredLocationList,
} from '../location';
import {
  CreateOrganization,
  Organization,
  OrganizationListInput,
  OrganizationListOutput,
  UpdateOrganization,
} from './dto';
import { DbOrganization } from './model';

@Injectable()
export class OrganizationService {
  private readonly securedProperties = {
    name: true,
    address: true,
  };

  constructor(
    @Logger('org:service') private readonly logger: ILogger,
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    @Inject(forwardRef(() => AuthorizationService))
    private readonly authorizationService: AuthorizationService,
    private readonly locationService: LocationService
  ) {}

  @OnIndex()
  async createIndexes() {
    return [
      'CREATE CONSTRAINT ON (n:Organization) ASSERT EXISTS(n.id)',
      'CREATE CONSTRAINT ON (n:Organization) ASSERT n.id IS UNIQUE',
      'CREATE CONSTRAINT ON (n:Organization) ASSERT EXISTS(n.createdAt)',

      'CREATE CONSTRAINT ON ()-[r:name]-() ASSERT EXISTS(r.active)',
      'CREATE CONSTRAINT ON ()-[r:name]-() ASSERT EXISTS(r.createdAt)',

      'CREATE CONSTRAINT ON (n:OrgName) ASSERT EXISTS(n.value)',
      'CREATE CONSTRAINT ON (n:OrgName) ASSERT n.value IS UNIQUE',
    ];
  }

  // assumes 'root' cypher variable is declared in query
  private readonly createSG = (
    query: Query,
    cypherIdentifier: string,
    id: string,
    label?: string
  ) => {
    const labels = ['SecurityGroup'];
    if (label) {
      labels.push(label);
    }
    const createdAt = DateTime.local();

    query.create([
      node('root'),
      relation('in', '', 'member'),
      node(cypherIdentifier, labels, { createdAt, id }),
    ]);
  };

  async create(
    input: CreateOrganization,
    session: ISession
  ): Promise<Organization> {
    await this.authorizationService.checkPower(
      Powers.CreateOrganization,
      session.userId
    );

    const checkOrg = await this.db
      .query()
      .raw(`MATCH(org:OrgName {value: $name}) return org`, {
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
        isPublic: true,
        isOrgPublic: false,
        label: 'OrgName',
      },
      {
        key: 'address',
        value: input.address,
        isPublic: false,
        isOrgPublic: false,
      },
    ];
    // const baseMetaProps = [];

    const query = this.db
      .query()
      .match([
        node('publicSG', 'PublicSecurityGroup', {
          id: this.config.publicSecurityGroup.id,
        }),
      ])
      .call(matchRequestingUser, session)
      .call(
        this.createSG,
        'orgSG',
        await generateId(),
        'OrgPublicSecurityGroup'
      )
      .call(createBaseNode, await generateId(), 'Organization', secureProps)
      .return('node.id as id');

    const result = await query.first();

    if (!result) {
      throw new ServerException('failed to create default org');
    }

    const dbOrganization = new DbOrganization();
    await this.authorizationService.processNewBaseNode(
      dbOrganization,
      result.id,
      session.userId as string
    );

    const id = result.id;

    this.logger.debug(`organization created`, { id });

    return await this.readOne(id, session);
  }

  async readOne(orgId: string, session: ISession): Promise<Organization> {
    this.logger.debug(`Read Organization`, {
      id: orgId,
      userId: session.userId,
    });

    if (!session.userId) {
      session.userId = this.config.anonUser.id;
    }

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .match([node('node', 'Organization', { id: orgId })])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member'),
        node('', 'SecurityGroup'),
        relation('out', '', 'permission'),
        node('perms', 'Permission'),
        relation('out', '', 'baseNode'),
        node('node'),
      ])
      .with('collect(distinct perms) as permList, node')
      .match([
        node('node'),
        relation('out', 'r', { active: true }),
        node('props', 'Property'),
      ])
      .with('{value: props.value, property: type(r)} as prop, permList, node')
      .with('collect(prop) as propList, permList, node')
      .return('propList, permList, node')
      .asResult<StandardReadResult<DbPropsOfDto<Organization>>>();

    const result = await query.first();

    if (!result) {
      throw new NotFoundException(
        'Could not find organization',
        'organization.id'
      );
    }

    const secured = parseSecuredProperties(
      result.propList,
      result.permList,
      this.securedProperties
    );

    return {
      ...parseBaseNodeProperties(result.node),
      ...secured,
    };
  }

  async update(
    input: UpdateOrganization,
    session: ISession
  ): Promise<Organization> {
    const organization = await this.readOne(input.id, session);
    return await this.db.sgUpdateProperties({
      session,
      object: organization,
      props: ['name', 'address'],
      changes: input,
      nodevar: 'organization',
    });
  }

  async delete(id: string, session: ISession): Promise<void> {
    if (!session.userId) {
      throw new UnauthenticatedException('user not logged in');
    }
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

    this.logger.debug(`deleted organization with id`, { id });
  }

  async list(
    { filter, ...input }: OrganizationListInput,
    session: ISession
  ): Promise<OrganizationListOutput> {
    const orgSortMap: Partial<Record<typeof input.sort, string>> = {
      name: 'toLower(prop.value)',
    };
    const sortBy = orgSortMap[input.sort] ?? 'prop.value';
    const query = this.db
      .query()
      .match([
        requestingUser(session),
        ...permissionsOfNode('Organization'),
        ...(filter.userId && session.userId
          ? [
              relation('in', '', 'organization', { active: true }),
              node('user', 'User', { id: filter.userId }),
            ]
          : []),
      ])
      .call(
        calculateTotalAndPaginateList,
        input,
        this.securedProperties,
        defaultSorter,
        sortBy
      );

    return await runListQuery(query, input, (id) => this.readOne(id, session));
  }

  async addLocation(
    organizationId: string,
    locationId: string,
    session: ISession
  ): Promise<void> {
    try {
      await this.removeLocation(organizationId, locationId, session);
      await this.db
        .query()
        .matchNode('organization', 'Organization', { id: organizationId })
        .matchNode('location', 'Location', { id: locationId })
        .create([
          node('organization'),
          relation('out', '', 'locations', {
            active: true,
            createdAt: DateTime.local(),
          }),
          node('location'),
        ])
        .run();
    } catch (e) {
      throw new ServerException('Could not add location to organization', e);
    }
  }

  async removeLocation(
    organizationId: string,
    locationId: string,
    _session: ISession
  ): Promise<void> {
    try {
      await this.db
        .query()
        .matchNode('organization', 'Organization', { id: organizationId })
        .matchNode('location', 'Location', { id: locationId })
        .match([
          [
            node('organization'),
            relation('out', 'rel', 'locations', { active: true }),
            node('location'),
          ],
        ])
        .setValues({
          'rel.active': false,
        })
        .run();
    } catch (e) {
      throw new ServerException(
        'Could not remove location from organization',
        e
      );
    }
  }

  async listLocations(
    organizationId: string,
    _input: LocationListInput,
    session: ISession
  ): Promise<SecuredLocationList> {
    const result = await this.db
      .query()
      .matchNode('organization', 'Organization', { id: organizationId })
      .match([
        node('organization'),
        relation('out', '', 'locations', { active: true }),
        node('location'),
      ])
      .return({
        location: [{ id: 'id' }],
      })
      .run();

    // const canCreateLocation = await this.authorizationService.checkPower(
    //   Powers.CreateLocation,
    //   session.userId
    // );

    const items = await Promise.all(
      result.map(
        async (location): Promise<Location> => {
          return await this.locationService.readOne(location.id, session);
        }
      )
    );

    return {
      items: items,
      total: items.length,
      hasMore: false,
      canCreate: true, // TODO
      canRead: true, // TODO
    };
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
            (org:Organization)
          RETURN
            count(org) as orgCount
          `,
          {
            token: session.token,
          }
        )
        .first();

      const orgCount = result?.orgCount;

      for (const i of range(orgCount)) {
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

  private async pullOrg(index: number): Promise<boolean> {
    const result = await this.db
      .query()
      .raw(
        `
        MATCH
          (org:Organization)
          -[:name {active: true}]->
          (name:Property)
        RETURN
          org.id as id,
          org.createdAt as createdAt,
          name.value as name
        ORDER BY
          createdAt
        SKIP
          ${index}
        LIMIT
          1
        `
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
      address: {
        value: result?.address,
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
      .match([matchSession(session), [node('organization', 'Organization')]])
      .return('organization.id as id')
      .run();

    return (
      (
        await Promise.all(
          organizations.map(async (organization) => {
            return await this.db.hasProperties({
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
            return await this.db.isUniqueProperties({
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
