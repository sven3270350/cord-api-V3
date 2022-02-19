import { Injectable } from '@nestjs/common';
import { ID, Session } from '../../common';
import { DtoRepository, matchRequestingUser } from '../../core';
import {
  createNode,
  paginate,
  permissionsOfNode,
  requestingUser,
  sorting,
} from '../../core/database/query';
import { CreateStory, Story, StoryListInput } from './dto';

@Injectable()
export class StoryRepository extends DtoRepository(Story) {
  async create(input: CreateStory, session: Session) {
    const initialProps = {
      name: input.name,
      canDelete: true,
    };
    return await this.db
      .query()
      .apply(matchRequestingUser(session))
      .apply(await createNode(Story, { initialProps }))
      .return<{ id: ID }>('node.id as id')
      .first();
  }

  async list({ filter, ...input }: StoryListInput, session: Session) {
    const result = await this.db
      .query()
      .match([requestingUser(session), ...permissionsOfNode('Story')])
      .apply(sorting(Story, input))
      .apply(paginate(input, this.hydrate()))
      .first();
    return result!; // result from paginate() will always have 1 row.
  }
}
