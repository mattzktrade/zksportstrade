# ZK Trade Portal — Team Overview

**Purpose:** A clear summary of what has been built, how the portal works day to day, and what the team should use it for.

**Audience:** ZK team members who need to understand the trade portal, admin tools, stock management, orders, and integrations.

**Last updated:** June 2026

---

## 1. What The Portal Does

The ZK Trade Portal is now the main operating system for trade partner bookings, package inventory, order fulfilment, and system integrations.

The portal covers:

- Trade partner package browsing and checkout.
- Admin inventory and package management.
- Stock purchased / supplier cost tracking.
- Manual stock holds.
- Agent approval and Paddock Club request approval.
- Order tracking, invoice status, and delivery proof.
- Salesforce product and opportunity sync.
- Xero invoice creation and payment status sync.
- Wix listing and order sync.
- CSV inventory export for weekly stock checks.

The key principle is:

> **The portal / Supabase should be treated as the operational source of truth for live stock and bookings.**

---

## 2. Main User Workflows

### Trade Partner Booking Flow

Approved trade partners can:

- Log in to the portal.
- Browse races and packages.
- View package details, images, and pricing.
- Enter guest / client information.
- Accept the terms and conditions.
- Submit a booking.

After checkout:

- The agent receives a booking confirmation email.
- A Xero invoice is created and emailed.
- Stock is deducted in the portal.
- Salesforce and Wix stock sync jobs are queued.
- The order appears under **My Bookings**.

**Screenshot to add:** Agent package page or checkout confirmation.

---

### Admin Order Flow

Admins can:

- View all orders.
- Filter by payment status.
- Download invoice PDFs.
- Update payment workflow status:
  - Awaiting payment
  - Paid
  - Delivered
- Cancel orders where needed.
- See revenue, COGS, gross profit, and margin.

When an order is marked **Delivered**, the admin must now add proof of delivery:

- Upload a screenshot / PDF, or
- Add an internal note such as “Tickets handed in person on this date”.

This proof is internal only and is **not visible to agents**.

**Screenshot to add:** Admin Orders page and delivery proof modal.

---

## 3. Inventory And Packages

The admin inventory area lets the team manage:

- Package name, event, description, images, includes, and brochure links.
- Trade price and currency.
- Total capacity.
- Live stock.
- Linked multi-day / split-day stock.
- Hidden / visible status for the portal.
- Salesforce and Wix integration details.

The package detail page is split into tabs:

- **Details**: package content, pricing, images, visibility.
- **Inventory & cost**: purchased stock and cost layers.
- **Integrations**: Salesforce / Wix sync status and product links.
- **Orders**: orders for that package, profit, suppliers, and fulfilment.

**Screenshot to add:** Package detail page with tabs.

---

## 4. Stock Purchased And Supplier Tracking

Admins can add purchased stock in the **Inventory & cost** section of a package.

Each stock purchase can include:

- Quantity purchased.
- Remaining quantity.
- Unit cost.
- Currency.
- Supplier / source.
- Received date.
- Internal note.

This powers:

- COGS calculations.
- Gross profit / margin reporting.
- Supplier source summaries.
- Manual fulfilment allocation by supplier.

Salesforce now receives a combined supplier source summary, for example:

```text
F1 Experiences: 20 units; Matt: 10 units
```

**Screenshot to add:** Stock purchased / cost layers section.

---

## 5. Supplier Allocation For Orders

On the package **Orders** tab, admins can choose which purchased stock fulfilled an order.

This is useful when:

- We want to manually choose the supplier for an order.
- An order is fulfilled from more than one supplier.
- We need accurate COGS and supplier reporting.

Example:

```text
Order for 2 guests:
1x F1 Experiences
1x Matt
```

Changing the supplier allocation updates:

- The order COGS.
- Gross profit.
- Cost layer remaining quantities.
- Supplier allocation view.

**Screenshot to add:** Package Orders tab showing supplier allocation dropdowns.

---

## 6. Holds

Admins can create manual stock holds for trade partners.

Holds:

- Reserve stock temporarily.
- Have an expiry time.
- Update linked inventory packages.
- Queue Salesforce / Wix stock sync.

Linked inventory has been fixed so that holding a single-day package also updates the related multi-day packages correctly.

**Screenshot to add:** Holds page.

---

## 7. Linked Inventory

Linked inventory supports packages that share the same underlying stock, for example:

- Friday only
- Saturday only
- Sunday only
- 2-day package
- 3-day package

When stock is sold, held, released, or added, the linked package availability is recalculated so the portal does not oversell the same ticket inventory.

This applies to:

- Agent bookings.
- Admin orders.
- Manual holds.
- Added purchased stock.
- Expired holds.

---

## 8. Integrations

### Salesforce

Salesforce sync handles:

- Product creation / updates.
- Product stock snapshots.
- Supplier source summary.
- Product images / listing content where configured.
- Opportunity creation for orders.
- Opportunity line items.
- Closed Won / Closed Lost updates.
- Invoice PDF attachment to opportunities where available.
- Offline Salesforce sales pullback into portal stock.

Production cron now runs every minute on Vercel Pro to keep integration jobs moving quickly.

**Important:** During stock cleanup, Salesforce can be temporarily disabled by removing the live Salesforce client env vars in Vercel and redeploying.

**Screenshot to add:** Admin Integrations → Salesforce page.

---

### Xero

Xero sync handles:

- Creating invoices when portal/admin orders are placed.
- Authorising invoices.
- Emailing the invoice PDF to the agent.
- CCing internal finance / ZK emails.
- Updating portal payment status when Xero marks an invoice paid.

Production invoice settings:

- Currency: USD.
- Tax: 0% sales / zero-rated output.
- Payment terms: 7 days, if configured in Xero env vars.

The invoice PDF design comes from the Xero invoice branding/theme.

**Screenshot to add:** Xero invoice example.

---

### Wix

Wix sync handles:

- Public product/listing sync where mapped.
- Wix paid order webhook.
- Creating matching portal orders from Wix sales.
- Syncing stock back across portal / Salesforce / Wix.

Wix orders are treated as prepaid, so they do not create unpaid Xero invoices in the same way as trade portal bookings.

**Screenshot to add:** Admin Integrations → Wix page.

---

## 9. Dashboard And Reporting

The admin dashboard now includes better reporting around:

- Revenue.
- COGS.
- Gross profit.
- Margin.
- Order counts.
- Inventory / stock status.

Package and order pages also show profit data based on cost layers.

The Inventory page includes an **Export inventory CSV** button for manual weekly checks.

The export includes:

- Race.
- Package.
- Location.
- Price.
- Currency.
- Stock.
- On hold.
- Sellable.
- Package ID.

**Screenshot to add:** Admin dashboard and Inventory CSV button.

---

## 10. Agent Management

Admins can manage trade partners from the **Agents** and **Pending users** sections.

Features include:

- Approving new agent accounts.
- Rejecting pending users with notes.
- Viewing agent orders.
- Updating payment status from agent order history.

New agent confirmation emails have also been simplified and branded.

**Screenshot to add:** Pending users or Agents page.

---

## 11. Paddock Club Requests

Some packages can require admin approval before the booking is confirmed.

Flow:

1. Agent submits a request.
2. Admin reviews it.
3. Admin approves or rejects.
4. If approved, the portal creates the order, reserves stock, and sends confirmation.

Approval links are now more secure:

- Admin login is required.
- Approval mutation is POST-based, not a simple GET link.
- Approval tokens use a dedicated secret.

**Screenshot to add:** Paddock requests page.

---

## 12. Security And Reliability Improvements

Recent security improvements include:

- Wix webhook fails closed if the secret is missing.
- Xero webhook fails closed if the webhook key is missing.
- Xero webhook signature comparison uses timing-safe checks.
- Booking approval tokens require a dedicated secret.
- Email approval links require admin session confirmation.
- Private delivery proof files are stored in a private Supabase storage bucket.

---

## 13. Current Operating Rules

### Do

- Use the portal admin area to update packages, prices, and stock.
- Add stock through the stock purchased / cost layers section.
- Use supplier allocation when an order is fulfilled from a specific supplier.
- Mark orders delivered only when proof or an internal note is available.
- Use the inventory CSV export for weekly stock checks.
- Check Integration pages for failed sync jobs.

### Do Not

- Do not manually edit live stock in multiple systems without a clear reason.
- Do not assume Salesforce stock is correct while stock cleanup is in progress.
- Do not delete integration settings unless intentionally disconnecting an integration.
- Do not mark tickets delivered without internal evidence.

---

## 14. What Happens Behind The Scenes

Most actions queue background integration jobs:

```text
Portal action
  -> Supabase update
  -> integration_outbox job
  -> Salesforce / Xero / Wix sync
  -> status shown in admin
```

Portal-originated actions try to sync immediately in the background.

The production cron runs every minute and acts as a safety net for:

- Failed / pending sync jobs.
- Expired holds.
- Salesforce offline sales pullback.
- Stock reconciliation.

---

## 15. Suggested Screenshots To Add Before Sharing

Add screenshots in this order for the cleanest team walkthrough:

1. Agent package browsing page.
2. Agent checkout / confirmation screen.
3. Admin Inventory page.
4. Package detail page with tabs.
5. Inventory & cost / stock purchased section.
6. Package Orders tab with supplier allocation.
7. Delivery proof modal.
8. Admin Orders page.
9. Integrations overview page.
10. Salesforce / Xero / Wix integration detail pages.
11. Xero invoice example.
12. Inventory CSV export button.

Recommended folder:

```text
docs/team-portal-overview-assets/
```

Then link them into this document like:

```md
![Package Orders supplier allocation](./team-portal-overview-assets/package-orders-suppliers.png)
```

---

## 16. Quick Summary For The Team

The portal is now designed to be the central place for trade bookings, live stock, package management, supplier cost tracking, and fulfilment.

Salesforce, Xero, and Wix are connected around the portal:

- Salesforce tracks products, opportunities, and stock snapshots.
- Xero creates and emails invoices.
- Wix can sync public listings and paid orders.
- The portal keeps operational control over stock, orders, holds, and fulfilment.

The team should use the portal first, then check integrations only when a sync needs attention.
