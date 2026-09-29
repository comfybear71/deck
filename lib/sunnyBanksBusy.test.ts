import { describe, expect, it } from "vitest";
import { getSunnyBanksBusy, setSunnyBanksBusy } from "./sunnyBanksBusy";

describe("setSunnyBanksBusy", () => {
  it("stays busy until every reason is cleared", () => {
    setSunnyBanksBusy(true, "render");
    setSunnyBanksBusy(true, "zip");
    setSunnyBanksBusy(false, "zip");
    expect(getSunnyBanksBusy()).toBe(true);
    setSunnyBanksBusy(false, "render");
    expect(getSunnyBanksBusy()).toBe(false);
  });
});
