import fixture from "./sunnyBanksDropBears.fixture.json";
import { getSunnyBanksLocation, SUNNY_BANKS_CAST, type SunnyBanksLocationId } from "./sunnyBanks";

/**
 * Crash Lab EP02 (Drop Bears Dilemma) as in-memory Sunny Banks seed —
 * 2026-09-17. The finished MP4s and voice MP3s already exist on
 * skidmarks.aiglitch.app; this module does **not** re-render them, does
 * **not** add a Neon episode table, and does **not** recreate Crash Lab
 * chrome. Deck's own panel still owns Act I/II/III script buffers + one
 * horizontal Clips strip. Playback URLs point at that host's clip route
 * while Sign in stays off (`STUDIO_USERS` empty).
 *
 * Speaker remap: Crash Lab's "The Unit 4s" → this app's CAST key
 * `Unit 4S`. Look/voice gold in `lib/sunnyBanks.ts` is untouched.
 *
 * **Locations are `[Location: …]` lines in the script (2026-10-01).**
 * The seed used to save a location on every row instead, and those
 * saved rows outlived the demo: EP02's own Act II, rewritten as
 * `[Location: park_site_4]`, still rendered at the tin shed. The seed
 * now writes a tag line wherever the place changes and saves no row
 * locations at all.
 */

export const DROP_BEARS_JOB_ID = fixture.jobId;
export const DROP_BEARS_TITLE = fixture.title;

type ActId = "I" | "II" | "III";

const ACTS: ActId[] = ["I", "II", "III"];

export function crashLabClipUrl(clipFile: string): string {
  const url = new URL("/api/crash/mobile/clip", fixture.sourceHost);
  url.searchParams.set("styleId", fixture.styleId);
  url.searchParams.set("folderName", fixture.folderName);
  url.searchParams.set("fileName", clipFile);
  return url.toString();
}

export type DropBearsSeedRuntime = {
  lineKey: string;
  status: "done";
  videoUrl: string;
};

export type DropBearsPanelSeed = {
  defaultLocationId: SunnyBanksLocationId;
  actScripts: Record<ActId, string>;
  runtimeMap: Record<ActId, Record<number, DropBearsSeedRuntime>>;
};

function isActId(value: string): value is ActId {
  return value === "I" || value === "II" || value === "III";
}

function isLocationId(value: string): value is SunnyBanksLocationId {
  return getSunnyBanksLocation(value) !== undefined;
}

/** Script line + clip URL per act, ready for `SkidmarksSunnyBanksPanel`
 * initial state. Every speaker is a `SUNNY_BANKS_CAST` key. */
export function buildSunnyBanksDropBearsSeed(): DropBearsPanelSeed {
  const actScripts: Record<ActId, string> = { I: "", II: "", III: "" };
  const runtimeMap: Record<ActId, Record<number, DropBearsSeedRuntime>> = {
    I: {},
    II: {},
    III: {},
  };
  const grouped: Record<ActId, typeof fixture.beats> = { I: [], II: [], III: [] };

  for (const beat of fixture.beats) {
    if (!isActId(beat.act)) continue;
    if (!(beat.speaker in SUNNY_BANKS_CAST)) continue;
    grouped[beat.act].push(beat);
  }

  for (const act of ACTS) {
    const beats = grouped[act];
    const lines = beats.map((beat) => `${beat.speaker}: ${beat.line}`);
    const script: string[] = [];
    let place: SunnyBanksLocationId | null = null;
    beats.forEach((beat, index) => {
      const locationId = isLocationId(beat.locationId) ? beat.locationId : "main_entrance_sign";
      if (locationId !== place) {
        script.push(`[Location: ${locationId}]`);
        place = locationId;
      }
      script.push(lines[index]);
      runtimeMap[act][index] = {
        lineKey: lines[index],
        status: "done",
        videoUrl: crashLabClipUrl(beat.clipFile),
      };
    });
    actScripts[act] = script.join("\n");
  }

  return {
    defaultLocationId: "main_entrance_sign",
    actScripts,
    runtimeMap,
  };
}
