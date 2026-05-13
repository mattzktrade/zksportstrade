# Handoff: Phase B — Admin portal & inventory management

Use this document when continuing in a **new agent / chat** so context carries over without re-reading the whole thread.

---

## What Phase A already delivered (do not redo)

- **Supabase**: Auth + Postgres. Tables: `profiles`, `races`, `packages`, `package_inventory` (see `supabase/migrations/20250512120000_phase_a.sql`).
- **RLS**: Approved agents (or `role = 'admin'`) can read catalog. Users read/update own `profiles` with trigger preventing self-promotion on `role` / `approval_status`. `public.is_admin()` exists for policies.
- **App routes**: Portal lives under `app/(portal)/` with `layout.tsx` → `PortalUserProvider` + `PortalLayout`. Auth: `app/(auth)/login`, `signup`, `pending-approval`; callback `app/auth/callback/route.ts`.
- **Middleware**: `middleware.ts` + `lib/supabase/middleware.ts` — session refresh, login redirect, pending users → `/pending-approval`, approved users blocked from auth-only pages as appropriate.
- **Catalog**: Loaded from Supabase via `lib/catalog/queries.ts` + `lib/catalog/map-rows.ts`. Seed: `npm run seed:catalog` (loads `.env.local` via `dotenv` in `scripts/seed-catalog.ts`).
- **UX decisions already in code**: Trade prices only (no commission in UI). Checkout is **invoice-only** (no card); booking submit is still **simulated** (no `orders` table yet — Phase C).
- **Bookings / invoices pages**: Empty arrays in client state until real tables exist.
- **Admin bootstrap**: First admin is still manual SQL, e.g.  
  `update public.profiles set role = 'admin', approval_status = 'approved' where email = 'you@...';`

Env: `.env.example` / `.env.local` — `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

---

## Phase B — Product goals (from stakeholder)

1. **Admin area** for internal ZK staff (only users with `profiles.role = 'admin'`).
2. **User approvals**: List pending signups; approve or reject; optional note; reflect `approval_status` on `profiles`.
3. **Inventory**:
   - **Hold stock for a client** (reserve units against `package_inventory` — today schema has `qty_available` / `qty_held`; define whether “hold” = increase `qty_held` with a linked record for *which* agent/client, or a new `inventory_holds` table with `package_id`, `user_id`/`agent_id`, `qty`, `reason`, `expires_at`).
   - **Add stock** (new capacity or new package rows — clarify if “new stock” means new `packages` + inventory or only bump `qty_available`).
   - **Adjust levels and prices** (update `package_inventory` and/or `packages.trade_price`).
4. **Agent overview** (admin dashboard): list agents, signals for **due to pay / late / volume** — *depends on data*: today there are **no** `bookings` / `invoices` / payment tables in DB. Options for Phase B:
   - **MVP**: Directory of approved agents + profile fields + link to future “agent detail”; placeholders or manual flags until Phase C syncs Xero.
   - **Stretch**: Introduce minimal `bookings` + `invoices` (or sync fields) so admin charts are real.

Align with stakeholder before building “late payment” UI without a source of truth.

---

## Suggested implementation order (Phase B)

1. **Route guard**: `app/(admin)/layout.tsx` — server check `profile.role === 'admin'`, else `redirect('/')` or 404.
2. **Admin shell**: Sidebar/nav: Dashboard, Pending users, Catalog (races/packages), Inventory & holds, Agents (overview).
3. **RLS / policies**: Allow `select`/`update` on `profiles` (and any new tables) for admins; `insert`/`update`/`delete` on `packages`, `package_inventory`, `races` for admins only (or use **service role** only from Server Actions — prefer RLS + admin role for fewer foot-guns).
4. **Pending approvals UI**: Table from `profiles where approval_status = 'pending'`; actions call Server Actions: `update profiles set approval_status = 'approved'|'rejected'`.
5. **Catalog CRUD**: Forms or inline edit for `trade_price`, `is_enquiry`, flags; inventory `qty_available` / `qty_held` with validation (`qty_held <= qty_available`).
6. **Holds**: Design the hold model (see above), then UI: pick package, agent (`profiles.id` where `role = 'agent'`), quantity, optional reference.
7. **Agent overview**: Start with **list + search**; add metrics when booking/invoice data exists (Phase C).

---

## Key files to read first

| Area | Path |
|------|------|
| Portal + auth layout | `app/(portal)/layout.tsx`, `app/(auth)//*` |
| Supabase server client | `lib/supabase/server.ts`, `client.ts` |
| Profile type | `lib/types/profile.ts`, `lib/supabase/profile.ts` |
| Catalog types/mappers | `lib/catalog/map-rows.ts`, `lib/catalog/queries.ts` |
| Middleware | `middleware.ts`, `lib/supabase/middleware.ts` |
| Migration (extend for B) | `supabase/migrations/` — add new migration file; do not edit applied migration in prod blindly |
| Seed | `scripts/seed-catalog.ts` |

---

## Schema extensions likely needed for Phase B

- **`inventory_holds`** (recommended if holds must be auditable per client): `id`, `package_id`, `profile_id` (agent), `quantity`, `note`, `created_at`, `released_at` nullable; on create: validate stock, increment `qty_held` or decrement `qty_available` per your invariant doc in migration.
- Or reuse only `qty_held` on `package_inventory` if holds are global (simpler, less traceable).

Optional for agent metrics later: `bookings`, `invoice_snapshots` — coordinate with **Phase C** (real checkout + Xero) to avoid duplicate models.

---

## Security reminders

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser; admin mutations from **Server Actions** or **Route Handlers** with session + `is_admin` check, or RLS-only updates.
- Audit log table (`admin_audit_log`) is a nice Phase B add for approvals and price changes.

---

## Commands

```bash
npm run dev          # local app
npm run seed:catalog # refresh catalog from lib/data (after .env.local)
npm run build        # verify production build
```

---

## After Phase B — Phase C (do not implement in B unless scoped)

- Persist orders on checkout; webhooks/jobs for email + Salesforce + Xero.
- Replace mock booking flow with DB-backed bookings and portal invoices.

---

*Generated for context handoff. Update this file as Phase B lands if useful for Phase C.*
