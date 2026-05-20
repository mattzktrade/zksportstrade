/**
 * Generates lib/seed-data/live-packages-2026.ts from live inventory spreadsheet rows.
 * Run: node scripts/generate-live-inventory.mjs
 */
import fs from "fs"

const YEAR = 2026

const RACES = {
  canada: {
    raceId: "canada-2026",
    circuit: "Canadian Grand Prix",
    location: "Montreal",
    country: "Canada",
    countryCode: "CA",
    date: "2026-05-24",
    dateRange: "22 - 24 May",
    image: "/images/circuits/montreal.jpg",
  },
  monaco: {
    raceId: "monaco-2026",
    circuit: "Monaco Grand Prix",
    location: "Monte Carlo",
    country: "Monaco",
    countryCode: "MC",
    date: "2026-06-07",
    dateRange: "05 - 07 Jun",
    image: "/images/circuits/monaco.jpg",
  },
  spain: {
    raceId: "spain-2026",
    circuit: "Spanish Grand Prix",
    location: "Barcelona",
    country: "Spain",
    countryCode: "ES",
    date: "2026-06-14",
    dateRange: "12 - 14 Jun",
    image: "/images/circuits/barcelona.jpg",
  },
  austria: {
    raceId: "austria-2026",
    circuit: "Austrian Grand Prix",
    location: "Spielberg",
    country: "Austria",
    countryCode: "AT",
    date: "2026-06-28",
    dateRange: "26 - 28 Jun",
    image: "/images/circuits/spielberg.jpg",
  },
  britain: {
    raceId: "britain-2026",
    circuit: "British Grand Prix",
    location: "Silverstone",
    country: "United Kingdom",
    countryCode: "GB",
    date: "2026-07-05",
    dateRange: "03 - 05 Jul",
    image: "/images/circuits/silverstone.jpg",
  },
  belgium: {
    raceId: "belgium-2026",
    circuit: "Belgian Grand Prix",
    location: "Spa-Francorchamps",
    country: "Belgium",
    countryCode: "BE",
    date: "2026-07-19",
    dateRange: "17 - 19 Jul",
    image: "/images/circuits/spa.jpg",
  },
  hungary: {
    raceId: "hungary-2026",
    circuit: "Hungarian Grand Prix",
    location: "Budapest",
    country: "Hungary",
    countryCode: "HU",
    date: "2026-07-26",
    dateRange: "24 - 26 Jul",
    image: "/images/circuits/budapest.jpg",
  },
  italy: {
    raceId: "italy-2026",
    circuit: "Italian Grand Prix",
    location: "Monza",
    country: "Italy",
    countryCode: "IT",
    date: "2026-09-06",
    dateRange: "04 - 06 Sep",
    image: "/images/circuits/monza.jpg",
  },
  madrid: {
    raceId: "madrid-2026",
    circuit: "Madrid Grand Prix",
    location: "Madrid",
    country: "Spain",
    countryCode: "ES",
    date: "2026-09-13",
    dateRange: "11 - 13 Sep",
    image: "/images/circuits/madrid.jpg",
  },
  azerbaijan: {
    raceId: "azerbaijan-2026",
    circuit: "Azerbaijan Grand Prix",
    location: "Baku",
    country: "Azerbaijan",
    countryCode: "AZ",
    date: "2026-09-26",
    dateRange: "24 - 26 Sep",
    image: "/images/circuits/baku.jpg",
  },
  singapore: {
    raceId: "singapore-2026",
    circuit: "Singapore Grand Prix",
    location: "Marina Bay",
    country: "Singapore",
    countryCode: "SG",
    date: "2026-10-11",
    dateRange: "09 - 11 Oct",
    image: "/images/circuits/singapore.jpg",
  },
  usa: {
    raceId: "usa-2026",
    circuit: "United States Grand Prix",
    location: "Austin",
    country: "United States",
    countryCode: "US",
    date: "2026-10-25",
    dateRange: "23 - 25 Oct",
    image: "/images/circuits/austin.jpg",
  },
  mexico: {
    raceId: "mexico-2026",
    circuit: "Mexico City Grand Prix",
    location: "Mexico City",
    country: "Mexico",
    countryCode: "MX",
    date: "2026-11-01",
    dateRange: "30 Oct - 01 Nov",
    image: "/images/circuits/mexico.jpg",
  },
  brazil: {
    raceId: "brazil-2026",
    circuit: "São Paulo Grand Prix",
    location: "São Paulo",
    country: "Brazil",
    countryCode: "BR",
    date: "2026-11-08",
    dateRange: "06 - 08 Nov",
    image: "/images/circuits/interlagos.jpg",
  },
  vegas: {
    raceId: "vegas-2026",
    circuit: "Las Vegas Grand Prix",
    location: "Las Vegas",
    country: "United States",
    countryCode: "US",
    date: "2026-11-21",
    dateRange: "19 - 21 Nov",
    image: "/images/circuits/vegas.jpg",
  },
  qatar: {
    raceId: "qatar-2026",
    circuit: "Qatar Grand Prix",
    location: "Lusail",
    country: "Qatar",
    countryCode: "QA",
    date: "2026-11-29",
    dateRange: "27 - 29 Nov",
    image: "/images/circuits/lusail.jpg",
  },
  abudhabi: {
    raceId: "abudhabi-2026",
    circuit: "Abu Dhabi Grand Prix",
    location: "Yas Marina",
    country: "UAE",
    countryCode: "AE",
    date: "2026-12-06",
    dateRange: "04 - 06 Dec",
    image: "/images/circuits/abudhabi.jpg",
  },
}

/** [raceKey, id, title, stock, priceCentsOrNull] stock: number | "enquire" | "10plus" */
const ROWS = [
  ["canada", "canada-paddock-club-red-bull-2026", "3 Day Paddock Club - Red Bull", "enquire", 12950],
  ["canada", "canada-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", "enquire", 11999],
  ["canada", "canada-paddock-club-club-suite-2026", "3 Day Paddock Club - Club Suite", "enquire", 8625],
  ["canada", "canada-f1-experience-lounge-elite-2026", "3 Day F1 Experience Lounge Elite Suite", "enquire", 6437],
  ["canada", "canada-champions-club-2026", "3 Day Champions Club", "enquire", 6357],

  ["monaco", "monaco-gordon-ramsey-terrasse-2026", "3 Day Gordon Ramsey - La Terrasse", "enquire", 24000],
  ["monaco", "monaco-triple-crown-paddock-2026", "3 Day Triple Crown - Paddock Club", "enquire", 21000],
  ["monaco", "monaco-legend-paddock-club-2026", "3 Day Legend Paddock Club - Club Suite", "enquire", 18999],
  ["monaco", "monaco-audi-paddock-club-2026", "3 Day Paddock Club - Audi", "enquire", 18689],
  ["monaco", "monaco-team-haas-paddock-club-2026", "3 Day Paddock Club - Team Haas", "enquire", 17759],
  ["monaco", "monaco-paddock-club-trackside-yacht-2026", "3 Day Paddock Club - Trackside Yacht", "enquire", 17750],
  ["monaco", "monaco-paddock-club-club-suite-2026", "3 Day Paddock Club - Club Suite", "enquire", 14159],
  ["monaco", "monaco-paddock-club-house-44-2026", "3 Day Paddock Club House 44", 4, 21000],
  ["monaco", "monaco-champions-2day-ermano-2026", "2 Day Champions Club - Ermano Penthouse", "enquire", 7899],
  ["monaco", "monaco-champions-2day-trackside-yacht-2026", "2 Day Champions Club - Trackside Yacht", "enquire", 7899],
  ["monaco", "monaco-velocity-terrace-sun-sat-2026", "Saturday & Sunday Velocity Terrace", "10plus", 6500],
  ["monaco", "monaco-velocity-terrace-sunday-2026", "Sunday Velocity Terrace", "10plus", 4750],
  ["monaco", "monaco-velocity-terrace-saturday-2026", "Saturday Velocity Terrace", "10plus", 1995],
  ["monaco", "monaco-amazonica-terrace-sunday-2026", "Sunday Amazonica Terrace", "10plus", 4199],
  ["monaco", "monaco-amazonica-terrace-saturday-2026", "Saturday Amazonica Terrace", "10plus", 1900],

  ["spain", "barcelona-f1-experiences-house-44-2026", "3 Day F1 Experiences House 44", "enquire", 16335],
  ["spain", "barcelona-legend-paddock-club-2026", "3 Day Legend Paddock Club", "10plus", 10999],
  ["spain", "barcelona-paddock-club-audi-2026", "3 Day Paddock Club - Audi", "enquire", 9889],
  ["spain", "barcelona-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", "enquire", 9679],
  ["spain", "barcelona-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", 10, 7750],
  ["spain", "barcelona-paddock-club-club-suite-f1-2026", "3 Day Paddock Club - Club Suite (F1)", 7, 6655],
  ["spain", "barcelona-champions-club-2026", "3 Day Champions Club", "enquire", 4150],

  ["austria", "austria-legend-paddock-club-2026", "3 Day Legend Paddock Club", "enquire", 11138],
  ["austria", "austria-f1-experiences-audi-club-suite-2026", "3 Day F1 Experiences Audi F1 Club Suite", "enquire", 9449],
  ["austria", "austria-f1-experiences-team-haas-2026", "3 Day F1 Experiences Team Haas", "enquire", 9239],
  ["austria", "austria-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", 4, 7500],
  ["austria", "austria-paddock-club-club-suite-f1-2026", "3 Day Paddock Club - Club Suite (F1)", 8, 6900],
  ["austria", "austria-champions-club-2026", "3 Day Champions Club", "10plus", 3899],

  ["britain", "britain-gordon-ramsey-f1-lounge-2026", "3 Day Gordon Ramsey at F1 Lounge", "enquire", 36000],
  ["britain", "britain-legend-paddock-club-2026", "3 Day Legend Paddock Club", "enquire", 13379],
  ["britain", "britain-paddock-club-house-44-2026", "3 Day Paddock Club House 44", "enquire", 16200],
  ["britain", "britain-paddock-club-red-bull-2026", "3 Day Paddock Club - Red Bull", "enquire", 13950],
  ["britain", "britain-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", "enquire", 10319],
  ["britain", "britain-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", 3, 11995],
  ["britain", "britain-paddock-club-alpine-2026", "3 Day Paddock Club - Alpine", 2, 10500],
  ["britain", "britain-f1-experiences-lounge-2026", "3 Day F1 Experiences Lounge", 10, 4199],

  ["belgium", "belgium-legend-paddock-club-2026", "3 Day Legend Paddock Club", "enquire", 11170],
  ["belgium", "belgium-paddock-club-audi-2026", "3 Day Paddock Club - Audi", "enquire", 9499],
  ["belgium", "belgium-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", "enquire", 7540],
  ["belgium", "belgium-paddock-club-club-suite-2026", "3 Day Paddock Club - Club Suite", "10plus", 6353],
  ["belgium", "belgium-champions-club-2026", "3 Day Champions Club", "10plus", 4234],

  ["hungary", "hungary-legend-paddock-club-2026", "3 Day Legend Paddock Club", "enquire", 11683],
  ["hungary", "hungary-paddock-club-audi-2026", "3 Day Paddock Club - Audi", "enquire", 10899],
  ["hungary", "hungary-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", 15, 7869],
  ["hungary", "hungary-paddock-club-club-suite-f1-2026", "3 Day Paddock Club - Club Suite (F1)", 24, 6668],
  ["hungary", "hungary-champions-club-2026", "3 Day Champions Club", "10plus", 4599],

  ["italy", "italy-paddock-club-house-44-2026", "3 Day Paddock Club - House 44", "10plus", 16470],
  ["italy", "italy-legend-paddock-club-2026", "3 Day Legend Paddock Club", "enquire", 12703],
  ["italy", "italy-paddock-club-audi-2026", "3 Day Paddock Club - Audi", "enquire", 11589],
  ["italy", "italy-paddock-club-red-bull-2026", "3 Day Paddock Club - Red Bull", "enquire", 13500],
  ["italy", "italy-paddock-club-alpine-team-2026", "3 Day Paddock Club - Alpine Team", 20, 10500],
  ["italy", "italy-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", 4, 11495],
  ["italy", "italy-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", "enquire", 8799],
  ["italy", "italy-schumacher-lounge-2026", "3 Day Schumacher Lounge", "10plus", 6510],

  ["madrid", "madrid-gordon-ramsey-f1-garage-2026", "3 Day Gordon Ramsey at F1 Garage", "enquire", 30250],
  ["madrid", "madrid-paddock-club-house-44-2026", "3 Day Paddock Club - House 44", "enquire", 16355],
  ["madrid", "madrid-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", "enquire", 9679],
  ["madrid", "madrid-paddock-club-club-suite-f1-2026", "3 Day Paddock Club - Club Suite (F1)", 31, 7750],
  ["madrid", "madrid-champions-club-2026", "3 Day Champions Club", "enquire", 5500],

  ["azerbaijan", "azerbaijan-legend-paddock-club-2026", "3 Day Legend Paddock Club", "10plus", 9800],
  ["azerbaijan", "azerbaijan-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", 10, 6699],
  ["azerbaijan", "azerbaijan-paddock-club-club-suite-f1-2026", "3 Day Paddock Club - Club Suite (F1)", 27, 5500],
  ["azerbaijan", "azerbaijan-champions-club-2026", "3 Day Champions Club", "10plus", 3999],

  ["singapore", "singapore-f1-experiences-paddock-club-enquire-2026", "3 Day F1 Experiences Paddock Club", "enquire", 13950],
  ["singapore", "singapore-f1-experiences-paddock-club-15500-2026", "3 Day F1 Experiences Paddock Club", "enquire", 15500],
  ["singapore", "singapore-paddock-club-clubhouse-2026", "3 Day Paddock Club - Clubhouse", 6, 16500],
  ["singapore", "singapore-champions-club-2026", "3 Day Champions Club", "enquire", 11150],
  ["singapore", "singapore-national-gallery-vip-3days-2026", "3 Days National Gallery VIP", 150, 6950],
  ["singapore", "singapore-national-gallery-vip-sat-sun-2026", "Saturday & Sunday National Gallery VIP", 150, 6500],
  ["singapore", "singapore-national-gallery-vip-sunday-2026", "Sunday National Gallery VIP", 150, 5500],
  ["singapore", "singapore-national-gallery-vip-saturday-2026", "Saturday National Gallery VIP", 150, 2950],
  ["singapore", "singapore-national-gallery-vip-friday-2026", "Friday National Gallery VIP", 150, 950],

  ["usa", "usa-gordon-ramsey-f1-paddock-2026", "3 Day Gordon Ramsay @ F1 Paddock", "10plus", 27000],
  ["usa", "usa-paddock-club-alpine-team-2026", "3 Day Paddock Club - Alpine Team", "enquire", 13500],
  ["usa", "usa-champions-club-trackside-ew-2026", "3 Day Champions Club - Trackside E/W", "10plus", 5700],

  ["mexico", "mexico-legend-f1-experiences-paddock-club-2026", "3 Day Legend - F1 Experiences Paddock Club", "enquire", 13899],
  ["mexico", "mexico-paddock-club-house-44-2026", "3 Day Paddock Club - House 44", "10plus", 15000],
  ["mexico", "mexico-legend-paddock-club-2026", "3 Day Legend Paddock Club", "enquire", 12800],
  ["mexico", "mexico-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", "10plus", 11899],
  ["mexico", "mexico-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", "enquire", 9600],
  ["mexico", "mexico-champions-club-main-2-2026", "3 Day Champions Club - Main 2", "enquire", 5599],

  ["brazil", "brazil-legend-paddock-club-2026", "3 Day Legend Paddock Club", "enquire", 10799],
  ["brazil", "brazil-paddock-club-red-bull-2026", "3 Day Paddock Club - Red Bull", "enquire", 10299],
  ["brazil", "brazil-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", "enquire", 7999],
  ["brazil", "brazil-paddock-club-club-suite-2026", "3 Day Paddock Club - Club Suite", "enquire", 7000],
  ["brazil", "brazil-f1-experiences-lounge-2026", "3 Day F1 Experiences Lounge", "10plus", 5999],
  ["brazil", "brazil-champions-club-2026", "3 Day Champions Club", "enquire", 4299],

  ["vegas", "vegas-gordon-ramsey-f1-garage-2026", "3 Day Gordon Ramsay - F1 Garage", "10plus", 28000],
  ["vegas", "vegas-paddock-club-house-44-2026", "3 Day Paddock Club - House 44", "10plus", 18530],

  ["qatar", "qatar-gordon-ramsey-f1-garage-2026", "3 Day Gordon Ramsey at F1 Garage", "enquire", 30000],
  ["qatar", "qatar-legend-paddock-club-2026", "3 Day Legend Paddock Club", 25, 12499],
  ["qatar", "qatar-paddock-club-audi-2026", "3 Day Paddock Club - Audi", "enquire", 11599],
  ["qatar", "qatar-paddock-club-red-bull-2026", "3 Day Paddock Club - Red Bull", 8, 11799],
  ["qatar", "qatar-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", "10plus", 10399],
  ["qatar", "qatar-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", "10plus", 9578],
  ["qatar", "qatar-paddock-club-3-nights-hotel-2026", "3 Day Paddock Club & 3 Nights in a 5* Hotel", 14, 21000],
  ["qatar", "qatar-champions-club-2026", "3 Day Champions Club", "10plus", 5299],

  ["abudhabi", "abudhabi-paddock-club-house-44-2026", "3 Day Paddock Club - House 44", 26, 19500],
  ["abudhabi", "abudhabi-legend-paddock-club-2026", "3 Day Legend Paddock Club", 8, 16650],
  ["abudhabi", "abudhabi-paddock-club-red-bull-2026", "3 Day Paddock Club - Red Bull", "enquire", 15500],
  ["abudhabi", "abudhabi-paddock-club-alpine-team-2026", "3 Day Paddock Club - Alpine Team", 3, 14995],
  ["abudhabi", "abudhabi-f1-experiences-paddock-club-2026", "3 Day F1 Experiences Paddock Club", 6, 12699],
  ["abudhabi", "abudhabi-paddock-club-team-haas-2026", "3 Day Paddock Club - Team Haas", 14, 14995],
  ["abudhabi", "abudhabi-paddock-club-f1-experiences-2026", "3 Day Paddock Club - F1 Experiences", 11, 13999],
  ["abudhabi", "abudhabi-champions-club-2026", "3 Day Champions Club", 30, 6139],
  ["abudhabi", "abudhabi-f1-experiences-lounge-main-2026", "3 Day F1 Experiences Lounge - Main Straight", 30, 6719],
  ["abudhabi", "abudhabi-trackside-superyacht-3days-2026", "3 Days Trackside Superyacht Hospitality", 100, 5950],
  ["abudhabi", "abudhabi-club-58-2026", "3 Day Club 58", 30, 4050],
  ["abudhabi", "abudhabi-marina-views-brunch-2026", "3 Day Marina Views Brunch", 40, 2850],
  ["abudhabi", "abudhabi-sunset-lounge-2026", "3 Day Sunset Lounge", 0, 3250],
  ["abudhabi", "abudhabi-skybridge-terrace-3days-2026", "3 Days Skybridge Terrace", 419, 5500],
  ["abudhabi", "abudhabi-skybridge-terrace-sat-sun-2026", "Saturday & Sunday Skybridge Terrace", 419, 4950],
  ["abudhabi", "abudhabi-skybridge-terrace-sunday-2026", "Sunday Skybridge Terrace", 419, 3500],
  ["abudhabi", "abudhabi-skybridge-terrace-saturday-2026", "Saturday Skybridge Terrace", 419, 2250],
  ["abudhabi", "abudhabi-skybridge-terrace-friday-2026", "Friday Skybridge Terrace", 419, 495],
  ["abudhabi", "abudhabi-marsa-box-3days-2026", "3 Days Marsa Box by ZK", 195, 4250],
  ["abudhabi", "abudhabi-marsa-box-sat-sun-2026", "Saturday & Sunday Marsa Box by ZK", 195, 3950],
  ["abudhabi", "abudhabi-marsa-box-sunday-2026", "Sunday Marsa Box by ZK", 195, 2950],
  ["abudhabi", "abudhabi-marsa-box-saturday-2026", "Saturday Marsa Box by ZK", 197, 1950],
  ["abudhabi", "abudhabi-marsa-box-friday-2026", "Friday Marsa Box by ZK", 196, 495],
  ["abudhabi", "abudhabi-trackside-lounge-3days-2026", "3 Days Trackside Lounge", 80, 4250],
  ["abudhabi", "abudhabi-west-grandstand-2026", "3 Day West Grandstand", "enquire", 1350],
  ["abudhabi", "abudhabi-south-grandstand-2026", "3 Day South Grandstand", "enquire", 1350],
  ["abudhabi", "abudhabi-north-grandstand-2026", "3 Day North Grandstand", "enquire", 1498],
  ["abudhabi", "abudhabi-marina-grandstand-2026", "3 Day Marina Grandstand", "enquire", null],
  ["abudhabi", "abudhabi-west-straight-2026", "3 Day West Straight", "enquire", 1075],
  ["abudhabi", "abudhabi-north-straight-2026", "3 Day North Straight", "enquire", 955],
]

const FEATURED = new Set([
  "monaco-velocity-terrace-sun-sat-2026",
  "singapore-national-gallery-vip-3days-2026",
  "abudhabi-marsa-box-3days-2026",
])

function parseDuration(title) {
  const t = title.trim()
  const patterns = [
    [/^3\s*Days?\s+/i, "3_day"],
    [/^3\s*Day\s+/i, "3_day"],
    [/^2\s*Day\s+/i, "2_day"],
    [/^Saturday\s*&\s*Sunday\s+/i, "2_day"],
    [/^Saturday\s+&\s+Sunday\s+/i, "2_day"],
    [/^Sunday\s+/i, "sunday_only"],
    [/^Saturday\s+/i, "saturday_only"],
    [/^Friday\s+/i, "friday_only"],
  ]
  for (const [re, dur] of patterns) {
    if (re.test(t)) return { duration: dur, name: t.replace(re, "").trim() }
  }
  return { duration: null, name: t }
}

function inferTier(name) {
  const n = name.toLowerCase()
  if (n.includes("legend")) return "legend"
  if (n.includes("champions")) return "champions"
  if (n.includes("paddock") || n.includes("f1 experiences") || n.includes("f1 experience")) return "paddock"
  return "hero"
}

const INCLUDES = {
  legend: ["Paddock Club Access", "Premium Dining", "Open Bar", "Pit Lane Walk", "Driver Appearances"],
  paddock: ["Paddock Access", "Gourmet Dining", "Open Bar", "Pit Lane Walk"],
  champions: ["Grandstand Seats", "Hospitality Suite", "Gourmet Lunch", "Pit Lane Walk"],
  hero: ["Hospitality Access", "Race Viewing", "Refreshments"],
}

function stockToAvailability(stock) {
  if (stock === "enquire") return { availability: "Enquire", capacity: 50 }
  if (stock === "10plus") return { availability: 10, capacity: 30 }
  if (typeof stock === "number") return { availability: stock, capacity: Math.max(stock, 30) }
  return { availability: "Enquire", capacity: 50 }
}

const packages = ROWS.map(([raceKey, id, title, stock, price]) => {
  const race = RACES[raceKey]
  const { duration, name: shortName } = parseDuration(title)
  const tier = inferTier(shortName)
  /** Full sheet title including days (e.g. "3 Day Paddock Club - Red Bull"). */
  const name = title.trim()
  const { availability, capacity } = stockToAvailability(stock)
  const isEnquiry = availability === "Enquire"
  const priceOut = price == null ? null : price

  return {
    id,
    name,
    circuit: race.circuit,
    location: race.location,
    country: race.country,
    countryCode: race.countryCode,
    date: race.date,
    dateRange: race.dateRange,
    price: priceOut,
    currency: "USD",
    availability,
    totalCapacity: capacity,
    image: race.image,
    tier,
    duration,
    includes: INCLUDES[tier],
    featured: FEATURED.has(id),
    raceId: race.raceId,
  }
})

function esc(s) {
  return JSON.stringify(s)
}

let out = `/** Auto-generated from scripts/generate-live-inventory.mjs — live stock sheet ${new Date().toISOString().slice(0, 10)} */
import type { Package } from "../types/catalog"

export const livePackages2026: Package[] = `
out += JSON.stringify(packages, null, 2)
out += " as unknown as Package[]\n"

fs.writeFileSync("lib/seed-data/live-packages-2026.ts", out)
console.log("Generated", packages.length, "live packages")
