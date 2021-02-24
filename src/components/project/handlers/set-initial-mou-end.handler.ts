import { ServerException, UnauthorizedException } from '../../../common';
import {
  DatabaseService,
  EventsHandler,
  IEventHandler,
  ILogger,
  Logger,
} from '../../../core';
import { IProject, ProjectStatus } from '../dto';
import { ProjectCreatedEvent, ProjectUpdatedEvent } from '../events';

type SubscribedEvent = ProjectCreatedEvent | ProjectUpdatedEvent;

@EventsHandler(ProjectCreatedEvent, ProjectUpdatedEvent)
export class SetInitialMouEnd implements IEventHandler<SubscribedEvent> {
  constructor(
    private readonly db: DatabaseService,
    @Logger('project:set-initial-mou-end') private readonly logger: ILogger
  ) {}

  async handle(event: SubscribedEvent) {
    this.logger.debug('Project mutation, set initial mou end', {
      ...event,
      event: event.constructor.name,
    });

    const project = 'project' in event ? event.project : event.updated;

    if (
      event instanceof ProjectUpdatedEvent && // allow setting initial if creating with non-in-dev status
      project.status !== ProjectStatus.InDevelopment
    ) {
      return;
    }
    if (!project.mouEnd.canRead) {
      throw new UnauthorizedException(
        `Current user cannot read Project's end date thus initial end date cannot be set`
      );
    }
    if (!project.initialMouEnd.canRead) {
      throw new UnauthorizedException(
        `Current user cannot read Project's initial end date thus initial end date cannot be set`
      );
    }
    if (
      project.initialMouEnd.value?.toMillis() ===
      project.mouEnd.value?.toMillis()
    ) {
      return;
    }

    try {
      const updatedProject = await this.db.updateProperties({
        type: IProject,
        object: project,
        props: ['initialMouEnd'],
        changes: {
          initialMouEnd: project.mouEnd.value || null,
        },
      });

      if (event instanceof ProjectUpdatedEvent) {
        event.updated = updatedProject;
      } else {
        event.project = updatedProject;
      }
    } catch (exception) {
      this.logger.error(`Could not set initial mou end on project`, {
        userId: event.session.userId,
        exception,
      });
      throw new ServerException(
        'Could not set initial mou end on project',
        exception
      );
    }
  }
}
