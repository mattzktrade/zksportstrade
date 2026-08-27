import assert from "node:assert/strict"
import test from "node:test"
import {
  accountRecordHit,
  contactRecordHit,
  mergeAdminJumpResults,
  orderRecordHit,
} from "../lib/admin/admin-record-search"
import { sanitizeSearchQuery, searchMatchScore } from "../lib/admin/ranked-search"
import { searchCrmPartiesLocal } from "../lib/crm/party-search"

test("prefix matches beat a substring in the middle of another word", () => {
  assert.equal(searchMatchScore("Engage", "eng") > searchMatchScore("Cheng", "eng"), true)
  assert.equal(searchMatchScore("Engage", "eng") > searchMatchScore("Challenge", "eng"), true)
  assert.equal(searchMatchScore("Jane Smith", "eng"), 0)
})

test("sanitizeSearchQuery strips LIKE wildcards", () => {
  assert.equal(sanitizeSearchQuery("  eng_%foo  "), "eng foo")
})

test("deal party search puts the company above people whose names merely contain the letters", () => {
  const hits = searchCrmPartiesLocal(
    [
      {
        id: "cheng",
        name: "Cheng Wei",
        contacts: [{ id: "c1", full_name: "Cheng Wei", email: "cheng@engage.com", phone: null }],
      },
      {
        id: "engage",
        name: "Engage",
        contacts: [
          { id: "e1", full_name: "Sam Taylor", email: "sam@engage.com", phone: null },
          { id: "e2", full_name: "Priya Engel", email: "priya@engage.com", phone: null },
        ],
      },
      {
        id: "solo",
        name: "Priya Engel",
        contacts: [{ id: "s1", full_name: "Priya Engel", email: "priya@example.com", phone: null }],
      },
    ],
    "eng",
  )

  assert.equal(hits[0]?.kind, "account")
  assert.equal(hits[0]?.account.name, "Engage")
  assert.ok(hits.some((hit) => hit.kind === "contact" && hit.label === "Priya Engel"))
  assert.ok(hits.some((hit) => hit.kind === "account" && hit.account.name === "Cheng Wei"))
  assert.ok(hits.length > 2)
})

test("deal party search is not capped at eight results", () => {
  const accounts = Array.from({ length: 30 }, (_, index) => ({
    id: `row-${index}`,
    name: index === 12 ? "Engage" : `Cheng ${index}`,
    contacts: [] as Array<{ id: string; full_name: string; email: string | null; phone: string | null }>,
  }))
  const hits = searchCrmPartiesLocal(accounts, "eng")
  assert.ok(hits.length > 8)
  assert.equal(hits[0]?.label, "Engage")
})

test("searching a contact name still returns their company account when the letters match the company", () => {
  const hits = searchCrmPartiesLocal(
    [
      {
        id: "engage",
        name: "Engage",
        contacts: [{ id: "e1", full_name: "Sam Taylor", email: "sam@example.com", phone: null }],
      },
    ],
    "engage",
  )
  assert.deepEqual(
    hits.map((hit) => hit.kind),
    ["account"],
  )
  assert.equal(hits[0]?.label, "Engage")
})

test("header jump search ranks the matching company above pages and buried names", () => {
  const hits = mergeAdminJumpResults(
    [
      { label: "Deals", href: "/admin/deals", keywords: "pipeline crm" },
      { label: "Accounts", href: "/admin/leads", keywords: "clients companies" },
    ],
    [
      accountRecordHit({ id: "cheng", name: "Cheng Wei" }),
      accountRecordHit({ id: "engage", name: "Engage" }),
      contactRecordHit({
        id: "priya",
        accountId: "engage",
        fullName: "Priya Engel",
        accountName: "Engage",
        email: "priya@engage.com",
      }),
      orderRecordHit({ id: "ord", reference: "ZK-2026-ENG-1", clientName: "Engage" }),
    ],
    "eng",
  )
  assert.equal(hits[0]?.label, "Engage")
  assert.equal(hits[0]?.kind, "account")
  assert.equal(hits[0]?.href, "/admin/clients/engage")
  assert.ok(hits.some((hit) => hit.kind === "contact" && hit.label === "Priya Engel"))
  assert.ok(hits.some((hit) => hit.kind === "order" && hit.href.includes("/admin/orders?q=")))
})
