import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { MinLength, ValidateNested } from 'class-validator';
import { IsEmail } from '../../../common';
import { User } from './user.dto';

@InputType()
export abstract class CreateUser {
  @Field()
  @IsEmail()
  readonly email: string;

  @Field()
  @MinLength(2)
  readonly realFirstName: string;

  @Field()
  @MinLength(2)
  readonly realLastName: string;

  @Field()
  @MinLength(2)
  readonly displayFirstName: string;

  @Field()
  @MinLength(2)
  readonly displayLastName: string;

  @Field({ nullable: true })
  readonly phone?: string;

  @Field({ nullable: true })
  readonly timezone?: string;

  @Field({ nullable: true })
  readonly bio?: string;

  @Field()
  readonly password: string;
}

@InputType()
export abstract class CreateUserInput {
  @Field()
  @Type(() => CreateUser)
  @ValidateNested()
  readonly user: CreateUser;
}

@ObjectType()
export abstract class CreateUserOutput {
  @Field()
  readonly user: User;
}
