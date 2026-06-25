# Phase 2 — Salesforce setup (your checklist)

## 1. Run Supabase migrations

Apply both (if not already):

- `20250603120000_integration_phase1.sql`
- `20250604120000_integration_settings.sql`
- `20250605120000_admin_cancel_order.sql`
- `20250606120000_integration_xero.sql`
- `20250607120000_order_line_item_status.sql` (tracks the SF line item separately so it can retry after a DLRS fix)

## 2. `.env.local` (minimum)

```bash
SALESFORCE_INSTANCE_URL=https://zksports--portalwix.sandbox.my.salesforce.com
SALESFORCE_CLIENT_ID=...
SALESFORCE_CLIENT_SECRET=...
SALESFORCE_DEFAULT_OWNER_ID=005V400000LU5ZFIA1
SALESFORCE_USE_SANDBOX=true
RETAIL_PRICE_MULTIPLIER=1.10
CRON_SECRET=choose-a-long-random-string
```

`SALESFORCE_REFRESH_TOKEN` is optional — filled automatically when you **Connect** (stored in `integration_settings`).

## 3. Connect Salesforce (one time)

1. `npm run dev`
2. Log in as **admin**
3. **Admin → Integrations**
4. Click **Connect Salesforce** → log in to **sandbox** → Allow
5. You should return with “connected successfully”

## 4. Map a test product

1. **Admin → Catalog** → open a package that exists in SF Sales List
2. **Channels & Salesforce** → enter **Product Code** (e.g. `PR - 000551`) and **Salesforce Product Id** (18-char `01t…` from the product page URL — use the record your team actually opens)
3. **Queue sync again** (runs sync immediately) or **Integrations → Process sync queue now**
4. Hard-refresh the **same** Salesforce product page and confirm Unit Price, stock fields, and Last Modified

**Duplicate products:** If Product Code exists on one SF product but staff use another (no code on that record), sync only updates the coded product unless you set **Salesforce Product Id** to the record you care about.

Diagnostic: `npx tsx scripts/sf-product-sync-diagnose.ts`

## 5. Booking confirmation email CC

Set in `.env.local` / Vercel (comma-separated):

```bash
FINANCE_NOTIFICATION_EMAILS=matt@zk-sports.com
ORDER_CONFIRMATION_CC=bookings@zk-sports.com
```

Restart dev server after changing env locally; redeploy after changing env in Vercel.

## 6. Test an order

1. Place a test booking (portal or admin place order)
2. **Integrations** → **Process sync queue now**
3. Check sandbox — new **Opportunity** at **Proposal** (not Closed Won) with **Products** line, linked to agent **Account**

### Won deals only (Option B — portal + DLRS)

DLRS **ProductTotalSales** should use **Relationship Criteria** `Is_Won__c = True` so only paid deals count. The portal must match that lifecycle:

| Portal step | Invoice status | Salesforce Opportunity stage |
|-------------|----------------|------------------------------|
| Booking placed | `awaiting_invoice` | **Proposal** (`SALESFORCE_OPPORTUNITY_STAGE`) |
| Xero invoice created | `awaiting_payment` | Stays **Proposal** |
| Invoice **paid** (admin or Xero webhook) | `paid` | **Closed Won** (`SALESFORCE_OPPORTUNITY_STAGE_WON`) — outbox `order.outcome` |
| Order **cancelled** | — | **Closed Lost** (`SALESFORCE_OPPORTUNITY_STAGE_LOST`) |

If a client never pays, the Opportunity stays Proposal → `Is_Won__c` stays false → rollups do not treat it as sold.

```bash
SALESFORCE_OPPORTUNITY_STAGE=Proposal
SALESFORCE_OPPORTUNITY_STAGE_WON=Closed Won
SALESFORCE_OPPORTUNITY_STAGE_LOST=Closed Lost
```

Use exact **Stage** picklist labels from your sandbox. After marking paid, run **Process sync queue** so `order.outcome` runs.

**ProductTotalSales (production):** Parent **Product**, Child **OpportunityLineItem**, Relationship **`Product2Id`**, Criteria **`Is_Won__c = True`** (and any org filters like `Is_VDS__c` only if portal lines satisfy them).

### ProductTotalSales rollup (your screenshot)

**“Child object”** is not a separate row in Object Manager — in the DLRS form it is **Child Object = Opportunity Product** (`OpportunityLineItem`).

Your **ProductTotalSales** rollup:

| Setting | Your value | Note |
|---------|------------|------|
| Parent Object | Account | Rolls up to the **agent’s account** |
| Child Object | OpportunityLineItem | Correct child type |
| Relationship Field | Product2Id | Links line → **Product**, not Account — often wrong when parent is Account; compare **EventSales** (likely uses `Opportunity.AccountId`) |
| Relationship Criteria | `Is_VDS__c = TRUE` | **Portal lines usually fail this filter** — EventSales has blank criteria |

**Suggested sandbox test:** clear **Relationship Criteria** (blank like EventSales), set **Relationship Field** to the field that links Opportunity Product → Account (often `Opportunity.AccountId` in DLRS), **Save**, tick **Active**, retry order sync.

### Chained DLRS error (`dlrs_OpportunityLineItemTrigger` → `dlrs_Product2Trigger` / `INVALID_CROSS_REFERENCE_KEY`)

This is the error you hit after **re-enabling ProductTotalSales**. Read the error top to bottom — it is a **two-link chain**, and only the second link is broken:

```
1. Portal inserts OpportunityLineItem (product line)
2. dlrs_OpportunityLineItemTrigger fires → rolls up to Product2 01tV400000QForxIAD   ← ProductTotalSales (Value Sold) — fine
3. That Product2 update fires dlrs_Product2Trigger → rolls Product2 up to custom
   object a0NV400000GmijtMAB → INVALID_CROSS_REFERENCE_KEY: invalid cross reference id: []   ← BROKEN
```

- **Rollup A** = `OpportunityLineItem → Product2` (your **ProductTotalSales** — correct, leave it).
- **Rollup B** = `Product2 → a0N… custom object` (a pre-existing org rollup writing a **blank reference**). This is the one to fix.

While Rollup A was inactive, the line never touched Product2, so Rollup B never fired. Re-enabling A made every line insert touch Product2 → fire the broken B → the whole insert rolls back. **No portal change can insert a line while a synchronous Apex trigger throws.** Fix it in Salesforce — pick one:

1. **Fix Rollup B (correct):** Open **Lookup Rollup Summaries**, find **Child = Product2, Parent = the `a0N…` object**. Repair the blank lookup: populate the Product2 → parent lookup field, add **Relationship Criteria** to exclude blank lookups, or correct parent record `a0NV400000GmijtMAB`.
2. **Decouple it (fastest):** Set **Rollup B Calculation Mode = Scheduled** and schedule the `RollupJob` Apex. Product2 updates no longer fire B inside the line-item transaction, so the insert succeeds. *(Value Sold still needs B's blank-reference fixed to aggregate, but orders will sync.)*
3. **Sandbox validation only:** Temporarily **deactivate Rollup B**, confirm end-to-end, then fix it before production.

**✅ Confirmed root cause + fix (portalwix sandbox, Jun 2026):** The **Event Sales** rollup (`Child = Product2`, `Parent = Event__c`) was firing in **Realtime** mode and trying to update a **deleted** `Event__c` record (`a0NV400000GmijtMAB`) that a product's `Event_Name__c` lookup still pointed at — hence `INVALID_CROSS_REFERENCE_KEY: []`. **Fix that worked:** set **Event Sales → Calculation Mode = Scheduled** and **Calculation Sharing Mode = System**. Orders then synced. Follow-ups: (a) clear/repoint the product's `Event_Name__c` lookup off the deleted Event, and (b) schedule the `RollupJob` Apex if Event totals should recalculate.

**Portal resilience (already built):** The portal now creates the **Opportunity once and keeps it** even if the line item is rejected. The order is flagged `salesforce_line_item_status = failed` and shown under **Integrations → Latest sync error**. Once you fix the Salesforce rollup, click **Process sync queue** again — the portal **adds the line to the existing Opportunity** (it checks first, so **no duplicate Opportunity** and no duplicate line). The same applies when an invoice is marked **paid** → Closed Won.

### DLRS error on order sync (`dlrs_OpportunityLineItemTrigger` / `INVALID_CROSS_REFERENCE_KEY`)

Your org runs **Declarative Lookup Rollup Summaries** (managed package — trigger names start with `dlrs_`). Adding an Opportunity Product rolls up to Product2 and fails when a rollup has a **blank lookup**. That is fixed in Salesforce, not in the portal.

**Finding DLRS (Quick Find “dlrs” often shows nothing)**

1. **Setup → Installed Packages** — look for **Declarative Lookup Rollup Summaries** or publisher **Andrew Fawcett** / namespace **dlrs**.
2. **App Launcher** (waffle) — open app **Lookup Rollup Summaries** (if installed).
3. **Setup → Apex Triggers** — search `dlrs` (e.g. `dlrs_Product2Trigger`, `dlrs_OpportunityLineItemTrigger`).
4. **Setup → Custom Metadata Types** or **Custom Objects** — object may be `Lookup Rollup Summary` (`dlrs__LookupRollupSummary__c`).

You need **Customize Application** / admin profile to see package settings. If the package is not listed under Installed Packages, ask whoever owns production/sandbox to fix rollups there — your user may be sandbox-only without package visibility.

**Sandbox workaround** (creates Opportunity + Quote only, no product line):

```bash
SALESFORCE_ORDER_SKIP_LINE_ITEMS=true
```

Restart the app, process the queue again, then add the product line manually in Salesforce until DLRS is fixed.

If a failed sync left a duplicate Opportunity in Salesforce, delete it before retrying.

## 7. Stale sync queue after manual Supabase delete

If you delete an order (or package) directly in Supabase, **`integration_outbox`** may still have pending jobs pointing at that id. The queue processor now **skips** those automatically and continues with live orders.

To clean up manually in **Table Editor → `integration_outbox`**:

- Filter `status` = `pending` or `failed`
- Delete rows where `payload` → `order_id` is the deleted UUID, **or**
- Run SQL: `delete from integration_outbox where payload->>'order_id' = 'YOUR-ORDER-UUID';`

To **re-queue** a live order for Salesforce: upsert happens when the order is placed; if needed, set the order’s `salesforce_sync_status` to `pending` and insert/update an outbox row with `event_type` = `order.placed` and `idempotency_key` = `order.placed:{order_id}` (or place a fresh test order).

**Prefer Admin → Orders → Cancel** over raw deletes — cancel restores stock and queues Closed Lost in Salesforce.

## 8. Cancel a test order

Use **Admin → Orders → Cancel** (do not delete rows in Supabase). This marks the order `cancelled`, restores portal stock, queues product sync, and queues Salesforce **Closed Lost** (`order.outcome`). Process the sync queue to apply the stage in SF.

Apply migration `20250605120000_admin_cancel_order.sql` in Supabase first.

## 9. Optional custom fields (for stock + unit price on Product)

**Not required to connect** — only add these if you want the portal to **push** values into Salesforce.

1. In Salesforce: **Setup → Object Manager → Product → Fields & Relationships**
2. Find the row for **Available Quantity**, **Stock Quantity**, and **Unit Price**
3. Copy each **Field Name** (API name), e.g. `Available_Quantity__c`

Add to `.env.local` (use your org’s exact API names):

```bash
# Defaults match ZK portalwix sandbox — omit if unchanged:
SALESFORCE_FIELD_AVAILABLE_QTY=Available_Quantity__c
SALESFORCE_FIELD_STOCK_QTY=Stock_Quantity__c
SALESFORCE_FIELD_UNIT_PRICE=Unit_Price__c
SALESFORCE_FIELD_EVENT=Event_Name__c
SALESFORCE_FIELD_SOURCE=Source__c
# Optional (read-only — portal never writes these):
SALESFORCE_FIELD_QUANTITY_SOLD=Quantity_Sold__c
SALESFORCE_FIELD_VALUE_SOLD=Value_Sold__c
# Phase 3 listing content (see docs/PHASE3_LISTING_SYNC.md):
SALESFORCE_FIELD_IMAGE_URL=Image_URL_c__c
SALESFORCE_FIELD_GALLERY=Gallery_Images_c__c
SALESFORCE_FIELD_INCLUDES=Inclusions__c
SALESFORCE_FIELD_BROCHURE_URL=Brochure_URL_c__c
```

**Inventory sync behaviour (portal is the master for stock):**

- **Stock Quantity** (SF) = **total units ever received** = sum of the package's cost layers. It only changes when you **buy more stock** (add a cost layer / restock) or edit a layer. A booking does **not** lower it.
- **Available Quantity** (SF) = **sellable now** = `qty_available − qty_held`. It drops on every booking and is restored on cancel.
- **Quantity Sold** / **Value Sold** (SF) are owned by Salesforce DLRS (Closed Won / paid deals) and are **never** overwritten by the portal.

**When stock updates in SF (automatic):**
| Event | Portal inventory | SF Stock / Available |
|-------|------------------|----------------------|
| **Buy more stock** (add cost layer) | `qty_available` ↑ | Product sync queued → **Stock** ↑ and **Available** ↑ |
| **Booking placed** | `qty_available` ↓ | Product sync queued → **Available** ↓ only (**Stock** unchanged) |
| **Order cancelled** | stock restored | Product sync queued → **Available** restored |
| **Invoice paid** | unchanged | DLRS updates **Quantity Sold** / **Value Sold** on Closed Won — **Stock** unchanged |
| Unpaid booking | stays committed | **Available** stays reduced until cancel |

Example: product starts with **17** received → Stock 17, Available 17. Sell 2 → Stock **17**, Available **15**. Buy 10 more → Stock **27**, Available **25**.

**New products (portal-driven):** create the package in the portal and **leave Product Code blank**. On first sync the portal will:

1. **Auto-create** the Product2 in Salesforce (`Name`, `Family`, `Unit_Price__c`, stock fields). **Product Code is not sent** — your Salesforce automation assigns the next number (e.g. `PR - 000552`).
2. Create the **Standard Price Book entry** (via your org Flow and/or the portal).
3. Save the new **Salesforce Product Id** and the **assigned Product Code** back on the package automatically.

**Linking an existing Salesforce product** (e.g. football events that only live in SF today): paste the **18-char Product Id** or enter the **Product Code** from the Sales List — sync updates that record; it does not create a duplicate.

Products that exist only in Salesforce and are not on the trade portal are unchanged — the portal never pulls or overwrites them unless you explicitly link a package to them.

If Salesforce validation blocks auto-create, the sync returns a clear message — create the product manually in SF and paste its Id. Set `SALESFORCE_PRODUCT_FAMILY` in `.env.local` if your org requires a specific Product Family value.

**Unit Price** is important if you see errors about `Product_AutoCreationOfPBE` and missing `UnitPrice` — your org has a Flow that runs when products are saved.

If unsure of API names, ask your SF admin or click a field in Setup and read the URL/API name.

**Do not guess** — wrong names cause sync failures.

## 10. Production later

- Repeat External Client App in **production** org
- Add same env vars in **Vercel** for `zk-sports.trade`
- Connect once on production Integrations page

## 11. Automatic sync (no manual button)

**Built in:** When an order is placed, a package is saved, an invoice is marked paid, or an order is cancelled, the portal **queues and processes** the sync in the background. You do not need to click **Process sync queue now** for normal use.

**Production safety net:** `vercel.json` runs a cron every **5 minutes** on `/api/cron/integration-outbox` (releases expired inventory holds, retries failed sync jobs). Set `CRON_SECRET` in Vercel env.

**Manual button** on Admin → Integrations is still there for debugging or forcing a retry.

Local dev: restart `npm run dev` after pulling changes; background processing uses Next.js `after()` so checkout returns immediately while Salesforce sync runs.
