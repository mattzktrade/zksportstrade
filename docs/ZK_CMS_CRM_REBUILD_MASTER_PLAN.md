# ZK Business Platform Rebuild — Master Plan

**Status:** First-build admin complete — ready to share with the ZK team  
**Document owner:** ZK Sports & Entertainment  
**Created:** 11 August 2026  
**Last updated:** 27 August 2026  
**Primary reference:** `docs/ZK CMS Rebuild Draft (1).pdf`  
**Purpose:** The single source of truth for the Salesforce-to-ZK platform pivot, including scope, decisions, architecture, phases, progress, risks, testing, and outstanding questions.

> This document replaces `docs/INTEGRATION_MASTER_PLAN.md` as the roadmap for the new direction. The older plan remains useful as a record of the current integration architecture and must not be deleted.

---

## 1. How to use this document

This file must be updated throughout the rebuild:

1. Mark work as `Not started`, `In progress`, `Blocked`, `Ready for review`, or `Done`.
2. Add material product or technical decisions to the decision log.
3. Record scope changes rather than silently changing the plan.
4. Add migrations, feature flags, test evidence, and rollout notes to the relevant phase.
5. Do not mark a phase complete until all of its exit criteria pass.

### Status legend

- `[ ]` Not started
- `[~]` In progress
- `[?]` Blocked or awaiting a decision
- `[R]` Ready for review
- `[x]` Done and verified

### Current programme status

- `[x]` Rebuild concept PDF reviewed
- `[x]` Original five-page booking form and PandaDoc signing certificate reviewed
- `[x]` Existing admin, inventory, Salesforce, Wix, Xero, order, and database architecture mapped
- `[x]` Initial master plan created
- `[x]` Phase 0 baseline and remaining operational decisions recorded for first-build scope
- `[x]` Phase 1A Salesforce-independent runtime (`ZK_PLATFORM_MODE=native`)
- `[x]` Phase 1B simplified inventory foundation
- `[x]` Phase 1C inventory CMS and mockup-led admin shell
- `[x]` Phase 2A native CRM core completed
- `[x]` Phase 2B native booking forms and e-signature implemented (run one live two-party signing check after deploy)
- `[x]` Phase 2C native order, Xero, payment, reminder, and cancellation automation implemented (confirm live Xero after deploy)
- `[x]` Phase 2D first-build sales, finance, and operations queues are usable end to end, including imported deals without a native order
- `[x]` Signed deals hold purchased stock; payment status stays independent. Supplier packing prefers one source per party.
- `[~]` Phase 3 data cutover: imports exist; Matt is finishing imported deal and contact review. The Cutover admin tab is retired from the nav.
- `[x]` Phase 4 help centre pulled into first-build as `/admin/help` (getting started + self-help). Other Phase 4 modules remain later: sourcing comparisons, marketing, Slack/Outlook, partner API.
- `[x]` Phase 5 Salesforce runtime retirement: live Salesforce is off, hidden from Settings, and cron/outbox no longer call it. Historical IDs and import CSVs remain. Salesforce library files and database columns are kept.
- `[x]` First-build admin is complete enough to share with the ZK team. In-app Help is the staff guide.
- `[ ]` Production deploy of this first build (live Xero / booking-form smoke test after deploy)

---

## 2. Vision

Build one ZK-owned business platform covering:

1. Trade portal and approvals
2. Inventory and suppliers
3. Leads, sourcing, deals, and pipeline
4. Fulfilment and guest operations
5. Finance and sales reporting
6. Campaigns and email
7. Permissions, templates, help, and integrations

The platform should be simple by default, show each user their next actions, automate useful repetitive work, and make Supabase the source of truth for ZK operations.

### Immediate priorities

**Priority 1 — Inventory**

Make the new admin platform the accurate, Salesforce-independent hub for:

- Events
- Sellable products
- Stock purchases and adjustments
- Multiple suppliers contributing stock to one product
- Cost, margin, holds, allocations, and availability
- Portal and Wix availability

**Priority 2 — Native offline sales**

Allow the team to:

1. Create an offline request/deal.
2. Select the client, event, products, quantity, and price.
3. Reserve stock while the deal is active.
4. Generate and send a booking form.
5. Collect legally appropriate signatures from the client and ZK.
6. Move the deal to `Signed`.
7. Create and send the Xero invoice automatically.
8. Update the payment/deal stage when Xero reports payment.
9. Pass confirmed work into operations and fulfilment.

**Priority 3 — Admin experience**

Rebuild the current admin area into the custom ZK CMS/CRM shown in the concept draft, beginning with the new navigation, dashboard framework, inventory, deals, and finance workflow.

**First-build outcome (26 August 2026):** All three priorities are delivered in the admin product. Salesforce is not required for day-to-day work. Remaining work is production deploy, imported data review, and a live Xero / booking-form check — not more admin modules. Staff guidance lives at `/admin/help`.

---

## 3. Non-negotiable constraints

1. **Local prototype first, then approved production.** The rebuild was built and checked locally. The first-build admin is now complete enough to share with the team. Production deploy is the remaining rollout step. Native mode is hardcoded; leftover `ZK_PLATFORM_MODE=native` is unused.
2. **No destructive cleanup yet.** Do not delete Salesforce data, Supabase tables, columns, migrations, historical IDs, shell rows, or integration code during the prototype.
3. **Additive database changes.** New migrations may add the native model, views, flags, and indexes. Legacy structures remain available until cutover is approved.
4. **Salesforce must not remain operationally authoritative.** The native path must not read Salesforce to calculate stock or require Salesforce for products, deals, orders, or reporting.
5. **Salesforce disconnection must be reversible during testing.** Disable its runtime paths behind configuration/feature flags before removing code.
6. **Xero remains the finance integration.** Xero is the payment/invoice authority unless a later decision changes this.
7. **Wix remains independent of Salesforce.** Existing Wix listing and paid-order functions must continue to work against Supabase inventory.
8. **No generated single-day shell tickets in the target model.** Hidden Salesforce reporting shells are legacy data only.
9. **One real product can contain stock from multiple suppliers.** Supplier purchases are inventory lots/sources beneath the product, not duplicate products.
10. **Historical integrity is mandatory.** Existing orders, invoices, cost allocations, delivery proof, Salesforce references, and financial records must remain readable.
11. **Stock mutations must be atomic and auditable.** A booking, hold, release, purchase, cancellation, or adjustment must not create unexplained inventory drift.

---

## 4. What the concept draft defines

The July 2026 concept document describes one connected platform with the following information architecture.

### Dashboard

A personalised overview of:

- Approvals
- Tasks and next actions
- Sales performance
- Pipeline
- Fulfilment issues
- Finance actions
- Marketing activity

Each user should see the work relevant to them rather than a generic reporting screen.

### Portal

- Trade-user registration approvals
- Paddock Club request approvals
- Manual orders
- Holds
- Existing agent-facing browsing and checkout

### Inventory

- **Sales List:** live sellable products with event, package, available quantity, price, imagery, brochure, and inclusions; actions to create a deal or hold
- **Negative Stock List:** confirmed deals for stock not yet bought, with supplier, buy price, quantity, event date, and linked deal
- **Manage Inventory:** event/product creation, product content, pricing, stock, assets, activation, and archiving
- **Purchase Orders:** supplier purchases, cost, quantity, linked deal, payment state, contracts, and confirmations
- **Suppliers:** contacts, event coverage, products, order history, average margin, and response speed

### Sales

- **Leads:** contacts, companies, previous clients, interests, spend, source, owner, and next action
- **Sourcing:** requests for unavailable stock, supplier option comparison, approval, and quote hand-back
- **Deals and Pipeline:** searchable team and personal pipelines filtered by owner, stage, source, event, approval status, and expected close date

### Operations

Confirmed deals with:

- Payment status
- Guest details
- Supplier fulfilment
- Guest communications
- Ticket delivery
- Clear action warnings

### Finance

- **Deals Tracker:** booking-form signature, invoice creation, payment, overdue follow-up, and reminders
- **Sales Tracker:** monthly and year-to-date revenue and gross profit by source, event, salesperson, and channel

### Marketing

- Campaign purpose, channel, spend, leads, qualified leads, deals, revenue, and ROI
- Targeted promotional email with audience filters, exclusions, test sends, scheduling, and engagement

### Settings

- Roles and permissions by person, team, or preset role
- Searchable in-app Help (`/admin/help`) with a getting-started guide for the team. Videos and a full knowledge base remain later work.
- Integration status and activity for Xero, Wix, Slack, Outlook, signing provider, advertising platforms, and APIs
- Editable templates for booking forms, finance reminders, guest communications, supplier emails, and notifications

The first build does not need to deliver every module above. The application shell and data model must, however, avoid blocking those later modules.

---

## 5. Current platform baseline

### Existing strengths to preserve

- Next.js 16 application with Supabase authentication and RLS
- Agent portal, package browsing, checkout, bookings, and invoices
- Admin catalog, package details, orders, holds, agents, booking approvals, and integrations
- Supabase events (`races`), products (`packages`), and live inventory
- Atomic `place_order` database workflow
- Purchased-stock cost layers and FIFO order cost consumption
- Purchase orders, private documents, and fulfilment blocks
- Manual stock holds with expiry
- Xero invoice creation, email, and paid webhook
- Wix listing and paid-order webhook
- Revenue, COGS, gross-profit, and margin reporting
- Delivery proof and supplier allocation

### Current Salesforce coupling to replace

Salesforce currently participates in:

- Product creation and updates
- Product codes and external IDs
- Product content and stock snapshots
- Accounts and contacts
- Opportunities, quotes, and opportunity line items
- Opportunity stage changes
- Offline Closed Won sales pulled back into portal inventory
- Open pipeline quantities used in inventory reconciliation
- Supplier stock-source mirrors
- Package Items and generated single-day shells
- Invoice attachment to opportunities
- Cron-based stock reconciliation

The main risk is not simply removing Salesforce API calls. The platform currently uses Salesforce offline deals and open pipeline as inputs to some stock calculations. Native deals and reservations must replace that behaviour before Salesforce is fully disabled.

### Existing shell and linked-stock complexity

The current model supports:

- Real 3-day, 2-day, and single-day sellable variants
- Inventory groups linking those variants
- Hidden single-day shell products generated for Salesforce reporting
- Parent-to-child `package_items`
- SQL and TypeScript reconciliation/healing
- Salesforce Closed Won and open-pipeline deductions

The hidden shell products are not required in the target system. Genuine separately sellable day products are a different concept and must be reviewed product by product before existing links are changed.

### Current quality gap

The repository has many inventory diagnostic scripts but no formal automated test suite. Critical stock behaviour must gain repeatable tests before the old reconciliation path is disabled.

---

## 6. Target architecture

```text
Users
  ├─ Trade portal
  └─ ZK admin CMS/CRM
         │
         ▼
Supabase — operational source of truth
  ├─ Events and products
  ├─ Supplier stock lots and purchase orders
  ├─ Inventory ledger, holds, allocations, and adjustments
  ├─ Accounts, contacts, leads, and deals
  ├─ Booking forms, signatures, and audit events
  ├─ Orders, invoices, fulfilment, and reporting
  └─ Integration outbox
         ├─ Xero: invoice and payment truth
         ├─ Wix: listings and paid retail orders
         ├─ Resend: transactional email
         └─ Future integrations

Salesforce
  └─ Disconnected legacy/archive system during prototype
```

### Ownership rules

- **Supabase:** catalog, CRM, inventory, deal state, order state, fulfilment, audit trail
- **Xero:** invoice document, accounting state, and payment confirmation
- **Wix:** public retail channel; it consumes availability and sends paid orders
- **Signing provider/native signature service:** document delivery and signature evidence only; Supabase stores the authoritative workflow state and immutable evidence references
- **Salesforce:** no target-state runtime responsibility

---

## 7. Target domain model

Names below are planning names. Final table and field names will be confirmed before migrations are written.

### Events

Reuse and extend `races` as the event entity:

- Name, location, country, venue/circuit
- Start/end dates and season
- Images and status
- Operational dates and deadlines
- Active/archived state

The UI may call these **Events** even if the database table remains `races` initially.

### Products

Reuse and simplify `packages` as the sellable product:

- One visible product represents what the customer buys
- Event
- Name and optional internal SKU
- Description, inclusions, images, brochure
- Sale price, currency, tax treatment
- Duration/date coverage as descriptive attributes
- Visibility by channel
- Approval requirements
- Active/archived state

Target rule:

> One product family owns one physical three-day stock pool. Genuine three-day, two-day, and individual-day sellable options draw from that same pool, while supplier differences belong under the product as stock lots.

No hidden child shells should be generated. Genuine Friday, Saturday, Sunday, two-day, and three-day options remain as real sellable products where ZK chooses to offer them. They must all reserve and consume the same underlying three-day physical stock pool. For example, Singapore and Abu Dhabi Velocity Terrace may be sold as individual days or two-day products because it can be difficult to sell the entire allocation as three-day packages.

The replacement model must express the number of physical tickets consumed on each event day. This allows a Friday-only sale to consume Friday capacity while leaving the same physical ticket's Saturday/Sunday capacity sellable, without creating hidden zero-value Salesforce shells.

### Suppliers and stock purchases

Add a structured `suppliers` entity rather than relying only on free-text `source`.

Each stock purchase/lot should record:

- Product
- Supplier
- Purchase order
- Quantity purchased
- Quantity remaining
- Unit cost and currency
- Purchase/received date
- Payment status
- Fulfilment block if applicable
- Contract, invoice, and confirmation documents
- Notes and audit metadata

Multiple lots from multiple suppliers roll up into the same product availability while preserving cost and fulfilment traceability.

### Inventory ledger

The target must expose an explainable stock equation:

```text
Owned stock
− committed order allocations
− active manual holds
− active deal reservations
= available to sell
```

Negative stock is a deliberate business exception:

- Negative stock is only permitted through the sourcing workflow.
- Sourcing must have a supplier quote issued within the previous 24 hours when the booking form is signed.
- Once the client signs, ZK may confirm the order before purchasing the sourced stock.
- If the supplier quote is more than 24 hours old at signing, sourcing must refresh/reconfirm it before the order can be confirmed.
- The shortage must appear on the Negative Stock List.
- A shortage must not appear as sellable stock on the portal or Wix.
- Purchasing links the acquired supplier lot to the deal and clears the shortage.

Every mutation should produce an immutable ledger/audit entry:

- Purchase
- Adjustment
- Hold
- Hold release/expiry
- Deal reservation
- Deal lost/cancelled
- Order commitment
- Supplier allocation
- Refund/cancellation

Implementation status (24 August 2026):

- `inventory_allocations` is the quantity-level source of allocation truth; `order_cost_consumptions` remains its COGS compatibility projection.
- Allocation is lock-safe and idempotent, prefers one fulfilment block/PO/supplier, and splits FIFO only when one source cannot cover the party.
- Owned reservations and orders are rejected when recorded purchase layers cannot cover them. Null-layer owned COGS is no longer permitted.
- Supplier-confirmed, tickets-received, and delivered allocations are fulfilment-locked. Pending allocations may be rearranged to keep parties together.
- Imported won-sale deficits are recorded separately as `historical_reconciliation` shortages. They are not brokered stock and do not create a supplier or cost.
- `inventory_availability` is the canonical bought/reserved/committed/shortage/sellable read model. Portal checkout is capped by this model.
- Historical reconciliation is previewed before application, is idempotent, and newly added purchase layers clear the oldest matching historical shortages first.
- The rollout gate is `npm test`, `npm run build`, and `npm run test:inventory:db` after applying the migration to the target database.

Implementation status (26 August 2026):

- Signed, awaiting-invoice, and awaiting-payment deals hold purchased stock and can be assigned a fulfilment supplier. Payment status is independent: an unpaid signed deal is still sold stock.
- Unsigned pipeline deals do not consume purchased layers unless an explicit hold/reservation is placed. Sending a booking form still creates a seven-day reservation.
- Extra places on a signed deal allocate only the changed line (incremental), preferring suppliers already used on that deal when leftover stock is enough.
- Supplier packing prefers one purchase source for a whole party where possible, packing the deal rather than each split line independently.
- Cost-layer quantity changes keep remaining quantity in sync with reserved/committed allocations.

### Accounts, contacts, and leads

Add native CRM entities:

- `accounts`: agent companies, corporate/private clients, and optionally suppliers
- `contacts`: people related to accounts
- `leads`: early enquiries not yet converted to a deal
- Existing `profiles`: login identity linked to an account/contact where relevant

Do not continue storing reusable clients only as denormalised text on orders. Historical snapshots on orders must remain.

### Deals

Add a native `deals` entity replacing Salesforce Opportunity:

- Reference
- Account and primary contact
- Owner
- Source/channel
- Event
- Stage
- Expected close date
- Currency and values
- Next action
- Hold expiry / do-not-expire
- Approval state
- Loss reason
- Linked order, invoice, and documents
- Created/updated/closed timestamps

Add `deal_line_items` for:

- Product
- Quantity
- Sale price
- Discount/override reason
- Expected or agreed supplier
- Expected buy cost
- Margin
- Reservation state

### Booking forms and signatures

Add provider-neutral document entities:

- `booking_documents`
- `document_signers`
- `document_events`
- `document_templates`

The first implementation target is:

1. A native ZK signing experience, if the required security, evidence, document, and legal controls can be met.
2. PandaDoc as the fallback if the native proof of concept cannot meet those requirements reliably.

The CRM must not be tightly coupled to one provider. A document record should keep:

- Immutable document version/hash
- Template version
- Deal and line-item snapshot
- Signer identity, role, and order
- Sent, viewed, signed, declined, voided, and completed timestamps
- Signature evidence supplied by the provider/native implementation
- Final signed PDF in private storage
- Error and retry state

Native e-signature is not just a signature drawing box. Before production use, the team must agree identity verification, consent, audit evidence, document immutability, retention, privacy, and applicable legal requirements.

Signing is sequential:

1. The client signs first.
2. The CRM then notifies the approved ZK admin signer.
3. Michel is the normal ZK signer, but any approved admin may sign.
4. The document is complete only after both signatures.

### Current booking-form template baseline

The complete five-page booking form and signing certificate supplied on 11 August 2026 (`Abu Dhabi F1 GP 2026 - House 44 Paddock Club.pdf`) are the starting template and must remain manually editable before sending.

**Page 1 — Quote**

- ZK logo, company address, and TRN
- Quote number and date
- `Bill to` agent company, contact, email, and address
- Event/package heading
- Product, event, unit price, quantity, line total, subtotal, and total
- Client acknowledgement that the products/packages accurately represent what has been purchased
- Client signature area

**Page 2 — Payment and delivery**

- All commercial amounts in USD
- 100% due upon signing and tax-inclusive wording
- Non-payment/cancellation wording
- Delivery only after full and timely payment
- Signatory-authority acknowledgement
- Wire-transfer payment method
- ZK bank details presented by account/currency where required

The generated deal remains USD even if the template lists ZK receiving accounts in additional currencies.

**Pages 3–5 — Terms and signatures**

- Existing ZK booking terms and conditions
- Client acknowledgement of the terms
- Separate Seller and Client signature/date areas
- Seller populated by the approved admin signer

**Signing certificate**

- Unique document reference
- Completion timestamp in UTC
- Client and ZK signer names and emails
- Sent, viewed, and signed timestamps
- IP address and geolocated location evidence
- Recipient email-verification evidence

The complete legal text is available in the supplied PDF and must be preserved in the initial template. Template versions must be retained so an already-sent or signed form never changes when the master template is edited.

### Orders and invoices

Reuse existing orders and invoices:

- A signed offline deal creates or confirms an order
- The order commits stock
- Xero invoice creation runs after the required signatures are complete
- Xero payment updates the invoice and deal
- Existing portal and Wix orders link to native deals for unified reporting

### Activity and audit

Add an append-only activity/audit log early in the build:

- Actor
- Entity type and ID
- Action
- Before/after summary where appropriate
- Timestamp
- Request/source
- Integration event reference

Stage, price, quantity, hold, signature, payment, approval, and permission changes require audit coverage.

---

## 8. Native deal and booking workflow

### Proposed deal stages

1. `Draft`
2. `Sourcing` when required
3. `Proposal`
4. `Booking form sent`
5. `Awaiting client signature`
6. `Awaiting ZK signature`
7. `Signed`
8. `Awaiting invoice`
9. `Awaiting payment`
10. `Paid / Confirmed`
11. `In fulfilment`
12. `Fulfilled`
13. `Closed lost`
14. `Cancelled`

The Deals UI groups these detailed workflow states into six sales stages that match ZK's actual process, while retaining detailed statuses for automation and audit:

1. **Enquiry** — `draft` and `sourcing`; action: review the enquiry, source stock if required, and send a price.
2. **Price sent** — `proposal`; action: follow up the price and progress to a booking form.
3. **Booking form** — `booking_form_sent`, `awaiting_client_signature`, `awaiting_zk_signature`; action shows whose signature/approval is required.
4. **Awaiting payment** — `signed`, `awaiting_invoice`, `awaiting_payment`; action shows whether invoicing or payment follow-up is required.
5. **Won** — `paid_confirmed`, `in_fulfilment`, `fulfilled`; action moves from handover through fulfilment.
6. **Lost** — `closed_lost`, `cancelled`; no further action.

Sourcing is an internal status within **Enquiry**, not a separate sales stage. Pipeline cards, filters, table tags, and the detail panel must use these six labels consistently. The detailed workflow status remains visible beneath the grouped stage, with a separate action-required field.

### Proposed automation

```text
Deal created
  → line items added
  → booking form generated and sent
  → stock reservation starts immediately for 7 days
  → automatic unsigned-form reminders warn that places will be released
  → client signs first
  → approved ZK admin signs
  → final signed PDF stored
  → deal stage = Signed
  → order created/confirmed and stock committed
  → Xero invoice queued, authorised, and sent
  → deal stage = Awaiting payment
  → Xero paid webhook
  → invoice = Paid
  → deal = Paid / Confirmed
  → operations workflow begins
```

### Failure and expiry rules

- A draft does not reserve stock by default.
- Sending the booking form creates the stock reservation immediately.
- The reservation expires seven calendar days after the form is sent.
- Unsigned-form reminders must explain the deadline and that the places will be released.
- If the client has not signed within seven days, the booking form is automatically cancelled/voided and the stock is released exactly once.
- The client must sign before an approved admin can sign for ZK.
- An expired, declined, cancelled, or lost deal releases its reservation.
- Completing both signatures creates the order, converts the reservation into committed stock, and automatically sends the Xero invoice.
- Signed stock remains committed while payment is outstanding.
- Overdue invoices receive automatic payment reminders.
- At 28 days overdue, the order is flagged as eligible for cancellation. An admin can cancel it then, or choose to cancel it earlier. Cancellation releases stock exactly once.
- All webhooks and retries must be idempotent.
- Signature failure must not create an invoice.
- Invoice failure must not lose the signed booking or duplicate stock.
- Payment failure/overdue status must remain visible to finance and must not release stock until an admin confirms cancellation.

---

## 9. Salesforce disconnection strategy

Phase 5 runtime retirement is done. Native mode is always on. Salesforce OAuth, inventory pull, product/order sync, and Settings UI are gone from the live product.

Historical Salesforce IDs, CRM CSV imports, and the Salesforce TypeScript library remain in the repo so we do not drop data or break leftover imports. Physical deletion of those files and unused columns is still later work.

### Legacy data treatment

- Keep all `salesforce_*` columns during the prototype.
- Keep `salesforce_offline_sale_applications` until its effects have been reconciled into the native ledger.
- Keep hidden shell package rows but exclude them from the new product UI, availability, creation flow, and native reporting.
- Do not run destructive migrations against `package_items` or shell relationships.
- Keep Salesforce data untouched.
- Before eventual production cutover, import open opportunities, recent won deals, accounts, contacts, and any missing stock sources needed for operational continuity.

### Eventual removal

Physical deletion of Salesforce code/schema is a separate, later phase requiring:

- Approved data archive
- Reconciliation report
- Production parallel-run evidence
- Rollback plan
- Explicit sign-off

---

## 10. Phased delivery plan

## Phase 0 — Alignment, baseline, and safety

**Goal:** Lock the rules and establish a measurable baseline without changing production.

- `[x]` Review rebuild concept PDF
- `[x]` Map current admin and integration architecture
- `[x]` Create this master plan
- `[x]` Review the complete booking-form PDF, legal text, and signing certificate
- `[x]` Confirm target treatment of genuine day/2-day/3-day products
- `[x]` Confirm stock-reservation timing and seven-day expiry for offline deals
- `[x]` Choose native booking form/e-signature as the first prototype, with PandaDoc fallback
- `[x]` Confirm client-first, admin-second signing order
- `[x]` Confirm Xero bills the agent company
- `[x]` Record current booking-form template requirements
- `[ ]` Export current products, inventory, holds, cost layers, Salesforce won/open quantities, and unresolved drift
- `[x]` Select pilot set: Singapore Velocity Terrace, Abu Dhabi Velocity Terrace, one standard three-day product, and one sourced negative-stock deal
- `[x]` Define the local/native-mode feature flag and rollback
- `[~]` Establish automated test harness for critical stock rules (runtime-mode harness added; stock scenarios remain)

**Exit criteria**

- Decisions in section 16 are answered or explicitly deferred.
- Baseline exports can explain current stock for pilot products.
- Local Salesforce disabling cannot affect production.
- Critical inventory scenarios have repeatable tests.

---

## Phase 1A — Salesforce-independent runtime

**Goal:** Make the local build operate without Salesforce while preserving all legacy data and code.

- `[x]` Gate Salesforce cron pull/push, configuration, and OAuth paths
- `[x]` Gate Salesforce outbox enqueue/processing
- `[x]` Prevent native inventory/query paths from treating Salesforce as configured
- `[x]` Keep Xero and Wix jobs active
- `[x]` Add admin indication that native/local mode is active
- `[x]` Safely complete pre-existing Salesforce outbox jobs as skipped while preserving Wix catalog work
- `[ ]` Verify portal checkout, admin order, holds, Wix order, and Xero invoice without Salesforce

**Implementation evidence — 11 August 2026**

- `lib/platform/runtime-mode.ts` provides the opt-in runtime boundary.
- Local development enables native mode through ignored `.env.development.local`; production remains legacy by default.
- Salesforce configuration, stored connection status, OAuth entry, cron pull/heal, and outbox handlers are blocked in native mode.
- Product/inventory outbox events continue to update Wix without entering the Salesforce product sync (therefore no shell generation).
- Order Salesforce statuses are recorded as `skipped`; non-Wix orders continue to enqueue Xero invoices.
- Admin Integrations clearly identifies Salesforce as disabled legacy infrastructure.
- `tests/native-platform-mode.test.ts`: 5 tests passing.
- `npx tsc --noEmit`: passing.
- IDE diagnostics for changed TypeScript/TSX files: no errors.

**Exit criteria**

- No Salesforce API calls occur in native mode.
- Local portal/admin bookings work.
- Xero and Wix remain functional.
- Existing Salesforce/Supabase data has not been deleted.

---

## Phase 1B — Simplified inventory foundation

**Goal:** Establish one clear product/inventory model with multiple supplier lots.

- `[x]` Add structured suppliers
- `[x]` Link purchase orders and cost layers to suppliers
- `[x]` Define canonical inventory ledger and availability query
- `[x]` Add safe stock adjustment workflow with reason and audit event
- `[x]` Add deal-reservation support or an inventory reservation abstraction
- `[x]` Stop creating single-day shell packages in native mode
- `[x]` Mark/exclude legacy shell rows without deleting them
- `[x]` Replace shell/variant reconciliation with day-capacity consumption from one shared three-day physical pool
- `[~]` Ensure stock additions, holds, orders, cancellations, and allocations are atomic (ledger dual-write on purchases/adjustments/opening balance; full place_order/hold dual-write remains)
- `[x]` Define negative-stock records linked to deals and sourcing
- `[x]` Add an admin opening-balance/reset workflow so ZK can manually enter each product's verified live stock during cutover
- `[x]` Add inventory reconciliation report based only on Supabase

**Implementation evidence — 11 August 2026**

- Migration `supabase/migrations/20260811160000_native_inventory_foundation.sql` adds:
  - `suppliers` (+ `supplier_id` on purchase orders and cost layers)
  - `inventory_ledger_entries`
  - `inventory_reservations`
  - `inventory_pools`, `inventory_pool_day_capacity`, `package_day_consumption`
  - `packages.inventory_pool_id`
  - `sourcing_shortages`
  - RPCs: `admin_ensure_supplier`, `admin_append_inventory_ledger`, `admin_set_opening_balance`, `admin_adjust_stock_with_reason`, `admin_ensure_inventory_pool_for_group`, `seed_package_day_consumption`
  - View `native_package_availability`
  - Additive backfill of suppliers and pools from existing linked groups (no deletes)
- Native mode no longer creates shell single tickets (`ensureShellSingleTicketsForParent`, `createPackage`, shell backfill action).
- Admin actions: `setPackageOpeningBalance`, `adjustPackageStockWithReason`, `ensureInventoryPoolForPackageGroup`, `ensureSupplier`.
- Stock purchases append ledger rows and link PO suppliers.
- Helpers: `lib/inventory/day-capacity.ts`, `native-availability.ts`, `suppliers.ts`, `ledger.ts`.
- Tests: `tests/native-inventory-foundation.test.ts`.

**Apply locally:** run the new migration against your local/dev Supabase before exercising opening-balance / supplier RPCs.

**Exit criteria**

- One product can contain stock bought from multiple suppliers.
- Genuine day and two-day products safely consume the shared three-day physical pool.
- Availability is explainable from the native ledger.
- No shell is generated for a new product.
- Portal and Wix cannot sell negative availability.
- Supplier cost and margin remain traceable.

---

## Phase 1C — Inventory CMS and admin shell

**Goal:** Deliver the first visible rebuild aligned with the supplied design mockups.

- `[x]` Rebuild admin navigation and responsive shell
- `[x]` Create personalised dashboard framework
- `[x]` Build Inventory Sales List
- `[x]` Build Negative Stock List
- `[x]` Build Manage Inventory
- `[x]` Build event creation/edit/archive
- `[x]` Build product creation/edit/archive
- `[x]` Build stock purchase/adjustment flow
- `[x]` Build Purchase Orders
- `[x]` Build Suppliers
- `[x]` Add permissions for stock, price, purchasing, and archive actions
- `[~]` Add search, filters, saved views, bulk actions, and export where appropriate
- `[~]` Preserve agent-facing portal compatibility

### Phase 1C implementation evidence

- The admin shell now follows the supplied mockups: compact black ZK navigation, expandable Portal and Inventory groups, desktop search/header, user identity, mobile drawer, white workspace, red active treatment, and matching compact typography/cards.
- `/admin` now uses the mockup dashboard composition with six live summary cards, personal task and approval queues, sales/operations/finance panels, and recent orders.
- `/admin/inventory/sales-list` provides the live sales-facing stock table, stock filters, CSV export, selected-product detail panel, create-deal link, and place-hold link. It reads `native_package_availability`; deal reservations are already represented by `package_inventory.qty_held`, so they are not subtracted a second time. It surfaces sourcing shortages separately and excludes legacy shell rows.
- `/admin/inventory/negative-stock` reads native `sourcing_shortages`, supplier, package, event, quote, sale, and margin data without Salesforce.
- `/admin/catalog` now presents Manage Inventory in the mockup split-table/detail-panel layout while retaining the existing new-product flow and package detail routes.
- `/admin/purchase-orders` now uses the Phase 1C shell, summary cards, compact filter/table treatment, and preserves create/edit/document controls.
- `/admin/suppliers` provides the structured supplier directory, linked purchasing/package rollups, detail panel, and add-supplier workflow using `admin_ensure_supplier`.
- `/admin/catalog/events` provides native event creation, editing, soft archive, restoration, product counts, and active/archived filtering. Migration `20260811180000_native_event_management.sql` adds the non-destructive event lifecycle fields and an atomic archive RPC; archiving an event hides its products without deleting data.
- Manage Inventory now exposes direct purchase-stock navigation, audited `+/-` stock adjustments, verified opening-balance resets, and product archive/restore controls from the selected-product panel.
- Shared Phase 1C UI primitives live in `components/admin/admin-page-kit.tsx`; the sales/manage inventory workspace is shared through `components/admin/inventory-workspace.tsx`.
- Verification: TypeScript passes with `npx tsc --noEmit`; all 13 native platform/inventory tests pass.

**Exit criteria**

- An authorised user can create an event and product without Salesforce.
- The user can purchase stock from one or more suppliers into that product.
- Sales List availability matches the native ledger.
- Negative stock links back to the responsible deal.
- Existing products remain readable.

---

## Phase 2A — Native CRM core

**Goal:** Replace Salesforce Accounts, Contacts, Opportunities, line items, and pipeline for core sales work.

- `[x]` Add accounts and contacts
- `[x]` Link portal profiles to CRM records
- `[x]` Add leads and conversion
- `[x]` Add deals and deal line items
- `[x]` Add owner, source, event, expected close, next action, and loss reason
- `[x]` Add personal and team pipeline views
- `[x]` Add native deal reservations and expiry
- `[x]` Add do-not-expire/hold-until override
- `[x]` Add stage-transition validation
- `[x]` Add activity timeline and audit events
- `[x]` Add create-deal/create-hold actions from Inventory Sales List

### Phase 2A implementation evidence

- Migration `supabase/migrations/20260811190000_native_crm_and_roles.sql` adds:
  - Internal CMS roles `finance` and `sales` on `profiles.role`
  - `is_cms_staff()` / `has_cms_permission()` helpers
  - `crm_accounts`, `crm_contacts`, `deals`, `deal_line_items`, `deal_activities`
  - Foreign keys from `inventory_reservations.deal_id` and `sourcing_shortages.deal_id` to `deals`
  - RPCs `admin_ensure_crm_account` and `admin_create_deal_with_line` (optional 7-day reservation + ledger entry)
  - Approved agent profiles backfilled into CRM accounts
- Migration `supabase/migrations/20260811200000_deal_existing_account_contacts.sql`:
  - Backfills approved portal users as primary CRM contacts
  - Adds an atomic deal-creation RPC that links an existing account and one of its contacts
- Migration `supabase/migrations/20260811210000_native_crm_leads.sql`:
  - Adds native leads and immutable lead activity records
  - Links enquiries to accounts, contacts, owners, events, and products
  - Adds permission-gated creation and workflow updates
  - Converts a lead atomically into a native deal and carries its selected product, quantity, owner, value, next action, and audit history forward
- Migration `supabase/migrations/20260811220000_crm_write_policy_hardening.sql` replaces broad CMS-staff write policies with permission-aligned account and deal mutation policies; finance retains CRM visibility without direct write access.
- Migration `supabase/migrations/20260811240000_native_deal_workflow.sql` adds:
  - Validated, audited deal-stage transitions following enquiry → price → booking form → signatures → invoice → payment → fulfilment
  - Atomic stock reservation and idempotent release for all deal lines
  - Manual hold-until and do-not-expire controls
  - Automatic seven-day expiry that releases stock exactly once and returns unsigned booking-form stages to Price sent
- App permission map lives in `lib/auth/permissions.ts`; middleware/layout/`requireAdminAction` admit CMS staff and gate inventory/deal mutations by action.
- `/admin/leads` follows the Sales Leads concept with KPI cards, owner/status/source filters, lead and client-directory views, next-action management, existing-client or new-prospect capture, product interest and live stock/price context, and one-click conversion to a deal. Client spend combines non-cancelled historical portal orders with won native deals that are not already linked to an order, avoiding draft-pipeline inflation and order/deal double counting.
- `/admin/deals` follows the supplied Deals / Pipeline mockup with live KPI cards, distinct all/mine/team views, filters, six simplified pipeline-stage summaries, the searchable deal table, selected-deal detail panel, and native create-deal modal. Deal creation selects existing CRM accounts/contacts, provides searchable product selection, shows current sellable stock and listed price, and permits an explicit sale-price override. The detail panel now controls owner, validated stage progression, next action, close date, stock reservation, hold extension, do-not-expire and manual release. Unavailable booking-form actions are clearly deferred rather than populated with fake data.
- Inventory Sales List create-deal action now creates a native deal (optional reserve) instead of jumping to place-order.
- Tests: `tests/cms-permissions.test.ts` and `tests/deal-workflow.test.ts`.

**Exit criteria**

- An offline deal can be created without Salesforce.
- Deal lines affect availability according to the approved hold policy.
- Lost/expired deals release stock exactly once.
- Pipeline and inventory show the same reservation quantities.

---

## Phase 2B — Booking forms and e-signature

**Goal:** Generate, send, sign, store, and track booking forms.

- `[~]` Finalise booking-form fields and legal content — current supplied form is represented exactly enough for the native proof of concept; legal review is still required because the source text references clause 15.3 but does not contain clause 15.3
- `[x]` Finalise template/version model
- `[!]` Obtain the original high-resolution/editable current booking-form source — still required before production visual sign-off
- `[~]` Build and assess native-signature proof of concept; use PandaDoc only if it fails the agreed requirements — implementation complete, two-party acceptance test pending
- `[x]` Build provider-neutral document service
- `[x]` Generate document from an immutable deal snapshot
- `[x]` Send secure client signer link and start seven-day reservation
- `[x]` Add automatic unsigned-form reminders
- `[x]` Void unsigned forms and release reservations after seven days
- `[x]` Enforce client-first, approved-admin-second signing
- `[x]` Handle viewed, signed, declined, expired, and voided events
- `[x]` Store final signed PDF privately
- `[x]` Add complete audit evidence
- `[x]` Add resend, reminder, void, and regenerate controls
- `[x]` Make public signer operations authenticated by hashed one-time bearer links and idempotent database transitions; native flow has no third-party webhook

### Phase 2B implementation evidence

- Migration `supabase/migrations/20260811250000_native_booking_forms.sql` adds:
  - Versioned `booking_form_templates`
  - Immutable `booking_forms` snapshots with revision lineage and hashed signer tokens
  - Separate signature evidence and append-only audit-event tables
  - A private `booking-form-documents` storage bucket
  - Permission-gated/admin-only and service-role RPCs for creation, send, view, client signature, decline, admin countersignature, completion, void, and expiry
  - Atomic reservation start/release and validated deal-stage updates
- `lib/booking-forms/snapshot.ts` creates a canonical account/contact/product/pricing/VAT/legal snapshot and SHA-256 digest. Abu Dhabi uses the existing 5% tax-inclusive calculation; other events use 0%.
- `lib/booking-forms/pdf.ts` provides the native provider-neutral PDF renderer, including the supplied payment instructions, terms, both signatures, and final evidence certificate.
- `/sign/booking/[token]` provides the responsive client review and hand-drawn signature flow. Raw tokens are never stored; only SHA-256 hashes are persisted.
- The Deals detail panel now supports pre-send review with per-revision title/payment/special-term overrides, create/send, private PDF preview, secure-link resend, client/ZK status, admin countersignature, void/release, regenerate-as-new-revision, and audit visibility.
- `processNativeBookingForms()` sends unsigned reminders on days three and six, expires forms after seven days, releases stock once, and queues inventory channel reconciliation.
- Completed PDFs and signature images are stored privately; authorised CMS users receive short-lived download URLs.
- `tests/native-booking-forms.test.ts` verifies secure token hashing, deterministic snapshots, and multi-page native PDF generation. The complete automated suite passes.
- Phase 2C remains responsible for native deal → order → Xero invoice automation. Phase 2B stops at a completed signed agreement and does not create an invoice early.

**Exit criteria**

- Both parties can complete a test document.
- An approved admin cannot sign before the client.
- An unsigned form expires after seven days and releases stock once.
- The signed document cannot silently change afterward.
- The final PDF and audit trail are available to authorised users.
- Deal stage updates once and only once.
- No invoice is created before the required signatures.

---

## Phase 2C — Xero and payment automation

**Goal:** Connect the signed native deal to the existing Xero lifecycle.

- `[x]` Link native deal → order → invoice
- `[x]` Queue invoice creation after signature completion
- `[x]` Always bill the agent company in Xero
- `[x]` Automatically email the invoice, while allowing an authorised manual corrected/resend flow
- `[x]` Preserve existing USD, due-date, branding, account-code, and Xero configuration
- `[x]` Apply 0% VAT except Abu Dhabi events, which use the existing 5% tax-inclusive Xero treatment
- `[x]` Update native deal to Awaiting payment after invoice creation
- `[x]` Update native deal to Paid/Confirmed from Xero webhook
- `[x]` Add automatic overdue reminders and failed-sync queues
- `[x]` Flag orders for admin cancellation at 28 days overdue and support earlier admin cancellation
- `[x]` Add manual reconciliation with audit
- `[x]` Verify retries cannot duplicate invoices at the application/database boundary

### Phase 2C implementation evidence

- Migration `supabase/migrations/20260812100000_native_deal_xero_automation.sql`:
  - Links native CRM accounts, contacts, and deals to the existing order/invoice lifecycle without requiring a portal profile.
  - Adds multi-line `order_line_items`, while preserving the legacy scalar order fields for existing portal/admin views.
  - Converts every active deal reservation to committed stock atomically, allocates cost layers per package, and writes balanced reservation-release/order-commit ledger evidence.
  - Creates exactly one order and one invoice row per signed deal; unique deal/order and invoice/order constraints make retries idempotent.
  - Prevents commercial deal-line edits after a booking-form snapshot is sent while allowing internal reservation-state updates.
  - Removes hold expiry after the client signs so stock cannot be released while awaiting the ZK countersignature.
  - Adds invoice email/reminder, overdue, 28-day cancellation-eligibility, cancellation, and reconciliation fields.
  - Adds an atomic multi-line native-order cancellation RPC that restores cost layers and stock only after the Xero invoice is confirmed void.
- `ensureNativeDealOrderAndInvoice()` runs immediately after the final ZK signature, commits the signed snapshot to an order, and queues the existing `invoice.create` outbox event without Salesforce.
- Xero invoice generation now:
  - Bills the linked CRM agent-company account/contact.
  - Supports all native order lines on one invoice.
  - Preserves existing Xero account code, item, due-date, branding, authorisation, and email configuration.
  - Applies per-line Abu Dhabi 5% tax-inclusive treatment and the existing 0% tax type elsewhere.
  - Recovers an existing Xero invoice by the unique order reference and also sends an Xero idempotency key before creating, protecting the external-call/local-write failure window.
- The authenticated Xero webhook marks the invoice paid, confirms the order, advances the native deal to Paid / Confirmed, and records deal activity.
- `processNativeInvoiceReminders()` verifies current Xero state before emailing, sends weekly overdue reminders with the invoice PDF, and flags the deal for reviewed cancellation after 28 days.
- The Deals detail panel exposes invoice creation retry, PDF download, resend, Xero reconciliation, sync/email/reminder failures, due date, reminder count, and reviewed cancellation to finance/admin users.
- Corrected invoices remain edited in Xero, then the CMS Reconcile and Resend controls pull the current Xero state/PDF and deliver the corrected copy.
- `tests/native-deal-finance.test.ts` covers weekly reminder cadence and the 28-day cancellation threshold. The complete automated suite passes.

**Exit criteria**

- Signed deal creates one Xero invoice.
- Xero payment updates the correct native deal.
- Finance can see and retry failures.
- Salesforce is not involved.

---

## Phase 2D — Sales, finance, and operations views

**Goal:** Make the native workflow usable end to end.

- `[x]` Deals table and pipeline
- `[x]` Finance Deals Tracker
- `[x]` Revenue and gross-profit Sales Tracker
- `[x]` Confirmed-order operations queue
- `[x]` Guest details and communication status
- `[x]` Supplier fulfilment and delivery status
- `[x]` Personal/team dashboard tasks
- `[x]` Approval and overdue queues

### Phase 2D implementation evidence

- Migration `supabase/migrations/20260812110000_native_sales_finance_operations_views.sql` adds:
  - One `order_operations` workflow projection per portal, Wix, admin, or native-deal order.
  - Audited fulfilment, guest-detail, communication, supplier and delivery states with assigned operations owner and due dates.
  - Structured `order_guests`, including lead guest, contact, nationality, DOB, dietary/special requirements, and completion state.
  - Per-line `order_supplier_fulfilments` with supplier, quantity, supplier reference, expected date, confirmation and ticket-receipt states.
  - Append-only `order_operation_events`, role-appropriate operations permissions, automatic order backfill, and invoice paid/delivered/cancelled workflow projection.
- `/admin/finance` is the mockup-led Finance Deals Tracker with queue tabs, booking-form state, actual Xero amount due/paid, payment and invoice state, overdue/reminder dates, Xero identifiers, selected-deal finance progress, filters, and source/owner visibility. It loads every committed order plus unlinked CRM deals (offline, website, referral, Salesforce, and portal) so finance is not limited to trade-portal checkouts.
- `/admin/sales-tracker` follows the source-reporting mockup with month/year controls, source-level monthly and YTD revenue/GP, average order value, source selection drawer, top events, revenue split, monthly trend, and CSV export. It deliberately omits a fabricated conversion percentage until lead attribution provides a defensible denominator.
- `/admin/operations` is a full-width confirmed-deal queue (no side overview). Rows show deal ID, client, full event name, event date, payment, guests, supplier, delivery, and owner. Default sort is soonest event first; staff can sort by deal, client, event, or date, and switch between future events and all events. Guest and supplier editing open as row-level modals. Unlinked offline/historical deals appear in the queue and link through to the deal record until a committed order exists.
- Portal checkout, admin place-order, and partner-api bookings now attach a CRM deal to the existing order (no second order or invoice). Checkout terms stand in for the booking form on portal sales. The Sales nav no longer lists Confirmed orders; `/admin/orders` remains as an unlisted route.
- Deal references are sequential `DL0000`, `DL0001`, … assigned on insert and backfilled chronologically.
- The admin sidebar hides its scrollbar, drops the redundant Admin label, and shows Marketing as a non-clickable later module.
- The dashboard now uses assigned deal next actions and operations ownership for a personalised `My tasks` queue, alongside team approval, overdue, supplier, guest and delivery queues.
- Finance has read-only operations visibility; sales/admin users can manage operations workflow. Existing finance and sales permission boundaries remain enforced.

#### Operations first-build (19–20 August 2026)

This is the operations slice needed to run confirmed work without Salesforce:

- Operations title and tabs: All confirmed deals, Awaiting guests, Supplier action, Ready to deliver, Delivered. Cancelled deals are excluded.
- Delivery is a three-step queue: **Not Ready → Ready → Delivered**. Guest and delivery status persist on `deal_operations` for imported deals that have no native order yet.
- Guest-details request and operations-intro emails can be previewed, edited, sent, and stored in `operations_emails`.
- **Manage guests** works for every confirmed row, including deals without a native order (`deal_guests`).
- **Manage supplier** is rebuilt around real inventory, not a chase list. The queue shows who was used and how many places are left. Native orders save through `admin_reassign_order_package_stock` (that order and product only, including linked day / 3-day leftover). Imported deals without an order map `deal_line_items.supplier_id` / `fulfilment_cost_layer_id` and do **not** deduct `quantity_remaining` until an order exists.
- Leftover counts treat confirmed imported deals as sold, so Operations “left” matches catalog sold/left instead of the stale cost-layer remainder.
- Multi-product deals list each product on its own Event line and each supplier assignment as its own stacked block. The Manage supplier modal was already one product per block.
- SQL for this slice (apply on the database Vercel uses if not already applied):
  - `20260819120000_operations_delivery_and_deal_ops.sql`
  - `20260819130000_operations_emails.sql`
  - `20260819140000_deal_guests.sql`
  - `20260819150000_operations_reassign_stock.sql`
  - `20260819160000_operations_reassign_stock_ledger.sql`
  - `20260819170000_operations_reassign_linked_stock.sql`

**Exit criteria**

- Sales, finance, and operations can run the first-build flow without Salesforce.
- Every deal has a clear owner, stage, next action, payment state, and fulfilment state.

---

## Phase 3 — Migration and controlled cutover

**Goal:** Prove parity and prepare for an eventual production decision.

- `[x]` Create Salesforce export/import tooling
- `[~]` Finish checking imported accounts, contacts, and deals (Matt; in progress, not a blocker for code)
- `[x]` Import Salesforce deals, open opportunities, and contacts from January 2026 onward (tooling and load done; review remaining)
- `[x]` Preserve historical IDs and source references
- `[x]` Document rollback and recovery
- `[x]` Retire the Cutover tab from daily admin navigation. `/admin/cutover` remains available to admins if a baseline or reservation rollback is ever needed; it is not part of first-build day-to-day use.
- `[ ]` Obtain business sign-off after production deploy

**Exit criteria**

- Imported deals and contacts are reviewed and usable in Accounts / Deals / Operations.
- Production runs with `ZK_PLATFORM_MODE=native` so Salesforce is not operationally authoritative.
- Xero and Wix continue to work against Supabase.

### Phase 3 import-tooling implementation evidence

- Migration `supabase/migrations/20260811230000_salesforce_bulk_imports.sql` adds:
  - Audited import batches and row-level validation/apply results
  - Preserved Salesforce Account, Contact, Opportunity, Opportunity Product and timestamp references
  - Idempotent matching by Salesforce ID, then safe account/contact fallbacks
  - Atomic row application with retryable failures
  - Explicit stock-reconciliation status for historical won sales
- `/admin/imports` provides separate Contacts/Accounts and Deals/Sales/Opportunities CSV workflows, downloadable templates, validation preview, warning/error review, explicit approval, retry history and row-level outcomes.
- CSV parsing accepts common Salesforce report header variants and maps legacy stages into the simplified native pipeline.
- Import application does not reserve stock, alter inventory, create invoices, send messages or contact clients. Won rows are marked `pending` for a separate stock-reconciliation decision, preventing historical sales from being applied twice.
- Imported opportunities are linked to existing portal orders by Salesforce Opportunity ID. Won line items already present in `salesforce_offline_sale_applications` are marked reconciled; only unexplained won rows remain pending. Product lines can also carry matched supplier and expected buy-price data for historical margin reporting.
- Import parser coverage lives in `tests/salesforce-csv-import.test.ts`.

### Phase 3 controlled-cutover implementation evidence

- Migration `supabase/migrations/20260812115000_phase2_workflow_hardening.sql` resolves the pre-cutover safety review:
  - Signed booking-form deal lines remain immutable even if an update attempts to move the line to another deal.
  - Native order cancellation now requires short-lived service-side evidence that the linked Xero invoice was actually voided; a caller-supplied boolean is no longer sufficient.
  - Invoice-line arithmetic, supplier-fulfilment line ownership, supplier-data RLS, finance invoice updates, inserted paid invoice operations state, terminal workflow state, guest completeness/lead uniqueness/deletion, supplier-backfill state, and clearable operations dates/ownership are hardened.
  - Unsupported inferred payment timestamps from the original operations backfill are removed where no Xero paid amount exists.
- Migration `supabase/migrations/20260812120000_controlled_native_cutover.sql` adds:
  - Admin-only cutover runs with immutable baseline time, pilot event, baseline order/deal/invoice metrics, status gates, approval evidence, and append-only activity.
  - Per-package baseline evidence covering live available, held and sellable stock, cost-layer units, reservations, shortages, opening-balance verification and unresolved supplier attribution.
  - Separate open-pipeline and historical-won reconciliation queues, preserving the rule that historical won imports never deduct stock automatically.
  - Explicit preparation of one imported open deal at a time using the atomic native reservation RPC. Every reservation created by cutover preparation is linked to its run.
  - A scoped rollback RPC that releases only still-active reservations created by that cutover run. It deliberately does not delete imports or legacy data, reverse opening balances, touch orders/invoices, or call Salesforce/Xero.
  - Guarded progression from baseline to parallel run, pilot ready, pilot running, pilot passed and approval. Pilot and approval gates reject unresolved package/deal reconciliation.
- `/admin/cutover` provides the operational workspace for:
  - Capturing a named baseline and selecting one pilot event.
  - Side-by-side baseline-versus-live stock drift, with CSV evidence export.
  - Audited opening-balance resets and supplier-source decisions.
  - Preparing imported open opportunities as native reservations.
  - Recording evidence-only decisions for imported historical won deals.
  - Pilot status progression, audit history, business approval and scoped reservation rollback.
- The recovery procedure is displayed in the workspace: stop the pilot, export evidence, release cutover-created reservations, manually review later inventory ledger entries, restore the previously approved runtime configuration if relevant, and reconcile orders/invoices/Xero before resuming.
- The new migration must be applied before using `/admin/cutover`. Creating a baseline is read-only; reservation, opening-balance and status actions remain explicit admin decisions.
- Migration `supabase/migrations/20260813100000_native_deal_editing.sql` and the Deals workspace now allow sales/admin users to correct imported deal accounts, contacts, source, notes, products, quantities, sale prices and expected costs. Active reservations must be released first, all products must belong to one event, and deals remain immutable after a booking form is sent or an order exists. Correcting an imported won deal returns its evidence-only stock reconciliation to pending without changing inventory.
- Migration `supabase/migrations/20260813110000_deal_event_synchronization.sql` backfills imported deal events from their mapped product lines and keeps the deal event synchronized after future line imports/edits. The deal editor now exposes Event explicitly and filters its product choices to that event.
- Event labels in deal editing, inventory options, reporting and deal details always include the season (for example `2026 Abu Dhabi Grand Prix`). Salesforce product-name matching now uses both event location and year so equivalent 2026/2027 products are not treated as the same event.
- The deal editor loads its Event list directly from all event records and includes hidden non-shell products for historical corrections, so lost/price-sent imports retain their existing selections. Cross-season product-name imports are rejected for manual review rather than linked to the wrong year. Migration `20260813120000_historical_deal_hidden_product_editing.sql` permits correction of historical deals that reference products hidden from current storefront sale.
- Migration `supabase/migrations/20260813130000_inventory_product_cleanup.sql` adds safe product removal and generated-shell cleanup. Only rows with `shell_parent_package_id` are treated as legacy shells; genuine sellable one-day/two-day products remain. Unused products can be hard-deleted locally, while anything with business/audit history is archived automatically.
- Manage Inventory now has working event, year, stock-type and status filters; event/product/date/stock/price sorting; season-aware search/export; immediate list refresh; generated shells excluded from the workspace; and explicit archive, restore, safe delete and legacy-shell cleanup controls. The redundant reasoned stock-adjustment panel was removed and `Purchase stock` was renamed `Add stock`.
- Product publishing is controlled directly from the Manage Inventory preview: `Live on agent portal`, `Live on website`, editable website price, and `Hidden` checkboxes replace the old archive action. The list displays Portal/Website/Hidden status pills and can filter by each state. Portal catalog queries now enforce the portal toggle, hidden products remain available to internal admin ordering, and native-mode website changes queue Wix creation, price updates, publication or unpublication.
- Events now carry a top-level category (`Formula 1`, `Tennis`, `Football`, `Concert`, or `Other`) through migration `20260813140000_event_categories.sql`; all existing events are backfilled as Formula 1. The Events workspace defaults to future events sorted nearest-first and supports all-events, category, archived, search and date/name/category/product-count sorting.
- Sales List now provides one unified CRM-first customer workflow for deals and holds. Staff can search existing companies/contacts, correct company or contact details inline, add another contact, or create a new CRM company and contact without leaving the product. `Place hold` no longer redirects to the legacy portal-agent Holds page: it creates an auditable native deal reservation for any CRM contact (portal user or not), with automatic seven-day expiry.
- Sales Tracker and dashboard confirmed-sales totals include imported historical won deals that have no native order, without creating fake invoices, operational orders or stock movements. Deals already linked to orders are counted only through the order, preventing duplication.
- Confirmed Orders remains distinct from Deals: a deal is the sales opportunity; an order is the committed post-signature record used by inventory, finance and fulfilment.

---

## Phase 4 — Broader platform modules

These follow the immediate inventory and offline-sales priorities. Most remain later work. Help was pulled into the first-build so the team can use the admin without a separate handbook.

- `[ ]` Sourcing requests and supplier comparisons
- `[ ]` Deeper operations automation (templates centre, scheduled guest chasers, supplier email templates)
- `[ ]` Campaign and ROI tracking
- `[ ]` Targeted email campaigns
- `[ ]` Advanced roles and permissions
- `[x]` Guides and help — `/admin/help` first-build getting started + self-help (26 August 2026). Not a video knowledge base.
- `[ ]` Integration health and activity centre
- `[ ]` Template management
- `[ ]` Slack and Outlook integrations
- `[ ]` Partner API

---

## Phase 5 — Approved legacy retirement

**Goal:** Take Salesforce out of the live product after the native first build is in use. Remaining Phase 4 modules stay skipped; Help was brought forward into the first build.

**Status:** Runtime retirement done 20 August 2026. Schema and library deletion remain later, on purpose.

- `[x]` Archive required Salesforce data in place (historical Account / Contact / Opportunity / Product IDs stay on imported rows)
- `[x]` Stop Salesforce cron pull, stale-opportunity expiry, and linked-group heal from Salesforce
- `[x]` Skip Salesforce outbox work (`order.placed`, `order.outcome`, Product2 upsert). Wix catalog and Xero invoice jobs still run
- `[x]` Remove Salesforce from Settings → Integrations. Old `/admin/integrations/salesforce` and OAuth URLs redirect to Settings
- `[x]` Stop shell creation and package-item sync (native mode already did this; runtime is now always native)
- `[x]` Keep legacy database columns/tables (`salesforce_product_id`, `salesforce_opportunity_id`, import batches, offline applications). Do not drop them
- `[x]` Salesforce modules remain in the repo but cannot run (`isSalesforceRuntimeEnabled()` is always false)
- `[x]` CRM Imports stay for historical CSV loads; they do not reconnect to Salesforce
- `[ ]` Optional later: delete `SALESFORCE_*` environment variables from Vercel
- `[ ]` Optional later: delete Salesforce TypeScript modules and unused outbox event types after a stable period
- `[ ]` Optional later: deprecate unused Salesforce columns once reporting no longer needs the IDs

**What must not break**

- Xero invoice create, payment webhook, and reminders
- Wix listing/stock sync and paid website orders
- Portal and admin inventory, holds, deals, booking forms, operations
- Historical Salesforce IDs on imported accounts, contacts, deals, and packages
- CRM import CSVs that still use Salesforce report headers

**What staff will notice**

- Settings → Integrations shows Xero and Wix only
- Cron no longer pulls Salesforce stock or open pipeline
- Catalog remaining / sold uses native portal, website, and imported-deal figures only
- Product create no longer asks for a Salesforce Product Id

---

## 11. Inventory acceptance scenarios

The automated and manual test plan must include:

1. Create an event and a product without Salesforce.
2. Add 10 units from Supplier A and 5 units from Supplier B.
3. Confirm the product shows 15 owned units and preserves both costs.
4. Place a manual hold and verify availability, expiry, and release.
5. Create an offline deal reservation and verify availability.
6. Lose/expire the deal and verify one exact release.
7. Sign the deal and convert its reservation into committed order stock without double deduction.
8. Complete Xero payment without changing inventory a second time.
9. Allocate one order across two supplier lots and verify COGS/margin.
10. Confirm a shortage appears on Negative Stock but storefront availability remains zero.
11. Add stock to cover the shortage and link it to the deal.
12. Process a portal order and a Wix paid order concurrently without overselling.
13. Cancel an eligible order and verify the approved stock/cost reversal.
14. Load an existing shell-linked product without generating or depending on shell rows.
15. Verify real day-duration products follow the approved target rule.
16. Retry every integration/webhook and prove idempotency.
17. Send a booking form, verify immediate reservation, reminders, and exact release after seven unsigned days.
18. Verify the client signs first and only an approved admin can countersign.
19. Verify a fresh sourced supplier quote permits negative-stock confirmation and a quote older than 24 hours blocks it.
20. Verify 0% VAT for a normal event and the existing 5% tax-inclusive treatment for Abu Dhabi.
21. Verify automatic overdue reminders and admin cancellation/release at or before the 28-day threshold.

---

## 12. Security, permissions, and compliance

Required from the start:

- Supabase RLS for new CRM/document entities
- Server-side authorisation on every mutation
- Three internal roles (`admin`, `finance`, and `sales`) in addition to the external trade-agent portal identity
- Private document storage with short-lived signed access
- Authenticated and replay-safe webhooks
- No secrets in browser code or audit payloads
- Append-only audit trail for sensitive actions
- Data retention and deletion policy
- Permission checks for financial, margin, client, and signature data
- Backup and restore test before production migration

Initial internal roles:

- **Admin:** full CMS/CRM access; inventory, price, margin, purchasing, user, permission, template, integration, cancellation, override, and ZK-signature authority.
- **Finance:** invoices, Xero status, payments, reminders, overdue accounts, finance reporting, and approved finance corrections; no general stock or CRM administration.
- **Sales:** leads, accounts, contacts, sourcing, deals, quotes, booking forms, and personal/team pipeline; no admin overrides, integration settings, or general finance administration.

External trade agents retain their portal identity and are not an internal CMS role. Permissions should still be action-based internally so access can be refined without redesigning the schema.

---

## 13. Engineering principles

1. Use additive migrations; never rewrite already-applied migration history.
2. Keep business state transitions in tested server/database services, not scattered UI handlers.
3. Break up the current large admin server-actions file as modules are rebuilt.
4. Use idempotency keys for orders, reservations, documents, invoices, and webhooks.
5. Use an outbox for external side effects.
6. Keep an immutable snapshot of customer-facing commercial documents.
7. Make stock explainable from ledger entries rather than repair scripts.
8. Do not use page loads to silently heal inventory.
9. Prefer explicit product relationships over name-based inference.
10. Add observability and a retry queue for every external integration.

---

## 14. Key risks

### Inventory drift during Salesforce disconnection

**Risk:** Salesforce-only won/open deals currently affect stock.  
**Mitigation:** Baseline export, native deal reservations, one-time reconciliation, and pilot products before disabling the pull.

### Existing linked-product behaviour

**Risk:** Removing all linked logic indiscriminately could oversell genuinely shared day/multi-day stock.  
**Mitigation:** Remove generated shells as a concept, but classify real sellable variants before changing their stock-pool rules.

### Double deduction

**Risk:** Deal reservation, signed order, Salesforce application, and existing order deduction could all represent the same quantity.  
**Mitigation:** One native reservation/allocation ledger with idempotent conversion and imported-source references.

### E-signature legal/evidential quality

**Risk:** A visually drawn signature alone may not meet ZK's contractual and evidence requirements.  
**Mitigation:** Provider-neutral design, legal requirements review, immutable PDFs, signer authentication, consent, timestamps, and audit evidence.

### No current automated regression suite

**Risk:** Inventory changes can reintroduce known concurrency and reconciliation failures.  
**Mitigation:** Convert critical diagnostic scenarios into automated tests before changing the stock engine.

### Scope expansion

**Risk:** The full concept includes CRM, operations, finance, marketing, permissions, and integrations.  
**Mitigation:** Hold Phase 1 to inventory/admin foundation and Phase 2 to offline sales/signature/Xero.

---

## 15. Success measures

The first release is successful when:

- New events and products can be created without Salesforce.
- No generated shell tickets are needed.
- Multiple supplier purchases roll up accurately under one product.
- Native stock equals purchases minus commitments and holds, with an audit trail.
- Portal and Wix availability remains safe.
- An offline deal can complete booking form, signatures, Xero invoice, payment, and fulfilment stages.
- Salesforce can be disconnected with no required operational workflow missing.
- The new admin interface gives each team a clear queue and next action.

---

## 16. Decisions and remaining questions

### Confirmed inventory decisions

- `[x]` Genuine individual-day and two-day sellable products remain.
- `[x]` Individual-day and two-day products share the same underlying three-day physical stock pool.
- `[x]` Generated hidden Salesforce shells are not part of the new model.
- `[x]` Negative stock is allowed only through sourcing.
- `[x]` A sourced negative-stock booking requires a supplier quote confirmed within the previous 24 hours.
- `[x]` Sending a booking form starts a seven-day stock reservation.
- `[x]` An unsigned form is voided after seven days and its stock is released.
- `[x]` Admin is the only role allowed to override stock, price, margin, expiry, or cancellation rules.
- `[x]` Existing stock does not need perfect legacy reconciliation: an admin will review products and enter verified live opening totals during cutover.

### Confirmed CRM and booking decisions

- `[x]` Build a native signing proof of concept first, retaining PandaDoc as fallback.
- `[x]` The client signs first.
- `[x]` An approved admin signs for ZK after the client; Michel is the normal signer, but any approved admin may sign.
- `[x]` The supplied current three-page booking form is the initial editable template.
- `[x]` Completing both signatures immediately creates the order, commits stock, and sends the Xero invoice.
- `[x]` Portal, admin, and partner-api checkouts create or attach a CRM deal to the existing order; they must not create a second order or invoice. Portal checkout terms stand in for the signed booking form.
- `[x]` Overdue invoices receive automatic reminders.
- `[x]` At 28 days overdue, an admin can cancel and release stock; an admin may choose to cancel earlier.

### Confirmed Xero decisions

- `[x]` Xero always bills the agent company.
- `[x]` Deals and invoices are always in USD.
- `[x]` VAT is 0% except for Abu Dhabi events, which use the existing 5% tax-inclusive Xero configuration.
- `[x]` Invoices are emailed automatically.
- `[x]` Authorised users can manually issue a changed/replacement invoice when required.

### Confirmed roles and migration decisions

- `[x]` Internal CMS roles are Admin, Finance, and Sales.
- `[x]` Import all Salesforce deals, all open deals, and contacts from the start of Salesforce use in January 2026.

### Remaining questions

- `[?]` Confirm the schedule and wording of unsigned-form reminders before the seven-day expiry.
- `[?]` Confirm the schedule and wording of overdue invoice reminders.
- `[x]` First-build go-live does not wait on a Salesforce parallel-run. Native mode disables Salesforce runtime; remaining Phase 3 work is imported deal/contact review.
- `[x]` First pilot set: Singapore Velocity Terrace, Abu Dhabi Velocity Terrace (including 5% VAT), one standard three-day product, and one sourced negative-stock deal.

---

## 17. Decision log

### 11 August 2026

- **Decided:** Build a ZK-owned CMS/CRM and remove Salesforce from the target architecture.
- **Decided:** Inventory is the first priority and the new platform will be its source of truth.
- **Decided:** Generated single-day Salesforce shell tickets are not part of the target model.
- **Decided:** Multiple suppliers can contribute stock to one customer-facing product.
- **Decided:** Offline deals require booking-form/signature, Xero invoice, and payment-stage automation.
- **Decided:** The admin dashboard will be redesigned around the supplied concept and future mockups.
- **Decided:** The prototype is local-only.
- **Decided:** Salesforce and Supabase data must not be destructively deleted during the prototype.
- **Decided:** Existing Xero integration should be reused and connected to the native process.
- **Decided:** Genuine individual-day and two-day products remain and consume the same physical three-day stock pool.
- **Decided:** Negative stock is sourcing-only and requires a supplier quote confirmed within 24 hours of signing.
- **Decided:** Booking-form send reserves stock for seven days; unsigned forms expire, notify the client, and release stock.
- **Decided:** Build native e-signature first with PandaDoc as fallback.
- **Decided:** Client signs first; Michel or another approved admin signs for ZK.
- **Decided:** Both signatures create the order, commit stock, and automatically send the Xero invoice.
- **Decided:** Overdue invoices receive reminders; admin may cancel/release stock, with the order flagged at 28 days overdue.
- **Decided:** Xero bills the agent company in USD, using 0% VAT except existing 5% tax-inclusive treatment for Abu Dhabi.
- **Decided:** Internal roles are Admin, Finance, and Sales.
- **Decided:** Import all Salesforce deals and contacts from January 2026 onward, including all open deals.
- **Decided:** Admin may reset each product to a manually verified live opening stock balance during cutover.
- **Decided:** Use the recommended pilot set: Singapore Velocity Terrace, Abu Dhabi Velocity Terrace, one standard three-day product, and one sourced negative-stock deal.
- **Received:** Complete five-page booking form, terms, signatures, and PandaDoc certificate for the initial native template.

### 14 August 2026

- **Decided:** Every committed sale is a CRM deal, regardless of source. Portal/admin/partner checkouts attach a deal to the existing order and keep the current invoice/email path; they do not create a second order or invoice.
- **Decided:** Portal checkout terms replace the signed booking form for portal bookings. Native offline deals still use the booking-form signature flow.
- **Decided:** Finance and Operations list all deal sources (portal, offline, website, referral, admin, Wix, Salesforce), not portal orders only.
- **Decided:** Operations is a full-width work queue sorted by soonest event date, with a future-events filter and no side overview. Guest and supplier editing stay as row actions.
- **Decided:** Deal IDs are sequential `DL0000` onwards, assigned in created-at order.
- **Decided:** Marketing remains visible in the admin nav but is not clickable until that module is built.
- **Decided:** The Sales nav Accounts item keeps the `/admin/leads` URL; Confirmed orders is removed from the nav.

---

### 20 August 2026

- **Decided:** The first build is complete enough to take live. Remaining work is imported deal/contact review, production env, and a live Xero / booking-form smoke test — not more Cutover-tab process.
- **Decided:** Remove Cutover from the admin nav. Keep `/admin/cutover` for admin recovery only.
- **Decided:** Production must set `ZK_PLATFORM_MODE=native`. Salesforce environment variables stay in Vercel for rollback, but native mode makes them inert (no connect, pull, or opportunity sync). Do not delete them until Phase 5.
- **Decided:** Imported deals without a native order map supplier on the deal line and do not consume `quantity_remaining` until an order exists. Operations leftover still counts those deals as sold so the number matches catalog.
- **Decided:** Skip Phase 4 for now. Proceed with Phase 5 Salesforce retirement because Salesforce is fully replaced.
- **Decided:** Phase 5 retires Salesforce at runtime without dropping historical columns or deleting the integration library yet. Native mode is now always on; leftover `SALESFORCE_*` credentials cannot reconnect the live product. Settings no longer shows Salesforce.

### 26 August 2026

- **Decided:** The first-build admin is complete enough to share with the ZK team. Remaining work is production deploy, imported deal/contact review, and a live Xero / booking-form smoke test — not more admin modules.
- **Decided:** Pull a simple in-app Help tab into the first build (`/admin/help`): getting started for the team plus self-help on what each area does. Keep it short and practical. Videos, marketing, sourcing comparisons, Slack/Outlook, and partner API stay later.
- **Decided:** Once both parties have signed, the deal holds purchased stock and can be assigned a fulfilment supplier. Payment status is independent — Awaiting payment still counts as sold stock.
- **Decided:** Adding or editing a signed deal line allocates only that line. Prefer a supplier already used on the same deal when leftover stock is enough, rather than reshuffling every party on the product.
- **Decided:** When packing purchased stock onto deals, keep a whole party on one supplier/purchase source where possible (pack the deal, not each split line).

### 27 August 2026

- **Decided:** Keep the Sales nav item as Accounts. Add a Leads tab on the same page as a work queue for prospects who have not booked yet. Do not rename the section to Leads, and do not revive the `crm_leads` enquiry inbox.
- **Decided:** Account `lifecycle` is `lead` or `client`. Lead stages are New, Reach out, Talking, Later, and Not a fit. New accounts and bulk uploads start as New. Historical prospects backfill to Later so the queue is not a dump of old Salesforce.
- **Decided:** A signed/sold deal or a non-cancelled order auto-promotes Lead → Client only. Deals remains the booking pipeline. Marketing campaigns stay a later module; Later is the hold list for that.

---

## 18. Change log

### 27 August 2026 — Leads work queue inside Accounts

Sales → Accounts keeps its name and URL. A Leads tab is the prospect work queue (`lifecycle` + `lead_stage` on `crm_accounts`). Booking marks the account as a client. Amber highlighting is only for New rows on that tab.

### 26 August 2026 — First-build admin complete; Help tab; signed-deal stock

The admin first build is complete enough to share with the team. Salesforce is not part of day-to-day work.

- In-app Help at `/admin/help`: getting started plus simple self-help for Dashboard, Portal, Inventory, Sales, Operations, Finance, and Settings. Marketing remains a later module.
- Signed / awaiting-invoice / awaiting-payment deals hold purchased stock (`20260826130000_signed_deals_hold_purchased_stock.sql`). Payment status stays separate.
- Extra places on a signed deal allocate only the changed line (`20260826160000_incremental_signed_deal_line_allocation.sql`).
- Supplier packing prefers one source per party and packs the whole deal (`20260826140000_single_supplier_repack_allocations.sql`, `20260826150000_repack_deals_not_lines.sql`).
- Cost-layer quantity changes keep remaining units in sync (`20260826120000_cost_layer_quantity_keeps_remaining_in_sync.sql`).
- Staff should use Help, not this master plan, as the day-to-day user guide.

### 20 August 2026 — First build ready; operations complete; Cutover tab retired

The native CMS/CRM first build is now the intended production product. Salesforce is no longer required for inventory, deals, operations, or reporting.

- Operations first-build: delivery queue, guest management for native and imported deals, intro and guest-request emails, stock-based supplier assignment, leftover counts aligned with catalog sold stock, multi-product Event and Supplier layout.
- Cutover removed from the admin sidebar. The workspace is not deleted.
- Go-live checklist and Vercel environment notes added below.

### 20 August 2026 — Phase 5 Salesforce runtime retirement

Salesforce is fully retired from the live product. Phase 4 is skipped.

- Native mode is hardcoded. `ZK_PLATFORM_MODE` can no longer turn Salesforce back on.
- Settings → Integrations shows Xero and Wix only. Salesforce admin and OAuth routes redirect there.
- Cron no longer pulls Salesforce inventory, expires Salesforce opportunities, or heals linked groups from Salesforce.
- Outbox still processes Wix catalog and Xero invoices. Salesforce opportunity/product jobs are skipped.
- Historical Salesforce IDs, CRM CSV imports, and Salesforce library files remain. Database columns are not dropped.

### 14 August 2026 — Deals as the commercial record; finance and operations usable

Caught the master plan up after a large local CRM/CMS pass. Overall effect: the native deal is now the record staff work from after a sale, across portal and offline, and Phase 2D finance/operations views are usable rather than empty.

- Sequential deal IDs (`DL0000`…) via `supabase/migrations/20260814160000_deal_dl_references.sql`.
- Portal/admin/partner orders attach a CRM deal without a second order or invoice (`supabase/migrations/20260814170000_portal_order_deals.sql`). Checkout terms copy confirms the booking in place of a booking form. Confirmed orders removed from Sales nav.
- Account and deal list UX: readable wrapping, created-date column, Deal ID sort, inline create-deal account/contact, required billing address and contact email.
- Finance and Operations were empty because the workflow query still selected renamed `orders.client_company`. Load path rebuilt; missing `order_operations` rows backfilled (`supabase/migrations/20260814180000_operations_finance_backfill.sql`).
- Finance and Operations now include unlinked offline and other-source deals, not portal checkouts only.
- Operations rebuilt as a full-width table: full event names, event-date sort (soonest first), future vs all events, inline status, guest/supplier modals, deal links. Side overview removed.
- Admin chrome: Marketing disabled, sidebar scrollbar hidden, Admin label removed.

This was the point at which finance/operations became usable on real portal and offline deals. The 19–20 August operations slice finished the first-build fulfilment queue.

### 13 August 2026 — Multi-event deal baskets

- Replaced single-product deal creation with a basket that accepts products from multiple events.
- Added line-level quantity, editable sale price, advertised price, current availability, and owned/brokered stock selection.
- Added supplier, expected buy price, and quote timestamp capture for brokered products.
- Enforced the 24-hour supplier-quote rule before brokered stock can be held or sent on a booking form.
- Kept owned-stock reservations atomic while representing brokered lines as sourcing reservations without reducing owned inventory.
- Hardened signed-order conversion and cancellation so brokered lines create supplier fulfilment work instead of inventory movements.
- Preserved one booking form, order, and Xero invoice for the complete basket, with VAT calculated per event line.
- Updated deal display/editing so multi-event deals are labelled with every included event and are no longer restricted to one event.

### 11 August 2026 — Version 0.4

- Started and largely completed Phase 1B inventory foundation.
- Added additive native inventory schema: suppliers, ledger, reservations, day-capacity pools, sourcing shortages.
- Stopped shell creation in native mode; left existing shells untouched.
- Added opening-balance and reasoned stock-adjustment admin RPCs/actions.
- Dual-write purchase ledger entries and supplier links on stock purchases.
- Added day-capacity and availability unit tests.

### 11 August 2026 — Version 0.3

- Reviewed the complete booking-form PDF and recorded its five-page structure and signing-certificate evidence.
- Confirmed the recommended first pilot set.
- Started Phase 1A with opt-in `ZK_PLATFORM_MODE=native`.
- Disabled Salesforce configuration/API paths in native mode while preserving legacy data and default production behaviour.
- Preserved Xero and Wix processing; native product jobs now perform Wix work without Salesforce.
- Added native-mode admin status and initial automated tests.

### 11 August 2026 — Version 0.2

- Recorded answers to the initial product, stock, CRM, signing, Xero, permissions, and migration questions.
- Defined shared three-day physical stock pools for genuine day and two-day products without hidden shells.
- Added the 24-hour sourced-stock quote rule and seven-day booking-form reservation/expiry.
- Added the current three-page booking-form template baseline and sequential signature rules.
- Added overdue reminders, 28-day cancellation handling, Xero billing/tax rules, and three internal roles.
- Added January 2026 Salesforce-history import and audited manual opening-stock reset.

### 11 August 2026 — Version 0.1

- Created master plan.
- Incorporated the 21-page CMS rebuild concept.
- Recorded current repository architecture and Salesforce coupling.
- Defined target inventory and native offline-sales workflows.
- Added phased backlog, exit criteria, risks, acceptance scenarios, decisions, and safety constraints.

---

## 19. First-build go-live

The product work for the first-build admin is done, including a staff Help tab. What is left is data review, deploy configuration, and a short live smoke test.

The ZK team can start using the admin now. Point them to **Help** in the left menu (`/admin/help`) rather than this master plan.

### Still to do (people / data)

1. **Finish checking imported deals and contacts.** Accounts, contacts, product mapping, suppliers, and prices. This is expected and not a code blocker.
2. **Confirm live stock on a sample of products** against what the team believes is actually left. Catalog is the source of truth; Operations leftover now follows the same sold counts.
3. **Staff access.** Confirm Admin / Finance / Sales users can log in on production with the right permissions. Point them at **Help** in the left menu before they start selling.
4. **One live booking-form round trip** after deploy (send, client sign, ZK countersign, Xero invoice appears).
5. **One live Xero payment webhook check** (or a known paid invoice) so Paid/Confirmed still advances.

### Still to do (database)

Apply these on the **same Supabase project Vercel uses**, if they are not already applied. Matt has been applying them locally; if local and production share that project, they are already done.

- `20260819120000_operations_delivery_and_deal_ops.sql`
- `20260819130000_operations_emails.sql`
- `20260819140000_deal_guests.sql`
- `20260819150000_operations_reassign_stock.sql`
- `20260819160000_operations_reassign_stock_ledger.sql`
- `20260819170000_operations_reassign_linked_stock.sql`

### Still to do (Vercel)

1. Deploy this branch.
2. `ZK_PLATFORM_MODE=native` is no longer required. Native mode is now always on, even if that env var is missing.
3. Confirm `NEXT_PUBLIC_SITE_URL` is the live origin (booking-form and approval links). Example: `https://zk-sports.trade` with no trailing slash.
4. Confirm Xero redirect URI in the Xero app matches production: `{NEXT_PUBLIC_SITE_URL}/api/integrations/xero/callback`.
5. Confirm Wix webhook URL points at production `/api/...` (existing Wix setup).
6. Confirm `CRON_SECRET` is set. `vercel.json` already runs `/api/cron/integration-outbox` every minute; that job still releases holds, expires unsigned booking forms, sends invoice reminders, and syncs Wix. It does **not** pull or push Salesforce.
7. After deploy: Settings → Integrations. Xero and Wix should show. Salesforce must not appear.
8. Optional: delete leftover `SALESFORCE_*` values from Vercel. They are inert, but removing them avoids confusion.

### Vercel environment variables

#### Must be present (keep)

These are required for the live product. Do not delete them.

| Variable | Why |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | App database |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auth and RLS client |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin/server jobs |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin for signing links, emails, auth redirects |
| `CRON_SECRET` | Protects the Vercel cron route |
| `RESEND_API_KEY` | Booking forms, operations emails, invoices, reminders |
| `AUTH_EMAIL_FROM` or `ORDER_EMAIL_FROM` | Resend from-address |
| `XERO_CLIENT_ID` | Invoice create/pay |
| `XERO_CLIENT_SECRET` | Invoice create/pay |
| `XERO_WEBHOOK_KEY` | Paid status back into the CMS |
| `XERO_REDIRECT_URI` | Optional if origin can be inferred; set explicitly on production |
| `WIX_API_KEY` | Website listings and stock |
| `WIX_SITE_ID` | Website listings and stock |
| `WIX_WEBHOOK_SECRET` | Paid website orders |
| `WIX_AGENT_PROFILE_ID` | Consumer website bookings |
| `RETAIL_PRICE_MULTIPLIER` | Website price (usually `1.10`) |
| `FINANCE_NOTIFICATION_EMAILS` / `ORDER_CONFIRMATION_CC` / `BOOKING_FORM_ADMIN_EMAILS` | Existing notification lists |
| `BOOKING_APPROVAL_APPROVE_SECRET` | Paddock approval links |

Xero refresh token and tenant id normally live in `integration_settings`, not env. Leave them there. Do not rotate Xero unless reconnecting.

#### Must add

None required for Salesforce retirement. Native mode is hardcoded.

`ZK_PLATFORM_MODE=native` may still be present from the first-build go-live. It is unused and can stay or be deleted.

#### Salesforce variables are inert (safe to delete when convenient)

Leftover `SALESFORCE_*` values in Vercel can no longer reconnect Salesforce. Deleting them is optional cleanup, not a rollback switch.

Typical names already in use:

- `SALESFORCE_CLIENT_ID`
- `SALESFORCE_CLIENT_SECRET`
- `SALESFORCE_INSTANCE_URL`
- `SALESFORCE_USE_SANDBOX`
- `SALESFORCE_LOGIN_URL`
- `SALESFORCE_DEFAULT_OWNER_ID`
- `SALESFORCE_REFRESH_TOKEN` (optional; usually stored in `integration_settings`)
- `SALESFORCE_API_VERSION` and `SALESFORCE_FIELD_*` / `SALESFORCE_PACKAGE_ITEM_*` / `SALESFORCE_OPPORTUNITY_STAGE*`
- `SALESFORCE_EXPIRE_STALE_OPEN_OPPORTUNITIES`
- `SALESFORCE_ORDER_SKIP_LINE_ITEMS`

`isSalesforceConfigured()` is always false. Cron will not pull Salesforce stock. Outbox will not create Opportunities. Settings does not show Salesforce.

Do **not** drop `salesforce_*` columns or import tables. Historical IDs stay readable.

#### Do not add / do not copy from local

| Variable | Why |
|---|---|
| `ENABLE_LOCAL_INTEGRATION_CRON` | Local-dev only |
| `LOCAL_CRON_INTERVAL_SEC` / `LOCAL_CRON_URL` | Local-dev only |
| `ZK_LINKED_TRACE` | Debug tracing |
| `SUPABASE_DB_URL` / `DATABASE_URL` | Scripts only; not required by the Next app |

### Rollback

1. Salesforce cannot be turned back on with an env flag. Restoring live Salesforce would require reverting this Phase 5 code change.
2. Do **not** use the Cutover tab as the production rollback. Scoped cutover rollback only releases reservations created by a cutover run.

### Out of scope for this go-live

Later Phase 4 modules remain out of scope: sourcing comparisons, marketing campaigns, Slack/Outlook, partner API, and a video knowledge base. Physical deletion of Salesforce TypeScript modules and unused columns is also later work. In-app Help is in scope and shipped with this first build.

---

## 20. Relevant existing references

- `docs/ZK CMS Rebuild Draft (1).pdf`
- `docs/INTEGRATION_MASTER_PLAN.md`
- `docs/TEAM_PORTAL_OVERVIEW.md`
- `/admin/help` — staff getting started and self-help (first-build)
- `lib/admin/help-guide.ts`
- `docs/SF_PIPELINE_STOCK_HOLDS_PLAN.md`
- `docs/PHASE2_SALESFORCE_SETUP.md`
- `docs/PHASE2.5_XERO_SETUP.md`
- `docs/PHASE3_LISTING_SYNC.md`
- `docs/PHASE4_WIX_SETUP.md`
- `supabase/migrations/20250622130000_remove_pandadoc_sales_flow.sql`
- `supabase/migrations/20260701150000_shell_single_ticket_children.sql`
- `supabase/migrations/20260703130000_purchase_orders_and_fulfilment_blocks.sql`
- `supabase/migrations/20260811160000_native_inventory_foundation.sql`
- `supabase/migrations/20260819120000_operations_delivery_and_deal_ops.sql`
- `supabase/migrations/20260819170000_operations_reassign_linked_stock.sql`
- `supabase/migrations/20260826120000_cost_layer_quantity_keeps_remaining_in_sync.sql`
- `supabase/migrations/20260826130000_signed_deals_hold_purchased_stock.sql`
- `supabase/migrations/20260826140000_single_supplier_repack_allocations.sql`
- `supabase/migrations/20260826150000_repack_deals_not_lines.sql`
- `supabase/migrations/20260826160000_incremental_signed_deal_line_allocation.sql`
- `lib/operations/stock.ts`
- `lib/inventory/day-capacity.ts`
- `lib/inventory/native-availability.ts`
- `lib/inventory/ledger.ts`
- `lib/inventory/suppliers.ts`
- `lib/inventory/linked-group-inventory.ts`
- `lib/integrations/run-integration-cron.ts`
- `lib/integrations/process-outbox.ts`
- `lib/integrations/xero/`
- `lib/integrations/wix/`
- `lib/integrations/salesforce/`

