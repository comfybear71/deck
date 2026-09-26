import { describe, expect, it } from "vitest";
import { SKIDMARKS_NODE_ID, BUDJU_NODE_ID } from "@/lib/constants";
import { parseStoredOpenSheet } from "./openSheetRestore";

describe("parseStoredOpenSheet", () => {
  it("reopens Skidmarks after a refresh", () => {
    expect(parseStoredOpenSheet(SKIDMARKS_NODE_ID)).toBe(SKIDMARKS_NODE_ID);
  });
  it("does not reopen other sheets", () => {
    expect(parseStoredOpenSheet(BUDJU_NODE_ID)).toBeNull();
    expect(parseStoredOpenSheet("something-else")).toBeNull();
  });
  it("handles nothing stored", () => {
    expect(parseStoredOpenSheet(null)).toBeNull();
    expect(parseStoredOpenSheet("")).toBeNull();
  });
});
