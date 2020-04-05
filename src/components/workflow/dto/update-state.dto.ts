import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { Field, ID, InputType } from 'type-graphql';

@InputType()
export abstract class UpdateState {
  @Field(() => ID)
  readonly stateId: string;

  @Field()
  readonly stateName?: string;
}

@InputType()
export abstract class UpdateStateInput {
  @Field()
  @Type(() => UpdateState)
  @ValidateNested()
  readonly state: UpdateState;
}
