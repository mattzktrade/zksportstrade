import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  purchaseOrderHasContractInvoice,
  storedContractInvoiceReceived,
} from "../lib/admin/purchase-order-contract-invoice"

test("contract/invoice received follows attached files until someone overrides it", () => {
  assert.equal(
    purchaseOrderHasContractInvoice({ contract_invoice_received: null, documents: [] }),
    false,
  )
  assert.equal(
    purchaseOrderHasContractInvoice({ contract_invoice_received: null, documents: [{}] }),
    true,
  )
  assert.equal(
    purchaseOrderHasContractInvoice({ contract_invoice_received: true, documents: [] }),
    true,
  )
  assert.equal(
    purchaseOrderHasContractInvoice({ contract_invoice_received: false, documents: [{}] }),
    false,
  )
})

test("manual ticks are stored only when they differ from attached files", () => {
  assert.equal(storedContractInvoiceReceived(true, 1), null)
  assert.equal(storedContractInvoiceReceived(false, 0), null)
  assert.equal(storedContractInvoiceReceived(true, 0), true)
  assert.equal(storedContractInvoiceReceived(false, 2), false)
})

test("purchase order migration stores a nullable contract/invoice received override", () => {
  const sql = readFileSync(
    "supabase/migrations/20260907120000_purchase_order_contract_invoice_received.sql",
    "utf8",
  )
  assert.match(sql, /contract_invoice_received boolean/)
  assert.match(sql, /purchase_order_documents_clear_received_override_trg/)
})
