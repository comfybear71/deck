import { describe, expect, it } from "vitest";
import { createBusyFlag } from "./busyFlag";
import { getShortsBusy, setShortsBusy } from "./shortsBusy";
import { getSunnyBanksBusy } from "./sunnyBanksBusy";

describe("createBusyFlag", () => {
  it("stays busy until every reason is cleared, and tells listeners only on a real change", () => {
    const flag = createBusyFlag();
    let heard = 0;
    const off = flag.subscribe(() => (heard += 1));
    flag.set(true, "render");
    flag.set(true, "zip");
    flag.set(false, "zip");
    expect(flag.get()).toBe(true);
    flag.set(false, "render");
    expect(flag.get()).toBe(false);
    expect(heard).toBe(2);
    off();
  });

  it("Shorts and Sunnybank each have their own", () => {
    setShortsBusy(true, "panel");
    expect(getShortsBusy()).toBe(true);
    expect(getSunnyBanksBusy()).toBe(false);
    setShortsBusy(false, "panel");
    expect(getShortsBusy()).toBe(false);
  });
});
