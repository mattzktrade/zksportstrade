# Phase 4 — Wix integration setup

**Pilot package (UAT):** `monaco-velocity-terrace-sunday-2026` — 2026 Monaco F1 GP Velocity Terrace Sunday (Wix product in Catalog).

Spanish GP Paddock Club remains the production target once Wix listing exists.

**Goal:** Portal is master for stock + trade price → Wix shows retail price and live qty. Paid Wix orders hit the same booking engine as the trade portal (Salesforce + Xero).

---

## Part A — Portal `.env.local`

```bash
# Wix Headless / API Keys (from Wix dashboard — see Part B step 1)
WIX_API_KEY=
WIX_SITE_ID=

# Secret you choose — must match the header on webhook calls
WIX_WEBHOOK_SECRET=

# UUID of an approved admin/agent profile in Supabase — Wix orders are attributed to this account
WIX_AGENT_PROFILE_ID=

# Already used for retail price on Wix (default 1.10 = +10%)
RETAIL_PRICE_MULTIPLIER=1.10
```

Restart `npm run dev` after changing env.

**Finding `WIX_AGENT_PROFILE_ID`:** Supabase → Table Editor → `profiles` → copy the `id` (uuid) for your admin user (the one you log into the portal with). It must be an approved agent/admin account.

Apply migration: `supabase/migrations/20250610120000_phase4_wix_orders.sql` (re-run after the parameter-order fix if you saw error `42P13`).

---

## Part B — Wix dashboard (baby steps)

### Step 1 — API key + Site ID

1. Log in to [Wix](https://www.wix.com/dashboard/) (your screenshot: **ZK Sports** home).
2. Left menu → **Settings** (gear at bottom) → **API Keys** (or search “API Keys” in the top search bar).
3. **Create API key** → name it e.g. `ZK Trade Portal`.
4. Permissions: enable at least **Wix Stores** — read + write products and inventory (exact labels vary).
5. Copy the **API key** → `WIX_API_KEY`.
6. **Site ID:** This is a **GUID**, not your website URL. When editing a product, the browser URL looks like:
   `manage.wix.com/dashboard/`**`1f79782e-4efa-4c8d-a9b5-113ef4910766`**`/store/products/...`
   Copy that middle segment → `WIX_SITE_ID=1f79782e-4efa-4c8d-a9b5-113ef4910766`  
   **Do not** use `https://www.zk-sports.com/`.

Send me both when set (you can redact the middle of the API key in chat if you prefer).

### Step 2 — Is this product in Wix Stores?

1. Left menu → **Catalog** (or **Store Products** / **Products**).
2. Search for **Paddock Club** or **Spanish Grand Prix**.
3. **If you find a sellable product** with price + inventory → you’re on **Wix Stores**. Continue to Step 3.
4. **If the page is only a custom marketing page** (no product in Catalog) → tell me; we may need to add a Store product or use Velo custom checkout (different path).

### Step 3 — Product ID + Variant ID (for mapping)

1. Open the product in Wix Stores (e.g. Monaco Velocity Terrace Sunday).
2. **Product ID** is in the browser URL after `/product/`:
   `.../store/products/product/`**`451973a4-41c4-2215-260b-7ae81d52dfea`**
3. **Variant ID** is not shown in the UI — run locally (after fixing `WIX_SITE_ID`):

```bash
npx tsx scripts/wix-product-lookup.ts 451973a4-41c4-2215-260b-7ae81d52dfea
```

It prints each variant id, SKU, price, and stock.

**What to paste in the portal** (Admin → Catalog → matching package → **Wix listing map**):

| Field | What it is |
|-------|------------|
| **Wix Product ID** | The Stores product guid |
| **Wix Variant ID** | Required — each product has at least one variant |
| **Page URL** (optional) | Public URL e.g. `https://www.zk-sports.com/...` |

4. Tick **Wix website** under Channels, save, then click **Push price + stock to Wix now**.

**Note:** ZK Sports uses Wix **Catalog V1**. The portal pushes **retail USD price** (trade × multiplier) and **sellable qty** via the Catalog V1 product + inventory APIs. The Wix editor may display **GBP** (£) as a converted storefront currency — check the API value or refresh the product page if the dashboard lags.

### Step 4 — Test webhook without a live Wix purchase

You do **not** need a real customer order. Send a test POST from your machine:

```bash
curl -X POST http://localhost:3000/api/webhooks/wix-order ^
  -H "Content-Type: application/json" ^
  -H "x-wix-webhook-secret: YOUR_WIX_WEBHOOK_SECRET" ^
  -d "{\"orderId\":\"test-wix-001\",\"productId\":\"451973a4-41c4-2215-260b-7ae81d52dfea\",\"variantId\":\"PASTE_VARIANT_ID\",\"quantity\":1,\"buyer\":{\"name\":\"Test Buyer\",\"email\":\"test@example.com\"}}"
```

(Use `\` instead of `^` on Mac/Linux.) Check **Admin → Orders** for a new `ZK-2026-…` row with channel Wix.

Use a **new** `orderId` each test (`test-wix-002`, …) — repeats are ignored (idempotent).

### Step 5 — Paid order webhook (production)

When a customer pays on Wix, we need a POST to:

- Local test: `http://localhost:3000/api/webhooks/wix-order` (use [ngrok](https://ngrok.com) to expose localhost)
- Production: `https://zk-sports.trade/api/webhooks/wix-order`

**Header:** `x-wix-webhook-secret: <same as WIX_WEBHOOK_SECRET>`

**JSON body (simplest test shape):**

```json
{
  "orderId": "wix-order-12345",
  "productId": "<your Wix Product ID>",
  "variantId": "<your Wix Variant ID>",
  "quantity": 1,
  "unitPrice": 8525,
  "currency": "USD",
  "buyer": {
    "name": "Test Customer",
    "email": "test@example.com",
    "phone": "+1 555 0100"
  }
}
```

**Where to configure in Wix:**

1. **Automations** (search in dashboard) → trigger **Order paid** → action **Send HTTP request** — if available on your plan.
2. Or **Developer Tools** → **Webhooks** / **Automations**.
3. Or **Velo** backend `wixStores_onOrderPaid` → `fetch()` to our URL.

If you’re unsure which you have, send a screenshot of **Automations** or **Developer Tools** and we’ll pick the path.

---

## Part C — Portal checklist

1. **Admin → Catalog** → `barcelona-f1-experiences-paddock-club-2026`
2. Enable **Wix website** + save integration settings
3. Add **Wix Product ID** + **Variant ID** in **Wix listing map**
4. **Push price + stock to Wix now** — check product in Wix dashboard
5. Place a **test order** on Wix (or POST test JSON to webhook)
6. Confirm in portal **Admin → Orders**, Salesforce Opportunity, Xero invoice

---

## What syncs automatically

| Event | Portal | Wix |
|-------|--------|-----|
| Save package / stock change | Master copy | Name, description, includes, brochure link, images (new URLs), retail price + sellable qty |
| Paid Wix order | `place_wix_order` → SF + Xero | Stock reduced via same engine |

**Create once in the portal** — Salesforce and Wix both update on `product.upsert` (save package, inventory change, or **Push listing to Wix now**).

**New Wix product:** Tick **Sell on Wix website** when creating a package (trade price required) — a Wix Stores product is created automatically if Wix API env is set and no listing exists yet. You can also use **Create Wix product from portal** on an existing package, or **Link existing Wix product** if the Stores line was created manually in Wix.

**Wix orders:** Customer pays by card on Wix checkout. Portal invoice is **`paid` immediately** — we do **not** create or email a Xero ACCREC invoice (trade-portal agent invoicing only). Salesforce Opportunity still syncs and moves to **Closed Won** after the Wix order is recorded.

**Do not** change stock, price, or copy manually in Wix after go-live — edit in the portal only.

### Test webhook without a real Wix order

```bash
npx tsx scripts/wix-webhook-test.ts barcelona-f1-experiences-paddock-club-2026 --prepare
```

Uses a fake `orderId` — nothing is charged on Wix. `--prepare` maps the package to your existing Wix product IDs for UAT (removes duplicate mappings on that Wix product first).

---

## Info to send back

Reply with:

1. ✅ API key created (yes/no)
2. ✅ Site ID
3. ✅ Product found in Catalog (yes/no) + screenshot of product page if stuck
4. Product ID + Variant ID (when you have them)
5. How orders are taken today (Wix checkout / custom form / other)
