import { Injectable } from '@nestjs/common';
import {
  DuplicateException,
  ID,
  NotFoundException,
  ServerException,
  Session,
  UnauthorizedException,
} from '../../common';
import { ConfigService, ILogger, Logger, OnIndex } from '../../core';
import {
  parseBaseNodeProperties,
  runListQuery,
} from '../../core/database/results';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  CreateFieldZone,
  FieldZone,
  FieldZoneListInput,
  FieldZoneListOutput,
  UpdateFieldZone,
} from './dto';
import { FieldZoneRepository } from './field-zone.repository';

@Injectable()
export class FieldZoneService {
  constructor(
    @Logger('field-zone:service') private readonly logger: ILogger,
    private readonly config: ConfigService,
    // private readonly db: DatabaseService,
    private readonly authorizationService: AuthorizationService,
    private readonly repo: FieldZoneRepository
  ) {}

  @OnIndex()
  async createIndexes() {
    return [
      // FIELD ZONE NODE
      'CREATE CONSTRAINT ON (n:FieldZone) ASSERT EXISTS(n.id)',
      'CREATE CONSTRAINT ON (n:FieldZone) ASSERT n.id IS UNIQUE',
      'CREATE CONSTRAINT ON (n:FieldZone) ASSERT EXISTS(n.createdAt)',

      // FIELD ZONE NAME REL
      'CREATE CONSTRAINT ON ()-[r:name]-() ASSERT EXISTS(r.active)',
      'CREATE CONSTRAINT ON ()-[r:name]-() ASSERT EXISTS(r.createdAt)',

      // FIELD ZONE NAME NODE
      'CREATE CONSTRAINT ON (n:FieldZoneName) ASSERT EXISTS(n.value)',
      'CREATE CONSTRAINT ON (n:FieldZoneName) ASSERT n.value IS UNIQUE',
    ];
  }

  async create(
    { directorId, ...input }: CreateFieldZone,
    session: Session
  ): Promise<FieldZone> {
    const checkName = await this.repo.checkName(input.name);

    if (checkName) {
      throw new DuplicateException(
        'fieldZone.name',
        'FieldZone with this name already exists.'
      );
    }
    const result = await this.repo.create(session, input.name, directorId);

    if (!result) {
      throw new ServerException('failed to create field zone');
    }

    await this.authorizationService.processNewBaseNode(
      FieldZone,
      result.id,
      session.userId
    );

    this.logger.debug(`field zone created`, { id: result.id });
    return await this.readOne(result.id, session);
  }

  async readOne(id: ID, session: Session): Promise<FieldZone> {
    this.logger.debug(`Read Field Zone`, {
      id: id,
      userId: session.userId,
    });

    const result = await this.repo.readOne(id, session);

    if (!result) {
      throw new NotFoundException('Could not find field zone', 'fieldZone.id');
    }

    const secured = await this.authorizationService.secureProperties(
      FieldZone,
      result.propList,
      session
    );

    return {
      ...parseBaseNodeProperties(result.node),
      ...secured,
      director: {
        ...secured.director,
        value: result.directorId,
      },
      canDelete: await this.repo.checkDeletePermission(id, session),
    };
  }

  async update(input: UpdateFieldZone, session: Session): Promise<FieldZone> {
    const fieldZone = await this.readOne(input.id, session);

    const changes = this.repo.getActualChanges(fieldZone, input);
    await this.authorizationService.verifyCanEditChanges(
      FieldZone,
      fieldZone,
      changes
    );

    const { directorId, ...simpleChanges } = changes;

    // update director
    if (directorId) {
      await this.repo.updateDirector(directorId, input.id);
    }

    await this.repo.updateProperties(fieldZone, simpleChanges);

    return await this.readOne(input.id, session);
  }

  async delete(id: ID, session: Session): Promise<void> {
    const object = await this.readOne(id, session);

    if (!object) {
      throw new NotFoundException('Could not find Field Zone');
    }

    const canDelete = await this.repo.checkDeletePermission(id, session);

    if (!canDelete)
      throw new UnauthorizedException(
        'You do not have the permission to delete this Field Zone'
      );

    try {
      await this.repo.deleteNode(object);
    } catch (exception) {
      this.logger.error('Failed to delete', { id, exception });
      throw new ServerException('Failed to delete', exception);
    }
  }

  async list(
    { filter, ...input }: FieldZoneListInput,
    session: Session
  ): Promise<FieldZoneListOutput> {
    const query = this.repo.list({ filter, ...input }, session);

    return await runListQuery(query, input, (id) => this.readOne(id, session));
  }
}
