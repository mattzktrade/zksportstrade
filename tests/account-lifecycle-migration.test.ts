import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const sql = readFileSync(
  new URL("../supabase/migrations/20260827150000_account_lifecycle_lead_queue.sql", import.meta.url),
  "utf8",
).toLowerCase()

const ui = readFileSync(new URL("../app/(admin)/admin/leads/leads-client.tsx", import.meta.url), "utf8")

test("adds lifecycle and lead_stage with constraints and a later backfill", () => {
  assert.match(sql, /add column if not exists lifecycle/)
  assert.match(sql, /add column if not exists lead_stage/)
  assert.match(sql, /crm_accounts_lifecycle_check/)
  assert.match(sql, /check \(lifecycle in \('lead', 'client'\)\)/)
  assert.match(sql, /crm_accounts_lead_stage_check/)
  assert.match(sql, /'new', 'reach_out', 'talking', 'later', 'not_a_fit'/)
  assert.match(sql, /set lead_stage = 'later'/)
  assert.match(sql, /where lead_stage = 'new'/)
})

test("treats signed deals and non-cancelled orders as booked clients", () => {
  assert.match(sql, /set lifecycle = 'client'/)
  assert.match(sql, /'signed'/)
  assert.match(sql, /'awaiting_payment'/)
  assert.match(sql, /'paid_confirmed'/)
  assert.match(sql, /ord.status is distinct from 'cancelled'/)
  assert.match(sql, /ord.crm_account_id = account.id/)
  assert.match(sql, /ord.agent_profile_id = account.portal_profile_id/)
})

test("auto-promotes lead to client from deals and orders, never the reverse", () => {
  assert.match(sql, /crm_promote_account_to_client/)
  assert.match(sql, /and lifecycle = 'lead'/)
  assert.match(sql, /deals_promote_account_to_client_trg/)
  assert.match(sql, /orders_promote_account_to_client_trg/)
  assert.doesNotMatch(sql, /set lifecycle = 'lead'/)
})

test("leads tab highlights new rows; accounts and contacts do not use unassigned amber", () => {
  assert.match(ui, /view === "leads"/)
  assert.match(ui, /isNew && "bg-amber-50\/70"/)
  assert.equal((ui.match(/unassigned && "bg-amber-50\/70"/g) ?? []).length, 0)
  assert.equal((ui.match(/!client\.owner_profile_id && "bg-amber-50\/70"/g) ?? []).length, 0)
})
