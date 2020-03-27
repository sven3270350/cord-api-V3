import { Type } from '@nestjs/common';
import { Field, ObjectType, registerEnumType } from 'type-graphql';
import {
  Resource,
  SecuredInt,
  SecuredProperty,
  SecuredString,
} from '../../../common';

export enum BudgetStatus {
  Pending = 'pending',
  Current = 'current',
  Superceded = 'superceded',
  Rejected = 'rejected',
}

registerEnumType(BudgetStatus, { name: 'BudgetStatus' });

@ObjectType({
  implements: [Resource],
})
export class Budget extends Resource {
  static classType = (Budget as any) as Type<Budget>;

  @Field()
  readonly status: BudgetStatus;

  @Field(() => [SecuredString], { nullable: true })
  readonly records?: SecuredString[];
}

@ObjectType({
  implements: [Resource],
})
export class BudgetRecord extends Resource {
  static classType = (BudgetRecord as any) as Type<BudgetRecord>;

  @Field({ nullable: true })
  organizationId?: SecuredString;

  @Field({ nullable: true })
  fiscalYear?: SecuredInt;

  @Field({ nullable: true })
  amount?: SecuredInt;
}

@ObjectType({
  description: SecuredProperty.descriptionFor('a budget record'),
})
export class SecuredBudgetRecord extends SecuredProperty(BudgetRecord) {}

@ObjectType({
  description: SecuredProperty.descriptionFor('a budget status'),
})
export class SecuredBudgetStatus extends SecuredProperty(BudgetStatus) {}
