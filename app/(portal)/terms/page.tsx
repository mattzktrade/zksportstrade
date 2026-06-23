import Link from "next/link"
import type { Metadata } from "next"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Terms & conditions | ZK Sports Trade Portal",
  description: "Ticketing and hospitality terms and conditions for bookings made with ZK Sports.",
}

const termsSections = [
  {
    title: "1. Definitions",
    paragraphs: [
      "Order Form / Booking Confirmation means the written confirmation issued by ZK, including by email, invoice, proposal acceptance, portal confirmation, or signed order form, describing the products and services purchased.",
      "Tickets means event admission tickets, passes, credentials, and/or digital tickets. Hospitality means hospitality access including, without limitation, Paddock Club, Champions Club, grandstand hospitality, suites, lounges, ZK-operated venues, and/or any third-party hospitality spaces.",
      "Package means the total bundle of products and services purchased, which may include Tickets, Hospitality, experiences, accommodation, transportation, and/or concierge services. Event means the relevant race weekend, sporting event, or program for which the Ticket or Package is issued.",
      "Third-Party Providers means any supplier not owned or operated by ZK, including the promoter, circuit operator, Formula 1 entities, hospitality operators, teams, hotels, airlines, transport providers, caterers, security providers, and experience operators.",
    ],
  },
  {
    title: "2. Scope of ZK's Role",
    paragraphs: [
      "ZK acts as an arranger and/or reseller or agent, as applicable per the Order Form, for certain Tickets, Hospitality, travel, and related services supplied by Third-Party Providers. ZK does not control venue operations, event scheduling, safety protocols, or the performance of Third-Party Providers.",
      "The Client acknowledges that Tickets and Hospitality are issued and governed by the relevant promoter, circuit, operator, supplier, and rights-holder rules, including any ticket terms printed on the Ticket or published by the relevant rights holder.",
    ],
  },
  {
    title: "3. Orders, Pricing, and Payment",
    paragraphs: [
      "No booking is confirmed until ZK issues written confirmation and receives payment in cleared funds, unless ZK expressly confirms otherwise in writing.",
      "All amounts must be paid by the due date on the invoice. Time is of the essence. Contracts for which payments are not received within ten (10) business days of contract execution are subject to cancellation. If payment is late, ZK may, at its discretion, cancel the booking, reallocate inventory, or resell tickets or hospitality without liability.",
      "By submitting a booking, signing an order form, accepting a portal confirmation, or paying an invoice, the Client acknowledges that it has agreed to the payment and terms represented and will make payment accordingly. The Client and each person accepting these Terms represents and warrants that they have authority to enter into this agreement on behalf of the relevant party.",
      "Payments must be made in the exact currency and to the bank account details specified on ZK's invoice or Order Form. The Client is responsible for all bank charges, intermediary bank fees, and currency conversion costs. Overdue balances may accrue interest at 1.5% per month, or the maximum allowed by applicable law if lower, from the due date until paid.",
    ],
  },
  {
    title: "4. Delivery of Package",
    paragraphs: [
      "ZK shall not be obligated to provide the Package, Tickets, Hospitality, or any element or portion thereof unless and until ZK receives full and timely payment in cleared funds.",
      "Tickets may be delivered electronically, by courier, onsite collection, or via a credential desk, as advised by ZK or the relevant supplier. Risk passes to the Client upon delivery or collection.",
    ],
  },
  {
    title: "5. Final Sale; No Cancellation; No Refund",
    paragraphs: [
      "All sales are final. Unless explicitly stated otherwise in writing by ZK, all Ticket and Package sales, including all taxes, fees, and service charges, are final, non-cancellable, and non-refundable.",
      "No refund, credit, or exchange will be provided for any reason, including personal circumstances, illness, emergency, inability to travel, visa refusal, missed flights, travel disruptions, flight cancellations, delays, strikes, changes to event schedule, practice, qualifying or race timing changes, support events, access rules, partial completion or interruption of the Event or any element of the Package, cancellation, or postponement of the Event.",
      "If ZK chooses, at its sole discretion, to offer a credit, partial refund, or rebooking, it must be confirmed in writing and may be subject to supplier rules, administrative fees, and/or proof requirements.",
    ],
  },
  {
    title: "6. Changes, Seat Views, Access, and Event Modifications",
    paragraphs: [
      "ZK does not guarantee any particular view, seat location, or sightline. Views may be obstructed by structures, cameras, safety fencing, crowds, weather, operational changes, or circuit configuration.",
      "Promoters and operators may change entry gates, opening times, hospitality access times, shuttle routes, parking availability, security policies, seating, or hospitality areas at any time. These changes do not entitle the Client to a refund.",
      "Where permitted by supplier rules, ZK and/or the supplier may relocate seats or hospitality areas for operational, safety, security, or event reasons.",
    ],
  },
  {
    title: "7. Name Details, Delivery, and ID Requirements",
    paragraphs: [
      "The Client must provide accurate attendee details by the deadline specified by ZK. Failure to do so may result in tickets not being issued or access being refused with no refund.",
      "Attendees may be required to present valid government-issued ID matching the ticket name and must comply with all credentialing, guest registration, and event entry requirements.",
    ],
  },
  {
    title: "8. Non-Transfer, Resale, and Prohibited Uses",
    paragraphs: [
      "Tickets and Hospitality are sold for personal or corporate attendance only and may be non-transferable under supplier rules.",
      "The Client must not resell, auction, transfer for profit, or commercially exploit Tickets or Hospitality unless expressly permitted in writing by ZK and/or the relevant supplier.",
      "Tickets and Hospitality must not be used for promotions, competitions, raffles, giveaways, sweepstakes, gambling, bundling with other products, or advertising without prior written consent from ZK and the relevant rights holder or promoter.",
      "If supplier rules are breached, Tickets may be cancelled, voided, or entry refused without refund.",
    ],
  },
  {
    title: "9. Conduct, Security, and Venue Rules",
    paragraphs: [
      "Attendance is subject to all venue rules, security procedures, prohibited item lists, dress codes, including hospitality dress requirements, and fan conduct policies.",
      "The venue, operator, promoter, or security provider may search persons and belongings and refuse entry or remove any attendee at its discretion. No refund will be due.",
    ],
  },
  {
    title: "10. Media, Recording, and Intellectual Property",
    paragraphs: [
      "Event intellectual property is owned by the relevant rights holders. Commercial recording, live-streaming, or distribution of event footage, telemetry, timing, radio, or other event data may be prohibited.",
      "Personal photos and videos for private use are generally permitted, subject to venue rules. Any commercial use requires prior written permissions from the rights holders.",
      "Attendees may be filmed or photographed by media and event partners. By attending, the Client consents to use of their likeness for broadcast and promotional purposes where permitted by law and venue terms.",
    ],
  },
  {
    title: "11. Travel, Accommodation, and Third-Party Services",
    paragraphs: [
      "Where travel, accommodation, transportation, or experiences are included or arranged by ZK, they are provided by Third-Party Providers. ZK is not a carrier, hotel operator, transport provider, or venue operator.",
      "Delays, cancellations, lost items, service failures, or changes by Third-Party Providers do not entitle the Client to a refund from ZK.",
      "The Client must comply with all Third-Party Provider terms and is responsible for passports, visas, insurance, medical requirements, and compliance with laws.",
    ],
  },
  {
    title: "12. Assumption of Risk; Health and Safety",
    paragraphs: [
      "Motorsport and event attendance involves inherent risks, including crowds, noise, weather, transport, physical hazards, and operational changes. The Client voluntarily assumes all risks of injury, illness, loss, or damage.",
      "The Client is responsible for its own health and safety and must comply with any applicable safety instructions, venue rules, and protocols.",
    ],
  },
  {
    title: "13. Indemnity and Limitation of Liability",
    paragraphs: [
      "The Client agrees to indemnify and hold harmless ZK, its directors, officers, employees, agents, contractors, and affiliates from any claims, damages, losses, costs, or expenses, including legal fees, arising from the Client's acts or omissions, breach of these Terms or supplier rules, attendance, participation, or use of Tickets, Hospitality, or Packages.",
      "To the maximum extent permitted by applicable law, ZK will not be liable for any indirect, consequential, special, incidental, or punitive damages, including loss of profit, loss of business, or loss of opportunity.",
      "ZK's total aggregate liability in connection with any claim shall not exceed the amount of ZK's service fee actually received for the specific booking giving rise to the claim, excluding supplier face value amounts, unless required otherwise by law.",
    ],
  },
  {
    title: "14. Force Majeure",
    paragraphs: [
      "ZK is not liable for any failure or delay in performance caused by events beyond its reasonable control, including acts of God, government actions, war, terrorism, civil unrest, strikes, transport failures, pandemics, venue closures, supplier failures, or event restrictions.",
      "In a Force Majeure event, no refund is due unless ZK receives a refund from the supplier and elects to pass it on, in whole or in part, less any non-recoverable costs and administrative fees.",
    ],
  },
  {
    title: "15. Data Protection",
    paragraphs: [
      "ZK will process personal data for booking administration, delivery, event operations, compliance, and customer service. The Client authorizes ZK to share relevant attendee data with Third-Party Providers as required to fulfil the booking.",
      "The Client is responsible for ensuring it has the right to provide attendee and client data to ZK and for informing attendees that their data may be shared with event operators, suppliers, and rights holders where required.",
    ],
  },
  {
    title: "16. Dispute Resolution; Governing Law and Jurisdiction",
    paragraphs: [
      "These Terms are governed by the laws of the United Arab Emirates, as applicable in Dubai and/or the Dubai Media City Free Zone, as relevant.",
      "The courts of Dubai shall have exclusive jurisdiction, subject to any mandatory applicable law or agreed dispute forum confirmed in writing by ZK.",
    ],
  },
]

export default function TermsPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-8 pb-16">
      <Link
        href="/packages"
        className="inline-flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        Back to portal
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">
          Ticketing & Hospitality Terms and Conditions
        </h1>
        <p className="text-sm text-muted-foreground">
          These Ticketing & Hospitality Terms and Conditions apply to all sales and arrangements made by{" "}
          <strong className="text-foreground">ZK Sports International FZ LLC</strong>, a company incorporated in Dubai,
          United Arab Emirates, with offices in Dubai Media City Free Zone, relating to Formula 1 and other motorsport
          or sporting event tickets, hospitality packages, travel, and related services.
        </p>
        <p className="text-sm text-muted-foreground">
          By signing an order form, submitting a portal order, paying an invoice, accepting a ticket or credential, or
          attending any event arranged by ZK, the purchaser and all attendees agree to be bound by these Terms.
        </p>
        <p className="text-xs text-muted-foreground">Last updated: 23 June 2026</p>
      </header>

      <article className="space-y-8 text-sm text-muted-foreground leading-relaxed [&_h2]:text-foreground [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-2">
        {termsSections.map((section) => (
          <section key={section.title} className="space-y-3">
            <h2>{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </section>
        ))}
      </article>
    </div>
  )
}
