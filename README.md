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
- `lib/skidmarks.ts` / `lib/audioAnalysis.ts` (+
  `lib/audioAnalysis.test.ts`) / `hooks/useSkidmarksStudio.ts` — the
  Skidmarks Music-video studio model (bands/members/looks/MP3/clip
  timeline) and its `localStorage` store (pure mock builders,
  `useSyncExternalStore` React binding, and real client-side
  vocal/instrumental MP3 analysis — an FFT-based heuristic, no API key —
  driving the clip timeline and the Lyrics/Timing/Ready chips). The
  analysis heuristic has its own `vitest` suite (`npm test`) against
  synthetic signals — see "Skidmarks node (vibe director)" below for the
  honest ceiling on what that suite can and can't prove without
  Stuart's actual MP3 in the repo.
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
  / `SkidmarksMp3Card` / `SkidmarksChecklistChips` / `SkidmarksClipTimeline`
  / `SkidmarksClipStub`) — the Skidmarks vibe-director node's face
  and its locked, one-scroll Music-video flow through the clip timeline's
  real upload/generate plate-still + multi-line shot-prompt tags — see
  "Skidmarks node (vibe director)" below),
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
cast its members → attach an MP3 → tag each clip's plate + shot prompt)
rendered as **one continuous scroll**, never a chat thread and never a
separate screen. It's locked through the clip timeline's plate/camera/
model tags — voice, animate, and stitch are explicitly out of scope for
now (see "Explicitly out of scope" below).

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
     reload loses playback, though the filename/duration/analysis-result
     metadata persists) drives a real play/pause, a real probed
     duration, and a real `elapsed / duration` readout (e.g. "1:23 / 4:16")
     that counts up live off the `<audio>` element's own `timeupdate`
     event and holds steady when paused mid-track, so Stuart can see
     where playback actually is instead of just the track's total length;
     the waveform itself is still decorative (`waveformBars`,
     deterministic off the filename, not derived from the real audio).
     Attaching also hands the raw `File` to `useSkidmarksStudio`, which
     kicks off the real analysis pass described next.
  6. **Real word-level transcription** (`lib/transcription.ts`,
     `transcribeAudio` + `segmentsFromWords`, backed by
     `app/api/skidmarks/transcribe/route.ts`) — this is Stuart's actual
     ask after the live bug report: energy/formant heuristics + a long
     hysteresis hold glued "Talking To Concrete"'s intro + flute into one
     giant Vocal segment (0:07–4:02) when vocals really start ~0:32, so
     he wanted **speech-to-text with word start times, like phone
     dictation**, instead of another mid-band-energy guess. The moment a
     file's attached, the client POSTs it (as `multipart/form-data`) to
     `/api/skidmarks/transcribe`, which forwards it server-side to
     **ElevenLabs Scribe** (`scribe_v2`) — and **only** ElevenLabs Scribe,
     via Stuart's already-configured **`ELEVENLABS_API_KEY`** (or
     `ELEVEN_LABS_API_KEY`, checked as a fallback name). **There is no
     OpenAI Whisper fallback** — an earlier build of this feature carried
     one, but Stuart's explicit product call (after the fourth live bug
     report below) was to remove it entirely: it isn't reliable for sung
     tracks, and its "success" on a sparse word list was silently masking
     real ElevenLabs failures from him (see that report for the full
     story and the evidence behind it). If Scribe isn't configured, or
     its request fails for any reason, this route reports that failure
     honestly (see "Wiring up transcription" below for exactly which env
     var names are checked and what it costs) and the UI falls back
     straight to step 7's energy heuristic — and returns real per-word
     `start`/`end` timestamps, tagged with the provider that answered
     (`provider`, always `"elevenlabs"` on a real success today).
     `segmentsFromWords` then merges consecutive
     words into vocal runs (a gap over ~2s between words becomes an
     instrumental segment — see that function's doc comment), which is
     what lets a segment boundary land at an actual measured vocal onset
     instead of an energy-threshold guess. **This is wired, not a stub**
     — but it's also **never claimed live without a key**: if the key
     isn't set server-side, the route honestly returns
     `501`/`missing_api_key` rather than pretending to have attempted
     anything, and the UI falls back to step 7 below without implying a
     failure. A genuine request failure (network error, bad audio, an
     actual upstream API error, or a request that doesn't get a response
     in time) is reported honestly too, distinct from "unconfigured".
     Word timings are kept on the attachment (`words`, alongside the
     merged `segments`) even though the UI only renders segments for
     now, so a later per-word lyric-emphasis pass (highlighting the
     current word during playback) can use them without re-transcribing.

     **Second live bug report, after the 413 fix above shipped**:
     Stuart re-attached "Talking To Concrete" (~4:16, real singing from
     ~0:32) once transcription actually reached the server, and got
     green **Lyrics** + a clip list with **one segment: Instrumental
     0:00–4:16** — confusing and wrong, not a crash, which made it worse:
     the UI *claimed* real transcribed timing while showing the least
     useful possible answer. Root cause: the STT provider at the time
     (Whisper, a speech-first model) returned real, non-empty `words`
     for the whole song, but too sparse and scattered across the *sung*
     sections for `segmentsFromWords`'s gap-based merge to find any
     vocal run worth keeping — and the code that turned a landed
     transcription result into `segmentsSource: "transcription"` /
     `transcriptionStatus: "done"` (the only path that turns Lyrics
     green) trusted "transcription returned *some* words" as
     "transcription produced a *useful* map", with no check in between.
     The fix has two independent parts, both load-bearing on their own:
     1. **Provider pivot** — ElevenLabs Scribe (above) is now the
        primary path instead of Whisper; ElevenLabs markets Scribe
        explicitly for transcribing song lyrics, unlike Whisper, which
        is speech-oriented. This alone makes the specific failure less
        likely for a track like this one.
     2. **A real, provider-independent usefulness check** —
        `hasUsefulVocalCoverage` (`lib/transcription.ts`) looks at the
        *actual* merged vocal/instrumental map `segmentsFromWords`
        produced and requires real singing coverage of at least
        `min(8s, totalDurationSec * 50%)` before
        `applySkidmarksTranscriptionResult` (`lib/skidmarks.ts`) trusts
        it as `segmentsSource: "transcription"`. If a provider responds
        with real, non-empty words that still don't clear that bar, the
        attachment records the honest `transcriptionStatus: "sparse"`
        outcome instead — a provider really did answer, it just didn't
        yield a usable map for *this* track — and **keeps showing
        whatever was already real** (the energy heuristic once it
        lands, or the seed fallback until then) rather than the useless
        transcription result. Because this check runs on the real
        output regardless of which provider produced it, it's the
        actual backstop against this bug recurring even if a future
        provider swap or upstream model change reintroduces sparse
        output on some other track.

     **What a Concrete-like song should look like after this fix**: the
     Lyrics chip only turns green once a provider's word timing maps to
     a real, substantial vocal onset/coverage (ideally landing right
     around the confirmed ~0:32 onset, with sung sections tracked
     through the track's flute/instrumental breaks); if a provider ever
     under-hears the singing again, the honest outcome is `"sparse"` —
     Lyrics stays amber, the timeline caption says so in plain language
     (naming which provider ran), and the real energy heuristic (or the
     seed fallback while that's still resolving) fills the clip list
     instead of a fake-confident wrong answer. Green Lyrics + a single
     Instrumental segment covering a whole sung song should no longer be
     reachable through this path.

     **Full-length songs are shrunk client-side before upload**
     (`lib/audioCompression.ts`, `compressAudioForTranscription`) — this
     is the fix for a real production bug report: Stuart re-attached
     "Talking To Concrete" at its actual ~4:16 length and got a bare
     `Transcription failed (Transcription request failed (HTTP 413).)`,
     even though a tiny test tone POST had already confirmed
     `OPENAI_API_KEY` was wired correctly. The cause wasn't OpenAI's
     25MB limit (`MAX_UPLOAD_BYTES` in `app/api/skidmarks/transcribe/
     route.ts`) — it was **Vercel's own platform-level 4.5MB cap on a
     Function's request body**
     ([docs](https://vercel.com/docs/functions/limitations#request-body-size)),
     which rejects an oversized multipart upload with `413
     FUNCTION_PAYLOAD_TOO_LARGE` *before the route handler's code runs
     at all* — a typical 128–192kbps 4+ minute MP3 is already 4–6MB, well
     over that cap on its own. There's no `next.config`/`vercel.json`
     setting that raises it. The fix: before every upload that isn't
     already comfortably small (`DIRECT_UPLOAD_SAFE_BYTES`, 4MiB),
     `transcribeAudio` now downmixes the attached file to mono, resamples
     it down, and re-encodes it to a duration-adaptive MP3 bitrate via
     `@breezystack/lamejs` (a pure-JS LAME encoder — no server binary,
     works unmodified on Vercel's Node.js runtime) entirely in the
     browser, picking the highest bitrate tier
     (`MP3_BITRATE_TIERS_KBPS`) whose predicted output still clears the
     cap. Compression is best-effort: if the browser can't decode/
     resample/encode the file for any reason, the original file is still
     sent as-is (matching this feature's pre-fix behavior), and a genuine
     remaining 413 (or any other real failure) is reported in plain
     language — file size and the actual server limit, not a bare HTTP
     status code — rather than the cryptic message from before this fix.

     **Third live bug report, after the ElevenLabs pivot above shipped**:
     Stuart added `ELEVENLABS_API_KEY` on Vercel and redeployed, then
     re-attached the same "Talking To Concrete" (~4:16 = 257s, real
     singing from ~0:32) — and got the *same* honest-but-wrong outcome
     as the pre-pivot Whisper report: amber Lyrics, caption reading
     "Transcription returned 28 words, but only 0.0s of that mapped to
     singing across a 257s track" (up from 20 words on the earlier
     Whisper attempt), timeline still one giant energy-heuristic Vocal
     block from 0:07. Stuart separately ran the *exact same file*
     through ElevenLabs' own hosted transcription tool and got back
     dense, correctly-timed sung lyrics with `[singing]` tags — direct
     proof Scribe *can* transcribe this track when it's given the
     original, uncompressed audio. **Investigated, not assumed** — five
     hypotheses, checked against the actual code and tests:
       1. *Real words landing in tiny islands `mergeTinySegments` folds
          away, throwing away good timing* — checked directly:
          `lib/transcription.test.ts`'s
          `hasUsefulVocalCoverage`/`segmentsFromWords` suite confirms 28
          words spread ~7.5s apart (reproduced with the literal 28/257s/
          0.0s numbers) *correctly* collapses to ~0s of vocal coverage —
          each word is genuinely its own <1s island, further apart than
          the 2s gap threshold, so no merge-policy tweak recovers a real
          vocal run from a word list this sparse. Ruled out as the root
          cause; the merge math is doing its job.
       2. *ElevenLabs response shape mis-parsed (wrong field names/units)*
          — checked the actual parsing in
          `app/api/skidmarks/transcribe/route.ts`'s
          `transcribeWithElevenLabs` against ElevenLabs' own documented
          response shape (`text`/`start`/`end`/`type`, seconds, `word`/
          `spacing`/`audio_event`) — it matches. Ruled out.
       3. *Coverage computed after a destructive merge instead of raw
          word spans* — the merge (`segmentsFromWords`) is the thing
          that's supposed to turn word spans into runs in the first
          place; for a word list this sparse there's no "gentler merge"
          that manufactures 200+ seconds of coverage out of 28 real
          words. Ruled out as a standalone fix (see hypothesis 1).
       4. **Client compression before upload damages singing enough that
          the API returns sparse words** — the one variable that
          actually differs between Stuart's two tests (dense results on
          ElevenLabs' hosted tool against the *original* file vs. 28
          scattered words through this app's upload path). Before this
          fix, every full-length song was downmixed to mono, resampled to
          a **fixed 16kHz** (an 8kHz frequency ceiling — inherited from
          *Whisper's* own internal-resample rationale, never revisited
          once ElevenLabs Scribe became primary), and capped at a **flat
          64kbps ceiling regardless of available budget** — for this
          exact 257s track, 64kbps used only ~2MB of the ~4MiB upload
          budget (`lib/audioCompression.test.ts`'s regression test), real
          headroom left unused while handing both STT providers a fairly
          aggressively compressed signal to pick sung lyrics out of a
          full-band mix (drums, bass, flute) with. **The strongest
          evidenced explanation, confirmed via the real `lamejs` encoder
          — not proven against the real ElevenLabs API**, since this
          repo/environment has no live key to re-run the actual failing
          request end to end. Fixed: `COMPRESSION_SAMPLE_RATE_HZ` raised
          16kHz → 22.05kHz (~11kHz ceiling instead of 8kHz) and
          `MP3_BITRATE_TIERS_KBPS`'s top tier raised 64 → 128kbps — this
          exact track now lands at the new 128kbps top tier, ~3.9MB,
          still comfortably under Vercel's 4.5MB cap (verified via
          `lib/audioCompression.ts`'s manual verification script and its
          own test suite), using the upload-budget headroom that was
          already going unused instead of a number sized for Whisper's
          speech-only assumptions.
       5. **Caption doesn't name which provider ran** — checked: true.
          `applySkidmarksTranscriptionResult`'s `"sparse"` message
          (`lib/skidmarks.ts`) built its `transcriptionError` text
          without the provider name that was already available as a
          parameter, so the live caption read "Transcription returned 28
          words…" with no way for Stuart to tell ElevenLabs from Whisper
          — even though `SkidmarksClipTimeline`'s *fallback* wording (used
          only when `transcriptionError` is unset) already named it. Fixed:
          `transcriptionProviderLabel` (`lib/transcription.ts`, now
          shared instead of duplicated in the component) is used to
          prefix that message, so it now reads "ElevenLabs Scribe
          returned 28 words…" / "OpenAI Whisper returned 28 words…".

     **Honest scope of this fix**: hypotheses 1–3 were investigated and
     ruled out with direct evidence from the existing merge/coverage
     code and tests — they were not the cause here. Hypothesis 5 (the
     caption) is fully fixed and verified by test. Hypothesis 4 (audio
     compression) has the strongest circumstantial evidence of the five
     and is fixed in the way the bug report's own constraints asked for
     (more bitrate/sample-rate headroom when the byte budget allows it),
     verified against the real MP3 encoder's actual output — but **not**
     verified against a real ElevenLabs Scribe response on the real
     track, since no `ELEVENLABS_API_KEY` is available in this
     environment to run that request. If Stuart re-attaches this track
     after this fix ships and Scribe still returns a sparse word list,
     that's real signal that compression wasn't the (or the whole) story
     — worth a follow-up report with the new word count, since a
     provider that still can't hear the singing even at 128kbps/22kHz
     would point somewhere this PR couldn't reach (e.g. Scribe's own
     handling of this specific mix, or a genuinely quiet/buried vocal
     take) rather than back at this compression step.

     **Fourth live bug report, and Stuart's resulting product call —
     remove OpenAI Whisper entirely**: after the ElevenLabs-primary
     pivot above shipped and started naming its provider in the
     caption, Stuart re-attached "Talking To Concrete" once more and
     the caption read **"OpenAI Whisper returned 18 words…"** — proof
     that ElevenLabs was tried first, failed, and the old Whisper
     fallback quietly took over and "succeeded" by the same low bar
     (any non-empty word list) the third bug report above was already
     about, without ever surfacing *why* ElevenLabs failed. Investigated
     directly against the **live ElevenLabs API**, using this route's
     exact request shape and a real (not necessarily Stuart's own)
     ElevenLabs key available in this sandbox: that call returned a
     real `401` — `{"detail":{"type":"authentication_error","code":
     "unauthorized","status":"missing_permissions","message":"The API
     key you used is missing the permission speech_to_text to execute
     this operation."}}` — i.e. a key that authenticates fine but is
     scoped without the `speech_to_text` permission. This is plausible
     context here specifically because Stuart's own account uses this
     key for **voice generation** (text-to-speech) elsewhere — a
     separate ElevenLabs permission from transcription (speech-to-text)
     that a key scoped for the former doesn't automatically carry. **This
     is confirmed, reproducible behavior of the real ElevenLabs API
     against this route's real request — not confirmed to be Stuart's
     *exact* failure**, since this sandbox's key isn't his Vercel
     project's key. Stuart's own product decision, independent of which
     exact cause this turns out to be: **remove the Whisper fallback
     entirely** — it isn't reliable for sung tracks, and a "success" on
     a sparse word list was actively hiding real ElevenLabs failures,
     which is a worse outcome than an honest failure caption. The fix,
     landed in this build:
       - `app/api/skidmarks/transcribe/route.ts` no longer calls OpenAI
         Whisper at all — `OPENAI_API_KEY` isn't read by this route.
         ElevenLabs Scribe succeeds, or the route reports exactly why it
         didn't; `lib/skidmarks.ts` falls back to the energy heuristic
         either way, same as it always has when transcription isn't
         available.
       - Every real ElevenLabs failure now reaches
         `transcriptionError`/the timeline caption verbatim — a
         permissions-scoped key, an expired/rotated key, a rate limit, a
         genuine outage, a timeout — instead of a bare "Transcription
         failed" or (the actual bug) a silent provider swap. The
         plain-language message from ElevenLabs' own error body (e.g.
         "…missing the permission speech_to_text…") is exactly what
         Stuart needs to act on: check the key's scopes in the
         ElevenLabs dashboard.
       - **Verified against Stuart's own separate Gemini troubleshooting
         notes** as a second pass, point by point, against the actual
         code (not assumed): the endpoint/params/field names
         (`file`/`model_id=scribe_v2`/`timestamps_granularity=word`)
         match ElevenLabs' documented API; the multipart request never
         hand-sets `Content-Type` (letting `fetch` generate the real
         boundary) and always uploads a real `File`/`Blob`, never a
         path string; the `xi-api-key` auth header is correct and a
         `401`/`403` is now classified as its own `"auth_error"` code
         (`classifyElevenLabsFailure` in the route) rather than a
         generic upstream failure; ElevenLabs' documented error taxonomy
         (`{ detail: { message, type, code, status } }`) is parsed into
         specific codes — `auth_error`, `rate_limited`,
         `payment_required`, `invalid_audio` (a validation error
         specifically about the audio file itself — `invalid_audio`/
         `invalid_audio_format`/`audio_too_long`/`audio_too_short`/
         `invalid_file_type`), `invalid_request` (any other bad
         parameter), or `upstream_error` — each carrying ElevenLabs' own
         human-readable message verbatim.
       - **Encoding risk, considered and addressed with the smallest
         fix, not a new pipeline**: Stuart's notes flagged that a highly
         compressed/VBR/corrupt MP3 could trip an `invalid_audio`
         rejection. For files this app already re-encodes for size
         (`lib/audioCompression.ts`'s `compressAudioForTranscription`,
         anything over ~4MiB), that risk is already low — the pipeline
         fully decodes the original via the browser's own `AudioContext`
         and re-encodes fresh, clean CBR MP3 frames via `lamejs`, so the
         upload never carries the original file's own container quirks.
         The real remaining risk is a small file (under the
         direct-upload-safe size) sent **unmodified** — if *that*
         upload comes back `invalid_audio`, `lib/transcription.ts`'s
         `transcribeAudio` now retries **exactly once**, forcing that
         same original through the same decode → re-encode pass
         (`compressAudioForTranscription(file, { force: true })`) and
         re-uploading the result — reusing existing code as a
         normalization step, not standing up a second upload format. A
         WAV (`pcm_s16le`) upload path was considered and rejected as
         *not* actually the smaller fix here: uncompressed 16-bit PCM
         runs 60–90x larger per second than this module's MP3 tiers, so
         a real song-length WAV upload would blow past Vercel's 4.5MB
         request body cap at any sample rate worth using for singing —
         infeasible as a general fallback for this app's actual use case
         (full songs), not just a fidelity trade-off. If the retry also
         fails, the real ElevenLabs error is reported rather than trying
         a third format.
     **Honest scope of this fix**: the Whisper removal, the
     provider-swap-masking-failures root cause and the live 401
     evidence behind it, the new error classification, and the
     re-encode retry are all landed and covered by
     `app/api/skidmarks/transcribe/route.test.ts` and
     `lib/transcribeAudio.test.ts`. What's **not** verified: whether a
     permissions-scoped key is *actually* Stuart's real Vercel "deck"
     project failure (this sandbox has no way to inspect his key's
     scopes), and whether the re-encode retry actually resolves a real
     `invalid_audio` rejection against the live API on his exact track
     (no such failure was reproducible in this sandbox — the available
     key here fails *every* Scribe call with `401`/`missing_permissions`
     regardless of the audio, since the permission check happens before
     any file content is even read). If Stuart still sees an ElevenLabs
     failure after this ships, the message itself is the next
     diagnostic step, not a bare "Transcription failed".

     **Fifth report, a Vercel dashboard screenshot, not a new code
     symptom**: Stuart confirmed `ELEVENLABS_API_KEY` exists on
     **Production and Preview**, added ~40 minutes before a live request
     still named a provider (OpenAI Whisper) this build no longer even
     calls — and both `ELEVENLABS_API_KEY` and `OPENAI_API_KEY` showed a
     yellow **"Needs Attention"** badge in that screenshot. Two things,
     both real, neither one requiring (or benefiting from) pasting any
     key material to diagnose:
       - **Redeploy after adding/changing an env var — this is
         documented Vercel behavior, not a guess**: "Changes to
         environment variables are not applied to previous deployments,
         they only apply to new deployments. You must redeploy your
         project to update the value of any variables you change" (
         [Vercel docs](https://vercel.com/docs/environment-variables/managing-environment-variables)).
         Adding a var on the dashboard does not restart or rebuild
         anything by itself — a Production Function that was already
         running, or was last built before the var existed, keeps not
         seeing it until a new deployment happens. **How to tell which
         failure mode is live from the caption alone**, without opening
         Vercel at all: if the caption still shows the
         `missing_api_key` text (see `app/api/skidmarks/transcribe/
         route.ts`'s `POST`, now updated to say so explicitly — "if you
         just added or changed it, Vercel only applies environment
         variable changes to new deployments — redeploy the project for
         this function to see it"), the deployed function genuinely
         doesn't see the key yet. If instead the caption names a real
         ElevenLabs error (an `auth_error`, `rate_limited`, etc. — see
         hypothesis 4 above), the key **is** visible to the function —
         the problem is on ElevenLabs' side, not deployment freshness.
       - **The "Needs Attention" badge is most likely a separate,
         security-focused flag, not a deployment-freshness one** — per
         [Vercel's Security Dashboard docs](https://vercel.com/docs/security/security-dashboard),
         the most likely match for "an env var that just got added and
         is now flagged" is the **"Environment variables not marked
         Sensitive"** check (medium risk: "Values that can be read back
         from the dashboard or API after they are written"). This is
         inferred from Vercel's own documented checks matching what the
         screenshot showed (one key's value still partially visible in
         its row, the other toggled hidden but still in a revealable,
         non-`Sensitive` format) — **not confirmed** by opening Stuart's
         actual Security Dashboard, which isn't reachable from this
         environment. Either way, marking a variable `Sensitive` is an
         orthogonal security-hardening step (remove and re-add it with
         `Sensitive` enabled, then rotate the previously-readable value
         — see that doc) — it is **not** the fix for a stale-deployment
         caption, and this PR does not touch either key's Sensitive
         setting.
     **Whisper-specific asks from this report are already moot**: this
     report's original framing (write in terms of "when EL fails and
     Whisper is used, surface the EL reason" / "don't let sparse Whisper
     hide an EL failure") predates, in this report's own words, a
     scenario this build can no longer produce — the fourth report above
     already removed Whisper from this route entirely, per Stuart's
     explicit product call. There is no Whisper path left for an
     ElevenLabs failure to hide behind; every ElevenLabs failure
     (including one caused by a stale deployment not seeing the key at
     all) now reaches the caption directly. What this report added that
     genuinely wasn't covered yet: the redeploy-required behavior, now
     both documented here and stated in the `missing_api_key` message
     itself (`app/api/skidmarks/transcribe/route.test.ts` covers that
     message's exact wording).
  7. **Real(ish) vocal/instrumental analysis, kept as a fallback**
     (`lib/audioAnalysis.ts`, `analyzeVocalActivity`) — runs **in
     parallel** with step 6 above, unconditionally, the moment a file's
     attached, entirely **client-side, no API key, no network call**: it
     decodes the actual picked MP3 via the browser's `AudioContext`,
     frames the real PCM samples, runs a real FFT per frame, and scores
     each frame on (a) how loud it is (RMS), (b) how much of its energy
     sits in the ~300–3400Hz band human vocal formants live in, and (c)
     how *concentrated* that vocal-band energy is in a single FFT bin —
     a sustained near-pure tone (a lead flute is the motivating case,
     since it sits in the same band real vocal formants do) reads as
     "peaky", while a sung vowel's broader formant structure doesn't.
     Frames that are loud enough, vocal-band-dominant, and not too
     "peaky" are flagged "vocal"; an attack/release **hysteresis** pass
     (quick to call a frame "vocal", much slower to call it back
     "instrumental" — see the module doc comment in
     `lib/audioAnalysis.ts`) turns the frame-level flags into a handful
     of contiguous real-time segments without flickering mid-phrase every
     time a syllable, a beat, or a brief flute interlude gets in the way.
     It's a genuine signal-processing heuristic against the real file —
     not a mock — but it's also not speech-to-text and can't see song
     structure, so it only ever labels output **Vocal**/**Instrumental**
     (never verse/bridge — see below). It's tuned by ear against
     Stuart's reports on one track (Jack Ash – "Talking To Concrete"),
     not a trained/validated model, so expect it to still call loud
     instrumental sections, quiet vocals, or an unusually "vocal-shaped"
     instrumental (the flute cue is a heuristic, not a solved problem —
     see that constant's doc comment) wrong sometimes; that's why the UI
     calls it "real(ish)", not "real". **This heuristic is never removed
     by transcription landing** — it keeps running and stays the fallback
     signal whenever no transcription key is configured, a transcription
     request fails, or a provider responds but its result is too sparse
     to trust (`transcriptionStatus === "sparse"` — see step 6 above),
     per Stuart's explicit ask to keep it as a real fallback rather than
     a maybe-it-works stub. Real, *useful* transcription (step 6) always
     outranks it once it lands, though — see `segmentsSource` below.
  8. **Checklist chips** (`SkidmarksChecklistChips`) — three always-
     present, equal-width chips under the MP3 card: **Lyrics · Timing ·
     Ready**, each showing one of four *real* states
     (`skidmarksChecklistState` in `lib/skidmarks.ts` — no staged timers
     anymore): grey **pending** (nothing to report), blue spinning
     **analyzing** (the duration probe, `transcribeAudio`, or
     `analyzeVocalActivity` is actually running), green **done** (that
     real signal resolved), or amber **stub** (never rendered green).
     `Timing` flips real the moment the browser's own duration probe
     resolves. **`Lyrics` now specifically means real, *useful*
     transcription** — it only turns green once word-level
     transcription actually lands *and* maps to enough real singing to
     trust (`segmentsSource === "transcription"`, gated on
     `hasUsefulVocalCoverage`); a *successful* energy heuristic alone (no
     key configured, the transcription request failed, or a provider
     responded but the result was too sparse to trust —
     `transcriptionStatus === "sparse"`) keeps it amber, since that
     heuristic answers "is this bit sung", not "what are the actual
     lyrics/word timing" — this chip is about the latter, and never
     claims more than it has. `Ready` is
     green only once both `Timing` and `Lyrics` are real, amber if the
     clip list is only usable via the heuristic or seed fallback. No
     lyrics panel, no paste-lyrics box, no manual vocal-start pin — this
     is the entire surface for that.
  9. **Clip / segment timeline** (`SkidmarksClipTimeline`) — appended
     right under the checklist chips, as soon as an MP3 is attached (not
     gated on the checklist reaching "Ready"): a collapsible **Clip /
     segment list** section. **Per Stuart's explicit product-lock ask**
     (now that ElevenLabs Scribe reliably works), the long paragraph-
     length "honesty caption" that used to sit above the rows — naming
     file paths (`lib/transcription.ts`, `lib/audioAnalysis.ts`), the
     energy-heuristic mechanics, and the exact provider on every state
     change — is gone from this screen once real, *useful* transcription
     lands (`segmentsSource === "transcription"`, the green-Lyrics case):
     no caption, no note, nothing between the chips and the first
     segment row. The Lyrics/Timing/Ready chips (step 8) already carry
     that "is this real" signal, so the timeline doesn't repeat it as
     prose. Short of that — transcription unconfigured, too sparse to
     trust, or failed outright (`timelineNote` in
     `SkidmarksClipTimeline.tsx`) — a single plain-language line still
     shows (e.g. *"Lyrics timing failed — showing placeholder timing
     below."* or *"…showing estimated timing below."* when the energy-
     heuristic fallback actually produced something), with no file
     paths and no explanation of how either fallback works; it just
     says which timing is showing so a fallback is never presented as
     if it were real. **Segments prefer real, *useful*
     transcription** (`segmentsSource: "transcription"`) whenever it
     lands; short of that, the real energy heuristic (`segmentsSource:
     "analysis"`); short of that, the seed cadence (`buildDemoSegments`
     in `lib/skidmarks.ts` — 7 segments: intro instrumental → verse → instrumental break →
     verse → bridge → lead → verse, labeled **Verse**/**Bridge**/
     **Lead**/**Instrumental**) as a fallback, flagged by the short
     `timelineNote` line above whenever it's showing — see that
     function in `SkidmarksClipTimeline.tsx` for the exact priority
     logic. Each clip is its own **collapsible row**: collapsed shows
     just the time range (e.g. "0:15–0:45") and its label pill — no
     model glance, no other chrome; expanded appends that clip's
     `SkidmarksClipStub` panel, which is **ruthlessly minimal by
     design** after a round of live QA on an earlier pass
     (`SkidmarksPlatesAndCamera`, since deleted) that shipped a
     horizontal row of five named location-plate cards (Neon Stage,
     Rainy Alley, Desert Highway, Warehouse, Crowd Pit — deterministic
     gradient swatches, no real plate photos), a Camera Angles block,
     and a compact Model pill row, with every plate card mirroring the
     same one `shotPrompt` as its caption. Stuart rejected all of it:
     a location picker he never asked for, model chrome he doesn't want
     to operate, and a prompt that visually "duplicated" into every box
     as he typed (even though it was really only one value underneath).
     `SkidmarksClipStub` replaces that whole panel with exactly two
     things — and, in a later pass than the chrome-lock rewrite itself,
     the first of the two now holds a **real** plate still, not just an
     empty stand-in:
     - **One plate placeholder/still** — a dashed-border box (same
       visual language as the other empty stubs already in Skidmarks,
       e.g. `SkidmarksGeneratePopup`'s `EmptySlot` and
       `SkidmarksMembersModule`'s dashed avatar ring) while empty, no
       location, no gradient, no duration label (Stuart doesn't know a
       clip's actual rendered length until it's actually generated, so a
       number on an empty placeholder would just be invented). **Plate
       stills: upload or generate, real either way** — tapping the
       empty box opens a tiny two-option popover (Upload / Generate, no
       other chrome):
       - **Upload** opens a real native `accept="image/*"` file picker;
         the picked photo goes through the same
         `readImageFileAsDataUrl` downscale-to-JPEG pass the band
         cover/member avatar pickers already use, and is stored as this
         clip's `still` (`SkidmarksClipSegment.still`, a `data:` URL —
         round-trips through `localStorage` same as a picked avatar).
       - **Generate** calls a real backend — **xAI's Grok Imagine API**
         (`lib/plateGeneration.ts`'s `buildPlateGenerationRequest` +
         `generatePlateStill`, via `app/api/skidmarks/generate-still/
         route.ts`) — requiring only a non-empty shot prompt; everything
         else is automatic (see "Model routing, vocalist auto-include,
         and Jack Ash's character lock" and "Continuity: 'Use last
         plate'" below). A spinner overlays the box while a request is
         in flight (over the existing still, on a regenerate). This is
         a **real, wired image call**, verified live against xAI's API
         in this sandbox (a text-to-image call and an image-edit call
         with a real reference photo both returned real `200`s — see
         `lib/plateGeneration.ts`'s module doc comment for exactly what
         that does and doesn't prove) — **the *video* render pass past
         this one still stays a stub everywhere in this build** (see
         "Generate Clips" below); a real plate still is cheap, a real
         video render is the expensive part Stuart asked to keep
         stubbed.
       - **Once a still exists**, Stuart's ask was gestures on the plate
         itself, not a button row: tapping the still reopens the same
         Upload/Generate popover (replace/regenerate — editing the shot
         prompt first, then regenerating, is how an edited prompt
         actually updates the still; editing the prompt alone never
         auto-invalidates an existing one), a tiny always-visible "×" in
         its corner clears it back to the empty placeholder outright,
         and a press-and-hold on the plate does the same clear
         (redundant with the ×, not instead of it — both ship). Verified
         manually in this build: upload, generate (with a real xAI call
         and a real rendered image), tap-to-replace, the "×" clear, and
         press-and-hold clear all worked in a real browser session; see
         `lib/plateGeneration.ts`'s doc comment for why the plain `<img>`
         needed `draggable={false}`/`pointer-events-none` for the
         press-and-hold gesture to survive a real mouse-down (a native
         browser image-drag was intercepting it before that fix).
     - **One shot-prompt text field** — "what happens in this shot", a
       **multi-line textarea** now (was a cramped single-line `<input>`
       before this pass — Stuart's ask, so a real shot description has
       room to read), still deliberately short overall (no lyric dumps,
       no long captions, no helper paragraph underneath, and never a
       hardcoded scene description — this field is entirely
       Stuart-authored) and bound to a single `shotPrompt` value per
       clip. Editing it only ever updates the prompt text — it does
       **not** touch `model` (an earlier pass re-derived the model from
       the prompt's language; that's gone per the cost lock below) and
       does not touch an existing `still` either (see above).

     **Model routing, vocalist auto-include, and Jack Ash's character
     lock** (`lib/plateGeneration.ts`) — all automatic, no picker/toggle
     UI added for any of this:
     - **Model routing steers prompt phrasing, not which API gets
       called** — there is exactly one real image backend in this build
       (xAI, above); a clip's LTX/Grok/H3 tag (see the cost-lock section
       below) only changes this same call's prompt framing
       (`routingFramingHint`): Vocal clips tagged LTX Lip-sync get a
       tight, camera-facing framing hint; H3-tagged clips ("simple
       stills" per the product ask) get a plainer single-subject hint;
       everything else (Grok, the instrumental/B-roll default, or a
       manual Seedance pick) gets a wider, dynamic establishing-shot
       hint.
     - **A single vocalist/lead auto-includes on Vocal clips**
       (`resolveVocalistForPrompt`) — if a band has exactly one named
       member, it's them, unambiguously (both seed bands today: Jack
       Ash's sole member *is* Jack Ash; Solar Rebel's sole member is
       Nova); with more than one named member, whichever one's `role`
       reads like the actual vocalist/lead, falling back to the first
       named member. An Instrumental/B-roll clip (e.g. a door/keyhole
       shot) can still omit the artist entirely, even for a band with an
       obvious single vocalist — this only fires when the clip itself
       is tagged Vocal.
     - **Jack Ash's look is locked** (`SKIDMARKS_CHARACTER_LOCKS`,
       keyed by member id) — per Stuart's reference photo (seeded as
       `public/skidmarks/jack-ash-reference.jpg` and, so an identity
       reference exists from a fresh session without an upload first,
       as his frontman's `avatarImage` in `SEED_BANDS`): a noir
       silhouette in a fedora and suit, desert-noir setting, his face
       **always** fully hidden in deep shadow — no eyes/brow/nose/
       cheeks/jawline ever lit or visible, even in close-up — with
       glowing neon-blue lips as the one feature breaking through that
       darkness. Whenever Jack Ash resolves as the vocalist on a Vocal
       clip, this hallmark text (and an explicit "do not show" negative
       cue — xAI's API has no dedicated negative-prompt field, so this
       is woven into the same prompt string) is injected automatically;
       his `avatarImage` is also passed as a real identity/likeness
       reference to xAI's `/images/edits` endpoint. **Verified live, not
       just written**: a real `/images/edits` call in this sandbox,
       using Jack's actual reference photo and this exact prompt
       strategy, returned a real render that held the look — fedora,
       fully shadowed face, glowing neon-blue lips, desert-noir setting
       — though (being a generative model, not a deterministic
       renderer) that's evidence the approach works, not a guarantee
       every future generation lands equally on-character. No new
       character-sheet UI shipped for this — it reuses the existing
       avatar-photo field/picker outright.
     - **Continuity: "Use last plate"** — when generating, if the
       *previous* clip in the timeline already has a still, a small
       "Use last plate" checkbox appears in the Generate popover,
       **checked by default** (Stuart's ask: prefer an automatic default
       over heavy chrome); when checked, that previous still is passed
       as a continuity reference so a multi-clip story (e.g. door →
       keyhole → Jack seated) can hold the same scene across shots
       instead of each clip generating in a vacuum. Continuity and the
       vocalist identity reference above can combine in the same
       request — xAI's `/images/edits` `images` array (up to a few
       reference images, tagged `<IMAGE_0>`/`<IMAGE_1>` in the prompt)
       carries both when both apply; this specific two-reference
       combination was implemented from xAI's own documented request
       shape but wasn't separately live-tested (each real call costs
       real money) — see `lib/plateGeneration.ts`'s module doc comment
       for exactly what was and wasn't verified live.

     **Auto-assignment is still cost-locked in code**
     (`defaultSegmentModel` in `lib/skidmarks.ts`) — Stuart: "be very
     wary of spend" — it just isn't shown as a picker anymore. It only
     ever picks two of the four models, and never rotates/cycles
     between them on its own:
     - **Vocal** (verse/bridge, or either real path's Vocal) →
       **LTX Lip-sync**, unconditionally.
     - **Instrumental** (lead/instrumental, any path) → **Grok**,
       unconditionally.
     - **H3** and **Seedance** are valid picks a clip's `model` can
       hold (`setSkidmarksSegmentModel`), but `defaultSegmentModel`
       will never return either, and — per Stuart's live-QA chrome
       lock — there is **no model pill anywhere in this UI** to tap
       either one from right now. The plan (not implemented) is a
       single tiny model badge once a clip has a real still; with only
       an empty placeholder today, a badge would just be more chrome
       around nothing.
     - **SIRAY** and **Kling** are not in this allowlist at all — SIRAY
       survives only as a narrow, not-wired-into-this-UI data-layer
       opt-in (`uncensoredPlateStills`, "uncensored plate stills only" —
       never read by `model`/Generate Clips); Kling has no equivalent
       carve-out and is removed outright (no subscription).

     A stub **Generate Clips** button closes the section — tapping it
     never calls a real Comfy MCP / LTX pipeline; it only shows a
     "Stub only — no Comfy MCP / LTX render kicked off" message
     (`SkidmarksClipTimeline`'s local `stubMessage` state, same pattern
     as `PropfolioDetailSheet`'s chip feedback line, but always mounted
     with `role="status"`/`aria-live="polite"` so it reaches the
     accessibility tree/screen readers too, not just sighted users).
     **Phase note**: typing a shot prompt, uploading a photo, and
     generating a real plate still (see above) are all real and persist
     to `localStorage` — what stays a stub past that is the actual clip
     *video* (this button never calls a real Comfy MCP / LTX render).
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
- **Wiring up transcription**: **no new key to add.** Stuart confirmed
  he already has an ElevenLabs API key set on **Vercel Production**
  (he uses it there for voice generation in other productions), so this
  PR doesn't ask him to create or paste one anywhere. `app/api/skidmarks/
  transcribe/route.ts`'s `resolveElevenLabsApiKey` looks for it under
  **`ELEVENLABS_API_KEY`** first (the standard name ElevenLabs' own
  SDKs/docs use), then **`ELEVEN_LABS_API_KEY`** (a plausible
  manual-naming variant) — nothing in this repo or its sibling
  "Skidmarks"/"AIG!itch" project docs revealed an actual different
  existing name to reuse instead, so those two are the closest honest
  guess, not a discovered fact. **If his real Vercel var is named
  something else entirely**, the fix is a one-line alias (add a second
  Vercel env var under one of the two names above, set to the same
  value as his existing key) rather than a code change or a new key.
  Once found under either name, word-level transcription (step 6 above)
  goes live via ElevenLabs Scribe on the next deploy/restart. **No
  OpenAI Whisper fallback exists to configure** — `OPENAI_API_KEY` isn't
  read by this route at all (Stuart's explicit removal, see the fourth
  live bug report below); it's harmless to leave set for other features
  or unset, either way, but setting or unsetting it has zero effect on
  Skidmarks transcription. Leave `ELEVENLABS_API_KEY`/
  `ELEVEN_LABS_API_KEY` both unset (or unfindable under a checked name)
  and the build runs exactly as before real transcription existed
  (energy heuristic + seed fallback), just with an honest "unconfigured"
  caption instead of a silent gap — that caption/error message names
  exactly which env var names were checked, so a naming mismatch is easy
  to spot and fix. **Cost**: ElevenLabs bills by audio duration (a few
  cents per hour of audio at current published rates, effectively
  pennies for a typical 3–5 minute song) — check
  [ElevenLabs' current pricing](https://elevenlabs.io/pricing) before
  relying on this at any volume, since rates can change. This build
  makes exactly one transcription call per MP3 attach (plus, as of the
  fourth live bug report below, one further retry — same provider, a
  freshly re-encoded copy of the same file — specifically when Scribe
  reports the *audio itself* as invalid, never as a generic retry) — no
  second provider, no polling; re-attaching the same file re-transcribes
  it.
- **Wiring up plate-still generation**: needs **`XAI_API_KEY`** — an xAI
  API key from [console.x.ai](https://console.x.ai) — set server-side on
  Vercel. xAI is already one of Stuart's "four lanes" accounts (see "The
  four lanes" below), so this is very likely a key he already has
  somewhere, but (unlike `ELEVENLABS_API_KEY` above) nothing in this
  repo or its sibling project docs confirmed he's already added this
  *specific* one to the "deck" Vercel project — check Vercel's
  Environment Variables settings for this project first; if it's not
  there, add it (Production and Preview, same as `ELEVENLABS_API_KEY`).
  `app/api/skidmarks/generate-still/route.ts`'s `resolveXaiApiKey` checks
  for it under this exact name only — there's no `XAI_KEY`/`X_AI_API_KEY`
  fallback-name guessing the way the ElevenLabs route tries a second
  name, since `XAI_API_KEY` is the one name xAI's own docs/SDKs use.
  Leaving it unset (or a fresh deploy that hasn't picked up a
  just-added value yet — Vercel only applies env var changes to *new*
  deployments, redeploy after adding it) means Generate returns an
  honest "unconfigured" message on tap instead of silently doing
  nothing; Upload still works either way (no key needed for that path —
  it's a local file read + resize, no network call). An optional
  **`XAI_IMAGE_MODEL`** override picks a different xAI image model
  without a code change (defaults to `grok-imagine-image-2.0`, the model
  this feature's live verification calls used — see
  `lib/plateGeneration.ts`'s module doc comment) — a config knob, not a
  picker; there's still no per-request model choice in the UI. **Cost**:
  per xAI's own published pricing, a `grok-imagine-image-2.0` still runs
  roughly one to a few cents (higher for 2K resolution or the
  higher-quality tier) — check
  [xAI's current pricing](https://x.ai/api) before relying on this at
  volume, since rates can change; this matches Stuart's "plate stills
  are OK cost-wise" — the clip timeline's actual *video* render pass
  stays a stub everywhere in this build regardless (see the "Skidmarks
  node" section's "Generate Clips" note), which is where the real spend
  risk would be. This build makes one generation/edit call per tap of
  Generate — no polling, no automatic retry.
- **Data shape** (`lib/skidmarks.ts`): `SkidmarksBand` (`id`, `name`,
  `tagline`, `coverSeed`, `editIcon`, `members: SkidmarksMember[]`);
  `SkidmarksMember` (`id`, `name`, optional `role`, `emoji`,
  `looks: SkidmarksLook[]`); `SkidmarksLook` (`id`, `seed`, `prompt`,
  `photoreal`, `createdAt`); `SkidmarksMp3Attachment` (`fileName`,
  `durationSec`, `attachedAt`, `segments: SkidmarksClipSegment[]`,
  `segmentsSource: "transcription" | "analysis" | "seed-fallback"`,
  `analysisStatus: "analyzing" | "done" | "failed"`, optional
  `analysisError`, `transcriptionStatus: "checking" | "unconfigured" |
  "done" | "sparse" | "failed"` (`"sparse"` — added in the same PR as
  this section — is the honest outcome when a provider responds with
  real, non-empty words that don't clear `hasUsefulVocalCoverage`'s bar
  for this track: not a failure, but not trusted as
  `segmentsSource: "transcription"` or shown as green Lyrics either),
  optional `transcriptionError` (also used for the `"sparse"` case's
  plain-language coverage explanation), optional `transcriptionProvider:
  "elevenlabs" | "openai"` (which backend actually answered, once one
  does), optional `words: { word, startSec, endSec }[]` — real per-word
  timestamps once some provider responds (kept even for a `"sparse"`
  result), even though only the merged `segments` render today);
  `SkidmarksClipSegment` (`id`, `startSec`, `endSec`, `label`, `model`,
  `shotPrompt`, `uncensoredPlateStills`, optional `still:
  SkidmarksPlateStill` — no `plateId`/`cameraAngle`; both were deleted
  outright along with their pickers); `SkidmarksPlateStill` (`dataUrl` —
  always a `data:` URL, never a bare/temporary remote one, so it
  round-trips through `localStorage`; `source: "upload" | "generated"`,
  informational only, not rendered as a badge anywhere per the chrome
  lock; `createdAt`); and
  `SkidmarksState` (`bands`,
  `session: { projectKind, bandId, mp3 }`, `removedSeedBandIds` —
  hand-seeded band ids Stuart has deleted, so `normalizeState` doesn't
  resurrect them). The Lyrics/Timing/Ready chip states aren't stored at
  all — `skidmarksChecklistState` derives them on the fly from
  `durationSec`/`segmentsSource`/`transcriptionStatus`/`analysisStatus`,
  so there's nothing to keep in sync.
- **Persistence**: `localStorage` (key `the-tab:skidmarks-studio`),
  mirroring the same in-memory-cache-plus-`useSyncExternalStore` shape as
  `lib/control-plane.ts` / `lib/graphLayout.ts` (see
  `hooks/useSkidmarksStudio.ts`, which also owns kicking off both
  `transcribeAudio` and `analyzeVocalActivity` against the attached file
  in parallel and applying whichever result lands, guarded by a
  generation-token ref so a slow result for a file the user has since
  removed/replaced can't land on top of what's current). Bands (seed +
  any "New" ones created this browser, capped at `BAND_HISTORY_LIMIT`),
  band/member deletions (`removedSeedBandIds`), wizard progress, the
  finished transcription/analysis results (segments + `segmentsSource`/
  `transcriptionStatus`/`analysisStatus`, and `words` if transcription
  succeeded), and each clip's shot-prompt tag and, now, its real plate
  still (`still`, uploaded or generated) all persist; the
  attached audio `File` itself does not (see above) — which means a
  transcription or analysis request that's still in flight when the tab
  closes can never resume after a reload (no file left to re-send/
  re-decode). `normalizeState` handles that honestly: a stuck
  `"analyzing"`/`"checking"` status is normalized to `"failed"` on load
  with an explanatory error, rather than leaving a chip stuck showing
  "in progress" forever (a pre-transcription-feature session with no
  `transcriptionStatus` at all normalizes to `"unconfigured"` instead —
  honest about "we don't know a real attempt happened here", not a
  fabricated interruption). A fresh browser (or private mode) always
  starts from the empty state; nothing here is shared across devices.
  **This is a placeholder store**, not the intended long-term one — see
  "Follow-up: real persistence" below.
- **Mock vs. real, at a glance**: real — band/member identity (hand-seeded
  or user-created, no invented names), a picked cover/avatar photo
  (`readImageFileAsDataUrl`), deleting a band or member
  (`removeSkidmarksBand`/`removeSkidmarksMember`), the attached MP3 file
  and its real duration/playback, real word-level transcription when
  `ELEVENLABS_API_KEY` (or `ELEVEN_LABS_API_KEY`) is configured,
  the request succeeds, *and* the result maps to enough real singing to
  trust (`hasUsefulVocalCoverage`) (`transcribeAudio`/`segmentsFromWords`
  in `lib/transcription.ts`, via `app/api/skidmarks/transcribe/route.ts`),
  and the clip timeline's energy-heuristic vocal/instrumental segments
  whenever transcription isn't available or landed too sparse to trust
  (`analyzeVocalActivity` in `lib/audioAnalysis.ts` — a real FFT-based
  heuristic against the real file, see step 7 above for its honest
  ceiling), and — new in this pass — a clip's plate **still**: a
  real uploaded photo, or a real image xAI's Grok Imagine API generated
  (`lib/plateGeneration.ts`, `app/api/skidmarks/generate-still/route.ts`,
  keyed via `XAI_API_KEY`). Mock — generated "looks" (`buildMockLook`, a
  color swatch stand-in — distinct from a plate *still*, which is real),
  and the clip timeline's seed cadence (`buildDemoSegments`)
  whenever it's showing (a deterministic verse/bridge/lead/instrumental
  scaffold — while both real signals are still resolving, or as the
  honestly-labeled fallback if both failed/were too sparse to trust).
  See the module doc comment atop `lib/skidmarks.ts` for the same
  breakdown in code.
- **Follow-up: real persistence (Neon)**. Stuart wants Skidmarks' data
  (bands, members, looks, session, clip timeline) moved off `localStorage`
  onto real Neon Postgres persistence, so it survives across
  devices/browsers instead of being trapped in one browser's storage —
  matching how the rest of the app is meant to grow into "AIG!itch"
  backing services. That migration is a separate, larger change (a
  schema, a data-access layer swapping out `lib/skidmarks.ts`'s
  `localStorage` read/write, and likely an API route) and is
  **explicitly out of scope for this PR**.
- `GraphView` special-cases `SKIDMARKS_NODE_ID` (`lib/constants.ts`) to
  render `SkidmarksNodeCard`/`SkidmarksDetailSheet` instead of the generic
  `GraphNodeCard`/`GraphNodeSheet`, same pattern as Budju/Propfolio; the
  GraphBoard (≥768px) path gets the same swap, reading the studio state
  off the same `useSkidmarksStudio` store `GraphView` reads (one hook
  call, passed down as a prop, not a second independent subscription
  duplicating state).
- **Explicitly out of scope for this build**: voice, animate, and stitch
  (the flow stops dead after the clip timeline's plate + shot-prompt
  tags); any real Comfy MCP, Seedance, or LTX call (the only real
  ElevenLabs call this build makes is Scribe speech-to-text — see step 6
  above; ElevenLabs voice/generation features are still unwired); any
  real *video* generation, or real trained/validated singing detection
  (the energy heuristic is a real signal, not a trained model — see step
  7 above; the seed cadence is still a pure fallback whenever neither
  real signal produces anything usable). **Real plate-*still* image
  generation is no longer on this out-of-scope list** — see step 9's
  "Plate stills: upload or generate, real either way" note below
  (`lib/plateGeneration.ts`, xAI's Grok Imagine API); it's the *video*
  render pass past that one still that remains a stub. A UI for per-word lyric
  emphasis during playback (`words` timing is stored, per Stuart's ask,
  but nothing renders it yet); creating/editing music (MP3 attach is
  existing-file-only); real plate photos or real camera coverage capture
  (plates/angles are seed tags, not renders); and replacing
  `skidmarks.aiglitch.app`'s own Crash Lab. Also out of scope: the
  "Skidmarks" and "Sunnybank" landing tiles (rendered, inert), and
  editing a band's name or a member's name/role after creation. Real
  word-level **speech-to-text is now wired** (see step 6 above) — it's
  no longer on this out-of-scope list, though it's honestly inert
  without `ELEVENLABS_API_KEY` (or `ELEVEN_LABS_API_KEY`) configured,
  and honestly falls back to the energy heuristic/seed cadence
  (`transcriptionStatus === "sparse"`) on a track where the configured
  provider's real output doesn't map to enough singing to trust.

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
- `ELEVENLABS_API_KEY` (optional, but the **only** transcription
  provider as of the fourth live bug report below — no OpenAI Whisper
  fallback exists anymore) — enables Skidmarks' real word-level MP3
  transcription via **ElevenLabs Scribe** (`app/api/skidmarks/
  transcribe/route.ts`, see the "Skidmarks node" section's "Wiring up
  transcription" note for what it costs). Stuart confirmed he added
  this specific key to **this "deck" Vercel project** under this exact
  name (it previously existed only on the sibling "skidmarks" project),
  so this PR does **not** ask him to create a new one. The route checks
  for it under this name first, then under `ELEVEN_LABS_API_KEY` as a
  fallback name (see `resolveElevenLabsApiKey` in that route). Leaving
  it unset/unfindable just means the honest "unconfigured" outcome
  (energy heuristic fallback) — the app still works, just without real
  transcription. `OPENAI_API_KEY` has **no effect on this route at
  all** — it isn't read here; it's fine to leave it set (for other
  features, if any) or unset.
- `XAI_API_KEY` (optional, but required for Skidmarks' real plate-still
  image generation — Upload works without it) — an xAI API key from
  [console.x.ai](https://console.x.ai), checked by
  `app/api/skidmarks/generate-still/route.ts`. See the "Skidmarks node"
  section's "Wiring up plate-still generation" note above for cost, the
  exact env var name checked, and what leaving it unset does (an honest
  "unconfigured" message, not a silent failure). Optional
  `XAI_IMAGE_MODEL` overrides the default `grok-imagine-image-2.0` model
  without a code change.
- No other environment variables are required — the rest is static seed
  data plus whatever's been ingested into `data/overrides.json`.
