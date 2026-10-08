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
2. **Tickets in** — Issue ZK passes, or receive physical/external stock. Skip supplier inbound for `zk_digital`.
3. **Assign** — one open ticket per guest. Physical serials are unique. Unassigned paper sits in the booking pool.
4. **Send** — email guests, email the booking contact a pack, or copy links. A successful digital email **marks delivered** (no proof photo). Copy-link needs “I’ve sent these”.
5. **Door / collect** — `/admin/check-in`. Camera or name search. Success shows headshot, name, day, table, dietary.
6. **After event** — existing thank-you for direct clients.

**Who gets the email**

- Direct client: each guest with an email; leftover guests go in a pack to the ops contact.
- Agent / corporate: pack to the ops contact, unless staff ticks “Email guests directly”.
- Trade portal: sent / not sent / arrived only — no raw QR.

**Digital send From address (testing):** `Jenny Kent <contact@zk-sport.trade>` via the connected Resend domain. Switch to `jenny@zk-sports.com` (or sales) when that domain is verified. Env override: `TICKET_EMAIL_FROM`.

## Status machine

`draft → issued → sent → delivered → arrived` plus `void`.

Physical location (separate field): `in_office` → `packed` → `in_transit` / `awaiting_collection` → `with_guest`.

Reissue always **voids the old QR first**. Old links show VOID; old QRs fail at the door.

## Reliability rules

- Server row is the source of truth. QR is a signed pointer (`ZK1.{ticketId}.{hmac}`).
- Admit is an atomic update (`issued|sent|delivered` → `arrived`). Two phones cannot both get green.
- Wrong day, wrong event, void, cancelled → reject with an explicit reason.
- Manual name search logs `method = manual`.
- Undo arrival (10 minutes, with reason) requires `operations.manage`.
- Cannot mint more open tickets than paid quantity, or a second open ticket for the same guest.
- Lost phone: name + headshot. Do not invent a second live QR without voiding.

## Phases

- [x] **A — Foundation** — schema, modes, signed issue/void/reissue/scan engine, tests
- [x] **B — Guest ticket + send** — `/t/{token}`, PDF, guest email field, ops send, auto delivered
- [x] **C — Door** — `/admin/check-in` camera, name search, headshot, undo
- [x] **D — Physical** — receive, assign serial, collect, post, packing list
- [ ] **E — Wallet** — Apple Pass Type ID + Google Wallet issuer (staff setup). UI is stubbed until certificates exist
- [x] **F — Hardening** — offline scan queue on the phone, Help topic, generic guest-guide ZK copy. Official Singapore 2026 guest guide still says TicketBud on purpose

## Staff setup still needed

- [x] Resend from `contact@zk-sport.trade` for ticket emails (testing)
- [ ] Apply migration `20261008120000_internal_ticketing.sql` on the live database (`package_id` / `race_id` are **text**, matching catalog IDs)
- [ ] Set `TICKET_SIGNING_SECRET` in Vercel (any long random string; keep it forever — changing it makes old QRs fail)
- [ ] Apple / Google Wallet certificates — **not needed yet**. Guest page works without them. Do this later if you want “Add to Wallet”.
- [ ] Switch ticket From address to Jenny’s zk-sports.com mailbox when that domain is on Resend
- [ ] After Singapore 2026, replace TicketBud wording in the official Velocity Terrace guest guide

## Code map

- Engine (no I/O): `lib/tickets/`
- Ops actions: `app/(admin)/admin/operations/ticket-actions.ts`
- Check-in: `app/(admin)/admin/check-in/`
- Guest pass: `app/t/[token]/`
- Migration: `supabase/migrations/20261008120000_internal_ticketing.sql`

## Changelog

- **2026-10-08** — First version of this doc. Built Phases A–D plus Help, offline scan queue, and ZK guest-guide defaults. Ticket mail uses `contact@zk-sport.trade` until the company domain is connected. Wallet buttons are on the guest pass and stay disabled until Apple/Google issuer env is set. Cancelling a booking voids live tickets.
- **2026-10-08** — Migration FK fix: `tickets.package_id` and `tickets.race_id` are text (catalog IDs are not UUIDs).

