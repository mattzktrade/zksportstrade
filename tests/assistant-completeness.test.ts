import assert from "node:assert/strict"
import test from "node:test"
import {
  assessCatalogRow,
  catalogReadinessIssues,
  contactMissingPhone,
  summarizeReadiness,
} from "../lib/assistant/completeness"

test("catalog readiness requires copy, photos, faqs, and a brochure", () => {
  const missing = assessCatalogRow({
    id: "p1",
    name: "Champions Club",
    raceName: "Abu Dhabi 2026",
    description: "Short",
    includes: ["Food"],
    faqs: [{ id: "1", question: "What is it?", answer: "" }],
    image: "https://example.com/a.jpg",
    galleryImages: ["https://example.com/a.jpg"],
    brochureUrl: null,
  })
  assert.ok(missing.missing.includes("short description"))
  assert.ok(missing.missing.some((item) => item.includes("inclusions")))
  assert.ok(missing.missing.some((item) => item.includes("photos")))
  assert.ok(missing.missing.some((item) => item.includes("FAQs")))
  assert.ok(missing.missing.includes("brochure PDF"))
})

test("complete catalog rows are not listed", () => {
  const faqs = [1, 2, 3, 4].map((n) => ({
    id: `q${n}`,
    question: `Question ${n}?`,
    answer: "A full answer that staff wrote.",
  }))
  const issues = catalogReadinessIssues([
    {
      id: "p1",
      name: "Champions Club",
      raceName: "Abu Dhabi 2026",
      description: "Covered venue between Turns 5 and 6 with food, drink, and circuit views for guests all weekend.",
      includes: ["Dinner", "Open bar", "Pit lane walk", "Parking"],
      faqs,
      image: "https://example.com/a.jpg",
      galleryImages: ["https://example.com/b.jpg", "https://example.com/c.jpg"],
      brochureUrl: "https://example.com/brochure.pdf",
    },
  ])
  assert.equal(issues.length, 0)
})

test("contacts without a usable phone are flagged", () => {
  assert.equal(
    contactMissingPhone({
      id: "c1",
      accountId: "a1",
      accountName: "Apex",
      fullName: "Ada",
      email: "ada@example.com",
      phone: null,
    })?.href,
    "/admin/clients/a1/contacts/c1",
  )
  assert.equal(
    contactMissingPhone({
      id: "c1",
      accountId: "a1",
      accountName: "Apex",
      fullName: "Ada",
      email: "ada@example.com",
      phone: "+44 7426 610346",
    }),
    null,
  )
})

test("readiness summary is not ready until the checklist is empty", () => {
  const blocked = summarizeReadiness({
    catalogIssues: [
      { id: "p1", name: "Paddock", raceName: "Monaco", missing: ["brochure PDF"], href: "/admin/catalog/p1" },
    ],
    catalogChecked: 1,
    contactsMissingPhone: 2,
    contactsChecked: 10,
    policyArticle: false,
  })
  assert.equal(blocked.ready, false)
  assert.equal(blocked.details.length, 3)

  const ready = summarizeReadiness({
    catalogIssues: [],
    catalogChecked: 4,
    contactsMissingPhone: 0,
    contactsChecked: 10,
    policyArticle: true,
  })
  assert.equal(ready.ready, true)
})
