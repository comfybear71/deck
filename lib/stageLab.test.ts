import { describe, expect, it } from "vitest";
import { MAX_SHOT_CAST } from "./shotCast";
import {
  buildDeliciaeStarter,
  compileStagePrompt,
  emptyStageShot,
  isTalkingPersonShot,
  lockedCameraFor,
  matchCastByHints,
  missingPlatePictures,
  presentActors,
  resolveStageChain,
  stageFramingLine,
  stageVideoBackend,
  tickActor,
  type StageCastMember,
  type StageLocation,
  type StageShot,
} from "./stageLab";

function member(partial: Partial<StageCastMember> & Pick<StageCastMember, "id" | "name" | "kind">): StageCastMember {
  return {
    pictureUrl: `https://example.com/${partial.id}.jpg`,
    voiceId: partial.kind === "person" ? "voice_abc1234567890" : null,
    look: "",
    group: "skidmarks",
    ...partial,
  };
}

function shotFrom(partial: Partial<StageShot> & { actors: StageShot["actors"] }): StageShot {
  return emptyStageShot({
    id: "s1",
    number: 1,
    sceneId: "sc",
    sceneLabel: "ACT I — KITCHEN",
    locationId: "loc_kitchen",
    ...partial,
  });
}

const kitchen: StageLocation = {
  id: "loc_kitchen",
  key: "kitchen",
  name: "Kitchen",
  pictureUrl: "https://example.com/kitchen.jpg",
};

const house = member({ id: "sk:house", name: "House", kind: "object" });
const arthur = member({ id: "sk:arthur", name: "Arthur", kind: "person" });
const droid = member({ id: "sk:droid", name: "Service droid", kind: "object" });

function onStage(members: StageCastMember[], presentIds: string[], actions: Record<string, string> = {}): StageShot["actors"] {
  return members.map((m) => ({
    ...m,
    present: presentIds.includes(m.id),
    action: actions[m.id] ?? "",
    lookOverride: "",
  }));
}

describe("Stage prompt compile", () => {
  it("puts framing words first so a close-up is not a full-body wide", () => {
    const shot = shotFrom({
      framing: "cu",
      line: "",
      actors: onStage([arthur], ["sk:arthur"]),
    });
    const compiled = compileStagePrompt(shot, kitchen);
    const prompt = compiled.platePrompt;
    expect(prompt.indexOf(stageFramingLine("cu"))).toBe(0);
    expect(prompt).toMatch(/^Front CU/);
    expect(prompt.indexOf("Front CU")).toBeLessThan(prompt.indexOf("LOCKED background"));
  });

  it("never auto-ticks anyone named only in action text", () => {
    const shot = shotFrom({
      actors: onStage([house, arthur, droid], ["sk:house"], { "sk:house": "House greets Arthur from the wall" }),
      speakerId: "sk:house",
      line: "Good morning, Arthur.",
    });
    const names = presentActors(shot).map((a) => a.name);
    expect(names).toEqual(["House"]);
    expect(names).not.toContain("Arthur");
    const compiled = compileStagePrompt(shot, kitchen);
    expect(compiled.images.filter((i) => i.role === "actor").map((i) => i.label)).toEqual([
      "House Cast card (Object)",
    ]);
    expect(compiled.platePrompt).toMatch(/names in action text never add extra bodies/);
  });

  it("talking human locks Hold + MCU, face toward camera, eyes off to the side, never smile or looking down", () => {
    const shot = shotFrom({
      cameraMove: "pan",
      framing: "wide",
      line: "Eggs on toast.",
      speakerId: "sk:arthur",
      actors: onStage([arthur], ["sk:arthur"], { "sk:arthur": "At the counter" }),
    });
    expect(isTalkingPersonShot(shot)).toBe(true);
    expect(lockedCameraFor(shot)).toEqual({ cameraMove: "hold", framing: "mcu" });
    expect(stageVideoBackend(shot)).toBe("ltx");
    const prompt = compileStagePrompt(shot, kitchen).platePrompt;
    expect(prompt).toMatch(/face toward camera/i);
    expect(prompt).toMatch(/eyes looking off to the side/i);
    expect(prompt).toMatch(/mouth visible/i);
    expect(prompt).toMatch(/Never smile/);
    expect(prompt).toMatch(/Never looking down/);
    expect(prompt.toLowerCase()).not.toMatch(/(?<!never )smile/);
  });

  it("objects never get a human face and never route to LTX", () => {
    const shot = shotFrom({
      line: "Good morning, Arthur.",
      speakerId: "sk:house",
      actors: onStage([house, arthur], ["sk:house", "sk:arthur"]),
    });
    expect(isTalkingPersonShot(shot)).toBe(false);
    expect(stageVideoBackend(shot)).toBe("grok");
    const prompt = compileStagePrompt(shot, kitchen).platePrompt;
    expect(prompt).toMatch(/House is an object/i);
    expect(prompt).toMatch(/Never give this object a human face/i);
    expect(prompt).not.toMatch(/House is prominent, mouth and head move naturally/);
  });

  it("always includes the Location picture — never a white void", () => {
    const shot = shotFrom({
      actors: onStage([arthur], ["sk:arthur"]),
    });
    const compiled = compileStagePrompt(shot, kitchen);
    expect(compiled.images[0]).toMatchObject({ role: "location", url: kitchen.pictureUrl });
    expect(compiled.platePrompt).toMatch(/Never a white void/);
    expect(compiled.platePrompt).toMatch(/Kitchen/);
    expect(missingPlatePictures(shot, { ...kitchen, pictureUrl: null })).toContain("Kitchen has no picture");
  });

  it("refuses a missing Cast picture on a ticked actor", () => {
    const shot = shotFrom({
      actors: onStage([{ ...droid, pictureUrl: null }], ["sk:droid"]),
    });
    expect(missingPlatePictures(shot, kitchen).join(" ")).toMatch(/Service droid has no Cast picture/);
  });
});

describe("Stage chain", () => {
  it("blocks chain across a location change", () => {
    const a = shotFrom({
      id: "a",
      number: 1,
      locationId: "kitchen",
      renderStatus: "done",
      renderUrl: "https://example.com/a.mp4",
      actors: onStage([arthur], ["sk:arthur"]),
    });
    const b = shotFrom({
      id: "b",
      number: 2,
      locationId: "bedroom",
      startMode: "chain",
      chainFromNumber: 1,
      actors: onStage([arthur], ["sk:arthur"]),
    });
    const status = resolveStageChain([a, b], b);
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.reason).toMatch(/location change/);
  });

  it("explains when the previous shot has no render", () => {
    const a = shotFrom({
      id: "a",
      number: 1,
      locationId: "kitchen",
      renderStatus: "idle",
      actors: onStage([arthur], ["sk:arthur"]),
    });
    const b = shotFrom({
      id: "b",
      number: 2,
      locationId: "kitchen",
      startMode: "chain",
      chainFromNumber: 1,
      actors: onStage([arthur], ["sk:arthur"]),
    });
    const status = resolveStageChain([a, b], b);
    expect(status.ok).toBe(false);
    if (!status.ok) expect(status.reason).toMatch(/rendered first/);
  });

  it("allows chain from a done render on the same set, without copying Cast", () => {
    const a = shotFrom({
      id: "a",
      number: 1,
      locationId: "kitchen",
      renderStatus: "done",
      renderUrl: "https://example.com/a.mp4",
      actors: onStage([house, arthur], ["sk:house", "sk:arthur"]),
    });
    const b = shotFrom({
      id: "b",
      number: 2,
      locationId: "kitchen",
      startMode: "chain",
      chainFromNumber: 1,
      actors: onStage([arthur], ["sk:arthur"]),
    });
    expect(resolveStageChain([a, b], b)).toEqual({ ok: true, fromNumber: 1, previousId: "a" });
    expect(presentActors(b).map((x) => x.name)).toEqual(["Arthur"]);
  });
});

describe("Deliciae starter + Cast match", () => {
  it("matches House, Arthur and Service droid by name onto real Cast", () => {
    expect(matchCastByHints([house, arthur, droid], ["house"])?.name).toBe("House");
    expect(matchCastByHints([house, arthur, droid], ["service droid", "droid"])?.name).toBe("Service droid");
    const starter = buildDeliciaeStarter([house, arthur, droid], [kitchen]);
    expect(starter.shots).toHaveLength(4);
    expect(presentActors(starter.shots[0]).map((a) => a.name).sort()).toEqual(["Arthur", "House"]);
    expect(starter.shots[0].line).toBe("Good morning, Arthur.");
    expect(presentActors(starter.shots[3]).map((a) => a.name).sort()).toEqual(["Arthur", "Service droid"]);
  });

  it("does not invent a Service droid card when Cast has none", () => {
    const starter = buildDeliciaeStarter([house, arthur], [kitchen]);
    expect(starter.shots[3].actors.some((a) => /droid/i.test(a.name) && a.present)).toBe(false);
  });

  it("caps ticks at MAX_SHOT_CAST", () => {
    const many = Array.from({ length: 6 }, (_, i) => member({ id: `sk:p${i}`, name: `P${i}`, kind: "person" }));
    let shot = shotFrom({ actors: onStage(many, []) });
    for (const m of many) shot = tickActor(shot, m.id, true);
    expect(presentActors(shot)).toHaveLength(MAX_SHOT_CAST);
  });
});
