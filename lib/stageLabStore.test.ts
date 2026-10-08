import { describe, expect, it } from "vitest";
import { emptyStageShot, type StageCastMember } from "./stageLab";
import { hydrateStageShot, parseStageLabPersisted, serializeStageShot } from "./stageLabStore";

const arthur: StageCastMember = {
  id: "sk:arthur",
  name: "Arthur",
  kind: "person",
  pictureUrl: "https://example.com/arthur.jpg",
  voiceId: "voice_abc",
  look: "tall",
  group: "skidmarks",
};

describe("Stage lab store", () => {
  it("round-trips ticks, line, and plate URL without Cast pictures inline", () => {
    const shot = emptyStageShot({
      id: "shot_1",
      number: 1,
      sceneId: "sc",
      sceneLabel: "ACT I — KITCHEN",
      locationId: "loc_kitchen",
      line: "Eggs on toast.",
      speakerId: "sk:arthur",
      plateUrl: "https://blob.example/plate.jpg",
      plateStatus: "ready",
      actors: [
        {
          ...arthur,
          present: true,
          action: "At the counter",
          lookOverride: "",
        },
      ],
    });
    const raw = serializeStageShot(shot);
    expect(JSON.stringify(raw)).not.toMatch(/data:image/);
    expect(raw.presentIds).toEqual(["sk:arthur"]);
    const packed = parseStageLabPersisted({
      version: 1,
      scenes: [{ id: "sc", label: "ACT I — KITCHEN" }],
      shots: [raw],
      openShotId: "shot_1",
    });
    expect(packed?.shots[0]?.line).toBe("Eggs on toast.");
    const live = hydrateStageShot(packed!.shots[0], [arthur]);
    expect(live.actors[0]?.present).toBe(true);
    expect(live.actors[0]?.action).toBe("At the counter");
    expect(live.actors[0]?.pictureUrl).toBe(arthur.pictureUrl);
    expect(live.plateUrl).toBe("https://blob.example/plate.jpg");
  });

  it("rejects junk JSON", () => {
    expect(parseStageLabPersisted(null)).toBeNull();
    expect(parseStageLabPersisted({ version: 2 })).toBeNull();
  });
});
