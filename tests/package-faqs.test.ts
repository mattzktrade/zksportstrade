import assert from "node:assert/strict"
import test from "node:test"
import {
  answeredPackageFaqs,
  fillEmptyFaqAnswers,
  mergePackageFaqs,
  parsePackageFaqs,
  suggestedPackageFaqs,
  type PackageFaqSource,
} from "../lib/catalog/package-faqs"

const champions: PackageFaqSource = {
  name: "Champions Club Trackside Terrace",
  raceName: "Abu Dhabi Grand Prix 2026",
  circuit: "Yas Marina Circuit",
  location: "Yas Island",
  country: "United Arab Emirates",
  eventDate: "2026-12-06",
  dateRange: "4–6 December 2026",
  duration: "3_day",
  description:
    "Covered venue between Turns 5 and 6 at the Trackside Terrace, with views as the cars exit the hairpin.",
  includes: [
    "Delectable dinner and delicious canapes",
    "Open bar serving beer, wine and soft drinks",
    "Appearances from key F1 personnel",
  ],
  currency: "USD",
  tradePrice: 2500,
  isEnquiry: false,
  brochureUrl: "https://example.com/brochure.pdf",
}

test("suggested faqs answer from the product and leave unknown questions blank", () => {
  const faqs = suggestedPackageFaqs(champions)
  const byId = new Map(faqs.map((faq) => [faq.id, faq.answer]))

  assert.match(byId.get("what-is-it") ?? "", /Turns 5 and 6/)
  assert.match(byId.get("included") ?? "", /Open bar/)
  assert.match(byId.get("days") ?? "", /3 day package/)
  assert.match(byId.get("days") ?? "", /4–6 December 2026/)
  assert.match(byId.get("where-watch") ?? "", /Trackside Terrace/)
  assert.match(byId.get("food") ?? "", /canapes/)
  assert.match(byId.get("where-race") ?? "", /Yas Marina Circuit/)
  assert.match(byId.get("when") ?? "", /December 2026/)
  assert.match(byId.get("brochure") ?? "", /brochure/)
  assert.match(byId.get("booking") ?? "", /USD 2,500/)
  assert.match(byId.get("weekend") ?? "", /qualifying/)
  assert.match(byId.get("programme") ?? "", /Champions Club/)
  assert.equal(byId.get("travel"), "")
  assert.equal(byId.get("dress"), "")
  assert.equal(byId.get("children"), "")
  assert.equal(byId.get("tickets"), "")
  assert.equal(answeredPackageFaqs(faqs).some((faq) => faq.id === "dress"), false)
})

test("saved staff answers are kept and empty ones can be filled later", () => {
  const suggested = suggestedPackageFaqs(champions)
  const saved = mergePackageFaqs(
    [{ id: "dress", question: "What should my client wear?", answer: "Smart casual." }],
    suggested,
  )
  assert.equal(saved.find((faq) => faq.id === "dress")?.answer, "Smart casual.")

  const cleared = saved.map((faq) => (faq.id === "food" ? { ...faq, answer: "" } : faq))
  const filled = fillEmptyFaqAnswers(cleared, champions)
  assert.equal(filled.find((faq) => faq.id === "dress")?.answer, "Smart casual.")
  assert.match(filled.find((faq) => faq.id === "food")?.answer ?? "", /canapes/)
})

test("custom questions survive a merge and blank rows are ignored", () => {
  const merged = mergePackageFaqs(
    parsePackageFaqs([
      { id: "custom-1", question: "Is there a dress code for the podium?", answer: "Ask the venue." },
      { id: "custom-2", question: "   ", answer: "nope" },
    ]),
    suggestedPackageFaqs(champions),
  )
  assert.equal(merged.find((faq) => faq.id === "custom-1")?.answer, "Ask the venue.")
  assert.equal(merged.some((faq) => faq.id === "custom-2"), false)
})
