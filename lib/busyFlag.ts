/**
 * "Is this genre busy right now?" as a tiny shared store (2026-09-30):
 * a clip rendering in a panel, or an episode zip building from its
 * EPISODES card. The episode row sits above the panel, outside it, so it
 * can't see the panel's own state. Each side reports under its own
 * reason and the row reads the total, so an episode can't be swapped out
 * from under a render, and one side finishing never clears the other
 * side's busy flag. Sunnybank and Shorts each have one
 * (`lib/sunnyBanksBusy.ts`, `lib/shortsBusy.ts`), made the same way.
 * In memory only.
 */
export interface BusyFlag {
  set: (next: boolean, reason?: string) => void;
  get: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

export function createBusyFlag(): BusyFlag {
  const reasons = new Set<string>();
  const listeners = new Set<() => void>();
  return {
    set(next, reason = "panel") {
      const before = reasons.size > 0;
      if (next) reasons.add(reason);
      else reasons.delete(reason);
      if (before === reasons.size > 0) return;
      for (const listener of listeners) listener();
    },
    get: () => reasons.size > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
