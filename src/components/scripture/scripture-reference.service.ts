import { Node, node, relation } from 'cypher-query-builder';
import { sortBy } from 'lodash';
import { DateTime } from 'luxon';
import { ISession, Range } from '../../common';
import { DatabaseService, ILogger, Logger } from '../../core';
import { ScriptureRange, ScriptureRangeInput } from './dto';

export class ScriptureReferenceService {
  constructor(
    @Logger('scripture-reference:service') private readonly logger: ILogger,
    private readonly db: DatabaseService
  ) {}

  async create(
    producibleId: string,
    scriptureRefs: ScriptureRangeInput[] | undefined,
    session: ISession
  ): Promise<void> {
    if (!scriptureRefs) {
      return;
    }

    for (const sr of scriptureRefs) {
      await this.db
        .query()
        .match([
          node('node', 'BaseNode', {
            id: producibleId,
            active: true,
            owningOrgId: session.owningOrgId,
          }),
        ])
        .create([
          node('node'),
          relation('out', '', 'scriptureReferences', { active: true }),
          node('sr', ['ScriptureRange', 'BaseNode'], {
            ...ScriptureRange.fromReferences(sr),
            active: true,
            createdAt: DateTime.local(),
          }),
        ])
        .return('node')
        .run();
    }
  }

  async update(
    producibleId: string,
    scriptureRefs: ScriptureRangeInput[] | undefined,
    options: { isOverriding?: boolean } = {}
  ): Promise<void> {
    if (scriptureRefs === undefined) {
      return;
    }

    const rel = options.isOverriding
      ? 'scriptureReferencesOverride'
      : 'scriptureReferences';

    if (options.isOverriding) {
      await this.db
        .query()
        .match([
          node('product', 'Product', { id: producibleId, active: true }),
          relation('out', 'rel', 'isOverriding', { active: true }),
          node('propertyNode', 'Property', { active: true }),
        ])
        .setValues({
          'propertyNode.value': scriptureRefs !== null,
        })
        .run();
    }

    await this.db
      .query()
      .match([
        node('node', 'BaseNode', { id: producibleId, active: true }),
        relation('out', 'rel', rel, { active: true }),
        node('sr', 'ScriptureRange', { active: true }),
      ])
      .setValues({
        'rel.active': false,
        'sr.active': false,
      })
      .return('sr')
      .run();

    if (scriptureRefs !== null) {
      for (const sr of scriptureRefs) {
        await this.db
          .query()
          .match([node('node', 'BaseNode', { id: producibleId, active: true })])
          .create([
            node('node'),
            relation('out', '', rel, { active: true }),
            node('', ['ScriptureRange', 'BaseNode'], {
              ...ScriptureRange.fromReferences(sr),
              active: true,
              createdAt: DateTime.local(),
            }),
          ])
          .return('node')
          .run();
      }
    }
  }

  async list(
    producibleId: string,
    session: ISession,
    options: { isOverriding?: boolean } = {}
  ): Promise<ScriptureRange[]> {
    const results = await this.db
      .query()
      .match([
        node('node', 'BaseNode', {
          id: producibleId,
          active: true,
          owningOrgId: session.owningOrgId,
        }),
        relation(
          'out',
          '',
          options.isOverriding
            ? 'scriptureReferencesOverride'
            : 'scriptureReferences',
          {
            active: true,
          }
        ),
        node('scriptureRanges', 'ScriptureRange', { active: true }),
      ])
      .return('scriptureRanges')
      .asResult<{ scriptureRanges: Node<Range<number>> }>()
      .run();

    return sortBy(
      results.map((row) => row.scriptureRanges.properties),
      [(range) => range.start, (range) => range.end]
    ).map(ScriptureRange.fromIds);
  }
}
