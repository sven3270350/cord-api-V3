import { Field, ObjectType } from '@nestjs/graphql';
import {
  Resource,
  Secured,
  SecuredDateNullable,
  SecuredEnum,
  SecuredEnumList,
  SecuredKeys,
} from '../../../common';
import { DefinedFile } from '../../file/dto';
import { PartnerType } from '../../partner/dto/partner-type.enum';
import { FinancialReportingType } from './financial-reporting-type';
import { PartnershipAgreementStatus } from './partnership-agreement-status.enum';

@ObjectType({
  description: SecuredEnum.descriptionFor('a partnership agreement status'),
})
export abstract class SecuredPartnershipAgreementStatus extends SecuredEnum(
  PartnershipAgreementStatus
) {}

@ObjectType({
  description: SecuredEnumList.descriptionFor('partnership types'),
})
export abstract class SecuredPartnershipTypes extends SecuredEnumList(
  PartnerType
) {}

@ObjectType({
  description: SecuredEnum.descriptionFor('partnership funding type'),
})
export abstract class SecuredFinancialReportingType extends SecuredEnum(
  FinancialReportingType,
  { nullable: true }
) {}

@ObjectType({
  implements: [Resource],
})
export class Partnership extends Resource {
  @Field()
  readonly agreementStatus: SecuredPartnershipAgreementStatus;

  readonly mou: DefinedFile;

  @Field()
  readonly mouStatus: SecuredPartnershipAgreementStatus;

  @Field()
  readonly mouStart: SecuredDateNullable;

  @Field()
  readonly mouEnd: SecuredDateNullable;

  @Field()
  readonly mouStartOverride: SecuredDateNullable;

  @Field()
  readonly mouEndOverride: SecuredDateNullable;

  readonly agreement: DefinedFile;

  readonly partner: Secured<string>;

  @Field()
  readonly types: SecuredPartnershipTypes;

  @Field()
  readonly financialReportingType: SecuredFinancialReportingType;
}

declare module '../../authorization/policies/mapping' {
  interface TypeToDto {
    Partnership: Partnership;
  }
  interface TypeToSecuredProps {
    Partnership: SecuredKeys<Partnership> | 'organization';
  }
}
