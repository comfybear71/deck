/**
 * "Is Sunny Banks busy right now?" (a clip rendering in the panel, or an
 * episode zip building from its EPISODES card). The episode row sits
 * above the panel, outside it, so it can't see the panel's own state.
 * Each side reports here under its own reason and the row reads the
 * total, so an episode can't be swapped out from under a render, and one
 * side finishing never clears the other side's busy flag. Built with the
 * shared `createBusyFlag` (Shorts has its own, `lib/shortsBusy.ts`).
 */
import { createBusyFlag } from "./busyFlag";

const flag = createBusyFlag();

export function setSunnyBanksBusy(next: boolean, reason: string = "panel"): void {
  flag.set(next, reason);
}

export function getSunnyBanksBusy(): boolean {
  return flag.get();
}

export function subscribeSunnyBanksBusy(listener: () => void): () => void {
  return flag.subscribe(listener);
}
