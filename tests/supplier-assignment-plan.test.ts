import assert from "node:assert/strict"
import { test } from "node:test"
import {
  assignmentForLines,
  planSupplierAssignments,
  type SupplierAssignmentDemand,
  type SupplierAssignmentPool,
} from "../lib/inventory/supplier-assignment-plan"

function pool(
  key: string,
  name: string,
  capacity: number,
  slots: Record<string, number> = {},
): SupplierAssignmentPool {
  return {
    key,
    name,
    purchased: capacity,
    targetCapacity: capacity,
    capacityBySlot: slots,
  }
}

function demand(
  partial: Partial<SupplierAssignmentDemand> & Pick<SupplierAssignmentDemand, "id" | "quantity">,
): SupplierAssignmentDemand {
  return {
    dealReference: null,
    createdAt: "2026-01-01T00:00:00Z",
    coverable: partial.quantity,
    slots: ["unit"],
    ...partial,
  }
}

test("lowest DL number is filled first only when two deals were added at the same time", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 3)],
    demands: [
      demand({ id: "new", quantity: 1, dealReference: "DL0692" }),
      demand({ id: "old", quantity: 3, dealReference: "DL0410" }),
    ],
  })
  assert.equal(plan.byLine.get("old")?.assigned, 3)
  assert.equal(plan.byLine.get("new")?.assigned, 0)
  assert.equal(plan.byLine.get("new")?.needStock, true)
  assert.equal(plan.remainingByPool["id:f1"], 0)
})

test("a deal stays on one supplier when that supplier can take the whole order", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 10), pool("id:vip", "VIP Events Team LLC", 4)],
    demands: [
      demand({ id: "a", quantity: 4, dealReference: "DL0100" }),
      demand({ id: "b", quantity: 10, dealReference: "DL0101" }),
    ],
  })
  assert.equal(plan.byLine.get("a")?.singleKey, "id:vip")
  assert.equal(plan.byLine.get("b")?.singleKey, "id:f1")
  assert.equal(plan.remainingByPool["id:f1"], 0)
  assert.equal(plan.remainingByPool["id:vip"], 0)
})

test("best-fit keeps a larger pool for a later larger booking", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 10), pool("id:go", "Go Privilege", 3)],
    demands: [
      demand({ id: "small", quantity: 3, dealReference: "DL0001" }),
      demand({ id: "large", quantity: 10, dealReference: "DL0002" }),
    ],
  })
  assert.equal(plan.byLine.get("small")?.singleKey, "id:go")
  assert.equal(plan.byLine.get("large")?.singleKey, "id:f1")
})

test("splits only when no single supplier can take the whole leftover", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:a", "A", 2), pool("id:b", "B", 2)],
    demands: [demand({ id: "four", quantity: 4, dealReference: "DL0001" })],
  })
  const row = plan.byLine.get("four")
  assert.equal(row?.assigned, 4)
  assert.equal(row?.singleKey, null)
  assert.equal(row?.slices.length, 2)
  assert.deepEqual(
    row?.slices.map((slice) => slice.quantity).sort(),
    [2, 2],
  )
})

test("never assigns more than a supplier bought, so remainings stay at zero or above", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:exp", "F1 Experiences", 1), pool("id:f1", "F1", 2)],
    demands: [demand({ id: "three", quantity: 4, dealReference: "DL0001" })],
  })
  assert.equal(plan.assignedByPool["id:exp"], 1)
  assert.equal(plan.assignedByPool["id:f1"], 2)
  assert.equal(plan.remainingByPool["id:exp"], 0)
  assert.equal(plan.remainingByPool["id:f1"], 0)
  assert.equal(plan.byLine.get("three")?.unassigned, 1)
  assert.ok(Object.values(plan.remainingByPool).every((value) => value >= 0))
})

test("coverable zero leaves the newest extra place blank", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 3)],
    demands: [
      demand({ id: "vip", quantity: 3, coverable: 3, dealReference: "DL0410" }),
      demand({ id: "exclusive", quantity: 1, coverable: 0, dealReference: "DL0692" }),
    ],
  })
  assert.equal(plan.byLine.get("vip")?.assigned, 3)
  assert.equal(plan.byLine.get("exclusive")?.assigned, 0)
  assert.equal(plan.byLine.get("exclusive")?.needStock, true)
  assert.equal(plan.byLine.get("exclusive")?.slices.length, 0)
})

test("a pin takes that supplier when it still fits after older DLs", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 5), pool("id:go", "Go Privilege", 3)],
    demands: [
      demand({ id: "old", quantity: 3, dealReference: "DL0001", preferredKey: "id:f1" }),
      demand({
        id: "pinned",
        quantity: 3,
        dealReference: "DL0002",
        pinnedKey: "id:go",
      }),
    ],
  })
  assert.equal(plan.byLine.get("old")?.singleKey, "id:f1")
  assert.equal(plan.byLine.get("pinned")?.singleKey, "id:go")
})

test("a newer pin cannot steal stock already given to a lower DL", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 3)],
    demands: [
      demand({ id: "old", quantity: 3, dealReference: "DL0001" }),
      demand({
        id: "new",
        quantity: 3,
        dealReference: "DL0099",
        pinnedKey: "id:f1",
      }),
    ],
  })
  assert.equal(plan.byLine.get("old")?.assigned, 3)
  assert.equal(plan.byLine.get("new")?.assigned, 0)
})

test("stored preference is used only when that supplier can still take the whole deal", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 2), pool("id:go", "Go Privilege", 5)],
    demands: [
      demand({
        id: "pref",
        quantity: 5,
        dealReference: "DL0001",
        preferredKey: "id:f1",
      }),
    ],
  })
  assert.equal(plan.byLine.get("pref")?.singleKey, "id:go")
})

test("empty pools leave every sale unassigned", () => {
  const plan = planSupplierAssignments({
    pools: [],
    demands: [demand({ id: "a", quantity: 2, dealReference: "DL0001" })],
  })
  assert.equal(plan.byLine.get("a")?.unassigned, 2)
})

test("3-day places only consume a supplier's tightest day", () => {
  const plan = planSupplierAssignments({
    pools: [
      pool("id:f1", "F1", 10, { friday: 10, saturday: 4, sunday: 4 }),
    ],
    demands: [
      demand({
        id: "weekend",
        quantity: 5,
        slots: ["friday", "saturday", "sunday"],
        dealReference: "DL0001",
      }),
    ],
  })
  assert.equal(plan.byLine.get("weekend")?.assigned, 4)
  assert.equal(plan.byLine.get("weekend")?.unassigned, 1)
})

test("assignmentForLines rolls a deal's lines up and flags leftover stock needed", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 2)],
    demands: [
      demand({ id: "l1", quantity: 1, dealReference: "DL0001" }),
      demand({ id: "l2", quantity: 2, dealReference: "DL0001" }),
    ],
  })
  const rolled = assignmentForLines(plan, ["l1", "l2"])
  assert.equal(rolled.assigned, 2)
  assert.equal(rolled.unassigned, 1)
  assert.equal(rolled.needStock, true)
})

test("lines on the same deal stay on one supplier when that supplier can take the whole order", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 10), pool("id:go", "Go Privilege", 4)],
    demands: [
      demand({ id: "l1", quantity: 3, dealId: "deal-a", dealReference: "DL0001" }),
      demand({ id: "l2", quantity: 4, dealId: "deal-a", dealReference: "DL0001" }),
    ],
  })
  assert.equal(plan.byLine.get("l1")?.singleKey, "id:f1")
  assert.equal(plan.byLine.get("l2")?.singleKey, "id:f1")
  assert.equal(plan.remainingByPool["id:f1"], 3)
  assert.equal(plan.remainingByPool["id:go"], 4)
})

test("leftover after a lower DL is used by the next deal instead of sitting idle", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 5), pool("id:exp", "F1 Experiences", 1)],
    demands: [
      demand({ id: "old", quantity: 4, dealReference: "DL0001" }),
      demand({ id: "new", quantity: 1, dealReference: "DL0002" }),
    ],
  })
  assert.equal(plan.byLine.get("old")?.singleKey, "id:f1")
  assert.equal(plan.byLine.get("new")?.singleKey, "id:exp")
  assert.equal(plan.remainingByPool["id:f1"], 1)
  assert.equal(plan.remainingByPool["id:exp"], 0)
})

test("pinning an older deal onto another supplier frees stock for a newer deal", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 5), pool("id:go", "Go Privilege", 5)],
    demands: [
      demand({
        id: "old",
        quantity: 5,
        dealReference: "DL0001",
        pinnedKey: "id:go",
      }),
      demand({ id: "new", quantity: 5, dealReference: "DL0002" }),
    ],
  })
  assert.equal(plan.byLine.get("old")?.singleKey, "id:go")
  assert.equal(plan.byLine.get("new")?.singleKey, "id:f1")
})

test("overselling never assigns more than was bought and leaves the shortfall blank", () => {
  const plan = planSupplierAssignments({
    pools: [
      pool("id:exp", "F1 Experiences", 1),
      pool("id:f1", "F1", 2),
      pool("id:go", "Go Privilege", 1),
    ],
    demands: [
      demand({ id: "a", quantity: 2, dealReference: "DL0001" }),
      demand({ id: "b", quantity: 2, dealReference: "DL0002" }),
      demand({ id: "c", quantity: 2, dealReference: "DL0003" }),
    ],
  })
  assert.equal(plan.assignedByPool["id:exp"], 1)
  assert.equal(plan.assignedByPool["id:f1"], 2)
  assert.equal(plan.assignedByPool["id:go"], 1)
  assert.ok(Object.values(plan.remainingByPool).every((value) => value >= 0))
  assert.equal(plan.byLine.get("a")?.assigned, 2)
  assert.equal(plan.byLine.get("b")?.assigned, 2)
  assert.equal(plan.byLine.get("c")?.assigned, 0)
  assert.equal(plan.byLine.get("c")?.needStock, true)
  assert.equal(plan.byLine.get("c")?.slices.length, 0)
})

test("coverable caps assignment so leftover purchased seats are not put on an uncovered sale", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 5)],
    demands: [
      demand({ id: "covered", quantity: 4, coverable: 4, dealReference: "DL0001" }),
      demand({ id: "extra", quantity: 1, coverable: 0, dealReference: "DL0099" }),
    ],
  })
  assert.equal(plan.byLine.get("covered")?.assigned, 4)
  assert.equal(plan.byLine.get("extra")?.assigned, 0)
  assert.equal(plan.remainingByPool["id:f1"], 1)
})

test("unknown pin keys are ignored and the deal is still filled from real pools", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 3)],
    demands: [
      demand({
        id: "a",
        quantity: 3,
        dealReference: "DL0001",
        pinnedKey: "id:missing",
      }),
    ],
  })
  assert.equal(plan.byLine.get("a")?.singleKey, "id:f1")
})

test("saturday and sunday sales from a two-day buy count as peak day assigned", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:bam", "BAM Motorsport", 2, { saturday: 2, sunday: 2 })],
    demands: [
      demand({
        id: "sat",
        quantity: 2,
        slots: ["saturday"],
        dealReference: "DL1401",
        createdAt: "2026-10-05T00:00:00Z",
      }),
      demand({
        id: "sun",
        quantity: 2,
        slots: ["sunday"],
        dealReference: "DL1441",
        createdAt: "2026-10-06T00:00:00Z",
      }),
    ],
  })
  assert.equal(plan.byLine.get("sat")?.assigned, 2)
  assert.equal(plan.byLine.get("sun")?.assigned, 2)
  assert.equal(plan.assignedByPool["id:bam"], 2)
  assert.equal(plan.remainingByPool["id:bam"], 0)
})

test("held portal stock is reserved before signed deals are filled", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 4)],
    holds: [{ key: "id:f1", slots: ["unit"], quantity: 2 }],
    demands: [demand({ id: "deal", quantity: 3, dealReference: "DL0001" })],
  })
  assert.equal(plan.byLine.get("deal")?.assigned, 2)
  assert.equal(plan.byLine.get("deal")?.unassigned, 1)
  assert.equal(plan.assignedByPool["id:f1"], 4)
  assert.equal(plan.remainingByPool["id:f1"], 0)
})

test("a split uses leftover from every supplier and still never goes negative", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:a", "A", 1), pool("id:b", "B", 1), pool("id:c", "C", 1)],
    demands: [demand({ id: "three", quantity: 3, dealReference: "DL0001" })],
  })
  assert.equal(plan.byLine.get("three")?.assigned, 3)
  assert.equal(plan.byLine.get("three")?.singleKey, null)
  assert.equal(plan.byLine.get("three")?.slices.length, 3)
  assert.ok(Object.values(plan.remainingByPool).every((value) => value === 0))
})

test("a mixed supplier list never over-assigns a small buy while another supplier still has leftover", () => {
  const plan = planSupplierAssignments({
    pools: [
      pool("id:f1", "F1", 30),
      pool("id:exp", "F1 Experiences", 1),
      pool("id:go", "Go Privilege", 3),
      pool("id:vip", "VIP Events Team LLC", 4),
    ],
    demands: [
      demand({ id: "old-big", quantity: 10, dealReference: "DL0425" }),
      demand({ id: "vip-2", quantity: 2, dealReference: "DL0410" }),
      demand({ id: "go-2", quantity: 2, dealReference: "DL0427" }),
      demand({ id: "staff", quantity: 4, dealReference: "DL0435" }),
      demand({ id: "mid", quantity: 20, dealReference: "DL0592" }),
      demand({ id: "exclusive", quantity: 1, coverable: 0, dealReference: "DL0692" }),
    ],
  })
  assert.ok(plan.assignedByPool["id:exp"] <= 1)
  assert.ok(plan.assignedByPool["id:f1"] <= 30)
  assert.ok(plan.assignedByPool["id:go"] <= 3)
  assert.ok(plan.assignedByPool["id:vip"] <= 4)
  assert.ok(Object.values(plan.remainingByPool).every((value) => value >= 0))
  assert.equal(plan.byLine.get("exclusive")?.assigned, 0)
  assert.equal(plan.byLine.get("exclusive")?.needStock, true)
  assert.equal(plan.byLine.get("exclusive")?.slices.length, 0)
})

test("a later sale with a lower DL does not take stock from earlier bookings", () => {
  const plan = planSupplierAssignments({
    pools: [
      pool("id:cor", "Corinthian Sports", 10),
      pool("id:exp", "F1 Experiences", 10),
    ],
    demands: [
      demand({
        id: "sportfive",
        quantity: 4,
        dealId: "d8154",
        dealReference: "DL8154",
        createdAt: "2026-08-12T11:51:00Z",
      }),
      demand({
        id: "andres",
        quantity: 2,
        dealId: "d8289",
        dealReference: "DL8289",
        createdAt: "2026-08-12T11:51:00Z",
      }),
      demand({
        id: "roi",
        quantity: 14,
        dealId: "d8330",
        dealReference: "DL8330",
        createdAt: "2026-08-12T11:51:00Z",
      }),
      demand({
        id: "vedere",
        quantity: 3,
        dealId: "d8480",
        dealReference: "DL8480",
        createdAt: "2026-09-16T06:35:00Z",
      }),
      demand({
        id: "adrian",
        quantity: 3,
        dealId: "d8036",
        dealReference: "DL8036",
        createdAt: "2026-09-20T12:23:00Z",
      }),
    ],
  })
  assert.equal(plan.byLine.get("sportfive")?.assigned, 4)
  assert.equal(plan.byLine.get("andres")?.assigned, 2)
  assert.equal(plan.byLine.get("roi")?.assigned, 14)
  assert.equal(plan.byLine.get("vedere")?.assigned, 0)
  assert.equal(plan.byLine.get("adrian")?.assigned, 0)
  assert.equal(plan.byLine.get("vedere")?.needStock, true)
  assert.equal(plan.byLine.get("adrian")?.needStock, true)
  assert.equal(plan.byLine.get("vedere")?.slices.length, 0)
  assert.equal(plan.byLine.get("adrian")?.slices.length, 0)
  assert.ok((plan.assignedByPool["id:exp"] ?? 0) <= 10)
  assert.ok((plan.assignedByPool["id:cor"] ?? 0) <= 10)
  assert.ok(Object.values(plan.remainingByPool).every((value) => value >= 0))
  assert.equal(
    (plan.remainingByPool["id:exp"] ?? 0) + (plan.remainingByPool["id:cor"] ?? 0),
    0,
  )
})

test("zero-quantity and empty-coverable lines do not consume stock", () => {
  const plan = planSupplierAssignments({
    pools: [pool("id:f1", "F1", 2)],
    demands: [
      demand({ id: "zero", quantity: 0, dealReference: "DL0001" }),
      demand({ id: "blank", quantity: 2, coverable: 0, dealReference: "DL0002" }),
      demand({ id: "real", quantity: 2, dealReference: "DL0003" }),
    ],
  })
  assert.equal(plan.byLine.get("zero")?.assigned, 0)
  assert.equal(plan.byLine.get("blank")?.assigned, 0)
  assert.equal(plan.byLine.get("real")?.assigned, 2)
})
