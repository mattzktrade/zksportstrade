import assert from "node:assert/strict"
import test from "node:test"
import {
  dealAssignedSupplierSlices,
  dealIsOversoldUnassigned,
  dealLineSelectedSupplierKeys,
  dealUnassignedPurchasedQuantity,
  type DealSupplierSplitLine,
} from "../lib/inventory/deal-supplier-split"

function line(partial: Partial<DealSupplierSplitLine> & Pick<DealSupplierSplitLine, "id">): DealSupplierSplitLine {
  return {
    quantity: 0,
    supplierKey: "",
    supplierName: null,
    supplierAllocations: [],
    ...partial,
  }
}

test("leftover FIFO on one line lists each supplier quantity", () => {
  const slices = dealAssignedSupplierSlices([
    line({
      id: "air-cargo",
      quantity: 5,
      supplierAllocations: [
        { key: "id:f1", name: "F1", quantity: 2 },
        { key: "id:gpt", name: "Grand Prix Tickets Ges.M.B.H", quantity: 3 },
      ],
    }),
  ])
  assert.deepEqual(slices, [
    { name: "Grand Prix Tickets Ges.M.B.H", quantity: 3 },
    { name: "F1", quantity: 2 },
  ])
})

test("a multi-line deal still lists suppliers when each line already has a saved supplier key", () => {
  const slices = dealAssignedSupplierSlices(
    [
      line({
        id: "staff",
        quantity: 20,
        supplierKey: "id:staff",
        supplierName: "Staff and Services",
        supplierAllocations: [{ key: "id:staff", name: "Staff and Services", quantity: 20 }],
      }),
      line({
        id: "gpt-a",
        quantity: 8,
        supplierKey: "id:gpt",
        supplierName: "Grand Prix Tickets Ges.M.B.H",
        supplierAllocations: [{ key: "id:gpt", name: "Grand Prix Tickets Ges.M.B.H", quantity: 8 }],
      }),
      line({
        id: "gpt-b",
        quantity: 1,
        supplierKey: "id:gpt",
        supplierName: "Grand Prix Tickets Ges.M.B.H",
        supplierAllocations: [{ key: "id:gpt", name: "Grand Prix Tickets Ges.M.B.H", quantity: 1 }],
      }),
      line({
        id: "f1",
        quantity: 5,
        supplierKey: "id:f1",
        supplierName: "F1",
        supplierAllocations: [{ key: "id:f1", name: "F1", quantity: 5 }],
      }),
    ],
    {
      staff: "id:staff",
      "gpt-a": "id:gpt",
      "gpt-b": "id:gpt",
      f1: "id:f1",
    },
  )
  assert.deepEqual(slices, [
    { name: "Staff and Services", quantity: 20 },
    { name: "Grand Prix Tickets Ges.M.B.H", quantity: 9 },
    { name: "F1", quantity: 5 },
  ])
})

test("an unsaved draft to one supplier replaces the stored split", () => {
  const slices = dealAssignedSupplierSlices(
    [
      line({
        id: "line",
        quantity: 5,
        supplierAllocations: [
          { key: "id:f1", name: "F1", quantity: 2 },
          { key: "id:gpt", name: "Grand Prix Tickets Ges.M.B.H", quantity: 3 },
        ],
      }),
    ],
    { line: "id:bam" },
    new Map([["id:bam", "BAM Motorsport"]]),
  )
  assert.deepEqual(slices, [{ name: "BAM Motorsport", quantity: 5 }])
})

test("a paid deal with no allocations is fully unassigned", () => {
  assert.equal(
    dealUnassignedPurchasedQuantity([
      line({ id: "p1", quantity: 2, supplierAllocations: [] }),
    ]),
    2,
  )
})

test("unassigned guests are oversold unless one supplier still has enough leftover", () => {
  assert.equal(dealIsOversoldUnassigned(2, []), true)
  assert.equal(dealIsOversoldUnassigned(2, [0, 0]), true)
  assert.equal(dealIsOversoldUnassigned(2, [1, 0]), true)
  assert.equal(dealIsOversoldUnassigned(2, [2, 0]), false)
  assert.equal(dealIsOversoldUnassigned(0, [0]), false)
})
