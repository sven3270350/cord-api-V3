import { Injectable } from '@nestjs/common';
import { stripIndent } from 'common-tags';
import { node, Query, relation } from 'cypher-query-builder';
import { DateTime } from 'luxon';
import {
  generateId,
  ID,
  NotFoundException,
  ServerException,
  Session,
  UnsecuredDto,
} from '../../common';
import {
  createBaseNode,
  DtoRepository,
  matchRequestingUser,
  Property,
} from '../../core';
import {
  calculateTotalAndPaginateList,
  matchChangesetAndChangedProps,
  matchProps,
  matchPropsAndProjectSensAndScopedRoles,
  permissionsOfNode,
  requestingUser,
} from '../../core/database/query';
import {
  CreatePartnership,
  Partnership,
  PartnershipAgreementStatus,
  PartnershipListInput,
} from './dto';

@Injectable()
export class PartnershipRepository extends DtoRepository(Partnership) {
  async create(input: CreatePartnership, session: Session, changeset?: ID) {
    const partnershipId = await generateId();
    const mouId = await generateId();
    const agreementId = await generateId();

    const props: Property[] = [
      {
        key: 'agreementStatus',
        value: input.agreementStatus || PartnershipAgreementStatus.NotAttached,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'agreement',
        value: agreementId,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mou',
        value: mouId,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mouStatus',
        value: input.mouStatus || PartnershipAgreementStatus.NotAttached,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mouStartOverride',
        value: input.mouStartOverride,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'mouEndOverride',
        value: input.mouEndOverride,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'types',
        value: input.types,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'financialReportingType',
        value: input.financialReportingType,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'canDelete',
        value: true,
        isPublic: false,
        isOrgPublic: false,
      },
      {
        key: 'primary',
        value: input.primary,
        isPublic: false,
        isOrgPublic: false,
      },
    ];
    const result = await this.db
      .query()
      .apply(matchRequestingUser(session))
      .apply(createBaseNode(partnershipId, 'Partnership', props))
      .with('node')
      .match([
        [
          node('partner', 'Partner', {
            id: input.partnerId,
          }),
        ],
        [node('project', 'Project', { id: input.projectId })],
      ])
      .create([
        node('project'),
        relation('out', '', 'partnership', {
          active: !changeset,
          createdAt: DateTime.local(),
        }),
        node('node'),
        relation('out', '', 'partner', {
          active: true,
          createdAt: DateTime.local(),
        }),
        node('partner'),
      ])
      .apply((q) =>
        changeset
          ? q
              .with('node')
              .match([node('changesetNode', 'Changeset', { id: changeset })])
              .create([
                node('changesetNode'),
                relation('out', '', 'changeset', {
                  active: true,
                  createdAt: DateTime.local(),
                }),
                node('node'),
              ])
          : q
      )
      .return('node.id as id')
      .asResult<{ id: ID }>()
      .first();
    if (!result) {
      throw new ServerException('Failed to create partnership');
    }
    return { id: partnershipId, mouId, agreementId };
  }

  async readOne(id: ID, session: Session, changeset?: ID) {
    const query = this.db
      .query()
      .subQuery((sub) =>
        sub
          .match([
            node('project'),
            relation('out', '', 'partnership', { active: true }),
            node('node', 'Partnership', { id }),
          ])
          .return('project, node')
          .apply((q) =>
            changeset
              ? q
                  .union()
                  .match([
                    node('project'),
                    relation('out', '', 'partnership', { active: false }),
                    node('node', 'Partnership', { id }),
                    relation('in', '', 'changeset', { active: true }),
                    node('changeset', 'Changeset', { id: changeset }),
                  ])
                  .return('project, node')
              : q
          )
      )
      .match([
        node('node'),
        relation('out', '', 'partner'),
        node('partner', 'Partner'),
        relation('out', '', 'organization', { active: true }),
        node('org', 'Organization'),
      ])
      .apply(matchPropsAndProjectSensAndScopedRoles(session))
      .apply(matchChangesetAndChangedProps(changeset))
      .apply(matchProps({ nodeName: 'project', outputVar: 'projectProps' }))
      .apply(
        matchProps({
          nodeName: 'project',
          changeset,
          optional: true,
          outputVar: 'projectChangedProps',
        })
      )
      .return<{ dto: UnsecuredDto<Partnership> }>(
        stripIndent`
          apoc.map.mergeList([
            props,
            changedProps,
            {
              mouStart: coalesce(changedProps.mouStartOverride, props.mouStartOverride, projectChangedProps.mouStart, projectProps.mouStart),
              mouEnd: coalesce(changedProps.mouEndOverride, props.mouEndOverride, projectChangedProps.mouEnd, projectProps.mouEnd),
              project: project.id,
              partner: partner.id,
              organization: org.id,
              changeset: changeset.id,
              scope: scopedRoles
            }
          ]) as dto`
      );

    const result = await query.first();
    if (!result) {
      throw new NotFoundException('Could not find partnership');
    }

    return result.dto;
  }

  list(
    { filter, ...input }: PartnershipListInput,
    session: Session,
    changeset?: ID
  ) {
    return this.db
      .query()
      .subQuery((sub) =>
        sub
          .match([
            requestingUser(session),
            ...permissionsOfNode('Partnership'),
            ...(filter.projectId
              ? [
                  relation('in', '', 'partnership', { active: true }),
                  node('project', 'Project', { id: filter.projectId }),
                ]
              : []),
          ])
          .return('node')
          .apply((q) =>
            changeset && filter.projectId
              ? q
                  .union()
                  .match([
                    node('', 'Project', { id: filter.projectId }),
                    relation('out', '', 'partnership', { active: false }),
                    node('node', 'Partnership'),
                    relation('in', '', 'changeset', { active: true }),
                    node('changeset', 'Changeset', { id: changeset }),
                  ])
                  .return('node')
              : q
          )
      )
      .apply(calculateTotalAndPaginateList(Partnership, input));
  }

  async verifyRelationshipEligibility(projectId: ID, partnerId: ID) {
    return (
      (await this.db
        .query()
        .optionalMatch(node('partner', 'Partner', { id: partnerId }))
        .optionalMatch(node('project', 'Project', { id: projectId }))
        .optionalMatch([
          node('project'),
          relation('out', '', 'partnership', { active: true }),
          node('partnership'),
          relation('out', '', 'partner', { active: true }),
          node('partner'),
        ])
        .return(['partner', 'project', 'partnership'])
        .asResult<{ partner?: Node; project?: Node; partnership?: Node }>()
        .first()) ?? {}
    );
  }

  async isFirstPartnership(projectId: ID) {
    const result = await this.db
      .query()
      .match([
        node('project', 'Project', { id: projectId }),
        relation('out', '', 'partnership', { active: true }),
        node('partnership'),
      ])
      .return(['partnership'])
      .asResult<{ partnership?: Node }>()
      .first();
    return !result?.partnership;
  }

  async isAnyOtherPartnerships(id: ID) {
    const result = await this.db
      .query()
      .apply(this.matchOtherPartnerships(id))
      .return('otherPartnership.id')
      .first();
    return !!result;
  }

  async removePrimaryFromOtherPartnerships(id: ID) {
    await this.db
      .query()
      .apply(this.matchOtherPartnerships(id))
      .match([
        node('otherPartnership'),
        relation('out', 'oldRel', 'primary', { active: true }),
        node('', 'Property'),
      ])
      .setValues({
        'oldRel.active': false,
      })
      .with('otherPartnership')
      .create([
        node('otherPartnership'),
        relation('out', '', 'primary', {
          active: true,
          createdAt: DateTime.local(),
        }),
        node('newProperty', 'Property', {
          createdAt: DateTime.local(),
          value: false,
          sortValue: false,
        }),
      ])
      .run();
  }

  private matchOtherPartnerships(id: ID) {
    return (query: Query) => {
      query
        .match([
          node('partnership', 'Partnership', { id }),
          relation('in', '', 'partnership', { active: true }),
          node('project', 'Project'),
          relation('out', '', 'partnership', { active: true }),
          node('otherPartnership'),
        ])
        .raw('WHERE partnership <> otherPartnership')
        .with('otherPartnership');
    };
  }
}
