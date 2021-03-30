import { Field, InputType, ObjectType } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { stripIndent } from 'common-tags';
import { uniq } from 'lodash';
import { ID, IdField } from '../../../common';
import { ScriptureRangeInput } from '../../scripture';
import { MethodologyStep } from './methodology-step.enum';
import { ProductMedium } from './product-medium';
import { ProductMethodology } from './product-methodology';
import { ProductPurpose } from './product-purpose';
import { AnyProduct, Product } from './product.dto';

@InputType()
export abstract class CreateProduct {
  @IdField({
    description: 'An ID of a `LanguageEngagement` to create this product for',
  })
  readonly engagementId: ID;

  @IdField({
    nullable: true,
    description: stripIndent`
      An ID of a \`Producible\` object, which will create a \`DerivativeScriptureProduct\`.
      If omitted a \`DirectScriptureProduct\` will be created instead.
    `,
  })
  readonly produces?: ID;

  @Field(() => [ScriptureRangeInput], {
    nullable: true,
    description: stripIndent`
      Change this list of \`scriptureReferences\` if provided.

      Note only \`DirectScriptureProduct\`s can use this field.
    `,
  })
  @ValidateNested()
  @Type(() => ScriptureRangeInput)
  readonly scriptureReferences?: ScriptureRangeInput[];

  @Field(() => [ScriptureRangeInput], {
    nullable: true,
    description: stripIndent`
      The \`Producible\` defines a \`scriptureReferences\` list, and this is
      used by default in this product's \`scriptureReferences\` list.
      If this product _specifically_ needs to customize the references, then
      this property can be set (and read) to "override" the \`producible\`'s list.

      Note only \`DerivativeScriptureProduct\`s can use this field.
    `,
  })
  @ValidateNested()
  @Type(() => ScriptureRangeInput)
  readonly scriptureReferencesOverride?: ScriptureRangeInput[];

  @Field(() => [ProductMedium], { nullable: true })
  @Transform(({ value }) => uniq(value))
  readonly mediums?: ProductMedium[] = [];

  @Field(() => [ProductPurpose], { nullable: true })
  @Transform(({ value }) => uniq(value))
  readonly purposes?: ProductPurpose[] = [];

  @Field(() => ProductMethodology, { nullable: true })
  readonly methodology?: ProductMethodology;

  @Field(() => [MethodologyStep], { nullable: true })
  readonly steps?: MethodologyStep[] = [];
}

@InputType()
export abstract class CreateProductInput {
  @Field()
  @Type(() => CreateProduct)
  @ValidateNested()
  readonly product: CreateProduct;
}

@ObjectType()
export abstract class CreateProductOutput {
  @Field(() => Product)
  readonly product: AnyProduct;
}
