# The Tab — French Deck

A glanceable, single-card cost scoreboard. The goal is to understand monthly
burn in under two seconds — not a finance admin panel, no sidebar, no
multi-page nav.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS, at the repo root.
- No auth on the UI, no live billing APIs. Cost data is seed data plus
  whatever's been ingested via the mail bridge described below — the only
  backends are the small `/api/control-plane/*` stub and the
  `/api/ingest/*` mail bridge, neither of which bill anything.

## What's here

- `data/meters.json` — seed cost meters (id, name, suit, amount, currency,
  cadence, mode, notes, optional alert).
- `data/overrides.json` — local store the mail ingest bridge writes to;
  amount overrides merged on top of the seed meters. See "Mail -> Tab"
  below.
- `lib/` — types + pure helpers (lane/burn sums, money formatting, glow
  intensity vs. the leash goal).
- `lib/control-plane.ts` / `lib/control-plane-server.ts` — the v0
  control-plane stub. See "Control plane (v0 stub)" below.
- `lib/overrides.ts` / `lib/overrides-server.ts` — the Mail -> Tab ingest
  bridge (shared types/merge logic, and the server-side store). See "Mail
  -> Tab" below.
- `app/api/control-plane/` — App Router routes (`mode`, `check`, `report`)
  that back the stub's server side.
- `app/api/ingest/` — App Router routes (`receipt`, `meters`) that accept
  POSTed receipt data and update `data/overrides.json`.
- `hooks/useDialModes.ts` — per-lane **Full / Slow / Pause** dial state.
  Calls straight into `lib/control-plane.ts`'s `setMode`, so the dial and
  the plane share one source of truth (`localStorage`, mirrored to the
  server stub). Dials actually gate things now — see below.
- `hooks/useTabView.ts` — which of the three surfaces The Tab is showing
  (chip / expanded card / graph), persisted to `localStorage`. Defaults to
  the chip.
- `data/graph.json` / `lib/graph.ts` — the v0 project graph's seed data and
  pure helpers. See "Graph (v0 map)" below.
- `data/budju.json` / `lib/budju.ts` — Budju portfolio glance seed data and
  pure helpers (signal sort/format, buy/sell band position). See "Budju
  node (portfolio glance)" below.
- `data/propfolio.json` / `lib/propfolio.ts` — Propfolio health/error
  status seed data and pure helpers (status chip metadata, count/timestamp
  formatting). See "Propfolio node (status glance)" below.
- `app/api/health/propfolio/` — a GET stub that returns
  `data/propfolio.json` as-is; the seam for a future real health probe.
- `components/` — `TabWidget` (switches between chip/card/graph), `TabChip`
  (the default collapsed pill), `TabCard` (the full expanded screen),
  `BigBurn` (big number + glow halo), `AlertsStrip`, `SuitLane` (one of the
  four suits), `DialControl`, `BottomSheet` (tap a suit to see its
  individual meters), `ControlPlaneDemo` (the "Simulate spend" panel,
  expanded-view only), `MailSyncLine` (the tiny "Last mail sync" line,
  expanded-view only), `GraphView` / `GraphNodeCard` / `GraphNodeSheet`
  (the v0 project graph — see below), `BudjuNodeCard` / `BudjuDetailSheet`
  (the featured Budju node's face + detail sheet), `PropfolioNodeCard` /
  `PropfolioDetailSheet` (the Propfolio status node's face + detail sheet).

## Control plane (v0 stub)

Stuart wants Full / Slow / Pause to mean something, not just look like a
toggle. This app now ships a **thin local control-plane stub** — not a
separate service, just enough to make the dials bite and to give a future
project (Skidmarks, or `aiglitch-api`) an obvious shape to call into.

- `check(lane)` \u2192 `{ allowed, mode, reason?, maxConcurrent?, delayMs? }`.
  **Pause** denies (`allowed: false`). **Slow** allows but returns a
  throttle hint (`maxConcurrent: 1`, `delayMs: 1200`). **Full** allows
  outright. Synchronous and local — reads the same store a dial just wrote,
  so it works instantly, even offline.
- `report(lane, amount?, meta?)` records a spend event. It's a
  client-persisted log in `localStorage` (`the-tab:spend-log`, capped at the
  last 100 events) plus a best-effort POST to `/api/control-plane/report`,
  which appends to an in-memory server-side log
  (`lib/control-plane-server.ts`). The server mirror is fire-and-forget —
  the UI never blocks on it, and it resets on redeploy/cold start, which is
  expected for a stub.
- `setMode(lane, mode)` persists the dial position to `localStorage`
  (`the-tab:dial-modes` — the same key `useDialModes` reads) and
  best-effort mirrors it to `/api/control-plane/mode`. The suit dials call
  this directly, so the UI and the plane can't drift apart.
- **`ControlPlaneDemo`** — an expandable "Control-plane demo" section at the
  bottom of the expanded `TabCard` (not shown in chip mode). Each suit has a
  "Simulate spend" button that runs the real `check` \u2192 `report` round
  trip and shows **allowed** / **throttled** / **denied**, so the leash is
  felt on a phone without plugging in a real spend source yet.

### How a future project calls this

`Skidmarks` / `aiglitch-api` isn't wired to this stub — that's explicitly
out of scope here. When it is, the intended integration is: before an
expensive call, hit `GET /api/control-plane/check?lane=<diamonds|spades|hearts|clubs>`
and honor `allowed`/`delayMs`/`maxConcurrent`; after it, `POST
/api/control-plane/report` with `{ lane, amount, meta }`. Both routes are
plain JSON over HTTP with no auth in v0 (same-origin, no secrets) — a real
control plane will very likely be its **own service**, not nested inside
this app; these routes exist so the request/response shape is proven out
first.

## Mail -> Tab (mail ingest bridge)

Stuart's real cost truth mostly shows up as receipt emails in iCloud's
`_PROJECTS` mailbox (via IMAP), not as an API The Tab can poll. Wiring live
IMAP into this app is explicitly **out of scope for now** — Vercel + an
Apple app password is an awkward combination to hold secrets for, and
that's a decision worth making deliberately later, not by accident here.
Instead, this ships the **shape of the bridge**: a small ingest API a
future mail job (Grok Bot, or a cron script) can POST to, and a merge step
the UI already reads from.

- **`POST /api/ingest/receipt`** — ingest one receipt:

  ```json
  {
    "vendor": "Vercel Inc.",
    "amount": 59.0,
    "currency": "USD",
    "date": "2026-09-08",
    "subject": "Your receipt from Vercel Inc.",
    "source": "imap",
    "meterId": "vercel"
  }
  ```

  Only `vendor` and `amount` are required. `currency` defaults to `USD`
  (must be `USD` or `AUD` — the two currencies The Tab tracks). `source`
  defaults to `imap`. `meterId` is optional — if you already know which
  seed meter a receipt belongs to (e.g. a cron job keying off a fixed
  vendor list), pass it and skip the fuzzy match entirely. Without it, the
  vendor string is fuzzy-matched against each seed meter's `id`/`name`
  (`"Vercel Inc."` matches the `vercel` meter, `"Anthropic"` won't unless
  it's close enough to `"claude-sub"` — pass `meterId` when in doubt).

- **`POST /api/ingest/meters`** — batch variant for a morning job that
  wants to POST several receipts from one IMAP sweep at once. Body is
  `{ "receipts": [...] }` (or a bare array) of the same per-receipt shape.
  Each item is validated independently — one bad item doesn't fail the
  whole batch.

- Both routes are protected by a shared-secret header, **`x-deck-ingest-key`**,
  checked against the `DECK_INGEST_KEY` environment variable. If
  `DECK_INGEST_KEY` isn't set, requests are allowed through unauthenticated
  and a warning is logged server-side — convenient for local dev, **not**
  something to leave unset once this is pointed at anything beyond
  localhost.

- A matched receipt's `amount`/`currency` overrides that meter's seed
  values — merged on top of `data/meters.json` at render time
  (`lib/overrides.ts`'s `mergeOverrides`), never mutating the seed file
  itself. Unmatched receipts are still logged (so nothing silently drops)
  but don't move any meter's number.

- The merged store lives in `data/overrides.json`, read fresh from disk on
  every request rather than cached in memory, since the ingest routes and
  the page that renders the card are separate server modules and only the
  file guarantees they agree. On a deploy with a read-only filesystem
  (Vercel's default), the file write silently no-ops and an in-memory
  fallback takes over for that one warm instance — same accepted
  limitation as the control-plane stub above, and the reason live IMAP
  itself isn't wired up here yet either.

- **UI**: in the expanded `TabCard` only (not the chip), a single small
  gray line — `MailSyncLine` — reads `{ at, count }` from the overrides
  metadata and shows something like `Last mail sync: Sep 8, 4:12 PM · 3
  receipts`. No admin panel, no per-receipt list in the UI; that's
  intentionally out of scope.

### Trying it from a phone-adjacent tool

Example curl, as if a Resend receipt email had just landed for the Vercel
meter (swap in the deployed URL and your `DECK_INGEST_KEY` once it's set):

```bash
curl -X POST https://deck.aiglitch.app/api/ingest/receipt \
  -H "Content-Type: application/json" \
  -H "x-deck-ingest-key: $DECK_INGEST_KEY" \
  -d '{
    "vendor": "Vercel Inc.",
    "amount": 59.00,
    "currency": "USD",
    "date": "2026-09-08",
    "subject": "Your receipt from Vercel Inc.",
    "source": "imap"
  }'
```

That's the same request shape a Vercel-side spike (or Resend's own inbound
webhook, if that ever gets wired in front of IMAP) could send. Locally,
drop the header and hit `http://localhost:3000/api/ingest/receipt` instead
— `DECK_INGEST_KEY` is unset in dev by default.

### The intended IMAP -> POST loop (not built here)

The actual "read `_PROJECTS` over IMAP" half doesn't exist in this repo —
by design, for now. The intended shape for whatever does it later (Grok
Bot, or a small cron script/Vercel Cron job):

1. Connect to iCloud IMAP (`imap.mail.me.com`) using an **app-specific
   password**, never the real Apple ID password.
2. Search `_PROJECTS` for new receipt-shaped mail (by sender, subject
   pattern, etc.) since the last run.
3. Parse out `vendor`, `amount`, `currency`, `date`, `subject` per message.
4. `POST` each one (or a batch) to `/api/ingest/receipt` /
   `/api/ingest/meters` with the `x-deck-ingest-key` header.
5. Track "since when" state on the mail-job side (e.g. last-seen UID/date)
   — this app's ingest store doesn't dedupe by message id, it just appends
   what it's given.

**Never commit an Apple app password** (or any real credential) to this
repo or to `data/overrides.json` — that file only ever holds
already-parsed receipt summaries (vendor/amount/date/subject), not mail
credentials. Store the app password as a secret on whatever runs the mail
job (a Vercel Cron job's environment variables, a small always-on box, a
GitHub Actions secret, etc.), not in `.env*` here (those are gitignored
already, but the job itself likely won't even live in this repo).

## Chip mode

The Tab loads as a small floating chip by default — a glanceable pill
showing the estimated burn, four tiny suit dots (lit up if that lane has
spend, pulsing if hot), and an ambient glow that scales with spend against
the leash goal, same as the full card. Tap the chip to expand into the full
`TabCard`; tap the circular chevron in its top-right corner (or press Esc)
to collapse back to the chip. The choice is persisted to `localStorage`
(`the-tab:view-mode`), defaulting to the chip on first load.

## Graph (v0 map)

Stuart wants ComfyUI-style graphs/nodes eventually, but mobile-first, not
tiny desktop spaghetti. This is the **first glanceable layer** of that: a
static map of how French Deck's sibling projects relate, not a real
node editor.

- Open it from the chip's small satellite button (the three-dot node icon
  next to the main pill) or, from the expanded `TabCard`, the node icon in
  the top-left corner. Either way it's a second surface — **the chip stays
  the default view**; closing the graph (the back arrow, or Esc) returns
  straight to the chip.
- **Nodes** are big tappable cards (Skidmarks, AIG!itch / aiglitch-api,
  Deck / The Tab itself, and a placeholder "+ project"), laid out as a
  single vertical stack — deliberately not a 2D canvas, so there's no
  pan/zoom/drag to fight with on a phone. **Edges** render as small labeled
  connectors directly beneath the node they originate from (e.g. Skidmarks
  → AIG!itch: *content*; both projects → Deck: *metering*).
- Tap a node for a detail sheet: its name, role, and — if it's mapped to a
  suit lane — that lane's **actual** dial (Full / Slow / Pause). It's the
  same control-plane dial the Tab's suit lanes use, not a copy, so pausing
  a lane from the graph pauses it everywhere. The Skidmarks → Make and
  AIG!itch → Models mappings in `data/graph.json` are v0 guesses, not
  confirmed integrations — swap them once those projects actually call
  `check()`/`report()`.
- Seed data lives in `data/graph.json` (nodes + edges, no backend). Tapping
  the Deck/Tab node's "Open full Tab" button jumps to the expanded
  `TabCard`.
- **Out of scope for v0**: real ComfyUI, live agent execution, dragging
  or freeform-positioning nodes, and IMAP. This is a map that gets you
  oriented in under two seconds, not a runtime — looping/agents come
  later, and the suit dials are still what actually leashes spend.

### Budju node (portfolio glance)

**Budju** (`budju.xyz/trade`) is the graph's **primary/featured node** —
it renders first, larger, and visually highlighted (violet gradient
border + a "Primary" badge), ahead of Skidmarks and AIG!itch. It's a
different kind of node from the others: not a spend meter, and not
mapped to a control-plane suit lane — it's a read-only glance at an
external crypto/USDC portfolio tracker.

- **Node face** (`components/BudjuNodeCard.tsx`) shows only: the pool
  total (`$9,725` seed, plus "N assets + cash"), the crypto/USDC split
  as a percentage pair + two-color bar (`86% crypto` / `14% USDC`), and
  up to a few small signal chips (e.g. `UNI · NEAR BUY`,
  `NEAR · COOLDOWN`).
- Tapping it opens **`components/BudjuDetailSheet.tsx`**, a detail sheet
  with the same three sections in full: a CSS conic-gradient "doughnut"
  with the pool total centered, the crypto/USDC split with dollar
  amounts, and a **Signals** list. Each signal card shows the asset,
  tier, quantity, price, change %, a buy/sell band (with a marker
  positioned between the buy and sell thresholds), and either an
  "X% to buy" callout (near-buy/near-sell) or a muted `(cooldown)` label
  with a one-line "recently triggered" note (cooldowns are shown, not
  hidden — Stuart wants them as a quiet status, not full noise). The
  sheet ends with a link out to `https://www.budju.xyz/trade`.
- **Signal types**: `near-buy`, `near-sell`, `cooldown` — see
  `BudjuSignalType` in `lib/types.ts`. Actionable signals (near-buy /
  near-sell) sort ahead of cooldowns (`sortSignals` in `lib/budju.ts`),
  but cooldowns still render.
- **Seed data** lives in `data/budju.json`, typed as `BudjuData` in
  `lib/types.ts` — `updatedAt: null` marks it as static seed data; a
  future live refresh (polling Budju) can populate `updatedAt` and swap
  in fresh `pool`/`split`/`signals` without changing any component.
- **Out of scope**, same as the rest of v0: wallet connect, trades, the
  full asset list, and any live websocket — this is a glance, not the
  trade UI.
- `orderedNodes` in `lib/graph.ts` sorts the `featured` node (Budju, via
  `GraphNode.featured` in `data/graph.json`) first within the `project`
  rank; `GraphView` special-cases `BUDJU_NODE_ID` (`lib/constants.ts`) to
  render `BudjuNodeCard`/`BudjuDetailSheet` instead of the generic
  `GraphNodeCard`/`GraphNodeSheet`.

### Propfolio node (status glance)

**Propfolio** (`propfolio.work`,
[github.com/comfybear71/propfolio](https://github.com/comfybear71/propfolio))
is an Australian property portfolio tracker — a private web app, not a
Deck-owned lane. It sits right after Budju in the node stack. This node is
a **health/error status glance**, the first "show if there's an error"
node in the graph: no login form, no property CRUD, no live probe of the
real app (yet).

- **Node face** (`components/PropfolioNodeCard.tsx`) shows only: the name,
  a client-count / property-count pair (renders as an em dash, "—", for
  the TBD-until-live-data placeholder), and a big status chip — green
  `OK`, red `ERROR`, or grey `UNKNOWN`. When the status is `error` the
  whole card gets a red ring/glow and a small pulsing red dot, plus the
  short error blurb (e.g. "Login issue (owner) — site reachable"),
  so the problem is visible without opening the sheet.
- Tapping it opens **`components/PropfolioDetailSheet.tsx`**: the same
  status chip, the error message (with a note that the site loads
  normally for real users and this is a sign-in issue, not an outage —
  see below), a "last checked" line, the client/property count rollup
  plus a one-line `summary`, a **Properties** list (a stub — an empty
  array renders as "no property data yet," not an error), a note that
  fixing the bug happens from Deck/Cursor separately (not from this
  sheet), and two links: **Open app** (`data.url`, hidden behind a
  "not set yet (TODO)" placeholder if `url` is ever empty) and
  **Open repo**.
- **Health status seed**: `propfolio.work` loads normally for real users
  (Google sign-in, email/password, "Sign in with Email" all render) —
  the only confirmed issue is an **owner-reported sign-in bug**, not a
  site outage. (Any 403s seen from automated/datacenter clients are
  Vercel's bot mitigation kicking in on non-browser traffic — unrelated
  to the real login bug, and not what this node's `error` status means.)
  `status: "error"` is set because there's a real, owner-confirmed sign-in
  bug to track; the `errorMessage` deliberately avoids implying an outage.
- **Data shape**: `PropfolioData` in `lib/types.ts` — `repoUrl`, `url`,
  `status` (`HealthStatus`: `"ok" | "error" | "unknown"`), `errorMessage`
  (`string | null`), `lastCheckedAt` (`string | null`, ISO — `null` marks
  static seed data, same convention as Budju's `updatedAt`), `clientCount`
  / `propertyCount` (`number | null` — `null` is the TBD placeholder until
  real data lands, not an error), `summary` (one-liner rollup, e.g.
  "12 properties across 4 clients"), and `properties`
  (`PropfolioProperty[]`, each `{ id, address?, status?, clientName? }` —
  seeded as `[]`). All of it lives in `data/propfolio.json` so a future
  health-check probe or a Propfolio data sync can flip these fields
  without any component changing.
- **`app/api/health/propfolio`** is a GET stub that just returns
  `data/propfolio.json`. It exists as the seam for a real live probe
  (out of scope for this PR — no HTTP check against the real app runs
  from Vercel yet); swapping the static read for a real fetch later
  doesn't need to change the response shape.
- Not mapped to a control-plane suit lane, and not `featured` — it sorts
  right after Budju in `data/graph.json`'s node order (see `orderedNodes`
  in `lib/graph.ts`). `GraphView` special-cases `PROPFOLIO_NODE_ID`
  (`lib/constants.ts`) to render `PropfolioNodeCard`/`PropfolioDetailSheet`
  instead of the generic `GraphNodeCard`/`GraphNodeSheet`.
- **Out of scope**: actually fixing the Propfolio login bug (that's a
  separate repo/PR), and a live HTTP probe from Vercel against the real
  app.

## The four lanes

- ♦ **Models** — xAI API, Claude (sub + usage), Cursor Pro, DeepSeek,
  SuperGrok
- ♠ **Infra** — Vercel, Neon, Resend, ImprovMX, MongoDB
- ♥ **Make** — Comfy, ElevenLabs, Suno, Siray, Odds API
- ♣ **Life** — iCloud+, X Premium, Meta/Facebook (est.)

The big number sums every USD-denominated, active meter. Claude's AUD usage
meter is shown as a separate subline and is never silently converted.
Closed (DigitalOcean) and TBD (MongoDB) meters are listed in their lane's
sheet but excluded from totals. The soft monthly leash goal is **$400 USD**
(`LEASH_GOAL_USD` in `lib/constants.ts`) — the ambient glow behind the big
number scales with spend against that goal.

## Local dev

```bash
npm install
npm run dev
```

## Deploy notes

- Branch: `master`.
- Vercel should auto-detect Next.js now that `next`, `react`, and
  `react-dom` are real `dependencies` in the root `package.json` (this repo
  previously had no app at the root, which is why the build failed with
  "No Next.js version detected").
- Intended domain: `deck.aiglitch.app`.
- `DECK_INGEST_KEY` (optional) — shared secret the `/api/ingest/*` routes
  check for. Not required to run the app; leaving it unset just means
  those routes are unauthenticated (fine for local dev, not recommended
  once a real mail job is pointed at a public deploy). Set it as a Vercel
  environment variable, never commit it.
- No other environment variables are required — the rest is static seed
  data plus whatever's been ingested into `data/overrides.json`.
