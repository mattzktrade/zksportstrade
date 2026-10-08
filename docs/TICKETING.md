# Internal ticketing

Living tracker for ZK’s in-house tickets. Update this file whenever the feature changes.

**Status:** built in CMS (Phases A–D live in code; Wallet waits on Apple/Google issuer accounts).  
**Pilot:** next ZK-hosted hospitality after Singapore GP 2026 (Abu Dhabi Velocity Terrace or later). Do not cut over Singapore 2026 — that weekend still uses TicketBud.

## Goal

One ticket record per named guest. Staff issue, assign, send, collect, and scan in Operations. Guests open a branded ZK pass on their phone. Door staff scan a QR (or search a name) and the CRM marks arrived. Physical tickets use the same records.

This is fulfilment of CRM bookings. It is not a public box office.

## Out of scope

- Selling tickets to the public
- Replacing official F1 / circuit / Paddock Club gate scanners
- QR packs or guest guides on the agent portal
- Native iOS/Android scanner apps (use `/admin/check-in` in the phone browser)
- Rotating QR in v1 (headshot on the scanner is the anti-fraud)
- NFC Wallet passes

## Ticketing modes (per product, overridable on the booking)

| Mode | What we issue | Who scans |
| --- | --- | --- |
| `zk_digital` | ZK QR pass | ZK / Velocity host team at our door |
| `physical` | Paper serial assigned to a guest | Collection desk, or not scanned |
| `external_digital` | Supplier PDF/link stored and forwarded | Circuit / supplier — not us |
| `supplier_direct` | Nothing | Supplier delivers |
| `hybrid` | Official/external admission **plus** a ZK hospitality QR | Our door for the ZK pass only |

Default on a new product is `supplier_direct` so we never mint ZK QRs for Paddock Club by accident.

## Operations process

1. **Guests** — names, headshots, email (email needed to send a digital pass to that person).
2. **Tickets in** — Issue ZK passes, or receive physical/external stock. Skip / autofill supplier inbound for `zk_digital`.
3. **Send** — email guests, email the booking contact a pack, or copy links. A successful digital email **marks delivered** (no proof photo). Copy-link needs “I’ve sent these”.
4. **Allocate seats** — table / paddock / seat notes after tickets exist.
5. **Door / collect** — `/admin/check-in`. Camera or name search. Success shows headshot, name, day, table, dietary.
6. **After event** — existing thank-you for direct clients.

**Who gets the email**

- Direct client: each guest with an email; leftover guests go in a pack to the ops contact.
- Agent / corporate: pack to the ops contact, unless staff ticks “Email guests directly”.
- Trade portal: sent / not sent / arrived only — no raw QR.

**Digital send From address:** `Jenny Kent` on the connected Resend mailbox (`ORDER_EMAIL_FROM` / `AUTH_EMAIL_FROM`, currently `confirmation@zk-sports.trade`). Override with `TICKET_EMAIL_FROM` only if that domain is also verified. Switch the display mailbox to Jenny’s zk-sports.com address when that domain is on Resend.

## Status machine

`draft → issued → sent → delivered → arrived` plus `void`.

Physical location (separate field): `in_office` → `packed` → `in_transit` / `awaiting_collection` → `with_guest`.

Reissue always **voids the old QR first**. Old links show VOID; old QRs fail at the door.

## Reliability rules

- Server row is the source of truth. QR is a signed pointer (`ZK1.{ticketId}.{hmac}`).
- Admit is an atomic insert of `(ticket, door date)`. Two phones cannot both get green on the same day. A 3-day pass scans again on the next valid day.
- Wrong day, wrong event, void, cancelled → reject with an explicit reason.
- Manual name search logs `method = manual`.
- Undo arrival (10 minutes, with reason) requires `operations.manage`.
- Cannot mint more open tickets than paid quantity, or a second open ticket for the same guest. Walk-up / emergency passes on the product Guest list are the exception (capped at 40 live per product, not counted against a booking).
- Lost phone: name + headshot. Do not invent a second live QR without voiding.

## Phases

- [x] **A — Foundation** — schema, modes, signed issue/void/reissue/scan engine, tests
- [x] **B — Guest ticket + send** — `/t/{token}`, PDF, guest email field, ops send, auto delivered
- [x] **C — Door** — `/admin/check-in` camera, name search, headshot, undo
- [x] **D — Physical** — receive, assign serial, collect, post, packing list
- [ ] **E — Wallet** — Apple Pass Type ID + Google Wallet issuer (staff setup). UI is stubbed until certificates exist
- [x] **F — Hardening** — offline scan queue on the phone, Help topic, generic guest-guide ZK copy. Official Singapore 2026 guest guide still says TicketBud on purpose

## Staff setup still needed

- [x] Resend ticket mail from Jenny on the verified `zk-sports.trade` mailbox
- [ ] Apply migrations `20261008120000_internal_ticketing.sql` and `20261008163000_ticket_admissions_walk_up.sql` on the live database (`package_id` / `race_id` are **text**; walk-up tickets and next-day scans need the second file)
- [ ] Set `TICKET_SIGNING_SECRET` in Vercel (any long random string; keep it forever — changing it makes old QRs fail)
- [ ] Apple / Google Wallet certificates — **not needed yet**. Guest page works without them. Do this later if you want “Add to Wallet”.
- [ ] Switch ticket From address to Jenny’s zk-sports.com mailbox when that domain is on Resend
- [ ] After Singapore 2026, replace TicketBud wording in the official Velocity Terrace guest guide

## Code map

- Engine (no I/O): `lib/tickets/`
- Ops actions: `app/(admin)/admin/operations/ticket-actions.ts`
- Check-in: `app/(admin)/admin/check-in/`
- Guest pass: `app/t/[token]/` (PDF in `lib/tickets/pdf.ts`)
- Walk-up / emergency tickets: product Guest list (`components/admin/package-walk-up-tickets.tsx`)
- Follow-up migration: `supabase/migrations/20261008163000_ticket_admissions_walk_up.sql`
- Staff headshots: `app/(admin)/admin/operations/guest-editor.tsx`
- Migration: `supabase/migrations/20261008120000_internal_ticketing.sql`

## Changelog

- **2026-10-08** — First version of this doc. Built Phases A–D plus Help, offline scan queue, and ZK guest-guide defaults. Ticket mail uses `contact@zk-sport.trade` until the company domain is connected. Wallet buttons are on the guest pass and stay disabled until Apple/Google issuer env is set. Cancelling a booking voids live tickets.
- **2026-10-08** — Migration FK fix: `tickets.package_id` and `tickets.race_id` are text (catalog IDs are not UUIDs).
- **2026-10-08** — Ticket email uses the verified `zk-sports.trade` from-address (not `zk-sport.trade`). Operations board is mobile-safe, skips supplier inbound for ZK digital, and allocates seats after tickets.
- **2026-10-08** — Manage guests can add, replace, and preview headshots on phone and desktop (deal, operations board, product guest list). Guest pass page and PDF use the brochure black / white / ZK red look, with the last name word in red and the headshot on the pass.
- **2026-10-08** — Guest ticket and PDF match the dark pass mock: GUEST TICKET, package and event as labelled text (no icons), attending-day chips, white QR, Save PDF / photos backup, and wallet buttons fully on the page. Circuit/venue subtitles such as a product “Test” line are not shown.
- **2026-10-08** — Product Guest list can mint a walk-up / emergency ZK pass with no guest row. Check-in pads for phones, filters the name list by door day, and a multi-day QR admits again the next morning (same-day rescan still blocked).

