import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { generateNextSeasonRaces } from "../lib/catalog/generate-next-season-catalog"
import {
  F1_CIRCUIT_NAMES,
  eventSharedFieldsChanged,
  officialCircuitNameForRaceId,
  packageEventDefaultsFromRace,
  resolvePackageCircuitInput,
  resolveRaceCircuit,
  isMissingRaceCircuitColumnError,
} from "../lib/catalog/race-circuit"
import { packages2027PaddockEnquire } from "../lib/seed-data/packages-2027-paddock"
import { races2026 } from "../lib/seed-data"

test("F1 race ids map to the real circuit, not the Grand Prix title", () => {
  assert.equal(officialCircuitNameForRaceId("australia-2026"), "Albert Park Circuit")
  assert.equal(officialCircuitNameForRaceId("australia-2027"), "Albert Park Circuit")
  assert.equal(officialCircuitNameForRaceId("bahrain-malaysia-2026"), "Sepang International Circuit")
  assert.notEqual(officialCircuitNameForRaceId("bahrain-malaysia-2026"), F1_CIRCUIT_NAMES.bahrain)
  assert.equal(officialCircuitNameForRaceId("spain-2026"), "Circuit de Barcelona-Catalunya")
  assert.equal(officialCircuitNameForRaceId("madrid-2026"), "MADRING")
  assert.equal(officialCircuitNameForRaceId("madrid-2027"), "MADRING")
  assert.equal(officialCircuitNameForRaceId("portugal-2027"), "Algarve International Circuit")
  assert.equal(officialCircuitNameForRaceId("abudhabi-2026"), "Yas Marina Circuit")
})

test("package create keeps a real circuit override and replaces the event title", () => {
  const race = {
    id: "australia-2026",
    name: "Australian Grand Prix",
    circuit: "Albert Park Circuit",
    location: "Melbourne",
  }
  assert.equal(resolvePackageCircuitInput("Australian Grand Prix", race), "Albert Park Circuit")
  assert.equal(resolvePackageCircuitInput("", race), "Albert Park Circuit")
  assert.equal(resolvePackageCircuitInput("Albert Park Circuit", race), "Albert Park Circuit")
  assert.equal(resolveRaceCircuit({ id: "china-2026", location: "Shanghai" }), "Shanghai International Circuit")
})

test("event defaults copied onto a new product include circuit, city, and dates", () => {
  const defaults = packageEventDefaultsFromRace({
    id: "britain-2026",
    name: "British Grand Prix",
    circuit: "Silverstone Circuit",
    location: "Silverstone",
    country: "United Kingdom",
    country_code: "GB",
    event_date: "2026-07-05",
    date_range: "03 - 05 Jul",
    image: "/images/circuits/silverstone.jpg",
  })
  assert.equal(defaults.circuit, "Silverstone Circuit")
  assert.equal(defaults.location, "Silverstone")
  assert.equal(defaults.countryCode, "GB")
  assert.equal(defaults.eventDate, "2026-07-05")
  assert.equal(
    eventSharedFieldsChanged(
      {
        circuit: "British Grand Prix",
        location: "Silverstone",
        country: "United Kingdom",
        country_code: "GB",
        event_date: "2026-07-05",
        date_range: "03 - 05 Jul",
      },
      defaults,
    ),
    true,
  )
})

test("seeded 2026 races and rolled-forward 2027 products use the track name", () => {
  const australia = races2026.find((race) => race.id === "australia-2026")
  assert.equal(australia?.circuit, "Albert Park Circuit")
  assert.notEqual(australia?.circuit, australia?.name)

  const barcelona = races2026.find((race) => race.id === "spain-2026")
  const spanish = races2026.find((race) => race.id === "madrid-2026")
  assert.equal(barcelona?.name, "Barcelona Grand Prix")
  assert.equal(barcelona?.circuit, "Circuit de Barcelona-Catalunya")
  assert.equal(spanish?.name, "Spanish Grand Prix")
  assert.equal(spanish?.circuit, "MADRING")

  const next = generateNextSeasonRaces(races2026, 2027)
  assert.equal(next.find((race) => race.id === "australia-2027")?.circuit, "Albert Park Circuit")
  assert.equal(next.find((race) => race.id === "madrid-2027")?.name, "Spanish Grand Prix")
  assert.equal(next.find((race) => race.id === "madrid-2027")?.circuit, "MADRING")
  assert.equal(next.find((race) => race.id === "portugal-2027")?.circuit, "Algarve International Circuit")
  assert.equal(next.find((race) => race.id === "turkey-2027")?.circuit, "Istanbul Park")

  const packages = packages2027PaddockEnquire(next)
  assert.equal(packages.find((pkg) => pkg.raceId === "australia-2027")?.circuit, "Albert Park Circuit")
})

test("new package and event forms no longer treat the GP title as the circuit", () => {
  const createSrc = readFileSync("app/(admin)/admin/catalog/catalog-new-package.tsx", "utf8")
  assert.doesNotMatch(createSrc, /Circuit \/ listing title/)
  assert.doesNotMatch(createSrc, /setCircuit\(race\.name\)/)
  assert.match(createSrc, /packageEventDefaultsFromRace/)
  assert.match(createSrc, /setCircuit\(defaults\.circuit\)/)

  const productSrc = readFileSync("components/admin/package-admin-panel.tsx", "utf8")
  assert.doesNotMatch(productSrc, /Circuit \/ listing title/)
  assert.match(productSrc, /packageEventDefaultsFromRace/)

  const eventsSrc = readFileSync("app/(admin)/admin/catalog/events/events-client.tsx", "utf8")
  assert.doesNotMatch(eventsSrc, /Location \/ circuit/)
  assert.match(eventsSrc, /copied to every product for this event/)
  assert.match(eventsSrc, /update\("circuit"/)

  const actionsSrc = readFileSync("app/(admin)/actions.ts", "utf8")
  assert.match(actionsSrc, /circuit: value.circuit/)
  assert.match(actionsSrc, /enqueueProductUpsert/)
  assert.match(actionsSrc, /eventSharedFieldsChanged/)
})

test("migration stores circuit on the event and copies it onto packages", () => {
  const sql = readFileSync("supabase/migrations/20260917140000_race_circuit.sql", "utf8")
  assert.match(sql, /add column if not exists circuit/)
  assert.match(sql, /Albert Park Circuit/)
  assert.match(sql, /bahrain-malaysia/)
  assert.match(sql, /spain-\*  = Barcelona Grand Prix/)
  assert.match(sql, /madrid-\* = Spanish Grand Prix/)
  assert.match(sql, /when 'spain' then 'Circuit de Barcelona-Catalunya'/)
  assert.match(sql, /when 'madrid' then 'MADRING'/)
  assert.doesNotMatch(sql, /MADRING Circuit/)
  assert.match(sql, /set name = 'Spanish Grand Prix'/)
  assert.match(sql, /id ~ '\^madrid-\[0-9\]\{4\}\$'/)
  assert.match(sql, /sync_packages_from_race_event_fields/)
  assert.match(sql, /after update of circuit, location, country, country_code, event_date, date_range/)
  assert.match(sql, /pkg.circuit is distinct from race.circuit/)
})

test("admin queries recognise a missing races.circuit column", () => {
  assert.equal(isMissingRaceCircuitColumnError("column races.circuit does not exist"), true)
  assert.equal(isMissingRaceCircuitColumnError("Could not generate a valid package id"), false)
})
