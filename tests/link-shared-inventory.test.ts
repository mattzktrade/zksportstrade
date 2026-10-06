import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import {
  canLinkSharedInventory,
  joiningQtyAfterShare,
  mapLinkSharedInventoryError,
  resolveLinkSharedInventoryRoles,
} from "../lib/inventory/link-shared-inventory"

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261006120000_admin_link_package_shared_inventory.sql",
    import.meta.url,
  ),
  "utf8",
)

test("Saturday remaining after sharing 2-day stock accounts for the confirmed Saturday sale", () => {
  assert.equal(
    joiningQtyAfterShare({ sourceAvailable: 2, joiningSold: 2, joiningHeld: 0 }),
    0,
  )
  assert.equal(
    joiningQtyAfterShare({ sourceAvailable: 2, joiningSold: 0, joiningHeld: 0 }),
    2,
  )
  assert.equal(
    joiningQtyAfterShare({ sourceAvailable: 2, joiningSold: 4, joiningHeld: 0 }),
    0,
  )
})

test("the day product joins the weekend product even if you start from the 2-day page", () => {
  assert.equal(canLinkSharedInventory("saturday_only", "2_day"), true)
  assert.equal(canLinkSharedInventory("2_day", "3_day"), true)
  assert.equal(canLinkSharedInventory("saturday_only", ""), false)
  assert.deepEqual(
    resolveLinkSharedInventoryRoles({
      currentId: "sat",
      currentDuration: "saturday_only",
      selectedId: "weekend",
      selectedDuration: "2_day",
    }),
    { joiningId: "sat", shareWithId: "weekend" },
  )
  assert.deepEqual(
    resolveLinkSharedInventoryRoles({
      currentId: "weekend",
      currentDuration: "2_day",
      selectedId: "sat",
      selectedDuration: "saturday_only",
    }),
    { joiningId: "sat", shareWithId: "weekend" },
  )
})

test("link action keeps confirmed deals and drops the attached product's own purchases", () => {
  assert.match(migration, /create or replace function public.admin_link_package_shared_inventory/)
  assert.match(migration, /inventory_release_allocations/)
  assert.match(migration, /admin_delete_cost_layer/)
  assert.match(migration, /inventory_rebalance_linked_day_coverage/)
  assert.match(migration, /link_inventory_fulfilment_locked/)
  assert.match(migration, /greatest\(v_joining_held, v_source_qty - v_joining_sold\)/)
  assert.match(migration, /parent.duration in \('3_day', '2_day'\)/)
  assert.match(migration, /The weekend product keeps purchased stock/)
})

test("staff see a clear error when fulfilment-locked stock cannot move", () => {
  assert.equal(
    mapLinkSharedInventoryError("link_inventory_fulfilment_locked"),
    "A fulfilled or locked allocation is still on this product's own stock, so it cannot be moved yet.",
  )
  assert.equal(
    mapLinkSharedInventoryError("link_inventory_different_race"),
    "Those products are for different events, so they cannot share stock.",
  )
})
