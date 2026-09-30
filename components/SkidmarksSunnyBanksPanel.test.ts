import { describe, expect, it } from "vitest";
import {
  appendSunnyBanksActionToPrompt,
  collectRenderedClips,
  groupSunnyBanksClipsByAct,
  isSunnyBanksClipRowOpen,
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
  resetSunnyBanksClipRuntime,
  shiftSunnyBanksRuntimesForInsert,
  shiftSunnyBanksRuntimesForRemove,
  writeSunnyBanksRowRuntime,
  decodeSunnyBanksPastedScript,
  resolveSunnyBanksScriptLocationId,
  sunnyBanksQueueChunks,
  SUNNY_BANKS_ACTS,
  toSunnyBanksActId,
  buildSunnyBanksHighlightSegments,
  SUNNY_BANKS_HIGHLIGHT_CLASSES,
  buildSunnyBanksOverlaySegments,
  formatSunnyBanksGodScript,
} from "./SkidmarksSunnyBanksPanel";
import { SUNNY_BANKS_CAST, getSunnyBanksLocation, buildSunnyBanksSpeakingPrompt } from "@/lib/sunnyBanks";

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
    expect(getSunnyBanksLocation(chunks[0].locationId!)?.image).toBe(
      "/skidmarks/sunnybanks/main-entrance-sign.jpg"
    );
    expect(getSunnyBanksLocation(chunks[2].locationId!)?.image).toBe(
      "/skidmarks/sunnybanks/caravan-interior.jpg"
    );
  });

  it("keeps an unknown location as it is (the row warns) instead of quietly using the storefront (2026-09-30)", () => {
    const chunks = parseSunnyBanksScriptBlock(
      "[Location: moon_base]\nShazza: You right?\n[Location: Moon Base 2]\nDazza: Yeah nah."
    );
    expect(chunks[0].locationId).toBe("moon_base");
    expect(chunks[1].locationId).toBe("moon_base_2");
  });

  it("real EP01 (2026-09-30): [Location: park_site_4] is a built-in now, not the storefront", () => {
    const chunks = parseSunnyBanksScriptBlock("[Location: park_site_4]\nShazza: You right?\n[Location: Rock Art Outcrop]\nDazza: Yeah nah.");
    expect(chunks[0].locationId).toBe("park_site_4");
    expect(chunks[1].locationId).toBe("rock_art_outcrop");
  });

  it("an empty [Location: ] is still ignored", () => {
    const chunks = parseSunnyBanksScriptBlock("[Location: site_laundry]\nShazza: You right?\n[Location: ]\nDazza: Yeah nah.");
    expect(chunks[1].locationId).toBe("site_laundry");
  });

  it("real EP01 (2026-09-30): # Act I / # Act II are act headers, never a spoken or billed row", () => {
    expect(parseSunnyBanksActHeader("# Act I")).toBe("I");
    expect(parseSunnyBanksActHeader("## ACT II: The Con")).toBe("II");
    expect(parseSunnyBanksActHeader("# Act 3")).toBe("III");
    expect(parseSunnyBanksActHeader("# Actually no")).toBeNull();
    const chunks = parseSunnyBanksScriptBlock("# EPISODE: Drop Bears\n# Act I\nShazza: You right?\n# Scene notes\nDazza: Yeah nah.");
    expect(chunks.map((c) => c.characterName)).toEqual(["Shazza", "Dazza"]);
    expect(chunks.map((c) => c.line)).toEqual(["You right?", "Yeah nah."]);
    const doc = parseSunnyBanksGodDocument("# EPISODE: Drop Bears\n# Act I\nShazza: One.\n# Act II\nDazza: Two.");
    expect(doc.episodeTitle).toBe("Drop Bears");
    expect(doc.actIds).toEqual(["I", "II"]);
    expect(doc.actScripts.I).toBe("Shazza: One.");
    expect(doc.actScripts.II).toContain("Dazza: Two.");
    expect(doc.actScripts.II).not.toContain("# Act");
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
      "skinny purple alien, two antennae, big round bulging eyes, wide toothy grin, teal bucket hat, bare feet"
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
      "skinny purple alien, two antennae, big round bulging eyes, wide toothy grin, teal bucket hat, bare feet"
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
    // Kept as written (2026-09-30), so the row warns until a location
    // with that name is on the Locations row, instead of the storefront.
    expect(cutaway.locationId).toBe("caravan_park_grounds");
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

describe("formatSunnyBanksGodScript (one-tap spacing/format button)", () => {
  it("breaks a single run-together wall of text into one line per tag/speaker", () => {
    const wall =
      "[Location: office_storefront]Dazza: hey Shaz, where do you want me to setup the scam repellent for these suckers?Shazza: not so loud Dazza, we don't want the suckers to find out";
    const formatted = formatSunnyBanksGodScript(wall);
    expect(formatted).toBe(
      "[Location: office_storefront]\n" +
        "Dazza: hey Shaz, where do you want me to setup the scam repellent for these suckers?\n" +
        "\n" +
        "Shazza: not so loud Dazza, we don't want the suckers to find out"
    );
    const chunks = parseSunnyBanksScriptBlock(formatted);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ characterName: "Dazza", locationId: "office_storefront" });
    expect(chunks[1].characterName).toBe("Shazza");
  });

  it("splits an inline [Character ...] tag from the dialogue line that follows it, without corrupting the tag", () => {
    const raw = "[Character Dazza: holding a rusty tin spray can] Dazza: hey Shaz, where do you want this?";
    const formatted = formatSunnyBanksGodScript(raw);
    expect(formatted).toBe(
      "[Character Dazza: holding a rusty tin spray can]\nDazza: hey Shaz, where do you want this?"
    );
    // (one speech line only, so no trailing blank line)
  });

  it("never breaks a name+colon that sits inside a tag's own brackets", () => {
    const formatted = formatSunnyBanksGodScript("[Character Dazza: wrapped in bandages] Dazza:");
    expect(formatted).toContain("[Character Dazza: wrapped in bandages]");
    expect(formatted).not.toContain("Dazza\n:");
  });

  it("collapses runs of blank lines to one after each speech line and trims trailing whitespace", () => {
    const raw = "Shazza: You right?   \n\n\n\nDazza: Yeah nah.\n\n";
    expect(formatSunnyBanksGodScript(raw)).toBe("Shazza: You right?\n\nDazza: Yeah nah.");
  });

  it("puts a blank line after every speech line, never between a tag and its line", () => {
    const raw =
      "Shazza: One\nDazza: Two\n[Character Dazza: holding a can]\n[Action: shakes it]\nDazza: Three\nShazza:\n=== ACT III — SCENE A4 ===\n[Location: office_storefront]\nShazza: Four";
    expect(formatSunnyBanksGodScript(raw)).toBe(
      "Shazza: One\n\n" +
        "Dazza: Two\n\n" +
        "[Character Dazza: holding a can]\n[Action: shakes it]\nDazza: Three\n\n" +
        "Shazza:\n\n" +
        "=== ACT III — SCENE A4 ===\n[Location: office_storefront]\nShazza: Four"
    );
  });

  it("keeps every row, row number and clip key: blank lines are separators, not lines", () => {
    const raw =
      "Ranger Bazza: Well here we go\nShazza: Ranger Bazza, ya flaming Gumboot?\n[Character Dazza: holding a can]\nDazza: hey Shaz\nShazza:\nCrowd:";
    const before = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(raw));
    const after = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(formatSunnyBanksGodScript(raw)));
    expect(after).toHaveLength(before.length);
    after.forEach((chunk, index) => {
      expect(chunk.raw).toBe(before[index].raw);
      expect(chunk.characterName).toBe(before[index].characterName);
      expect(chunk.kind).toBe(before[index].kind);
      expect(chunk.appearanceModifier).toBe(before[index].appearanceModifier);
    });
  });

  it("is idempotent — formatting already-clean text is a no-op", () => {
    const clean = "[Location: site_laundry]\nShazza: You right?\n\nDazza: Yeah nah.";
    expect(formatSunnyBanksGodScript(clean)).toBe(clean);
    expect(formatSunnyBanksGodScript(formatSunnyBanksGodScript(clean))).toBe(formatSunnyBanksGodScript(clean));
  });

  it("leaves a `Name says:` beat correctly split from a preceding tag", () => {
    const raw = "[Action: leans in][Location: site_laundry]Shazza says: careful with that";
    const formatted = formatSunnyBanksGodScript(raw);
    expect(formatted).toBe("[Action: leans in]\n[Location: site_laundry]\nShazza says: careful with that");
  });
});

describe("buildSunnyBanksOverlaySegments (what the script box colours)", () => {
  it("colours each line's speaker name, so a tag-free script is not all white", () => {
    const raw = "Ranger Bazza: Well here we go\n\nShazza: Ranger Bazza, ya flaming Gumboot?\nDazza says: yeah";
    const segments = buildSunnyBanksOverlaySegments(raw);
    expect(segments.filter((seg) => seg.kind === "speaker").map((seg) => seg.text)).toEqual([
      "Ranger Bazza:",
      "Shazza:",
      "Dazza says:",
    ]);
    // A name inside the dialogue is not a speaker.
    expect(segments.some((seg) => seg.kind === "speaker" && seg.text.startsWith("Ranger Bazza,"))).toBe(false);
  });

  it("colours tags and the speaker after a tag on the same line, and rebuilds the text exactly", () => {
    const raw = "[Location: office_storefront]\n[Character Dazza: holding a can] Dazza: hey Shaz\nCrowd:\n  Nuggets: nah";
    const segments = buildSunnyBanksOverlaySegments(raw);
    expect(segments.map((seg) => seg.text).join("")).toBe(raw);
    expect(segments.map((seg) => seg.kind)).toEqual(
      expect.arrayContaining(["location", "character", "speaker"])
    );
    expect(segments.filter((seg) => seg.kind === "speaker").map((seg) => seg.text)).toEqual(["Dazza:", "Nuggets:"]);
  });

  it("has a real colour for the speaker kind", () => {
    expect(SUNNY_BANKS_HIGHLIGHT_CLASSES.speaker).toBe("text-cyan-300");
  });
});

describe("SUNNY_BANKS_HIGHLIGHT_CLASSES", () => {
  it("live QA (2026-09-18): plain script text is opaque, not invisible on the black card", () => {
    // The real <textarea> is `text-transparent` so the colored tags can
    // show through it, which makes this overlay the only thing drawing
    // the script at all. It shipped with a `text-white/0` base and every
    // non-tag line rendered as black-on-black.
    expect(SUNNY_BANKS_HIGHLIGHT_CLASSES.plain).toBe("text-white");
  });

  it("every segment kind — plain and tag alike — has a real, non-transparent color", () => {
    const kinds = ["plain", "location", "character", "action"] as const;
    for (const kind of kinds) {
      const className = SUNNY_BANKS_HIGHLIGHT_CLASSES[kind];
      expect(className).toMatch(/^text-/);
      // `text-white/0`, `text-cyan-300/0` etc. are the exact shape of
      // the bug: a color that renders nothing.
      expect(className).not.toMatch(/\/0$/);
    }
  });

  it("every segment a real God Script produces can be colored — no segment kind falls through uncolored", () => {
    const segments = buildSunnyBanksHighlightSegments(
      "[Location: tin_shed_mower]\nDazza: Yeah nah.\n[Character Dazza: holding a rusty tin]\n[Action: steps out]\n"
    );
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.some((segment) => segment.kind === "plain")).toBe(true);
    for (const segment of segments) {
      expect(SUNNY_BANKS_HIGHLIGHT_CLASSES[segment.kind]).toBeTruthy();
    }
  });
});

describe("resetSunnyBanksClipRuntime (Remove on a clip)", () => {
  const script = [
    "Hans:",
    "Hans: Guten tag, true blue Australian locals!",
    "Shazza: It bloody well is if you've got a credit card, mate.",
  ].join("\n");
  const done = (lineKey: string, n: number) => ({
    lineKey,
    status: "done" as const,
    videoUrl: `https://blob.example/beat-${n}.mp4`,
  });

  it("puts only that row back to Idle, keeping the other clips", () => {
    const before = {
      0: done("Hans:", 13),
      1: done("Hans: Guten tag, true blue Australian locals!", 14),
      2: done("Shazza: It bloody well is if you've got a credit card, mate.", 15),
    };
    const after = resetSunnyBanksClipRuntime(script, before, 1);
    expect(after[1]).toEqual({
      lineKey: "Hans: Guten tag, true blue Australian locals!",
      status: "idle",
      characterName: "Hans",
      line: "Guten tag, true blue Australian locals!",
    });
    expect(after[0].videoUrl).toBe("https://blob.example/beat-13.mp4");
    expect(after[2].videoUrl).toBe("https://blob.example/beat-15.mp4");

    const shown = preserveRenderedRuntimes(parseSunnyBanksScriptBlock(script), after);
    expect(shown[1].status).toBe("idle");
    const clips = collectRenderedClips({
      actIds: ["I"],
      actScripts: { I: script },
      characterOverrides: { I: {} },
      runtimeMap: { I: after },
    });
    expect(clips.map((c) => c.index)).toEqual([0, 2]);
  });

  it("finds a clip stored under an older row number after a shot was inserted", () => {
    // Hans's speak line was rendered as row 1; then a "+" hold went in above it.
    const inserted = ["Hans:", "Hans:", ...script.split("\n").slice(1)].join("\n");
    const before = {
      0: done("Hans:", 13),
      1: done("Hans: Guten tag, true blue Australian locals!", 14),
      2: done("Shazza: It bloody well is if you've got a credit card, mate.", 15),
    };
    const shownBefore = preserveRenderedRuntimes(parseSunnyBanksScriptBlock(inserted), before);
    expect(shownBefore[2].videoUrl).toBe("https://blob.example/beat-14.mp4");

    const after = resetSunnyBanksClipRuntime(inserted, before, 2);
    const shown = preserveRenderedRuntimes(parseSunnyBanksScriptBlock(inserted), after);
    expect(shown[2].status).toBe("idle");
    expect(shown[1]).toBeUndefined();
    expect(shown[0].videoUrl).toBe("https://blob.example/beat-13.mp4");
    expect(shown[3].videoUrl).toBe("https://blob.example/beat-15.mp4");
    expect(Object.values(after).some((r) => r.videoUrl === "https://blob.example/beat-14.mp4")).toBe(false);
  });

  it("leaves the runtimes alone for a row that isn't there", () => {
    const before = { 0: done("Hans:", 13) };
    expect(resetSunnyBanksClipRuntime(script, before, 9)).toBe(before);
  });
});

describe("CLIPS strip: one row per act", () => {
  const clip = (act: string, index: number) => ({
    act,
    index,
    characterName: "Shazza",
    lineLabel: "You right?",
    videoUrl: `https://blob.example/${act}-${index}.mp4`,
  });

  it("stacks every act in act order, each with its own clips and count", () => {
    const rows = groupSunnyBanksClipsByAct(["I", "II", "III", "IV"], [clip("II", 0), clip("I", 1), clip("I", 0)]);
    expect(rows.map((r) => r.act)).toEqual(["I", "II", "III", "IV"]);
    expect(rows.map((r) => r.clips.length)).toEqual([2, 1, 0, 0]);
    expect(rows[0].clips.map((c) => c.index)).toEqual([1, 0]);
  });

  it("opens the act being edited, and any act with clips, unless its label was tapped", () => {
    expect(isSunnyBanksClipRowOpen({ act: "I", clipCount: 0, activeAct: "I" })).toBe(true);
    expect(isSunnyBanksClipRowOpen({ act: "II", clipCount: 3, activeAct: "I" })).toBe(true);
    expect(isSunnyBanksClipRowOpen({ act: "III", clipCount: 0, activeAct: "I" })).toBe(false);
    expect(isSunnyBanksClipRowOpen({ act: "I", clipCount: 19, activeAct: "I", toggled: false })).toBe(false);
    expect(isSunnyBanksClipRowOpen({ act: "III", clipCount: 0, activeAct: "I", toggled: true })).toBe(true);
  });
});

describe("inserting or removing a row keeps every other Done clip (2026-09-30)", () => {
  // The end of EP01 Act I as it was when Stuart hit "+" between rows 15 and 16.
  const before = [
    "Hans: Guten tag, true blue Australian locals!",
    "Shazza:",
    "Shazza: It bloody well is if you've got a credit card, mate.",
    "Dazza:",
    "Dazza: These are pants, Shaz.",
    "Shazza:",
  ].join("\n");
  const doneAll = (script: string) => {
    const out: Record<number, { lineKey: string; status: "done"; videoUrl: string; characterName: string; line: string }> = {};
    sunnyBanksQueueChunks(parseSunnyBanksScriptBlock(script)).forEach((chunk, i) => {
      out[i] = {
        lineKey: chunk.raw,
        status: "done",
        videoUrl: `https://blob.example/beat-${i + 1}.mp4`,
        characterName: chunk.characterName,
        line: chunk.line,
      };
    });
    return out;
  };
  const shownUrls = (script: string, runtimes: Parameters<typeof preserveRenderedRuntimes>[1]) => {
    const parsed = parseSunnyBanksScriptBlock(script);
    const shown = preserveRenderedRuntimes(parsed, runtimes);
    return sunnyBanksQueueChunks(parsed).map((_, i) => (shown[i]?.status === "done" ? shown[i].videoUrl : shown[i]?.status ?? "idle"));
  };

  it("+ after a hold: the new row is Idle and every row below keeps its own clip", () => {
    const runtimes = doneAll(before);
    // "+" on row 2 (the Shazza hold) inserts another "Shazza:" under it.
    const after = insertSunnyBanksLineAfter(before, 1, buildSunnyBanksHoldScriptLine("Shazza"));
    const shifted = shiftSunnyBanksRuntimesForInsert(before, after, runtimes, 2);
    expect(shownUrls(after, shifted)).toEqual([
      "https://blob.example/beat-1.mp4",
      "https://blob.example/beat-2.mp4",
      "idle",
      "https://blob.example/beat-3.mp4",
      "https://blob.example/beat-4.mp4",
      "https://blob.example/beat-5.mp4",
      "https://blob.example/beat-6.mp4",
    ]);
  });

  it("the old one-pass match let an inserted hold take a later look-alike row's clip", () => {
    // Unshifted store (the pre-fix "+"): the display must still not move the last Shazza hold's clip.
    const after = insertSunnyBanksLineAfter(before, 1, buildSunnyBanksHoldScriptLine("Shazza"));
    const urls = shownUrls(after, doneAll(before));
    expect(urls[6]).toBe("https://blob.example/beat-6.mp4");
    expect(urls[3]).toBe("https://blob.example/beat-3.mp4");
  });

  it("rendering the inserted row never wipes the Done row below it", () => {
    const after = insertSunnyBanksLineAfter(before, 1, buildSunnyBanksHoldScriptLine("Shazza"));
    let runtimes = shiftSunnyBanksRuntimesForInsert(before, after, doneAll(before), 2);
    runtimes = writeSunnyBanksRowRuntime(after, runtimes, 2, { lineKey: "Shazza:", status: "rendering" });
    runtimes = writeSunnyBanksRowRuntime(after, runtimes, 2, {
      lineKey: "Shazza:",
      status: "done",
      videoUrl: "https://blob.example/new.mp4",
    });
    expect(shownUrls(after, runtimes)).toEqual([
      "https://blob.example/beat-1.mp4",
      "https://blob.example/beat-2.mp4",
      "https://blob.example/new.mp4",
      "https://blob.example/beat-3.mp4",
      "https://blob.example/beat-4.mp4",
      "https://blob.example/beat-5.mp4",
      "https://blob.example/beat-6.mp4",
    ]);
  });

  it("a render written into a store that was never shifted (hand-edited script) still lands on the right row", () => {
    // A new spoken line typed into the script by hand above "It bloody well…".
    const edited = before.replace("Shazza:\nShazza: It bloody", "Shazza:\nShazza: the first fleet, of bloody tourists\nShazza: It bloody");
    let runtimes = doneAll(before) as Record<number, import("@/lib/sunnyBanksWorkspace").SunnyBanksRowRuntime>;
    runtimes = writeSunnyBanksRowRuntime(edited, runtimes, 2, {
      lineKey: "Shazza: the first fleet, of bloody tourists",
      status: "done",
      videoUrl: "https://blob.example/new.mp4",
    });
    const urls = shownUrls(edited, runtimes);
    expect(urls[2]).toBe("https://blob.example/new.mp4");
    expect(urls.slice(3)).toEqual([
      "https://blob.example/beat-3.mp4",
      "https://blob.example/beat-4.mp4",
      "https://blob.example/beat-5.mp4",
      "https://blob.example/beat-6.mp4",
    ]);
  });

  it("+ before the first row moves every Done row down one", () => {
    const runtimes = doneAll(before);
    const after = insertSunnyBanksLineBefore(before, 0, buildSunnyBanksHoldScriptLine("Hans"));
    const shifted = shiftSunnyBanksRuntimesForInsert(before, after, runtimes, 0);
    const urls = shownUrls(after, shifted);
    expect(urls[0]).toBe("idle");
    expect(urls.slice(1)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `https://blob.example/beat-${n}.mp4`));
  });

  it("− on an Idle row mid-act moves every Done row below up with its clip", () => {
    const after = insertSunnyBanksLineAfter(before, 1, buildSunnyBanksHoldScriptLine("Shazza"));
    const withIdle = shiftSunnyBanksRuntimesForInsert(before, after, doneAll(before), 2);
    const parsed = parseSunnyBanksScriptBlock(after);
    const removedLine = sunnyBanksQueueChunks(parsed)[2].sourceLineIndex;
    const back = removeSunnyBanksSourceLine(after, removedLine);
    const removed = shiftSunnyBanksRuntimesForRemove(after, withIdle, 2);
    expect(shownUrls(back, removed)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `https://blob.example/beat-${n}.mp4`));
    expect(Object.keys(removed).map(Number).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("− on a Done row mid-act drops only that clip; every Done row below moves up with its own", () => {
    const parsed = parseSunnyBanksScriptBlock(before);
    const removedLine = sunnyBanksQueueChunks(parsed)[2].sourceLineIndex;
    const back = removeSunnyBanksSourceLine(before, removedLine);
    const removed = shiftSunnyBanksRuntimesForRemove(before, doneAll(before), 2);
    expect(shownUrls(back, removed)).toEqual([1, 2, 4, 5, 6].map((n) => `https://blob.example/beat-${n}.mp4`));
  });

  it("a line deleted by hand above (store never shifted) leaves every Done row below with its own clip", () => {
    const edited = before.replace("Shazza: It bloody well is if you've got a credit card, mate.\n", "");
    expect(shownUrls(edited, doneAll(before))).toEqual([1, 2, 4, 5, 6].map((n) => `https://blob.example/beat-${n}.mp4`));
  });
});

describe("[GROK] / [LTX] / [H3] engine tags (2026-09-30)", () => {
  it("a tag after the name picks the engine for that row and is not in the line", () => {
    const rows = sunnyBanksQueueChunks(
      parseSunnyBanksScriptBlock("Ranger Bazza: [H3]\nCrowd: [ltx]\nShazza: [GROK] You right?")
    );
    expect(rows.map((row) => [row.kind, row.characterName, row.line, row.videoBackend])).toEqual([
      ["hold", "Ranger Bazza", "", "h3"],
      ["hold", "Crowd", "", "ltx"],
      ["speak", "Shazza", "You right?", "grok"],
    ]);
    // Never in `raw` (the row's clip key) or the spoken line.
    expect(rows.every((row) => !/\[(GROK|LTX|H3)\]/i.test(row.raw + row.line))).toBe(true);
  });

  it("a tag alone on a line is used up by the next row only", () => {
    const rows = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("[GROK]\n[Action: waves]\nShazza:\nShazza:"));
    expect(rows[0].videoBackend).toBe("grok");
    expect(rows[0].action).toBe("waves");
    expect(rows[1].videoBackend).toBeUndefined();
  });

  it("adding a tag to a finished row keeps its clip (same row key)", () => {
    const before = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("Ranger Bazza:"))[0];
    const after = sunnyBanksQueueChunks(parseSunnyBanksScriptBlock("Ranger Bazza: [H3]"))[0];
    expect(after.raw).toBe(before.raw);
  });

  it("colours red, and Format leaves it where it was typed", () => {
    const segments = buildSunnyBanksHighlightSegments("Ranger Bazza: [GROK]\n[h3]");
    expect(segments.filter((s) => s.kind === "backend").map((s) => s.text)).toEqual(["[GROK]", "[h3]"]);
    expect(SUNNY_BANKS_HIGHLIGHT_CLASSES.backend).toBe("text-red-400");
    // Same blank line after each speech line as always; the tag stays put.
    expect(formatSunnyBanksGodScript("Ranger Bazza: [GROK]\nShazza: [H3] Hi")).toBe(
      "Ranger Bazza: [GROK]\n\nShazza: [H3] Hi"
    );
  });

  it("editing the line on a queued row keeps its engine tag", () => {
    expect(rewriteSunnyBanksSpeakerLine("Ranger Bazza: [H3]", "Ranger Bazza", "")).toBe("[H3] Ranger Bazza:");
    expect(rewriteSunnyBanksSpeakerLine("[LTX] Shazza: hi", "Shazza", "hello")).toBe("[LTX] Shazza: hello");
  });

  it("the used engine survives re-keying a row's runtime", () => {
    const script = "Ranger Bazza:";
    const next = writeSunnyBanksRowRuntime(script, {}, 0, {
      lineKey: "Ranger Bazza:",
      status: "done",
      videoUrl: "https://blob.example/a.mp4",
      videoBackend: "grok",
    });
    const kept = preserveRenderedRuntimes(parseSunnyBanksScriptBlock("Ranger Bazza: [H3]"), next);
    expect(kept[0].videoBackend).toBe("grok");
    expect(kept[0].status).toBe("done");
  });
});
