import assert from "node:assert/strict"
import test from "node:test"
import { formatPackageCopy } from "../lib/catalog/format-package-copy"

const CHAMPIONS_RAW = `Experience the F1® weekend at the Champion’s Club located at the Trackside Terrace offering views of Turns 5 & 6. It's three days of gourmet dining, open bar, and insider access to F1® legends.

Watch the race action, take a guided F1® Paddock tour, walk the Starting Grid, and snap a photo with the World Championship™ trophy. All this, paired with Yas Island access and After-Race Concerts!

Get ready for the F1® experience at Champion’s Club located at the Trackside Terrace! Positioned between Turns 5 & 6, this prime spot offers wide-angle and bird’s-eye views of all the race-day action, from Friday’s practice sessions to Saturday’s qualifying and Sunday season finale.

Enjoy three days of exclusive access to a Level 1 indoor suite, and a panoramic Level 7 rooftop terrace, fitted with TV screens showing live on-track feed and exclusive F1® activities. Indulge in premium hospitality with gourmet dining, delightful canapés, and free-flowing drinks at the open bar.

Get insider access to F1® – rub shoulders with the sport’s elite, from legendary drivers to team executives – and hear firsthand insights from F1®'s top personalities.

Go on a one-time guided tour of the exclusive F1® Paddock, led by expert hosts, and maybe even snap a selfie with your favorite driver.

Stroll the Starting Grid, and pose for a professional photo with the coveted Formula 1 World Championship™ trophy. This ticket includes access to a Yas Island theme park or teamLab Phenomena Abu Dhabi, general admission to the After-Race Concerts, and exciting Abu Dhabi experiences.`

test("champions club copy keeps the detailed paragraphs and lists the benefits", () => {
  const formatted = formatPackageCopy(CHAMPIONS_RAW)
  assert.match(formatted.description, /Level 1 indoor suite/)
  assert.match(formatted.description, /Level 7 rooftop terrace/)
  assert.match(formatted.description, /teamLab Phenomena Abu Dhabi/)
  assert.doesNotMatch(formatted.description, /^Experience the F1/)
  assert.ok(formatted.includes.some((item) => /Level 1 indoor suite/i.test(item)))
  assert.ok(formatted.includes.some((item) => /rooftop terrace/i.test(item)))
  assert.ok(formatted.includes.some((item) => /open bar|canap/i.test(item)))
  assert.ok(formatted.includes.some((item) => /Paddock/i.test(item)))
  assert.ok(formatted.includes.some((item) => /Starting Grid/i.test(item)))
  assert.ok(formatted.includes.some((item) => /World Championship/i.test(item)))
  assert.ok(formatted.includes.some((item) => /After-Race Concerts/i.test(item)))
  assert.ok(formatted.includes.some((item) => /Yas Island|teamLab/i.test(item)))
})

test("existing bullet lists are kept as inclusions", () => {
  const formatted = formatPackageCopy(`A relaxed lounge beside the circuit.

- Open bar
- Gourmet dining
- Guided paddock tour
- Grid walk`)
  assert.match(formatted.description, /relaxed lounge/)
  assert.deepEqual(formatted.includes.slice(0, 4), [
    "Open bar",
    "Gourmet dining",
    "Guided paddock tour",
    "Grid walk",
  ])
})

test("blank copy formats to nothing", () => {
  assert.deepEqual(formatPackageCopy("  \n  "), { description: "", includes: [] })
})
