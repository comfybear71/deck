"use client";

/**
 * LOCATIONS (2026-09-30, Stuart's ask): one sideways row of places,
 * directly above the Characters row on every project screen. The same
 * look and the same taps as the Characters row: square tiles with the
 * name under each, a dotted "+" tile at the end, and a tapped tile opens
 * underneath (name — tap to rename, the bin needs two taps, ✕ closes)
 * with its picture and "Replace picture". Same in every genre.
 *
 * Saving: `lib/locationEdits.ts` (its own `deck_items` row per location).
 * Pictures: `lib/locationPicture.ts` (1280×720 JPEG in Deck Blob).
 */
import { useRef, useState, useSyncExternalStore } from "react";
import {
  DECK_LOCATION_NAME_MAX,
  buildDeckLocation,
  effectiveDeckLocations,
  savedDeckLocations,
  withBuiltInsSaved,
  type DeckLocation,
  type DeckLocationGenre,
} from "@/lib/deckLocations";
import {
  addDeckLocation,
  deleteDeckLocation,
  renameDeckLocation,
  setDeckLocationPeopleInPicture,
  setDeckLocationPicture,
} from "@/lib/locationEdits";
import { uploadLocationPicture } from "@/lib/locationPicture";
import { shortsScriptEditorOpen } from "@/lib/shortsEpisodeCast";
import { getDeckLocationsState, getSkidmarksSnapshot, subscribeSkidmarks, type SkidmarksState } from "@/lib/skidmarks";
import { episodeLocationGenre, episodeNameFirstMessage, episodeOwnLocations } from "@/lib/episodeCast";
import { openEpisodeScopeIn } from "@/lib/episodeScopes";
import { pinOpenEpisodeFolder } from "@/lib/episodeFolders";
import { TILE_CORNER_BUTTON_SHAPE_CLASS, TrashGlyph } from "./TileCornerGlyphs";

type Notice = { text: string; tone: "error" | "warn" | "busy" } | null;

/** The places on a genre's row: its saved list (or built-ins), or for
 * Skidmarks and Shorts only the open episode's own (2026-10-04,
 * `lib/episodeCast.ts`). */
export function locationsOnRow(genre: DeckLocationGenre, snapshot: SkidmarksState): DeckLocation[] {
  const perEpisode = episodeLocationGenre(genre);
  if (perEpisode) return episodeOwnLocations(getDeckLocationsState(snapshot), perEpisode, openEpisodeScopeIn(snapshot, perEpisode));
  return effectiveDeckLocations(getDeckLocationsState(snapshot), genre);
}

export default function LocationsRow({ genre }: { genre: DeckLocationGenre }) {
  const snapshot = useSyncExternalStore(subscribeSkidmarks, getSkidmarksSnapshot, getSkidmarksSnapshot);
  // Skidmarks and Shorts (2026-10-04): each episode has its own
  // Locations, so the row shows only the open episode's (`lib/episodeCast.ts`).
  const list = locationsOnRow(genre, snapshot);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const cancelRename = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const addFileInput = useRef<HTMLInputElement>(null);
  const replaceFileInput = useRef<HTMLInputElement>(null);

  const open = list.find((l) => l.id === openId) ?? null;

  const close = () => {
    setOpenId(null);
    setNameDraft(null);
    setConfirmDelete(false);
    setNotice(null);
  };
  const toggle = (loc: DeckLocation) => {
    setAdding(false);
    if (openId === loc.id) close();
    else {
      close();
      setOpenId(loc.id);
    }
  };
  const toggleAdd = () => {
    close();
    setAdding((a) => !a);
    setNewName("");
    setNewFile(null);
  };

  const add = async () => {
    // A Skidmarks or Shorts place belongs to the open episode: its folder
    // is pinned first (the episode needs a name), then names only clash
    // within it.
    let scope: { episode?: string | null; nameScope?: readonly DeckLocation[] } = {};
    const perEpisode = episodeLocationGenre(genre);
    if (perEpisode) {
      const episode = pinOpenEpisodeFolder(perEpisode);
      if (!episode) {
        setNotice({ text: episodeNameFirstMessage(perEpisode, "locations", shortsScriptEditorOpen(getSkidmarksSnapshot())), tone: "error" });
        return;
      }
      scope = { episode, nameScope: locationsOnRow(genre, getSkidmarksSnapshot()) };
    }
    // Checked up front, so a bad name never uploads a picture.
    const listNow = savedDeckLocations(withBuiltInsSaved(getDeckLocationsState(), genre), genre);
    const check = buildDeckLocation(genre, listNow, newName, null, Date.now(), scope);
    if (!check.ok) {
      setNotice({ text: check.error, tone: "error" });
      return;
    }
    let pictureUrl: string | null = null;
    if (newFile) {
      setBusy(true);
      setNotice({ text: "Saving the picture…", tone: "busy" });
      const up = await uploadLocationPicture(newFile, genre, check.value.key, check.value.episode);
      setBusy(false);
      if (!up.ok) {
        setNotice({ text: up.error, tone: "error" });
        return;
      }
      pictureUrl = up.url;
    }
    const result = addDeckLocation(genre, newName, pictureUrl, scope);
    if (!result.ok) {
      setNotice({ text: result.error, tone: "error" });
      return;
    }
    setAdding(false);
    setNewName("");
    setNewFile(null);
    setNotice(null);
  };

  const replacePicture = async (loc: DeckLocation, file: File) => {
    setBusy(true);
    setNotice({ text: "Saving the picture…", tone: "busy" });
    const up = await uploadLocationPicture(file, genre, loc.key, loc.episode);
    setBusy(false);
    if (!up.ok) {
      setNotice({ text: up.error, tone: "error" });
      return;
    }
    const result = setDeckLocationPicture(genre, loc.id, up.url);
    if (!result.ok) setNotice({ text: result.error, tone: "error" });
    else {
        setNotice(null);
    }
  };

  const commitName = (loc: DeckLocation) => {
    const draft = nameDraft !== null && !cancelRename.current ? nameDraft : null;
    cancelRename.current = false;
    setNameDraft(null);
    if (draft === null || draft.trim() === loc.name) return;
    const result = renameDeckLocation(genre, loc.id, draft, episodeLocationGenre(genre) ? list : undefined);
    if (!result.ok) setNotice({ text: result.error, tone: "error" });
    else {
        setNotice(null);
    }
  };

  const tapDelete = (loc: DeckLocation) => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      setNotice({ text: `Tap the bin again to take ${loc.name} off the list. Its picture stays in storage.`, tone: "warn" });
      return;
    }
    const result = deleteDeckLocation(genre, loc.id);
    if (!result.ok) {
      setConfirmDelete(false);
      setNotice({ text: result.error, tone: "error" });
      return;
    }
    close();
  };

  const noticeLine = notice && (
    <p
      role={notice.tone === "error" ? "alert" : "status"}
      className={`mt-1 text-[11px] ${notice.tone === "error" ? "text-red-300" : notice.tone === "busy" ? "text-sky-300" : "text-amber-200/80"}`}
    >
      {notice.text}
    </p>
  );

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">Locations</p>
      <div className="flex touch-pan-x touch-pan-y items-start gap-3 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {list.map((loc) => (
          <div
            key={loc.id}
            className={`flex w-24 shrink-0 flex-col items-center gap-1 rounded-lg p-1 ${openId === loc.id ? "bg-emerald-500/10" : ""}`}
          >
            <button
              type="button"
              onClick={() => toggle(loc)}
              className="block aspect-square w-full overflow-hidden rounded-lg bg-white/5"
              aria-label={`Open ${loc.name}`}
            >
              {loc.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={loc.pictureUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[10px] text-white/40">No picture</span>
              )}
            </button>
            <span className="w-full truncate text-center text-[11px] text-white/75">{loc.name}</span>
          </div>
        ))}
        <div className="flex w-24 shrink-0 flex-col items-center gap-1 p-1">
          <button
            type="button"
            onClick={toggleAdd}
            disabled={busy}
            aria-label="Add a location"
            className={`flex aspect-square w-full touch-manipulation items-center justify-center rounded-lg border-2 border-dashed text-3xl font-light disabled:opacity-40 ${
              adding ? "border-sky-400/70 text-sky-300" : "border-white/25 text-white/50 hover:border-white/40"
            }`}
          >
            +
          </button>
          <span aria-hidden className="text-[11px]">&nbsp;</span>
        </div>
      </div>

      {adding && (
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void add()}
            placeholder="Name"
            maxLength={DECK_LOCATION_NAME_MAX}
            aria-label="Location name"
            className="rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-white placeholder:text-white/30"
          />
          <input
            ref={addFileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              setNewFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => addFileInput.current?.click()}
            disabled={busy}
            className="truncate rounded-md border border-dashed border-white/25 px-2 py-2 text-xs text-white/80 disabled:opacity-40"
          >
            {newFile ? `Picture: ${newFile.name}` : "Pick a picture"}
          </button>
          {noticeLine}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !newName.trim()}
              className="rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
            >
              Add
            </button>
            <button type="button" onClick={toggleAdd} className="px-2 text-xs text-white/50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="mt-2 rounded-xl border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              {nameDraft !== null ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={() => commitName(open)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") {
                      cancelRename.current = true;
                      e.currentTarget.blur();
                    }
                  }}
                  maxLength={DECK_LOCATION_NAME_MAX}
                  aria-label={`Rename ${open.name}`}
                  className="min-w-0 flex-1 rounded-md border border-white/15 bg-black/40 px-2 py-1 text-xs text-white"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDelete(false);
                    setNotice(null);
                    setNameDraft(open.name);
                  }}
                  className="min-w-0 truncate text-left text-sm font-semibold text-white"
                  title="Tap to rename"
                  aria-label={`${open.name}. Tap to rename`}
                >
                  {open.name}
                </button>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => tapDelete(open)}
                aria-label={confirmDelete ? `Tap again to delete ${open.name}` : `Delete ${open.name}`}
                title="Delete location"
                className={`${TILE_CORNER_BUTTON_SHAPE_CLASS} ${
                  confirmDelete ? "bg-red-500/80 text-white" : "bg-black/50 text-white/70 hover:bg-red-500/60"
                }`}
              >
                <TrashGlyph />
              </button>
              <button type="button" onClick={close} className="px-1 text-xs text-white/40" aria-label="Close">
                ✕
              </button>
            </div>
          </div>
          {noticeLine}
          {open.pictureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={open.pictureUrl} alt={open.name} className="mt-2 aspect-video w-full rounded-lg object-cover" />
          )}
          <input
            ref={replaceFileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void replacePicture(open, file);
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => replaceFileInput.current?.click()}
              disabled={busy}
              className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/80 disabled:opacity-40"
            >
              {open.pictureUrl ? "Replace picture" : "Add a picture"}
            </button>
            <span className="text-[10px] text-white/35">In scripts: [Location: {open.key}]</span>
          </div>
          {/* A pre-made plate (2026-10-03): used as the shot's picture as it
              is, one person or several, silent or talking. */}
          <label className="mt-2 flex min-h-[40px] cursor-pointer items-center gap-2 text-xs text-white/75">
            <input
              type="checkbox"
              checked={open.peopleInPicture === true}
              disabled={busy}
              onChange={(e) => {
                const result = setDeckLocationPeopleInPicture(genre, open.id, e.target.checked);
                setNotice(result.ok ? null : { text: result.error, tone: "error" });
              }}
              className="h-4 w-4 accent-sky-500"
            />
            People already in this picture — don&apos;t add Cast
          </label>
        </div>
      )}
      {!adding && !open && noticeLine}
    </div>
  );
}
