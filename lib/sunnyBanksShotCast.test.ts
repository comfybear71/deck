import { describe, expect, it } from "vitest";
import { sceneSpeakersForRowCast, shotTextForRowCast } from "./sunnyBanksShotCast";

describe("shotTextForRowCast / sceneSpeakersForRowCast", () => {
  it("a row with its own [Action:] uses that text, even if a previous shot's sceneAction is still hanging around", () => {
    expect(
      shotTextForRowCast({
        action: "House sits empty",
        sceneAction: "Arthur walking out with Pip",
      }),
    ).toBe("House sits empty");
  });

  it("a later talking line in a two-hander still sees the shared Action", () => {
    expect(
      shotTextForRowCast({
        action: "",
        sceneAction: "Both men stay in frame",
        sceneKey: "scene-3",
      }),
    ).toBe("Both men stay in frame");
  });

  it("without a sceneKey, previous-scene speakers are not added", () => {
    expect(
      sceneSpeakersForRowCast({
        sceneSpeakers: ["Arthur", "Pip"],
      }),
    ).toBeUndefined();
  });

  it("a two-hander continuation still sees the scene's speakers", () => {
    expect(
      sceneSpeakersForRowCast({
        sceneKey: "scene-3",
        sceneSpeakers: ["Stuie", "Bloom"],
      }),
    ).toEqual(["Stuie", "Bloom"]);
  });
});
