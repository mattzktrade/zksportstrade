import assert from "node:assert/strict"
import test from "node:test"
import { parseWhatsAppAssistantEvents } from "../lib/assistant/whatsapp-parse"
import { parseAssistantEmailEvent } from "../lib/assistant/email-parse"
import { classifyClientMessage } from "../lib/assistant/classify"
import { pickIdentityMatch } from "../lib/assistant/identity"
import { parseAssistantJson, buildAssistantSystemPrompt } from "../lib/assistant/llm"
import { shouldPromoteQa, styleExampleFromEdit } from "../lib/assistant/learning"
import { bookingFormPrepareCheck, detectAgreement } from "../lib/assistant/booking-form"
import { readFileSync } from "node:fs"

const whatsappBody = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { display_phone_number: "447426610346", phone_number_id: "123" },
            contacts: [{ wa_id: "447900000001", profile: { name: "James" } }],
            messages: [
              {
                from: "447900000001",
                id: "wamid.abc",
                timestamp: "1710000000",
                type: "text",
                text: { body: "Have you got Paddock Club for Monaco?" },
              },
            ],
            smb_message_echoes: [
              {
                from: "447900000001",
                id: "wamid.staff",
                timestamp: "1710000001",
                type: "text",
                text: { body: "I'll check and come back to you." },
              },
            ],
          },
        },
      ],
    },
  ],
}

test("whatsapp parser stores customer text and phone echoes separately", () => {
  const events = parseWhatsAppAssistantEvents(whatsappBody)
  assert.equal(events.length, 2)
  assert.equal(events[0].sentBy, "client")
  assert.equal(events[0].displayName, "James")
  assert.match(events[0].body, /Paddock Club/)
  assert.equal(events[1].sentBy, "staff")
  assert.match(events[1].body, /I'll check/)
})

test("email parser reads Resend-style inbound payloads", () => {
  const event = parseAssistantEmailEvent({
    data: {
      from: "Jane Smith <jane@example.com>",
      subject: "Monaco",
      text: "Do you have 4 for Saturday?",
      email_id: "msg-1",
    },
  })
  assert.equal(event?.fromEmail, "jane@example.com")
  assert.match(event?.body ?? "", /Saturday/)
  assert.equal(event?.providerMessageId, "msg-1")
})

test("identity match is unique, new, or ambiguous", () => {
  assert.equal(pickIdentityMatch([]).status, "new")
  assert.equal(
    pickIdentityMatch([{ id: "c1", accountId: "a1", fullName: "Ada", email: null, phone: "1" }]).status,
    "unique",
  )
  assert.equal(
    pickIdentityMatch([
      { id: "c1", accountId: "a1", fullName: "Ada", email: null, phone: "1" },
      { id: "c2", accountId: "a2", fullName: "James", email: null, phone: "1" },
    ]).status,
    "ambiguous",
  )
})

test("agreement detection needs more than yes", () => {
  assert.equal(detectAgreement("yes"), false)
  assert.equal(detectAgreement("We're on, please send the booking form"), true)
  const check = bookingFormPrepareCheck({
    dealId: "d1",
    hasPackage: true,
    hasQuantity: true,
    hasPricedLines: true,
    portalCapable: false,
    contactEmail: true,
  })
  assert.equal(check.ready, true)
  assert.equal(
    bookingFormPrepareCheck({
      dealId: "d1",
      hasPackage: true,
      hasQuantity: true,
      hasPricedLines: false,
      portalCapable: false,
      contactEmail: true,
    }).ready,
    false,
  )
})

test("learning only stores edited sends and staff-approved Q&A", () => {
  assert.equal(styleExampleFromEdit("Hello", "Hello"), null)
  assert.match(styleExampleFromEdit("Hello there", "Hi James, that's all in.") ?? "", /Hi James/)
  assert.equal(shouldPromoteQa({ question: "?", answer: "no" }), false)
  assert.equal(shouldPromoteQa({ question: "What is included?", answer: "Dinner and an open bar." }), true)
})

test("model JSON parser rejects empty replies", () => {
  assert.equal(parseAssistantJson("not json"), null)
  const parsed = parseAssistantJson('{"reply":"We have 4 sellable.","confidence":0.9,"intent":"answer","needs_human":false}')
  assert.equal(parsed?.reply, "We have 4 sellable.")
  assert.equal(parsed?.confidence, 0.9)
  const prompt = buildAssistantSystemPrompt({ policy: "Never invent prices.", styleExamples: ["Hi James"], clientName: "James" })
  assert.match(prompt, /Never invent prices/)
  assert.match(prompt, /Hi James/)
})

test("sensitive and booking classifications", () => {
  assert.equal(classifyClientMessage("Can we get a refund?").sensitive, true)
  assert.equal(classifyClientMessage("How much for 6?").wantsPrice, true)
  assert.equal(classifyClientMessage("please send the booking form").wantsBooking, true)
})

test("migration creates assistant tables and seeds the sales policy", () => {
  const sql = readFileSync("supabase/migrations/20261005170000_sales_assistant.sql", "utf8")
  assert.match(sql, /create table if not exists public.assistant_conversations/)
  assert.match(sql, /create table if not exists public.assistant_messages/)
  assert.match(sql, /create table if not exists public.assistant_runs/)
  assert.match(sql, /create table if not exists public.assistant_drafts/)
  assert.match(sql, /create table if not exists public.knowledge_articles/)
  assert.match(sql, /create table if not exists public.knowledge_examples/)
  assert.match(sql, /sales-policy/)
  assert.match(sql, /Never invent inclusions/)
  assert.match(sql, /auto_send_enabled boolean not null default false/)
})
