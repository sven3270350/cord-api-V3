import { Field, ObjectType } from '@nestjs/graphql';
import {
  Resource,
  SecuredBoolean,
  SecuredInt,
  SecuredProperty,
  SecuredString,
} from '../../../common';

@ObjectType({
  implements: [Resource],
})
export class FundingAccount extends Resource {
  @Field()
  readonly name: SecuredString;

  @Field()
  readonly accountNumber: SecuredInt;

  readonly canDelete: SecuredBoolean;
}

@ObjectType({
  description: SecuredProperty.descriptionFor('a funding account'),
})
export class SecuredFundingAccount extends SecuredProperty(FundingAccount) {}
