# ZK Integration Master Plan

**Purpose:** One place to manage products, stock, and images (trade portal admin) → automatic listings on Wix, records in Salesforce, and (later) partner API. One booking engine so stock never double-sells.

**Last updated:** June 2026 — Phases 1–4 code complete; Partner API (Phase 5) deferred; polish (Phase 6) ongoing.

---

## Decisions locked in

| Topic | Decision |
|-------|----------|
| **Source of truth (catalog + live stock)** | Trade portal → **Supabase** (admin creates/edits; checkout uses `place_order`) |
| **Cross-system product ID** | **Salesforce Product Code** (e.g. `PR-000020`) stored on every `packages` row |
| **Salesforce edition** | Enterprise; Connected App + API (Matt sets up; steps below) |
| **SF objects** | Existing **Product2**, **Opportunity**, **Quote**, **Opportunity Products**, **Package Items** (child lines), **Accounts** (B2B Agent + Private Client) |
| **Deal owner** | **Matt Johnson** (`matt@zk-sports.com`) for portal/Wix/API-generated opportunities (configurable env var) |
| **Wix** | [zk-sports.com](https://www.zk-sports.com/) — card payment at checkout, **instant book** (no paddock approval on Wix) |
| **Wix vs trade price** | Website = trade price × **1.10** (10% markup); controlled by env `RETAIL_PRICE_MULTIPLIER` (set `1` to match trade later) |
| **Wix SKUs** | Do **not** match portal slugs today → **mapping table** required (Phase 4) |
| **Images** | HTTPS URLs (often Wix/external); sync as URLs unless we add storage later |
| **Partner API** | Build platform first; partners later; **paddock allowlist** per partner |
| **Google Sheet** | Optional one-way export backup only; not required for ops |
| **Sandbox** | Create SF sandbox before Phase 2 coding; build against sandbox first |

---

## What you already have (important)

**Salesforce** already runs your “Sales List” (~254 products) with Product Code, Event Name, Stock / Available / Sold, and package breakdowns (e.g. Legend Paddock Fri/Sat/Sun as Package Items).

**Trade portal** already has admin catalog, images, descriptions, cost layers, inventory, `place_order`, booking approval for agents on selected paddock products.

**Wix** already sells publicly (e.g. [Monaco Velocity Terrace](https://www.zk-sports.com/2026-monaco-f1-gp-velocity-terrace)) with its own layout and cart.

**Gap today:** three silos. This plan connects them without breaking portal checkout.

---

## Architecture (simple picture)

```
┌─────────────────────────────────────────────────────────────┐
│  YOU: Trade Portal Admin                                     │
│  New product · edit text/images · add stock · holds          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  SUPABASE (master)                                           │
│  packages.product_code · images · trade_price · inventory    │
│  orders · integration_outbox                                 │
└────────────┬───────────────────────┬────────────────────────┘
             │                       │
    ┌────────┴────────┐     ┌────────┴────────┐
    │ Trade portal     │     │ Background jobs  │
    │ agents book      │     │ (Vercel cron)    │
    └────────┬────────┘     └────────┬────────┘
             │                       │
             │              ┌────────┴────────────────────────┐
             │              │ Salesforce · Wix · (later) API   │
             └──────────────┤ Orders → Opp + Quote + lines     │
                            │ Products → Product2 + pricebook  │
                            │ Stock → Wix qty + SF snapshot    │
                            └──────────────────────────────────┘
```

**Golden rules**

1. Only **admin portal** and **`place_order`** change sellable stock (Wix orders call the same engine via webhook/API).
2. **Never** edit stock on Wix dashboard or SF for day-to-day ops after go-live.
3. **Salesforce** mirrors products and deals; it does not drive live qty in v1.
4. Sync failures **do not** block a successful portal/Wix sale; jobs retry.

---

## Product identity & pricing

### Product Code (primary key across systems)

| System | Field |
|--------|--------|
| Salesforce | `ProductCode` (e.g. `PR-000020`) |
| Supabase | `packages.product_code` (unique, required for synced products) |
| Wix | Mapped in `channel_listings.wix_*` (see Phase 4) |
| Partner API | Returned in catalog as `productCode` |

**New product in portal:** auto-generate next code *or* admin enters SF code when linking an existing SF product.

**Existing ~254 SF products:** one-time **mapping import** (spreadsheet: SF Product Code ↔ portal `packages.id`).

### Prices

| Channel | Formula |
|---------|---------|
| Trade portal | `packages.trade_price` |
| Wix | `trade_price × RETAIL_PRICE_MULTIPLIER` (default **1.10**) |
| Salesforce list price | Match trade (or your SF convention); document in mapper |
| Partner API (later) | Trade or partner-specific pricebook |

Env (Vercel + `.env.local`):

```bash
RETAIL_PRICE_MULTIPLIER=1.10   # use 1.00 to match trade on website
SALESFORCE_DEFAULT_OWNER_ID=005...  # Matt Johnson User Id from SF
```

---

## What syncs when you save a product in admin

| Data | Supabase | Salesforce | Wix |
|------|----------|------------|-----|
| Name, description, includes | ✓ | Product2 + description fields | Page/product text where API allows |
| Images (URLs) | ✓ | URL fields / rich text | Wix media or URL fields |
| Event / race | ✓ | Event lookup (custom field) | Manual page section until automated |
| Trade price | ✓ | Pricebook entry | Computed retail price |
| Stock (available) | ✓ | `Available_Quantity__c` snapshot | Store inventory or live check |
| New product | ✓ | Create Product2 + code | Create/link via mapping |
| Package day splits | ✓ | Package Items (if SF model unchanged) | Per-variant mapping |

**Trigger:** `integration_outbox` row `product.upsert` → worker processes SF then Wix.

---

## What syncs when an order is placed

| Channel | Flow |
|---------|------|
| Trade portal | `place_order` → outbox `order.placed` |
| Admin phone order | Same RPC → same outbox |
| Paddock approval | Approve → `place_order` → outbox |
| Wix (Phase 4) | Paid order webhook → API → `place_order` → outbox |
| Partner API (Phase 5) | `POST /orders` → `place_order` → outbox |

**Salesforce target (match your screenshots):**

- **Account:** agent company (B2B Agent) or Private Client for end guest
- **Contact:** booker / guest
- **Opportunity:** name like `{Event} {Year} - {Product Name}` (same pattern as today)
- **Opportunity Products:** line with Product Code, qty, sales price
- **Quote:** create + sync (you already use syncing quotes)
- **Owner:** Matt Johnson (configurable)
- **Custom field:** `Portal_Order_Reference__c` / `Channel__c` (Portal | Wix | Partner)

---

## Build phases (baby steps)

### Phase 0 — Access & mapping (you + Matt, ~1 week)

**Goal:** Keys and spreadsheet; no production risk.

| Step | Who | Action |
|------|-----|--------|
| 0.1 | Matt | Create **Salesforce Sandbox** (see [Appendix A](#appendix-a-salesforce-sandbox--connected-app)) |
| 0.2 | Matt | Create **Connected App** in sandbox; send Client ID/Secret to dev |
| 0.3 | Matt | Confirm Matt’s **User Id** (`005...`) for default owner |
| 0.4 | Team | Export SF **Sales List** → CSV: Product Code, Product Name, Event Name, Stock, Available |
| 0.5 | Team | Export portal packages → CSV: `id`, name, race, sellable qty |
| 0.6 | Team | **Mapping sheet:** Product Code ↔ portal `id` (start with Monaco Velocity + 10 pilot SKUs) |
| 0.7 | Boss/dev | Confirm **Wix**: Stores vs custom cart; enable **Velo + webhooks**; invite dev email |
| 0.8 | Dev | Add env vars to Vercel (sandbox only first) |

**Exit criteria:** Sandbox Connected App works; mapping sheet has ≥10 rows; Wix dev access confirmed.

---

### Phase 1 — Database plumbing (~1 week dev)

**Goal:** Track IDs and sync jobs; portal unchanged for users.

| Step | Action |
|------|--------|
| 1.1 | Migration: `packages.product_code`, `salesforce_product_id`, `retail_price_multiplier` override nullable |
| 1.2 | Migration: `orders.channel`, `external_order_id`, `salesforce_opportunity_id`, `salesforce_sync_status` |
| 1.3 | Table `integration_outbox` + `channel_listings` (wix site, page, product/variant ids) |
| 1.4 | Table `partner_api_keys` + `partner_package_allowlist` (empty until Phase 5) |
| 1.5 | Admin UI: Product Code field; sync status badge; “Retry sync” |
| 1.6 | Helper: `retailPrice(tradePrice)` using env multiplier |

**Status:** Implemented — migration `20250603120000_integration_phase1.sql`; run on Supabase before using admin integration UI.

**Exit criteria:** Can save Product Code on a package; outbox rows insert manually; no external calls yet.

---

### Phase 2 — Salesforce products & orders ✅ Implemented in repo

**Goal:** Portal product → SF Product2; portal order → Opp + Quote.

See **`docs/PHASE2_SALESFORCE_SETUP.md`** for your step-by-step checklist.

| Step | Action | Status |
|------|--------|--------|
| 2.1 | Salesforce OAuth (PKCE) + refresh token storage | Done |
| 2.2 | Product sync → Product2 + PricebookEntry | Done |
| 2.3 | Order sync → Account + Opportunity + line item (+ Quote if allowed) | Done |
| 2.4 | Cron + manual “Process sync queue” | Done |
| 2.5 | Package save → `product.upsert` | Done (Phase 1) |
| 2.6 | Checkout / admin order / approval → `order.placed` | Done |
| 2.7 | Inventory change → re-queue product sync | Done |
| 2.8 | Invoice **paid** / cancel → outbox `order.outcome` → SF Closed Won / Closed Lost | Done |

**Won-deal alignment (Option B):** Booking creates Opportunity at **Proposal** only. **Closed Won** runs when portal invoice is **paid** (admin status or Xero webhook), so DLRS criteria `Is_Won__c = True` matches real revenue. Unpaid bookings never count as sold in SF rollups.

**Exit criteria:** Connect in Admin → Integrations; map Product Code; process queue; verify Opportunity in sandbox; mark test invoice paid and confirm stage → Closed Won.

---

### Phase 2.5 — Xero invoicing ✅ Implemented in repo

**Goal:** When an order is placed, create a Xero **ACCREC** invoice and advance portal payment status; optional webhook when paid.

See **`docs/PHASE2.5_XERO_SETUP.md`**.

| Step | Action | Status |
|------|--------|--------|
| 2.5.1 | Xero OAuth + tenant storage (`integration_settings`) | Done |
| 2.5.2 | `invoice.create` outbox on order placed | Done |
| 2.5.3 | Create Xero invoice (agent contact, line from order) | Done |
| 2.5.4 | Portal invoice → `awaiting_payment` when Xero invoice created | Done |
| 2.5.5 | Webhook `POST /api/webhooks/xero` (paid → portal `paid`) | Done (configure in Xero) |
| 2.5.6 | Admin → Integrations → Xero connect UI | Done |

**Also in Phase 2 (orders):** Salesforce Opportunity gets **primary Contact** from portal guest (name, email, phone, address); matches existing Contact by email.

**Exit criteria:** Connect Xero in Admin; place order; process queue; invoice in Xero; portal shows Awaiting payment.

**Not in 2.5 yet:** Auto-email invoice (`XERO_INVOICE_EMAIL_ON_CREATE`), SF stage sync on paid, separate Xero contact for end guest (currently bills agent company).

---

### Phase 3 — Listing content sync ✅ Done (Jun 2026)

**Goal:** Descriptions and image URLs follow portal → SF (and payload for Wix).

See **`docs/PHASE3_LISTING_SYNC.md`**.

| Step | Action | Status |
|------|--------|--------|
| 3.1 | Canonical `CatalogListingPayload` | Done |
| 3.2 | SF: Product2 content fields (Description, Inclusions, Image URL, Gallery, Brochure) | Done |
| 3.3 | Document Wix writable vs manual fields | Done (Phase 4 doc) |
| 3.4 | Package save → `product.upsert` → SF (+ Wix payload stub) | Done |

**Exit criteria:** Edit description/image in portal → SF product updates within minutes. ✅ UAT passed.

---

### Phase 4 — Wix ✅ Code complete (ops go-live remaining)

**Goal:** Shared stock; retail price = trade × 1.10; paid Wix orders hit the same booking engine.

See **`docs/PHASE4_WIX_SETUP.md`**.

| Step | Action | Status |
|------|--------|--------|
| 4.1 | `channel_listings` admin UI + **Integrations** tab on package page | Done |
| 4.2 | Price + stock sync (Catalog V1) | Done |
| 4.3 | Content sync (title, description, includes, brochure, images) | Done |
| 4.4 | **Auto-create** Wix product on new package (Sell on Wix) | Done |
| 4.5 | **Order webhook** → `place_wix_order` → SF Closed Won | Done (script-tested) |
| 4.6 | Wix prepaid: portal invoice `paid`, **no Xero ACCREC email** | Done |
| 4.7 | Delete package → Wix + SF + Supabase wipe | Done |
| 4.8 | Production Wix **Order paid** automation → portal webhook | **Ops — configure in Wix** |
| 4.9 | Map / auto-create all live Wix sellables | **Ops — per package** |

**Exit criteria:** Real Wix purchase on production → qty drops in portal; SF Opportunity Closed Won; no Xero email to customer.

---

### Phase 5 — Partner API v1 ⏸ Deferred

DB tables (`partner_api_keys`, `partner_package_allowlist`) and `sell_on_partners` flag exist. **API endpoints and admin UI not built** — revisit when a pilot partner is ready.

| Step | Action | Status |
|------|--------|--------|
| 5.1 | `GET /api/v1/catalog` | Not started |
| 5.2 | `GET /api/v1/availability` | Not started |
| 5.3 | `POST /api/v1/orders` | Not started |
| 5.4 | Admin: partner keys + allowlist | Not started |
| 5.5 | Pilot partner docs | Not started |

---

### Phase 6 — Polish 🚧 Ongoing

| Step | Action | Status |
|------|--------|--------|
| 6.1 | Admin UX: Inventory nav, Integrations tab, simplified package forms | Done (Jun 2026) |
| 6.2 | Orders table layout + filter persistence | Done |
| 6.3 | Remove legacy “Awaiting invoice” step from agent/admin UI | Done |
| 6.4 | Admin **Sales availability** grid | Not started |
| 6.5 | Google Sheet nightly export | Not started |
| 6.6 | Bulk CSV product import | Not started |
| 6.7 | Alerts when sync fails > N times | Not started |
| 6.8 | Full SF product mapping (~254 rows) | Not started |

---

## Your day-to-day after Phase 4

1. **New product** → Admin → **Inventory** → New package (include length in display name, e.g. *3 Day Legend Paddock Club*). Tick **Sell on Wix** to auto-create the Wix Stores product.
2. **Stock** → Package → **Inventory & cost** → add cost layer (preferred). Use **Manual hold** to reserve units.
3. **Images/copy** → Edit package details → auto-sync SF + Wix.
4. **Website price** → Change trade price or per-package Wix multiplier on **Integrations** tab.
5. **Agent sale** → Trade portal checkout or Admin → Place order → Xero invoice emailed.
6. **Wix sale** → Customer pays on site → webhook → SF Closed Won (no Xero email).
7. **Mistake package** → Delete package (no orders) → removes Wix + SF + portal row.
8. **Do not** edit Wix/SF stock manually after go-live.

---

## Paddock & partner access (later)

| Channel | Paddock Club |
|---------|----------------|
| Trade portal agents | Existing `requires_booking_approval` rules |
| Wix | Instant book (no approval) per your instruction |
| Partner API | **Blocked by default**; allowlist per `partner_api_keys` for specific packages only |

---

## Remaining info we still need (small list)

| Item | Why |
|------|-----|
| SF API names for custom fields | `Available_Quantity__c`, Event lookup, Package Items object API name |
| Wix API key + Site ID + Product/Variant IDs | See `docs/PHASE4_WIX_SETUP.md` Part B |
| Wix cart type confirmation | Stores API vs Velo custom → picks integration code |
| Wix **paid order** webhook / automation | Configure after API keys; sample JSON in Phase 4 doc |
| `WIX_AGENT_PROFILE_ID` | Approved portal profile uuid for Wix orders |
| Who generates **new** Product Codes | SF auto-number vs portal sequential |
| Currency rules | USD on Wix vs USD trade portal — confirm single currency per product |

---

## Appendix A: Salesforce sandbox + Connected App

### A1. Create sandbox

1. Log in to production: `https://zksports.lightning.force.com`
2. Setup → **Sandboxes** → **New Sandbox**
3. Name: `devintegration` (or similar), type **Developer** or **Partial Copy** (partial if you need real product data).
4. Wait for email; log in to `https://test.salesforce.com` with sandbox username.

Build **Phase 2 code against sandbox only** until UAT passes.

### A2. Connected App (in sandbox)

1. Setup → **App Manager** → **New Connected App**
2. Name: `ZK Trade Portal Integration`
3. Enable **OAuth Settings**
4. Callback URL: `https://your-app.vercel.app/api/integrations/salesforce/callback` (dev can give exact URL later)
5. Scopes: `api`, `refresh_token`, `offline_access`
6. Save → copy **Consumer Key** and **Consumer Secret**
7. Setup → **Manage Connected Apps** → your app → **Edit policies** → Permitted users: Admin approved users; add integration user

### A3. Integration user & token

1. Create (or use) integration user license
2. OAuth **refresh token** flow (dev implements once; stores `SF_REFRESH_TOKEN` in Vercel)
3. Send dev: Consumer Key, Consumer Secret, sandbox login URL, refresh token after first auth

### A4. Matt Johnson as default owner

1. Setup → Users → Matt Johnson → copy **User ID** (15/18 char, starts with `005`)
2. Set `SALESFORCE_DEFAULT_OWNER_ID` in Vercel

---

## Appendix B: Wix developer checklist

Send to whoever manages [zk-sports.com](https://www.zk-sports.com/):

1. Invite developer to site with **Admin** or **Co-owner**
2. Enable **Velo** (Dev Mode)
3. Enable **Wix Stores / eCommerce** webhooks for **Order paid** (or equivalent)
4. List all product IDs on [Monaco Velocity page](https://www.zk-sports.com/2026-monaco-f1-gp-velocity-terrace) for mapping sheet
5. Confirm checkout is **Wix Payments** (card at booking) — yes per your answer
6. Provide **test mode** purchases for webhook debugging

---

## Appendix C: One-time migration (254 SF products)

**Do not** auto-create 254 portal rows without review.

1. Export SF Sales List (Product Code, name, stock, available).
2. For each **active** sellable on portal today: add `product_code` to existing `packages.id`.
3. For SF-only products: either create portal package or mark `sync_from_sf` one-time import.
4. Monaco Velocity: map 2-day / Sunday / Saturday lines to three portal packages + SF codes.

---

## Timeline (estimate)

| Phase | Duration |
|-------|----------|
| 0 Setup | 1 week |
| 1 Plumbing | 1 week |
| 2 Salesforce | 2–3 weeks |
| 3 Content sync | 1–2 weeks |
| 4 Wix | 2–4 weeks |
| 5 Partner API | 2–3 weeks |
| 6 Polish | ongoing |

**First business value:** Phase 2 (orders + products in SF without Wix).  
**First true omnichannel stock:** Phase 4.

---

## What we build first (when you say go)

1. **Phase 1** migration + admin Product Code + outbox (safe).
2. **Phase 2** against your **sandbox** (you create Connected App per Appendix A).

No Wix or partner API until SF loop is proven in sandbox.

---

## Document control

- Stakeholder answers: Enterprise SF, Product Code ID, Matt owner, Wix +10%, platform-first, Wix instant paddock, partner paddock allowlist later.
- Screenshots: SF Sales List, Product detail, Quotes, Opportunity, Person Account types, Wix Velocity page, portal Monaco packages.
