import { Injectable } from '@nestjs/common';
import {
  contains,
  hasLabel,
  node,
  Query,
  relation,
} from 'cypher-query-builder';
import { AnyConditions } from 'cypher-query-builder/dist/typings/clauses/where-utils';
import { isEmpty } from 'lodash';
import { DateTime } from 'luxon';
import {
  ID,
  NotFoundException,
  ServerException,
  Session,
  UnauthorizedException,
} from '../../common';
import {
  DatabaseService,
  ILogger,
  Logger,
  matchRequestingUser,
  matchSession,
} from '../../core';
import {
  ACTIVE,
  createNode,
  matchProps,
  merge,
  paginate,
  sorting,
} from '../../core/database/query';
import {
  Directory,
  File,
  FileListInput,
  FileNode,
  FileNodeType,
  FileVersion,
  IFileNode,
  resolveFileNode,
} from './dto';

@Injectable()
export class FileRepository {
  constructor(
    private readonly db: DatabaseService,
    @Logger('file:repository') private readonly logger: ILogger
  ) {}

  async getById(id: ID, _session: Session): Promise<FileNode> {
    const result = await this.db
      .query()
      .matchNode('node', 'FileNode', { id })
      .apply(this.hydrate())
      .map('dto')
      .run();
    return first(result);
  }

  async getByName(
    parentId: ID,
    name: string,
    _session: Session
  ): Promise<FileNode> {
    const result = await this.db
      .query()
      .match([
        node('parent', 'FileNode', { id: parentId }),
        relation('in', '', 'parent', ACTIVE),
        node('node', 'FileNode'),
        relation('out', '', 'name', ACTIVE),
        node('name', 'Property', { value: name }),
      ])
      .apply(this.hydrate())
      .map('dto')
      .run();
    return first(result);
  }

  async getParentsById(
    id: ID,
    _session: Session
  ): Promise<readonly FileNode[]> {
    const result = await this.db
      .query()
      .match([
        node('start', 'FileNode', { id }),
        relation('out', 'parent', 'parent', ACTIVE, '*'),
        node('node', 'FileNode'),
      ])
      .with('node, parent')
      .orderBy('size(parent)')
      // Using paginate to maintain order through hydration
      .apply(paginate({ page: 1, count: 100 }, this.hydrate()))
      .first();
    return result!.items;
  }

  async getChildrenById(parent: FileNode, input?: FileListInput) {
    input ??= FileListInput.defaultVal;
    const result = await this.db
      .query()
      .match([
        node('start', 'FileNode', { id: parent.id }),
        relation('in', '', 'parent', ACTIVE),
        node('node', 'FileNode'),
      ])
      .apply((q) => {
        const conditions: AnyConditions = {};
        if (input?.filter?.name) {
          q.match([
            node('node'),
            relation('out', '', 'name', ACTIVE),
            node('name', 'Property'),
          ]);
          conditions['name.value'] = contains(input.filter.name);
        }
        if (input?.filter?.type) {
          conditions.node = hasLabel(input.filter.type);
        }
        return isEmpty(conditions) ? q : q.where(conditions);
      })
      .apply(sorting(resolveFileNode(parent), input))
      .apply(paginate(input, this.hydrate()))
      .first();
    return result!;
  }

  private hydrate() {
    return (query: Query) =>
      query
        .subQuery((sub) =>
          sub
            .with('node')
            .with('node')
            .where({ node: hasLabel(FileNodeType.File) })
            .apply(this.hydrateFile())
            .union()
            .with('node')
            .with('node')
            .where({ node: hasLabel(FileNodeType.FileVersion) })
            .apply(this.hydrateFileVersion())
            .union()
            .with('node')
            .with('node')
            .where({ node: hasLabel(FileNodeType.Directory) })
            .apply(this.hydrateDirectory())
        )
        .return<{ dto: FileNode }>('dto');
  }

  private hydrateFile() {
    return (query: Query) =>
      query
        .apply(this.matchLatestVersion())
        .apply(matchProps())
        .apply(matchProps({ nodeName: 'version', outputVar: 'versionProps' }))
        .match([
          node('node'),
          relation('out', '', 'createdBy', ACTIVE),
          node('createdBy'),
        ])
        .match([
          node('version'),
          relation('out', '', 'createdBy', ACTIVE),
          node('modifiedBy'),
        ])
        .return<{ dto: File }>(
          merge('versionProps', 'props', {
            type: `"${FileNodeType.File}"`,
            latestVersionId: 'version.id',
            modifiedById: 'modifiedBy.id',
            modifiedAt: 'version.createdAt',
            createdById: 'createdBy.id',
            canDelete: true,
          }).as('dto')
        );
  }

  private hydrateDirectory() {
    return (query: Query) =>
      query
        .apply(matchProps())
        .match([
          node('node'),
          relation('out', '', 'createdBy', ACTIVE),
          node('createdBy'),
        ])
        .return<{ dto: Directory }>(
          merge('props', {
            type: `"${FileNodeType.Directory}"`,
            createdById: 'createdBy.id',
            canDelete: true,
          }).as('dto')
        );
  }

  private hydrateFileVersion() {
    return (query: Query) =>
      query
        .apply(matchProps())
        .match([
          node('node'),
          relation('out', '', 'createdBy', ACTIVE),
          node('createdBy'),
        ])
        .return<{ dto: FileVersion }>(
          merge('props', {
            type: `"${FileNodeType.FileVersion}"`,
            createdById: 'createdBy.id',
            canDelete: true,
          }).as('dto')
        );
  }

  private matchLatestVersion() {
    return (query: Query) =>
      query.subQuery('node', (sub) =>
        sub
          .match([
            node('node', 'FileNode'),
            relation('in', '', 'parent', ACTIVE),
            node('version', 'FileVersion'),
          ])
          .return('version')
          .orderBy('version.createdAt', 'DESC')
          .raw('LIMIT 1')
      );
  }

  async createDirectory(
    parentId: ID | undefined,
    name: string,
    session: Session
  ): Promise<ID> {
    const initialProps = {
      name,
      canDelete: true,
    };

    const createFile = this.db
      .query()
      .apply(matchRequestingUser(session))
      .apply(await createNode(Directory, { initialProps }))
      .return<{ id: ID }>('node.id as id');

    const result = await createFile.first();

    if (!result) {
      throw new ServerException('Failed to create directory');
    }

    await this.attachCreator(result.id, session);

    if (parentId) {
      await this.attachParent(result.id, parentId);
    }

    return result.id;
  }

  async createFile(fileId: ID, name: string, session: Session, parentId?: ID) {
    const initialProps = {
      name,
      canDelete: true,
    };

    const createFile = this.db
      .query()
      .apply(matchRequestingUser(session))
      .apply(
        await createNode(File, { initialProps, baseNodeProps: { id: fileId } })
      )
      .return<{ id: ID }>('node.id as id');

    const result = await createFile.first();

    if (!result) {
      throw new ServerException('Failed to create file');
    }

    await this.attachCreator(result.id, session);

    if (parentId) {
      await this.attachParent(result.id, parentId);
    }

    return result.id;
  }

  async createFileVersion(
    fileId: ID,
    input: Pick<FileVersion, 'id' | 'name' | 'mimeType' | 'size'>,
    session: Session
  ) {
    const initialProps = {
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      canDelete: true,
    };

    const createFile = this.db
      .query()
      .apply(matchRequestingUser(session))
      .apply(
        await createNode(FileVersion, {
          initialProps,
          baseNodeProps: { id: input.id },
        })
      )
      .return<{ id: ID }>('node.id as id');

    const result = await createFile.first();

    if (!result) {
      throw new ServerException('Failed to create file version');
    }

    await this.attachCreator(input.id, session);
    await this.attachParent(input.id, fileId);

    return result;
  }

  private async attachCreator(id: ID, session: Session) {
    await this.db
      .query()
      .match([
        [node('node', 'FileNode', { id })],
        [node('user', 'User', { id: session.userId })],
      ])
      .create([
        node('node'),
        relation('out', '', 'createdBy', {
          createdAt: DateTime.local(),
          active: true,
        }),
        node('user'),
      ])
      .run();
  }

  async attachBaseNode(id: ID, baseNodeId: ID, attachName: string) {
    await this.db
      .query()
      .match([
        [node('node', 'FileNode', { id })],
        [node('attachNode', 'BaseNode', { id: baseNodeId })],
      ])
      .create([
        node('node'),
        relation('in', '', attachName, ACTIVE),
        node('attachNode'),
      ])
      .run();
  }

  private async attachParent(id: ID, parentId: ID) {
    await this.db
      .query()
      .match([
        [node('node', 'FileNode', { id })],
        [node('parent', 'FileNode', { id: parentId })],
      ])
      .create([
        node('node'),
        relation('out', '', 'parent', ACTIVE),
        node('parent'),
      ])
      .run();
  }

  async rename(fileNode: FileNode, newName: string): Promise<void> {
    // TODO Do you have permission to rename the file?
    try {
      await this.db.updateProperty({
        type: IFileNode,
        object: fileNode,
        key: 'name',
        value: newName,
      });
    } catch (e) {
      this.logger.error('Could not rename', { id: fileNode.id, newName });
      throw new ServerException('Could not rename file node', e);
    }
  }

  async move(id: ID, newParentId: ID, session: Session): Promise<void> {
    try {
      await this.db
        .query()
        .match([
          matchSession(session),
          [node('newParent', [], { id: newParentId })],
          [
            node('file', 'FileNode', { id }),
            relation('out', 'rel', 'parent', ACTIVE),
            node('oldParent', []),
          ],
        ])
        .delete('rel')
        .create([
          node('newParent'),
          relation('in', '', 'parent', {
            active: true,
            createdAt: DateTime.local(),
          }),
          node('file'),
        ])
        .run();
    } catch (e) {
      this.logger.error('Failed to move', { id, newParentId, exception: e });
      throw new ServerException('Failed to move', e);
    }
  }

  async delete(fileNode: FileNode, session: Session): Promise<void> {
    const canDelete = await this.db.checkDeletePermission(fileNode.id, session);

    if (!canDelete)
      throw new UnauthorizedException(
        'You do not have the permission to delete this File item'
      );

    try {
      await this.db.deleteNode(fileNode);
    } catch (exception) {
      this.logger.error('Failed to delete', { id: fileNode.id, exception });
      throw new ServerException('Failed to delete', exception);
    }
  }
}

function first<T>(nodes: readonly T[]): T {
  const node = nodes[0];
  if (!node) {
    throw new NotFoundException();
  }
  return node;
}
