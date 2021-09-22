import { node, relation } from 'cypher-query-builder';
import { ID, ServerException } from '../../../common';
import {
  DatabaseService,
  EventsHandler,
  IEventHandler,
  ILogger,
  Logger,
} from '../../../core';
import { ACTIVE, deleteBaseNode } from '../../../core/database/query';
import { commitChangesetProps } from '../../changeset/commit-changeset-props.query';
import { rejectChangesetProps } from '../../changeset/reject-changeset-props.query';
import { ProjectChangeRequestStatus } from '../../project-change-request/dto';
import { ProjectChangeRequestFinalizedEvent } from '../../project-change-request/events';

type SubscribedEvent = ProjectChangeRequestFinalizedEvent;

@EventsHandler(ProjectChangeRequestFinalizedEvent)
export class ApplyFinalizedChangesetToEngagement
  implements IEventHandler<SubscribedEvent>
{
  constructor(
    private readonly db: DatabaseService,
    @Logger('engagement:change-request:finalized')
    private readonly logger: ILogger
  ) {}

  async handle(event: SubscribedEvent) {
    this.logger.debug('Applying changeset props');

    const changesetId = event.changeRequest.id;
    const status = event.changeRequest.status;

    try {
      // Update project engagement pending changes
      const engagements = await this.db
        .query()
        .match([
          node('project', 'Project'),
          relation('out', '', 'changeset', ACTIVE),
          node('changeset', 'Changeset', { id: changesetId }),
        ])
        .subQuery((sub) =>
          sub
            .with('project')
            .match([
              node('project'),
              relation('out', 'engagementRel', 'engagement', {
                active: true,
              }),
              node('node', 'Engagement'),
            ])
            .return('node')
            .union()
            .with('project, changeset')
            .match([
              node('project'),
              relation('out', 'engagementRel', 'engagement', {
                active: false,
              }),
              node('node', 'Engagement'),
              relation('in', 'changesetRel', 'changeset', ACTIVE),
              node('changeset'),
            ])
            .apply((q) =>
              status === ProjectChangeRequestStatus.Approved
                ? q.setValues({
                    'engagementRel.active': true,
                  })
                : q.apply(rejectChangesetProps())
            )
            .return('node')
        )
        .return<{ id: ID }>(['node.id as id'])
        .run();

      if (status !== ProjectChangeRequestStatus.Approved) {
        return;
      }
      await Promise.all(
        engagements.map(async ({ id }) => {
          // Skip looping for engagements created in changeset
          await this.db
            .query()
            .match([
              node('changeset', 'Changeset', { id: changesetId }),
              relation('in', '', 'changeset', ACTIVE),
              node('project', 'Project'),
              relation('out', '', 'engagement', ACTIVE),
              node('node', 'Engagement', { id }),
            ])
            .apply(commitChangesetProps())
            .return('node')
            .run();
        })
      );

      // Remove deleting engagements
      await this.removeDeletingEngagements(changesetId);
    } catch (exception) {
      throw new ServerException(
        'Failed to apply changeset to project',
        exception
      );
    }
  }

  async removeDeletingEngagements(changeset: ID) {
    await this.db
      .query()
      .match([
        node('project', 'Project'),
        relation('out', '', 'changeset', ACTIVE),
        node('changeset', 'Changeset', { id: changeset }),
      ])
      .match([
        node('project'),
        relation('out', '', 'engagement', ACTIVE),
        node('node', 'Engagement'),
        relation('in', '', 'changeset', { active: true, deleting: true }),
        node('changeset'),
      ])
      .apply(deleteBaseNode('node'))
      .return<{ count: number }>('count(node) as count')
      .run();
  }
}
