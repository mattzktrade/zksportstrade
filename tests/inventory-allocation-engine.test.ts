import assert from "node:assert/strict"
import test from "node:test"
import { planInventoryAllocations } from "../lib/inventory/allocation-engine"

test("keeps a party on one supplier when purchased capacity can cover it", () => {
  const result = planInventoryAllocations(
    [
      { id: "a", supplierId: "supplier-a", available: 2, receivedAt: "2026-01-01" },
      { id: "b", supplierId: "supplier-b", available: 8, receivedAt: "2026-02-01" },
    ],
    [{ id: "order", quantity: 6, locked: false, current: [] }],
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.allocations[0], {
    partyId: "order",
    takes: [{ layerId: "b", supplierId: "supplier-b", quantity: 6 }],
    split: false,
  })
})

test("splits across the fewest suppliers only when no supplier can cover", () => {
  const result = planInventoryAllocations(
    [
      { id: "a", supplierId: "supplier-a", available: 3, receivedAt: "2026-01-01" },
      { id: "b", supplierId: "supplier-b", available: 2, receivedAt: "2026-02-01" },
      { id: "c", supplierId: "supplier-c", available: 1, receivedAt: "2026-03-01" },
    ],
    [{ id: "order", quantity: 5, locked: false, current: [] }],
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.allocations[0]?.takes, [
    { layerId: "a", supplierId: "supplier-a", quantity: 3 },
    { layerId: "b", supplierId: "supplier-b", quantity: 2 },
  ])
  assert.equal(result.allocations[0]?.split, true)
})

test("rearranges unlocked parties so both can stay on one supplier", () => {
  const result = planInventoryAllocations(
    [
      { id: "a", supplierId: "supplier-a", available: 4, receivedAt: "2026-01-01" },
      { id: "b", supplierId: "supplier-b", available: 6, receivedAt: "2026-02-01" },
    ],
    [
      {
        id: "existing",
        quantity: 4,
        locked: false,
        current: [{ layerId: "b", quantity: 4 }],
      },
      { id: "new", quantity: 6, locked: false, current: [] },
    ],
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.allocations.find((row) => row.partyId === "new")?.takes, [
    { layerId: "b", supplierId: "supplier-b", quantity: 6 },
  ])
  assert.deepEqual(result.allocations.find((row) => row.partyId === "existing")?.takes, [
    { layerId: "a", supplierId: "supplier-a", quantity: 4 },
  ])
})

test("never moves supplier-confirmed allocations", () => {
  const result = planInventoryAllocations(
    [
      { id: "a", supplierId: "supplier-a", available: 4, receivedAt: "2026-01-01" },
      { id: "b", supplierId: "supplier-b", available: 6, receivedAt: "2026-02-01" },
    ],
    [
      {
        id: "locked",
        quantity: 4,
        locked: true,
        current: [{ layerId: "b", quantity: 4 }],
      },
      { id: "new", quantity: 6, locked: false, current: [] },
    ],
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.allocations.find((row) => row.partyId === "locked")?.takes, [
    { layerId: "b", supplierId: "supplier-b", quantity: 4 },
  ])
  assert.equal(result.allocations.find((row) => row.partyId === "new")?.split, true)
})

test("returns the exact uncovered quantity instead of inventing stock", () => {
  const result = planInventoryAllocations(
    [{ id: "a", supplierId: "supplier-a", available: 40, receivedAt: "2026-01-01" }],
    [{ id: "historical-sales", quantity: 42, locked: false, current: [] }],
  )
  assert.deepEqual(result, { ok: false, shortage: 2 })
})

function supplierIds(result: ReturnType<typeof planInventoryAllocations>, partyId: string) {
  if (!result.ok) return []
  const takes = result.allocations.find((row) => row.partyId === partyId)?.takes ?? []
  return [...new Set(takes.map((take) => take.supplierId))]
}

test("keeps the newer large party whole and only splits the older leftover", () => {
  const result = planInventoryAllocations(
    [
      { id: "bam", supplierId: "BAM", available: 17, receivedAt: "2026-01-01" },
      { id: "f1", supplierId: "F1", available: 40, receivedAt: "2026-01-02" },
      { id: "go", supplierId: "Go Privilege", available: 6, receivedAt: "2026-01-03" },
      { id: "gp", supplierId: "Grand Prix", available: 12, receivedAt: "2026-01-04" },
      { id: "staff", supplierId: "Staff", available: 20, receivedAt: "2026-01-05" },
    ],
    [
      { id: "dl8382", quantity: 29, locked: false, current: [] },
      { id: "dl8383", quantity: 3, locked: false, current: [] },
      { id: "dl8384", quantity: 4, locked: false, current: [] },
      { id: "dl8385", quantity: 3, locked: false, current: [] },
      { id: "dl8386", quantity: 10, locked: false, current: [] },
      { id: "dl8387", quantity: 2, locked: false, current: [] },
      { id: "dl8388", quantity: 25, locked: false, current: [] },
    ],
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.allocations.filter((row) => row.split).length, 1)
  assert.equal(result.allocations.find((row) => row.partyId === "dl8388")?.split, false)
  assert.deepEqual(supplierIds(result, "dl8388"), ["F1"])
  assert.equal(result.allocations.find((row) => row.partyId === "dl8384")?.split, false)
  assert.equal(result.allocations.find((row) => row.partyId === "dl8382")?.split, true)
  assert.equal(supplierIds(result, "dl8382").length, 2)
})

test("does not nibble three leftover pools when two suppliers can cover a split", () => {
  const result = planInventoryAllocations(
    [
      { id: "staff", supplierId: "Staff", available: 20, receivedAt: "2026-01-01" },
      { id: "gp", supplierId: "Grand Prix", available: 12, receivedAt: "2026-01-02" },
      { id: "go", supplierId: "Go Privilege", available: 6, receivedAt: "2026-01-03" },
    ],
    [{ id: "party", quantity: 29, locked: false, current: [] }],
  )
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.allocations[0]?.takes, [
    { layerId: "staff", supplierId: "Staff", quantity: 20 },
    { layerId: "gp", supplierId: "Grand Prix", quantity: 9 },
  ])
})
