/**
 * One zip of an act's Done clips (2026-09-30, Stuart's ask): the small
 * zip icon beside each act's fold chevron in CLIPS. The server builds it
 * (`POST /api/skidmarks/sunnybank/clips-zip`) from the clips' saved URLs
 * and streams it straight to the download, so the phone never loads the
 * videos into memory. Works the same on iPhone Safari and desktop: the
 * page submits a plain form and the answer is an attachment.
 *
 * Names are readable and in line order: `ep01-act-ii-01-shazza.mp4`
 * (episode, act, line number, who). Pure: the route and the page share it.
 */
import { deckMediaSlug } from "./deckMediaPaths";
import { isAllowedSunnyBanksClipUrl } from "./sunnyBanksClipProxy";

export const SUNNY_BANKS_CLIPS_ZIP_PATH = "/api/skidmarks/sunnybank/clips-zip";
export const SUNNY_BANKS_CLIPS_ZIP_MAX = 200;

export interface SunnyBanksClipsZipRequest {
  /** The episode's media slug (`ep01-the-first-fleet`) or its name. */
  episode: string;
  act: string;
  clips: { url: string; line: number; character: string }[];
}

export type SunnyBanksClipsZipPlan =
  | { ok: true; zipName: string; entries: { name: string; url: string }[] }
  | { ok: false; error: string };

/** `ep01-the-first-fleet` → `ep01`; anything else stays its own slug. */
export function sunnyBanksZipEpisodePart(episode: string): string {
  const slug = deckMediaSlug(episode, "episode");
  return slug.match(/^ep-?\d+/)?.[0].replace("-", "") ?? slug;
}

function actPart(act: string): string | null {
  const a = act.trim();
  return /^([IVXLCDM]{1,8}|\d{1,2})$/i.test(a) ? a.toLowerCase() : null;
}

export function planSunnyBanksClipsZip(input: unknown): SunnyBanksClipsZipPlan {
  if (!input || typeof input !== "object") return { ok: false, error: "Nothing to zip." };
  const v = input as Partial<SunnyBanksClipsZipRequest>;
  const act = typeof v.act === "string" ? actPart(v.act) : null;
  if (!act) return { ok: false, error: "That isn't an act." };
  const ep = sunnyBanksZipEpisodePart(typeof v.episode === "string" ? v.episode : "");
  if (!Array.isArray(v.clips) || v.clips.length === 0) return { ok: false, error: "This act has no Done clips yet." };
  if (v.clips.length > SUNNY_BANKS_CLIPS_ZIP_MAX) return { ok: false, error: `Keep it to ${SUNNY_BANKS_CLIPS_ZIP_MAX} clips.` };
  const clips: { url: string; line: number; character: string }[] = [];
  for (const c of v.clips) {
    const url = typeof c?.url === "string" ? c.url.trim() : "";
    const line = typeof c?.line === "number" && Number.isInteger(c.line) && c.line >= 1 && c.line <= 9999 ? c.line : 0;
    if (!line || !isAllowedSunnyBanksClipUrl(url)) return { ok: false, error: "A clip's link isn't one of Deck's saved clips." };
    clips.push({ url, line, character: typeof c.character === "string" ? c.character : "" });
  }
  clips.sort((a, b) => a.line - b.line);
  const width = Math.max(2, String(clips[clips.length - 1].line).length);
  const used = new Set<string>();
  const entries = clips.map((c) => {
    const base = `${ep}-act-${act}-${String(c.line).padStart(width, "0")}-${deckMediaSlug(c.character, "clip")}`;
    let name = `${base}.mp4`;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.mp4`;
    used.add(name);
    return { name, url: c.url };
  });
  return { ok: true, zipName: `${ep}-act-${act}.zip`, entries };
}

/**
 * Browser only: asks the server for the zip with a plain form POST, so
 * the browser (iPhone Safari included) downloads the answer itself.
 * Checked here first, so a bad request never navigates the page away.
 */
export function downloadSunnyBanksActZip(request: SunnyBanksClipsZipRequest): { ok: true } | { ok: false; error: string } {
  const plan = planSunnyBanksClipsZip(request);
  if (!plan.ok) return plan;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = SUNNY_BANKS_CLIPS_ZIP_PATH;
  form.style.display = "none";
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "request";
  field.value = JSON.stringify(request);
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
  return { ok: true };
}
