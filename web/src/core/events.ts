// Typed signal-port EventEmitter (Godot-signal port).
// Small typed module API mirroring the GameState typed writer/reader
// pairs (select_event/get_current_event): explicit on()/off()/emit()
// instead of loose globals. emit() iterates over a snapshot so each
// subscriber fires exactly once per emit, even if a handler
// subscribes/unsubscribes mid-emit. RaceEvents is the concrete race
// signal map owned by this module; main.ts owns the shared instance.

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

  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    const list = this.handlers[event];
    if (list === undefined) {
      return;
    }
    const index = list.indexOf(handler);
    if (index !== -1) {
      list.splice(index, 1);
    }
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const list = this.handlers[event];
    if (list === undefined) {
      return;
    }
    for (const handler of [...list]) {
      handler(payload);
    }
  }
}

// Typed writer payload: which checkpoint the car crossed.
export type CheckpointPayload = {
  index: number;
};

// Typed writer payload: the authoritative race phase.
export type RaceStatePayload = {
  state: "countdown" | "racing" | "finished";
};

// Concrete race signal map: lap/phase signals with fixed payloads.
export type RaceEvents = {
  onCheckpoint: CheckpointPayload;
  onRaceStateChanged: RaceStatePayload;
};

// Typed factory: create the shared race signal bus.
export function createRaceEmitter(): EventEmitter<RaceEvents> {
  return new EventEmitter<RaceEvents>();
}
