import { Type } from '@nestjs/common';
import { Field, ObjectType } from 'type-graphql';
import {
  Resource,
  SecuredBoolean,
  SecuredDate,
  SecuredProperty,
} from '../../../common';
import { CeremonyType } from './type.enum';

@ObjectType({
  implements: [Resource],
})
export class Ceremony extends Resource {
  static classType = (Ceremony as any) as Type<Ceremony>;

  @Field(() => CeremonyType)
  readonly type: CeremonyType;

  @Field()
  readonly planned: SecuredBoolean;

  @Field()
  readonly estimatedDate: SecuredDate;

  @Field()
  readonly actualDate: SecuredDate;
}

@ObjectType({
  description: SecuredProperty.descriptionFor('a ceremony'),
})
export class SecuredCeremony extends SecuredProperty(Ceremony) {}
