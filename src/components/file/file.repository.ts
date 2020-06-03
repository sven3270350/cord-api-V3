import {
  Injectable,
  NotFoundException,
  InternalServerErrorException as ServerException,
} from '@nestjs/common';
import { contains, node, Node, Query, relation } from 'cypher-query-builder';
import type { Pattern } from 'cypher-query-builder/dist/typings/clauses/pattern';
import { camelCase, intersection } from 'lodash';
import { DateTime } from 'luxon';
import { generate } from 'shortid';
import { ISession } from '../../common';
import { DatabaseService, ILogger, Logger, matchSession } from '../../core';
import {
  BaseNode,
  Directory,
  File,
  FileListInput,
  FileNodeCategory,
  FileNodeType,
  FileVersion,
} from './dto';

const isActive = { active: true };

@Injectable()
export class FileRepository {
  constructor(
    private readonly db: DatabaseService,
    @Logger('file:repository') private readonly logger: ILogger
  ) {}

  async getBaseNodeById(id: string, session: ISession): Promise<BaseNode> {
    return this.getBaseNodeBy(session, [
      [node('node', 'FileNode', { id, ...isActive })],
      matchName(),
    ]);
  }

  async getBaseNodeByName(
    parentId: string,
    name: string,
    session: ISession
  ): Promise<BaseNode> {
    return this.getBaseNodeBy(session, [
      [
        node('parent', 'FileNode', isActive),
        relation('in', '', 'parent', isActive),
        node('node', 'FileNode', isActive),
        relation('out', '', 'name', isActive),
        node('name', 'Property', { value: name, ...isActive }),
      ],
    ]);
  }

  async getParentsById(id: string, session: ISession): Promise<BaseNode[]> {
    const results = await this.getBaseNodeQuery(session, [
      [
        node('start', 'FileNode', { id, ...isActive }),
        relation('out', 'parent', 'parent', isActive, '*'),
        node('node', 'FileNode', isActive),
      ],
      matchName(),
    ])
      .orderBy('size(parent)')
      .run();
    return results.map(baseNodeFromResult);
  }

  async getChildrenById(
    session: ISession,
    nodeId: string,
    input: FileListInput
  ): Promise<{ children: BaseNode[]; total: number; hasMore: boolean }> {
    const query = this.db
      .query()
      .match([
        matchSession(session),
        [
          node('start', 'FileNode', { id: nodeId, ...isActive }),
          relation('in', '', 'parent', isActive),
          node('node', 'FileNode', isActive),
        ],
        matchCreatedBy(),
        matchName(),
      ])
      .where({ 'name.value': contains(input.filter.name ?? '') })
      .with('COUNT(node) as total, name, node, createdBy')
      .return([
        'node',
        'total',
        {
          name: [{ value: 'name' }],
          createdBy: [{ id: 'createdById' }],
        },
      ])
      .orderBy([`${input.sort} ${input.order}`])
      .skip((input.page - 1) * input.count)
      .limit(input.count);

    const result = await query.run();

    const total = result.length === 0 ? 0 : result[0].total;

    const children = result.map(baseNodeFromResult);

    return {
      children,
      total: total,
      hasMore: false, // TODO
    };
  }

  private async getBaseNodeBy(
    session: ISession,
    patterns: Pattern[][]
  ): Promise<BaseNode> {
    const nodes = await this.getBaseNodesBy(session, patterns);
    return first(nodes);
  }

  private async getBaseNodesBy(
    session: ISession,
    patterns: Pattern[][]
  ): Promise<BaseNode[]> {
    const query = this.getBaseNodeQuery(session, patterns);
    const results = await query.run();
    return results.map(baseNodeFromResult);
  }

  private getBaseNodeQuery(session: ISession, patterns: Pattern[][]) {
    this.db.assertPatternsIncludeIdentifier(patterns, 'node', 'name');

    const query = this.db
      .query()
      .match([matchSession(session), ...patterns, matchCreatedBy()])
      .return([
        'node',
        {
          name: [{ value: 'name' }],
          createdBy: [{ id: 'createdById' }],
        },
      ]);
    return query;
  }

  async getLatestVersionId(fileId: string): Promise<string> {
    const latestVersionResult = await this.db
      .query()
      .match([
        node('node', 'FileNode', { id: fileId, ...isActive }),
        relation('in', '', 'parent', isActive),
        node('fv', 'FileVersion'),
      ])
      .return('fv')
      .orderBy('fv.createdAt', 'DESC')
      .limit(1)
      .first();
    if (!latestVersionResult) {
      throw new NotFoundException();
    }
    return latestVersionResult.fv.properties.id;
  }

  async getVersionDetails(id: string, session: ISession): Promise<FileVersion> {
    const matchLatestVersionProp = (q: Query, prop: string, variable = prop) =>
      q
        .with('*')
        .optionalMatch([
          node('requestingUser'),
          relation('in', '', 'member'),
          node('acl', 'ACL', { [camelCase(`canRead-${prop}`)]: true }),
          relation('out', '', 'toNode'),
          node('fv'),
          relation('out', '', prop, isActive),
          node(variable, 'Property', isActive),
        ]);
    const matchFileVersion = node('fv', 'FileVersion', { id, ...isActive });
    const result = await this.db
      .query()
      .match([
        matchSession(session),
        [matchFileVersion],
        [
          matchFileVersion,
          relation('out', '', 'name', isActive),
          node('name', 'Property', isActive),
        ],
        [
          matchFileVersion,
          relation('out', '', 'createdBy', isActive),
          node('createdBy'),
        ],
      ])
      .call(matchLatestVersionProp, 'size')
      .call(matchLatestVersionProp, 'mimeType')
      .call(matchLatestVersionProp, 'category')
      .return([
        'fv',
        {
          name: [{ value: 'name' }],
          size: [{ value: 'size' }],
          mimeType: [{ value: 'mimeType' }],
          category: [{ value: 'category' }],
          createdBy: [{ id: 'createdById' }],
        },
      ])
      .first();
    if (!result) {
      throw new NotFoundException();
    }

    const fv = result.fv as Node<{ id: string; createdAt: DateTime }>;

    return {
      id: fv.properties.id,
      type: FileNodeType.FileVersion,
      name: result.name,
      size: result.size as number,
      mimeType: result.mimeType as string,
      category: result.category as FileNodeCategory,
      createdAt: fv.properties.createdAt,
      createdById: result.createdById as string,
    };
  }

  async createDirectory(
    parentId: string | undefined,
    name: string,
    session: ISession
  ): Promise<string> {
    const id = generate();
    await this.db.createNode({
      session,
      type: Directory.classType,
      input: {
        id,
        name,
        createdAt: DateTime.local(),
      },
      acls: {
        canReadName: true,
        canEditName: true,
      },
      baseNodeLabel: ['Directory', 'FileNode'],
      aclEditProp: 'canCreateDirectory',
    });

    await this.attachCreator(id, session);

    if (parentId) {
      await this.attachParent(id, parentId);
    }

    return id;
  }

  async createFile(
    parentId: string | undefined,
    name: string,
    session: ISession
  ) {
    const fileId = generate();
    await this.db.createNode({
      session,
      type: File.classType,
      baseNodeLabel: ['File', 'FileNode'],
      input: {
        id: fileId,
        name,
        createdAt: DateTime.local(),
      },
      acls: {
        canReadParent: true,
        canEditParent: true,
        canReadName: true,
        canEditName: true,
        canReadType: true,
        canEditType: true,
      },
      aclEditProp: 'canCreateFile',
    });

    await this.attachCreator(fileId, session);

    if (parentId) {
      await this.attachParent(fileId, parentId);
    }

    return fileId;
  }

  async createFileVersion(
    fileId: string,
    input: Pick<FileVersion, 'id' | 'name' | 'mimeType' | 'size' | 'category'>,
    session: ISession
  ) {
    const createdAt = DateTime.local();

    await this.db.createNode({
      session,
      type: FileVersion.classType,
      baseNodeLabel: ['FileVersion', 'FileNode'],
      input: {
        ...input,
        createdAt,
      },
      acls: {
        canReadSize: true,
        canEditSize: true,
        canReadParent: true,
        canEditParent: true,
        canReadMimeType: true,
        canEditMimeType: true,
        canReadCategory: true,
        canEditCategory: true,
        canReadName: true,
        canEditName: true,
        canReadModifiedAt: true,
        canEditModifiedAt: true,
      },
    });

    await this.attachCreator(input.id, session);
    await this.attachParent(input.id, fileId);
  }

  private async attachCreator(id: string, session: ISession) {
    await this.db
      .query()
      .match([
        [node('node', 'FileNode', { id })],
        [node('user', 'User', { id: session.userId, active: true })],
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

  private async attachParent(id: string, parentId: string) {
    await this.db
      .query()
      .match([
        [node('node', 'FileNode', { id, active: true })],
        [node('parent', 'FileNode', { id: parentId, active: true })],
      ])
      .create([
        node('node'),
        relation('out', '', 'parent', { active: true }),
        node('parent'),
      ])
      .run();
  }

  async rename(
    fileNode: BaseNode,
    newName: string,
    session: ISession
  ): Promise<void> {
    try {
      await this.db.updateProperty({
        session,
        object: fileNode,
        key: 'name',
        value: newName,
        nodevar: 'fileNode',
      });
    } catch (e) {
      this.logger.error('could not rename', { id: fileNode.id, newName });
      throw new ServerException('could not rename');
    }
  }

  async move(
    id: string,
    newParentId: string,
    session: ISession
  ): Promise<void> {
    try {
      await this.db
        .query()
        .match([
          matchSession(session),
          [node('newParent', [], { id: newParentId, active: true })],
          [
            node('file', 'FileNode', { id, active: true }),
            relation('out', 'rel', 'parent', { active: true }),
            node('oldParent', [], { active: true }),
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
      throw new ServerException('Failed to move');
    }
  }

  async delete(fileNode: BaseNode, session: ISession): Promise<void> {
    try {
      await this.db.deleteNode({
        session,
        object: fileNode,
        aclEditProp: 'canDeleteOwnUser',
      });
    } catch (e) {
      this.logger.error('Failed to delete', { id: fileNode.id, exception: e });
      throw new ServerException('Failed to delete');
    }
  }

  async checkConsistency(type: FileNodeType, session: ISession): Promise<void> {
    const fileNodes = await this.db
      .query()
      .matchNode('fileNode', type, isActive)
      .return('fileNode.id as id')
      .run();

    const requiredProperties =
      type === FileNodeType.FileVersion
        ? ['size', 'mimeType', 'category']
        : ['name'];
    const uniqueRelationships = ['createdBy', 'parent'];

    for (const fn of fileNodes) {
      for (const rel of uniqueRelationships) {
        const unique = await this.db.isRelationshipUnique({
          session,
          id: fn.id,
          relName: rel,
          srcNodeLabel: type,
        });
        if (!unique) {
          throw new Error(`Node ${fn.id} has multiple ${rel} relationships`);
        }
      }
      for (const prop of requiredProperties) {
        const hasIt = await this.db.hasProperty({
          session,
          id: fn.id,
          prop,
          nodevar: type,
        });
        if (!hasIt) {
          throw new Error(`Node ${fn.id} is missing ${prop}`);
        }
      }
    }
  }
}

const matchName = () => [
  node('node'),
  relation('out', '', 'name', isActive),
  node('name', 'Property', isActive),
];
const matchCreatedBy = () => [
  node('node'),
  relation('out', '', 'createdBy', isActive),
  node('createdBy', 'User'),
];

function first<T>(nodes: T[]): T {
  const node = nodes[0];
  if (!node) {
    throw new NotFoundException();
  }
  return node;
}

const baseNodeFromResult = (result: any): BaseNode => {
  const base = result.node as Node<{ id: string; createdAt: DateTime }>;
  const type = typeFromLabels(base);

  return {
    type,
    id: base.properties.id,
    name: result.name as string,
    createdAt: base.properties.createdAt,
    createdById: result.createdById as string,
  };
};

const typeFromLabels = (base: Node<unknown>) =>
  intersection(base.labels, [
    'Directory',
    'File',
    'FileVersion',
  ])[0] as FileNodeType;
