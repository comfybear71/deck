import { describe, expect, it } from "vitest";
import {
  appendSunnyBanksActionToPrompt,
  collectRenderedClips,
  fingerprintWorkspace,
  mergeSunnyBanksActIds,
  mintWorkspaceId,
  nextSunnyBanksActId,
  parseSunnyBanksActHeader,
  parseSunnyBanksEpisodeHeader,
  parseSunnyBanksGodDocument,
  parseSunnyBanksSceneHeader,
  parseSunnyBanksScriptBlock,
  parseSunnyBanksTitledActHeader,
  isSunnyBanksGhostTargetLine,
  isSunnyBanksLocationCutaway,
  buildSunnyBanksLocationCutawayPrompt,
  buildSunnyBanksHoldScriptLine,
  insertSunnyBanksLineAfter,
  insertSunnyBanksLineBefore,
  replaceSunnyBanksSourceLine,
  removeSunnyBanksSourceLine,
  rewriteSunnyBanksSpeakerLine,
  shiftKeyedIndexRecord,
  unshiftKeyedIndexRecord,
  preserveRenderedRuntimes,
  decodeSunnyBanksPastedScript,
  resolveSunnyBanksScriptLocationId,
  sunnyBanksQueueChunks,
  SUNNY_BANKS_ACTS,
  toSunnyBanksActId,
  buildSunnyBanksHighlightSegments,
} from "./SkidmarksSunnyBanksPanel";
import { SUNNY_BANKS_CAST, SUNNY_BANKS_LOCATIONS, buildSunnyBanksSpeakingPrompt } from "@/lib/sunnyBanks";

describe("decodeSunnyBanksPastedScript", () => {
  it("turns a URL-encoded paste into real spaces and newlines", () => {
    const encoded =
      "this%20morning.%0AShazza:%20We%20will%20need%20everybody%20to%20purchase%20their%20drop%20bear%20kit%20or%20some%20drop%20bear%20repellent%20to%20keep%20you%20safe.%0A";
    expect(decodeSunnyBanksPastedScript(encoded)).toBe(
      "this morning.\nShazza: We will need everybody to purchase their drop bear kit or some drop bear repellent to keep you safe.\n"
    );
    const chunks = parseSunnyBanksScriptBlock(decodeSunnyBanksPastedScript(encoded));
    expect(chunks.some((chunk) => chunk.characterName === "Shazza" && chunk.line.startsWith("We will need"))).toBe(
      true
    );
  });

  it("leaves a normal typed script alone, including a lone percent", () => {
    const plain = "Shazza: You right?\nDazza: Yeah nah, 20% off.";
    expect(decodeSunnyBanksPastedScript(plain)).toBe(plain);
  });
});

describe("parseSunnyBanksScriptBlock", () => {
  it("skips blank lines and splits on newlines", () => {
    const chunks = parseSunnyBanksScriptBlock("Shazza: You right?\n\nDazza: Yeah nah.\n");
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ characterName: "Shazza", line: "You right?", kind: "speak" });
    expect(chunks[1]).toMatchObject({ characterName: "Dazza", line: "Yeah nah.", kind: "speak" });
  });

  it("matches Name says: as well as Name:", () => {
    const chunks = parseSunnyBanksScriptBlock('Nan says: "Cuppa?"');
    expect(chunks[0]).toMatchObject({ characterName: "Nan", line: '"Cuppa?"', kind: "speak" });
  });

  it("uses the canonical SUNNY_BANKS_CAST key for spaced names, not a synthetic id", () => {
    const chunks = parseSunnyBanksScriptBlock("ranger bazza: Move along.\nUnit 4S: Yup yup. Naaah.");
    expect(chunks[0].characterName).toBe("Ranger Bazza");
    expect(chunks[0].characterName).toBe(SUNNY_BANKS_CAST["Ranger Bazza"].name);
    expect(chunks[1].characterName).toBe("Unit 4S");
    expect(chunks[1].characterName).toBe(SUNNY_BANKS_CAST["Unit 4S"].name);
  });

  it("empty dialogue after the speaker is a Hold, not a guessed line", () => {
    const chunks = parseSunnyBanksScriptBlock("Ranger Bazza:");
    expect(chunks).toEqual([
      {
        raw: "Ranger Bazza:",
        characterName: "Ranger Bazza",
        line: "",
        kind: "hold",
        locationId: "office_storefront",
        sourceLineIndex: 0,
      },
    ]);
  });

  it("continuation lines keep the previous speaker", () => {
    const chunks = parseSunnyBanksScriptBlock("Shazza: You right?\nDon't start.");
    expect(chunks[1]).toMatchObject({ characterName: "Shazza", line: "Don't start.", kind: "speak" });
  });

  it("looks up the whole character record by name — Unit 4S stays bare feet, no invented shoes", () => {
    const chunks = parseSunnyBanksScriptBlock("Unit 4S: Yup yup. Naaah.");
    const lock = SUNNY_BANKS_CAST[chunks[0].characterName];
    expect(lock).toBe(SUNNY_BANKS_CAST["Unit 4S"]);
    expect(lock.look).toContain("bare feet");
    expect(lock.look).not.toMatch(/shoe|boot|sneaker/i);
    expect(chunks[0].line).not.toMatch(/shoe|boot|sneaker/i);
  });

  it("does not invent a speaker that is not a CAST key", () => {
    const chunks = parseSunnyBanksScriptBlock("Some Guest: hello");
    expect(chunks[0].characterName).toBe("Shazza");
    expect(chunks[0].line).toBe("Some Guest: hello");
    expect(SUNNY_BANKS_CAST["Some Guest"]).toBeUndefined();
  });

  it("skips # EPISODE: / === ACT headers and does not turn them into queue rows", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "# EPISODE: Drop Bears Dilemma\n=== ACT I ===\nShazza: You right?\n=== ACT II ===\nDazza: Yeah nah."
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ characterName: "Shazza", line: "You right?", kind: "speak" });
    expect(chunks[1]).toMatchObject({ characterName: "Dazza", line: "Yeah nah.", kind: "speak" });
  });

  it("carries [Location: id] onto following rows until the next location tag", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "[Location: main_entrance_sign]\nRanger Bazza: Well here we go.\nShazza: You right?\n[Location: caravan_interior]\nDazza: Yeah nah."
    );
    expect(chunks[0].locationId).toBe("main_entrance_sign");
    expect(chunks[1].locationId).toBe("main_entrance_sign");
    expect(chunks[2].locationId).toBe("caravan_interior");
    expect(SUNNY_BANKS_LOCATIONS[chunks[0].locationId!].image).toBe(
      "/skidmarks/sunnybanks/main-entrance-sign.jpg"
    );
    expect(SUNNY_BANKS_LOCATIONS[chunks[2].locationId!].image).toBe(
      "/skidmarks/sunnybanks/caravan-interior.jpg"
    );
  });

  it("ignores an unknown location id instead of inventing a plate", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "[Location: moon_base]\nShazza: You right?"
    );
    expect(chunks[0].locationId).toBe("office_storefront");
  });

  it("stamps the locked default plate on every row until a [Location:] tag, then carries that id", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "Shazza: You right?\nDazza: Yeah nah.\n[Location: site_laundry]\nNan: Cuppa?"
    );
    expect(chunks[0].locationId).toBe("office_storefront");
    expect(chunks[1].locationId).toBe("office_storefront");
    expect(chunks[2].locationId).toBe("site_laundry");
  });

  it("strips [Action: text] from the spoken line and stores it as prompt context", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "[Action: leans on the tub]\nShazza: You right?\nDazza: Yeah nah. [Action: holds the dryer]"
    );
    expect(chunks[0]).toMatchObject({
      characterName: "Shazza",
      line: "You right?",
      action: "leans on the tub",
    });
    expect(chunks[1]).toMatchObject({
      characterName: "Dazza",
      line: "Yeah nah.",
      action: "holds the dryer",
    });
    const gold = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST.Shazza, chunks[0].line);
    const prompt = appendSunnyBanksActionToPrompt(gold, chunks[0].action);
    expect(prompt.startsWith(gold)).toBe(true);
    expect(prompt).toContain("leans on the tub");
    expect(gold).not.toContain("leans on the tub");
  });

  it("strips [Character Name: look] onto appearanceModifier and does not rewrite gold", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "[Character Unit 4S: holding the bucket hat brim]\nUnit 4S: Yup yup. Naaah.\nRanger Bazza: [Character Ranger Bazza: whistle in his teeth] Move along."
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      characterName: "Unit 4S",
      line: "Yup yup. Naaah.",
      kind: "speak",
      appearanceModifier: "holding the bucket hat brim",
    });
    expect(chunks[1]).toMatchObject({
      characterName: "Ranger Bazza",
      line: "Move along.",
      appearanceModifier: "whistle in his teeth",
    });
    const gold = buildSunnyBanksSpeakingPrompt(SUNNY_BANKS_CAST["Unit 4S"], chunks[0].line);
    const prompt = appendSunnyBanksActionToPrompt(gold, chunks[0].appearanceModifier);
    expect(prompt.startsWith(gold)).toBe(true);
    expect(prompt).toContain("holding the bucket hat brim");
    expect(gold).toContain("bare feet");
    expect(gold).not.toContain("holding the bucket hat brim");
    expect(SUNNY_BANKS_CAST["Unit 4S"].look).toBe(
      "short purple alien, antennae, bulging eyes, teal bucket hat, holding a pair of thongs, bare feet"
    );
  });

  it("does not turn blank or tag-only lines into queue rows", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "\n[Location: site_laundry]\n[Action: leans on the tub]\n[Character Shazza: cigarette behind ear]\n\n[Location: ]\n[Action:]\n[Character Shazza:]\nShazza: You right?\n"
    );
    expect(chunks).toHaveLength(1);
    expect(sunnyBanksQueueChunks(chunks)).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      characterName: "Shazza",
      line: "You right?",
      kind: "speak",
      locationId: "site_laundry",
      action: "leans on the tub",
      appearanceModifier: "cigarette behind ear",
    });
  });

  it("maps [Character Name: override] onto the next speaker and never mints an Idle ghost row", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "[Character Name: override]\nShazza: You right?\n[Character Name:]\nDazza: Yeah nah."
    );
    expect(sunnyBanksQueueChunks(chunks)).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      characterName: "Shazza",
      line: "You right?",
      appearanceModifier: "override",
    });
    expect(chunks[1]).toMatchObject({ characterName: "Dazza", line: "Yeah nah." });
    expect(chunks.every((chunk) => chunk.kind !== "scene" || chunk.line.length > 0)).toBe(true);
  });

  it("maps === THE EPISODE TAG === as a final in-memory scene chunk, not a queue row", () => {
    expect(parseSunnyBanksSceneHeader("=== THE EPISODE TAG ===")).toBe("THE EPISODE TAG");
    expect(parseSunnyBanksSceneHeader("=== ACT III ===")).toBeNull();
    expect(parseSunnyBanksActHeader("=== ACT III — CROWD CUTAWAY ===")).toBeNull();
    expect(parseSunnyBanksTitledActHeader("=== ACT III — CROWD CUTAWAY ===")).toEqual({
      actId: "III",
      label: "ACT III — CROWD CUTAWAY",
    });
    expect(parseSunnyBanksSceneHeader("=== ACT III — CROWD CUTAWAY ===")).toBe("ACT III — CROWD CUTAWAY");
    const chunks = parseSunnyBanksScriptBlock(
      [
        "[Location: caravan_interior]",
        "Unit 4S: Yup yup. Naaah.",
        "",
        "=== THE EPISODE TAG ===",
      ].join("\n")
    );
    expect(chunks.at(-1)).toMatchObject({
      kind: "scene",
      characterName: "",
      line: "THE EPISODE TAG",
      locationId: "caravan_interior",
    });
    const queue = sunnyBanksQueueChunks(chunks);
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      characterName: "Unit 4S",
      line: "Yup yup. Naaah.",
      kind: "speak",
      locationId: "caravan_interior",
    });
    expect(SUNNY_BANKS_CAST[queue[0].characterName].look).toBe(
      "short purple alien, antennae, bulging eyes, teal bucket hat, holding a pair of thongs, bare feet"
    );
    expect(SUNNY_BANKS_CAST[queue[0].characterName].look).toContain("bare feet");
    expect(SUNNY_BANKS_CAST[queue[0].characterName].look).not.toMatch(/shoe|boot|sneaker/i);
  });

  it("parses the Act III God Script: titled scenes, bandage look, Crowd: as location Hold", () => {
    expect(isSunnyBanksGhostTargetLine("Crowd:")).toBe(true);
    expect(isSunnyBanksGhostTargetLine("Ranger Bazza:")).toBe(false);
    const script = [
      "=== ACT III — THE CON ===",
      "[Location: main_entrance_sign]",
      "Shazza: Help me with the sign it’s been 100 days now since the last drop bear attack. Where’s Baza? I’ve got a plan.",
      "",
      "[Location: main_entrance_sign]",
      "[Character Dazza lying flat on his back on the ground completely wrapped head to toe in white hospital gauze and thick medical bandages look of extreme pain]",
      "Dazza: These drop bear attacks are getting worse every year geez shazza is there anything we can do about it? I would hate to see this happen to anyone else.",
      "",
      "[Location: office_storefront]",
      "Shazza: That’s perfect, Bazza, now we just have to put our little plan into action",
      "",
      "[Location: office_storefront]",
      "[Action: Shazza cupping hands to mouth, yelling]",
      "Shazza: Hey listen everybody, I need everyone’s attention! We’ve just had another drop bear dilemma.",
      "",
      "=== ACT III — CROWD CUTAWAY ===",
      "[Location: office_storefront]",
      "Crowd:",
      "",
      "=== ACT III — THE APOLOGY ===",
      "[Location: office_storefront]",
      "Shazza: One of the staff members was attacked by a drop bear this morning. We will need everybody to purchase their drop bear kit or some drop bear repellent to keep you safe.",
    ].join("\n");
    const chunks = parseSunnyBanksScriptBlock(script);
    const queue = sunnyBanksQueueChunks(chunks);
    expect(queue).toHaveLength(6);
    expect(queue.map((chunk) => chunk.characterName)).toEqual([
      "Shazza",
      "Dazza",
      "Shazza",
      "Shazza",
      "Crowd",
      "Shazza",
    ]);
    expect(queue[4]).toMatchObject({
      characterName: "Crowd",
      line: "",
      kind: "hold",
      locationId: "office_storefront",
    });
    expect(queue[1].appearanceModifier).toContain("bandages");
    expect(queue[1].appearanceModifier).toContain("gauze");
    expect(queue[1].locationId).toBe("main_entrance_sign");
    expect(queue[3].action).toBe("Shazza cupping hands to mouth, yelling");
    expect(queue[3].locationId).toBe("office_storefront");
    expect(queue[5].line).toContain("drop bear kit");
    expect(queue[5].action).toBeUndefined();
    expect(chunks.filter((chunk) => chunk.kind === "scene").map((chunk) => chunk.line)).toEqual([
      "ACT III — THE CON",
      "ACT III — CROWD CUTAWAY",
      "ACT III — THE APOLOGY",
    ]);
    expect(queue.some((chunk) => /crowd/i.test(chunk.line))).toBe(false);
    const gold = SUNNY_BANKS_CAST.Dazza.look;
    expect(gold).not.toContain("bandages");
    expect(queue[1].appearanceModifier).not.toBe(gold);

    const doc = parseSunnyBanksGodDocument(script);
    expect(doc.hasActHeaders).toBe(true);
    expect(doc.actIds).toEqual(["III"]);
    expect(doc.actScripts.III).toContain("=== ACT III — CROWD CUTAWAY ===");
    expect(sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(doc.actScripts.III))).toHaveLength(6);
  });

  it("live QA: Act III drone Crowd: is an Idle Hold so Render is not Clips already loaded", () => {
    const script = [
      "Shazza: Help me with the sign it’s been 100 days now since the last drop bear",
      "Shazza: attack. Where’s Baza? I’ve got a plan.",
      "Dazza: These drop bear attacks are getting worse every year geez shazza is there anything we",
      "Dazza: We can do about it?",
      "Dazza: I would hate to see this happen to anyone else.",
      "Shazza: That’s perfect, Bazza, now we just have to put our little plan into action",
      "Shazza: Hey listen everybody, [yells] I need everyone’s attention! We’ve just had another drop bear dilemma.",
      "Shazza: One of the staff members was attacked by a drop bear this morning.",
      "Shazza: We will need everybody to purchase their drop bear kit or some drop bear repellent",
      "Shazza: to keep you safe.",
      "",
      "=== ACT III — CROWD CUTAWAY ===",
      "[Location: caravan_park_grounds]",
      "[Action: Fast dynamic drone shot, powering around, sweeping wide angle view seeing the crowd of park residents looking confused]",
      "Crowd:",
    ].join("\n");
    const chunks = parseSunnyBanksScriptBlock(script);
    const queue = sunnyBanksQueueChunks(chunks);
    expect(queue).toHaveLength(11);
    expect(queue.filter((chunk) => chunk.kind === "speak")).toHaveLength(10);
    const cutaway = queue[10];
    expect(cutaway).toMatchObject({
      characterName: "Crowd",
      line: "",
      kind: "hold",
    });
    expect(cutaway.action).toMatch(/Fast dynamic drone shot/i);
    expect(cutaway.action).toMatch(/crowd of park residents/i);
    expect(resolveSunnyBanksScriptLocationId("caravan_park_grounds")).toBeUndefined();
    expect(cutaway.locationId).toBe("office_storefront");
    expect(isSunnyBanksLocationCutaway(cutaway)).toBe(true);
    expect(buildSunnyBanksLocationCutawayPrompt(cutaway.action)).toContain("Fast dynamic drone shot");
    expect(buildSunnyBanksLocationCutawayPrompt(cutaway.action)).not.toContain("Shazza,");
    expect("Crowd" in SUNNY_BANKS_CAST).toBe(false);

    const previous: Record<number, { lineKey: string; status: "done"; videoUrl: string; characterName: string; line: string }> =
      {};
    queue.slice(0, 10).forEach((chunk, index) => {
      previous[index] = {
        lineKey: chunk.raw,
        status: "done",
        videoUrl: `https://example.test/clip-${index}.mp4`,
        characterName: chunk.characterName,
        line: chunk.line,
      };
    });
    const remapped = preserveRenderedRuntimes(chunks, previous);
    expect(Object.keys(remapped)).toHaveLength(10);
    expect(remapped[10]).toBeUndefined();
  });
});

describe("God Script headers", () => {
  it("reads # EPISODE: as the workspace title", () => {
    expect(parseSunnyBanksEpisodeHeader("# EPISODE: Drop Bears Dilemma")).toEqual({
      title: "Drop Bears Dilemma",
    });
    expect(parseSunnyBanksEpisodeHeader("Shazza: You right?")).toBeNull();
  });

  it("names an act buffer from === ACT I / === ACT 2", () => {
    expect(parseSunnyBanksActHeader("=== ACT I ===")).toBe("I");
    expect(parseSunnyBanksActHeader("=== ACT 2")).toBe("II");
    expect(parseSunnyBanksActHeader("=== ACT IV ===")).toBe("IV");
  });

  it("resolves location tokens onto the six locked park plates", () => {
    expect(resolveSunnyBanksScriptLocationId("main_entrance_sign")).toBe("main_entrance_sign");
    expect(resolveSunnyBanksScriptLocationId("Main Entrance Sign")).toBe("main_entrance_sign");
    expect(resolveSunnyBanksScriptLocationId("office_storefront")).toBe("office_storefront");
    expect(resolveSunnyBanksScriptLocationId("nope")).toBeUndefined();
  });

  it("splits a pasted God Script into per-act buffers and carries location forward", () => {
    const doc = parseSunnyBanksGodDocument(
      [
        "# EPISODE: Drop Bears Dilemma",
        "=== ACT I ===",
        "[Location: main_entrance_sign]",
        "Ranger Bazza: Well here we go.",
        "=== ACT II ===",
        "Dazza: Yeah nah.",
        "=== ACT III ===",
        "[Location: caravan_interior]",
        "Unit 4S: Yup yup. Naaah.",
        "=== THE EPISODE TAG ===",
      ].join("\n")
    );
    expect(doc.episodeTitle).toBe("Drop Bears Dilemma");
    expect(doc.hasActHeaders).toBe(true);
    expect(doc.actIds).toEqual(["I", "II", "III"]);
    expect(doc.actScripts.I).toContain("Ranger Bazza: Well here we go.");
    expect(doc.actScripts.I).not.toContain("# EPISODE:");
    expect(doc.actScripts.II).toContain("Dazza: Yeah nah.");
    expect(doc.actScripts.II).toContain("[Location: main_entrance_sign]");
    const actTwo = parseSunnyBanksScriptBlock(doc.actScripts.II);
    expect(actTwo[0].locationId).toBe("main_entrance_sign");
    const actThree = parseSunnyBanksScriptBlock(doc.actScripts.III);
    expect(actThree[0]).toMatchObject({
      characterName: "Unit 4S",
      line: "Yup yup. Naaah.",
      locationId: "caravan_interior",
    });
    expect(SUNNY_BANKS_CAST["Unit 4S"].look).toContain("bare feet");
    expect(doc.actScripts.III).toContain("=== THE EPISODE TAG ===");
    expect(actThree.at(-1)).toMatchObject({ kind: "scene", line: "THE EPISODE TAG" });
    expect(sunnyBanksQueueChunks(actThree)).toHaveLength(1);
    expect(mergeSunnyBanksActIds(["I", "II", "III"], ["I", "II", "III", "IV"])).toEqual([
      "I",
      "II",
      "III",
      "IV",
    ]);
  });
});

describe("SUNNY_BANKS_ACTS", () => {
  it("opens on three in-memory act buffers, not a persisted episode schema", () => {
    expect(SUNNY_BANKS_ACTS).toEqual(["I", "II", "III"]);
  });

  it("names the next in-memory act IV, then V, without a Neon row", () => {
    expect(nextSunnyBanksActId(["I", "II", "III"])).toBe("IV");
    expect(nextSunnyBanksActId(["I", "II", "III", "IV"])).toBe("V");
    expect(toSunnyBanksActId(4)).toBe("IV");
    expect(toSunnyBanksActId(20)).toBe("XX");
  });
});

describe("workspace save ids", () => {
  const emptyActs = { I: "", II: "", III: "" };
  const emptyMaps = { I: {}, II: {}, III: {} };
  const base = {
    defaultLocationId: "office_storefront",
    actIds: ["I", "II", "III"],
    activeAct: "I",
    actScripts: emptyActs,
    characterOverrides: emptyMaps,
    locationOverrides: emptyMaps,
    runtimeMap: emptyMaps,
  };

  it("mints a fresh id for every save even when the snapshot fingerprint matches", () => {
    const fingerprint = fingerprintWorkspace(base);
    const first = mintWorkspaceId(1_700_000_000_000, 1, fingerprint);
    const second = mintWorkspaceId(1_700_000_000_000, 2, fingerprint);
    expect(first).not.toBe(second);
    expect(first).toContain(fingerprint);
    expect(second).toContain(fingerprint);
  });

  it("changes the fingerprint when a clip URL lands, so a later save is a distinct card", () => {
    const before = fingerprintWorkspace(base);
    const after = fingerprintWorkspace({
      ...base,
      actIds: ["I", "II", "III", "IV"],
      actScripts: { ...emptyActs, IV: "Shazza: Extra." },
      characterOverrides: { ...emptyMaps, IV: {} },
      locationOverrides: { ...emptyMaps, IV: {} },
      runtimeMap: {
        I: { 0: { lineKey: "Shazza: You right?", status: "done", videoUrl: "https://blob.example/a.mp4" } },
        II: {},
        III: {},
        IV: {},
      },
    });
    expect(after).not.toBe(before);
  });
});

describe("collectRenderedClips", () => {
  it("only returns done clips with a video URL, grouped by the act they were rendered on", () => {
    const clips = collectRenderedClips({
      actIds: ["I", "II", "III"],
      actScripts: {
        I: "Shazza: You right?\nDazza: Yeah nah.",
        II: "Nan:",
        III: "",
      },
      characterOverrides: { I: {}, II: {}, III: {} },
      runtimeMap: {
        I: {
          0: { lineKey: "Shazza: You right?", status: "done", videoUrl: "https://blob.example/i0.mp4" },
          1: { lineKey: "Dazza: Yeah nah.", status: "failed", error: "nope" },
        },
        II: {
          0: { lineKey: "Nan:", status: "done", videoUrl: "https://blob.example/ii0.mp4" },
        },
        III: {},
      },
    });
    expect(clips).toEqual([
      {
        act: "I",
        index: 0,
        characterName: "Shazza",
        lineLabel: "You right?",
        videoUrl: "https://blob.example/i0.mp4",
        durationSec: undefined,
      },
      {
        act: "II",
        index: 0,
        characterName: "Nan",
        lineLabel: "Silent hold",
        videoUrl: "https://blob.example/ii0.mp4",
        durationSec: undefined,
      },
    ]);
  });

  it("walks a dynamically added Act IV instead of dropping it", () => {
    const clips = collectRenderedClips({
      actIds: ["I", "II", "III", "IV"],
      actScripts: {
        I: "",
        II: "",
        III: "",
        IV: "Unit 4S: Yup yup. Naaah.",
      },
      characterOverrides: { I: {}, II: {}, III: {}, IV: {} },
      runtimeMap: {
        I: {},
        II: {},
        III: {},
        IV: {
          0: {
            lineKey: "Unit 4S: Yup yup. Naaah.",
            status: "done",
            videoUrl: "https://blob.example/iv0.mp4",
          },
        },
      },
    });
    expect(clips).toEqual([
      {
        act: "IV",
        index: 0,
        characterName: "Unit 4S",
        lineLabel: "Yup yup. Naaah.",
        videoUrl: "https://blob.example/iv0.mp4",
        durationSec: undefined,
      },
    ]);
    expect(SUNNY_BANKS_CAST["Unit 4S"].look).toContain("bare feet");
  });

  it("ignores a trailing scene header so queue indices stay aligned with rendered clips", () => {
    const clips = collectRenderedClips({
      actIds: ["III"],
      actScripts: {
        III: "Unit 4S: Yup yup. Naaah.\n=== THE EPISODE TAG ===",
      },
      characterOverrides: { III: {} },
      runtimeMap: {
        III: {
          0: {
            lineKey: "Unit 4S: Yup yup. Naaah.",
            status: "done",
            videoUrl: "https://blob.example/iii0.mp4",
          },
        },
      },
    });
    expect(clips).toEqual([
      {
        act: "III",
        index: 0,
        characterName: "Unit 4S",
        lineLabel: "Yup yup. Naaah.",
        videoUrl: "https://blob.example/iii0.mp4",
        durationSec: undefined,
      },
    ]);
  });

  it("keeps a Done clip when a location tag prepends and speaker+dialogue still match", () => {
    const clips = collectRenderedClips({
      actIds: ["I"],
      actScripts: {
        I: "[Location: main_entrance_sign]\nShazza: You right?",
      },
      characterOverrides: { I: {} },
      runtimeMap: {
        I: {
          0: {
            lineKey: "Shazza: You right?",
            status: "done",
            videoUrl: "https://blob.example/i0.mp4",
            characterName: "Shazza",
            line: "You right?",
          },
        },
      },
    });
    expect(clips).toEqual([
      {
        act: "I",
        index: 0,
        characterName: "Shazza",
        lineLabel: "You right?",
        videoUrl: "https://blob.example/i0.mp4",
        durationSec: undefined,
      },
    ]);
  });
});

describe("preserveRenderedRuntimes", () => {
  it("rebinds a Done clip onto a later index when a new line is inserted above", () => {
    const previous = {
      0: {
        lineKey: "Shazza: You right?",
        status: "done" as const,
        videoUrl: "https://blob.example/a.mp4",
        characterName: "Shazza",
        line: "You right?",
      },
    };
    const chunks = parseSunnyBanksScriptBlock("Dazza: Yeah nah.\nShazza: You right?");
    const next = preserveRenderedRuntimes(chunks, previous);
    expect(next[0]).toBeUndefined();
    expect(next[1]).toMatchObject({
      status: "done",
      videoUrl: "https://blob.example/a.mp4",
      characterName: "Shazza",
      line: "You right?",
    });
  });

  it("keeps Done when only a tag-only look line is added, without creating a ghost Idle row", () => {
    const previous = {
      0: {
        lineKey: "Shazza: You right?",
        status: "done" as const,
        videoUrl: "https://blob.example/a.mp4",
        characterName: "Shazza",
        line: "You right?",
      },
    };
    const chunks = parseSunnyBanksScriptBlock(
      "[Character Name: holding the bucket hat brim]\nShazza: You right?"
    );
    expect(sunnyBanksQueueChunks(chunks)).toHaveLength(1);
    const next = preserveRenderedRuntimes(chunks, previous);
    expect(Object.keys(next)).toEqual(["0"]);
    expect(next[0]?.status).toBe("done");
    expect(next[0]?.videoUrl).toBe("https://blob.example/a.mp4");
  });

  it("inserting a Hold between two Done clips keeps both clips and idles the new row", () => {
    const script = "Shazza: You right?\nDazza: Yeah nah.";
    const previous = {
      0: {
        lineKey: "Shazza: You right?",
        status: "done" as const,
        videoUrl: "https://blob.example/a.mp4",
        characterName: "Shazza",
        line: "You right?",
      },
      1: {
        lineKey: "Dazza: Yeah nah.",
        status: "done" as const,
        videoUrl: "https://blob.example/b.mp4",
        characterName: "Dazza",
        line: "Yeah nah.",
      },
    };
    const first = parseSunnyBanksScriptBlock(script)[0];
    const nextScript = insertSunnyBanksLineAfter(
      script,
      first.sourceLineIndex,
      buildSunnyBanksHoldScriptLine("Shazza")
    );
    expect(nextScript).toBe("Shazza: You right?\nShazza:\nDazza: Yeah nah.");
    const next = preserveRenderedRuntimes(parseSunnyBanksScriptBlock(nextScript), previous);
    expect(next[0]?.status).toBe("done");
    expect(next[0]?.videoUrl).toBe("https://blob.example/a.mp4");
    expect(next[1]).toBeUndefined();
    expect(next[2]?.status).toBe("done");
    expect(next[2]?.videoUrl).toBe("https://blob.example/b.mp4");
    expect(sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(nextScript))[1]).toMatchObject({
      characterName: "Shazza",
      line: "",
      kind: "hold",
    });
  });
});

describe("insert and rewrite script lines", () => {
  it("inserts before the first queue line without dropping a leading scene header", () => {
    const script = "=== THE CON ===\nShazza: You right?";
    const shazza = parseSunnyBanksScriptBlock(script).find((chunk) => chunk.characterName === "Shazza");
    expect(shazza?.sourceLineIndex).toBe(1);
    const next = insertSunnyBanksLineBefore(script, shazza!.sourceLineIndex, "Crowd:");
    expect(next).toBe("=== THE CON ===\nCrowd:\nShazza: You right?");
  });

  it("rewrites speaker dialogue and keeps a leading [Location:] tag", () => {
    expect(rewriteSunnyBanksSpeakerLine("[Location: office_storefront] Shazza: You right?", "Shazza", "Mate.")).toBe(
      "[Location: office_storefront] Shazza: Mate."
    );
    expect(rewriteSunnyBanksSpeakerLine("Shazza: You right?", "Shazza", "")).toBe("Shazza:");
    const script = "Shazza: You right?\nDazza: Yeah nah.";
    expect(replaceSunnyBanksSourceLine(script, 0, "Shazza: Mate.")).toBe("Shazza: Mate.\nDazza: Yeah nah.");
  });

  it("removes an Idle Hold between two Done clips without dropping those clips", () => {
    const script = "Shazza: You right?\nShazza:\nDazza: Yeah nah.";
    const previous = {
      0: {
        lineKey: "Shazza: You right?",
        status: "done" as const,
        videoUrl: "https://blob.example/a.mp4",
        characterName: "Shazza",
        line: "You right?",
      },
      2: {
        lineKey: "Dazza: Yeah nah.",
        status: "done" as const,
        videoUrl: "https://blob.example/b.mp4",
        characterName: "Dazza",
        line: "Yeah nah.",
      },
    };
    const idle = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(script))[1];
    expect(idle.kind).toBe("hold");
    const nextScript = removeSunnyBanksSourceLine(script, idle.sourceLineIndex);
    expect(nextScript).toBe("Shazza: You right?\nDazza: Yeah nah.");
    const next = preserveRenderedRuntimes(parseSunnyBanksScriptBlock(nextScript), previous);
    expect(next[0]?.videoUrl).toBe("https://blob.example/a.mp4");
    expect(next[1]?.videoUrl).toBe("https://blob.example/b.mp4");
  });

  it("shifts per-row overrides so a mid-list insert does not steal the next line's plate", () => {
    expect(shiftKeyedIndexRecord({ 0: "a", 1: "b", 2: "c" }, 1)).toEqual({ 0: "a", 2: "b", 3: "c" });
  });

  it("pulls later overrides down when an Idle row is removed", () => {
    expect(unshiftKeyedIndexRecord({ 0: "a", 1: "b", 2: "c" }, 1)).toEqual({ 0: "a", 1: "c" });
  });
});

describe("buildSunnyBanksHighlightSegments (script editor tag coloring)", () => {
  it("reconstructs the exact original text by concatenating every segment", () => {
    const raw =
      "[Location: office_storefront]\nDazza: [Action: holds a spray can] hey Shaz, where do you want me to setup the scam repellent?\n[Character Shazza: cigarette behind ear]\nShazza: not so loud.";
    const segments = buildSunnyBanksHighlightSegments(raw);
    expect(segments.map((s) => s.text).join("")).toBe(raw);
  });

  it("colors [Location: ...] as location, [Character ...] as character, [Action: ...] as action", () => {
    const raw = "[Location: office_storefront] [Character Dazza: holding a can] [Action: sprays it around]";
    const segments = buildSunnyBanksHighlightSegments(raw).filter((s) => s.kind !== "plain");
    expect(segments).toEqual([
      { kind: "location", text: "[Location: office_storefront]" },
      { kind: "character", text: "[Character Dazza: holding a can]" },
      { kind: "action", text: "[Action: sprays it around]" },
    ]);
  });

  it("colors a literal [silence] the same as an action tag (display-only — not a parsed tag)", () => {
    const segments = buildSunnyBanksHighlightSegments("Dazza: [silence]").filter((s) => s.kind !== "plain");
    expect(segments).toEqual([{ kind: "action", text: "[silence]" }]);
  });

  it("leaves an unrecognized bracket (e.g. a bare parenthetical or [silent], no trailing e) uncolored", () => {
    const segments = buildSunnyBanksHighlightSegments("Dazza: [silent] holds two bottles");
    expect(segments.every((s) => s.kind === "plain")).toBe(true);
  });

  it("matches [Character Name look] without a colon, same as the parser's own tag shape", () => {
    const segments = buildSunnyBanksHighlightSegments("[Character Dazza wrapped in bandages]").filter(
      (s) => s.kind !== "plain"
    );
    expect(segments).toEqual([{ kind: "character", text: "[Character Dazza wrapped in bandages]" }]);
  });
});
