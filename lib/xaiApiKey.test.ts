import { afterEach, describe, expect, it, vi } from "vitest";
import {
  missingXaiApiKeyMessage,
  resolveXaiApiKey,
  resolveXaiApiKeySlot,
  XAI_API_KEY_B_ENV_VAR,
  XAI_API_KEY_ENV_VAR,
  XAI_API_KEY_SLOT_ENV_VAR,
} from "./xaiApiKey";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveXaiApiKeySlot", () => {
  it("defaults to A when unset, empty, or junk", () => {
    expect(resolveXaiApiKeySlot({})).toBe("A");
    expect(resolveXaiApiKeySlot({ [XAI_API_KEY_SLOT_ENV_VAR]: "" })).toBe("A");
    expect(resolveXaiApiKeySlot({ [XAI_API_KEY_SLOT_ENV_VAR]: "C" })).toBe("A");
  });

  it("accepts A/B case-insensitively with surrounding whitespace", () => {
    expect(resolveXaiApiKeySlot({ [XAI_API_KEY_SLOT_ENV_VAR]: "a" })).toBe("A");
    expect(resolveXaiApiKeySlot({ [XAI_API_KEY_SLOT_ENV_VAR]: " B " })).toBe("B");
  });
});

describe("resolveXaiApiKey", () => {
  it("reads XAI_API_KEY for slot A (today's single-key setup)", () => {
    const resolved = resolveXaiApiKey({ [XAI_API_KEY_ENV_VAR]: "key-a" });
    expect(resolved).toEqual({ key: "key-a", envVarName: XAI_API_KEY_ENV_VAR, slot: "A" });
  });

  it("reads XAI_API_KEY_B only when slot is B — never falls through to A", () => {
    expect(
      resolveXaiApiKey({
        [XAI_API_KEY_SLOT_ENV_VAR]: "B",
        [XAI_API_KEY_ENV_VAR]: "key-a",
        [XAI_API_KEY_B_ENV_VAR]: "key-b",
      })
    ).toEqual({ key: "key-b", envVarName: XAI_API_KEY_B_ENV_VAR, slot: "B" });

    expect(
      resolveXaiApiKey({
        [XAI_API_KEY_SLOT_ENV_VAR]: "B",
        [XAI_API_KEY_ENV_VAR]: "key-a",
      })
    ).toBeNull();
  });

  it("does not use KEY_B while slot is A", () => {
    expect(
      resolveXaiApiKey({
        [XAI_API_KEY_B_ENV_VAR]: "key-b",
      })
    ).toBeNull();
  });
});

describe("missingXaiApiKeyMessage", () => {
  it("names the active slot and both env vars", () => {
    const msg = missingXaiApiKeyMessage("Grok video", { [XAI_API_KEY_SLOT_ENV_VAR]: "B" });
    expect(msg).toContain(XAI_API_KEY_B_ENV_VAR);
    expect(msg).toContain("XAI_API_KEY_SLOT=B");
    expect(msg).toContain(XAI_API_KEY_ENV_VAR);
  });
});
