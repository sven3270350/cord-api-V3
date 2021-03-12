import { Injectable } from '@nestjs/common';
import { Session } from '../../common';
import { PinRepository } from './pin.repository';

@Injectable()
export class PinService {
  constructor(private readonly repo: PinRepository) {}

  async isPinned(id: string, session: Session): Promise<boolean> {
    return await this.repo.isPinned(id, session);
  }

  async togglePinned(
    id: string,
    session: Session,
    pinned?: boolean
  ): Promise<boolean> {
    pinned ??= !(await this.repo.isPinned(id, session));
    if (pinned) {
      await this.repo.add(id, session);
    } else {
      await this.repo.remove(id, session);
    }
    return pinned;
  }
}
