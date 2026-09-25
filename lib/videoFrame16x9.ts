import sharp from "sharp";
import {
  FORCED_FRAME_HEIGHT,
  FORCED_FRAME_WIDTH,
  FORCED_VIDEO_ASPECT_RATIO,
} from "./videoAspect";

// FORCED 16:9 – do not change unless intentionally switching formats
// (see ./videoAspect for why). Server-only: uses sharp.
export { FORCED_FRAME_HEIGHT, FORCED_FRAME_WIDTH, FORCED_VIDEO_ASPECT_RATIO };

/** Within 1% of 16:9 counts as already widescreen (e.g. 2560x1440,
 * 1280x720, 1920x1088) — left untouched. */
const SIXTEEN_BY_NINE_TOLERANCE = 0.01;
const PAD_TIMEOUT_MS = 15_000;

export function isSixteenByNine(width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const target = FORCED_FRAME_WIDTH / FORCED_FRAME_HEIGHT;
  return Math.abs(width / height - target) / target <= SIXTEEN_BY_NINE_TOLERANCE;
}

export interface Framed16x9Image {
  bytes: Uint8Array;
  mimeType: string;
  padded: boolean;
}

async function padFrameTo16x9Inner(bytes: Uint8Array, mimeType: string): Promise<Framed16x9Image> {
  const meta = await sharp(Buffer.from(bytes)).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h || isSixteenByNine(w, h)) return { bytes, mimeType, padded: false };
  const out = await sharp(Buffer.from(bytes))
    .rotate()
    .resize({
      width: FORCED_FRAME_WIDTH,
      height: FORCED_FRAME_HEIGHT,
      fit: "contain",
      background: { r: 0, g: 0, b: 0 },
    })
    .jpeg({ quality: 92 })
    .toBuffer();
  return { bytes: new Uint8Array(out), mimeType: "image/jpeg", padded: true };
}

/** Pads a start frame to 1920x1080 when it isn't already 16:9. Never
 * throws; on decode failure or timeout returns the original bytes so a
 * framing step can never block a paid render. */
export async function padFrameTo16x9(bytes: Uint8Array, mimeType: string): Promise<Framed16x9Image> {
  try {
    const timedOut = new Promise<Framed16x9Image>((resolve) =>
      setTimeout(() => resolve({ bytes, mimeType, padded: false }), PAD_TIMEOUT_MS)
    );
    return await Promise.race([padFrameTo16x9Inner(bytes, mimeType), timedOut]);
  } catch {
    return { bytes, mimeType, padded: false };
  }
}
