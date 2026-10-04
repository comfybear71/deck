import { afterEach, describe, expect, it, vi } from "vitest";
import { pilotOpenSkidmarksStudio } from "@/lib/skidmarksEpisodeCast.fixtures";
import {
  characterDeleteBlocker,
  characterRenameProblem,
  characterSource,
  countSpeakerLines,
} from "./characterEdits";
import { buildCharacterRoster, type RosterCharacter } from "./characterRoster";
import type { SkidmarksState } from "./skidmarks";

/**
 * Rename and delete on an open character (2026-09-30, the Sunnybank
 * face typed as "ArSGL" that should be "Hans"). The pure rules first,
 * then the real store with a fake server: a rename is a `deck_items`
 * row update that survives a reload, a delete is a tombstone, and
 * nothing ever calls Blob.
 */

const ARSGL = {
  id: "chr_arsgl",
  name: "ArSGL",
  look: "",
  pictureUrls: ["https://blob.example/deck/sunnybank/characters/arsgl/pictures/arsgl-picture-01.jpg"],
  fictionalAdultConfirmed: true as const,
  createdAt: 1,
};
const DAP = { id: "cast_dap", name: "Dap", role: "antihero" as const, look: "sunburnt", fictionalAdultConfirmed: true as const, createdAt: 1, pictureUrls: ["https://blob.example/dap.jpg"] };

function stateWith(extra: Partial<SkidmarksState>): SkidmarksState {
  const band = { id: "band_b", name: "BIGSEXY", tagline: "", coverSeed: 1, editIcon: "pencil", members: [{ id: "member_1", name: "BIG SEXY", emoji: "x", looks: [] }] };
  return {
    bands: [band],
    session: { projectKind: null, bandId: null, mp3: null, scriptSequenceDraft: null },
    removedSeedBandIds: [],
    sunnyBanks: null,
    skidmarksEpisodes: null,
    // The Skidmarks pilot is open (2026-10-04: each episode has its own Cast).
    skidmarksStudio: pilotOpenSkidmarksStudio(),
    adultShorts: null,
    characterLoras: null,
    rosterExtras: null,
    ...extra,
  } as unknown as SkidmarksState;
}

function tile(state: SkidmarksState, group: RosterCharacter["group"], name: string): RosterCharacter {
  const c = buildCharacterRoster(state)[group].find((x) => x.name === name);
  if (!c) throw new Error(`no tile ${name}`);
  return c;
}

describe("character rename/delete rules", () => {
  it("knows where each genre keeps the name, and leaves the built-in Sunny Banks regulars alone", () => {
    const state = stateWith({
      rosterExtras: { "music-video": [], "sunny-banks": [ARSGL], "adult-shorts": [] },
      skidmarksEpisodes: { episodes: [], cast: [DAP] },
    });
    expect(characterSource(tile(state, "sunny-banks", "ArSGL"), state)).toEqual({ kind: "extra", group: "sunny-banks", id: "chr_arsgl" });
    expect(characterSource(tile(state, "skidmarks", "Dap"), state)).toEqual({ kind: "cast", id: "cast_dap" });
    expect(characterSource(tile(state, "sunny-banks", "Shazza"), state).kind).toBe("fixed");
    const member = buildCharacterRoster(state)["music-video"][0];
    expect(characterSource(member, state)).toMatchObject({ kind: "member", memberId: member.sourceKey.slice(3) });
  });

  it("refuses a blank name, a name already in the group, and a child", () => {
    const state = stateWith({ rosterExtras: { "music-video": [], "sunny-banks": [ARSGL], "adult-shorts": [] } });
    const c = tile(state, "sunny-banks", "ArSGL");
    expect(characterRenameProblem(c, "  ", state)).toMatch(/blank/);
    expect(characterRenameProblem(c, "shazza", state)).toMatch(/already a character called Shazza/);
    expect(characterRenameProblem(c, "Hans the kid", state)).toMatch(/under 18/);
    // Hans is Deck's guest (hidden from the bar), so the name is free.
    expect(characterRenameProblem(c, "Hans", state)).toBeNull();
  });

  it("blocks a delete while an episode or script still uses them, and says why", () => {
    const used = stateWith({ skidmarksEpisodes: { episodes: [{ id: "ep1", title: "Pilot", antiheroId: "cast_dap", castIds: [], beats: {} as never, createdAt: 1, updatedAt: 1 }], cast: [DAP] } });
    expect(characterDeleteBlocker(tile(used, "skidmarks", "Dap"), used)).toMatch(/in 1 Skidmarks episode \("Pilot"\)/);
    const free = stateWith({ skidmarksEpisodes: { episodes: [], cast: [DAP] } });
    expect(characterDeleteBlocker(tile(free, "skidmarks", "Dap"), free)).toBeNull();

    const base = stateWith({ rosterExtras: { "music-video": [], "sunny-banks": [ARSGL], "adult-shorts": [] } });
    const live = { ...(base.sunnyBanks?.live ?? {}), workspaceTitle: "EP01", actIds: ["I"], activeAct: "I", actScripts: { I: "ArSGL: Guten tag\nShazza: Yeah nah" }, characterOverrides: {}, locationOverrides: {}, runtimeMap: {}, defaultLocationId: "office_storefront" };
    const scripted = { ...base, sunnyBanks: { live, workspaces: [], saveSeq: 0 } } as unknown as SkidmarksState;
    expect(characterDeleteBlocker(tile(scripted, "sunny-banks", "ArSGL"), scripted)).toMatch(/1 script line in "EP01"/);
    expect(characterDeleteBlocker(tile(scripted, "sunny-banks", "Shazza"), scripted)).toMatch(/built-in/);
    expect(countSpeakerLines("Hans: hi\n hans : yo\nNan: Hans:", "Hans")).toBe(2);
  });
});

/* ------------------------------------------------------------------ */
/* Through the real store, with a fake server                          */
/* ------------------------------------------------------------------ */

type Row = { itemId: string; folder: string; data: unknown; revision: number; updatedAt: string; deletedAt: string | null };
type Call = { method: string; url: string; body?: Record<string, unknown> };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A fresh page load against a fake Neon: one session row and the `deck_items` rows. */
async function boot(server: { session: unknown; rows: Row[] }) {
  vi.resetModules();
  const calls: Call[] = [];
  const local = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: { getItem: (k: string) => local.get(k) ?? null, setItem: (k: string, v: string) => local.set(k, v), removeItem: (k: string) => local.delete(k) },
    addEventListener: () => {},
    setInterval: () => 0,
    setTimeout,
    clearTimeout,
  });
  vi.stubGlobal("document", { addEventListener: () => {}, visibilityState: "visible" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
      calls.push({ method, url, body });
      const j = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
      if (url.startsWith("/api/skidmarks/session")) {
        if (method === "GET") return j({ configured: true, state: server.session, revision: 10, updatedAt: new Date().toISOString() });
        server.session = body?.state;
        return j({ ok: true, configured: true, revision: 11 });
      }
      if (url.startsWith("/api/deck/items")) {
        const q = new URL(url, "http://x").searchParams;
        if (method === "GET") {
          const kind = q.get("kind");
          const live = kind === "character" ? server.rows.filter((r) => !r.deletedAt) : [];
          const deleted = kind === "character" ? server.rows.filter((r) => r.deletedAt).map((r) => ({ itemId: r.itemId, revision: r.revision })) : [];
          return j({ ok: true, configured: true, ready: true, seeded: kind === "character", items: live, deleted });
        }
        if (method === "PUT") {
          const at = server.rows.findIndex((r) => r.itemId === body!.itemId);
          const current = at >= 0 ? server.rows[at] : null;
          if ((current?.revision ?? 0) !== body!.expectedRevision) return j({ conflict: true, item: current }, 409);
          const row: Row = { itemId: String(body!.itemId), folder: "sunnybank", data: body!.data, revision: (current?.revision ?? 0) + 1, updatedAt: "t", deletedAt: null };
          if (at >= 0) server.rows[at] = row;
          else server.rows.push(row);
          return j({ ok: true, item: row });
        }
        if (method === "DELETE") {
          const at = server.rows.findIndex((r) => r.itemId === q.get("itemId"));
          const current = server.rows[at];
          if (!current || String(current.revision) !== q.get("expectedRevision")) return j({ conflict: true, item: current ?? null }, 409);
          server.rows[at] = { ...current, revision: current.revision + 1, deletedAt: "t" };
          return j({ ok: true, item: server.rows[at] });
        }
      }
      return j({ unexpected: url }, 404);
    }),
  );
  const sk = await import("./skidmarks");
  const edits = await import("./characterEdits");
  const roster = await import("./characterRoster");
  sk.subscribeSkidmarks(() => {});
  sk.getSkidmarksSnapshot();
  await wait(200);
  const tileNamed = (group: RosterCharacter["group"], name: string) =>
    roster.buildCharacterRoster(sk.getSkidmarksSnapshot())[group].find((c) => c.name === name) ?? null;
  return { sk, edits, calls, tileNamed };
}

const SHAZZA_CARD: Row = {
  itemId: "clora_shazza",
  folder: "sunnybank",
  data: { id: "clora_shazza", name: "Shazza", slug: "shazza", sourceKey: "sb:shazza", status: "ready", trainingImageUrls: [], version: 1, createdAt: "2026-09-29T00:00:00.000Z" },
  revision: 2,
  updatedAt: "t",
  deletedAt: null,
};

describe("rename and delete, saved per item", () => {
  it("renames ArSGL to Hans on its own deck_items row, keeps its id and picture, and it survives a reload", async () => {
    const server = {
      session: { bands: [], removedSeedBandIds: [], session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null }, rosterExtras: { "music-video": [], "sunny-banks": [ARSGL], "adult-shorts": [] } },
      rows: [SHAZZA_CARD],
    };
    const originalSession = structuredClone(server.session);
    let page = await boot(server);
    const before = page.tileNamed("sunny-banks", "ArSGL")!;
    expect(before.sourceKey).toBe("sbx:chr_arsgl");
    expect(page.calls.filter((c) => c.url.startsWith("/api/deck/items") && c.method !== "GET")).toEqual([]);

    expect(page.edits.renameRosterCharacter(before, "Hans")).toEqual({ ok: true, sourceKey: "sbx:chr_arsgl" });
    await wait(100);
    const puts = page.calls.filter((c) => c.method === "PUT" && c.url.startsWith("/api/deck/items"));
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toMatchObject({ kind: "character", expectedRevision: 0, data: { name: "Hans", slug: "hans", sourceKey: "sbx:chr_arsgl" } });
    const cardId = (puts[0].body!.data as { id: string }).id;
    expect(page.tileNamed("sunny-banks", "ArSGL")).toBeNull();

    // Reload: a fresh page reads the saved session and the rows.
    page = await boot(server);
    const after = page.tileNamed("sunny-banks", "Hans")!;
    expect(after).not.toBeNull();
    expect(after.sourceKey).toBe("sbx:chr_arsgl");
    expect(after.thumbUrl).toBe(ARSGL.pictureUrls[0]);
    const card = page.sk.getCharacterLorasState().characters.find((c) => c.sourceKey === "sbx:chr_arsgl")!;
    expect(card).toMatchObject({ id: cardId, name: "Hans" });

    // An older session copy (still saying ArSGL) loaded on another
    // device: the card's row wins, so it still says Hans.
    const stale = await boot({ session: structuredClone(originalSession), rows: server.rows });
    expect(stale.tileNamed("sunny-banks", "Hans")?.sourceKey).toBe("sbx:chr_arsgl");
    expect(stale.tileNamed("sunny-banks", "ArSGL")).toBeNull();
    expect(stale.calls.filter((c) => c.url.startsWith("/api/deck/items") && c.method !== "GET")).toEqual([]);
    page = await boot(server);

    // A second rename is an update on the same row: the revision goes up.
    expect(page.edits.renameRosterCharacter(page.tileNamed("sunny-banks", "Hans")!, "Hans Gruber").ok).toBe(true);
    await wait(100);
    const second = page.calls.filter((c) => c.method === "PUT" && c.url.startsWith("/api/deck/items"));
    expect(second.map((p) => p.body)).toMatchObject([{ kind: "character", itemId: cardId, expectedRevision: 1, data: { id: cardId, name: "Hans Gruber", slug: "hans" } }]);
    expect(server.rows.find((r) => r.itemId === cardId)?.revision).toBe(2);
    // Never Blob.
    expect(page.calls.every((c) => c.url.startsWith("/api/skidmarks/session") || c.url.startsWith("/api/deck/items"))).toBe(true);
  }, 15000);

  it("deletes a trained character as a tombstone, blocks one an episode uses, and never touches Blob", async () => {
    const dapCard: Row = {
      itemId: "clora_dap",
      folder: "skidmarks",
      data: { id: "clora_dap", name: "Dap", slug: "dap", sourceKey: "sk:cast_dap", status: "ready", trainingImageUrls: ["https://blob.example/dap-plate-01.jpg"], version: 1, createdAt: "2026-09-29T00:00:00.000Z" },
      revision: 12,
      updatedAt: "t",
      deletedAt: null,
    };
    const clive = { ...DAP, id: "cast_clive", name: "Clive", role: "supporting" as const };
    const episode = { id: "ep1", title: "Pilot", antiheroId: null, castIds: ["cast_clive"], beats: {}, createdAt: 1, updatedAt: 1 };
    const server = {
      session: { bands: [], removedSeedBandIds: [], session: { projectKind: "skidmarks", bandId: null, mp3: null, scriptSequenceDraft: null }, skidmarksStudio: pilotOpenSkidmarksStudio(), skidmarksEpisodes: { episodes: [episode], cast: [DAP, clive] } },
      rows: [SHAZZA_CARD, dapCard],
    };
    const page = await boot(server);

    // Clive is in an episode: refused, nothing sent.
    const cliveTile = page.tileNamed("skidmarks", "Clive")!;
    const refused = page.edits.deleteRosterCharacter(cliveTile);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.error).toMatch(/Take them out of those episodes first/);
    expect(page.tileNamed("skidmarks", "Clive")).not.toBeNull();

    // Dap is free: off the list, and his card's row is tombstoned on its known revision.
    expect(page.edits.deleteRosterCharacter(page.tileNamed("skidmarks", "Dap")!).ok).toBe(true);
    await wait(100);
    expect(page.tileNamed("skidmarks", "Dap")).toBeNull();
    const dels = page.calls.filter((c) => c.method === "DELETE");
    expect(dels.map((d) => d.url)).toEqual(["/api/deck/items?kind=character&itemId=clora_dap&expectedRevision=12"]);
    expect(server.rows.find((r) => r.itemId === "clora_dap")?.deletedAt).toBe("t");
    expect(page.sk.getSkidmarksEpisodesState().cast.map((c) => c.id)).toEqual(["cast_clive"]);
    expect(page.calls.every((c) => c.url.startsWith("/api/skidmarks/session") || c.url.startsWith("/api/deck/items"))).toBe(true);

    // Reload: Dap stays gone.
    const again = await boot(server);
    expect(again.tileNamed("skidmarks", "Dap")).toBeNull();
    expect(again.sk.getCharacterLorasState().characters.some((c) => c.id === "clora_dap")).toBe(false);
  }, 15000);

  it("works the same for a Music video band member and a Shorts LoRA card", async () => {
    const band = { id: "band_b", name: "BIGSEXY", tagline: "", coverSeed: 1, editIcon: "pencil", members: [{ id: "member_1", name: "BIG SEXY", emoji: "x", looks: [] }] };
    const card: Row = { ...SHAZZA_CARD, itemId: "clora_mv", folder: "music-video", data: { id: "clora_mv", name: "BIG SEXY", slug: "big_sexy", sourceKey: "mv:member_1", status: "ready", trainingImageUrls: [], version: 1, createdAt: "2026-09-29T00:00:00.000Z" }, revision: 2 };
    const server = { session: { bands: [band], removedSeedBandIds: [], session: { projectKind: "music-video", bandId: "band_b", mp3: null, scriptSequenceDraft: null } }, rows: [card] };
    const page = await boot(server);
    expect(page.edits.renameRosterCharacter(page.tileNamed("music-video", "BIG SEXY")!, "BIG SEXY 2").ok).toBe(true);
    await wait(100);
    expect(page.sk.getSkidmarksSnapshot().bands.find((b) => b.id === "band_b")?.members[0]).toMatchObject({ id: "member_1", name: "BIG SEXY 2" });
    expect(page.calls.filter((c) => c.method === "PUT" && c.url.startsWith("/api/deck/items")).map((c) => c.body)).toMatchObject([
      { kind: "character", itemId: "clora_mv", expectedRevision: 2, data: { id: "clora_mv", name: "BIG SEXY 2", slug: "big_sexy" } },
    ]);
    expect(page.edits.deleteRosterCharacter(page.tileNamed("music-video", "BIG SEXY 2")!).ok).toBe(true);
    await wait(100);
    expect(page.sk.getSkidmarksSnapshot().bands.find((b) => b.id === "band_b")?.members).toEqual([]);
    expect(page.calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/deck/items?kind=character&itemId=clora_mv&expectedRevision=3"]);

    const skye: Row = { ...SHAZZA_CARD, itemId: "clora_skye", folder: "adult-shorts", data: { id: "clora_skye", name: "Skye", slug: "skye", sourceKey: "asx:skye", status: "ready", trainingImageUrls: ["https://blob.example/skye.jpg"], version: 1, createdAt: "2026-09-29T00:00:00.000Z" }, revision: 2 };
    const shorts = await boot({
      session: {
        bands: [],
        removedSeedBandIds: [],
        session: { projectKind: "adult-shorts", bandId: null, mp3: null, scriptSequenceDraft: null },
        // An older episode (saved before 2026-10-04) open: the shared Cast from before.
        adultShorts: {
          ageConfirmed: true,
          character: { name: "Mia", look: "30s, red hair", referenceUrls: [] },
          shots: [],
          saved: [{ id: "short_old_ep01", title: "EP01", savedAt: "2026-09-29T00:00:00Z", character: { name: "", look: "", referenceUrls: [] }, shots: [{ id: "sh0", action: "walks in" }] }],
          currentSavedId: "short_old_ep01",
        },
      },
      rows: [skye],
    });
    const skyeTile = shorts.tileNamed("adult-shorts", "Skye")!;
    expect(shorts.edits.renameRosterCharacter(skyeTile, "Skye Blue")).toEqual({ ok: true, sourceKey: "asx:skye" });
    await wait(100);
    expect(shorts.calls.filter((c) => c.method === "PUT" && c.url.startsWith("/api/deck/items")).map((c) => c.body)).toMatchObject([
      { kind: "character", itemId: "clora_skye", expectedRevision: 2, data: { name: "Skye Blue", slug: "skye", sourceKey: "asx:skye" } },
    ]);
    expect(shorts.tileNamed("adult-shorts", "Skye Blue")?.thumbUrl).toBe("https://blob.example/skye.jpg");
    // The editor's own character: its key follows its name, and it can't
    // be deleted while it's the one open in the editor.
    const mia = shorts.tileNamed("adult-shorts", "Mia")!;
    expect(shorts.edits.deleteRosterCharacter(mia)).toMatchObject({ ok: false, error: expect.stringMatching(/starring in the open Shorts episode/) });
    expect(shorts.edits.renameRosterCharacter(mia, "Mia Rose")).toEqual({ ok: true, sourceKey: "as:mia_rose" });
    expect(shorts.sk.getAdultShortsState().character.name).toBe("Mia Rose");
    expect(shorts.tileNamed("adult-shorts", "Mia Rose")?.sourceKey).toBe("as:mia_rose");
  }, 15000);

  it("refuses to rename or delete a built-in Sunny Banks regular", async () => {
    const page = await boot({ session: { bands: [], removedSeedBandIds: [], session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null } }, rows: [SHAZZA_CARD] });
    const shazza = page.tileNamed("sunny-banks", "Shazza")!;
    expect(page.edits.renameRosterCharacter(shazza, "Shaz").ok).toBe(false);
    expect(page.edits.deleteRosterCharacter(shazza).ok).toBe(false);
    await wait(50);
    expect(page.calls.filter((c) => c.url.startsWith("/api/deck/items") && c.method !== "GET")).toEqual([]);
  }, 15000);
});

describe("voice id, saved per item", () => {
  const VOICE = "21m00Tcm4TlvDq8ikWAM";
  const HANS = { ...ARSGL, name: "Hans" };

  it("saves a voice on the card's own row, gives a card-less face one, survives a reload, and clears", async () => {
    const server = {
      session: { bands: [], removedSeedBandIds: [], session: { projectKind: "sunnybank", bandId: null, mp3: null, scriptSequenceDraft: null }, rosterExtras: { "music-video": [], "sunny-banks": [HANS], "adult-shorts": [] } },
      rows: [structuredClone(SHAZZA_CARD)],
    };
    let page = await boot(server);
    const puts = () => page.calls.filter((c) => c.method === "PUT" && c.url.startsWith("/api/deck/items"));

    // A bad id: plain error, nothing sent.
    const bad = page.edits.setCharacterVoiceId(page.tileNamed("sunny-banks", "Hans")!, "not a voice");
    expect(bad.ok).toBe(false);
    await wait(100);
    expect(puts()).toEqual([]);

    // Shazza (built-in) already has a card: one update on it.
    expect(page.edits.setCharacterVoiceId(page.tileNamed("sunny-banks", "Shazza")!, ` ${VOICE} `).ok).toBe(true);
    // Hans (added face, no card yet): a new card with the voice.
    expect(page.edits.setCharacterVoiceId(page.tileNamed("sunny-banks", "Hans")!, VOICE).ok).toBe(true);
    await wait(100);
    expect(puts().map((p) => p.body)).toMatchObject([
      { kind: "character", itemId: "clora_shazza", expectedRevision: 2, data: { id: "clora_shazza", name: "Shazza", voiceId: VOICE } },
      { kind: "character", expectedRevision: 0, data: { name: "Hans", sourceKey: "sbx:chr_arsgl", voiceId: VOICE } },
    ]);

    // Reload: both voices are back, and Hans now speaks.
    page = await boot(server);
    const cards = page.sk.getCharacterLorasState().characters;
    expect(cards.find((c) => c.sourceKey === "sb:shazza")?.voiceId).toBe(VOICE);
    expect(cards.find((c) => c.sourceKey === "sbx:chr_arsgl")?.voiceId).toBe(VOICE);
    const voices = await import("./sunnyBanksVoices");
    const hans = voices.resolveSunnyBanksSpeaker("Hans", page.sk.getSkidmarksSnapshot());
    expect(hans).toMatchObject({ voiceId: VOICE });
    // His picture here is on a test host, not Deck's Blob, so it's never used (2026-10-01).
    expect(hans?.castPicture).toBeUndefined();
    const shazzaTile = page.tileNamed("sunny-banks", "Shazza")!;
    expect(page.edits.characterVoice(shazzaTile, cards.find((c) => c.sourceKey === "sb:shazza")!)).toEqual({ voiceId: VOICE, saved: true });

    // Clear Shazza's: one PUT without voiceId; she's back to her built-in voice.
    expect(page.edits.setCharacterVoiceId(shazzaTile, null).ok).toBe(true);
    await wait(100);
    const cleared = puts();
    expect(cleared).toHaveLength(1);
    expect(cleared[0].body).toMatchObject({ itemId: "clora_shazza", data: { id: "clora_shazza" } });
    expect(cleared[0].body!.data).not.toHaveProperty("voiceId");
    expect(page.edits.characterVoice(shazzaTile, null)?.saved).toBe(false);
    // Never Blob, never ElevenLabs.
    expect(page.calls.every((c) => c.url.startsWith("/api/skidmarks/session") || c.url.startsWith("/api/deck/items"))).toBe(true);
  }, 15000);

  it("works the same for a Skidmarks cast member", async () => {
    const server = {
      session: { bands: [], removedSeedBandIds: [], session: { projectKind: "skidmarks", bandId: null, mp3: null, scriptSequenceDraft: null }, skidmarksStudio: pilotOpenSkidmarksStudio(), skidmarksEpisodes: { episodes: [], cast: [DAP] } },
      rows: [] as Row[],
    };
    const page = await boot(server);
    const dap = page.tileNamed("skidmarks", "Dap")!;
    expect(page.edits.characterCanHaveVoice(dap, page.sk.getSkidmarksSnapshot())).toBe(true);
    expect(page.edits.setCharacterVoiceId(dap, VOICE).ok).toBe(true);
    await wait(100);
    expect(server.rows.map((r) => r.data)).toMatchObject([{ name: "Dap", sourceKey: "sk:cast_dap", voiceId: VOICE }]);
  }, 15000);
});
