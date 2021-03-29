import { DbBudget } from '../../budget/model';
import { DbBudgetRecord } from '../../budget/model/budget-record.model.db';
import { DbCeremony } from '../../ceremony/model';
import { DbInternshipEngagement, DbLanguageEngagement } from '../../engagement/model';
import { DbFieldRegion } from '../../field-region/model';
import { DbFieldZone } from '../../field-zone/model';
import { DbDirectory, DbFile } from '../../file/model';
import { DbFileVersion } from '../../file/model/file-version.model.db';
import { DbFilm } from '../../film/model';
import { DbFundingAccount } from '../../funding-account/model';
import { DbEthnologueLanguage, DbLanguage } from '../../language/model';
import { DbLiteracyMaterial } from '../../literacy-material/model';
import { DbLocation } from '../../location/model';
import { DbOrganization } from '../../organization/model';
import { DbPartner } from '../../partner/model';
import { DbPartnership } from '../../partnership/model';
import { DbPost } from '../../post/model';
import { DbProduct } from '../../product/model';
/* eslint-disable @typescript-eslint/naming-convention */
import { DbProject } from '../../project/model';
import { DbProjectMember } from '../../project/project-member/model';
import { DbSong } from '../../song/model';
import { DbStory } from '../../story/model';
import { DbEducation, DbUnavailability, DbUser } from '../../user/model';
import { Role } from '../dto';
import { Powers } from '../dto/powers';
import { DbBaseNodeGrant, DbRole } from '../model';

// do not auto format this file
// turned off prettier for role files to prevent auto-format making this file huge

const read = true;
const write = true;

export const Intern = new DbRole({
  name: `global:${Role.Intern}` as const,
  powers: [
    Powers.CreateDirectory,
    Powers.CreateEducation,
    Powers.CreateFile,
    Powers.CreateFileVersion,
    Powers.CreateUnavailability,
    Powers.CreateUser,
  ],
  grants: [
    new DbBaseNodeGrant<DbBudget>({
      __className: 'DbBudget',
      properties: [
        { propertyName: 'universalTemplateFile',      permission: { read, write, }, },
        { propertyName: 'records',                    permission: { read, write, }, },
        { propertyName: 'status',                     permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbBudgetRecord>({
      __className: 'DbBudgetRecord',
      properties: [
        { propertyName: 'amount',                     permission: { read, write, }, },
        { propertyName: 'fiscalYear',                 permission: { read, write, }, },
        { propertyName: 'organization',               permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbCeremony>({
      __className: 'DbCeremony',
      properties: [
        { propertyName: 'actualDate',                 permission: { read, write, }, },
        { propertyName: 'estimatedDate',              permission: { read, write, }, },
        { propertyName: 'planned',                    permission: { read, write, }, },
        { propertyName: 'type',                       permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbDirectory>({
      __className: 'DbDirectory',
      properties: [
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'createdBy',                  permission: { read, write, }, },
        { propertyName: 'parent',                     permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbEducation>({
      __className: 'DbEducation',
      properties: [
        { propertyName: 'degree',                     permission: { read, }, },
        { propertyName: 'institution',                permission: { read, }, },
        { propertyName: 'major',                      permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbEthnologueLanguage>({
      __className: 'DbEthnologueLanguage',
      properties: [
        { propertyName: 'code',                       permission: { read, }, },
        { propertyName: 'name',                       permission: { read, }, },
        { propertyName: 'population',                 permission: { read, }, },
        { propertyName: 'provisionalCode',            permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbFieldRegion>({
      __className: 'DbFieldRegion',
      properties: [
        { propertyName: 'director',                   permission: { read, }, },
        { propertyName: 'name',                       permission: { read, }, },
        { propertyName: 'fieldZone',                  permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbFieldZone>({
      __className: 'DbFieldZone',
      properties: [
        { propertyName: 'director',                   permission: { read, }, },
        { propertyName: 'name',                       permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbFile>({
      __className: 'DbFile',
      properties: [
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'createdBy',                  permission: { read, write, }, },
        { propertyName: 'parent',                     permission: { read, write, }, },
        { propertyName: 'mimeType',                   permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbFileVersion>({
      __className: 'DbFileVersion',
      properties: [
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'createdBy',                  permission: { read, write, }, },
        { propertyName: 'parent',                     permission: { read, write, }, },
        { propertyName: 'mimeType',                   permission: { read, write, }, },
        { propertyName: 'size',                       permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbFilm>({
      __className: 'DbFilm',
      properties: [
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'scriptureReferences',        permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbFundingAccount>({
      __className: 'DbFundingAccount',
      properties: [
        { propertyName: 'name',                       permission: { read, }, },
        { propertyName: 'accountNumber',              permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbInternshipEngagement>({
      __className: 'DbInternshipEngagement',
      properties: [
        { propertyName: 'ceremony',                   permission: { read, write, }, },
        { propertyName: 'communicationsCompleteDate', permission: { read, write, }, },
        { propertyName: 'completeDate',               permission: { read, write, }, },
        { propertyName: 'countryOfOrigin',            permission: { read, write, }, },
        { propertyName: 'disbursementCompleteDate',   permission: { read, write, }, },
        { propertyName: 'endDate',                    permission: { read, write, }, },
        { propertyName: 'endDateOverride',            permission: { read, write, }, },
        { propertyName: 'growthPlan',                 permission: { read, write, }, },
        { propertyName: 'initialEndDate',             permission: { read, write, }, },
        { propertyName: 'intern',                     permission: { read, write, }, },
        { propertyName: 'lastReactivatedAt',          permission: { read, write, }, },
        { propertyName: 'lastSuspendedAt',            permission: { read, write, }, },
        { propertyName: 'mentor',                     permission: { read, write, }, },
        { propertyName: 'methodologies',              permission: { read, write, }, },
        { propertyName: 'position',                   permission: { read, write, }, },
        { propertyName: 'startDate',                  permission: { read, write, }, },
        { propertyName: 'startDateOverride',          permission: { read, write, }, },
        { propertyName: 'statusModifiedAt',           permission: { read, write, }, },
        { propertyName: 'modifiedAt',                 permission: { read, write, }, },
        { propertyName: 'status',                     permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbLanguage>({
      __className: 'DbLanguage',
      properties: [
        { propertyName: 'displayName',                permission: { read, }, },
        { propertyName: 'displayNamePronunciation',   permission: { read, }, },
        { propertyName: 'isDialect',                  permission: { read, }, },
        { propertyName: 'isSignLanguage',             permission: { read, }, },
        { propertyName: 'leastOfThese',               permission: { read, }, },
        { propertyName: 'name',                       permission: { read, }, },
        { propertyName: 'leastOfTheseReason',         permission: { read, }, },
        { propertyName: 'populationOverride',         permission: { read, }, },
        { propertyName: 'registryOfDialectsCode',     permission: { read, }, },
        { propertyName: 'signLanguageCode',           permission: { read, }, },
        { propertyName: 'sponsorEstimatedEndDate',    permission: { read, }, },
        { propertyName: 'ethnologue',                 permission: { read, }, },
        { propertyName: 'sensitivity',                permission: { read, }, },
        { propertyName: 'hasExternalFirstScripture',  permission: { read, }, },
        { propertyName: 'locations',                  permission: { read, }, },
        { propertyName: 'tags',                       permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbLanguageEngagement>({
      __className: 'DbLanguageEngagement',
      properties: [
        { propertyName: 'ceremony',                   permission: { read, write, }, },
        { propertyName: 'communicationsCompleteDate', permission: { read, write, }, },
        { propertyName: 'completeDate',               permission: { read, write, }, },
        { propertyName: 'disbursementCompleteDate',   permission: { read, write, }, },
        { propertyName: 'endDate',                    permission: { read, write, }, },
        { propertyName: 'endDateOverride',            permission: { read, write, }, },
        { propertyName: 'firstScripture',             permission: { read, write, }, },
        { propertyName: 'initialEndDate',             permission: { read, write, }, },
        { propertyName: 'language',                   permission: { read, write, }, },
        { propertyName: 'lastReactivatedAt',          permission: { read, write, }, },
        { propertyName: 'lastSuspendedAt',            permission: { read, write, }, },
        { propertyName: 'lukePartnership',            permission: { read, write, }, },
        { propertyName: 'paratextRegistryId',         permission: { read, write, }, },
        { propertyName: 'pnp',                        permission: { read, write, }, },
        { propertyName: 'historicGoal',               permission: { read, write, }, },
        { propertyName: 'sentPrintingDate',           permission: { read, write, }, },
        { propertyName: 'startDate',                  permission: { read, write, }, },
        { propertyName: 'startDateOverride',          permission: { read, write, }, },
        { propertyName: 'statusModifiedAt',           permission: { read, write, }, },
        { propertyName: 'modifiedAt',                 permission: { read, write, }, },
        { propertyName: 'product',                    permission: { read, write, }, },
        { propertyName: 'status',                     permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbLiteracyMaterial>({
      __className: 'DbLiteracyMaterial',
      properties: [
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'scriptureReferences',        permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbLocation>({
      __className: 'DbLocation',
      properties: [
        { propertyName: 'name',                       permission: { read, }, },
        { propertyName: 'type',                       permission: { read, }, },
        { propertyName: 'isoAlpha3',                  permission: { read, }, },
        { propertyName: 'fundingAccount',             permission: { read, }, },
        { propertyName: 'sensitivity',                permission: { read, }, },

        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbOrganization>({
      __className: 'DbOrganization',
      properties: [
        { propertyName: 'name',                       permission: { read, }, },
        { propertyName: 'address',                    permission: { read, }, },
        { propertyName: 'locations',                  permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbPartner>({
      __className: 'DbPartner',
      properties: [
        { propertyName: 'organization',               permission: { read, write, }, },
        { propertyName: 'pointOfContact',             permission: { read, write, }, },
        { propertyName: 'types',                      permission: { read, write, }, },
        { propertyName: 'financialReportingTypes',    permission: { read, write, }, },
        { propertyName: 'pmcEntityCode',              permission: { read, write, }, },
        { propertyName: 'globalInnovationsClient',    permission: { read, write, }, },
        { propertyName: 'active',                     permission: { read, write, }, },
        { propertyName: 'address',                    permission: { read, write, }, },
        { propertyName: 'modifiedAt',                 permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbPartnership>({
      __className: 'DbPartnership',
      properties: [
        { propertyName: 'agreement',                  permission: { read, write, }, },
        { propertyName: 'agreementStatus',            permission: { read, write, }, },
        { propertyName: 'financialReportingType',     permission: { read, write, }, },
        { propertyName: 'mou',                        permission: { read, write, }, },
        { propertyName: 'mouEnd',                     permission: { read, write, }, },
        { propertyName: 'mouEndOverride',             permission: { read, write, }, },
        { propertyName: 'mouStart',                   permission: { read, write, }, },
        { propertyName: 'mouStartOverride',           permission: { read, write, }, },
        { propertyName: 'mouStatus',                  permission: { read, write, }, },
        { propertyName: 'types',                      permission: { read, write, }, },
        { propertyName: 'organization',               permission: { read, write, }, },
        { propertyName: 'partner',                    permission: { read, write, }, },
        { propertyName: 'primary',                    permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbPost>({
      __className: 'DbPost',
      properties: [
        { propertyName: 'body',                       permission: { read, write, }, },
        { propertyName: 'creator',                       permission: { read, write, }, },
      ],
      canDelete: true,
  }),
    new DbBaseNodeGrant<DbProduct>({
      __className: 'DbProduct',
      properties: [
        { propertyName: 'mediums',                    permission: { read, write, }, },
        { propertyName: 'methodology',                permission: { read, write, }, },
        { propertyName: 'purposes',                   permission: { read, write, }, },
        { propertyName: 'scriptureReferences',        permission: { read, write, }, },
        { propertyName: 'produces',                   permission: { read, write, }, },
        { propertyName: 'scriptureReferencesOverride',permission: { read, write, }, },
        { propertyName: 'isOverriding',               permission: { read, write, }, },
          ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbProject>({
      __className: 'DbProject',
      properties: [
        { propertyName: 'estimatedSubmission',        permission: { read, write, }, },
        { propertyName: 'step',                       permission: { read, write, }, },
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'status',                     permission: { read, write, }, },
        { propertyName: 'departmentId',               permission: { read, write, }, },
        { propertyName: 'mouStart',                   permission: { read, write, }, },
        { propertyName: 'mouEnd',                     permission: { read, write, }, },
        { propertyName: 'initialMouEnd',              permission: { read, write, }, },
        { propertyName: 'stepChangedAt',              permission: { read, write, }, },
        { propertyName: 'rootDirectory',              permission: { read, write, }, },
        { propertyName: 'member',                     permission: { read, write, }, },
        { propertyName: 'otherLocations',             permission: { read, write, }, },
        { propertyName: 'primaryLocation',            permission: { read, write, }, },
        { propertyName: 'marketingLocation',          permission: { read, write, }, },
        { propertyName: 'partnership',                permission: { read, write, }, },
        { propertyName: 'budget',                     permission: { read, write, }, },
        { propertyName: 'modifiedAt',                 permission: { read, write, }, },
        { propertyName: 'fieldRegion',                permission: { read, write, }, },
        { propertyName: 'engagement',                 permission: { read, write, }, },
        { propertyName: 'sensitivity',                permission: { read, write, }, },
        { propertyName: 'tags',                       permission: { read, write, }, },
        { propertyName: 'financialReportReceivedAt',  permission: { read, write, }, },
        { propertyName: 'owningOrganization',         permission: { read, write, }, },
          ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbProjectMember>({
      __className: 'DbProjectMember',
      properties: [
        { propertyName: 'roles',                      permission: { read, write, }, },
        { propertyName: 'user',                       permission: { read, write, }, },
        { propertyName: 'modifiedAt',                 permission: { read, write, }, },
            ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbUser>({
      __className: 'DbUser',
      properties: [
        { propertyName: 'about',                      permission: { read, }, },
        { propertyName: 'displayFirstName',           permission: { read, }, },
        { propertyName: 'displayLastName',            permission: { read, }, },
        { propertyName: 'email',                      permission: { read, }, },
        { propertyName: 'phone',                      permission: { read, }, },
        { propertyName: 'realFirstName',              permission: { read, }, },
        { propertyName: 'realLastName',               permission: { read, }, },
        { propertyName: 'roles',                      permission: { read, }, },
        { propertyName: 'status',                     permission: { read, }, },
        { propertyName: 'timezone',                   permission: { read, }, },
        { propertyName: 'title',                      permission: { read, }, },
        { propertyName: 'education',                  permission: { read, }, },
        { propertyName: 'organization',               permission: { read, }, },
        { propertyName: 'unavailability',             permission: { read, }, },
        { propertyName: 'locations',                  permission: { read, }, },
        { propertyName: 'knownLanguage',              permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbUnavailability>({
      __className: 'DbUnavailability',
      properties: [
        { propertyName: 'description',                permission: { read, }, },
        { propertyName: 'end',                        permission: { read, }, },
        { propertyName: 'start',                      permission: { read, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbSong>({
      __className: 'DbSong',
      properties: [
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'scriptureReferences',        permission: { read, write, }, },
        ],
    canDelete: false,
  }),
    new DbBaseNodeGrant<DbStory>({
      __className: 'DbStory',
      properties: [
        { propertyName: 'name',                       permission: { read, write, }, },
        { propertyName: 'scriptureReferences',        permission: { read, write, }, },
    ],
    canDelete: false,
  }),
  ],
});
