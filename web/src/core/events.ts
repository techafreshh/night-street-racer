// Typed signal-port EventEmitter (Godot-signal port).
// Small typed module API mirroring the GameState typed writer/reader
// pairs (select_event/get_current_event): explicit on()/emit() instead
// of loose globals. Used by main.ts for boot/menu events.

export type EventHandler<T = unknown> = (payload: T) => void;

export class EventEmitter<Events extends Record<string, unknown>> {
  private handlers: { [K in keyof Events]?: Array<EventHandler<Events[K]>> } = {};

  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    const list = this.handlers[event];
    if (list !== undefined) {
      list.push(handler);
    } else {
      this.handlers[event] = [handler];
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.handlers[event];
    if (list === undefined) {
      return;
    }
    for (const handler of list) {
      handler(payload);
    }
  }
}
