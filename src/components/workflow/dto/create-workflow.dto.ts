import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { Field, ID, InputType, ObjectType } from 'type-graphql';
import { Workflow } from './workflow.dto';

@InputType()
export abstract class CreateWorkflow {
  @Field(() => ID)
  readonly baseNodeId: string;

  @Field()
  readonly startingStateName: string;
}

@InputType()
export abstract class CreateWorkflowInput {
  @Field()
  @Type(() => CreateWorkflow)
  @ValidateNested()
  readonly workflow: CreateWorkflow;
}

@ObjectType()
export abstract class CreateWorkflowOutput {
  @Field()
  @Type(() => Workflow)
  @ValidateNested()
  readonly workflow: Workflow;
}
