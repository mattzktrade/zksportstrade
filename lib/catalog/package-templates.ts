/** Prefill data when creating packages that share the same hospitality product across races. */
export type PackageTemplate = {
  id: string
  label: string
  nameSuffix: string
  totalCapacity: number
  description: string
  includes: string[]
  requiresBookingApproval?: boolean
}

export const PACKAGE_TEMPLATES: PackageTemplate[] = [
  {
    id: "3-day-paddock",
    label: "3 Day Paddock Club",
    nameSuffix: "3 Day Paddock Club",
    totalCapacity: 150,
    description:
      "Step behind the scenes and experience every battle, every pit stop, every decision that defines a season. You'll get unique insights from true legends of the sport and discover what makes an F1® team tick.",
    includes: [
      "3-Day F1 Paddock Club™ Access",
      "Spectacular views",
      "Aramco F1® Pit Lane Walk",
      "Guided track tour",
      "Live Q&As with F1® drivers and ambassadors",
      "A fusion of global and local cuisine",
      "Access to the Club Lounge",
      "Live music, DJ sets, racing sims and more!",
    ],
    requiresBookingApproval: true,
  },
  {
    id: "3-day-champions",
    label: "3 Day Champions Club",
    nameSuffix: "3 Day Champions Club",
    totalCapacity: 150,
    description:
      "Enjoy a premium F1® Grand Prix™ weekend with exclusive access to the Champions Club hospitality suite. Take in incredible trackside views, enjoy chef-prepared dining and drinks, and unlock insider F1® experiences designed to bring you closer to the action.",
    includes: [
      "Premium Champions Club Views: Watch the on-track action from select trackside hospitality suites or reserved grandstand seating at the circuit.",
      "Champions Club Hospitality: Enjoy carefully crafted snacks, chef-prepared meals, free-flowing beverages, F1® racing simulators, live entertainment, and other interactive activations.",
      "Guided Paddock Tour: Go behind the scenes with an expert host-led tour of the exclusive F1® Paddock, with opportunities to see team personnel, drivers, and media personalities.",
      "F1® Insider Appearances: Hear from special guests such as legendary drivers, F1® media personalities, team executives, or the FIA F1® Safety Car driver.",
      "Grid Walk & Championship Trophy Photo: Walk the famous F1® grid and take a professional photo with the Formula 1 World Championship™ trophy.",
    ],
    requiresBookingApproval: false,
  },
  {
    id: "3-day-house-44",
    label: "3 Day Paddock Club — House 44",
    nameSuffix: "3 Day Paddock Club - House 44",
    totalCapacity: 150,
    description:
      "House 44, an exclusive hospitality experience imagined by F1 Paddock Club™, Lewis Hamilton and Soho House will be returning to Mexico City for the 2026 Formula 1® season. As a Soho House member for over 10 years, Hamilton has added his own creative vision to the suite, drawing from his personal aesthetic as well as his connection to the Houses. Guests will enjoy a bespoke drinks menu offering the House cocktails that members know and love as well as an elevated setting to experience the race weekend, designed in signature Soho House style. Set in Estadio, the House 44 suite offers excellent views of the action through the iconic stadium section, where guests will experience the electric atmosphere of this special circuit first-hand.",
    includes: [
      "Three-day access to the House 44 suite at F1 Paddock Club™",
      "Spectacular view of the track overlooking the iconic stadium section",
      "Access to F1 Paddock Club™ experiences such as a guided tour of the track (subject to availability) and daily pit lane walks",
      "A special line-up of behind-the-scenes activities for House 44 guests including a guided tour of the F1® Paddock and priority access to the post-race F1® podium celebration (subject to availability)",
      "Appearances from VIP guests and seven-time Formula 1® World Champion Lewis Hamilton",
      "A custom drinks menu featuring Soho House signature cocktails",
      "Curated display featuring items from throughout Hamilton's prestigious career, including iconic helmets and standout pieces from his Plus 44 merch collections",
      "An off-track line-up featuring live DJ sets, acoustic sessions, and so much more…",
    ],
    requiresBookingApproval: true,
  },
]

export function findPackageTemplate(id: string): PackageTemplate | undefined {
  return PACKAGE_TEMPLATES.find((t) => t.id === id)
}
