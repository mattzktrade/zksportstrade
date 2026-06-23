# Phase 2.5 — Xero setup

## 1. Run migration

Apply `supabase/migrations/20250606120000_integration_xero.sql` in Supabase.

## 2. Xero Developer app

1. [developer.xero.com](https://developer.xero.com) → create app.
2. Redirect URI: `http://localhost:3000/api/integrations/xero/callback` and production URL.
3. OAuth scopes (requested automatically on Connect — **do not** use legacy `accounting.transactions` on apps created after 2 Mar 2026): `openid`, `profile`, `email`, `offline_access`, `accounting.contacts`, `accounting.invoices`, `accounting.settings`.

## 3. `.env.local`

```bash
XERO_CLIENT_ID=
XERO_CLIENT_SECRET=
# Optional:
XERO_SALES_ACCOUNT_CODE=200          # revenue account (defaults to 200 if omitted)
XERO_INVOICE_TAX_TYPE=OUTPUT2        # UK 20% VAT on income; auto-detected if omitted
# XERO_INVOICE_CURRENCY=GBP          # force invoice currency if org lacks USD (enable USD in Xero for production)
XERO_INVOICE_DUE_DAYS=7
XERO_INVOICE_AUTO_AUTHORISE=true     # AUTHORISED vs DRAFT
XERO_INVOICE_EMAIL_ON_CREATE=true    # email invoice PDF when authorised
XERO_INVOICE_CC=matt@zk-sports.com   # CC on invoice emails (Xero API has no CC; portal sends via Resend)
XERO_WEBHOOK_KEY=                    # for /api/webhooks/xero signature
```

## 4. Connect

**Admin → Integrations → Xero → Connect** → pick ZK Sports organisation.

## 5. Webhook (paid → portal)

In Xero Developer → Webhooks:

- Delivery URL: `https://zk-sports.trade/api/webhooks/xero`
- Key: same as `XERO_WEBHOOK_KEY`

When Xero marks an invoice paid, portal invoice status becomes **paid** (basic UPDATE handler).

## 6. Flow

1. Agent places order → Supabase order + invoice (`awaiting_invoice`).
2. Outbox: `order.placed` (Salesforce) + `invoice.create` (Xero) — processed automatically before checkout finishes.
3. Xero invoice is **authorised and emailed** to the agent with **CC to `XERO_INVOICE_CC`** (default `matt@zk-sports.com`) via Resend + PDF attachment.
4. Portal invoice → **awaiting_payment** with Xero invoice number on **My Bookings**.

## 7. Troubleshooting Connect (`invalid_scope`)

If Xero shows **invalid_scope** when you click Connect, your developer app was created after **2 March 2026** and no longer accepts the old broad scope `accounting.transactions`. The portal now requests granular scopes (`accounting.invoices`, etc.). Pull the latest code, restart `npm run dev`, and click **Connect** again.

## 8. Salesforce Opportunity contact

The trade **agent** (account owner) is the primary Contact on the Opportunity — not the end client. Client details are on the Opportunity description.
