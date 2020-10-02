import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { NameField } from '../../../common';
import { FundingAccount } from './funding-account.dto';

@InputType()
export abstract class UpdateFundingAccount {
  @Field(() => ID)
  readonly id: string;

  @NameField({ nullable: true })
  readonly name?: string;

  @Field(() => Int, { nullable: true })
  readonly accountNumber?: number;
}

@InputType()
export abstract class UpdateFundingAccountInput {
  @Field()
  @Type(() => UpdateFundingAccount)
  @ValidateNested()
  readonly fundingAccount: UpdateFundingAccount;
}

@ObjectType()
export abstract class UpdateFundingAccountOutput {
  @Field()
  readonly fundingAccount: FundingAccount;
}
