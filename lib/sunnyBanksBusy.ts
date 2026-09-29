/**
 * "Is the Sunny Banks panel busy right now?" (rendering a clip or building
 * a zip). The episode row sits above the panel, outside it, so it can't
 * see the panel's own state. The panel reports here and the row reads it,
 * so an episode can't be swapped out from under a render in progress.
 */
let busy = false;
const listeners = new Set<() => void>();

export function setSunnyBanksBusy(next: boolean): void {
  if (busy === next) return;
  busy = next;
  for (const listener of listeners) listener();
}

export function getSunnyBanksBusy(): boolean {
  return busy;
}

export function subscribeSunnyBanksBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
