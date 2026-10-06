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

test("numbered turn lists stay as one inclusion", () => {
  const formatted = formatPackageCopy(
    "Stunning panoramic views of turns 11, 12, 13, and 14 from our VIP lounge or from our expansive, trackside terrace.",
  )
  assert.equal(formatted.includes.length, 1)
  assert.match(formatted.includes[0] ?? "", /11, 12, 13, and 14 from our VIP lounge/)
})

const SKYBRIDGE_RAW = `Experience the unparalleled thrill of the 2026 Abu Dhabi Grand Prix from Skybridge Terrace, the only VIP hospitality venue directly over the Yas Marina Circuit track. Located at the W Hotel, this exclusive venue provides a unique, immersive experience for discerning F1 fans. This is the best place to watch the Abu Dhabi F1 race.

Unmatched Race Viewing & Luxury

Enjoy stunning panoramic views of turns 11, 12, 13, and 14 from our VIP lounge or from our expansive, trackside terrace. You'll also take in the breathtaking panorama of the superyachts and the Yas Marina below. Our package includes a premium culinary experience and a comprehensive beverage package with top-shelf champagne and spirits. This is the best F1 hospitality with meet and greet, offering an F1 Paddock Club alternative that stands out.

Beyond the Race: Exclusive Access

With Skybridge Terrace, your adventure extends beyond the track. You will have opportunities to meet F1 legends and expert hosts. The excitement continues with live entertainment, including DJs, dancers, and saxophonists, creating a vibrant, unforgettable atmosphere. We also bring the action to life with massive flat-screen TVs and state-of-the-art F1 simulators. This is the most exclusive F1 experience you can get.

The Formula 1 Etihad Airways Abu Dhabi Grand Prix is more than just a race; it's a dazzling spectacle of speed, adrenaline, and pure entertainment. And a key component of that entertainment is the legendary Yasalam concerts

This is your chance to elevate your Abu Dhabi F1 tickets to a truly exclusive, luxury event. If you are looking for F1 tickets over the track Yas Marina or an F1 tickets W Hotel Abu Dhabi package, this is it. We are your official source for Abu Dhabi Grand Prix 2026 tickets and F1 VIP hospitality Abu Dhabi. Look no further for luxury F1 tickets Yas Marina Circuit options.`

test("section headings fold into the inclusion they introduce", () => {
  const formatted = formatPackageCopy(SKYBRIDGE_RAW)
  assert.equal(
    formatted.includes.some((item) => /^unmatched race viewing & luxury$/i.test(item)),
    false,
  )
  assert.equal(
    formatted.includes.some((item) => /^beyond the race: exclusive access$/i.test(item)),
    false,
  )
  assert.equal(
    formatted.includes.some((item) => /^pure entertainment$/i.test(item)),
    false,
  )
  assert.ok(
    formatted.includes.some((item) =>
      /unmatched race viewing & luxury:.*turns 11, 12, 13, and 14 from our VIP lounge/i.test(item),
    ),
  )
  assert.ok(
    formatted.includes.some((item) =>
      /beyond the race: exclusive access.*skybridge terrace/i.test(item),
    ),
  )
  assert.ok(formatted.includes.some((item) => /djs, dancers, and saxophonists/i.test(item)))
  assert.ok(formatted.includes.some((item) => /yasalam concerts/i.test(item)))
  assert.equal(
    formatted.includes.some((item) => /^14 from our VIP lounge/i.test(item)),
    false,
  )
  assert.doesNotMatch(formatted.includes.join("\n"), /look no further|official source|tickets over the track/i)
  assert.doesNotMatch(formatted.description, /^Unmatched Race Viewing/)
  assert.doesNotMatch(formatted.description, /look no further|official source/)
  assert.match(formatted.description, /W Hotel/)
})

test("blank copy formats to nothing", () => {
  assert.deepEqual(formatPackageCopy("  \n  "), { description: "", includes: [] })
})
