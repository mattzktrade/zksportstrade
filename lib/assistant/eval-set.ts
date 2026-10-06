import type { PolicyInput } from "@/lib/assistant/types"

export type AssistantEvalCase = {
  id: string
  prompt: string
  expectedDecision: PolicyInput extends never ? never : import("@/lib/assistant/types").AssistantDecision
  input: Omit<
    PolicyInput,
    | "killSwitch"
    | "autoSendEnabled"
    | "llmConfigured"
    | "envKillSwitch"
    | "allowPublishedTradePrices"
    | "humanTakeover"
    | "withinCustomerWindow"
  > &
    Partial<PolicyInput>
}

const baseHigh = {
  confidence: 0.92,
  identity: "unique" as const,
  packageResolution: "unique" as const,
  factsMissing: false,
  toolFailed: false,
  wantsPriceCommit: false,
  wantsBooking: false,
  dealHasPricedLines: false,
  dealHasPackage: true,
  dealHasQuantity: true,
  sensitiveTopic: false,
  stockStatus: "in_stock" as const,
  mediaOnly: false,
  intent: "answer" as const,
  needsHuman: false,
}

function caseRow(
  id: string,
  prompt: string,
  expectedDecision: AssistantEvalCase["expectedDecision"],
  patch: Partial<PolicyInput> = {},
): AssistantEvalCase {
  return {
    id,
    prompt,
    expectedDecision,
    input: {
      ...baseHigh,
      killSwitch: false,
      autoSendEnabled: true,
      llmConfigured: true,
      envKillSwitch: false,
      allowPublishedTradePrices: false,
      humanTakeover: false,
      withinCustomerWindow: true,
      ...patch,
    },
  }
}

/** Expected send-vs-escalate cases for the policy layer. Keep adding real threads here. */
export const ASSISTANT_EVAL_CASES: AssistantEvalCase[] = [
  caseRow("faq-inclusions", "What's included in Champions Club Abu Dhabi?", "sent"),
  caseRow("faq-days", "Which days is the 3 day Paddock Club?", "sent"),
  caseRow("faq-where", "Where do they watch from in Singapore?", "sent"),
  caseRow("faq-dress-known", "What is the dress code?", "sent"),
  caseRow("stock-yes", "Do you still have 4 for Saturday in Mexico?", "sent"),
  caseRow("stock-out", "Any Paddock Club left for Monaco?", "source", { stockStatus: "out", intent: "source" }),
  caseRow("stock-unknown", "Have you got Silverstone House 44?", "escalated", { stockStatus: "unknown" }),
  caseRow("ambiguous-event", "Need hospitality for the GP", "escalated", { packageResolution: "ambiguous" }),
  caseRow("ambiguous-contact", "Hi it's James", "escalated", { identity: "ambiguous" }),
  caseRow("new-contact-faq", "What time do doors open?", "sent", { identity: "new" }),
  caseRow("price-no-deal", "How much for 6 people?", "escalated", { wantsPriceCommit: true, intent: "quote" }),
  caseRow("price-on-deal", "Can you remind me the rate?", "sent", {
    wantsPriceCommit: true,
    dealHasPricedLines: true,
    intent: "quote",
  }),
  caseRow("price-allowed", "Trade price for 3 day Champions?", "sent", {
    wantsPriceCommit: true,
    allowPublishedTradePrices: true,
    intent: "quote",
  }),
  caseRow("discount", "Can you do a bit better on the price?", "escalated", { wantsPriceCommit: true, intent: "quote" }),
  caseRow("book-complete", "We're on, please send the booking form for the 4 tickets.", "prepare_booking_form", {
    wantsBooking: true,
    dealHasPricedLines: true,
    intent: "book",
  }),
  caseRow("book-no-price", "Go ahead and book it.", "escalated", {
    wantsBooking: true,
    dealHasPricedLines: false,
    intent: "book",
  }),
  caseRow("book-no-package", "Yes please send the form.", "escalated", {
    wantsBooking: true,
    dealHasPackage: false,
    dealHasPricedLines: true,
    intent: "book",
  }),
  caseRow("portal", "Can they just book on the portal?", "drafted", { intent: "portal", wantsBooking: true }),
  caseRow("cancel", "We need to cancel two of the tickets.", "escalated", { sensitiveTopic: true }),
  caseRow("refund", "Can we get a refund if it rains?", "escalated", { sensitiveTopic: true }),
  caseRow("visa", "Do you sort the visa letters?", "escalated", { sensitiveTopic: true }),
  caseRow("guaranteed", "Can you guarantee Paddock Club access?", "escalated", { sensitiveTopic: true }),
  caseRow("transfers", "Do you include airport transfers?", "escalated", { sensitiveTopic: true }),
  caseRow("onground", "Who is the on-ground contact?", "escalated", { sensitiveTopic: true }),
  caseRow("photo-only", "", "escalated", { mediaOnly: true }),
  caseRow("takeover", "What's included?", "escalated", { humanTakeover: true }),
  caseRow("kill-switch", "What's included?", "skipped", { killSwitch: true }),
  caseRow("env-kill", "What's included?", "skipped", { envKillSwitch: true }),
  caseRow("window-closed", "Just circling back", "escalated", { withinCustomerWindow: false }),
  caseRow("low-confidence", "Can you help with something?", "escalated", { confidence: 0.4, intent: "unclear" }),
  caseRow("needs-human", "Complicated split across two companies", "escalated", { needsHuman: true }),
  caseRow("tool-fail", "Have you got stock?", "escalated", { toolFailed: true }),
  caseRow("facts-missing", "Have you got stock?", "escalated", { factsMissing: true }),
  caseRow("no-llm", "What's included?", "escalated", { llmConfigured: false }),
  caseRow("draft-only-mode", "What's included?", "drafted", { autoSendEnabled: false }),
  caseRow("brochure", "Can you send the brochure?", "sent"),
  caseRow("children", "Are kids allowed in Champions Club?", "sent"),
  caseRow("tickets-when", "When do they get tickets?", "sent"),
  caseRow("food", "Is it all inclusive food?", "sent"),
  caseRow("parking", "Is there parking?", "sent"),
  caseRow("sprint", "Is it a sprint weekend?", "sent"),
  caseRow("wrong-day", "Is that Friday only or the whole weekend?", "escalated", { packageResolution: "ambiguous" }),
  caseRow("two-packages", "Paddock or terrace?", "escalated", { packageResolution: "ambiguous" }),
  caseRow("qty-only", "We need 10.", "escalated", { packageResolution: "none", intent: "unclear", confidence: 0.5 }),
  caseRow("source-then-hold", "If you can find them we will take them.", "source", {
    stockStatus: "out",
    intent: "source",
    wantsBooking: false,
  }),
  caseRow("yes-alone", "Yes", "escalated", { confidence: 0.5, intent: "unclear", needsHuman: true }),
  caseRow("thanks", "Thanks, that's perfect.", "sent", { intent: "answer", confidence: 0.86 }),
  caseRow("follow-up-hours", "Any update on those 4?", "sent"),
  caseRow("new-event-year", "Same again for 2027?", "escalated", { packageResolution: "none", intent: "unclear", confidence: 0.6, needsHuman: true }),
  caseRow("invoice", "Can you send the invoice now?", "escalated", { sensitiveTopic: true }),
  caseRow("split-pay", "Can we pay 50% now?", "escalated", { wantsPriceCommit: true, intent: "quote" }),
  caseRow("name-correction", "It's James not Jim", "sent", { intent: "answer" }),
  caseRow("emoji-ok", "👌", "escalated", { confidence: 0.3, intent: "unclear", needsHuman: true }),
  caseRow("out-plus-book", "If you can get them, send the form.", "source", { stockStatus: "out", intent: "source" }),
]
