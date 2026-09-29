# Per-item saving (step 1: Characters, step 2: Sunnybank episodes, step 3: Skidmarks episodes and shorts)

Plain English first, then the runbook.

## What changes

Until now every character card lived inside the one big saved session
(`skidmarks_sessions`, owner `stuart`). If an old phone copy was saved over
that row, every character went with it (29 Sep, 10:40 pm).

Now each character card is also saved **on its own**, as one row in a new
`deck_items` table, and only when that card actually changes. Each card has
its own revision number, so a stale device can at worst be refused on the
one card it touched; it can't wipe the others. The version a card had
before each save is kept in `deck_item_history` (the newest 20 per card).

- Opening the app: the session loads as before, then the saved cards are
  laid over it. **The saved cards win.** Loading never writes anything.
- Editing a card: about a second after the last change, that one card is
  sent. If another device saved it first, this device takes that copy.
- A card missing from a device's list is **never** deleted because of it.
  Only the card's own delete button deletes it (a soft delete: the row is
  kept with `deleted_at` set, plus a history copy).
- The app never creates the tables and never uploads "its" cards to an
  empty table. Until the migration and the one-time seed have been run, it
  keeps saving exactly the old way.
- The whole-session save still runs too, as a mirror, for now.

Folder of each card comes from its sourceKey: `sb:`/`sbx:` Sunnybank,
`mv:`/`mvx:` Music video, `sk:` Skidmarks, `as:`/`asx:` Adult shorts, none
(Skye, cards added by hand) at the Deck root.

## Runbook (by hand, in this order)

1. Create the tables (idempotent, only adds):

   ```
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/migrations/2026-09-30_deck_items.sql
   ```

2. Dry run the seed (read-only transaction, writes nothing):

   ```
   DATABASE_URL=... npx vite-node scripts/seed-deck-items-characters.ts --dry-run
   ```

3. Seed for real (refuses if any character rows already exist, or if the
   session was saved between its read and its insert):

   ```
   DATABASE_URL=... npx vite-node scripts/seed-deck-items-characters.ts --write
   ```

4. Reload the app. From then on character cards save per item.

Run 2 and 3 back to back: a card edited on a device between the seed's read
and a reload of that device is still in the session copy, and gets its own
row the next time it's edited.

## Step 2: Sunnybank episodes

Each saved Sunnybank episode (a card on the episode shelf / the Episodes
row) is now also its own `deck_items` row: kind `sunnybank-episode`, folder
`sunnybank`, item id = the card's own id (`ws-...`). The same rules as
characters apply, word for word: the app never seeds, loading never writes,
an episode missing from a device is never deleted because of it (only the
card's ✕ deletes), a refused save (409) means this device takes the
server's copy, and the whole-session save keeps running as a mirror. The
live working copy (what is open on screen) is not an item; it still saves
in the session as before.

Stable ids and media folders:

- A card's id never changes once it's made. The live copy now remembers
  which card it was opened from or last saved as, so saving after a rename
  updates that same card (before, a rename made a second card).
- Each episode pins its media folder name once (`mediaSlug`), from its name
  at the time: `deck/sunnybank/episodes/<mediaSlug>/`. A rename never moves
  where new clips go. Neither field changes the "saved / not saved" check.

Runbook (tables already exist from step 1):

1. Dry run (the default; read-only transaction, writes nothing):

   ```
   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-sunnybank-episodes.ts
   ```

2. Seed for real (refuses if any episode rows already exist, if there are
   no episodes, or if the session was saved between its read and its
   insert):

   ```
   DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-sunnybank-episodes.ts --write
   ```

3. Reload the app. From then on episode cards save per item.

The seed needs at least one saved episode. Until it has run, episodes keep
saving only the old way.

## Code map

- `lib/deckItems.ts`: kinds, folders, shared types.
- `lib/deckItems-server.ts`: the SQL (compare-and-swap writes, history, soft delete). Never DDL.
- `app/api/deck/items/route.ts`: `GET ?kind=character`, `PUT`, `DELETE`.
- `lib/deckItemSync.ts`: THE client engine for every kind (diff, debounce,
  overlay, 409 adopt, delete taps). One code path for characters, Sunnybank
  episodes, Skidmarks episodes and shorts.
- `lib/characterItems.ts`: characters, as a kind for the engine (kind +
  cleaner), plus the names characters have always used, as aliases.
- `lib/sunnybankEpisodeItems.ts`: Sunnybank episode cards, as a kind for the
  engine (kind + cleaner + newest-first shelf order), plus its old names as aliases.
- `lib/sunnyBanksWorkspace.ts`: stable card ids on save/rename, pinned `mediaSlug`.
- `lib/skidmarks.ts`: wiring, the same few lines for every kind (`patchCharacterLoras`, `removeCharacterLora`, `saveSunnyBanksProjectWorkspace`, `deleteSunnyBanksWorkspace`, after each session load).
- `lib/deckItemsSeed.ts` + `scripts/seed-deck-items-characters.ts` / `scripts/seed-deck-items-sunnybank-episodes.ts`: the one-time seeds.

## Step 3: Skidmarks episodes and shorts

Same idea, same steps, same rules as characters and Sunnybank episodes, for two more things:

- **Skidmarks episodes**: each episode is one `deck_items` row, kind
  `skidmarks-episode`, folder `skidmarks`, keeping its own `ep_…` id. The
  cast list stays in the session save for now.
- **Shorts**: each saved short in the Library is one row, kind
  `adult-short`, folder `adult-shorts` (the key the database and code
  already use), keeping its own `short_…` id. The open editor (character,
  shot list, the 18+ confirm) stays in the session save, as before.

Nothing about how they look or work changes. Opening the app loads the
session, then lays the saved episodes and shorts over it (the rows win),
without writing. Editing one sends only that one, about a second later.
Only the episode's delete button and the Library's "Delete short" delete a
row (soft delete, with history). One missing from a device is never
deleted because of it. A 409 means this device takes the server's copy.
The whole-session save carries on as a mirror.

No new tables: the same `deck_items` and `deck_item_history`. No
migration to run.

### Runbook (by hand)

Each seed reads **only `DECK_DATABASE_URL`** (never `DATABASE_URL`).

```
# Read-only look (READ ONLY transaction, writes nothing):
DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-skidmarks-episodes.ts --dry-run
DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-adult-shorts.ts --dry-run

# Really insert, once each, after checking the dry run:
DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-skidmarks-episodes.ts --write
DECK_DATABASE_URL=... npx vite-node scripts/seed-deck-items-adult-shorts.ts --write
```

Same guards as the character seed: refuses if rows of that kind already
exist, if there is nothing to seed, or if the session was saved between
its read and its insert. Until a kind is seeded, that kind keeps saving
the old way only (the app never seeds). A kind with nothing in it yet
(no episodes) can't be seeded; it stays on the session save until there
is at least one and the seed is run.

### Code map (step 3)

- `lib/skidmarksEpisodeItems.ts`, `lib/adultShortItems.ts`: which kind,
  which cleaner (`normalizeSkidmarksEpisode`, `normalizeAdultShortsSavedEntry`).
- `lib/deckItems.ts`, `lib/deckItems-server.ts`: the two new kinds and their folders.
- `lib/skidmarks.ts`: wiring (`patchSkidmarksEpisodes`, `removeSkidmarksEpisode`,
  `patchAdultShorts`, `removeSavedAdultShort`, after each session load).
- `lib/deckItemSeedPlan.ts`, `scripts/seedDeckItemsKind.ts`,
  `scripts/seed-deck-items-skidmarks-episodes.ts`, `scripts/seed-deck-items-adult-shorts.ts`: the one-time seeds.
