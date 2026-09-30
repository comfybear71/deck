/**
 * A location picture from a picked file (2026-09-30): cropped to fill
 * 1280×720 (the size every Sunnybank plate already is, and what LTX is
 * sent), saved as a JPEG in Deck Blob at
 * `deck/<genre>/locations/<location>.jpg` (a replaced picture is `-v2`,
 * never an overwrite). The same for every genre.
 */
import { deckLocationPictureTarget, type DeckLocationGenre } from "./deckLocations";
import { uploadSkidmarksMemberPhoto } from "./memberPhotoBlob";

export const LOCATION_PICTURE_WIDTH = 1280;
export const LOCATION_PICTURE_HEIGHT = 720;
const LOCATION_PICTURE_QUALITY = 0.88;

/** The centred part of a `sw`×`sh` picture that fills `tw`×`th` without stretching. */
export function coverCrop(sw: number, sh: number, tw: number, th: number): { sx: number; sy: number; sw: number; sh: number } {
  if (!(sw > 0 && sh > 0 && tw > 0 && th > 0)) return { sx: 0, sy: 0, sw: Math.max(0, sw), sh: Math.max(0, sh) };
  const target = tw / th;
  if (sw / sh > target) {
    const w = Math.round(sh * target);
    return { sx: Math.round((sw - w) / 2), sy: 0, sw: w, sh };
  }
  const h = Math.round(sw / target);
  return { sx: 0, sy: Math.round((sh - h) / 2), sw, sh: h };
}

/** Browser only: the picked file as a 1280×720 JPEG `data:` URL. */
export function locationPictureDataUrl(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read that picture."));
    };
    img.onload = () => {
      try {
        const c = coverCrop(img.naturalWidth, img.naturalHeight, LOCATION_PICTURE_WIDTH, LOCATION_PICTURE_HEIGHT);
        const canvas = document.createElement("canvas");
        canvas.width = LOCATION_PICTURE_WIDTH;
        canvas.height = LOCATION_PICTURE_HEIGHT;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not read that picture.");
        ctx.drawImage(img, c.sx, c.sy, c.sw, c.sh, 0, 0, LOCATION_PICTURE_WIDTH, LOCATION_PICTURE_HEIGHT);
        resolve(canvas.toDataURL("image/jpeg", LOCATION_PICTURE_QUALITY));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Could not read that picture."));
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.src = url;
  });
}

/** Browser only: crops and uploads a picked picture. */
export async function uploadLocationPicture(
  file: File | Blob,
  genre: DeckLocationGenre,
  key: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let dataUrl: string;
  try {
    dataUrl = await locationPictureDataUrl(file);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not read that picture." };
  }
  const up = await uploadSkidmarksMemberPhoto(dataUrl, deckLocationPictureTarget(genre, key));
  return up.ok ? { ok: true, url: up.url } : { ok: false, error: up.message };
}
