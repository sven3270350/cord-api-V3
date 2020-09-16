import { ISession } from '../../../common';
import { Engagement } from '../dto';

export class EngagementCreatedEvent {
  constructor(public engagement: Engagement, readonly session: ISession) {}
}
