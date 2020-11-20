import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { range } from 'lodash';
import { DateTime } from 'luxon';
import {
  DuplicateException,
  generateId,
  NotFoundException,
  ServerException,
  Session,
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
  matchPermList,
  matchPropList,
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
    session: Session
  ): Promise<Organization> {
    await this.authorizationService.checkPower(
      Powers.CreateOrganization,
      session
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
      session.userId
    );

    const id = result.id;

    this.logger.debug(`organization created`, { id });

    return await this.readOne(id, session);
  }

  async readOne(orgId: string, session: Session): Promise<Organization> {
    this.logger.debug(`Read Organization`, {
      id: orgId,
      userId: session.userId,
    });

    const query = this.db
      .query()
      .call(matchRequestingUser, session)
      .match([node('node', 'Organization', { id: orgId })])
      .call(matchPermList)
      .call(matchPropList, 'permList')
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
      canDelete: true, // TODO
    };
  }

  async update(
    input: UpdateOrganization,
    session: Session
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

  async delete(id: string, session: Session): Promise<void> {
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
    session: Session
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
    _session: Session
  ): Promise<void> {
    try {
      await this.locationService.addLocationToNode(
        'Organization',
        organizationId,
        'locations',
        locationId
      );
    } catch (e) {
      throw new ServerException('Could not add location to organization', e);
    }
  }

  async removeLocation(
    organizationId: string,
    locationId: string,
    _session: Session
  ): Promise<void> {
    try {
      await this.locationService.removeLocationFromNode(
        'Organization',
        organizationId,
        'locations',
        locationId
      );
    } catch (e) {
      throw new ServerException(
        'Could not remove location from organization',
        e
      );
    }
  }

  async listLocations(
    organizationId: string,
    input: LocationListInput,
    session: Session
  ): Promise<SecuredLocationList> {
    return await this.locationService.listLocationsFromNode(
      'Organization',
      organizationId,
      'locations',
      input,
      session
    );
  }

  async checkAllOrgs(session: Session): Promise<boolean> {
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
      canDelete: true, // TODO
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

  async checkOrganizationConsistency(session: Session): Promise<boolean> {
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
