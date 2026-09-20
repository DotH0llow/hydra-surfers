/**
 * Typed event bus.
 *
 * Systems talk through events; UI and audio only subscribe. Add new events from the
 * OWNING module via module augmentation, never by editing a central switch:
 *
 * ```ts
 * declare module "../../core/events" {
 *   interface EventMap { "powerup:start": { id: string; duration: number } }
 * }
 * ```
 *
 * Hot-path emitters should reuse a module-level payload object instead of allocating
 * one per emit; listeners must treat payloads as read-only and must not retain them.
 */

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface EventMap {
  /** UI routed to a new screen. */
  "app:screen": { screen: string; previous: string };
  /** App finished loading assets and rendered its first frame. */
  "app:ready": { placeholders: number };
  /** Page visibility changed (the app pauses runs when hidden). */
  "app:visibility": { hidden: boolean };
  /** The server placed the last run: rank gained (or not) and how many players it overtook. */
  "app:rank": { improved: boolean; passed: number };
  /** A finished run was scored, just before the results screen (records broken, levels gained). */
  "app:runReport": { records: number; newBest: boolean; levelUp: boolean };
}

export type EventName = keyof EventMap;
export type Listener<K extends EventName> = (payload: EventMap[K]) => void;

type AnyListener = (payload: unknown) => void;

export class EventBus {
  private readonly listeners = new Map<string, AnyListener[]>();

  on<K extends EventName>(name: K, fn: Listener<K>): () => void {
    const list = this.listeners.get(name);
    // copy-on-write so emit can iterate without guarding against mutation
    const next = list ? list.slice() : [];
    next.push(fn as AnyListener);
    this.listeners.set(name, next);
    return () => this.off(name, fn);
  }

  once<K extends EventName>(name: K, fn: Listener<K>): () => void {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends EventName>(name: K, fn: Listener<K>): void {
    const list = this.listeners.get(name);
    if (!list) return;
    const i = list.indexOf(fn as AnyListener);
    if (i < 0) return;
    const next = list.slice();
    next.splice(i, 1);
    this.listeners.set(name, next);
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    const list = this.listeners.get(name);
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      try {
        list[i](payload);
      } catch (err) {
        console.error(`[events] listener for "${name}" threw`, err);
      }
    }
  }

  listenerCount(name: EventName): number {
    return this.listeners.get(name)?.length ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** The app-wide bus. Tests may construct their own `new EventBus()`. */
export const bus = new EventBus();
