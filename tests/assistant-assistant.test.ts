import assert from "node:assert/strict"
import test from "node:test"
import { accountSourceForAssistantChannel } from "../lib/assistant/identity"
import { phonesMatch } from "../lib/assistant/phone"
import { parseWhatsAppAssistantEvents } from "../lib/assistant/whatsapp-parse"
import { parseAssistantEmailEvent } from "../lib/assistant/email-parse"
import { classifyClientMessage } from "../lib/assistant/classify"
import { pickIdentityMatch } from "../lib/assistant/identity"
import {
  canSendWhatsAppReply,
  formatInboxTime,
  inboxRowVisible,
  inboxWaitState,
  previewText,
  type InboxRow,
} from "../lib/assistant/inbox"
import { parseAssistantJson, buildAssistantSystemPrompt } from "../lib/assistant/llm"
import {
  assistantWillAutoReply,
  inWhatsAppReplyNotifyBurst,
  whatsAppReplyNeededEmail,
  whatsAppReplyNoticeDue,
  whatsAppReplyPreview,
} from "../lib/assistant/reply-needed"
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

test("assistant-created accounts use a CRM source the database allows", () => {
  assert.equal(accountSourceForAssistantChannel("whatsapp"), "other")
  assert.equal(accountSourceForAssistantChannel("email"), "other")
})

test("whatsapp parser stores customer text and phone echoes separately", () => {
  const events = parseWhatsAppAssistantEvents(whatsappBody)
  assert.equal(events.length, 2)
  assert.equal(events[0].sentBy, "client")
  assert.equal(events[0].displayName, "James")
  assert.match(events[0].body, /Paddock Club/)
  assert.equal(events[1].sentBy, "staff")
  assert.match(events[1].body, /I'll check/)
})

test("whatsapp parser shows reaction emoji and ignores removed reactions", () => {
  const reacted = parseWhatsAppAssistantEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { display_phone_number: "971585346740" },
              contacts: [{ wa_id: "5215554024338", profile: { name: "Carlos" } }],
              messages: [
                {
                  from: "5215554024338",
                  id: "wamid.react",
                  timestamp: "1710000002",
                  type: "reaction",
                  reaction: { emoji: "😂", message_id: "wamid.orig" },
                },
              ],
            },
          },
        ],
      },
    ],
  })
  assert.equal(reacted.length, 1)
  assert.equal(reacted[0].body, "Reacted 😂")
  assert.equal(reacted[0].mediaType, "reaction")
  const removed = parseWhatsAppAssistantEvents({
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from: "5215554024338",
                  id: "wamid.unreact",
                  type: "reaction",
                  reaction: { emoji: "", message_id: "wamid.orig" },
                },
              ],
            },
          },
        ],
      },
    ],
  })
  assert.equal(removed.length, 0)
})

test("Mexico WhatsApp 521 numbers match the 52 form number on the original lead", () => {
  assert.equal(phonesMatch("5215529218397", "525529218397"), true)
  assert.equal(phonesMatch("525529218397", "5215529218397"), true)
  assert.equal(phonesMatch("5215554024338", "525554024338"), true)
  assert.equal(phonesMatch("5215529218397", "5215554024338"), false)
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

test("email parser reads Outlook and Graph payloads and skips our own mailbox", () => {
  const outlook = parseAssistantEmailEvent({
    from: "matt@zk-sports.com",
    subject: "Re: Mexico",
    text: "<p>Yes please send 4</p><br>On Monday, ZK Sports wrote:<br>Hello Matt",
  })
  assert.equal(outlook?.fromEmail, "matt@zk-sports.com")
  assert.match(outlook?.body ?? "", /Yes please send 4/)
  assert.doesNotMatch(outlook?.body ?? "", /Hello Matt/)

  const graph = parseAssistantEmailEvent({
    from: { emailAddress: { address: "jane@agency.com", name: "Jane Smith" } },
    subject: "Paddock Club",
    body: { content: "<p>Can you hold two?</p>", contentType: "html" },
    internetMessageId: "<graph-1@outlook>",
  })
  assert.equal(graph?.fromEmail, "jane@agency.com")
  assert.equal(graph?.displayName, "Jane Smith")
  assert.match(graph?.body ?? "", /hold two/)
  assert.equal(graph?.providerMessageId, "<graph-1@outlook>")

  assert.equal(
    parseAssistantEmailEvent({
      from: "ZK Sports <sales@zk-sports.com>",
      subject: "Stage 1",
      text: "Our own outbound copy",
    }),
    null,
  )
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

test("WhatsApp reply emails fire until the assistant can auto-send", () => {
  assert.equal(
    assistantWillAutoReply({
      channel: "whatsapp",
      status: "human_takeover",
      autoSendEnabled: true,
      llmConfigured: true,
      killSwitch: false,
    }),
    false,
  )
  assert.equal(
    assistantWillAutoReply({
      channel: "whatsapp",
      status: "ai_active",
      autoSendEnabled: false,
      llmConfigured: false,
      killSwitch: false,
    }),
    false,
  )
  assert.equal(
    assistantWillAutoReply({
      channel: "whatsapp",
      status: "ai_active",
      autoSendEnabled: true,
      llmConfigured: true,
      killSwitch: false,
    }),
    true,
  )
  assert.equal(
    whatsAppReplyNoticeDue({ channel: "whatsapp", willAutoReply: false }),
    true,
  )
  assert.equal(
    whatsAppReplyNoticeDue({ channel: "email", willAutoReply: false }),
    false,
  )
  assert.equal(
    whatsAppReplyNoticeDue({ channel: "whatsapp", willAutoReply: true }),
    false,
  )
  assert.equal(
    whatsAppReplyNoticeDue({ channel: "whatsapp", willAutoReply: false, mediaType: "reaction" }),
    false,
  )
  assert.equal(inWhatsAppReplyNotifyBurst(null), false)
  assert.equal(inWhatsAppReplyNotifyBurst(new Date().toISOString()), true)
  assert.equal(whatsAppReplyPreview("", "image"), "(photo or file)")
  const email = whatsAppReplyNeededEmail({
    clientName: "Kary",
    preview: "Can you send a price?",
    href: "https://zk-sports.trade/admin/assistant/abc",
    dealReference: "DL1511",
  })
  assert.match(email.subject, /WhatsApp from Kary/)
  assert.match(email.text, /Can you send a price/)
  assert.match(email.text, /DL1511/)
  assert.match(email.text, /Inbox/)
})

test("sensitive and booking classifications", () => {
  assert.equal(classifyClientMessage("Can we get a refund?").sensitive, true)
  assert.equal(classifyClientMessage("How much for 6?").wantsPrice, true)
  assert.equal(classifyClientMessage("please send the booking form").wantsBooking, true)
})

test("inbox search can split WhatsApp from email and find a name", () => {
  const whatsapp: InboxRow = {
    id: "1",
    channel: "whatsapp",
    status: "human_takeover",
    wait: "waiting",
    hasClientReply: false,
    name: "Matt Johnson",
    preview: "You: Hi Matt, thanks for your enquiry",
    updatedAt: "2026-10-15T12:00:00.000Z",
    email: null,
    phone: "447426610346",
    dealId: null,
    dealReference: null,
    outreachLabel: "Stage 1 · WhatsApp sent",
  }
  const email: InboxRow = {
    ...whatsapp,
    id: "2",
    channel: "email",
    name: "Lesli Delsol",
    preview: "Thanks for getting in touch",
    phone: null,
    email: "lesli@example.com",
    dealReference: "DL0900",
  }
  assert.equal(inboxRowVisible(whatsapp, { query: "matt", channel: "all", view: "all" }), true)
  assert.equal(inboxRowVisible(whatsapp, { query: "", channel: "email", view: "all" }), false)
  assert.equal(inboxRowVisible(email, { query: "dl0900", channel: "email", view: "all" }), true)
  assert.equal(inboxRowVisible(whatsapp, { query: "lesli", channel: "whatsapp", view: "waiting" }), false)
  assert.match(formatInboxTime("2026-10-15T12:00:00.000Z", Date.parse("2026-10-15T18:00:00.000Z")), /\d{2}:\d{2}/)
})

test("inbox shows waiting after we send and replied after they write back", () => {
  assert.equal(inboxWaitState({ lastClientMessageAt: null, lastOutboundAt: "2026-10-15T10:00:00.000Z" }), "waiting")
  assert.equal(
    inboxWaitState({
      lastClientMessageAt: "2026-10-15T11:00:00.000Z",
      lastOutboundAt: "2026-10-15T10:00:00.000Z",
    }),
    "replied",
  )
  const answered: InboxRow = {
    id: "3",
    channel: "whatsapp",
    status: "human_takeover",
    wait: "waiting",
    hasClientReply: true,
    name: "Raul",
    preview: "You: Hi Raul",
    updatedAt: "2026-10-16T12:17:00.000Z",
    email: null,
    phone: "5215529218397",
    dealId: "deal-1",
    dealReference: "DL0901",
    outreachLabel: null,
  }
  assert.equal(inboxRowVisible(answered, { query: "", channel: "whatsapp", view: "replied" }), true)
  assert.equal(inboxRowVisible(answered, { query: "", channel: "whatsapp", view: "waiting" }), false)
  assert.equal(inboxRowVisible({ ...answered, status: "closed" }, { query: "", channel: "whatsapp", view: "replied" }), false)
  assert.equal(canSendWhatsAppReply(null), false)
  assert.equal(canSendWhatsAppReply(new Date().toISOString()), true)
  assert.equal(previewText("Hi Matt, thanks for your enquiry about 3 Day Paddock Club."), "Hi Matt, thanks for your enquiry about 3 Day Paddock Club.")
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
