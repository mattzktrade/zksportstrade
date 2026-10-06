import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  classifySalesChannel,
  isAgentPortalBooking,
  isPortalCheckoutChannel,
  orderPartyPrimary,
  orderSaleChannelLabel,
} from "../lib/orders/channel"

test("My Bookings only includes the signed-in agent's portal checkouts", () => {
  const agent = "agent-1"
  assert.equal(
    isAgentPortalBooking({ agentProfileId: agent, viewerProfileId: agent, channel: "trade_portal" }),
    true,
  )
  assert.equal(
    isAgentPortalBooking({ agentProfileId: agent, viewerProfileId: agent, channel: "partner_api" }),
    true,
  )
  assert.equal(
    isAgentPortalBooking({ agentProfileId: agent, viewerProfileId: agent, channel: null }),
    true,
  )
  assert.equal(
    isAgentPortalBooking({ agentProfileId: agent, viewerProfileId: agent, channel: "native_deal" }),
    false,
  )
  assert.equal(
    isAgentPortalBooking({ agentProfileId: agent, viewerProfileId: agent, channel: "admin" }),
    false,
  )
  assert.equal(
    isAgentPortalBooking({ agentProfileId: agent, viewerProfileId: agent, channel: "wix" }),
    false,
  )
  assert.equal(
    isAgentPortalBooking({
      agentProfileId: agent,
      viewerProfileId: "admin-staff",
      channel: "trade_portal",
    }),
    false,
  )
  assert.equal(isPortalCheckoutChannel("native_deal"), false)

  const querySource = readFileSync("lib/orders/queries.ts", "utf8")
  assert.match(querySource, /isAgentPortalBooking/)
  assert.match(querySource, /\.eq\("agent_profile_id", profile\.id\)/)
})

test("native deal orders are offline sales, not portal checkouts", () => {
  assert.equal(classifySalesChannel("native_deal"), "offline")
  assert.equal(classifySalesChannel("admin"), "offline")
  assert.equal(classifySalesChannel("other"), "offline")
  assert.equal(classifySalesChannel("offline"), "offline")
  assert.equal(classifySalesChannel("whatsapp"), "offline")
  assert.equal(classifySalesChannel("email"), "offline")
  assert.equal(classifySalesChannel("trade_portal"), "portal")
  assert.equal(classifySalesChannel("wix"), "wix")
  assert.equal(classifySalesChannel("partner_api"), "portal")
})

test("product page labels signed native deals as offline even after an order is created", () => {
  assert.equal(
    orderSaleChannelLabel({ channel: "native_deal", dealSource: "other" }),
    "Offline deal",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: "native_deal", dealSource: "offline" }),
    "WhatsApp",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: "native_deal", dealSource: "whatsapp" }),
    "WhatsApp",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: "native_deal", dealSource: "email" }),
    "Email",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: "trade_portal", dealSource: "other" }),
    "Offline deal",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: null, dealSource: "offline" }),
    "WhatsApp",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: "trade_portal", dealSource: "portal" }),
    "Portal",
  )
  assert.equal(orderSaleChannelLabel({ channel: "wix", dealSource: "website" }), "Website")
})

test("offline CRM accounts are preferred over a missing portal agent profile", () => {
  assert.equal(
    orderPartyPrimary({
      accountName: "Go Privilege Limited",
      contactName: "Mitchell Lawrence",
      agentCompany: null,
      agentName: null,
      clientName: "Mitchell Lawrence",
    }),
    "Go Privilege Limited",
  )
  assert.equal(
    orderPartyPrimary({
      accountName: null,
      contactName: null,
      agentCompany: "P1, Corporate Hospitality B.V.",
      agentName: null,
      clientName: null,
    }),
    "P1, Corporate Hospitality B.V.",
  )
})
