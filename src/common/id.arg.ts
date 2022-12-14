import { ArgumentMetadata, PipeTransform, Type } from '@nestjs/common';
import { Args, ArgsOptions, ID as IdType } from '@nestjs/graphql';
import { ValidationPipe } from '../core/validation.pipe';
import { ID } from './id-field';
import { IsId } from './validators';

// just an object with the validator metadata
class IdHolder {
  @IsId()
  id: ID;
}

class ValidateIdPipe implements PipeTransform {
  async transform(id: any, _metadata: ArgumentMetadata) {
    await new ValidationPipe().transform(
      { id },
      {
        metatype: IdHolder,
        type: 'body',
        data: 'id',
      }
    );
    return id;
  }
}

export const IdArg = (
  opts: Partial<ArgsOptions> = {},
  ...pipes: Array<Type<PipeTransform> | PipeTransform>
) =>
  Args({ name: 'id', type: () => IdType, ...opts }, ValidateIdPipe, ...pipes);
