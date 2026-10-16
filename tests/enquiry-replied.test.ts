import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { enquiryHasClientReply, markEnquiryClientReplied } from "../lib/crm/enquiry-replied"

test("replied badge is only on after the first client reply", () => {
  assert.equal(enquiryHasClientReply({ enquiry_replied_at: null }), false)
  assert.equal(enquiryHasClientReply({}), false)
  assert.equal(enquiryHasClientReply({ enquiry_replied_at: "2026-10-15T14:00:00.000Z" }), true)
})

test("first reply stamp does not overwrite or move the enquiry stage", async () => {
  const calls: Array<{ values: Record<string, unknown>; eq: unknown[]; is: unknown[] }> = []
  const admin = {
    from(table: string) {
      assert.equal(table, "deals")
      return {
        update(values: Record<string, unknown>) {
          const call = { values, eq: [] as unknown[], is: [] as unknown[] }
          calls.push(call)
          return {
            eq(column: string, value: string) {
              call.eq.push([column, value])
              return {
                is(columnName: string, value: null) {
                  call.is.push([columnName, value])
                  return { error: null }
                },
              }
            },
          }
        },
      }
    },
  }
  await markEnquiryClientReplied(
    admin as never,
    "  deal-1  ",
    new Date("2026-10-15T14:00:00.000Z"),
  )
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].values, { enquiry_replied_at: "2026-10-15T14:00:00.000Z" })
  assert.deepEqual(calls[0].eq, [["id", "deal-1"]])
  assert.deepEqual(calls[0].is, [["enquiry_replied_at", null]])
})

test("inbound reply paths stamp replied without changing later-stage rules", () => {
  const files = [
    "lib/assistant/ingest.ts",
    "app/api/webhooks/whatsapp/route.ts",
    "lib/assistant/email-inbound.ts",
  ]
  for (const file of files) {
    const src = readFileSync(file, "utf8")
    assert.match(src, /markEnquiryClientReplied/)
    assert.match(src, /\.in\("enquiry_stage", \["new", "contacted"\]\)/)
  }
})

test("replied column stays independent of enquiry stage", () => {
  const sql = readFileSync("supabase/migrations/20261015150000_enquiry_replied_at.sql", "utf8")
  assert.match(sql, /enquiry_replied_at timestamptz/)
  assert.match(sql, /enquiry_stage = 'responded'/)
  assert.doesNotMatch(sql, /enquiry_stage = 'price_sent'/)
})
