import assert from "node:assert/strict"
import test from "node:test"
import {
  allowedDealTransitions,
  canTransitionDeal,
} from "../lib/crm/deal-workflow"
import {
  dealConfirmedOffPlatform,
  dealStageCountsAsSold,
  dealStageHoldsPurchasedStock,
  dealStageIsConfirmed,
  dealStageIsOpenPipeline,
  dealStageIsUnsignedPipeline,
  dealStageReservesSellable,
} from "../lib/crm/deal-types"

test("deal workflow allows jumping to any valid stage", () => {
  assert.equal(canTransitionDeal("draft", "proposal"), true)
  assert.equal(canTransitionDeal("draft", "paid_confirmed"), true)
  assert.equal(canTransitionDeal("proposal", "fulfilled"), true)
  assert.equal(canTransitionDeal("proposal", "signed"), true)
  assert.equal(canTransitionDeal("awaiting_client_signature", "awaiting_payment"), true)
  assert.equal(canTransitionDeal("paid_confirmed", "fulfilled"), true)
  assert.equal(canTransitionDeal("fulfilled", "draft"), true)
})

test("open deals can close and closed deals can be reopened", () => {
  assert.ok(allowedDealTransitions("proposal").includes("closed_lost"))
  assert.ok(allowedDealTransitions("proposal").includes("cancelled"))
  assert.ok(allowedDealTransitions("proposal").includes("paid_confirmed"))
  assert.ok(allowedDealTransitions("closed_lost").includes("draft"))
  assert.ok(allowedDealTransitions("fulfilled").includes("paid_confirmed"))
})

test("unsigned deals do not reserve sellable stock", () => {
  assert.equal(dealStageReservesSellable("draft"), false)
  assert.equal(dealStageReservesSellable("proposal"), false)
  assert.equal(dealStageReservesSellable("booking_form_sent"), false)
  assert.equal(dealStageReservesSellable("awaiting_client_signature"), false)
  assert.equal(dealStageReservesSellable("awaiting_zk_signature"), false)
  assert.equal(dealStageReservesSellable("signed"), false)
  assert.equal(dealStageReservesSellable("awaiting_invoice"), false)
  assert.equal(dealStageReservesSellable("awaiting_payment"), false)
  assert.equal(dealStageCountsAsSold("proposal"), false)
  assert.equal(dealStageCountsAsSold("signed"), true)
  assert.equal(dealStageCountsAsSold("awaiting_invoice"), true)
  assert.equal(dealStageCountsAsSold("awaiting_payment"), true)
  assert.equal(dealStageCountsAsSold("paid_confirmed"), true)
  assert.equal(dealStageHoldsPurchasedStock("proposal"), false)
  assert.equal(dealStageHoldsPurchasedStock("awaiting_zk_signature"), false)
  assert.equal(dealStageHoldsPurchasedStock("signed"), true)
  assert.equal(dealStageHoldsPurchasedStock("awaiting_payment"), true)
  assert.equal(dealStageIsUnsignedPipeline("draft"), true)
  assert.equal(dealStageIsUnsignedPipeline("proposal"), true)
  assert.equal(dealStageIsUnsignedPipeline("awaiting_zk_signature"), true)
  assert.equal(dealStageIsUnsignedPipeline("signed"), false)
  assert.equal(dealStageIsUnsignedPipeline("awaiting_invoice"), false)
  assert.equal(dealStageIsUnsignedPipeline("awaiting_payment"), false)
  assert.equal(dealStageIsUnsignedPipeline("paid_confirmed"), false)
})

test("only paid stages are ready to fulfil; unpaid signed deals stay awaiting payment", () => {
  assert.equal(dealStageIsConfirmed("proposal"), false)
  assert.equal(dealStageIsConfirmed("awaiting_payment"), false)
  assert.equal(dealStageIsConfirmed("paid_confirmed"), true)
  assert.equal(dealStageIsConfirmed("in_fulfilment"), true)
  assert.equal(dealStageIsConfirmed("fulfilled"), true)
  assert.equal(dealStageIsOpenPipeline("proposal"), true)
  assert.equal(dealStageIsOpenPipeline("awaiting_payment"), true)
  assert.equal(dealStageIsOpenPipeline("paid_confirmed"), false)
  assert.equal(dealStageIsOpenPipeline("cancelled"), false)
  assert.equal(
    dealConfirmedOffPlatform({ order_id: null, stage: "paid_confirmed" }),
    true,
  )
  assert.equal(
    dealConfirmedOffPlatform({ order_id: "order-1", stage: "paid_confirmed" }),
    false,
  )
  assert.equal(
    dealConfirmedOffPlatform({ order_id: null, stage: "proposal" }),
    false,
  )
})
