import {
  Injectable,
  NotFoundException,
  InternalServerErrorException as ServerException,
} from '@nestjs/common';
import { node, relation } from 'cypher-query-builder';
import { first, intersection, upperFirst } from 'lodash';
import { DateTime } from 'luxon';
import { generate } from 'shortid';
import { ISession } from '../../common';
import { DatabaseService, ILogger, Logger, matchSession } from '../../core';
import { CeremonyService } from '../ceremony';
import { CeremonyType } from '../ceremony/dto/type.enum';
import { LanguageService } from '../language';
import { LocationService } from '../location';
import {
  ProductListInput,
  ProductService,
  SecuredProductList,
} from '../product';
import { UserService } from '../user';
import {
  CreateInternshipEngagement,
  CreateLanguageEngagement,
  Engagement,
  EngagementListInput,
  EngagementListOutput,
  InternshipEngagement,
  LanguageEngagement,
  UpdateInternshipEngagement,
  UpdateLanguageEngagement,
} from './dto';

@Injectable()
export class EngagementService {
  constructor(
    private readonly db: DatabaseService,
    private readonly ceremonyService: CeremonyService,
    private readonly products: ProductService,
    private readonly userService: UserService,
    private readonly languageService: LanguageService,
    private readonly locationService: LocationService,
    @Logger(`engagement.service`) private readonly logger: ILogger
  ) {}
  async readOne(id: string, session: ISession): Promise<Engagement> {
    const qr = `
    MATCH (engagement {id: $id, active: true}) RETURN labels(engagement) as labels
    `;

    const results = await this.db.query().raw(qr, { id }).first();
    const label = first(
      intersection(results?.labels, [
        'LanguageEngagement',
        'InternshipEngagement',
      ])
    );

    if (label === 'LanguageEngagement') {
      return this.readLanguageEngagement(id, session);
    }
    return this.readInternshipEngagement(id, session);
  }

  async readLanguageEngagement(
    id: string,
    session: ISession
  ): Promise<Engagement> {
    this.logger.info('readLangaugeEnagement', { id, userId: session.userId });
    const leQuery = this.db
      .query()
      //.match(matchSession(session, { withAclRead: 'canReadEngagements' }))
      .match([
        node('languageEngagement', 'LanguageEngagement', {
          active: true,
          id,
        }),
      ])
      .optionalMatch([
        ...this.propMatch('firstScripture', 'languageEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('lukePartnership', 'languageEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('sentPrintingDate', 'languageEngagement'),
      ])
      .optionalMatch([...this.propMatch('completeDate', 'languageEngagement')])
      .optionalMatch([...this.propMatch('startDate', 'languageEngagement')])
      .optionalMatch([...this.propMatch('endDate', 'languageEngagement')])
      .optionalMatch([
        ...this.propMatch('disbursementCompleteDate', 'languageEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('communicationsCompleteDate', 'languageEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('initialEndDate', 'languageEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('lastSuspendedAt', 'languageEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('lastReactivatedAt', 'languageEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('statusModifiedAt', 'languageEngagement'),
      ])
      .optionalMatch([...this.propMatch('modifiedAt', 'languageEngagement')])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permCeremony', 'Permission', {
          property: 'ceremony',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('languageEngagement'),
        relation('out', '', 'ceremony', { active: true }),
        node('newCeremony', 'Ceremony', { active: true }),
        relation('out', '', 'type', { active: true }),
        node('ceremonyType', 'Property', { active: true }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permLanguage', 'Permission', {
          property: 'language',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('languageEngagement'),
        relation('out', '', 'language', { active: true }),
        node('newLanguage', 'Language', { active: true }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permStatus', 'Permission', {
          property: 'status',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('languageEngagement'),
        relation('out', '', 'status', { active: true }),
        node('engStatus', 'EngagementStatus', { active: true }),
      ])
      .optionalMatch([
        node('languageEngagement'),
        relation('in', '', 'engagement'),
        node('project', 'Project', { active: true }),
      ])
      .return({
        languageEngagement: [{ id: 'id', createdAt: 'createdAt' }],
        newLanguage: [{ id: 'languageId' }],
        newCeremony: [{ id: 'ceremonyId' }],
        project: ['project'],
        firstScripture: [{ value: 'firstScripture' }],
        lukePartnership: [{ value: 'lukePartnership' }],
        sentPrintingDate: [{ value: 'sentPrintingDate' }],
        engStatus: [{ value: 'status' }],
        completeDate: [{ value: 'completeDate' }],
        disbursementCompleteDate: [{ value: 'disbursementCompleteDate' }],
        communicationsCompleteDate: [{ value: 'communicationsCompleteDate' }],
        startDate: [{ value: 'startDate' }],
        endDate: [{ value: 'endDate' }],
        initialEndDate: [{ value: 'initialEndDate' }],
        lastSuspendedAt: [{ value: 'lastSuspendedAt' }],
        lastReactivatedAt: [{ value: 'lastReactivatedAt' }],
        statusModifiedAt: [{ value: 'statusModifiedAt' }],
        modifiedAt: [{ value: 'modifiedAt' }],
        permLanguage: [{ read: 'canReadLanguage', edit: 'canEditLanguage' }],
        permCeremony: [{ read: 'canReadCeremony', edit: 'canEditCeremony' }],
        canReadFirstScripture: [
          { read: 'canReadFirstScripture', edit: 'canEditFirstScripture' },
        ],
        canReadLukePartnership: [
          { read: 'canReadLukePartnership', edit: 'canEditLukePartnership' },
        ],
        canReadSentPrintingDate: [
          {
            read: 'canReadSentPrintingDate',
            edit: 'canEditSentPrintingDate',
          },
        ],
        permStatus: [{ read: 'canReadStatus', edit: 'canEditStatus' }],
        canReadCompleteDate: [
          { read: 'canReadCompleteDate', edit: 'canEditCompleteDate' },
        ],
        canReadDisbursementCompleteDate: [
          {
            read: 'canReadDisbursementCompleteDate',
            edit: 'canEditDisbursementCompleteDate',
          },
        ],
        canReadCommunicationsCompleteDate: [
          {
            read: 'canReadCommunicationsCompleteDate',
            edit: 'canEditCommunicationsCompleteDate',
          },
        ],
        canReadStartDate: [
          { read: 'canReadStartDate', edit: 'canEditStartDate' },
        ],
        canReadEndDate: [{ read: 'canReadEndDate', edit: 'canEditEndDate' }],
        canReadInitialEndDate: [
          { read: 'canReadInitialEndDate', edit: 'canEditInitialEndDate' },
        ],
        canReadLastSuspendedAt: [
          { read: 'canReadLastSuspendedAt', edit: 'canEditLastSuspendedAt' },
        ],
        canReadLastReactivatedAt: [
          {
            read: 'canReadLastReactivatedAt',
            edit: 'canEditLastReactivatedAt',
          },
        ],
        canReadStatusModifiedAt: [
          {
            read: 'canReadStatusModifiedAt',
            edit: 'canEditStatusModifiedAt',
          },
        ],
        canReadModifiedAt: [
          { read: 'canReadModifiedAt', edit: 'canEditModifiedAt' },
        ],
      });
    let result;
    try {
      //console.log('TEST', leQuery.buildQueryObject());
      result = await leQuery.first();
      //console.log('readone', result);
    } catch (error) {
      this.logger.error('could not read Language Enagement', error);
    }
    if (!result || !result.id) {
      throw new NotFoundException('could not find language Engagement');
    }
    const ceremony = result.ceremonyId
      ? await this.ceremonyService.readOne(result.ceremonyId, session)
      : undefined;

    const language = result.languageId
      ? await this.languageService.readOne(result.languageId, session)
      : undefined;

    const languageEngagement = {
      language: {
        value: language,
        canRead: !!result.canReadLanguage,
        canEdit: !!result.canEditLanguage,
      },
      firstScripture: {
        value: result.firstScripture,
        canRead: !!result.canReadFirstScripture,
        canEdit: !!result.canEditFirstScripture,
      },
      lukePartnership: {
        value: result.lukePartnership,
        canRead: !!result.canReadLukePartnership,
        canEdit: !!result.canEditLukePartnership,
      },
      sentPrintingDate: {
        value: result.sentPrintingDate,
        canRead: !!result.canReadSentPrintingDate,
        canEdit: !!result.canEditSentPrintingDate,
      },
    };

    return {
      id,
      createdAt: result.createdAt,
      ...languageEngagement,
      status: result.status,
      ceremony: {
        value: ceremony,
        canRead: !!result.canReadCeremony,
        canEdit: !!result.canEditCeremony,
      },
      completeDate: {
        value: result.completeDate,
        canRead: !!result.canReadCompleteDate,
        canEdit: !!result.canEditCompleteDate,
      },
      disbursementCompleteDate: {
        value: result.disbursementCompleteDate,
        canRead: !!result.CanReadDisbursementCompleteDate,
        canEdit: !!result.CanEditDisbursementCompleteDate,
      },
      communicationsCompleteDate: {
        value: result.communicationsCompleteDate,
        canRead: !!result.canReadCommunicationsCompleteDate,
        canEdit: !!result.canEditCommunicationsCompleteDate,
      },
      modifiedAt: result.modifiedAt,
      startDate: {
        value: result.startDate,
        canRead: !!result.canReadStartDate,
        canEdit: !!result.canEditStartDate,
      },
      endDate: {
        value: result.endDate,
        canRead: !!result.canReadEndDate,
        canEdit: !!result.canEditEndDate,
      },
      initialEndDate: {
        value: result.initialEndDate,
        canRead: !!result.canReadInitialEndDate,
        canEdit: !!result.canEditInitialEndDate,
      },
      lastSuspendedAt: {
        value: result.lastSuspendedAt,
        canRead: !!result.canReadLastSuspendedAt,
        canEdit: !!result.canEditLastSuspendedAt,
      },
      lastReactivatedAt: {
        value: result.lastReactivatedAt,
        canRead: !!result.canReadLastReactivatedAt,
        canEdit: !!result.canEditLastReactivatedAt,
      },
      statusModifiedAt: {
        value: result.statusModifiedAt,
        canRead: !!result.canReadStatusModifiedAt,
        canEdit: !!result.canEditStatusModifiedAt,
      },
    };
  }

  async list(
    { page, count, sort, order, filter }: EngagementListInput,
    session: ISession
  ): Promise<EngagementListOutput> {
    const matchNode =
      filter.type === 'internship'
        ? 'internship:InternshipEngagement'
        : filter.type === 'language'
        ? 'language:LanguageEngagement'
        : 'engagement';

    const tmpNode = matchNode.substring(0, matchNode.indexOf(':'));
    const node = tmpNode ? tmpNode : 'engagement';

    const query = `
      MATCH (${matchNode} {active: true})<-[:engagement {active: true}]-(project)
      RETURN ${node}.id as id
      ORDER BY ${node}.${sort} ${order}
      SKIP $skip LIMIT $count
    `;
    const result = await this.db
      .query()
      .raw(query, {
        skip: (page - 1) * count,
        count,
        type: filter.type,
      })
      .run();

    const items = await Promise.all(
      result.map((row) => this.readOne(row.id, session))
    );

    return {
      items,
      total: items.length,
      hasMore: false,
    };
  }

  // async list(
  //   { page, count, sort, order, filter }: EngagementListInput,
  //   session: ISession
  // ): Promise<EngagementListOutput> {
  //   const listQuery = this.db
  //     .query()
  //     .match(matchSession(session, { withAclRead: 'canReadProjects' }));
  //   listQuery
  //     .match([
  //       node('project', 'Project', { active: true, id: filter.projectId }),
  //       relation('out', '', 'engagement', { active: true }),
  //       node('engagement', 'BaseNode', { active: true }),
  //     ])
  //     .optionalMatch([
  //       node('requestingUser'),
  //       relation('in', '', 'member', { active: true }),
  //       node('sg', 'SecurityGroup', { active: true }),
  //       relation('out', '', 'permission', {
  //         active: true,
  //         property: 'engagement',
  //         read: true,
  //       }),
  //       node('canReadEngagement', 'Permission', { active: true }),
  //       relation('out', '', 'baseNode', { active: true }),
  //       node('project'),
  //     ])
  //     .return({
  //       canReadEngagement: [{ read: 'canRead' }],
  //       engagement: ['id', 'type'],
  //     });

  //   let result;
  //   try {
  //     result = await listQuery.run();
  //   } catch (e) {
  //     throw new NotFoundException('No engagements found');
  //   }
  //   let items;
  //   if (result) {
  //     items = await Promise.all(
  //       result.map((row) => this.readOne(row.id, session))
  //     );
  //   } else {
  //     throw new NotFoundException('No engagements found');
  //   }

  //   return {
  //     items,
  //     total: items.length,
  //     hasMore: false,
  //   };
  // }

  async listProducts(
    engagement: LanguageEngagement,
    input: ProductListInput,
    session: ISession
  ): Promise<SecuredProductList> {
    const result = await this.products.list(
      {
        ...input,
        filter: {
          ...input.filter,
          engagementId: engagement.id,
        },
      },
      session
    );

    return {
      ...result,
      canRead: true, // TODO
      canCreate: true, // TODO
    };
  }

  propMatch = (property: string, baseNode: string) => {
    const perm = 'canRead' + upperFirst(property);
    return [
      [
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node(perm, 'Permission', {
          property,
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node(baseNode),
        relation('out', '', property, { active: true }),
        node(property, 'Property', { active: true }),
      ],
    ];
  };

  // helper method for defining properties
  property = (prop: string, value: any, baseNode: string) => {
    if (!value) {
      return [];
    }
    const createdAt = DateTime.local();
    let propLabel = 'Property';
    if (prop === 'position') {
      propLabel = 'Property:InternPosition';
    } else if (prop === 'methodologies') {
      propLabel = 'Property:ProductMethodology';
    } else if (prop === 'status') {
      propLabel = 'Property:EngagementStatus';
    }
    return [
      [
        node(baseNode),
        relation('out', '', prop, {
          active: true,
          createdAt,
        }),
        node(prop, propLabel, {
          active: true,
          value,
        }),
      ],
    ];
  };

  // helper method for defining properties
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

  async createLanguageEngagement(
    { languageId, projectId, ...input }: CreateLanguageEngagement,
    session: ISession
  ): Promise<LanguageEngagement> {
    this.logger.info('Mutation create language engagement ', {
      input,
      projectId,
      languageId,
      userId: session.userId,
    });

    // Initial LanguageEngagement
    const id = generate();
    const createdAt = DateTime.local();
    const ceremony = await this.ceremonyService.create(
      { type: CeremonyType.Dedication },
      session
    );
    const createLE = this.db
      .query()
      .match(matchSession(session, { withAclEdit: 'canCreateEngagement' }))
      .create([
        [
          node('languageEngagement', 'LanguageEngagement:BaseNode', {
            active: true,
            createdAt,
            id,
            owningOrgId: session.owningOrgId,
          }),
        ],
        ...this.property(
          'completeDate',
          input.completeDate || undefined,
          'languageEngagement'
        ),
        ...this.property(
          'disbursementCompleteDate',
          input.disbursementCompleteDate || undefined,
          'languageEngagement'
        ),
        ...this.property(
          'communicationsCompleteDate',
          input.communicationsCompleteDate || undefined,
          'languageEngagement'
        ),
        ...this.property(
          'startDate',
          input.startDate || undefined,
          'languageEngagement'
        ),
        ...this.property(
          'lukePartnership',
          input.lukePartnership || undefined,
          'languageEngagement'
        ),
        ...this.property(
          'firstScripture',
          input.firstScripture || undefined,
          'languageEngagement'
        ),
        [
          node('adminSG', 'SecurityGroup', {
            active: true,
            createdAt,
            name: 'languageEngagement admin',
          }),
          relation('out', '', 'member', { active: true, createdAt }),
          node('requestingUser'),
        ],
        [
          node('readerSG', 'SecurityGroup', {
            active: true,
            createdAt,
            name: 'languageEngagement users',
          }),
          relation('out', '', 'member', { active: true, createdAt }),
          node('requestingUser'),
        ],
        ...this.permission('firstScripture', 'languageEngagement'),
        ...this.permission('lukePartnership', 'languageEngagement'),
        ...this.permission('completeDate', 'languageEngagement'),
        ...this.permission('disbursementCompleteDate', 'languageEngagement'),
        ...this.permission('communicationsCompleteDate', 'languageEngagement'),
        ...this.permission('startDate', 'languageEngagement'),
        ...this.permission('endDate', 'languageEngagement'),
        ...this.permission('ceremony', 'languageEngagement'),
        ...this.permission('language', 'languageEngagement'),
        ...this.permission('status', 'languageEngagement'),
      ])
      .return('languageEngagement');

    try {
      await createLE.first();
    } catch (e) {
      this.logger.error('could not create Language Engagement ', e);
      throw new ServerException('Could not create Langauge Engagement');
    }
    // connect Language and Project to LanguageEngagement.
    const query = `
        MATCH
          (project:Project {id: $projectId, active: true}),
          (language:Language {id: $languageId, active: true}),
          (ceremony:Ceremony {id: $ceremonyId, active: true}),
          (languageEngagement:LanguageEngagement {id: $id, active: true})
        CREATE
          (project)-[:engagement {active:true, createAt: datetime()}]->(languageEngagement),
          (languageEngagement)-[:language {active: true, createAt: datetime()}]->(language),
          (languageEngagement)-[:ceremony {active: true, createAt: datetime()}]->(ceremony)
        RETURN languageEngagement.id as id
      `;
    await this.db
      .query()
      .raw(query, {
        languageId: languageId,
        projectId: projectId,
        ceremonyId: ceremony.id,
        id,
      })
      .first();

    const res = (await this.readLanguageEngagement(
      id,
      session
    )) as LanguageEngagement;
    return res;
  }

  async createInternshipEngagement(
    {
      projectId,
      internId,
      mentorId,
      countryOfOriginId,
      ...input
    }: CreateInternshipEngagement,
    session: ISession
  ): Promise<InternshipEngagement> {
    this.logger.info('Mutation create internship engagement ', {
      input,
      projectId,
      mentorId,
      countryOfOriginId,
      userId: session.userId,
    });
    const id = generate();
    const createdAt = DateTime.local();
    const ceremony = await this.ceremonyService.create(
      { type: CeremonyType.Certification },
      session
    );

    const createIE = this.db
      .query()
      .match(matchSession(session, { withAclEdit: 'canCreateEngagement' }))
      .create([
        [
          node('internshipEngagement', 'InternshipEngagement:BaseNode', {
            active: true,
            createdAt,
            id,
            owningOrgId: session.owningOrgId,
          }),
        ],
        ...this.property(
          'completeDate',
          input.completeDate || undefined,
          'internshipEngagement'
        ),
        ...this.property(
          'disbursementCompleteDate',
          input.disbursementCompleteDate || undefined,
          'internshipEngagement'
        ),
        ...this.property(
          'communicationsCompleteDate',
          input.communicationsCompleteDate || undefined,
          'internshipEngagement'
        ),
        ...this.property(
          'startDate',
          input.startDate || undefined,
          'internshipEngagement'
        ),
        ...this.property(
          'endDate',
          input.endDate || undefined,
          'internshipEngagement'
        ),
        ...this.property(
          'methodologies',
          input.methodologies || undefined,
          'internshipEngagement'
        ),
        ...this.property(
          'position',
          input.position || undefined,
          'internshipEngagement'
        ),
        [
          node('adminSG', 'SecurityGroup', {
            active: true,
            createdAt,
            name: 'internEngagement admin',
          }),
          relation('out', '', 'member', { active: true, createdAt }),
          node('requestingUser'),
        ],
        [
          node('readerSG', 'SecurityGroup', {
            active: true,
            createdAt,
            name: 'internEngagement users',
          }),
          relation('out', '', 'member', { active: true, createdAt }),
          node('requestingUser'),
        ],
        ...this.permission('completeDate', 'internshipEngagement'),
        ...this.permission(
          'communicationsCompleteDate',
          'internshipEngagement'
        ),
        ...this.permission('disbursementCompleteDate', 'internshipEngagement'),
        ...this.permission('endDate', 'internshipEngagement'),
        ...this.permission('methodologies', 'internshipEngagement'),
        ...this.permission('position', 'internshipEngagement'),
        ...this.permission('endDate', 'internshipEngagement'),
        ...this.permission('startDate', 'internshipEngagement'),
        ...this.permission('language', 'internshipEngagement'),
        ...this.permission('status', 'internshipEngagement'),
        ...this.permission('countryOfOrigin', 'internshipEngagement'),
        ...this.permission('ceremony', 'internshipEngagement'),
        ...this.permission('intern', 'internshipEngagement'),
        ...this.permission('mentor', 'internshipEngagement'),
      ])
      .return('internshipEngagement');

    try {
      const result = await createIE.first();
      //console.log('result', JSON.stringify(result, null, 2));
    } catch (e) {
      this.logger.error('could not create Internship Engagement ', e);
      throw new ServerException('Could not create Internship Engagement');
    }
    const countryCond = `${
      typeof countryOfOriginId !== 'undefined'
        ? ',(countryOfOrigin:Country {id: $countryOfOriginId, active: true})'
        : ','
    }`;
    const mentorCond = `${
      typeof mentorId !== 'undefined'
        ? ',(mentorUser:User {id: $mentorId, active: true})'
        : ''
    }`;
    const countryRel = `${
      typeof countryOfOriginId !== 'undefined'
        ? ',(internshipEngagement)-[:countryOfOrigin {active: true, createdAt: datetime()}]->(countryOfOrigin)'
        : ''
    }`;
    const mentorRel = `${
      typeof mentorId !== 'undefined'
        ? ',(internshipEngagement)-[:mentor {active: true, createdAt: datetime()}]->(mentorUser)'
        : ''
    }`;
    const query = `
        MATCH
          (project:Project {id: $projectId, active: true})
          ,(internshipEngagement:InternshipEngagement {id: $id, active: true})
          ,(ceremony:Ceremony {id: $ceremonyId, active:true})
          ,(internUser:User {id: $internId, active: true})
          ${countryCond}${mentorCond}
        CREATE
          (internshipEngagement)<-[:engagement {active: true, createdAt: datetime()}]-(project)
          ,(internshipEngagement)-[:ceremony {active: true, createdAt: datetime()}]->(ceremony)
          ,(internshipEngagement)-[:intern {active: true, createdAt: datetime()}]->(internUser)
          ${countryRel}${mentorRel}
        RETURN
          internshipEngagement.id as id
      `;

    try {
      await this.db
        .query()
        .raw(query, {
          id,
          projectId: projectId,
          internId: internId,
          mentorId: mentorId,
          countryOfOriginId: countryOfOriginId,
          ceremonyId: ceremony.id,
        })
        .first();

      return (await this.readInternshipEngagement(
        id,
        session
      )) as InternshipEngagement;
    } catch (e) {
      this.logger.error(e);
      throw new ServerException(`Could not create InternshipEngagement`);
    }
  }

  async readInternshipEngagement(
    id: string,
    session: ISession
  ): Promise<Engagement> {
    this.logger.info('readInternshipEnagement', { id, userId: session.userId });
    const ieQuery = this.db
      .query()
      //.match(matchSession(session, { withAclRead: 'canReadEngagements' }))
      .match([
        node('internshipEngagement', 'InternshipEngagement', {
          active: true,
          id,
        }),
      ])
      .optionalMatch([
        ...this.propMatch('completeDate', 'internshipEngagement'),
      ])
      .optionalMatch([...this.propMatch('startDate', 'internshipEngagement')])
      .optionalMatch([...this.propMatch('endDate', 'internshipEngagement')])
      .optionalMatch([
        ...this.propMatch('disbursementCompleteDate', 'internshipEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('communicationsCompleteDate', 'internshipEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('initialEndDate', 'internshipEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('lastSuspendedAt', 'internshipEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('lastReactivatedAt', 'internshipEngagement'),
      ])
      .optionalMatch([
        ...this.propMatch('statusModifiedAt', 'internshipEngagement'),
      ])
      .optionalMatch([...this.propMatch('modifiedAt', 'internshipEngagement')])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permCeremony', 'Permission', {
          property: 'ceremony',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('internshipEngagement'),
        relation('out', '', 'ceremony', { active: true }),
        node('newCeremony', 'Ceremony', { active: true }),
        relation('out', '', 'type', { active: true }),
        node('ceremonyType', 'Property', { active: true }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permStatus', 'Permission', {
          property: 'status',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('internshipEngagement'),
        relation('out', '', 'status', { active: true }),
        node('engStatus', 'EngagementStatus', { active: true }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permPosition', 'Permission', {
          property: 'position',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('internshipEngagement'),
        relation('out', '', 'position', { active: true }),
        node('internPosition', 'InternPosition', { active: true }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permCountryOfOrigin', 'Permission', {
          property: 'countryOfOrigin',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('internshipEngagement'),
        relation('out', '', 'countryOfOrigin', { active: true }),
        node('country', 'Country', { active: true }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permMethodologies', 'Permission', {
          property: 'methodologies',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('internshipEngagement'),
        relation('out', '', 'methodologies', { active: true }),
        node('methodologies', ['Property'], {
          active: true,
        }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permMentor', 'Permission', {
          property: 'mentor',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('internshipEngagement'),
        relation('out', '', 'mentor', { active: true }),
        node('mentor', 'User', { active: true }),
      ])
      .optionalMatch([
        node('requestingUser'),
        relation('in', '', 'member', { active: true }),
        node('sg', 'SecurityGroup', { active: true }),
        relation('out', '', 'permission', { active: true }),
        node('permIntern', 'Permission', {
          property: 'intern',
          active: true,
          read: true,
        }),
        relation('out', '', 'baseNode', { active: true }),
        node('internshipEngagement'),
        relation('out', '', 'intern', { active: true }),
        node('intern', 'User', { active: true }),
      ])
      .optionalMatch([
        node('internshipEngagement'),
        relation('in', '', 'engagement'),
        node('project', 'Project', { active: true }),
      ])
      .return({
        internshipEngagement: [{ id: 'id', createdAt: 'createdAt' }],
        intern: [{ id: 'internUserId' }],
        mentor: [{ id: 'mentorUserId' }],
        country: [{ id: 'countryOfOriginId' }],
        newCeremony: [{ id: 'ceremonyId' }],
        project: [{ id: 'projectId' }],
        engStatus: [{ value: 'status' }],
        completeDate: [{ value: 'completeDate' }],
        disbursementCompleteDate: [{ value: 'disbursementCompleteDate' }],
        communicationsCompleteDate: [{ value: 'communicationsCompleteDate' }],
        startDate: [{ value: 'startDate' }],
        endDate: [{ value: 'endDate' }],
        initialEndDate: [{ value: 'initialEndDate' }],
        lastSuspendedAt: [{ value: 'lastSuspendedAt' }],
        lastReactivatedAt: [{ value: 'lastReactivatedAt' }],
        statusModifiedAt: [{ value: 'statusModifiedAt' }],
        modifiedAt: [{ value: 'modifiedAt' }],
        methodologies: [{ value: 'methodologies' }],
        internPosition: [{ value: 'position' }],
        permPosition: [{ read: 'canReadPosition', edit: 'canEditPosition' }],
        permStatus: [{ read: 'canReadStatus', edit: 'canEditStatus' }],
        canReadCompleteDate: [
          { read: 'canReadCompleteDate', edit: 'canEditCompleteDate' },
        ],
        permMethodologies: [
          {
            read: 'canReadMethodologies',
            edit: 'canEditMethodologies',
          },
        ],
        canReadDisbursementCompleteDate: [
          {
            read: 'canReadDisbursementCompleteDate',
            edit: 'canEditDisbursementCompleteDate',
          },
        ],
        canReadCommunicationsCompleteDate: [
          {
            read: 'canReadCommunicationsCompleteDate',
            edit: 'canEditCommunicationsCompleteDate',
          },
        ],
        canReadStartDate: [
          { read: 'canReadStartDate', edit: 'canEditStartDate' },
        ],
        canReadEndDate: [{ read: 'canReadEndDate', edit: 'canEditEndDate' }],
        canReadInitialEndDate: [
          { read: 'canReadInitialEndDate', edit: 'canEditInitialEndDate' },
        ],
        canReadLastSuspendedAt: [
          { read: 'canReadLastSuspendedAt', edit: 'canEditLastSuspendedAt' },
        ],
        canReadLastReactivatedAt: [
          {
            read: 'canReadLastReactivatedAt',
            edit: 'canEditLastReactivatedAt',
          },
        ],
        canReadStatusModifiedAt: [
          {
            read: 'canReadStatusModifiedAt',
            edit: 'canEditStatusModifiedAt',
          },
        ],
        canReadModifiedAt: [
          { read: 'canReadModifiedAt', edit: 'canEditModifiedAt' },
        ],
      });
    let result;
    try {
      result = await ieQuery.first();
    } catch (error) {
      this.logger.error('could not read Internship Enagement', error);
    }
    if (!result || !result.id) {
      throw new NotFoundException('could not find internship Engagement');
    }

    const ceremony = result.ceremonyId
      ? await this.ceremonyService.readOne(result.ceremonyId, session)
      : undefined;

    const internUser = result.internUserId
      ? await this.userService.readOne(result.internUserId, session)
      : undefined;

    const mentorUser = result.mentorUserId
      ? await this.userService.readOne(result.mentorUserId, session)
      : undefined;

    const countryOfOrigin = result.countryOfOriginId
      ? await this.locationService.readOneCountry(
          result.countryOfOriginId,
          session
        )
      : undefined;

    const internshipEngagement = {
      position: {
        value: result.position,
        canRead: !!result.canReadPosition,
        canEdit: !!result.canEditPosition,
      },
      methodologies: {
        value: result.methodologies,
        canRead: !!result.canReadMethodologies,
        canEdit: !!result.canEditMethodologies,
      },
      intern: {
        value: internUser,
        canRead: !!result.canReadIntern,
        canEdit: !!result.canEditIntern,
      },
      mentor: {
        value: mentorUser,
        canRead: !!result.canReadMentor,
        canEdit: !!result.canEditMentor,
      },
      countryOfOrigin: {
        value: countryOfOrigin,
        canRead: !!result.canReadCountryOfOrigin,
        canEdit: !!result.canEditCountryOfOrigin,
      },
    };

    return {
      id,
      createdAt: result.createdAt,
      ...internshipEngagement,
      status: result.status,
      ceremony: {
        value: ceremony,
        canRead: !!result.canReadCeremony,
        canEdit: !!result.canEditCeremony,
      },
      completeDate: {
        value: result.completeDate,
        canRead: !!result.canReadCompleteDate,
        canEdit: !!result.canEditCompleteDate,
      },
      disbursementCompleteDate: {
        value: result.disbursementCompleteDate,
        canRead: !!result.CanReadDisbursementCompleteDate,
        canEdit: !!result.CanEditDisbursementCompleteDate,
      },
      communicationsCompleteDate: {
        value: result.communicationsCompleteDate,
        canRead: !!result.canReadCommunicationsCompleteDate,
        canEdit: !!result.canEditCommunicationsCompleteDate,
      },
      modifiedAt: result.modifiedAt,
      startDate: {
        value: result.startDate,
        canRead: !!result.canReadStartDate,
        canEdit: !!result.canEditStartDate,
      },
      endDate: {
        value: result.endDate,
        canRead: !!result.canReadEndDate,
        canEdit: !!result.canEditEndDate,
      },
      initialEndDate: {
        value: result.initialEndDate,
        canRead: !!result.canReadInitialEndDate,
        canEdit: !!result.canEditInitialEndDate,
      },
      lastSuspendedAt: {
        value: result.lastSuspendedAt,
        canRead: !!result.canReadLastSuspendedAt,
        canEdit: !!result.canEditLastSuspendedAt,
      },
      lastReactivatedAt: {
        value: result.lastReactivatedAt,
        canRead: !!result.canReadLastReactivatedAt,
        canEdit: !!result.canEditLastReactivatedAt,
      },
      statusModifiedAt: {
        value: result.statusModifiedAt,
        canRead: !!result.canReadStatusModifiedAt,
        canEdit: !!result.canEditStatusModifiedAt,
      },
    };
  }

  async updateLanguageEngagement(
    input: UpdateLanguageEngagement,
    session: ISession
  ): Promise<LanguageEngagement> {
    try {
      const object = await this.readOne(input.id, session);
      await this.db.sgUpdateProperties({
        session,
        object,
        props: [
          'firstScripture',
          'lukePartnership',
          'completeDate',
          'disbursementCompleteDate',
          'communicationsCompleteDate',
          'startDate',
          'endDate',
        ],
        changes: {
          ...input,
        },
        nodevar: 'LanguageEngagement',
      });

      return (await this.readOne(input.id, session)) as LanguageEngagement;
    } catch (e) {
      this.logger.error(e);
      throw new ServerException('Could not update LanguageEngagement');
    }
  }

  async updateInternshipEngagement(
    { mentorId, countryOfOriginId, ...input }: UpdateInternshipEngagement,
    session: ISession
  ): Promise<InternshipEngagement> {
    try {
      if (mentorId) {
        await this.db
          .query()
          .match(matchSession(session))
          .match([
            node('newMentorUser', 'User', { active: true, id: mentorId }),
          ])
          .match([
            node('internshipEngagement', 'InternshipEngagement', {
              active: true,
              id: input.id,
            }),
            relation('out', 'rel', 'mentor', { active: true }),
            node('oldMentorUser', 'User'),
          ])
          .delete('rel')
          .create([
            node('internshipEngagement'),
            relation('out', '', 'mentor', {
              active: true,
              createdAt: DateTime.local(),
            }),
            node('newMentorUser'),
          ])
          .return('internshipEngagement.id as id')
          .first();
      }

      if (countryOfOriginId) {
        await this.db
          .query()
          .match([
            node('newCountry', 'Country', {
              active: true,
              id: countryOfOriginId,
            }),
          ])
          .match([
            node('internshipEngagement', 'InternshipEngagement', {
              active: true,
              id: input.id,
            }),
            relation('out', 'rel', 'countryOfOrigin', { active: true }),
            node('oldCountry', 'Country'),
          ])
          .delete('rel')
          .create([
            node('internshipEngagement'),
            relation('out', '', 'countryOfOrigin', {
              active: true,
              createdAt: DateTime.local(),
            }),
            node('newCountry'),
          ])
          .return('internshipEngagement.id as id')
          .first();
      }
      const object = await this.readInternshipEngagement(input.id, session);
      await this.db.sgUpdateProperties({
        session,
        object,
        props: [
          'position',
          'methodologies',
          'completeDate',
          'disbursementCompleteDate',
          'communicationsCompleteDate',
          'startDate',
          'endDate',
        ],
        changes: {
          ...input,
        },
        nodevar: 'InternshipEngagement',
      });
      // update property node labels
      Object.keys(input).map(async (ele) => {
        if (ele === 'position') {
          await this.db.addLabelsToPropNodes(input.id, 'position', [
            'InternPosition',
          ]);
        }
        if (ele === 'methodologies') {
          await this.db.addLabelsToPropNodes(input.id, 'methodologies', [
            'ProductMethodology',
          ]);
        }
      });
      const result = await this.readInternshipEngagement(input.id, session);
      return result as InternshipEngagement;
    } catch (e) {
      this.logger.warning('Failed to update InternshipEngagement', {
        exception: e,
      });
      throw new ServerException('Could not find update InternshipEngagement');
    }
  }

  async delete(id: string, session: ISession): Promise<void> {
    const object = await this.readOne(id, session);

    if (!object) {
      throw new NotFoundException('Could not find engagement');
    }

    try {
      await this.db.deleteNode({
        session,
        object,
        aclEditProp: 'canDeleteOwnUser',
      });
    } catch (e) {
      this.logger.warning('Failed to delete partnership', {
        exception: e,
      });

      throw new ServerException('Failed to delete partnership');
    }
  }

  async checkEngagementConsistency(
    baseNode: string,
    session: ISession
  ): Promise<boolean> {
    const nodes = await this.db
      .query()
      .match([
        node('eng', baseNode, {
          active: true,
        }),
      ])
      .return('eng.id as id')
      .run();
    if (baseNode === 'InternshipEngagement') {
      return this.isInternshipEngagementConsistent(nodes, baseNode, session);
    }
    if (baseNode === 'LanguageEngagement') {
      return this.isLanguageEngagementConsistent(nodes, baseNode, session);
    }
    return false;
  }

  async isLanguageEngagementConsistent(
    nodes: Record<string, any>,
    baseNode: string,
    session: ISession
  ): Promise<boolean> {
    const requiredProperties: never[] = []; // add more after discussing
    return (
      (
        await Promise.all(
          nodes.map(async (ie: { id: any }) =>
            ['language'] // singletons
              .map((rel) =>
                this.db.isRelationshipUnique({
                  session,
                  id: ie.id,
                  relName: rel,
                  srcNodeLabel: 'LanguageEngagement',
                })
              )
              .every((n) => n)
          )
        )
      ).every((n) => n) &&
      (
        await Promise.all(
          nodes.map(async (ie: { id: any }) =>
            this.db.hasProperties({
              session,
              id: ie.id,
              props: requiredProperties,
              nodevar: 'LanguageEngagement',
            })
          )
        )
      ).every((n) => n)
    );
  }

  async isInternshipEngagementConsistent(
    nodes: Record<string, any>,
    baseNode: string,
    session: ISession
  ): Promise<boolean> {
    // right now all properties are optional
    const requiredProperties: never[] = [];
    return (
      (
        await Promise.all(
          nodes.map(async (ie: { id: any }) =>
            ['intern'] // optional – mentor, status, ceremony, countryOfOrigin
              .map((rel) =>
                this.db.isRelationshipUnique({
                  session,
                  id: ie.id,
                  relName: rel,
                  srcNodeLabel: 'InternshipEngagement',
                })
              )
              .every((n) => n)
          )
        )
      ).every((n) => n) &&
      (
        await Promise.all(
          nodes.map(async (ie: { id: any }) =>
            this.db.hasProperties({
              session,
              id: ie.id,
              props: requiredProperties,
              nodevar: 'InternshipEngagement',
            })
          )
        )
      ).every((n) => n)
    );
  }
}
