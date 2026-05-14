import Link from "next/link"
import type { Metadata } from "next"
import { ArrowLeft } from "lucide-react"

export const metadata: Metadata = {
  title: "Terms & conditions | ZK Sports Trade Portal",
  description: "Terms and conditions for approved trade partners using the ZK Sports & Entertainment booking portal.",
}

export default function TermsPage() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-8 pb-16">
      <Link
        href="/packages"
        className="inline-flex items-center gap-2 text-xs sm:text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        Back to portal
      </Link>

      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">Terms & conditions</h1>
        <p className="text-sm text-muted-foreground">
          These terms apply to approved trade partners accessing the ZK Sports & Entertainment trade portal and placing reservations for hospitality
          experiences (including, without limitation, Formula&nbsp;1 and related events). By registering, browsing catalogues, or submitting a booking
          request, you agree to the version of these terms published at the time of your order.
        </p>
        <p className="text-xs text-muted-foreground">Last updated: 14 May 2026</p>
      </header>

      <article className="space-y-8 text-sm text-muted-foreground leading-relaxed [&_h2]:text-foreground [&_h2]:font-semibold [&_h2]:text-base [&_h2]:mt-2 [&_strong]:text-foreground">
        <section className="space-y-3">
          <h2>1. Who we are</h2>
          <p>
            References to <strong>“we”</strong>, <strong>“us”</strong>, or <strong>“ZK”</strong> mean ZK Sports & Entertainment and its authorised
            representatives. ZK Sports & Entertainment operates from <strong>Dubai, United Arab Emirates</strong>. The <strong>“portal”</strong> is the
            password-protected trade website made available to you after approval. <strong>“You”</strong> means the registered user and the business
            entity on whose behalf you act as an authorised user.
          </p>
        </section>

        <section className="space-y-3">
          <h2>2. Trade-only platform</h2>
          <p>
            The portal is intended solely for bona fide travel, concierge, and corporate hospitality trade partners procuring experiences for their own
            clients. You warrant that you hold any licences or registrations required in your jurisdiction to resell or package travel or event-related
            services, where applicable. Consumer protection rules may not apply to your use of the portal; your clients remain your customers for
            regulatory purposes unless otherwise agreed in writing.
          </p>
        </section>

        <section className="space-y-3">
          <h2>3. Account approval and security</h2>
          <p>
            Access is invite-only and subject to approval. You must provide accurate registration information, keep credentials confidential, and
            notify us promptly of any unauthorised use. We may suspend or withdraw access where we reasonably suspect fraud, misuse, or breach of
            these terms.
          </p>
        </section>

        <section className="space-y-3">
          <h2>4. Catalogue, pricing, and availability</h2>
          <p>
            Packages, dates, capacities, and indicative trade prices shown in the portal are subject to change without notice until an order is
            confirmed by us. Display errors, mapping issues, or third-party data delays may occur; we reserve the right to correct prices or withdraw
            offers before acceptance. Inventory is managed dynamically; a confirmed portal order does not guarantee fulfilment if an upstream supplier
            cancels—in such cases we will use reasonable endeavours to offer alternatives or a refund of amounts paid to us for the affected portion.
          </p>
        </section>

        <section className="space-y-3">
          <h2>5. Orders and acceptance</h2>
          <p>
            When you submit a booking through checkout, you make an offer to purchase the selected package for the stated guest count. A contract is
            formed when we (or our systems) confirm the booking and issue an order reference, subject to receipt of any required deposit or
            pre-payment where specified. You confirm that you are authorised to bind your organisation to payment and cancellation obligations arising
            from that order.
          </p>
        </section>

        <section className="space-y-3">
          <h2>6. Client information</h2>
          <p>
            You are responsible for the accuracy of guest names, contact details, nationality (where collected), dietary information, and delivery or
            billing addresses you enter. Where you use placeholders such as “TBC”, you undertake to supply final details within any deadline we or the
            venue communicate. Failure to provide accurate information may result in refused entry, loss of services, or additional charges from
            suppliers, for which we are not liable.
          </p>
        </section>

        <section className="space-y-3">
          <h2>7. Invoicing and payment</h2>
          <p>
            Unless we notify you otherwise, hospitality is supplied on an invoice basis. You will receive an invoice after confirmation; unless another
            period is stated on the invoice, <strong>payment is due within seven (7) calendar days</strong> of the invoice date. Time is of the essence.
            Late payment may attract statutory or contractual interest, suspension of further bookings, and/or cancellation of the underlying
            reservation where suppliers require payment in advance. You are responsible for any bank charges or currency conversion costs.
          </p>
        </section>

        <section className="space-y-3">
          <h2>8. Cancellations, amendments, and refunds</h2>
          <p>
            Supplier and venue cancellation policies apply in addition to these terms. Generally, closer proximity to the event date increases
            cancellation fees or non-refundability. Where you cancel or reduce guest numbers, we will pass through supplier charges and reasonable
            administration fees. If we cancel for reasons within our reasonable control (excluding force majeure), your remedy is limited to a refund of
            amounts already paid to us for services not received. We are not liable for consequential losses, loss of profit, or reputational damage.
          </p>
        </section>

        <section className="space-y-3">
          <h2>9. Conduct at events</h2>
          <p>
            Guests must comply with venue rules, host instructions, and applicable laws (including health & safety and anti-discrimination). We may
            exclude guests who behave dangerously or offensively without refund.
          </p>
        </section>

        <section className="space-y-3">
          <h2>10. Intellectual property and marketing</h2>
          <p>
            Marks, images, and descriptions in the portal remain the property of their respective owners. You may use approved assets solely to promote
            confirmed bookings to your clients and not in a way that implies endorsement by rights-holders without permission.
          </p>
        </section>

        <section className="space-y-3">
          <h2>11. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, our aggregate liability arising out of or in connection with the portal or any booking (whether in
            contract, tort, or otherwise) is limited to the total fees paid by you to us for the specific booking giving rise to the claim. Nothing
            excludes liability that cannot be excluded by law, including death or personal injury caused by negligence where applicable.
          </p>
        </section>

        <section className="space-y-3">
          <h2>12. Force majeure</h2>
          <p>
            We are not liable for delay or non-performance caused by events beyond reasonable control, including pandemics, war, terrorism, severe
            weather, travel disruption, labour disputes, or regulatory change.
          </p>
        </section>

        <section className="space-y-3">
          <h2>13. Privacy</h2>
          <p>
            Personal data you enter is processed to perform bookings, comply with law (including sanctions and export checks where relevant), and
            improve the portal. You must have a lawful basis to provide client data to us and must direct your clients to your own privacy notice where
            required.
          </p>
        </section>

        <section className="space-y-3">
          <h2>14. Governing law and disputes</h2>
          <p>
            These terms are governed by the laws of the <strong>United Arab Emirates</strong> as applied in the <strong>Emirate of Dubai</strong>. You
            submit to the exclusive jurisdiction of the courts of Dubai, except where mandatory law requires another competent forum for you as a
            business user in another jurisdiction.
          </p>
        </section>

        <section className="space-y-3">
          <h2>15. Changes</h2>
          <p>
            We may update these terms periodically. Material changes will be highlighted in the portal or by email where practicable. Continued use
            after changes constitutes acceptance.
          </p>
        </section>

        <section className="space-y-3">
          <h2>16. Contact</h2>
          <p>
            For questions about these terms or a specific booking, contact your ZK Sports & Entertainment account representative or the email address
            provided in your onboarding materials.
          </p>
        </section>
      </article>
    </div>
  )
}
