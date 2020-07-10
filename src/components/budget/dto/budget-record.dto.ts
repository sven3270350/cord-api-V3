import { Field, ObjectType } from '@nestjs/graphql';
import {
  Resource,
  SecuredFloat,
  SecuredInt,
  SecuredString,
} from '../../../common';

@ObjectType({
  implements: [Resource],
})
export class BudgetRecord extends Resource {
  readonly organizationId: SecuredString;

  @Field()
  readonly fiscalYear: SecuredInt;

  @Field()
  readonly amount: SecuredFloat;
}
