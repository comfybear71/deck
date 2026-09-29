/**
 * "Is Sunny Banks busy right now?" (a clip rendering in the panel, or an
 * episode zip building from its EPISODES card). The episode row sits
 * above the panel, outside it, so it can't see the panel's own state.
 * Each side reports here under its own reason and the row reads the
 * total, so an episode can't be swapped out from under a render, and one
 * side finishing never clears the other side's busy flag.
 */
const reasons = new Set<string>();
const listeners = new Set<() => void>();

export function setSunnyBanksBusy(next: boolean, reason: string = "panel"): void {
  const before = reasons.size > 0;
  if (next) reasons.add(reason);
  else reasons.delete(reason);
  if (before === reasons.size > 0) return;
  for (const listener of listeners) listener();
}

export function getSunnyBanksBusy(): boolean {
  return reasons.size > 0;
}

export function subscribeSunnyBanksBusy(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
