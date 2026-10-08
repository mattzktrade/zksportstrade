import assert from "node:assert/strict"
import { test } from "node:test"
import {
  planSupplierAssignmentCogs,
  saleProfitFromCogs,
} from "../lib/inventory/supplier-assignment-cogs"
import { planSupplierAssignments } from "../lib/inventory/supplier-assignment-plan"

function layer(
  id: string,
  quantity: number,
  unit_cost: number,
  supplier_id: string,
  received_at = "2026-01-01T00:00:00Z",
) {
  return { id, quantity, unit_cost, received_at, supplier_id, source: supplier_id }
}

test("a fully assigned sale uses that supplier's buy price", () => {
  const plan = planSupplierAssignments({
    pools: [
      {
        key: "id:f1",
        name: "F1 Experiences",
        purchased: 10,
        targetCapacity: 10,
        capacityBySlot: {},
      },
    ],
    demands: [
      {
        id: "line-a",
        dealId: "deal-a",
        dealReference: "DL8154",
        createdAt: "2026-08-12T11:51:00Z",
        quantity: 4,
        coverable: 4,
        slots: ["unit"],
      },
    ],
  })
  const cogs = planSupplierAssignmentCogs({
    plan,
    sales: [
      {
        id: "deal-a",
        lineIds: ["line-a"],
        createdAt: "2026-08-12T11:51:00Z",
        reference: "DL8154",
      },
    ],
    layers: [layer("l1", 10, 2500, "f1")],
  })
  assert.equal(cogs.get("deal-a"), 10000)
  assert.deepEqual(saleProfitFromCogs(19200, 10000), {
    cogs: 10000,
    profit: 9200,
    margin: 9200 / 19200,
  })
})

test("an unassigned last-added sale has no COGS", () => {
  const plan = planSupplierAssignments({
    pools: [
      {
        key: "id:f1",
        name: "F1 Experiences",
        purchased: 10,
        targetCapacity: 10,
        capacityBySlot: {},
      },
    ],
    demands: [
      {
        id: "old",
        dealId: "old",
        dealReference: "DL0100",
        createdAt: "2026-08-01T00:00:00Z",
        quantity: 10,
        coverable: 10,
        slots: ["unit"],
      },
      {
        id: "new",
        dealId: "new",
        dealReference: "DL0101",
        createdAt: "2026-09-20T00:00:00Z",
        quantity: 3,
        coverable: 0,
        slots: ["unit"],
      },
    ],
  })
  const cogs = planSupplierAssignmentCogs({
    plan,
    sales: [
      { id: "old", lineIds: ["old"], createdAt: "2026-08-01T00:00:00Z", reference: "DL0100" },
      { id: "new", lineIds: ["new"], createdAt: "2026-09-20T00:00:00Z", reference: "DL0101" },
    ],
    layers: [layer("l1", 10, 2500, "f1")],
  })
  assert.equal(cogs.get("old"), 25000)
  assert.equal(cogs.get("new"), null)
})

test("a split sale costs each supplier slice and FIFO is consumed oldest-first", () => {
  const plan = planSupplierAssignments({
    pools: [
      {
        key: "id:cor",
        name: "Corinthian Sports",
        purchased: 10,
        targetCapacity: 10,
        capacityBySlot: {},
      },
      {
        key: "id:exp",
        name: "F1 Experiences",
        purchased: 10,
        targetCapacity: 10,
        capacityBySlot: {},
      },
    ],
    demands: [
      {
        id: "small",
        dealId: "small",
        dealReference: "DL8154",
        createdAt: "2026-08-12T11:51:00Z",
        quantity: 4,
        coverable: 4,
        slots: ["unit"],
      },
      {
        id: "big",
        dealId: "big",
        dealReference: "DL8330",
        createdAt: "2026-08-12T11:51:00Z",
        quantity: 14,
        coverable: 14,
        slots: ["unit"],
      },
      {
        id: "tiny",
        dealId: "tiny",
        dealReference: "DL8289",
        createdAt: "2026-08-12T11:51:00Z",
        quantity: 2,
        coverable: 2,
        slots: ["unit"],
      },
    ],
  })
  const cogs = planSupplierAssignmentCogs({
    plan,
    sales: [
      { id: "small", lineIds: ["small"], createdAt: "2026-08-12T11:51:00Z", reference: "DL8154" },
      { id: "tiny", lineIds: ["tiny"], createdAt: "2026-08-12T11:51:00Z", reference: "DL8289" },
      { id: "big", lineIds: ["big"], createdAt: "2026-08-12T11:51:00Z", reference: "DL8330" },
    ],
    layers: [layer("cor", 10, 6000, "cor"), layer("exp", 10, 2500, "exp")],
  })
  assert.equal(cogs.get("small") != null, true)
  assert.equal(cogs.get("tiny") != null, true)
  assert.equal(cogs.get("big") != null, true)
  const total =
    (cogs.get("small") ?? 0) + (cogs.get("tiny") ?? 0) + (cogs.get("big") ?? 0)
  assert.equal(total, 10 * 6000 + 10 * 2500)
})

test("changing the assigned supplier changes COGS immediately", () => {
  const layers = [layer("f1", 5, 2000, "f1"), layer("go", 5, 5000, "go")]
  const sale = {
    id: "line",
    dealId: "deal",
    dealReference: "DL0001",
    createdAt: "2026-08-01T00:00:00Z",
    quantity: 5,
    coverable: 5,
    slots: ["unit"] as const,
  }
  const f1 = planSupplierAssignments({
    pools: [
      { key: "id:f1", name: "F1", purchased: 5, targetCapacity: 5, capacityBySlot: {} },
      { key: "id:go", name: "Go", purchased: 5, targetCapacity: 5, capacityBySlot: {} },
    ],
    demands: [{ ...sale, pinnedKey: "id:f1" }],
  })
  const go = planSupplierAssignments({
    pools: [
      { key: "id:f1", name: "F1", purchased: 5, targetCapacity: 5, capacityBySlot: {} },
      { key: "id:go", name: "Go", purchased: 5, targetCapacity: 5, capacityBySlot: {} },
    ],
    demands: [{ ...sale, pinnedKey: "id:go" }],
  })
  const sales = [
    { id: "deal", lineIds: ["line"], createdAt: "2026-08-01T00:00:00Z", reference: "DL0001" },
  ]
  assert.equal(planSupplierAssignmentCogs({ plan: f1, sales, layers }).get("deal"), 10000)
  assert.equal(planSupplierAssignmentCogs({ plan: go, sales, layers }).get("deal"), 25000)
})

test("a 2-day buy sold as individual days uses each day's cost split", () => {
  const plan = planSupplierAssignments({
    pools: [
      {
        key: "id:bam",
        name: "BAM Motorsport",
        purchased: 2,
        targetCapacity: 2,
        capacityBySlot: { saturday: 2, sunday: 2 },
      },
    ],
    demands: [
      {
        id: "sat",
        dealId: "deal-sat",
        dealReference: "DL1481",
        createdAt: "2026-10-05T17:18:00Z",
        quantity: 2,
        coverable: 2,
        slots: ["saturday"],
      },
      {
        id: "sun",
        dealId: "deal-sun",
        dealReference: "DL1441",
        createdAt: "2026-10-06T03:42:00Z",
        quantity: 2,
        coverable: 2,
        slots: ["sunday"],
      },
    ],
  })
  const cogs = planSupplierAssignmentCogs({
    plan,
    sales: [
      { id: "deal-sat", lineIds: ["sat"], createdAt: "2026-10-05T17:18:00Z", reference: "DL1481" },
      { id: "deal-sun", lineIds: ["sun"], createdAt: "2026-10-06T03:42:00Z", reference: "DL1441" },
    ],
    layers: [
      {
        id: "l1",
        quantity: 2,
        unit_cost: 11365,
        received_at: "2026-01-01T00:00:00Z",
        supplier_id: "bam",
        day_components: [
          { day_slot: "saturday", quantity_total: 2, unit_cost_component: 5682.5 },
          { day_slot: "sunday", quantity_total: 2, unit_cost_component: 5682.5 },
        ],
      },
    ],
  })
  assert.equal(cogs.get("deal-sat"), 11365)
  assert.equal(cogs.get("deal-sun"), 11365)
})

test("a 2-day sale costs both day components of the same buy", () => {
  const plan = planSupplierAssignments({
    pools: [
      {
        key: "id:bam",
        name: "BAM Motorsport",
        purchased: 2,
        targetCapacity: 2,
        capacityBySlot: { saturday: 2, sunday: 2 },
      },
    ],
    demands: [
      {
        id: "weekend",
        dealId: "deal-weekend",
        dealReference: "DL0880",
        createdAt: "2026-09-28T16:03:00Z",
        quantity: 1,
        coverable: 1,
        slots: ["saturday", "sunday"],
      },
      {
        id: "sat",
        dealId: "deal-sat",
        dealReference: "DL1481",
        createdAt: "2026-10-05T17:18:00Z",
        quantity: 1,
        coverable: 1,
        slots: ["saturday"],
      },
    ],
  })
  const cogs = planSupplierAssignmentCogs({
    plan,
    sales: [
      { id: "deal-weekend", lineIds: ["weekend"], createdAt: "2026-09-28T16:03:00Z" },
      { id: "deal-sat", lineIds: ["sat"], createdAt: "2026-10-05T17:18:00Z" },
    ],
    layers: [
      {
        id: "l1",
        quantity: 2,
        unit_cost: 11365,
        received_at: "2026-01-01T00:00:00Z",
        supplier_id: "bam",
        day_components: [
          { day_slot: "saturday", quantity_total: 2, cost_weight: 0.5 },
          { day_slot: "sunday", quantity_total: 2, cost_weight: 0.5 },
        ],
      },
    ],
  })
  assert.equal(cogs.get("deal-weekend"), 11365)
  assert.equal(cogs.get("deal-sat"), 5682.5)
})
