import { Field, ID, InputType, Int, ObjectType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsAlpha,
  IsLowercase,
  IsNumberString,
  IsPositive,
  Length,
  ValidateNested,
} from 'class-validator';
import { NameField } from '../../../common';
import { Language } from './language.dto';

@InputType()
export abstract class UpdateEthnologueLanguage {
  @NameField({ nullable: true })
  readonly id?: string;

  @NameField({ nullable: true })
  @IsAlpha()
  @IsLowercase()
  @Length(3)
  readonly code?: string;

  @NameField({ nullable: true })
  @IsAlpha()
  @IsLowercase()
  @Length(3)
  readonly provisionalCode?: string;

  @NameField({ nullable: true })
  readonly name?: string;

  @Field(() => Int, { nullable: true })
  @IsPositive()
  readonly population?: number;
}

@InputType()
export abstract class UpdateLanguage {
  @Field(() => ID)
  readonly id: string;

  @NameField({ nullable: true })
  readonly name?: string;

  @NameField({ nullable: true })
  readonly displayName?: string;

  @Field({ nullable: true })
  readonly isDialect: boolean = false;

  @Field({ nullable: true })
  @Type(() => UpdateEthnologueLanguage)
  @ValidateNested()
  readonly ethnologue?: UpdateEthnologueLanguage;

  @Field(() => Int, { nullable: true })
  @IsPositive()
  readonly populationOverride: number;

  @Field({ nullable: true })
  @Length(5)
  @IsNumberString()
  readonly registryOfDialectsCode?: string;

  @Field({ nullable: true })
  readonly leastOfThese: boolean = false;

  @NameField({ nullable: true })
  readonly leastOfTheseReason?: string;
}

@InputType()
export abstract class UpdateLanguageInput {
  @Field()
  @Type(() => UpdateLanguage)
  @ValidateNested()
  readonly language: UpdateLanguage;
}

@ObjectType()
export abstract class UpdateLanguageOutput {
  @Field()
  readonly language: Language;
}
