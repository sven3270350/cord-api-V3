import { Type } from '@nestjs/common';
import { Field, ObjectType } from '@nestjs/graphql';
import {
  Resource,
  SecuredDate,
  SecuredProperty,
  SecuredPropertyList,
} from '../../../common';
import { Organization } from '../../organization';
import { PartnershipAgreementStatus } from './partnership-agreement-status.enum';
import { PartnershipType } from './partnership-type.enum';

@ObjectType({
  description: SecuredProperty.descriptionFor('a partnership agreement status'),
})
export abstract class SecuredPartnershipAgreementStatus extends SecuredProperty(
  PartnershipAgreementStatus
) {}

@ObjectType({
  description: SecuredPropertyList.descriptionFor('partnership types'),
})
export abstract class SecuredPartnershipTypes extends SecuredPropertyList(
  PartnershipType
) {}

@ObjectType({
  implements: [Resource],
})
export class Partnership extends Resource {
  /* TS wants a public constructor for "ClassType" */
  static classType = (Partnership as any) as Type<Partnership>;

  @Field()
  readonly agreementStatus: SecuredPartnershipAgreementStatus;

  @Field()
  readonly mouStatus: SecuredPartnershipAgreementStatus;

  @Field()
  readonly mouStart: SecuredDate;

  @Field()
  readonly mouEnd: SecuredDate;

  @Field(() => Organization)
  readonly organization: Organization;

  @Field()
  readonly types: SecuredPartnershipTypes;
}
