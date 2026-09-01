import assert from "node:assert/strict"
import { test } from "node:test"
import {
  classifySalesChannel,
  orderPartyPrimary,
  orderSaleChannelLabel,
} from "../lib/orders/channel"

test("native deal orders are offline sales, not portal checkouts", () => {
  assert.equal(classifySalesChannel("native_deal"), "offline")
  assert.equal(classifySalesChannel("admin"), "offline")
  assert.equal(classifySalesChannel("other"), "offline")
  assert.equal(classifySalesChannel("offline"), "offline")
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
    "Offline deal",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: "trade_portal", dealSource: "other" }),
    "Offline deal",
  )
  assert.equal(
    orderSaleChannelLabel({ channel: null, dealSource: "offline" }),
    "Offline deal",
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
