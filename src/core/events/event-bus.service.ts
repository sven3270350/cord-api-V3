import { Injectable, Type } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports
import { EventBus, EventHandlerType, IEvent } from '@nestjs/cqrs';
import { stripIndent } from 'common-tags';
import { AnyFn, ServerException } from '../../common';
import { IEventHandler } from './event-handler.decorator';

// eslint-disable-next-line @typescript-eslint/naming-convention
export abstract class IEventBus<EventBase extends IEvent = IEvent> {
  publish: <T extends EventBase>(event: T) => Promise<void>;
  publishAll: (events: EventBase[]) => Promise<void>;
}

/**
 * An EventBus where you can wait for event handling to finish.
 */
@Injectable()
export class SyncEventBus extends EventBus implements IEventBus {
  private readonly listenerMap = new Map<string, Set<AnyFn>>();

  async publish<T extends IEvent>(event: T): Promise<void> {
    const name = this.getEventName(event);
    for (const handler of this.listeners(name)) {
      await handler(event);
    }
  }

  async publishAll<T extends IEvent>(events: T[]): Promise<void> {
    await Promise.all(events.map((e) => this.publish(e)));
  }

  register(handlers: EventHandlerType[] = []) {
    const defined = new Set<string>();
    for (const handler of handlers) {
      if (defined.has(handler.name)) {
        throw new ServerException(stripIndent`
          Event handler "${handler.name}" has already been defined.
          Event handlers have to have unique class names to be registered correctly.
      `);
      }
      defined.add(handler.name);
    }

    super.register(handlers);
  }

  bind(handler: IEventHandler<IEvent>, name: string) {
    this.listeners(name).add((event) => handler.handle(event));
  }

  registerSagas(types: Array<Type<unknown>>) {
    if (types.length > 0) {
      throw new Error('Sagas are not supported with this EventBus');
    }
  }

  private listeners(name: string) {
    return mapGetOrCreate(this.listenerMap, name, () => new Set());
  }
}

const mapGetOrCreate = <K, V>(map: Map<K, V>, key: K, creator: () => V) => {
  if (map.has(key)) {
    return map.get(key)!;
  }
  const out = creator();
  map.set(key, out);
  return out;
};
