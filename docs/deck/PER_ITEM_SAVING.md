# Per-item saving (step 1: Characters)

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

## Code map

- `lib/deckItems.ts`: kinds, folders, shared types.
- `lib/deckItems-server.ts`: the SQL (compare-and-swap writes, history, soft delete). Never DDL.
- `app/api/deck/items/route.ts`: `GET ?kind=character`, `PUT`, `DELETE`.
- `lib/characterItems.ts`: client engine (diff, debounce, overlay, 409 adopt).
- `lib/skidmarks.ts`: wiring (`patchCharacterLoras`, `removeCharacterLora`, after each session load).
- `lib/deckItemsSeed.ts` + `scripts/seed-deck-items-characters.ts`: the one-time seed.
