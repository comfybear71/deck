/**
 * "Is Shorts busy right now?" (a plate or clip in the Shorts panel, or an
 * episode zip building from its EPISODES card), the same as Sunnybank's
 * `lib/sunnyBanksBusy.ts`. While it's busy the EPISODES row can't open
 * another episode, so a clip can never land in the wrong one.
 */
import { createBusyFlag } from "./busyFlag";

const flag = createBusyFlag();

export function setShortsBusy(next: boolean, reason: string = "panel"): void {
  flag.set(next, reason);
}

export function getShortsBusy(): boolean {
  return flag.get();
}

export function subscribeShortsBusy(listener: () => void): () => void {
  return flag.subscribe(listener);
}
