# Per-item saving: Music video (bands and songs)

The same steps as characters (`docs/deck/PER_ITEM_SAVING.md`). Plain
English first, then the runbook.

## What changes

Until now every Music video band and the song on the desk lived inside
the one big saved session (`skidmarks_sessions`, owner `stuart`), so an
old phone copy saved over that row could take them all with it.

Now each **band** is also saved on its own, as one row in `deck_items`
(kind `music-video-band`), and so is each **song** (kind
`music-video-song`), only when that one
band or song actually changes. Each has its own revision, and the
version before each save is kept in `deck_item_history` (newest 20).

- **A band row** is the band as the studio holds it: name, cover, its
  pinned folder name, and its members (avatar, looks, lock, sleeve). Each
  member also carries `characterId`, the id of its character row (the
  character card linked to that member). That is only a pointer: nothing
  from the character card is copied into the band row.
- **A song row** is the song on the desk: which band, the MP3 (clips,
  plates, prompts, audio link) and the Script Sequence text. Its id is
  the MP3's attach id, made once when the file was attached.
- Ids never change, so renaming a band never moves its row or its media
  folder (that comes from the band's pinned `mediaSlug`).

The rules are the character rules, word for word:

- Opening the app: the session loads as before, then the saved bands and
  the desk's song are laid over it. **The saved rows win.** Loading
  never writes anything.
- Editing: about a second after the last change, that one band (or the
  song) is sent. If another device saved it first, this device takes
  that copy.
- A band or song missing from a device is **never** deleted because of
  it. Only the band's own trash tap deletes a band, and only the MP3
  card's own remove tap deletes a song (soft deletes, with a history
  copy). Switching band, New, or clearing the desk after Archive just
  takes the song off the desk; its row stays.
- The app never creates the tables and never uploads "its" bands or
  songs to an empty table. Until the one-time seed has run it keeps
  saving exactly the old way.
- The whole-session save still runs too, as a mirror, for now.

The desk holds one song at a time, so laying the saved songs over the
screen only ever refreshes the song already on the desk; it never puts a
different song there. Bands and songs switch on together: once the seed
has put the bands in, songs save per item too, even though no song was
on the desk that day.

Finished Songs (the shelf under the desk) are not part of this step:
they stay in Blob (`skidmarks/archive/`), untouched.

## Runbook (by hand, in this order)

The tables already exist (made for characters). Nothing to migrate.

1. Dry run the seed. This is the default, and read-only (every query runs
   in a READ ONLY transaction). It reads **only** `DECK_DATABASE_URL`:

   ```
   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-music-video.ts
   ```

2. Seed for real (refuses if any band or song rows already exist, or if
   the session was saved between its read and its insert):

   ```
   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-music-video.ts --write
   ```

3. Reload the app. From then on bands and songs save per item.

## Code map

- `lib/deckItems.ts`: the `music-video-band` and `music-video-song` kinds, and `deckItemSeedKinds` (bands and songs are seeded together).
- `lib/deckItems-server.ts`: `prepareDeckItemData` cleans a band or song; `listDeckItems` reports `seeded` for the pair.
- `lib/musicVideoItemData.ts`: what a band row and a song row hold, cleaned the same way on the server, in the browser and in the seed.
- `lib/deckItemSync.ts`: the shared per-item engine, the same file as the Skidmarks episodes and shorts step (PR 216), plus one optional `toData` hook so a band's PUT can carry its members' character references.
- `lib/musicVideoItems.ts`: Music video glue (the band and song kind configs, laying server rows over the studio state).
- `lib/skidmarks.ts`: wiring (`persist` hands every edit over; `removeSkidmarksBand` and `clearSkidmarksMp3` are the only deletes; read after each session load).
- `lib/musicVideoItemsSeed.ts` + `scripts/seed-deck-items-music-video.ts`: the one-time seed.
- Tests: `lib/musicVideoItemSync.test.ts` (engine rules), `lib/musicVideoItems.test.ts`, `lib/musicVideoItems.wiring.test.ts` (the real store end to end), `lib/deckItems-server.musicVideo.test.ts`, `lib/musicVideoItemsSeed.test.ts`.
