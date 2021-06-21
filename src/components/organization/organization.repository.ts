import { Injectable } from '@nestjs/common';
import { node, Query, relation } from 'cypher-query-builder';
import { DateTime } from 'luxon';
import { generateId, ID, Session } from '../../common';
import {
  createBaseNode,
  DtoRepository,
  matchRequestingUser,
  Property,
} from '../../core';
import {
  calculateTotalAndPaginateList,
  matchPropList,
  permissionsOfNode,
  requestingUser,
} from '../../core/database/query';
import { DbPropsOfDto, StandardReadResult } from '../../core/database/results';
import { CreateOrganization, Organization, OrganizationListInput } from './dto';

@Injectable()
export class OrganizationRepository extends DtoRepository(Organization) {
  // assumes 'root' cypher variable is declared in query
  private readonly createSG =
    (cypherIdentifier: string, id: ID, label?: string) => (query: Query) => {
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

  async checkOrg(name: string) {
    return await this.db
      .query()
      .raw(`MATCH(org:OrgName {value: $name}) return org`, {
        name: name,
      })
      .first();
  }

  async create(input: CreateOrganization, session: Session, id: string) {
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
      {
        key: 'canDelete',
        value: true,
        isPublic: false,
        isOrgPublic: false,
      },
    ];
    // const baseMetaProps = [];

    const query = this.db
      .query()
      .match([
        node('publicSG', 'PublicSecurityGroup', {
          id,
        }),
      ])
      .apply(matchRequestingUser(session))
      .apply(
        this.createSG('orgSG', await generateId(), 'OrgPublicSecurityGroup')
      )
      .apply(createBaseNode(await generateId(), 'Organization', secureProps))
      .return<{ id: ID }>('node.id as id');

    return await query.first();
  }

  async readOne(orgId: ID, session: Session) {
    const query = this.db
      .query()
      .apply(matchRequestingUser(session))
      .match([node('node', 'Organization', { id: orgId })])
      .apply(matchPropList)
      .return('propList, node')
      .asResult<StandardReadResult<DbPropsOfDto<Organization>>>();
    return await query.first();
  }

  list({ filter, ...input }: OrganizationListInput, session: Session) {
    return this.db
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
      .apply(calculateTotalAndPaginateList(Organization, input));
  }
}
