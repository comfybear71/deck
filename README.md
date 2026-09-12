# The Tab — French Deck

A glanceable cost scoreboard pinned to the top of Deck — the same map of
French Deck's sibling projects (Budju, Propfolio, Skidmarks, AIG!itch).
The goal is to understand recent burn in under two seconds, then tap
straight into a real deep dive when something looks off — not a finance
admin panel, no sidebar, no separate page to navigate to for the running
total.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS, at the repo root.
- No auth on the UI, no live billing APIs. Cost data is seed data plus
  whatever's been ingested via the mail bridge described below — the only
  backends are the small `/api/control-plane/*` stub and the
  `/api/ingest/*` mail bridge, neither of which bill anything.

## What's here

- `data/meters.json` — seed cost meters (id, name, suit, amount, currency,
  cadence, mode, notes, optional alert, optional `history` of dated real
  charges). See "Running costs (header + deep dive)" below.
- `data/overrides.json` — local store the mail ingest bridge writes to;
  amount overrides merged on top of the seed meters, and matched receipts
  feed the windowed burn too. See "Mail -> Tab" below.
- `lib/meters.ts` — pure helpers (lane/burn sums, money formatting, glow
  intensity vs. the leash goal). `totalBurnUSD`/`totalBurnAUD` here are the
  old *unwindowed* sums — still used by nothing in the UI anymore, but kept
  since `lib/spend-window.ts` builds on `isCountable` from this module.
- `lib/spend-window.ts` — **the windowed burn engine.** Turns each meter's
  flat `amount` + optional `history` (plus ingested mail receipts) into an
  honest "last 7 or 30 days" figure, with a fully documented rule at the
  top of the file. See "Running costs (header + deep dive)" below.
- `hooks/useSpendWindow.ts` — which window (7 or 30 days) the cost deep
  dive is showing, persisted to `localStorage`. Defaults to 30 days.
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
- `data/graph.json` / `lib/graph.ts` — the v0 project graph's seed data and
  pure helpers. See "Graph (Deck's home surface)" below.
- `data/budju.json` / `lib/budju.ts` — Budju portfolio glance seed data and
  pure helpers (signal sort/format, buy/sell band position). See "Budju
  node (portfolio glance)" below.
- `data/propfolio.json` / `lib/propfolio.ts` — Propfolio health-status
  seed data and pure helpers (per-status chip/accent metadata,
  count/timestamp formatting). See "Propfolio node (status glance)"
  below.
- `app/api/health/propfolio/` — a GET stub that returns
  `data/propfolio.json` as-is; the seam for a future real health probe.
- `data/deck-asks.json` / `lib/deck-ask.ts` / `lib/deck-ask-server.ts` /
  `lib/deck-ask-client.ts` — the Ask-Grok bridge (shared types + prompt
  builder, the server-side store, and the client-side POST helper). See
  "Ask Grok (v0 stub)" below.
- `lib/skidmarks.ts` / `hooks/useSkidmarksStudio.ts` — the Skidmarks
  Music-video studio model (bands/members/looks/MP3/checklist) and its
  `localStorage` store (pure mock builders, `useSyncExternalStore` React
  binding, staged checklist timers). See "Skidmarks node (vibe director)"
  below.
- `app/api/deck/ask/` — the `POST`/`GET` route backing Ask Grok.
- `lib/clipboard.ts` — shared "copy to clipboard, with a manual-selection
  fallback" helper used by the action chips and Ask Grok's copy-prompt
  button.
- `components/` — `GraphView` (Deck's one continuous home surface —
  header + node map, see below), `CostHeader` (the running-cost header
  pinned to the top of `GraphView`), `CostDetailSheet` (the deep-dive sheet
  the header opens: window toggle, `BigBurn`, `AlertsStrip`, `BurnGraph`,
  `VendorTable`, `MailSyncLine`, `ControlPlaneDemo`), `BurnGraph` (the
  compact bar chart of burn over the selected window), `VendorTable` (the
  per-lane, per-vendor compact table with tap-to-expand rows and the suit
  dials), `DialControl`, `GraphNodeCard` / `GraphNodeSheet` (the generic
  graph nodes — Same Game Multi has no dedicated card/sheet pair, it's a
  light stub covered by these — see "Same Game Multi node" below),
  `BudjuNodeCard` / `BudjuDetailSheet` (the featured Budju node's face +
  detail sheet), `PropfolioNodeCard` / `PropfolioDetailSheet` (the
  Propfolio status node's face + detail sheet), `SkidmarksNodeCard` /
  `SkidmarksDetailSheet` (plus `SkidmarksLandingTiles` /
  `SkidmarksBandPicker` / `SkidmarksMembersModule` / `SkidmarksGeneratePopup`
  / `SkidmarksMp3Card` / `SkidmarksChecklistChips`) — the Skidmarks
  vibe-director node's face and its locked, one-scroll Music-video flow
  through the MP3 step — see "Skidmarks node (vibe director)" below),
  `ActionChips` /
  `AskGrokPanel` (generic detail-sheet primitives — see "Ask Grok (v0
  stub)" below).

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
  bottom of the cost deep-dive sheet (`CostDetailSheet`). Each suit has a
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

- **UI**: in the cost deep-dive sheet only (not the header), a single small
  gray line — `MailSyncLine` — reads `{ at, count }` from the overrides
  metadata and shows something like `Last mail sync: Sep 8, 4:12 PM · 3
  receipts`. No admin panel, no per-receipt list in the UI; that's
  intentionally out of scope. A matched receipt also becomes a real charge
  for that meter's windowed burn the moment it lands — see "Running costs
  (header + deep dive)" above.

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

## Running costs (header + deep dive)

Stuart's ask: the running-cost meter should be a **header pinned to the
top of the main Deck surface** — not a separate page/node you navigate
away to, and not a lifetime-since-day-one number with no sense of "recent."
This replaces the old chip/expanded-card/graph three-way mode switch with
**one continuous surface**: `GraphView` renders `CostHeader` at the top,
then the project node map below it, in the same scroll. Tapping the header
opens `CostDetailSheet` — a bottom sheet overlay, the same pattern
`BudjuDetailSheet`/`PropfolioDetailSheet` already use, not a different page.

- **The window**: 7 or 30 days, ending today — never "since the beginning."
  Defaults to 30 days (`DEFAULT_WINDOW_DAYS` in `lib/spend-window.ts`);
  toggled in `CostDetailSheet`, persisted to `localStorage`
  (`the-tab:spend-window` via `hooks/useSpendWindow.ts`). Both the header
  and the sheet always show which window is active ("Last 30 days") — see
  `windowLabel()`.
- **The documented recompute rule** (`lib/spend-window.ts`'s module doc has
  the full version): for each meter, (1) if a real, dated charge — seed
  `history` or an ingested mail receipt matched to that meter — falls in
  the window, use the sum of exactly those charges ("actual"); (2) else,
  if the meter is a recurring `monthly` subscription, prorate its `amount`
  across the window (`amount / 30 * windowDays`, labelled "Est." in the
  UI); (3) else (a `balance`/`one-time`/`unknown`-cadence meter with no
  observed charge, e.g. DeepSeek's prepaid balance sitting untouched) it
  contributes $0 — a balance is not recurring spend, so it's never
  prorated. This is why the total changed from a flat, unwindowed
  "$930.32 forever" to a real "$934.89 over the last 30 days" /
  "$377.88 over the last 7 days": DeepSeek's full prepaid balance no
  longer counts as if it were spent, Comfy's two real charges ($38.50 +
  $31.20) replace the flat $35 guess, and Vercel's two real charges ($195,
  $59) only count for the days they actually land in.
- **Seed "invoice reality"**: some meters in `data/meters.json` now carry
  a `history` array of dated real charges (`{ daysAgo, amount, currency,
  note }` — relative-to-now offsets, not absolute dates, so seed data
  doesn't age out of every window a week after it's written). Vercel (two
  charges demonstrating the "still stacking" alert), Comfy (two charges
  demonstrating it isn't a flat $35), xAI (last month's real invoice,
  outside a 7-day window — the 7d view honestly falls back to a prorated
  estimate for it), Claude Usage (AUD), and DeepSeek (small usage draws
  against the prepaid balance) all have one. Everything else is a plain
  recurring subscription with no known per-charge variability, so it just
  prorates. **Mail-ingested receipts feed the same rule** — a receipt
  POSTed to `/api/ingest/receipt` with a `meterId` becomes a real charge
  for that meter's window computation the moment it lands, same as a seed
  `history` entry; the ingest path itself (routes, auth, merge) is
  unchanged, see "Mail -> Tab" below.
- **`CostHeader`** (`components/CostHeader.tsx`) — the header itself:
  window-scoped total, AUD subline, suit dots, alert badge. Tapping it
  opens the deep dive.
- **`CostDetailSheet`** (`components/CostDetailSheet.tsx`) — the deep dive:
  the 7d/30d toggle, `BigBurn` (now window-aware — the $400 leash goal is
  prorated to the same window so "over/under goal" still means something
  at 7 days), `AlertsStrip`, `BurnGraph`, `VendorTable`,
  `MailSyncLine`, and `ControlPlaneDemo` — everything that used to live in
  the old standalone `TabCard` screen now lives in this sheet instead.
- **`BurnGraph`** (`components/BurnGraph.tsx`) — a compact bar chart of the
  window's spend, bucketed daily for a 7-day window (7 bars) or weekly for
  a 30-day window (~5 bars) via `buildBurnSeries` — deliberately not one
  bar per day for 30 days; "compact," not endless.
- **`VendorTable`** (`components/VendorTable.tsx`) — one compact row per
  vendor (not one row per invoice line), grouped by suit lane with that
  lane's real dial (Full/Slow/Pause, same control-plane dial as
  everywhere else) in the group header. Each row shows the window amount
  and an "Actual"/"Est." badge; **tapping a row expands it in place** to
  show the meter's notes/alert and its real charge list (with dates), or
  an explanation when there's no charge in this window (prorated estimate,
  or "prepaid balance, no draw recorded"). This is the "click to see
  spend" + "compact table, not endless rows" Stuart asked for.
- **Removed the duplicate "Running Costs" graph node.** The old `GraphView`
  had a `"tab"` hub node ("Deck / The Tab") that, when tapped, opened the
  exact same running-cost view the chip already opened — a second,
  separate path to the same information. Since the header above now
  covers that job inline on the same surface, `GraphView` filters
  `kind: "hub"` nodes out of what it renders (`orderedNodes(graph).filter
  ((n) => n.kind !== "hub")`); the node stays in `data/graph.json` purely
  so the two `"metering"` edges from Skidmarks/AIG!itch still resolve a
  label to point at, but it's not a tappable card anymore.

## Graph (Deck's home surface)

Stuart wants ComfyUI-style graphs/nodes eventually, but mobile-first, not
tiny desktop spaghetti. This is the **first glanceable layer** of that: a
map of how French Deck's sibling projects relate, not a real node editor —
still true on both surfaces below. It's also Deck's main/only surface now
(see "Running costs" above) — not a second page you navigate to.

- **Nodes**: Budju (primary/featured), Propfolio, Same Game Multi,
  Skidmarks, AIG!itch / aiglitch-api, and a placeholder "+ project". Tap
  any node for a detail sheet: its name, role, and — if it's mapped to a
  suit lane — that lane's **actual** dial (Full / Slow / Pause). It's the
  same control-plane dial the vendor table's lane groups use, not a copy,
  so pausing a lane from the graph pauses it everywhere. The Skidmarks →
  Make and AIG!itch → Models mappings in `data/graph.json` are v0 guesses,
  not confirmed integrations — swap them once those projects actually call
  `check()`/`report()`. Seed data lives in `data/graph.json` (nodes +
  edges, no backend). Deck / The Tab itself is documented in
  `data/graph.json` as a metering target but is no longer rendered as its
  own tappable card here — see "Running costs (header + deep dive)" above
  for that surface.
- **Below ~768px (phone): the stacked list.** Nodes render as a single
  vertical stack of big tappable cards — no pan/zoom/drag to fight with on
  a phone. Edges render as small labeled connectors directly beneath the
  node they originate from (e.g. Skidmarks → AIG!itch: *content*; both
  projects → Deck: *metering*). `Budju`/`Propfolio`/`Same Game Multi`
  currently have no edges in `data/graph.json`, so none of them renders a
  connector — they're separate entities, not wired to anything.
- **At ~768px+ (`GraphView` → `GraphBoard`, `hooks/useIsLargeScreen.ts`):
  a freestyle, ComfyUI-flavored board.** Same nodes, same tap-to-open
  detail sheets, but laid out on an absolute-position canvas instead of a
  stack — drag any node to reposition it. Positions are percentages of the
  canvas (survive iPad portrait/landscape rotation) persisted to
  `localStorage` (`the-tab:graph-positions`, via `lib/graphLayout.ts` +
  `hooks/useGraphBoardPositions.ts`) — a "Reset layout" button clears back
  to the seeded spread in `DEFAULT_BOARD_POSITIONS`. Drag uses Pointer
  Events with a small movement threshold (`components/GraphBoardNode.tsx`)
  so a tap still opens the detail sheet instead of fighting the drag
  handler — this is the part that needs real testing on iPad Safari, not
  just a mouse in devtools' responsive mode. Edges still don't get wires
  drawn between nodes here either — a node with outgoing edges (Skidmarks,
  AIG!itch) just gets its existing edge labels rendered as a small
  non-interactive chip row under the card, same information as the list
  view's connectors, no line-drawing. Budju, Propfolio, and Same Game
  Multi have no edges in `data/graph.json`, so they render with no chips —
  unwired, as intended.
- **Node identity accents**: Budju, Propfolio, and Same Game Multi each
  get their own distinctive border/glow treatment instead of the generic
  `GraphNodeCard` look, so they read as individual entities rather than
  interchangeable project cards — violet/sky for Budju (hard-coded in
  `BudjuNodeCard`), emerald/teal for Propfolio (`identityAccent` in
  `lib/propfolio.ts`, tied to the OK-green chip color without reading as
  an error badge), and amber/gold for Same Game Multi
  (`GRAPH_NODE_ACCENTS.sgm` in `lib/constants.ts`, applied via
  `GraphNode.accentId`). Skidmarks / AIG!itch / Deck-The-Tab keep the
  generic look. See the "Same Game Multi node" section below.
- **Out of scope for v0**: real ComfyUI, live agent execution, wires you
  can draw/rewire between nodes, pan/zoom, and IMAP. This is a map that
  gets you oriented in under a few seconds, not a runtime — looping/agents
  come later, and the suit dials are still what actually leashes spend.

### Budju node (portfolio glance)

**Budju** (`budju.xyz/trade`) is the graph's **primary/featured node** —
it renders first, larger, and visually highlighted (violet gradient
border + a "Primary" badge), ahead of Skidmarks and AIG!itch. It's a
different kind of node from the others: not a spend meter, and not
mapped to a control-plane suit lane — it's a read-only glance at an
external crypto/USDC portfolio tracker.

- **Node face** (`components/BudjuNodeCard.tsx`) shows only: the pool
  total, the crypto/USDC split as a percentage pair + two-color bar
  (`90% crypto` / `10% USDC`), and up to a few small signal chips (e.g.
  `UNI · NEAR BUY`, `NEAR · COOLDOWN`).
- Tapping it opens **`components/BudjuDetailSheet.tsx`**, a detail sheet
  with the same three sections in full: a CSS conic-gradient "doughnut"
  with the pool total centered, the crypto/USDC split with dollar
  amounts, and a **Signals** list. Each signal card shows the asset,
  tier, quantity, price, change %, a buy/sell band (with a marker
  positioned between the buy and sell thresholds), and either an
  "X% to buy" callout (near-buy/near-sell) or a muted `(cooldown)` label
  with a one-line "recently triggered" note (cooldowns are shown, not
  hidden — Stuart wants them as a quiet status, not full noise). Below
  the signals, a **Refresh** chip re-pulls live data on demand, and the
  sheet ends with a link out to `https://www.budju.xyz/trade`.
- **Signal types**: `near-buy`, `near-sell`, `cooldown` — see
  `BudjuSignalType` in `lib/types.ts`. Actionable signals (near-buy /
  near-sell) sort ahead of cooldowns (`sortSignals` in `lib/budju.ts`),
  but cooldowns still render.
- **Live pull, no wallet** (`lib/budju-live.ts` + `GET /api/budju/live`):
  `GraphView` fetches this route once on mount and swaps the seed
  snapshot for a live one as soon as it resolves; `BudjuDetailSheet`'s
  **Refresh** chip calls the same route on demand. The route calls two
  endpoints Budju's own `/trade` page already calls **unauthenticated**
  from the browser — `POST www.budju.xyz/api/proxy` (`/portfolio/` for
  Swyftx balances, `/prices/` for CoinGecko USD prices, both proxied
  server-side by Budju itself) and `GET www.budju.xyz/api/state` (tier
  config, coin assignments, cooldowns, live buy/sell targets) — Budju's
  own `tradeApi.ts` literally comments `fetchTraderState()` as "public"
  and its dashboard hook as "Load data (all public — no wallet
  needed)". So despite the initial hypothesis that live numbers would
  need auth, they don't: this is a live pull, not an ingest bridge.
  `buildBudjuData()` (pure, in `lib/budju-live.ts`) turns that into pool
  total, crypto/USDC split, and a capped set of near-buy/near-sell/
  cooldown signals (5 actionable + 3 cooldown slots, so a broad market
  dip can't crowd cooldowns out of the list entirely) — same `BudjuData`
  shape as the seed, no schema changes. Any failure (Budju down, a
  network hiccup, `SWYFTX_API_KEY` misconfigured on Budju's own side) is
  swallowed and the caller keeps showing the seed snapshot; the glance
  never shows an error state for this.
- **Seed data** lives in `data/budju.json`, typed as `BudjuData` in
  `lib/types.ts` — refreshed to match Stuart's real numbers as of this
  writing (pool ~$9,4xx, 90/10 split, 26 assets), and it's what renders
  for the brief window before the live pull resolves, or if it fails.
  `updatedAt: null` marks it as static seed data; once a live pull
  succeeds, `updatedAt` gets a real timestamp and `BudjuDetailSheet`'s
  footer swaps "Seed data — live refresh from Budju isn't wired up
  yet." for "Last refreshed \<time\>." — same seam as before, just wired
  up now instead of stubbed.
- **Out of scope**, same as the rest of v0: wallet connect, trades, the
  full asset list, and any live websocket — this is a glance, not the
  trade UI.
- `orderedNodes` in `lib/graph.ts` sorts the `featured` node (Budju, via
  `GraphNode.featured` in `data/graph.json`) first within the `project`
  rank; `GraphView` special-cases `BUDJU_NODE_ID` (`lib/constants.ts`) to
  render `BudjuNodeCard`/`BudjuDetailSheet` instead of the generic
  `GraphNodeCard`/`GraphNodeSheet`.
- **Fragility worth flagging to Stuart**: this depends on two
  undocumented, unauthenticated endpoints on `budju.xyz` staying shaped
  the way they are today (verified live while building this — see the
  PR). If Budju's own team changes `/api/state`'s shape, moves off
  Swyftx, or starts requiring auth on `/api/proxy`, this live pull just
  quietly stops updating and Deck falls back to whatever seed snapshot
  is on disk — nothing breaks loudly, but nothing pushes updates either.
  If that ever happens, `COINGECKO_IDS` in `lib/budju-live.ts` (copied
  from Budju's own `ASSET_CONFIG`) is also a maintenance seam: a newly
  traded coin without an entry there just prices at $0 and drops out of
  the crypto total instead of erroring.

### Propfolio node (status glance)

**Propfolio** (`propfolio.work`,
[github.com/comfybear71/propfolio](https://github.com/comfybear71/propfolio))
is an Australian property portfolio tracker — a private web app, not a
Deck-owned lane. It sits right after Budju in the node stack. This node is
a **health-status glance**, the first "show if there's an error" node in
the graph: no login form, no property CRUD, no live probe of the real app
(yet).

- **Node face** (`components/PropfolioNodeCard.tsx`) shows only: the name,
  a client-count / property-count pair (renders as an em dash, "—", for
  the TBD-until-live-data placeholder), and a big status chip — green
  `OK`, amber `DEGRADED`, red `ERROR`, or grey `UNKNOWN`. Statuses flagged
  `attention` in `HEALTH_META` (`lib/propfolio.ts`) — `degraded` and
  `error` — get the whole card a colored ring/glow and a small pulsing
  corner dot. Independent of that alerting, `ok`/`unknown` now render with
  their own **identity accent** — an emerald/teal border + soft glow
  (`identityAccent` in `lib/propfolio.ts`), Budju-style, so Propfolio
  reads as its own entity rather than a generic project card even when
  there's nothing to flag. It deliberately ties to the existing OK-green
  chip color instead of introducing a new hue, and steps aside for the
  amber/rose `degraded`/`error` accents when there's an actual problem to
  call out. Whenever `statusNote` is set
  (any status, not just `error`) it shows as a short line under the
  counts, e.g. "French household · Bagshaw Cres" — so a specific note is
  visible without opening the sheet, not just a binary up/down. On the
  healthy path this should read like calm product copy (who/where), not
  health-check chrome — no "Login OK", "onboarded", or "seed" language.
- Tapping it opens **`components/PropfolioDetailSheet.tsx`**: the same
  status chip, the `statusNote` (if set) in a callout tinted to match the
  status, the client/property count rollup plus a one-line `summary`, a
  **Properties** list (a stub — an empty array renders as "no property
  data yet," not an error), and two links: **Open app** (`data.url`,
  hidden behind a "not set yet (TODO)" placeholder if `url` is ever empty)
  and **Open repo**.
- **Healthy vs. non-healthy chrome**: when `status` is `"ok"`, the sheet
  shows a calm summary only — status chip, note, counts, properties,
  **Open Propfolio**, and Ask Grok. The "Health status" label, the
  "never checked — seed status only" line, the **Refresh health** /
  **Copy status** chips (see "Ask Grok + action chips" below), and the
  "fixing this happens from Deck/Cursor separately" footnote only render
  when `status` is `"degraded"`, `"error"`, or `"unknown"` — Stuart's
  call: a working app shouldn't show the tools for checking whether it's
  working (`isHealthy` in `PropfolioDetailSheet.tsx`).
- **Health status has moved around during this feature's own build-out**
  — which is exactly the scenario this node exists to surface: an
  owner-reported sign-in bug, a 403 report from an automated check, then
  confirmation that Google sign-in works, then a payslip-OCR onboarding
  blocker, and now (current seed) confirmation that household onboarding
  is complete — `status: "ok"`, `clientCount`/`propertyCount` at `2` for
  Stuart's household (2 properties on Bagshaw Crescent, Gray NT).
  `lastCheckedAt` stays `null` — this is still seed data updated by hand,
  not a single confirmed-timestamp live probe.
- **Data shape**: `PropfolioData` in `lib/types.ts` — `repoUrl`, `url`,
  `status` (`HealthStatus`: `"ok" | "degraded" | "error" | "unknown"`),
  `statusNote` (`string | null` — a one-liner for *any* status, not just
  `error`), `lastCheckedAt` (`string | null`, ISO — `null` marks static
  seed data, same convention as Budju's `updatedAt`), `clientCount` /
  `propertyCount` (`number | null` — `null` is the TBD placeholder until
  real data lands; `0` is a real "confirmed empty" reading), `summary`
  (one-liner rollup, e.g. "12 properties across 4 clients"), and
  `properties` (`PropfolioProperty[]`, each
  `{ id, address?, status?, clientName? }` — seeded as `[]`). All of it
  lives in `data/propfolio.json` so a future health-check probe or a
  Propfolio data sync can flip these fields without any component
  changing.
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
- **Out of scope**: actually resolving anything found on the Propfolio
  side (that's a separate repo/PR), and a live HTTP probe from Vercel
  against the real app.

### Same Game Multi node (placeholder stub)

**Same Game Multi** ("SGM") is an Aussie sports-betting SGM
product/project placeholder for Stuart — no live app, no repo, no real
URL yet. Like Budju and Propfolio, it's a **separate entity**: no edges
in `data/graph.json`, so it's not wired to Skidmarks, AIG!itch, or The
Tab, and it's not mapped to a control-plane suit lane. Unlike Budju and
Propfolio, it doesn't get its own `SGMNodeCard`/`SGMDetailSheet` pair —
it's light enough that a few small, generic additions to
`GraphNodeCard`/`GraphNodeSheet` cover it:

- **`GraphNode` gained four optional fields** (`lib/types.ts`):
  `subtitle` (a badge line overriding the generic `KIND_LABEL`, e.g.
  `"Project · Betting"`), `url` (only ever rendered as an "Open" link
  when a node actually has a real one — never fabricated), `askGrok`
  (opt-in generic `AskGrokPanel`), and `accentId` (a key into
  `GRAPH_NODE_ACCENTS` for the identity border/glow — see the "Node
  identity accents" note above). All four are `undefined` for every
  existing node except SGM, so Skidmarks / AIG!itch / Deck-The-Tab render
  exactly as before.
- **Node face**: same `GraphNodeCard` every non-special node uses, just
  with `subtitle: "Project · Betting"` and the amber/gold
  `GRAPH_NODE_ACCENTS.sgm` treatment instead of the generic look.
- **Detail sheet**: same `GraphNodeSheet` every non-special node uses —
  title, the `role` blurb ("Same Game Multi — deck node; automation
  later…"), and (new, opt-in) an **Ask Grok** panel
  (`project: "sgm"`) since that pattern is already generic/shared. No
  "Open" link renders, since `data/graph.json`'s `sgm` node has no `url`
  set — nothing invented.
- **Seed data** is just the one node object in `data/graph.json` — no
  `data/sgm.json`, no API route, no live odds feed of any kind. If/when
  there's a real SGM app or repo, add `url` (and a `repoUrl`-style link if
  needed) and it'll pick up the "Open" link automatically; a real
  automation surface is a separate, later PR.
- Board default position lives in `DEFAULT_BOARD_POSITIONS`
  (`lib/graphLayout.ts`), next to Skidmarks in the second row — see the
  "GraphBoard default layout" note there before changing the grid.

### Skidmarks node (vibe director)

**Skidmarks** is a sibling project that eventually does real music-video
direction (Comfy MCP, Seedance, LTX, ElevenLabs, and friends, plus its own
`skidmarks.aiglitch.app` Crash Lab). This node is deliberately **not**
that — it's a **front hand for that convoluted backend**. This build
replaces the earlier free-text "type a vibe brief, get a scripted
director-chat thread" version with Stuart's **locked Music-video flow**:
a concrete, appended-step wizard (pick a project type → choose a band →
cast its members → attach an MP3) rendered as **one continuous scroll**,
never a chat thread and never a separate screen. It's locked through the
MP3 step only — plates, multi-angle coverage, voice, animate, and stitch
are explicitly out of scope for now (see "Explicitly out of scope" below).

- **Node face** (`components/SkidmarksNodeCard.tsx`) — the same warm
  rose/pink identity treatment as before (border, gradient wash, glow, ♥
  avatar) instead of the generic `GraphNodeCard`. Shows "No project yet —
  tap to start directing" until the flow's been touched, then a terse
  one-line glance from `skidmarksGlance` (`lib/skidmarks.ts`): "Choosing a
  band…", "Directing · \<band name\>", or "\<band name\> · ready" once
  every MP3 checklist item has ticked.
- Tapping it opens **`components/SkidmarksDetailSheet.tsx`**, which
  appends each step's section directly underneath the previous one in one
  scrollable sheet:
  1. **Landing** — `SkidmarksLandingTiles`: a "Start a project" row of
     three compact tiles, **Music video · Skidmarks · Sunnybank**
     (`SKIDMARKS_PROJECT_KINDS` in `lib/skidmarks.ts`). Only **Music
     video** is wired (`enabled: true`); the other two render for visual
     completeness per the locked mockup but are inert (disabled, dimmed,
     `title="Coming soon"`) — this build doesn't implement either of
     those flows.
  2. **Choose a band** — tapping Music video appends `SkidmarksBandPicker`:
     a horizontal scroll of square **album-cover** tiles (never member
     faces, per the locked mockup's product rule) — "New" (+) first, then
     every known band. Two are hand-seeded (`SEED_BANDS`): **Jack Ash**
     ("Dirt roads & bad decisions") and **Solar Rebel** ("Ignite the
     static"). Each existing band's tile (never the "New" tile) has two
     small corner glyphs: a pencil/camera "edit cover" glyph (top-right)
     that opens a **real native file picker**
     (`accept=".jpg,.jpeg,.png,.webp"` — jpg/png/webp only) — once a
     file's picked, `readImageFileAsDataUrl` downscales it (longest edge
     capped at 640px, re-encoded as a JPEG data URL — keeps a phone photo
     from blowing past `localStorage`'s quota) and
     `setSkidmarksBandCoverImage` stores it on the band; the tile then
     renders that real photo (`coverImage`) instead of the mock gradient,
     with the name/tagline sitting in a **thin bottom scrim only** so the
     middle of the picked photo stays visible — and a trash "remove band"
     glyph (top-left) that deletes the band outright via
     `removeSkidmarksBand`. Deleting one of the two
     hand-seeded bands records its id in `removedSeedBandIds` so it stays
     gone on the next load instead of being re-minted from `SEED_BANDS`;
     deleting the active band resets the session (`bandId`/`mp3`) back to
     before a band was chosen. A band with no picked cover still falls
     back to the CSS gradient stand-in (`coverGradientClass`, keyed off
     `coverSeed`) — there's no server upload here, the data URL just
     lives in this browser's `localStorage`.
  3. **Members module** — selecting a band (or tapping "New", which mints
     the locked mockup's exact example band via `buildNewMockBand`: *Grok
     Bot & the destroyers*, with Rock Grok — role "Solo", one look already
     generated — and Stew Balls, no look yet) appends
     `SkidmarksMembersModule`: one shared pink-bordered box with the band
     name once at top, then a row per member (left: avatar — a real
     picked photo if one's set, else a look thumbnail if one's been
     generated, else a dashed placeholder ring; right: name + optional
     role, plus a trash/× **remove** control that deletes that member
     from the band outright). Tapping a member's row opens the
     generate/rename popup. The avatar itself has a tiny camera badge in
     its corner — same real file picker + `readImageFileAsDataUrl`
     downscale as the band cover, via `setSkidmarksMemberAvatarImage` —
     so a real photo can be attached directly, without going through the
     generate popup at all; a picked `avatarImage` always wins over a
     generated look. A **"+ Add member"** pill sits *outside* the box,
     under-right — never inside it — and appends a completely **blank**
     member (`buildBlankMember`: no name, no role, no emoji, no photo —
     nothing invented) up to `MAX_MEMBERS_PER_BAND` (3); a blank row
     shows dimmed "New member" placeholder text until it's named, given
     a real photo, or given a first generated look.
  4. **Generate popup** (`SkidmarksGeneratePopup`) — a simple centered
     modal, no side chrome: that member's generated "looks" so far scroll
     horizontally across the top (three empty dashed slots before the
     first generate, real look swatches after), then a **Name** field
     (this is how a blank member gets a real name — commits on blur,
     Cancel/X/Escape, and right before Generate), a prompt textarea, a
     **Photoreal 60–100%** slider (default 80%), and Generate/Cancel.
     Generate has a short (700ms) fake "rendering" delay before
     `buildMockLook` mints a deterministic color-swatch stand-in
     (`lookGradientClass`, keyed off a random seed) — there is no real
     image model call here.
  5. **MP3 audio** — appended right alongside the members module (same
     width/left-right alignment as its bordered box): `SkidmarksMp3Card`.
     Before anything's attached, a dashed "Attach MP3" box with a real
     native file picker (`accept=".mp3,audio/mpeg"` — **no music is ever
     created here**, only an existing file attached). Once a file's
     picked: a real `<audio>` element (via `URL.createObjectURL`, session-
     only — a `File` can't round-trip through `localStorage`, so a page
     reload loses playback, though the filename/duration/checklist
     metadata persists) drives a real play/pause and a real probed
     duration; the waveform itself is decorative (`waveformBars`,
     deterministic off the filename — no real audio analysis).
  6. **Checklist chips** (`SkidmarksChecklistChips`) — three always-
     present, equal-width chips under the MP3 card: **Lyrics · Timing ·
     Ready**. All start grey/pending; attaching a file kicks off staged
     timers (`SKIDMARKS_CHECKLIST_DELAY_MS` in `lib/skidmarks.ts` —
     Timing fastest, then Lyrics, then Ready once both are in) that flip
     each to green, simulating a background "sniff" (lyrics reading as a
     speech-to-text-style pass, timing as just the file's own length).
     No lyrics panel, no paste-lyrics box, no manual vocal-start pin —
     this is the entire surface for that.
  - The sheet's backdrop is a darker/more opaque scrim
     (`bg-black/90 backdrop-blur-md`, vs. the generic `GraphNodeSheet`'s
     `bg-black/70`) — this sheet opens tall and near the top of the
     screen on mobile, so the graph board underneath sits closer to the
     sheet's rounded top corners; the stronger scrim keeps a graph
     button/card from reading as if it were floating chrome belonging to
     the sheet itself.
  - **Make lane dial** — the same small dial mirror the generic
    `GraphNodeSheet` shows for any suit-mapped node (Skidmarks is mapped
    to ♥ Make): pausing it here pauses it everywhere, including the cost
    deep-dive's vendor table.
- **Data shape** (`lib/skidmarks.ts`): `SkidmarksBand` (`id`, `name`,
  `tagline`, `coverSeed`, `editIcon`, `members: SkidmarksMember[]`);
  `SkidmarksMember` (`id`, `name`, optional `role`, `emoji`,
  `looks: SkidmarksLook[]`); `SkidmarksLook` (`id`, `seed`, `prompt`,
  `photoreal`, `createdAt`); `SkidmarksMp3Attachment` (`fileName`,
  `durationSec`, `attachedAt`, `checklist: Record<SkidmarksChecklistKey,
  boolean>`); and `SkidmarksState` (`bands`, `session:
  { projectKind, bandId, mp3 }`, `removedSeedBandIds` — hand-seeded band
  ids Stuart has deleted, so `normalizeState` doesn't resurrect them).
- **Persistence**: `localStorage` (key `the-tab:skidmarks-studio`),
  mirroring the same in-memory-cache-plus-`useSyncExternalStore` shape as
  `lib/control-plane.ts` / `lib/graphLayout.ts` (see
  `hooks/useSkidmarksStudio.ts`, which also owns the checklist's staged
  `setTimeout`s, cleared on unmount). Bands (seed + any "New" ones created
  this browser, capped at `BAND_HISTORY_LIMIT`) and wizard progress
  persist; the attached audio file itself does not (see above). A fresh
  browser (or private mode) always starts from the empty state; nothing
  here is shared across devices.
- `GraphView` special-cases `SKIDMARKS_NODE_ID` (`lib/constants.ts`) to
  render `SkidmarksNodeCard`/`SkidmarksDetailSheet` instead of the generic
  `GraphNodeCard`/`GraphNodeSheet`, same pattern as Budju/Propfolio; the
  GraphBoard (≥768px) path gets the same swap, reading the studio state
  off the same `useSkidmarksStudio` store `GraphView` reads (one hook
  call, passed down as a prop, not a second independent subscription
  duplicating state).
- **Explicitly out of scope for this build**: plates, multi-angle
  coverage, voice, animate, and stitch (the flow stops dead after the MP3
  checklist); any real Comfy MCP, Seedance, LTX, or ElevenLabs call; any
  real image generation for a "look" or real speech-to-text for lyrics;
  creating/editing music (MP3 attach is existing-file-only); and
  replacing `skidmarks.aiglitch.app`'s own Crash Lab. Also out of scope:
  the "Skidmarks" and "Sunnybank" landing tiles (rendered, inert), and
  editing a band's name or a member's name/role after creation.

### Ask Grok + action chips (v0 stub)

The Propfolio detail sheet also ships an **action chips row** and an
**Ask Grok composer** — a way for Stuart to kick off Propfolio updates
from Deck on his phone, without embedding a full Grok Bot iframe. Both
live only in the detail sheet (tap the node to open it), not on the
collapsed node face, so the card itself stays uncluttered.

- **Action chips** (`components/ActionChips.tsx` — a generic, dumb pill-row
  primitive with no fetch/clipboard logic of its own, so a future Budju
  panel can reuse it with its own `items`). Propfolio wires up three, but
  only **Open Propfolio** shows when `status` is `"ok"` — the other two
  are diagnostic tools, hidden until there's actually something to check:
  - **Open Propfolio** — opens `https://propfolio.work` (`liveData.url`,
    falling back to `PROPFOLIO_APP_URL` in `lib/propfolio.ts` if `url` is
    ever the empty-string placeholder) in a new tab. Always shown.
  - **Refresh health** — re-hits the existing `GET /api/health/propfolio`
    stub and swaps the sheet's local state to whatever it returns (still
    just re-reading `data/propfolio.json` for now — see the "Propfolio
    node" section above; this chip is the seam for a real probe, not a
    real probe itself). Only shown for `"degraded"` / `"error"` /
    `"unknown"`.
  - **Copy status** — copies a one-line status/count rollup
    (`statusOneLiner` in `lib/propfolio.ts`, e.g. "Propfolio: OK · 2
    clients · 2 properties — French household · Bagshaw Cres"). Only
    shown for `"degraded"` / `"error"` / `"unknown"`.
  - Every chip's result shows as a small feedback line under the row
    (e.g. "Refreshed — OK.", "Status copied to clipboard.", or a copy
    fallback that inlines the text itself when the clipboard write fails)
    — no toast library, just local state in `PropfolioDetailSheet`.
- **Ask Grok** (`components/AskGrokPanel.tsx` — also generic over
  `project`/`projectLabel`/`statusSnapshot`, so it's reusable as-is).
  A short text field (placeholder: "add rent roll for 60 Bagshaw, check
  loan reminder dates…") + **Send** POSTs
  `{ project: "propfolio", message, statusSnapshot, ts }` to
  `POST /api/deck/ask`. `statusSnapshot` is the sheet's current
  status/counts/note/checked-at, so whatever Grok reads later has the same
  context Stuart saw when he sent the ask. On success, the panel shows a
  **"Queued ✓"** confirmation and a **copyable prompt** built server-side
  (`buildGrokPrompt` in `lib/deck-ask.ts`) — a ready-to-paste message for
  **Grok Bot (QA Engineer)** bundling the ask and a status-snapshot
  rollup. This deliberately does **not** call Grok directly and does
  **not** use any `grokbot://` compose deep link (none is documented to
  exist) — it's a queue + copy-prompt, matching the same "thin stub, real
  shape" philosophy as the control-plane and Mail → Tab bridges.
- **`POST /api/deck/ask`** validates `project`/`message` (both required;
  `message` capped at `MAX_ASK_MESSAGE_LENGTH` = 500 chars in
  `lib/deck-ask.ts`), stores the ask via `lib/deck-ask-server.ts`, and
  returns `{ ok, ask, prompt }`. **`GET /api/deck/ask`** (optionally
  `?project=` / `?limit=`) lists recent queued asks — a debug/inspection
  endpoint, same pattern as `GET /api/control-plane/report` and
  `GET /api/ingest/receipt`.
- **Persistence**: `lib/deck-ask-server.ts` reads/writes
  `data/deck-asks.json` on disk (capped at the last 200 asks), with an
  in-memory fallback for read-only deploy filesystems — the exact same
  pattern (and the exact same limitation: the file wins when writable, the
  in-memory fallback is per-warm-instance and doesn't survive a cold start
  otherwise) as `lib/overrides-server.ts`'s receipt log. No real durable
  datastore in v0; simple JSON-on-disk is enough to prove the shape.
- **No auth in v0** — same as `/api/control-plane/*`; `/api/deck/ask` is
  same-origin JSON with no secrets, not yet meant to be hit from outside
  this app.
- **Out of scope for this PR** (documented so it's not mistaken for
  finished): live client/property counts from `propfolio.work` (still
  seed data — see the "Propfolio node" section above), Grok actually
  reading/acting on a queued ask (nothing polls `data/deck-asks.json` yet;
  that's the next seam), and reusing `ActionChips`/`AskGrokPanel` on the
  Budju node (the components are generic enough to, but that wiring
  hasn't been done here). `AskGrokPanel` is now also reused, opt-in, from
  the generic `GraphNodeSheet` for the Same Game Multi node (see "Same
  Game Multi node" above) — Budju itself still doesn't have one.

## The four lanes

- ♦ **Models** — xAI API, Claude (sub + usage), Cursor Pro, DeepSeek,
  SuperGrok
- ♠ **Infra** — Vercel, Neon, Resend, ImprovMX, MongoDB
- ♥ **Make** — Comfy, ElevenLabs, Suno, Siray, Odds API
- ♣ **Life** — iCloud+, X Premium, Meta/Facebook (est.)

The header/deep-dive's big number sums every USD-denominated, countable
meter's **windowed** amount (see "Running costs (header + deep dive)"
above) — not a flat sum of every `amount`. Claude's AUD usage meter is
shown as a separate subline and is never silently converted. Closed
(DigitalOcean) and TBD (MongoDB) meters are listed in the vendor table but
excluded from totals. The soft leash goal is **$400 USD/month**
(`LEASH_GOAL_USD` in `lib/constants.ts`), prorated to whichever window is
selected (`$400/30*7 ≈ $93.33` for a 7-day window) — the ambient glow
behind the big number scales with spend against that prorated goal.

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
