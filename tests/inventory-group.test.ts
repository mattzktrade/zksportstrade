import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  deriveInventoryGroupId,
  inventoryGroupMatchesRace,
  inventoryGroupRaceId,
  leadingRaceIdFromSlug,
  resolveInventoryGroupId,
  retargetInventoryGroupToRace,
} from "../lib/catalog/inventory-group"

test("inventory keys keep the product stem when the package is created on the right race", () => {
  assert.equal(
    deriveInventoryGroupId(
      "abu-dhabi-2026-3-day-paddock-club-mercedes",
      "3_day",
      "abu-dhabi-2026",
    ),
    "abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes",
  )
})

test("deriving a key after the race changed rewrites an Australia package id onto the new race", () => {
  assert.equal(
    deriveInventoryGroupId(
      "australia-2026-3-day-paddock-club-mercedes",
      "3_day",
      "abu-dhabi-2026",
    ),
    "abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes",
  )
})

test("older year-suffix package ids keep their stem when the race already matches", () => {
  assert.equal(
    deriveInventoryGroupId(
      "hungary-paddock-club-club-suite-f1-2026",
      "3_day",
      "hungary-2026",
    ),
    "hungary-2026/hungary-paddock-club-club-suite-f1",
  )
})

test("retargeting an Australia key onto Abu Dhabi keeps the Mercedes product stem", () => {
  assert.equal(
    retargetInventoryGroupToRace(
      "australia-2026/australia-2026-paddock-club-mercedes",
      "abu-dhabi-2026",
    ),
    "abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes",
  )
  assert.equal(inventoryGroupRaceId("australia-2026/australia-2026-paddock-club-mercedes"), "australia-2026")
  assert.equal(leadingRaceIdFromSlug("abu-dhabi-2026-paddock-club-mercedes"), "abu-dhabi-2026")
  assert.equal(
    inventoryGroupMatchesRace("australia-2026/australia-2026-paddock-club-mercedes", "abu-dhabi-2026"),
    false,
  )
  assert.equal(
    inventoryGroupMatchesRace("abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes", "abu-dhabi-2026"),
    true,
  )
})

test("saving a package whose key still points at another race rewrites it", () => {
  assert.equal(
    resolveInventoryGroupId({
      packageId: "australia-2026-3-day-paddock-club-mercedes",
      duration: "3_day",
      raceId: "abu-dhabi-2026",
      manualGroupId: "australia-2026/australia-2026-paddock-club-mercedes",
    }),
    "abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes",
  )
})

test("same-race custom keys are kept so Saturday can join an existing 3-day group", () => {
  assert.equal(
    resolveInventoryGroupId({
      packageId: "abu-dhabi-2026-saturday-mercedes-club",
      duration: "saturday_only",
      raceId: "abu-dhabi-2026",
      manualGroupId: "abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes",
    }),
    "abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes",
  )
})

test("standalone day packages do not keep a linked key", () => {
  assert.equal(
    resolveInventoryGroupId({
      packageId: "abu-dhabi-2026-saturday-mercedes-club",
      duration: "saturday_only",
      raceId: "abu-dhabi-2026",
      inventoryIsStandalone: true,
      manualGroupId: "abu-dhabi-2026/abu-dhabi-2026-paddock-club-mercedes",
    }),
    null,
  )
})

test("slash-less custom keys without a race year are left as staff typed them", () => {
  assert.equal(
    resolveInventoryGroupId({
      packageId: "singapore-velocity-terrace-2026",
      duration: "3_day",
      raceId: "singapore-2026",
      manualGroupId: "singapore-velocity",
    }),
    "singapore-velocity",
  )
})

test("new product form requires an explicit race instead of defaulting to Australia", () => {
  const src = readFileSync("app/(admin)/admin/catalog/catalog-new-package.tsx", "utf8")
  assert.match(src, /const \[raceId, setRaceId\] = useState\(""\)/)
  assert.match(src, /Select a race/)
  assert.doesNotMatch(src, /useState\(races\[0\]\?\.id/)
  assert.match(src, /raceId && raceId !== NEW_EVENT_ID \? raceId : savedRaceId/)
})

test("package details retarget the linked inventory key when the race changes", () => {
  const panel = readFileSync("components/admin/package-admin-panel.tsx", "utf8")
  assert.match(panel, /resolveInventoryGroupId/)
  assert.match(panel, /This product still shares stock with/)
  const actions = readFileSync("app/(admin)/actions.ts", "utf8")
  assert.match(actions, /resolveInventoryGroupId/)
  assert.match(actions, /stuckSiblings/)
})
