import type { BookingFormSnapshot } from "@/lib/booking-forms/types"

export const BOOKING_TEMPLATE_ID = "00000000-0000-0000-0000-00000000b001"
export const BOOKING_TEMPLATE_KEY = "zk-standard-booking-form"
export const BOOKING_TEMPLATE_VERSION = 1
export const BOOKING_LEGAL_CONTENT_VERSION = "2026-08-11"

export const BOOKING_SELLER = {
  legalName: "ZK Sports International FZ LLC",
  addressLines: ["DQuarters DMC5", "Dubai Media City", "PO BOX 357324", "Dubai UAE"],
  trn: "100373853900003",
}

export const BOOKING_BANK_DETAILS: BookingFormSnapshot["bankDetails"] = [
  {
    currency: "USD",
    recipient: "ZK SPORTS INTERNATIONAL FZ LLC",
    bank: "MASHREQ BANK",
    iban: "AE 610 330 000 019 000 001 515",
    swift: "BOMLAEADXXX",
  },
  {
    currency: "AED",
    recipient: "ZK SPORTS INTERNATIONAL FZ LLC",
    bank: "MASHREQ BANK",
    iban: "AE 880 330 000 019 000 001 514",
    swift: "BOMLAEADXXX",
  },
  {
    currency: "EUR",
    recipient: "ZK Sports International FZ LLC",
    bank: "Mashreq Bank",
    iban: "AE 340 330 000 019 000 001 516",
    swift: "BOMLAEADXXX",
  },
  {
    currency: "GBP",
    recipient: "ZK Sports International FZ LLC",
    bank: "Mashreq Bank",
    iban: "AE 070 330 000 019 000 001 517",
    swift: "BOMLAEADXXX",
  },
  {
    currency: "SAR",
    recipient: "ZK Sports International FZ LLC",
    bank: "Mashreq Bank",
    iban: "AE 630 330 000 019 100 812 221",
    swift: "BOMLAEADXXX",
  },
]

export const BOOKING_ACKNOWLEDGEMENT =
  "I VERIFY THAT I HAVE REVIEWED THE PRODUCTS/PACKAGES BEING OFFERED AND THAT THIS ACCURATELY REPRESENTS WHAT I HAVE PURCHASED."

export const BOOKING_SIGNATURE_CONSENT =
  "I acknowledge that I have read and understand the booking form and Ticketing & Hospitality Terms and Conditions, agree to be legally bound by them, and consent to use this electronic signature as my signature."

export const BOOKING_TERMS: BookingFormSnapshot["terms"] = [
  {
    heading: "Introduction",
    paragraphs: [
      "These Ticketing & Hospitality Terms and Conditions (the “Terms”) apply to all sales and arrangements made by ZK Sports International FZ LLC, a company incorporated in Dubai, United Arab Emirates, with offices in Dubai Media City Free Zone (“ZK”, “we”, “us”, “our”), relating to Formula 1® and other motorsport/sporting event tickets, hospitality packages, travel and related services.",
      "By signing an order form, paying an invoice, accepting a ticket or credential, or attending any event arranged by ZK, the purchaser and all attendees (together, the “Client”, “you”, “Holder”) agree to be bound by these Terms.",
    ],
  },
  {
    heading: "1) Definitions",
    paragraphs: [
      "1.1 Order Form / Booking Confirmation means the written confirmation issued by ZK (email, invoice, proposal acceptance, or signed order form) describing the products and services purchased.",
      "1.2 Tickets means event admission tickets, passes, credentials, and/or digital tickets.",
      "1.3 Hospitality means hospitality access including, without limitation, Paddock Club™, Champions Club™, grandstand hospitality, suites, lounges, ZK-operated venues, and/or any third-party hospitality spaces.",
      "1.4 Package means the total bundle of products and services you purchase, which may include Tickets, Hospitality, experiences, accommodation, transportation, and/or concierge services.",
      "1.5 Event means the relevant race weekend, sporting event, or program for which the Ticket or Package is issued.",
      "1.6 Third-Party Providers means any supplier not owned/operated by ZK, including the promoter, circuit operator, Formula 1 entities, hospitality operators, teams, hotels, airlines, transport providers, caterers, security providers, and experience operators.",
    ],
  },
  {
    heading: "2) Scope of ZK’s Role",
    paragraphs: [
      "2.1 ZK acts as an arranger and/or reseller/agent (as applicable per the Order Form) for certain Tickets, Hospitality, travel and related services supplied by Third-Party Providers. ZK does not control venue operations, event scheduling, safety protocols, or the performance of Third-Party Providers.",
      "2.2 The Client acknowledges that Tickets and Hospitality are issued and governed by the relevant promoter/circuit/operator rules and any ticket terms printed on the Ticket or published by the relevant rights holder.",
    ],
  },
  {
    heading: "3) Orders, Pricing, and Payment",
    paragraphs: [
      "3.1 Confirmation. No booking is confirmed until ZK issues written confirmation and receives payment in cleared funds.",
      "3.2 Payment Deadlines. All amounts must be paid by the due date on the invoice. Time is of the essence. If payment is late, ZK may (at its discretion) cancel the booking, reallocate inventory, or resell tickets/hospitality without liability.",
      "3.3 Currency & Bank Details. Payments must be made in the exact currency and to the bank account details specified on ZK’s invoice/Order Form.",
      "3.4 Charges & Interest. The Client is responsible for all bank charges, intermediary bank fees, and currency conversion costs. Overdue balances may accrue interest at 1.5% per month (or the maximum allowed by applicable law, if lower) from the due date until paid.",
    ],
  },
  {
    heading: "4) Final Sale; No Cancellation; No Refund",
    paragraphs: [
      "4.1 All sales are final. Unless explicitly stated otherwise in writing by ZK, all Ticket and Package sales (including all taxes, fees, and service charges) are final, non-cancellable, and non-refundable.",
      "4.2 No refund, credit, or exchange will be provided for any reason, including (without limitation): personal circumstances (illness, emergency, inability to travel, visa refusal, missed flights); travel disruptions (flight cancellations, delays, strikes); changes to event schedule (practice/qualifying/race timing changes), support events, or access rules; partial completion or interruption of the Event or any element of the Package; cancellation or postponement of the Event.",
      "4.3 Exceptional discretion. If ZK chooses (at its sole discretion) to offer a credit, partial refund, or rebooking, it must be confirmed in writing and may be subject to supplier rules, administrative fees, and/or proof requirements.",
    ],
  },
  {
    heading: "5) Changes, Seat Views, Access & Event Modifications",
    paragraphs: [
      "5.1 No guarantee of view. ZK does not guarantee any particular view, seat location, or sightline. Views may be obstructed by structures, cameras, safety fencing, crowds, weather, operational changes, or circuit configuration.",
      "5.2 Access changes. Promoters and operators may change entry gates, opening times, hospitality access times, shuttle routes, parking availability, and security policies at any time. These changes do not entitle the Client to a refund.",
      "5.3 Relocation. Where permitted by supplier rules, ZK and/or the supplier may relocate seats or hospitality areas for operational, safety, or security reasons.",
    ],
  },
  {
    heading: "6) Name Details, Delivery, and ID Requirements",
    paragraphs: [
      "6.1 The Client must provide accurate attendee details by the deadline specified by ZK. Failure to do so may result in tickets not being issued or access being refused with no refund.",
      "6.2 Tickets may be delivered electronically, by courier, onsite collection, or via credential desk (as advised). Risk passes to the Client upon delivery/collection.",
      "6.3 Attendees may be required to present valid government-issued ID matching the ticket name.",
    ],
  },
  {
    heading: "7) Non-Transfer, Resale, and Prohibited Uses",
    paragraphs: [
      "7.1 Tickets and Hospitality are sold for personal/corporate attendance only and may be non-transferable under supplier rules.",
      "7.2 The Client must not resell, auction, transfer for profit, or commercially exploit Tickets/Hospitality unless expressly permitted in writing by ZK and/or the relevant supplier.",
      "7.3 Tickets and Hospitality must not be used for promotions, competitions, raffles, giveaways, sweepstakes, gambling, bundling with other products, or advertising without prior written consent from ZK and the relevant rights holder/promoter.",
      "7.4 If supplier rules are breached, Tickets may be cancelled, voided, or entry refused without refund.",
    ],
  },
  {
    heading: "8) Conduct, Security, and Venue Rules",
    paragraphs: [
      "8.1 Attendance is subject to all venue rules, security procedures, prohibited item lists, dress codes (including hospitality dress requirements), and fan conduct policies.",
      "8.2 The venue/operator may search persons and belongings and refuse entry or remove any attendee at its discretion. No refund will be due.",
    ],
  },
  {
    heading: "9) Media, Recording, and Intellectual Property",
    paragraphs: [
      "9.1 Event intellectual property is owned by the relevant rights holders. Commercial recording, live-streaming, or distribution of event footage, telemetry, timing, radio, or other event data may be prohibited.",
      "9.2 Personal photos/videos for private use are generally permitted, subject to venue rules. Any commercial use requires prior written permissions from the rights holders.",
      "9.3 Attendees may be filmed/photographed by media and event partners. By attending, the Client consents to use of their likeness for broadcast and promotional purposes where permitted by law and venue terms.",
    ],
  },
  {
    heading: "10) Travel, Accommodation, and Third-Party Services",
    paragraphs: [
      "10.1 Where travel/accommodation/transportation is included or arranged by ZK, it is provided by Third-Party Providers. ZK is not a carrier or hotel operator.",
      "10.2 Delays, cancellations, lost items, service failures, or changes by Third-Party Providers do not entitle the Client to a refund.",
      "10.3 The Client must comply with all Third-Party Provider terms and is responsible for passports, visas, insurance, medical requirements, and compliance with laws.",
    ],
  },
  {
    heading: "11) Assumption of Risk; Health & Safety",
    paragraphs: [
      "11.1 Motorsport and event attendance involves inherent risks (crowds, noise, weather, transport, physical hazards). The Client voluntarily assumes all risks of injury, illness, loss, or damage.",
      "11.2 The Client is responsible for their own health and safety and must comply with any applicable safety instructions and protocols.",
    ],
  },
  {
    heading: "12) Indemnity and Limitation of Liability",
    paragraphs: [
      "12.1 The Client agrees to indemnify and hold harmless ZK, its directors, officers, employees, agents, contractors, and affiliates from any claims, damages, losses, costs, or expenses (including legal fees) arising from: the Client’s acts/omissions; breach of these Terms or supplier rules; attendance, participation, or use of Tickets/Hospitality/Packages.",
      "12.2 To the maximum extent permitted by applicable law, ZK will not be liable for any indirect, consequential, special, incidental, or punitive damages, including loss of profit, loss of business, or loss of opportunity.",
      "12.3 ZK’s total aggregate liability in connection with any claim shall not exceed the amount of ZK’s service fee actually received for the specific booking giving rise to the claim (excluding supplier face value amounts), unless required otherwise by law.",
    ],
  },
  {
    heading: "13) Force Majeure",
    paragraphs: [
      "Notwithstanding anything to the contrary in this Agreement, including any provision relating to force majeure, if the Event is cancelled, postponed, delayed, relocated, or otherwise materially modified for any reason whatsoever, including as a result of a Force Majeure Event, Client shall have the sole and exclusive discretion to: (i) terminate this Agreement and receive a full refund of all amounts paid hereunder; or (ii) proceed with the modified Event and receive a mutually agreed reduction in the fees payable under this Agreement. For the avoidance of doubt, this provision shall prevail over and supersede any inconsistent or conflicting provision of this Agreement. FOR THE AVOIDANCE OF DOUBT THIS PROVISION SHALL PREVAIL OVER ANY SUCH CONTRADICTORY LANGUAGE.",
    ],
  },
  {
    heading: "14) Data Protection",
    paragraphs: [
      "14.1 ZK will process personal data for booking administration, delivery, and event operations. The Client authorizes ZK to share relevant attendee data with Third-Party Providers as required to fulfil the booking.",
    ],
  },
  {
    heading: "15) Dispute Resolution; Governing Law and Jurisdiction",
    paragraphs: [
      "15.1 Governing law: These Terms are governed by the laws of the United Arab Emirates, as applicable in Dubai and/or the Dubai Media City Free Zone (as relevant).",
      "15.2 Courts: Subject to clause 15.3, the courts of Dubai shall have exclusive jurisdiction.",
    ],
  },
]

