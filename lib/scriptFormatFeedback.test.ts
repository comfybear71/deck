import { describe, expect, it } from "vitest";
import { scriptFormatButtonLabel } from "./scriptFormatFeedback";

describe("scriptFormatButtonLabel", () => {
  it("says what Format did, then goes back to its name", () => {
    expect(scriptFormatButtonLabel("formatted")).toBe("\u2713 Formatted");
    expect(scriptFormatButtonLabel("tidy")).toBe("Already tidy");
    expect(scriptFormatButtonLabel(null)).toBe("\u21e5 Format");
  });
});
