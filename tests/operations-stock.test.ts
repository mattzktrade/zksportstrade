import assert from "node:assert/strict"
import test from "node:test"
import {
  applyUnlinkedDealSalesToRemaining,
  assignTakesToDealLines,
  availableOnLayer,
  buildSupplierDrafts,
  collapseTakesBySupplier,
  groupSupplierOptions,
  layerTakesForDrafts,
  layersForLine,
  previewSupplierOptions,
  summarizeMappedSuppliers,
  summarizeOrderStock,
  validateSupplierDrafts,
  type OperationsStockAllocation,
  type OperationsStockLayer,
} from "../lib/operations/stock"

function layer(
  partial: Partial<OperationsStockLayer> &
    Pick<OperationsStockLayer, "costLayerId" | "supplierName" | "supplierKey">,
): OperationsStockLayer {
  return {
    packageId: "pkg",
    supplierId: partial.supplierKey.startsWith("sup:") ? partial.supplierKey.slice(4) : null,
    remaining: 0,
    unitCost: 1000,
    currency: "USD",
    source: partial.supplierName,
    purchaseOrderId: null,
    fulfilmentBlockId: null,
    receivedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  }
}

function allocation(
  partial: Partial<OperationsStockAllocation> & Pick<OperationsStockAllocation, "costLayerId" | "quantity">,
): OperationsStockAllocation {
  return {
    orderId: "order-1",
    packageId: "pkg",
    supplierKey: "sup:test",
    supplierName: "Test",
    supplierId: "test",
    ...partial,
  }
}

test("adds this order's current take back so the same supplier stays available", () => {
  const testLayer = layer({
    costLayerId: "layer-test",
    supplierName: "Test",
    supplierKey: "sup:test",
    remaining: 0,
  })
  const current = [allocation({ costLayerId: "layer-test", quantity: 4 })]
  assert.equal(availableOnLayer(testLayer, "order-1", current), 4)
  const options = groupSupplierOptions([testLayer], current, "order-1", "pkg", "pkg", 4)
  assert.equal(options.length, 1)
  assert.equal(options[0]?.supplierName, "Test")
  assert.equal(options[0]?.available, 4)
  assert.equal(options[0]?.remaining, 0)
  assert.equal(options[0]?.canCover, true)
})

test("lists only suppliers that still have remaining stock, including leftover after this order", () => {
  const layers = [
    layer({
      costLayerId: "layer-test",
      supplierName: "Test",
      supplierKey: "sup:test",
      remaining: 8,
    }),
    layer({
      costLayerId: "layer-matt",
      supplierName: "Matt",
      supplierKey: "sup:matt",
      remaining: 2,
    }),
    layer({
      costLayerId: "layer-empty",
      supplierName: "Empty",
      supplierKey: "sup:empty",
      remaining: 0,
    }),
  ]
  const current = [allocation({ costLayerId: "layer-test", quantity: 4 })]
  const options = groupSupplierOptions(layers, current, "order-1", "pkg", "pkg", 4)
  assert.deepEqual(
    options.map((option) => option.supplierName),
    ["Test", "Matt"],
  )
  assert.equal(options[0]?.canCover, true)
  assert.equal(options[0]?.available, 12)
  assert.equal(options[0]?.remaining, 8)
  assert.equal(options[1]?.canCover, false)
  assert.equal(options[1]?.available, 2)
})

test("counts this booking's places as available even when leftover stock is zero", () => {
  const matt = layer({
    costLayerId: "layer-matt",
    supplierName: "Matt",
    supplierKey: "sup:matt",
    remaining: 0,
  })
  const current = [
    allocation({
      costLayerId: "other-layer",
      quantity: 3,
      supplierKey: "sup:matt",
      supplierName: "Matt",
      supplierId: "matt",
    }),
  ]
  const options = groupSupplierOptions([matt], current, "order-1", "pkg", "pkg", 7)
  assert.equal(options[0]?.remaining, 0)
  assert.equal(options[0]?.using, 3)
  assert.equal(options[0]?.available, 3)
  assert.equal(
    validateSupplierDrafts([{ key: "a", supplierKey: "sup:matt", quantity: "3" }], options, 3),
    null,
  )
})

test("keeps a party on one supplier when that pool can cover, using FIFO within that supplier", () => {
  const layers = [
    layer({
      costLayerId: "po-early",
      supplierName: "Test",
      supplierKey: "sup:test",
      remaining: 3,
      purchaseOrderId: "po-a",
      receivedAt: "2026-01-01T00:00:00.000Z",
    }),
    layer({
      costLayerId: "po-cover",
      supplierName: "Test",
      supplierKey: "sup:test",
      remaining: 10,
      purchaseOrderId: "po-b",
      receivedAt: "2026-02-01T00:00:00.000Z",
    }),
    layer({
      costLayerId: "layer-matt",
      supplierName: "Matt",
      supplierKey: "sup:matt",
      remaining: 20,
    }),
  ]
  const takes = layerTakesForDrafts(
    [{ key: "row-1", supplierKey: "sup:test", quantity: "4" }],
    layers,
    [],
    "order-1",
    "pkg",
    "pkg",
  )
  assert.deepEqual(takes, [{ costLayerId: "po-cover", quantity: 4 }])
})

test("allows a split only when quantities add up and each supplier can cover its share", () => {
  const layers = [
    layer({
      costLayerId: "layer-test",
      supplierName: "Test",
      supplierKey: "sup:test",
      remaining: 3,
    }),
    layer({
      costLayerId: "layer-matt",
      supplierName: "Matt",
      supplierKey: "sup:matt",
      remaining: 3,
    }),
  ]
  const options = groupSupplierOptions(layers, [], "order-1", "pkg", "pkg", 4)
  assert.equal(options.every((option) => !option.canCover), true)
  assert.equal(
    validateSupplierDrafts(
      [
        { key: "a", supplierKey: "sup:test", quantity: "2" },
        { key: "b", supplierKey: "sup:matt", quantity: "2" },
      ],
      options,
      4,
    ),
    null,
  )
  assert.match(
    validateSupplierDrafts(
      [{ key: "a", supplierKey: "sup:test", quantity: "4" }],
      options,
      4,
    ) ?? "",
    /only has 3/,
  )
})

test("summarizes the current supplier and how many places are left", () => {
  const layers = [
    layer({
      costLayerId: "layer-test",
      supplierName: "Test",
      supplierKey: "sup:test",
      remaining: 8,
    }),
  ]
  const current = [allocation({ costLayerId: "layer-test", quantity: 4 })]
  const summary = summarizeOrderStock(
    [{ orderId: "order-1", packageId: "pkg", description: "Singapore", ledgerPackageId: "pkg", quantity: 4 }],
    layers,
    current,
    "order-1",
  )
  assert.equal(summary, "4× Test · 8 left")
})

test("uses the parent 3-day ledger when the day product has no own remaining stock", () => {
  const parent = layer({
    costLayerId: "parent-layer",
    packageId: "parent",
    supplierName: "Test",
    supplierKey: "sup:test",
    remaining: 6,
  })
  const own = layersForLine([parent], "day", "parent")
  assert.equal(own[0]?.costLayerId, "parent-layer")
  const options = groupSupplierOptions([parent], [], "order-1", "day", "parent", 4)
  assert.equal(options[0]?.canCover, true)
  assert.equal(options[0]?.available, 6)
})

test("opens the current assignment, or the first supplier that can cover", () => {
  const options = groupSupplierOptions(
    [
      layer({
        costLayerId: "layer-matt",
        supplierName: "Matt",
        supplierKey: "sup:matt",
        remaining: 2,
      }),
      layer({
        costLayerId: "layer-test",
        supplierName: "Test",
        supplierKey: "sup:test",
        remaining: 10,
      }),
    ],
    [allocation({ costLayerId: "layer-test", quantity: 4 })],
    "order-1",
    "pkg",
    "pkg",
    4,
  )
  const drafts = buildSupplierDrafts(options, 4)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.supplierKey, "sup:test")
  assert.equal(drafts[0]?.quantity, "4")
})

test("keeps the current stock layer and only takes leftover places when increasing", () => {
  const leftover = layer({
    costLayerId: "leftover",
    supplierName: "Test",
    supplierKey: "sup:test",
    remaining: 2,
    receivedAt: "2026-01-01T00:00:00.000Z",
  })
  const currentLayer = layer({
    costLayerId: "current",
    supplierName: "Test",
    supplierKey: "sup:test",
    remaining: 0,
    receivedAt: "2026-02-01T00:00:00.000Z",
  })
  const takes = layerTakesForDrafts(
    [{ key: "row-1", supplierKey: "sup:test", quantity: "6" }],
    [leftover, currentLayer],
    [allocation({ costLayerId: "current", quantity: 4 })],
    "order-1",
    "pkg",
    "pkg",
  )
  assert.deepEqual(
    takes.sort((a, b) => a.costLayerId.localeCompare(b.costLayerId)),
    [
      { costLayerId: "current", quantity: 4 },
      { costLayerId: "leftover", quantity: 2 },
    ],
  )
})

test("previews leftover and using as the quantities are edited", () => {
  const options = groupSupplierOptions(
    [
      layer({
        costLayerId: "layer-test",
        supplierName: "Test",
        supplierKey: "sup:test",
        remaining: 2,
      }),
      layer({
        costLayerId: "layer-matt",
        supplierName: "Matt",
        supplierKey: "sup:matt",
        remaining: 0,
      }),
    ],
    [
      allocation({ costLayerId: "layer-test", quantity: 4 }),
      allocation({
        costLayerId: "layer-matt",
        quantity: 3,
        supplierKey: "sup:matt",
        supplierName: "Matt",
        supplierId: "matt",
      }),
    ],
    "order-1",
    "pkg",
    "pkg",
    7,
  )
  const preview = previewSupplierOptions(options, [
    { key: "a", supplierKey: "sup:test", quantity: "6" },
    { key: "b", supplierKey: "sup:matt", quantity: "1" },
  ])
  assert.equal(preview.find((option) => option.key === "sup:test")?.using, 6)
  assert.equal(preview.find((option) => option.key === "sup:test")?.remaining, 0)
  assert.equal(preview.find((option) => option.key === "sup:matt")?.using, 1)
  assert.equal(preview.find((option) => option.key === "sup:matt")?.remaining, 2)
})

test("shows mapped suppliers on imported deals instead of a placeholder", () => {
  assert.equal(
    summarizeMappedSuppliers([
      { quantity: 4, supplierName: "Test", remaining: 2 },
      { quantity: 3, supplierName: "Matt", remaining: 1 },
    ]),
    "4× Test · 2 left, 3× Matt · 1 left",
  )
  assert.equal(summarizeMappedSuppliers([{ quantity: 5, supplierName: "Test" }]), "5× Test")
  assert.equal(summarizeMappedSuppliers([{ quantity: 2, supplierName: null }]), "")
})

test("maps one deal line onto one supplier take", () => {
  const result = assignTakesToDealLines(
    [{ id: "line-1", quantity: 5 }],
    [{ costLayerId: "layer-a", quantity: 5 }],
  )
  assert.deepEqual(result, {
    ok: true,
    assignments: [{ lineId: "line-1", costLayerId: "layer-a" }],
  })
})

test("maps two deal lines onto two suppliers even if take order differs", () => {
  const result = assignTakesToDealLines(
    [
      { id: "line-3", quantity: 3 },
      { id: "line-2", quantity: 2 },
    ],
    [
      { costLayerId: "layer-b", quantity: 2 },
      { costLayerId: "layer-a", quantity: 3 },
    ],
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.assignments, [
    { lineId: "line-3", costLayerId: "layer-a" },
    { lineId: "line-2", costLayerId: "layer-b" },
  ])
})

test("rejects splitting one deal line across two suppliers", () => {
  const result = assignTakesToDealLines(
    [{ id: "line-1", quantity: 5 }],
    [
      { costLayerId: "layer-a", quantity: 3 },
      { costLayerId: "layer-b", quantity: 2 },
    ],
  )
  assert.equal(result.ok, false)
})

test("collapses two layers of the same supplier onto one take", () => {
  assert.deepEqual(
    collapseTakesBySupplier(
      [
        { costLayerId: "layer-a", quantity: 4 },
        { costLayerId: "layer-b", quantity: 2 },
      ],
      [
        { id: "layer-a", supplierId: "test" },
        { id: "layer-b", supplierId: "test" },
      ],
    ),
    [{ costLayerId: "layer-a", quantity: 6 }],
  )
})

test("reduces leftover by mapped deal sales so Operations matches catalog sold stock", () => {
  const layers = [
    layer({
      costLayerId: "layer-f1",
      supplierName: "Formula 1",
      supplierKey: "sup:f1",
      remaining: 30,
    }),
  ]
  applyUnlinkedDealSalesToRemaining(layers, [
    { packageId: "pkg", costLayerId: "layer-f1", supplierKey: "sup:f1", quantity: 14 },
    { packageId: "pkg", costLayerId: "layer-f1", supplierKey: "sup:f1", quantity: 3 },
    { packageId: "pkg", costLayerId: "layer-f1", supplierKey: "sup:f1", quantity: 1 },
    { packageId: "pkg", costLayerId: "layer-f1", supplierKey: "sup:f1", quantity: 2 },
    { packageId: "pkg", costLayerId: "layer-f1", supplierKey: "sup:f1", quantity: 10 },
  ])
  assert.equal(layers[0]?.remaining, 0)
  const thisDeal = [
    allocation({
      orderId: "deal:1",
      costLayerId: "layer-f1",
      quantity: 14,
      supplierKey: "sup:f1",
      supplierName: "Formula 1",
      supplierId: "f1",
    }),
  ]
  const summary = summarizeOrderStock(
    [{ orderId: "deal:1", packageId: "pkg", description: "Club Suite", ledgerPackageId: "pkg", quantity: 14 }],
    layers,
    thisDeal,
    "deal:1",
  )
  assert.equal(summary, "14× Formula 1 · 0 left")
  const options = groupSupplierOptions(layers, thisDeal, "deal:1", "pkg", "pkg", 14)
  assert.equal(options[0]?.remaining, 0)
  assert.equal(options[0]?.using, 14)
  assert.equal(options[0]?.available, 14)
})

test("counts unassigned confirmed deals against leftover stock too", () => {
  const layers = [
    layer({
      costLayerId: "layer-f1",
      supplierName: "Formula 1",
      supplierKey: "sup:f1",
      remaining: 30,
    }),
  ]
  applyUnlinkedDealSalesToRemaining(layers, [
    { packageId: "pkg", costLayerId: null, supplierKey: null, quantity: 30 },
  ])
  assert.equal(layers[0]?.remaining, 0)
})

test("lists each product on a multi-product deal with its own supplier line", () => {
  const layers = [
    layer({
      costLayerId: "layer-suite",
      packageId: "suite",
      supplierName: "Formula 1",
      supplierKey: "sup:f1",
      remaining: 0,
    }),
  ]
  const summary = summarizeOrderStock(
    [
      {
        orderId: "deal:1",
        packageId: "suite",
        description: "3 Day Paddock Club",
        ledgerPackageId: "suite",
        quantity: 14,
      },
      {
        orderId: "deal:1",
        packageId: "hotel",
        description: "Hotel",
        ledgerPackageId: "hotel",
        quantity: 2,
      },
    ],
    layers,
    [
      allocation({
        orderId: "deal:1",
        packageId: "suite",
        costLayerId: "layer-suite",
        quantity: 14,
        supplierKey: "sup:f1",
        supplierName: "Formula 1",
        supplierId: "f1",
      }),
    ],
    "deal:1",
  )
  assert.equal(summary, "3 Day Paddock Club: 14× Formula 1 · 0 left; Hotel: Unassigned")
})
