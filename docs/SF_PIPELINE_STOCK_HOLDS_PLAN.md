# Plan: Salesforce open-opportunity stock holds + auto-expiry

**Status:** Planning only — not implemented as the full product behaviour below.  
**Context:** Spanish Club Suite (and similar offline deals) can show **Available 60** in Salesforce while the portal correctly treats sellable as **−12 / 0** because **72** units sit in open opportunities (Pipeline tab).  
**Goal:** Open opportunities should **hold stock in Salesforce too**, so Available is not shown as buyable there; after **1–2 weeks** without close, deals auto-expire to **Closed Lost**, stock releases, and portal / Wix / Salesforce stay aligned.

---

## 1. What we want (product rules)

| Rule | Intended behaviour |
|------|--------------------|
| Closed Won | Counts as **sold** (Quantity Sold / Value Sold / Stock Sources sold). |
| Open opportunity (Proposal, etc.) | **Holds** stock — not available to sell elsewhere. |
| Closed Lost / expired | **Releases** hold — Available goes back up. |
| Oversold (won + pipeline > stock) | Storefronts show **0**; admin may show a negative “oversold” gap. Salesforce Available stays **≥ 0**. |
| Auto-expiry | Open offline opportunities older than **N days** (default **14**, option **7**) move to **Closed Lost** and free stock everywhere. |

**Do not use negative Available in Salesforce.** Number fields and any `Quantity_Sold = Stock − Available` formula break if Available is driven to 0 for the wrong reason or goes negative.

---

## 2. Current state (as of this plan)

### Portal (already largely in place)

- Admin inventory can show **SF Pipeline** and commitment sellable (e.g. `200 − 140 − 72 = −12`).
- Storefront / Wix use `package_inventory` floored at **0** after linked-group heal that subtracts **closed-won + open pipeline**.
- Salesforce **Available** is pushed as **Stock − Closed Won only** (e.g. **60**), on purpose, so Quantity Sold does not jump to full Stock when pipeline is large.

### Salesforce today

- **Pipeline** tab already lists open opportunity line quantities (source of truth for “held by deals”).
- **Available Quantity** on Product2 does **not** currently reserve those open lines (shows remaining after closed-won only).
- **Quantity Sold** must be **Closed Won only** (DLRS / rollup). If it is formula `Stock − Available`, zeroing Available to “hold” pipeline will corrupt Sold (e.g. Sold → 200).

### Partial code already in the repo (not the full hold model)

`lib/integrations/salesforce/expire-stale-open-opportunities.ts`:

- Can move stale **open** opportunities to **Closed Lost** after N days (default **14**).
- Skips opportunities that belong to **portal checkout orders**.
- **Disabled by default** — enable with `SALESFORCE_EXPIRE_STALE_OPEN_OPPORTUNITIES=1`.
- Optional: `SALESFORCE_OPEN_OPPORTUNITY_EXPIRY_DAYS` (e.g. `7` or `14`).

That covers **expiry → Closed Lost**. It does **not** yet redefine Salesforce Available as “stock − won − open pipeline”.

---

## 3. Recommended design (when we implement)

### 3.1 Meaning of Product2 fields

| Field | Meaning after change |
|-------|----------------------|
| **Stock Quantity** | Units bought / received (unchanged). |
| **Quantity Sold** | Closed Won units only (DLRS/rollup — **never** Stock−Available). |
| **Available Quantity** | Units still free to sell = `max(0, Stock − ClosedWon − OpenPipeline)`. |
| **Value Sold** | Closed Won revenue only (already aligned in portal sync). |
| **Stock Sources Quantity Sold** | Closed Won attribution (unchanged). |

Open pipeline remains visible on the product **Pipeline** tab; Available simply stops advertising those units as free.

### 3.2 Sync ownership

1. **Portal cron / pull** reads Closed Won + open (non-lost) opportunity line quantities per Product2 (already used for portal sellable).
2. Portal writes `package_inventory` sellable = `max(0, stock − won − pipeline)`.
3. Portal pushes Salesforce **Available** = same formula (floored at 0) — **only if** Quantity Sold is not a Stock−Available formula.
4. On Closed Lost / expiry, won/pipeline totals change → next heal/pull raises Available and portal stock together; Wix gets channel sync as today.

### 3.3 Auto-expiry flow

```
Open opp older than N days (CreatedDate or LastActivity — decide with team)
  → Stage = Closed Lost (portal job or SF Flow)
  → Opportunity no longer in “open pipeline” sum
  → Portal heal: sellable ↑
  → SF Available ↑
  → Wix / trade portal stock ↑
```

**Prefer one owner for expiry** (pick in implementation):

| Option | Pros | Cons |
|--------|------|------|
| **A. Portal cron** (extend existing `expireStaleOpenOpportunities`) | One place with inventory heal; already sketched | Needs SF API update permission on Opportunity |
| **B. Salesforce Flow / scheduled path** | Native to SF; sales team sees it in Setup | Must still notify portal (Platform Event / outbound) or wait for pull |

**Recommendation:** Start with **A** (portal cron), keep SF Flow as optional later. Always run **inventory pull/heal** after expiry in the same tick.

### 3.4 What “expire” should not touch

- Opportunities linked to **portal orders** (`orders.salesforce_opportunity_id`) — already skipped in the stub.
- **Closed Won** / already closed deals.
- Deals the team marks as “do not auto-expire” (optional checkbox — see Salesforce setup).

---

## 4. What you need to do in Salesforce (team checklist)

Nothing has to be built in SF for a first portal-only expiry + Available push, but these checks/changes make it safe and clear for sales users.

### Required before Available starts reserving pipeline

1. **Confirm Quantity Sold is Closed Won only**  
   - Setup → Object Manager → **Product** → Fields → **Quantity Sold**.  
   - **OK:** DLRS / rollup / summary of Closed Won opportunity products.  
   - **Not OK:** Formula like `Stock_Quantity__c − Available_Quantity__c`.  
   - If it is a formula, **change it to Closed Won rollup** (or ask SF admin) **before** we push pipeline-reduced Available. Otherwise Sold will corrupt again.

2. **Confirm Available Quantity is editable by the integration user**  
   - Field must be updateable via API (not formula-only).

3. **Confirm Closed Lost stage API name**  
   - Matches portal env `SALESFORCE_OPPORTUNITY_STAGE_LOST` (today typically `Closed Lost`).

4. **Confirm how sales creates offline deals**  
   - Opportunity + **Products** (OpportunityLineItem) on the correct Product2.  
   - Pipeline tab quantities are what we hold against.

### Strongly recommended in Salesforce

5. **Optional: “Hold until” / “Do not auto-expire” on Opportunity**  
   - Custom checkbox e.g. `Skip_Auto_Expire__c`, or date `Pipeline_Hold_Until__c`.  
   - Portal expiry job respects these so VIP deals are not closed after 14 days.

6. **Optional: validation or UI help text on Product**  
   - Clarify: Available = free to sell; Pipeline = reserved; Sold = Closed Won.

7. **Optional: report**  
   - “Open pipeline by product” (sum of open line quantities) for ops — same numbers the portal uses.

### Not required

- Negative Available.
- Changing Stock Sources to include pipeline (pipeline is not “sold”).
- Manual Available edits on every deal (automation should own Available).

---

## 5. Portal / engineering work (when approved)

1. **Flip Available push** from `Stock − ClosedWon` to `Stock − ClosedWon − OpenPipeline` (floor 0), gated on Quantity Sold being safe (see §4.1).
2. **Enable and wire expiry**  
   - Turn on `SALESFORCE_EXPIRE_STALE_OPEN_OPPORTUNITIES=1`.  
   - Set `SALESFORCE_OPEN_OPPORTUNITY_EXPIRY_DAYS=7` or `14`.  
   - Run inside integration cron **before** inventory pull/heal.  
   - After expiry, heal linked groups + enqueue Wix/channel sync.
3. **Decide expiry clock:** `CreatedDate` vs `LastModifiedDate` vs custom Hold Until (team call).
4. **Admin UI copy:** Salesforce Available may match portal storefront (0 when oversold); commitment −12 remains admin-only.
5. **Tests / dry-run:** Spanish Club Suite (200 / 140 / 72), Dutch Club Suite, a deal that should not expire (portal order).

---

## 6. Decisions for the team (before build)

| # | Question | Options |
|---|----------|---------|
| 1 | Expiry window? | 7 days / 14 days / custom per opp |
| 2 | Expiry clock? | Created date / last activity / Hold Until field |
| 3 | Who closes the opp? | Portal cron / Salesforce Flow |
| 4 | VIP escape hatch? | Checkbox or Hold Until date on Opportunity |
| 5 | Is Quantity Sold safe to change Available? | Must confirm §4.1 first |
| 6 | Should SF Available match portal 0 when oversold? | Yes (recommended) / keep showing Stock−Won only |

---

## 7. Example (Spanish Club Suite)

| Metric | Today (typical) | After this plan |
|--------|-----------------|-----------------|
| Stock | 200 | 200 |
| Sold (Closed Won) | 140 | 140 |
| Open pipeline | 72 (Pipeline tab) | 72 (Pipeline tab) |
| SF Available | 60 | **0** (`max(0, 200−140−72)`) |
| Portal / Wix sellable | 0 | 0 |
| Admin oversold gap | −12 | −12 (optional display) |

After 14 days, if those 72 units’ opportunities auto-Close Lost and nothing else changes: Available → **60**, portal/Wix → **60**.

---

## 8. Risks

- **Quantity Sold formula** + low Available → Sold inflates (known Spanish bug). Blocked until §4.1 is fixed.
- **Aggressive expiry** may Close Lost deals sales still intend to win — need Skip/Hold Until and clear comms.
- **Quote-synced opportunities** (e.g. Palo Alto / Proposal) must still appear in open-pipeline SOQL (non-lost − won); already validated for Madrid.

---

## 9. Suggested rollout

1. Team confirms §6 decisions and §4.1 Quantity Sold type.  
2. Enable **expiry only** in staging (`SALESFORCE_EXPIRE_STALE_OPEN_OPPORTUNITIES=1`, 14 days) — Available formula unchanged.  
3. Fix Quantity Sold if needed.  
4. Enable **pipeline-reduced Available** push in staging; verify Spanish + one healthy product.  
5. Production: expiry first, then Available hold, monitor one race weekend.

---

## 10. Related code / docs (reference)

| Path | Role |
|------|------|
| `lib/integrations/salesforce/expire-stale-open-opportunities.ts` | Stale open → Closed Lost (feature-flagged) |
| `lib/integrations/salesforce/sold-metrics.ts` | Won / committed / open pipeline line sums |
| `lib/inventory/linked-group-inventory.ts` | Portal sellable = stock − won − pipeline; SF Available push currently closed-won only |
| `lib/integrations/salesforce/products.ts` | Product2 Available / Value Sold sync |
| `docs/PHASE2_SALESFORCE_SETUP.md` | Field map and inventory sync notes |
| `docs/PHASE3_LISTING_SYNC.md` | Product2 field API names |

---

*Created for later implementation. Do not treat this document as a go-live checklist until §4.1 and §6 are signed off.*
