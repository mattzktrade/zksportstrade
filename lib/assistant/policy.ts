import {
  ASSISTANT_MIN_CONFIDENCE,
  type PolicyInput,
  type PolicyResult,
} from "@/lib/assistant/types"

function escalate(reason: string, decision: PolicyResult["decision"] = "escalated"): PolicyResult {
  return { decision, autoSend: false, notifyStaff: true, reason }
}

export function decideAssistantAction(input: PolicyInput): PolicyResult {
  if (input.envKillSwitch || input.killSwitch) {
    return {
      decision: "skipped",
      autoSend: false,
      notifyStaff: false,
      reason: "Kill switch is on. Inbound is stored; nothing is sent.",
    }
  }
  if (input.humanTakeover) {
    return escalate("Staff already has this conversation. Draft only until they resume the assistant.")
  }
  if (input.identity === "ambiguous") {
    return escalate("This number or email matches more than one CRM contact.")
  }
  if (input.mediaOnly) {
    return escalate("The client sent media without a caption.")
  }
  if (input.sensitiveTopic) {
    return escalate("Cancellations, refunds, visas, or guaranteed access need a human.")
  }
  if (input.toolFailed || input.factsMissing) {
    return escalate("A required CRM lookup failed or returned no facts.")
  }
  if (input.packageResolution === "ambiguous") {
    return escalate("More than one package could match. A human should pick the product.")
  }
  if (input.wantsBooking) {
    if (input.intent === "portal") {
      return {
        decision: "drafted",
        autoSend: false,
        notifyStaff: true,
        reason: "Point them at the portal, but a human should confirm they can check out.",
      }
    }
    if (input.dealHasPackage && input.dealHasQuantity && input.dealHasPricedLines) {
      return escalate("Client agreed. Prepare a booking form for admin approval.", "prepare_booking_form")
    }
    return escalate("Client wants to book, but package, quantity, or price is not locked on the deal.")
  }
  if (input.wantsPriceCommit && !input.allowPublishedTradePrices && !input.dealHasPricedLines) {
    return escalate("They asked for a price that is not already on this deal.")
  }
  if (input.stockStatus === "out") {
    return {
      decision: "source",
      autoSend: false,
      notifyStaff: true,
      reason: "We do not have sellable stock. Tell them we are checking sourcing.",
    }
  }
  if (input.stockStatus === "unknown" && input.packageResolution === "unique") {
    return escalate("Stock lookup did not return a sellable figure.")
  }
  if (!input.withinCustomerWindow) {
    return escalate("The WhatsApp 24-hour customer window has closed. Use a template or reply from the phone.")
  }
  if (!input.llmConfigured) {
    return escalate("The language model is not configured.")
  }
  if (input.needsHuman || input.intent === "unclear" || input.confidence < ASSISTANT_MIN_CONFIDENCE) {
    return escalate("The assistant is not confident enough to send on its own.")
  }
  if (!input.autoSendEnabled) {
    return {
      decision: "drafted",
      autoSend: false,
      notifyStaff: false,
      reason: "Auto-send is off. A draft is waiting for staff to send.",
    }
  }
  return {
    decision: "sent",
    autoSend: true,
    notifyStaff: false,
    reason: "High-confidence answer from CRM facts.",
  }
}

export function withinCustomerWindow(lastClientMessageAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastClientMessageAt) return false
  const stamp = Date.parse(lastClientMessageAt)
  if (!Number.isFinite(stamp)) return false
  return now - stamp < 24 * 60 * 60 * 1000
}
