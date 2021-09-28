import { Injectable } from '@nestjs/common';
import { inArray, node, Query, relation } from 'cypher-query-builder';
import { DateTime } from 'luxon';
import { ID, NotFoundException, Session, UnsecuredDto } from '../../common';
import { DtoRepository, matchRequestingUser } from '../../core';
import {
  ACTIVE,
  createNode,
  createRelationships,
  matchProps,
  merge,
  paginate,
  permissionsOfNode,
  requestingUser,
  sorting,
} from '../../core/database/query';
import { CreateFieldZone, FieldZone, FieldZoneListInput } from './dto';

@Injectable()
export class FieldZoneRepository extends DtoRepository(FieldZone) {
  async checkName(name: string) {
    return await this.db
      .query()
      .match([node('name', 'FieldZoneName', { value: name })])
      .return('name')
      .first();
  }

  async create(input: CreateFieldZone, session: Session) {
    const initialProps = {
      name: input.name,
      canDelete: true,
    };

    // create field zone
    const query = this.db
      .query()
      .apply(matchRequestingUser(session))
      .apply(await createNode(FieldZone, { initialProps }))
      .apply(
        createRelationships(FieldZone, 'out', {
          director: ['User', input.directorId],
        })
      )
      .return<{ id: ID }>('node.id as id');

    return await query.first();
  }

  async readOne(id: ID, session: Session) {
    const query = this.db
      .query()
      .apply(matchRequestingUser(session))
      .match([node('node', 'FieldZone', { id: id })])
      .apply(this.hydrate());

    const result = await query.first();
    if (!result) {
      throw new NotFoundException('Could not find field zone', 'fieldZone.id');
    }
    return result.dto;
  }

  async readMany(ids: readonly ID[], session: Session) {
    return await this.db
      .query()
      .apply(matchRequestingUser(session))
      .matchNode('node', 'FieldZone')
      .where({ 'node.id': inArray(ids.slice()) })
      .apply(this.hydrate())
      .map('dto')
      .run();
  }

  protected hydrate() {
    return (query: Query) =>
      query
        .apply(matchProps())
        .optionalMatch([
          node('node'),
          relation('out', '', 'director', ACTIVE),
          node('director', 'User'),
        ])
        .return<{ dto: UnsecuredDto<FieldZone> }>(
          merge('props', {
            director: 'director.id',
          }).as('dto')
        );
  }

  async updateDirector(directorId: ID, id: ID) {
    const createdAt = DateTime.local();
    const query = this.db
      .query()
      .match(node('fieldZone', 'FieldZone', { id }))
      .with('fieldZone')
      .limit(1)
      .match([node('director', 'User', { id: directorId })])
      .optionalMatch([
        node('fieldZone'),
        relation('out', 'oldRel', 'director', ACTIVE),
        node(''),
      ])
      .setValues({ 'oldRel.active': false })
      .with('fieldZone, director')
      .limit(1)
      .create([
        node('fieldZone'),
        relation('out', '', 'director', {
          active: true,
          createdAt,
        }),
        node('director'),
      ]);

    await query.run();
  }

  async list({ filter, ...input }: FieldZoneListInput, session: Session) {
    const label = 'FieldZone';
    const result = await this.db
      .query()
      .match([requestingUser(session), ...permissionsOfNode(label)])
      .apply(sorting(FieldZone, input))
      .apply(paginate(input, this.hydrate()))
      .first();
    return result!; // result from paginate() will always have 1 row.
  }
}
