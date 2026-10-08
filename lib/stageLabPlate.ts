/**
 * Stage lab Make plate — one cheap Grok still (~$0.02) from the card's
 * Location picture + ONLY the ticked actors' Cast pictures + compiled prompt.
 * Reuses `generatePlateStill` / `uploadSkidmarksPlateStill`. Never a video call.
 */

import { ESTIMATED_STILL_COST_USD } from "./autoPlate";
import { generatePlateStill, resolvePlateReferenceDataUrl, type PlateGenerationRequest } from "./plateGeneration";
import { uploadSkidmarksPlateStill } from "./plateStillBlob";
import { downscaleDataUrlImage } from "./skidmarks";
import {
  compileStagePrompt,
  missingPlatePictures,
  resolveStageChain,
  type StageLocation,
  type StageShot,
} from "./stageLab";
import { fetchExtractedLastFrame } from "./extractLastFrame";

export const STAGE_PLATE_COST_USD = ESTIMATED_STILL_COST_USD;

export type StageMakePlateOutcome =
  | { ok: true; plateUrl: string; prompt: string; spentUsd: number }
  | { ok: false; message: string; unconfigured?: boolean; spentUsd: number };

function plateTarget(shot: StageShot) {
  return {
    folder: "deck/stage-lab/plates",
    name: `shot-${String(shot.number).padStart(2, "0")}`,
  };
}

async function resolveRefs(urls: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const url of urls) {
    out.push(await resolvePlateReferenceDataUrl(url));
  }
  return out;
}

/** Chain: previous render's last frame only. No Cast overlay, no Grok still. */
export async function applyStageChainFrame(
  shots: readonly StageShot[],
  shot: StageShot,
): Promise<StageMakePlateOutcome> {
  const chain = resolveStageChain(shots, shot);
  if (!chain.ok) return { ok: false, message: chain.reason, spentUsd: 0 };
  const previous = shots.find((s) => s.id === chain.previousId);
  const videoUrl = previous?.renderUrl;
  if (!videoUrl) return { ok: false, message: `Shot #${chain.fromNumber} has no render URL to pull a last frame from.`, spentUsd: 0 };
  const extracted = await fetchExtractedLastFrame(videoUrl);
  if (!extracted.ok) return { ok: false, message: extracted.message, spentUsd: 0 };
  return { ok: true, plateUrl: extracted.url, prompt: "Chained last frame (no Cast copy, no new still).", spentUsd: 0 };
}

export async function makeStagePlate(
  shots: readonly StageShot[],
  shot: StageShot,
  location: StageLocation | null,
): Promise<StageMakePlateOutcome> {
  if (shot.startMode === "chain") {
    return applyStageChainFrame(shots, shot);
  }
  const missing = missingPlatePictures(shot, location);
  if (missing.length) {
    return { ok: false, message: missing.join(". ") + ". White-void starts are refused.", spentUsd: 0 };
  }
  const compiled = compileStagePrompt(shot, location);
  const urls = compiled.images.map((img) => img.url).filter((u): u is string => Boolean(u));
  if (urls.length === 0) {
    return { ok: false, message: "No Location picture to send. White-void starts are refused.", spentUsd: 0 };
  }
  let refs: string[];
  try {
    refs = await resolveRefs(urls);
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Could not read a reference picture.",
      spentUsd: 0,
    };
  }
  const request: PlateGenerationRequest = {
    prompt: compiled.platePrompt,
    shotPrompt: compiled.shotPrompt || compiled.platePrompt.slice(0, 2000),
    referenceImageDataUrls: refs.slice(0, 5),
  };
  const still = await generatePlateStill(request);
  if (!still.ok) {
    return { ok: false, message: still.message, unconfigured: still.unconfigured, spentUsd: 0 };
  }
  let dataUrl = still.dataUrl;
  try {
    dataUrl = await downscaleDataUrlImage(dataUrl);
  } catch {
    // Keep the raw still rather than fail a paid success.
  }
  const uploaded = await uploadSkidmarksPlateStill(dataUrl, plateTarget(shot));
  const plateUrl = uploaded.ok ? uploaded.url : dataUrl;
  return { ok: true, plateUrl, prompt: compiled.platePrompt, spentUsd: STAGE_PLATE_COST_USD };
}
