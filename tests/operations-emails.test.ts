import assert from "node:assert/strict"
import test from "node:test"
import {
  buildOperationsEmailDraft,
  operationsEmailHtml,
  operationsEmailKindLabel,
} from "../lib/operations/emails"

const base = {
  contactName: "Sarah Bennett",
  accountName: "Apex Hospitality",
  eventLabel: "2026 Singapore Grand Prix",
  quantity: 4,
}

test("guest details request uses first name, guest count, and a reply-with-details body", () => {
  const draft = buildOperationsEmailDraft({ ...base, kind: "guest_details" })
  assert.equal(draft.subject, "Guest details needed — 2026 Singapore Grand Prix")
  assert.match(draft.body, /^Hi Sarah,/)
  assert.match(draft.body, /I'm Jenny from ZK Sports & Entertainment/)
  assert.match(draft.body, /4 guests/)
  assert.match(draft.body, /Full name, as it appears on their passport/)
  assert.match(draft.body, /Date of birth/)
  assert.match(draft.body, /Nationality/)
  assert.match(draft.body, /Please reply to this email/)
  assert.match(draft.body, /Jenny Kent/)
  assert.doesNotMatch(draft.body, /Matt Johnson/)
  assert.doesNotMatch(draft.body, /Operations\s*$/m)
  assert.doesNotMatch(draft.body, /DL0401/)
  assert.doesNotMatch(draft.body, /ZK-2026/)
  assert.doesNotMatch(draft.subject, /DL0401/)
})

test("guest details request with a form URL asks them to complete the form", () => {
  const draft = buildOperationsEmailDraft({
    ...base,
    kind: "guest_details",
    formUrl: "https://zk.example/guest-details/abcdefghijklmnopqrstuvwxabcdefghijklmnopq",
  })
  assert.match(draft.body, /complete this guest details form/)
  assert.match(draft.body, /save and finish later/)
  assert.match(draft.body, /lead guest/)
  assert.match(draft.body, /https:\/\/zk\.example\/guest-details\//)
  assert.doesNotMatch(draft.body, /Date of birth/)
})

test("operations intro introduces Jenny and omits supplier ticket receipt", () => {
  const draft = buildOperationsEmailDraft({ ...base, kind: "operations_intro" })
  assert.equal(draft.subject, "Next steps for 2026 Singapore Grand Prix")
  assert.match(draft.body, /^Hi Sarah,/)
  assert.match(draft.body, /I'm Jenny from ZK Sports & Entertainment/)
  assert.match(draft.body, /I wanted to introduce myself/)
  assert.match(draft.body, /guest details/)
  assert.match(draft.body, /1\. We collect guest details/)
  assert.match(draft.body, /2\. We send the tickets/)
  assert.doesNotMatch(draft.body, /tickets from the supplier/)
  assert.doesNotMatch(draft.body, /3\. /)
  assert.match(draft.body, /sales contact remains available/)
  assert.match(draft.body, /Jenny Kent/)
  assert.doesNotMatch(draft.body, /Matt Johnson/)
  assert.doesNotMatch(draft.subject, /DL0401/)
  assert.doesNotMatch(draft.body, /DL0401/)
  assert.doesNotMatch(draft.body, /ZK-2026/)
})

test("single guest wording and missing name fall back cleanly", () => {
  const draft = buildOperationsEmailDraft({
    ...base,
    kind: "guest_details",
    contactName: "",
    quantity: 1,
  })
  assert.match(draft.body, /^Hi there,/)
  assert.match(draft.body, /1 guest on this booking/)
  assert.equal(operationsEmailKindLabel("guest_details"), "Guest details request")
  assert.equal(operationsEmailKindLabel("operations_intro"), "Operations introduction")
})

test("html conversion escapes markup and keeps paragraphs", () => {
  const html = operationsEmailHtml("Hi Sarah,\n\nPlease send names for <Apex>.")
  assert.match(html, /<p style="margin:0 0 14px">Hi Sarah,<\/p>/)
  assert.match(html, /&lt;Apex&gt;/)
  assert.doesNotMatch(html, /<Apex>/)
})

test("after-event thank-you is short and asks them to come back", () => {
  const draft = buildOperationsEmailDraft({ ...base, kind: "after_event" })
  assert.equal(draft.subject, "Thank you for 2026 Singapore Grand Prix")
  assert.match(draft.body, /^Hi Sarah,/)
  assert.match(draft.body, /hope you enjoyed/)
  assert.match(draft.body, /next year/)
  assert.match(draft.body, /Jenny Kent/)
  assert.equal(operationsEmailKindLabel("after_event"), "After the event")
})

test("saved templates keep placeholders until they are filled", () => {
  const draft = buildOperationsEmailDraft({
    ...base,
    kind: "collection_details",
    collectionPoint: "Yas Marina Box Office",
    collectionTime: "From 08:15",
    template: {
      subject: "Collect at {{collection_point}}",
      body: "Hi {{first_name}}, meet at {{collection_point}} {{collection_time}}.",
    },
  })
  assert.equal(draft.subject, "Collect at Yas Marina Box Office")
  assert.match(draft.body, /Yas Marina Box Office/)
  assert.match(draft.body, /From 08:15/)
})

test("reminder drafts include a formatted supplier deadline", () => {
  const draft = buildOperationsEmailDraft({
    ...base,
    kind: "guest_details_reminder",
    deadline: "1 Oct 2026",
  })
  assert.match(draft.subject, /Reminder/)
  assert.match(draft.body, /1 Oct 2026/)
})

test("html conversion turns a guest-details URL paragraph into a button", () => {
  const url = "https://zk.example/guest-details/abcdefghijklmnopqrstuvwxabcdefghijklmnopq"
  const html = operationsEmailHtml(`Hi Sarah,\n\n${url}\n\nKind regards,`)
  assert.match(html, /Complete guest details/)
  assert.match(html, new RegExp(`href="${url}"`))
  assert.match(html, /background:#F90202/)
})
