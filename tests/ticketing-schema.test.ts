import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { describe, it } from "node:test"
import { withoutTicketingColumns } from "../lib/catalog/columns"

const sql = readFileSync("supabase/migrations/20261008120000_internal_ticketing.sql", "utf8")

describe("internal ticketing schema", () => {
  it("creates tickets, assets, events, scan attempts, and a private file bucket", () => {
    assert.match(sql, /create table if not exists public\.tickets/)
    assert.match(sql, /create table if not exists public\.ticket_assets/)
    assert.match(sql, /create table if not exists public\.ticket_events/)
    assert.match(sql, /create table if not exists public\.ticket_scan_attempts/)
    assert.match(sql, /'ticket-files'/)
    assert.match(sql, /insert into storage\.buckets/)
    assert.match(sql, /package_id text references public\.packages/)
    assert.match(sql, /race_id text references public\.races/)
    assert.doesNotMatch(sql, /package_id uuid/)
  })

  it("enforces one live ticket per guest and unique live serials", () => {
    assert.match(sql, /tickets_open_order_guest_uidx/)
    assert.match(sql, /tickets_open_deal_guest_uidx/)
    assert.match(sql, /tickets_open_serial_uidx/)
    assert.match(sql, /status <> 'void'/)
  })

  it("admits with an atomic RPC that only updates issued, sent, or delivered rows", () => {
    assert.match(sql, /create or replace function public\.admit_ticket/)
    assert.match(sql, /status in \('issued', 'sent', 'delivered'\)/)
    assert.match(sql, /and arrived_at is null/)
    assert.match(sql, /grant execute on function public\.admit_ticket/)
  })

  it("follow-up migration admits per door day and allows walk-up tickets", () => {
    const next = readFileSync("supabase/migrations/20261008163000_ticket_admissions_walk_up.sql", "utf8")
    assert.match(next, /ticket_admissions/)
    assert.match(next, /walk_up/)
    assert.match(next, /holder_name/)
    assert.match(next, /p_door_date/)
    assert.match(next, /status not in \('issued', 'sent', 'delivered', 'arrived'\)/)
    assert.match(next, /walk_up = true and package_id is not null/)
  })

  it("adds tickets_ready to operations email kinds", () => {
    assert.match(sql, /'tickets_ready'/)
  })

  it("strips ticketing columns when the migration is not applied yet", () => {
    const cols = "id, name, ticketing_mode, ticketing_venue_name, ticketing_doors_time, ticketing_require_headshot"
    const stripped = withoutTicketingColumns(cols)
    assert.match(stripped, /id, name/)
    assert.doesNotMatch(stripped, /ticketing_/)
  })
})
